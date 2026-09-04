const PY = String.raw`import sys, subprocess, tempfile, shutil, hashlib, json
from array import array
from pathlib import Path
import requests

TICKET = json.loads(__import__('base64').b64decode(TICKET_B64).decode('utf-8'))
INSTRUMENTAL_METHOD = 'mixture_residual_pcm48_mono_source_minus_vocals_v2'
PCM_RATE = 48000

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

def decode_pcm48_mono(path, raw_path):
    subprocess.run([
        'ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(path),'-vn',
        '-ac','1','-ar',str(PCM_RATE),'-f','f32le',str(raw_path)
    ],check=True)
    values=array('f')
    with open(raw_path,'rb') as f: values.fromfile(f, raw_path.stat().st_size // 4)
    if sys.byteorder != 'little': values.byteswap()
    return values

def write_pcm48_mono(values, wav_path, raw_path):
    out=array('f',values)
    if sys.byteorder != 'little': out.byteswap()
    with open(raw_path,'wb') as f: out.tofile(f)
    subprocess.run([
        'ffmpeg','-hide_banner','-loglevel','error','-y',
        '-f','f32le','-ar',str(PCM_RATE),'-ac','1','-i',str(raw_path),
        '-c:a','pcm_f32le',str(wav_path)
    ],check=True)

def build_mixture_consistent_stems(source, demucs_vocal, vocal_out, instrumental_out, tmp):
    source_values=decode_pcm48_mono(source,tmp/'source.f32')
    vocal_values=decode_pcm48_mono(demucs_vocal,tmp/'vocal.f32')
    if len(vocal_values) < len(source_values):
        vocal_values.extend([0.0] * (len(source_values) - len(vocal_values)))
    elif len(vocal_values) > len(source_values):
        del vocal_values[len(source_values):]
    residual=array('f',(source_values[i]-vocal_values[i] for i in range(len(source_values))))
    write_pcm48_mono(vocal_values,vocal_out,tmp/'vocal-normalized.f32')
    write_pcm48_mono(residual,instrumental_out,tmp/'instrumental-residual.f32')

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
        demucs_vocal=stem/'vocals.wav'
        vocal=tmp/'vocals-mixture-consistent.wav'
        inst=tmp/'instrumental-mixture-consistent.wav'
        if not demucs_vocal.exists(): raise RuntimeError('vocal_stem_missing')
        build_mixture_consistent_stems(src,demucs_vocal,vocal,inst,tmp)
        if not vocal.exists() or not inst.exists(): raise RuntimeError('mixture_consistent_stems_missing')
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
  return new Response(PY, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-pablovoice-worker': 'standalone-stems-v3' } });
});
