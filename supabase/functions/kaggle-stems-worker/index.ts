const PY = String.raw`import sys, subprocess, tempfile, shutil, hashlib, json
from pathlib import Path
import requests

TICKET = json.loads(__import__('base64').b64decode(TICKET_B64).decode('utf-8'))
INSTRUMENTAL_METHOD = 'mixture_residual_source_minus_vocals_v1'

def sha256_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def download(url,path):
    with requests.get(url,stream=True,timeout=180) as r:
        r.raise_for_status()
        with open(path,'wb') as f:
            for chunk in r.iter_content(1024*1024):
                if chunk: f.write(chunk)

def upload_signed(ticket, output, file_path):
    from supabase import create_client
    sb=create_client(ticket['supabase_url'], ticket['supabase_publishable_key'])
    with open(file_path,'rb') as f:
        return sb.storage.from_(output['bucket']).upload_to_signed_url(path=output['path'], token=output['token'], file=f)

def post_callback(ticket,payload):
    body={'job_id':ticket['job_id'],'callback_token':ticket['callback_token'],**payload}
    r=requests.post(ticket['complete_url'],json=body,timeout=120)
    if not r.ok:
        raise RuntimeError('callback_failed '+str(r.status_code)+' '+r.text[:600])
    return r.json()

def build_mixture_consistent_instrumental(source, vocal, instrumental):
    subprocess.run([
        'ffmpeg','-hide_banner','-loglevel','error','-y',
        '-i',str(source),'-i',str(vocal),
        '-filter_complex',"[0:a][1:a]amix=inputs=2:weights='1 -1':normalize=0:duration=first",
        '-ar','44100','-ac','2','-c:a','pcm_s16le',str(instrumental)
    ],check=True)

def run():
    if TICKET.get('job_type')!='stems': raise RuntimeError('invalid_job_type')
    subprocess.run([sys.executable,'-m','pip','install','-q','demucs==4.0.1','supabase'],check=True)
    tmp=Path(tempfile.mkdtemp(prefix='pv-stems-'))
    try:
        src=tmp/'source.bin'
        download(TICKET['source_url'],src)
        source_sha=sha256_file(src)
        if source_sha.lower()!=str(TICKET['source_sha256']).lower(): raise RuntimeError('source_sha256_mismatch')
        out=tmp/'separated'
        subprocess.run([sys.executable,'-m','demucs','--two-stems=vocals','-n','htdemucs','--out',str(out),str(src)],check=True)
        stem=out/'htdemucs'/src.stem
        vocal=stem/'vocals.wav'; inst=stem/'no_vocals.wav'
        if not vocal.exists(): raise RuntimeError('vocal_stem_missing')
        build_mixture_consistent_instrumental(src,vocal,inst)
        if not inst.exists(): raise RuntimeError('instrumental_stem_missing')
        vocal_sha=sha256_file(vocal); inst_sha=sha256_file(inst)
        if source_sha in {vocal_sha,inst_sha} or vocal_sha==inst_sha: raise RuntimeError('proof_gate_failed')
        if vocal.stat().st_size<=4096 or inst.stat().st_size<=4096: raise RuntimeError('stem_too_small')
        upload_signed(TICKET,TICKET['outputs']['vocal'],vocal)
        upload_signed(TICKET,TICKET['outputs']['instrumental'],inst)
        result=post_callback(TICKET,{
            'source_sha256':source_sha,
            'vocal_sha256':vocal_sha,
            'instrumental_sha256':inst_sha,
            'vocal_size_bytes':vocal.stat().st_size,
            'instrumental_size_bytes':inst.stat().st_size,
            'demucs_version':'4.0.1',
            'instrumental_method':INSTRUMENTAL_METHOD,
        })
        print('PABLOVOICE_STEMS_OK',json.dumps(result,ensure_ascii=False))
    finally:
        shutil.rmtree(tmp,ignore_errors=True)
run()
`;

Deno.serve((req: Request) => {
  if (req.method !== 'GET') return new Response('method_not_allowed', { status: 405 });
  return new Response(PY, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-pablovoice-worker': 'standalone-stems-v2' } });
});
