Deno.serve(() => new Response(String.raw`import os,sys,subprocess,json,hashlib,tempfile,shutil,base64,traceback,threading,time,io,contextlib
from pathlib import Path
from urllib.parse import urljoin,urlparse
import requests

T=json.loads(base64.b64decode(TICKET_B64).decode('utf-8'))
RUNTIME_EPOCH_BUDGET=20
TUS_CHUNK_SIZE=6*1024*1024
_progress_lock=threading.Lock()
_progress_state={'stage':'initializing','progress':5,'message':'Inicializando treino vocal'}

def sh(cmd,cwd=None):
    p=subprocess.run(cmd,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    print(p.stdout[-16000:])
    if p.returncode:
        raise RuntimeError('command failed: '+str(cmd[0])+' :: '+p.stdout[-2200:])
    return p.stdout

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()

def dl(url,dest):
    with requests.get(url,stream=True,timeout=300) as r:
        r.raise_for_status()
        with open(dest,'wb') as f:
            for chunk in r.iter_content(1024*1024):
                if chunk:f.write(chunk)

def check(path,expected,label):
    if not Path(path).exists(): raise RuntimeError(label+' missing')
    actual=sha(path)
    if actual.lower()!=str(expected).lower(): raise RuntimeError(label+' sha256 mismatch')
    return actual

def post(action='progress',stage='training',progress=10,message='',remember=True):
    if action=='progress' and remember:
        with _progress_lock:
            _progress_state.update(stage=str(stage),progress=int(progress or 0),message=str(message)[:900])
    body={'job_id':T['job_id'],'callback_token':T['callback_token'],'action':action,'stage':stage,'progress':progress,'message':str(message)[:900]}
    try:
        r=requests.post(T['complete_url'],headers={'content-type':'application/json','apikey':T['supabase_publishable_key']},json=body,timeout=60)
        print('callback',action,stage,r.status_code,r.text[:600])
        if action in ('complete','error'): r.raise_for_status()
        return r
    except Exception as e:
        print('callback warning',repr(e))
        if action in ('complete','error'): raise

def heartbeat():
    while True:
        time.sleep(25)
        with _progress_lock:
            state=dict(_progress_state)
        post('progress',state['stage'],state['progress'],state['message'],remember=False)

def fail_if_message(result,needle,label):
    text=str(result or '')
    if needle.lower() in text.lower(): raise RuntimeError(label+': '+text)

def tus_meta(value):
    return base64.b64encode(str(value).encode('utf-8')).decode('ascii')

def upload_signed_resumable(bucket,path,token,file_path,content_type='application/octet-stream'):
    size=Path(file_path).stat().st_size
    host=urlparse(T['supabase_url']).hostname or ''
    if not host.endswith('.supabase.co'):
        raise RuntimeError('Supabase resumable upload host invalid')
    project_ref=host.split('.')[0]
    endpoint=f'https://{project_ref}.storage.supabase.co/storage/v1/upload/resumable'
    common={'Tus-Resumable':'1.0.0','x-signature':token,'apikey':T['supabase_publishable_key']}
    metadata=','.join([
        'bucketName '+tus_meta(bucket),
        'objectName '+tus_meta(path),
        'contentType '+tus_meta(content_type),
        'cacheControl '+tus_meta('3600'),
    ])
    create_headers={**common,'Upload-Length':str(size),'Upload-Metadata':metadata}
    r=requests.post(endpoint,headers=create_headers,timeout=60)
    if r.status_code not in (201,204):
        raise RuntimeError('resumable upload creation failed: '+str(r.status_code)+' '+r.text[:600])
    location=r.headers.get('Location')
    if not location:
        raise RuntimeError('resumable upload location missing')
    upload_url=location if location.startswith('http') else urljoin(endpoint+'/',location)
    offset=0
    with open(file_path,'rb') as f:
        while offset<size:
            chunk=f.read(TUS_CHUNK_SIZE)
            if not chunk:
                raise RuntimeError('resumable upload source ended before expected size')
            patch_headers={**common,'Upload-Offset':str(offset),'Content-Type':'application/offset+octet-stream'}
            r=requests.patch(upload_url,headers=patch_headers,data=chunk,timeout=180)
            if r.status_code!=204:
                raise RuntimeError('resumable upload chunk failed: '+str(r.status_code)+' '+r.text[:600])
            expected_offset=offset+len(chunk)
            try:
                next_offset=int(r.headers.get('Upload-Offset','-1'))
            except ValueError:
                next_offset=-1
            if next_offset!=expected_offset:
                raise RuntimeError(f'resumable upload offset mismatch: expected {expected_offset}, got {next_offset}')
            offset=next_offset
    if offset!=size:
        raise RuntimeError(f'resumable upload incomplete: expected {size}, got {offset}')

def upload_signed(bucket,path,token,file_path,content_type='application/octet-stream'):
    if Path(file_path).stat().st_size>TUS_CHUNK_SIZE:
        return upload_signed_resumable(bucket,path,token,file_path,content_type)
    from supabase import create_client
    sb=create_client(T['supabase_url'],T['supabase_publishable_key'])
    with open(file_path,'rb') as f:
        sb.storage.from_(bucket).upload_to_signed_url(path=path,token=token,file=f,file_options={'content-type':content_type,'cache-control':'3600'})

def probe(path):
    raw=subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=sample_rate,channels','-show_entries','format=duration','-of','json',str(path)],text=True)
    j=json.loads(raw);s=(j.get('streams') or [{}])[0];f=j.get('format') or {}
    return {'duration_seconds':float(f.get('duration') or 0),'sample_rate':int(s.get('sample_rate') or 0),'channels':int(s.get('channels') or 0)}

def recover_exact_final_inference_model(exp,model_name,target_epoch,sample_rate,vocoder,torch):
    generator_checkpoints=sorted(exp.glob('G_*.pth'),key=lambda p:p.stat().st_mtime)
    if not generator_checkpoints:
        raise RuntimeError(f'exact final generator checkpoint missing for target epoch {target_epoch}')
    generator_checkpoint=generator_checkpoints[-1]
    checkpoint=torch.load(generator_checkpoint,map_location='cpu',weights_only=True)
    checkpoint_iteration=int(checkpoint.get('iteration',-1))
    if checkpoint_iteration != target_epoch:
        raise RuntimeError(f'generator checkpoint iteration mismatch: expected {target_epoch}, got {checkpoint_iteration}')
    ckpt=checkpoint.get('model')
    if not isinstance(ckpt,dict) or not ckpt:
        raise RuntimeError('exact final generator checkpoint model state missing')
    from rvc.train.process.extract_model import extract_model
    from rvc.train.utils import HParams
    with open(exp/'config.json','r',encoding='utf-8') as f:
        hps=HParams(**json.load(f))
    recovered=exp/f'{model_name}_{target_epoch}e_-1s.pth'
    capture=io.StringIO()
    with contextlib.redirect_stdout(capture):
        extract_model(ckpt=ckpt,sr=sample_rate,name=model_name,model_path=str(recovered),epoch=target_epoch,step=-1,hps=hps,vocoder=vocoder,pitch_guidance=True,version='v2')
    extraction_log=capture.getvalue()
    if extraction_log: print(extraction_log[-4000:])
    if not recovered.exists() or recovered.stat().st_size<1_000_000:
        detail=extraction_log[-1200:].replace('\n',' ')
        raise RuntimeError('final checkpoint extraction failed'+((' :: '+detail) if detail else ''))
    return recovered,checkpoint_iteration

threading.Thread(target=heartbeat,daemon=True).start()
work=Path(tempfile.mkdtemp(prefix='pablovoice-train-v1-',dir='/tmp'))
A=Path('/tmp/ApplioVoiceTrainV1')
try:
    post('progress','worker_started',10,'Preparando GPU de treino')
    sh(['bash','-lc','apt-get update -qq && apt-get install -y -qq git ffmpeg libgl1 libglib2.0-0 > /dev/null'])
    sh([sys.executable,'-m','pip','install','-q','--upgrade','pip'])
    shutil.rmtree(A,ignore_errors=True);A.mkdir(parents=True,exist_ok=True)
    sh(['git','init','-q'],cwd=A);sh(['git','remote','add','origin','https://github.com/IAHispano/Applio.git'],cwd=A)
    sh(['git','fetch','-q','--depth','1','origin',T['applio_commit']],cwd=A);sh(['git','checkout','-q','FETCH_HEAD'],cwd=A)
    commit=subprocess.check_output(['git','-C',str(A),'rev-parse','HEAD'],text=True).strip()
    if commit!=T['applio_commit']: raise RuntimeError('Applio commit binding mismatch')
    config_template=A/'assets/config_template.json';config_path=A/'assets/config.json'
    if not config_template.exists(): raise RuntimeError('Applio config template missing')
    if not config_path.exists(): shutil.copy(config_template,config_path)
    with open(config_path,'r',encoding='utf-8') as f:
        runtime_config=json.load(f)
    if 'model_author' not in runtime_config: raise RuntimeError('Applio runtime config invalid')
    sh(['bash','-lc',f"grep -Ev '^(torch|torchaudio|torchvision)==' {A}/requirements.txt > /tmp/applio-train-v1-requirements.txt"])
    sh([sys.executable,'-m','pip','install','-q','-r','/tmp/applio-train-v1-requirements.txt','supabase'])
    sys.path.insert(0,str(A));os.chdir(A)
    import torch
    if not torch.cuda.is_available(): raise RuntimeError('Kaggle did not allocate a usable GPU')
    print('GPU',torch.cuda.get_device_name(0))
    from rvc.lib.tools.prerequisites_download import prequisites_download_pipeline
    prequisites_download_pipeline(True,True,False)
    required=[A/'rvc/models/pretraineds/hifi-gan/f0G48k.pth',A/'rvc/models/pretraineds/hifi-gan/f0D48k.pth',A/'rvc/models/predictors/rmvpe.pt',A/'rvc/models/embedders/contentvec/pytorch_model.bin',A/'rvc/models/embedders/contentvec/config.json']
    missing=[str(x) for x in required if not x.exists()]
    if missing: raise RuntimeError('Applio prerequisites missing: '+', '.join(missing))
    post('progress','dependencies_ready',18,'Applio fixado e pré-treinados verificados')

    dataset=work/'dataset';dataset.mkdir(parents=True,exist_ok=True)
    source_proof=[]
    for n,src in enumerate(T['sources']):
        raw=work/f'source-{n}.bin';wav=dataset/f'source-{n}.wav'
        dl(src['url'],raw);actual=check(raw,src['sha256'],f'source {n}')
        sh(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(raw),'-vn','-ar','48000','-ac','1','-c:a','pcm_s16le',str(wav)])
        if not wav.exists() or wav.stat().st_size<48000*2*20: raise RuntimeError(f'source {n} normalization too small')
        source_proof.append({'id':src['id'],'sha256':actual})
    post('progress','sources_verified',24,'Fontes privadas verificadas por SHA-256')

    from core import run_preprocess_script,run_extract_script,run_train_script,run_infer_script
    s=T['settings'];model_name='PabloVoiceCandidateV1';cpu=max(2,min(4,os.cpu_count() or 2))
    result=run_preprocess_script(model_name=model_name,dataset_path=str(dataset),sample_rate=int(s['sample_rate']),cpu_cores=cpu,cut_preprocess=s['cut_preprocess'],process_effects=False,noise_reduction=bool(s['noise_reduction']),clean_strength=0.0,chunk_len=float(s['chunk_len']),overlap_len=float(s['overlap_len']),normalization_mode=s['normalization_mode'])
    fail_if_message(result,'failed','preprocess failed')
    exp=A/'logs'/model_name
    sliced=list((exp/'sliced_audios').glob('*.wav'))
    if len(sliced)<8: raise RuntimeError('preprocess produced insufficient slices')
    post('progress','preprocessed',32,f'{len(sliced)} cortes preparados')

    result=run_extract_script(model_name=model_name,f0_method=s['f0_method'],cpu_cores=cpu,gpu=0,sample_rate=int(s['sample_rate']),embedder_model=s['embedder_model'],embedder_model_custom=None,include_mutes=2)
    fail_if_message(result,'failed','feature extraction failed')
    features=list((exp/'extracted').glob('*.npy'))
    if len(features)<8: raise RuntimeError('feature extraction produced insufficient features')
    post('progress','features_ready',42,f'{len(features)} embeddings extraídos')

    requested_epoch=int(s['total_epoch'])
    if requested_epoch<1: raise RuntimeError('invalid requested epoch count')
    target_epoch=min(requested_epoch,RUNTIME_EPOCH_BUDGET)
    requested_checkpoint_every=max(1,int(s['save_every_epoch']))
    checkpoint_every=min(requested_checkpoint_every,target_epoch)
    post('progress','training',46,f'Treinando {target_epoch} epochs; checkpoint final garantido no epoch {target_epoch}')
    result=run_train_script(model_name=model_name,save_every_epoch=checkpoint_every,save_only_latest=True,save_every_weights=True,total_epoch=target_epoch,sample_rate=int(s['sample_rate']),batch_size=int(s['batch_size']),gpu=0,pretrained=True,cleanup=False,index_algorithm=s['index_algorithm'],cache_data_in_gpu=False,custom_pretrained=False,g_pretrained_path=None,d_pretrained_path=None,vocoder=s['vocoder'],checkpointing=bool(s['checkpointing']),shutdown_check=False)
    fail_if_message(result,'failed','training failed')
    pths=sorted(exp.glob(f'{model_name}_{target_epoch}e_*s.pth'),key=lambda p:p.stat().st_mtime)
    idx=exp/f'{model_name}.index'
    checkpoint_iteration=target_epoch
    pth_derivation='applio_native_inference_export_v1'
    if pths:
        pth=pths[-1]
    else:
        pth,checkpoint_iteration=recover_exact_final_inference_model(exp,model_name,target_epoch,int(s['sample_rate']),s['vocoder'],torch)
        pth_derivation='applio_exact_final_generator_checkpoint_v1'
    if checkpoint_iteration != target_epoch:
        raise RuntimeError(f'final checkpoint epoch proof mismatch: expected {target_epoch}, got {checkpoint_iteration}')
    if not idx.exists() or idx.stat().st_size<1000: raise RuntimeError('trained index missing')
    pth_sha=sha(pth);idx_sha=sha(idx)
    post('progress','trained',80,f'Modelo candidato treinado em {target_epoch} epochs; gerando prova de identidade')

    validation=T['validation'];guide_raw=work/'validation-guide.bin';guide=work/'validation-guide.wav';voice=work/'validation-voice.wav';flac=work/'validation-voice.flac'
    dl(validation['guide_url'],guide_raw);check(guide_raw,validation['guide_sha256'],'validation guide')
    start=float(validation['region']['start_seconds']);duration=float(validation['region']['duration_seconds'])
    sh(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(guide_raw),'-ss',f'{start:.6f}','-t',f'{duration:.6f}','-ar','48000','-ac','1','-c:a','pcm_s16le',str(guide)])
    run_infer_script(pitch=0,index_rate=0.70,volume_envelope=0.9,protect=0.50,f0_method='rmvpe',input_path=str(guide),output_path=str(voice),pth_path=str(pth),index_path=str(idx),split_audio=True,f0_autotune=False,f0_autotune_strength=0.0,proposed_pitch=False,proposed_pitch_threshold=155.0,clean_audio=False,clean_strength=0.25,export_format='WAV',embedder_model='contentvec')
    if not voice.exists() or voice.stat().st_size<4096: raise RuntimeError('candidate validation output missing')
    sh(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(voice),'-c:a','flac','-compression_level','8',str(flac)])
    vinfo=probe(flac);vsha=sha(flac)
    if not (duration-0.6 <= vinfo['duration_seconds'] <= duration+0.6): raise RuntimeError('candidate validation duration mismatch')
    upload_signed(validation['output']['bucket'],validation['output']['path'],validation['output']['token'],flac,'audio/flac')
    post('progress','validation_uploaded',86,'Áudio de validação do candidato persistido')

    part_size=24*1024*1024
    count=(pth.stat().st_size+part_size-1)//part_size
    if count<1 or count>len(T['outputs']['parts']): raise RuntimeError('trained pth exceeds reserved multipart capacity')
    parts=[]
    with open(pth,'rb') as src:
        for order in range(count):
            data=src.read(part_size);part=work/f'PabloVoice.part{order:03d}';part.write_bytes(data)
            target=T['outputs']['parts'][order]
            upload_signed(T['outputs']['bucket'],target['path'],target['token'],part)
            parts.append({'order':order,'path':target['path'],'sha256':sha(part),'size_bytes':part.stat().st_size})
    upload_signed(T['outputs']['bucket'],T['outputs']['index']['path'],T['outputs']['index']['token'],idx)
    post('progress','uploading',94,'Artefatos do modelo candidato persistidos')

    payload={'job_id':T['job_id'],'callback_token':T['callback_token'],'action':'complete','candidate_model_id':T['candidate_model_id'],'applio_commit':commit,'sources':source_proof,'pth_sha256':pth_sha,'index_sha256':idx_sha,'pth_size_bytes':pth.stat().st_size,'index_size_bytes':idx.stat().st_size,'pth_parts':parts,'index_path':T['outputs']['index']['path'],'epochs_requested':requested_epoch,'epochs_completed':target_epoch,'checkpoint_every_epoch':checkpoint_every,'checkpoint_iteration':checkpoint_iteration,'pth_derivation':pth_derivation,'worker_version':'voice-train-v1-budget20-exact-checkpoint-recovery-applio-config-init-tus6m','validation':{'asset_id':validation['output']['asset_id'],'sha256':vsha,'size_bytes':flac.stat().st_size,'duration_seconds':vinfo['duration_seconds'],'sample_rate':vinfo['sample_rate'],'channels':vinfo['channels'],'storage_bucket':validation['output']['bucket'],'storage_path':validation['output']['path'],'guide_asset_id':validation['guide_asset_id'],'guide_sha256':validation['guide_sha256'],'region':validation['region']}}
    r=requests.post(T['complete_url'],headers={'content-type':'application/json','apikey':T['supabase_publishable_key']},json=payload,timeout=180)
    print('complete',r.status_code,r.text[:1600]);r.raise_for_status()
    print('PabloVoice candidate training V1 complete')
except Exception as e:
    traceback.print_exc()
    try:post('error','error',0,repr(e))
    except Exception:pass
    raise
finally:
    shutil.rmtree(work,ignore_errors=True);shutil.rmtree(A,ignore_errors=True)
`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }))