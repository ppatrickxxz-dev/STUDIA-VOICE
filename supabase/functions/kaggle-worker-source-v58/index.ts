const PY = String.raw`import sys, subprocess, tempfile, shutil, hashlib, json, os
from pathlib import Path
import requests

TICKET = json.loads(__import__('base64').b64decode(TICKET_B64).decode('utf-8'))
ACE_REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866'
ACE_MODEL = 'acestep-v15-turbo'


def sha256_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


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


def prepare_repo(tmp):
    repo=tmp/'ACE-Step-1.5'
    subprocess.run(['git','init',str(repo)],check=True)
    subprocess.run(['git','-C',str(repo),'remote','add','origin','https://github.com/ace-step/ACE-Step-1.5.git'],check=True)
    subprocess.run(['git','-C',str(repo),'fetch','--depth','1','origin',ACE_REVISION],check=True)
    subprocess.run(['git','-C',str(repo),'checkout','--detach','FETCH_HEAD'],check=True)
    subprocess.run([sys.executable,'-m','pip','install','-q','uv','supabase'],check=True)
    subprocess.run(['uv','sync','--frozen','--no-dev','--python','3.11'],cwd=repo,check=True)
    return repo


def write_generation_script(repo,tmp):
    generation=TICKET['generation']
    script=tmp/'generate_once.py'
    payload=json.dumps(generation,ensure_ascii=False)
    script.write_text("""import json, os
from pathlib import Path
from acestep.handler import AceStepHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

g=json.loads(os.environ['PV_GENERATION_JSON'])
repo=Path(os.environ['PV_ACE_REPO'])
out=Path(os.environ['PV_OUTPUT_DIR']); out.mkdir(parents=True,exist_ok=True)
handler=AceStepHandler()
status,ok=handler.initialize_service(project_root=str(repo),config_path='acestep-v15-turbo',device='cuda',use_flash_attention=False,compile_model=False,offload_to_cpu=False,offload_dit_to_cpu=False,prefer_source='modelscope')
if not ok: raise RuntimeError('ace_init_failed: '+str(status))
params=GenerationParams(caption=g['caption'],lyrics=g['lyrics'],instrumental=bool(g['instrumental']),bpm=int(g['bpm']),keyscale=g.get('keyscale',''),timesignature=g.get('timesignature','4'),vocal_language=g.get('vocal_language','unknown'),duration=float(g['duration']),thinking=False,use_cot_metas=False,use_cot_caption=False,use_cot_language=False,use_constrained_decoding=False,inference_steps=int(g.get('inference_steps',8)),seed=int(g['seed']),task_type='text2music',dcw_enabled=False)
config=GenerationConfig(batch_size=1,seeds=[int(g['seed'])],use_random_seed=False,audio_format='flac')
result=generate_music(handler,None,params,config,save_dir=str(out))
if not result.success: raise RuntimeError('ace_generation_failed: '+str(result.error or result.status_message))
if not result.audios or not result.audios[0].get('path'): raise RuntimeError('ace_output_missing')
print('PV_OUTPUT_PATH='+str(result.audios[0]['path']))
""",encoding='utf-8')
    return script,payload


def run():
    if TICKET.get('job_type')!='music_generation': raise RuntimeError('invalid_job_type')
    engine=TICKET.get('engine') or {}
    if engine.get('source_revision')!=ACE_REVISION or engine.get('model')!=ACE_MODEL: raise RuntimeError('engine_identity_mismatch')
    tmp=Path(tempfile.mkdtemp(prefix='pv-music-'))
    try:
        repo=prepare_repo(tmp)
        script,payload=write_generation_script(repo,tmp)
        outdir=tmp/'generated'
        env=os.environ.copy()
        env['PV_GENERATION_JSON']=payload
        env['PV_ACE_REPO']=str(repo)
        env['PV_OUTPUT_DIR']=str(outdir)
        env['ACESTEP_CONFIG_PATH']=ACE_MODEL
        env['ACESTEP_DOWNLOAD_SOURCE']='modelscope'
        completed=subprocess.run(['uv','run','python',str(script)],cwd=repo,env=env,check=True,text=True,capture_output=True)
        output_line=next((line for line in completed.stdout.splitlines() if line.startswith('PV_OUTPUT_PATH=')),None)
        if not output_line: raise RuntimeError('ace_output_path_missing '+completed.stdout[-1200:])
        generated=Path(output_line.split('=',1)[1].strip())
        if not generated.exists(): raise RuntimeError('generated_file_missing')
        if generated.stat().st_size<=4096: raise RuntimeError('generated_file_too_small')
        meta=probe_audio(generated)
        if meta['duration_seconds']<=1 or meta['sample_rate']<=0 or meta['channels']<=0: raise RuntimeError('generated_audio_probe_failed')
        output=TICKET['outputs']['full_mix']
        upload_signed(TICKET,output,generated)
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
            'generation_seed':int(TICKET['generation']['seed']),
        })
        print('PABLOVOICE_NATIVE_MUSIC_OK',json.dumps(result,ensure_ascii=False))
    finally:
        shutil.rmtree(tmp,ignore_errors=True)

run()
`;

Deno.serve((req: Request) => {
  if (req.method !== 'GET') return new Response('method_not_allowed', { status: 405 });
  return new Response(PY, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-pablovoice-worker': 'native-music-ace-step-v1' } });
});
