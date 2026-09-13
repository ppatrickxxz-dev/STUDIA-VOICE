const PY = String.raw`import sys, subprocess, tempfile, shutil, hashlib, json, os, threading
from pathlib import Path
import requests

TICKET = json.loads(__import__('base64').b64decode(TICKET_B64).decode('utf-8'))
ACE_REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866'
ACE_MODEL = 'acestep-v15-turbo'
PROGRESS_URL = TICKET.get('progress_url') or (TICKET['supabase_url'].rstrip('/') + '/functions/v1/progress-kaggle-pipeline-job-v58')


def sha256_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def post_progress(stage, message=''):
    body={'job_id':TICKET['job_id'],'callback_token':TICKET['callback_token'],'stage':stage}
    if message: body['message']=str(message)[-1200:]
    try:
        r=requests.post(PROGRESS_URL,json=body,timeout=25)
        if not r.ok:
            print('PABLOVOICE_PROGRESS_WARN',stage,r.status_code,r.text[:300],flush=True)
        return r.ok
    except Exception as exc:
        print('PABLOVOICE_PROGRESS_WARN',stage,str(exc)[:300],flush=True)
        return False


def heartbeat_loop(stop_event):
    post_progress('heartbeat')
    while not stop_event.wait(45):
        post_progress('heartbeat')


def upload_signed(ticket, output, file_path):
    from supabase import create_client
    sb=create_client(ticket['supabase_url'], ticket['supabase_publishable_key'])
    with open(file_path,'rb') as f:
        return sb.storage.from_(output['bucket']).upload_to_signed_url(path=output['path'], token=output['token'], file=f)


def post_callback(ticket,payload):
    body={'job_id':ticket['job_id'],'callback_token':ticket['callback_token'],**payload}
    r=requests.post(ticket['complete_url'],json=body,timeout=180)
    if not r.ok:
        raise RuntimeError('callback_failed '+str(r.status_code)+' '+r.text[:800])
    return r.json()


def probe_audio(path):
    raw=subprocess.check_output([
        'ffprobe','-v','error','-select_streams','a:0','-show_entries',
        'stream=sample_rate,channels:format=duration','-of','json',str(path)
    ],text=True)
    data=json.loads(raw)
    stream=(data.get('streams') or [{}])[0]
    fmt=data.get('format') or {}
    return {
        'sample_rate': int(float(stream.get('sample_rate') or 0)),
        'channels': int(stream.get('channels') or 0),
        'duration_seconds': float(fmt.get('duration') or 0),
    }


def apply_pre_ampere_dtype_patch(repo):
    path=repo/'acestep/core/generation/handler/init_service_orchestrator.py'
    source=path.read_text(encoding='utf-8')
    old='''            elif resolved_device == "cuda":
                if gpu_config.cuda_supports_bfloat16():
                    self.dtype = torch.bfloat16
                else:
                    self.dtype = torch.float16
                    logger.info(
                        "[initialize_service] Pre-Ampere CUDA detected: "
                        "using float16 instead of bfloat16."
                    )
'''
    new='''            elif resolved_device == "cuda":
                forced_dtype = os.environ.get("ACESTEP_DTYPE", "").strip().lower()
                if forced_dtype in ("float32", "float16", "bfloat16"):
                    self.dtype = getattr(torch, forced_dtype)
                    logger.info(
                        f"[initialize_service] ACESTEP_DTYPE={forced_dtype} override: "
                        f"using dtype={self.dtype}."
                    )
                elif gpu_config.cuda_supports_bfloat16():
                    self.dtype = torch.bfloat16
                else:
                    self.dtype = torch.float16
                    logger.info(
                        "[initialize_service] Pre-Ampere CUDA detected: "
                        "using float16 instead of bfloat16."
                    )
'''
    if source.count(old) != 1:
        raise RuntimeError('ace_dtype_patch_source_mismatch')
    path.write_text(source.replace(old,new),encoding='utf-8')
    return sha256_file(path)


def prepare_repo(tmp):
    repo=tmp/'ACE-Step-1.5'
    subprocess.run(['git','init',str(repo)],check=True)
    subprocess.run(['git','-C',str(repo),'remote','add','origin','https://github.com/ace-step/ACE-Step-1.5.git'],check=True)
    subprocess.run(['git','-C',str(repo),'fetch','--depth','1','origin',ACE_REVISION],check=True)
    subprocess.run(['git','-C',str(repo),'checkout','--detach','FETCH_HEAD'],check=True)
    dtype_patch_sha=apply_pre_ampere_dtype_patch(repo)
    subprocess.run([sys.executable,'-m','pip','install','-q','uv','supabase'],check=True)
    subprocess.run(['uv','sync','--frozen','--no-dev','--python','3.11'],cwd=repo,check=True)
    return repo,dtype_patch_sha


def write_generation_script(repo,tmp):
    generation=TICKET['generation']
    script=tmp/'generate_once.py'
    payload=json.dumps(generation,ensure_ascii=False)
    script.write_text("""import json, os, traceback, torch
from pathlib import Path
from acestep.handler import AceStepHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

g=json.loads(os.environ['PV_GENERATION_JSON'])
repo=Path(os.environ['PV_ACE_REPO'])
out=Path(os.environ['PV_OUTPUT_DIR']); out.mkdir(parents=True,exist_ok=True)

def next_seed(base, attempt):
    # Keep retries deterministic enough for provenance while escaping a
    # numerically unstable latent sample.
    return ((int(base) + attempt * 104729) % 2147483646) + 1

def numeric_failure(value):
    text=str(value or '').lower()
    return 'nan or inf latents' in text or 'nan=' in text or 'float16 overflow' in text

try:
    major,minor=torch.cuda.get_device_capability() if torch.cuda.is_available() else (0,0)
    # ACE-Step's pinned revision selects float16 on pre-Ampere CUDA. The upstream
    # NaN diagnostic recommends float32 for that exact case, so the worker patches
    # the pinned initializer to honor this explicit override instead of floating
    # to an unpinned upstream revision.
    if major and major < 8:
        os.environ['ACESTEP_DTYPE']='float32'

    handler=AceStepHandler()
    status,ok=handler.initialize_service(project_root=str(repo),config_path='acestep-v15-turbo',device='cuda',use_flash_attention=False,compile_model=False,offload_to_cpu=False,offload_dit_to_cpu=False,prefer_source='modelscope')
    if not ok: raise RuntimeError('ace_init_failed: '+str(status))
    generation_dtype=str(getattr(handler,'dtype','unknown')).replace('torch.','')
    if major and major < 8 and generation_dtype != 'float32':
        raise RuntimeError('ace_dtype_override_not_applied: '+generation_dtype)

    requested_shift=float(g.get('shift',3.0))
    # T4 is SM 7.5. Keep the conservative diffusion shift on pre-Ampere as a
    # secondary guard even after moving the model runtime to float32.
    safe_shift=1.0 if major and major < 8 else requested_shift
    base_seed=int(g['seed'])
    generated=None
    used_seed=None
    last_error=None

    for attempt in range(3):
        seed=next_seed(base_seed,attempt)
        params=GenerationParams(
            caption=g['caption'],
            lyrics=g['lyrics'],
            instrumental=bool(g['instrumental']),
            bpm=int(g['bpm']),
            keyscale=g.get('keyscale',''),
            timesignature=g.get('timesignature','4'),
            vocal_language=g.get('vocal_language','unknown'),
            duration=float(g['duration']),
            thinking=False,
            use_cot_metas=False,
            use_cot_caption=False,
            use_cot_language=False,
            use_constrained_decoding=bool(g.get('use_constrained_decoding',True)),
            inference_steps=int(g.get('inference_steps',8)),
            shift=safe_shift,
            seed=seed,
            task_type='text2music',
            dcw_enabled=False,
        )
        config=GenerationConfig(batch_size=1,seeds=[seed],use_random_seed=False,audio_format='flac')
        try:
            result=generate_music(handler,None,params,config,save_dir=str(out))
            if not result.success:
                raise RuntimeError('ace_generation_failed: '+str(result.error or result.status_message))
            if not result.audios or not result.audios[0].get('path'):
                raise RuntimeError('ace_output_missing')
            generated=Path(result.audios[0]['path'])
            used_seed=seed
            break
        except Exception as exc:
            last_error=exc
            if not numeric_failure(exc) or attempt >= 2:
                raise
            print('PV_NUMERIC_RETRY attempt='+str(attempt+1)+' seed='+str(seed)+' reason='+str(exc)[:500],flush=True)
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    if generated is None or used_seed is None:
        raise RuntimeError('ace_generation_failed_after_numeric_retries: '+str(last_error or 'unknown'))
    print('PV_OUTPUT_PATH='+str(generated),flush=True)
    print('PV_GENERATION_SEED='+str(used_seed),flush=True)
    print('PV_GENERATION_SHIFT='+str(safe_shift),flush=True)
    print('PV_GENERATION_DTYPE='+generation_dtype,flush=True)
    print('PV_ACE_DTYPE_PATCH_SHA256='+os.environ['PV_ACE_DTYPE_PATCH_SHA256'],flush=True)
except Exception:
    traceback.print_exc()
    raise
""",encoding='utf-8')
    return script,payload


def run():
    if TICKET.get('job_type')!='music_generation': raise RuntimeError('invalid_job_type')
    engine=TICKET.get('engine') or {}
    if engine.get('source_revision')!=ACE_REVISION or engine.get('model')!=ACE_MODEL: raise RuntimeError('engine_identity_mismatch')
    generation=TICKET.get('generation') or {}
    if len(str(generation.get('caption') or ''))>512: raise RuntimeError('caption_too_long')
    stop_event=threading.Event()
    heartbeat=threading.Thread(target=heartbeat_loop,args=(stop_event,),daemon=True)
    heartbeat.start()
    tmp=Path(tempfile.mkdtemp(prefix='pv-music-'))
    try:
        repo,dtype_patch_sha=prepare_repo(tmp)
        post_progress('heartbeat')
        script,payload=write_generation_script(repo,tmp)
        outdir=tmp/'generated'
        env=os.environ.copy()
        env['PV_GENERATION_JSON']=payload
        env['PV_ACE_REPO']=str(repo)
        env['PV_OUTPUT_DIR']=str(outdir)
        env['PV_ACE_DTYPE_PATCH_SHA256']=dtype_patch_sha
        env['ACESTEP_CONFIG_PATH']=ACE_MODEL
        env['ACESTEP_DOWNLOAD_SOURCE']='modelscope'
        completed=subprocess.run(['uv','run','python',str(script)],cwd=repo,env=env,check=False,text=True,capture_output=True)
        if completed.returncode != 0:
            diagnostic=('ACE_STEP_STDERR:\n'+(completed.stderr or '')+'\nACE_STEP_STDOUT:\n'+(completed.stdout or ''))[-5000:]
            raise RuntimeError('ace_generation_process_failed: '+diagnostic)
        post_progress('heartbeat')
        output_line=next((line for line in completed.stdout.splitlines() if line.startswith('PV_OUTPUT_PATH=')),None)
        seed_line=next((line for line in completed.stdout.splitlines() if line.startswith('PV_GENERATION_SEED=')),None)
        shift_line=next((line for line in completed.stdout.splitlines() if line.startswith('PV_GENERATION_SHIFT=')),None)
        dtype_line=next((line for line in completed.stdout.splitlines() if line.startswith('PV_GENERATION_DTYPE=')),None)
        patch_line=next((line for line in completed.stdout.splitlines() if line.startswith('PV_ACE_DTYPE_PATCH_SHA256=')),None)
        if not output_line: raise RuntimeError('ace_output_path_missing '+completed.stdout[-1200:])
        generated=Path(output_line.split('=',1)[1].strip())
        used_seed=int(seed_line.split('=',1)[1].strip()) if seed_line else int(TICKET['generation']['seed'])
        used_shift=float(shift_line.split('=',1)[1].strip()) if shift_line else float(TICKET['generation'].get('shift',3.0))
        generation_dtype=dtype_line.split('=',1)[1].strip() if dtype_line else ''
        reported_patch_sha=patch_line.split('=',1)[1].strip() if patch_line else ''
        if generation_dtype!='float32': raise RuntimeError('unexpected_t4_generation_dtype: '+generation_dtype)
        if reported_patch_sha!=dtype_patch_sha: raise RuntimeError('ace_dtype_patch_proof_mismatch')
        if not generated.exists(): raise RuntimeError('generated_file_missing')
        if generated.stat().st_size<=4096: raise RuntimeError('generated_file_too_small')
        meta=probe_audio(generated)
        if meta['duration_seconds']<=1 or meta['sample_rate']<=0 or meta['channels']<=0: raise RuntimeError('generated_audio_probe_failed')
        output=TICKET['outputs']['full_mix']
        upload_signed(TICKET,output,generated)
        post_progress('heartbeat')
        digest=sha256_file(generated)
        result=post_callback(TICKET,{
            'audio_sha256':digest,
            'audio_size_bytes':generated.stat().st_size,
            'duration_seconds':meta['duration_seconds'],
            'sample_rate':meta['sample_rate'],
            'channels':meta['channels'],
            'mime_type':'audio/flac',
            'ace_revision':ACE_REVISION,
            'ace_model':ACE_MODEL,
            'generation_seed':used_seed,
            'generation_shift':used_shift,
            'generation_dtype':generation_dtype,
            'dtype_patch_sha256':dtype_patch_sha,
        })
        print('PABLOVOICE_NATIVE_MUSIC_OK',json.dumps(result,ensure_ascii=False),flush=True)
    except Exception as exc:
        post_progress('error',str(exc))
        raise
    finally:
        stop_event.set()
        heartbeat.join(timeout=5)
        shutil.rmtree(tmp,ignore_errors=True)

run()
`;

Deno.serve((req: Request) => {
  if (req.method !== 'GET') return new Response('method_not_allowed', { status: 405 });
  return new Response(PY, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-pablovoice-worker': 'native-music-ace-step-v6-t4-fp32' } });
});
