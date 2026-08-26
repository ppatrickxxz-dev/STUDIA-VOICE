const MIME_CANDIDATES = [
  'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm',
];

export class RecordingAdapter {
  constructor() {
    this.mode = null;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.cancelled = false;
  }

  get platform() {
    return globalThis.PabloVoiceAndroid?.startNativeRecording ? 'android' : 'web';
  }

  get active() {
    return Boolean(this.mode);
  }

  async start() {
    if (this.active) throw new Error('Já existe uma gravação em andamento.');
    this.cancelled = false;
    if (this.platform === 'android') return this.#startAndroid();
    return this.#startWeb();
  }

  async stop() {
    if (this.mode === 'android') return this.#stopAndroid();
    if (this.mode === 'web') return this.#stopWeb();
    throw new Error('Nenhuma gravação em andamento.');
  }

  async cancel() {
    this.cancelled = true;
    if (this.mode === 'android') {
      try { globalThis.PabloVoiceAndroid.clearNativeRecording(); } catch { /* native cleanup is best effort */ }
    }
    if (this.mode === 'web') {
      try { if (this.recorder?.state !== 'inactive') this.recorder.stop(); } catch { /* already stopped */ }
      this.stream?.getTracks().forEach((track) => track.stop());
    }
    this.#reset();
  }

  #startAndroid() {
    const bridge = globalThis.PabloVoiceAndroid;
    if (!bridge.hasMicrophonePermission()) {
      bridge.requestMicrophonePermission();
      const error = new Error('Autorize o microfone para começar.');
      error.code = 'PERMISSION_PENDING';
      throw error;
    }
    if (!bridge.startNativeRecording()) {
      const detail = String(bridge.nativeRecordingLastError?.() || 'AUDIORECORD_START');
      throw new Error(`O gravador nativo não iniciou (${detail}).`);
    }
    this.mode = 'android';
    this.startedAt = Date.now();
    return { platform: 'android', startedAt: this.startedAt };
  }

  async #startWeb() {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      throw new Error('Este navegador não oferece gravação de áudio compatível.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const mimeType = MIME_CANDIDATES.find((value) => MediaRecorder.isTypeSupported?.(value)) || '';
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 160_000 })
      : new MediaRecorder(stream);
    this.mode = 'web';
    this.stream = stream;
    this.recorder = recorder;
    this.chunks = [];
    this.startedAt = Date.now();
    recorder.ondataavailable = (event) => { if (event.data?.size) this.chunks.push(event.data); };
    recorder.start(250);
    return { platform: 'web', startedAt: this.startedAt, mimeType: recorder.mimeType };
  }

  async #stopAndroid() {
    const bridge = globalThis.PabloVoiceAndroid;
    if (!bridge.stopNativeRecording()) {
      const detail = String(bridge.nativeRecordingLastError?.() || 'AUDIORECORD_STOP');
      bridge.clearNativeRecording();
      this.#reset();
      throw new Error(`O gravador nativo não finalizou (${detail}).`);
    }
    const size = Number(bridge.nativeRecordingSize());
    if (!Number.isFinite(size) || size <= 44) throw new Error('A gravação ficou vazia.');
    const bytes = new Uint8Array(size);
    const chunkSize = 48 * 1024;
    for (let offset = 0; offset < size; offset += chunkSize) {
      const encoded = bridge.nativeRecordingChunkBase64(offset, Math.min(chunkSize, size - offset));
      if (!encoded) throw new Error('Falha ao transferir a gravação nativa.');
      const binary = atob(encoded);
      for (let index = 0; index < binary.length; index += 1) bytes[offset + index] = binary.charCodeAt(index);
    }
    bridge.clearNativeRecording();
    this.#reset();
    return new Blob([bytes], { type: 'audio/wav' });
  }

  #stopWeb() {
    const recorder = this.recorder;
    const stream = this.stream;
    return new Promise((resolve, reject) => {
      recorder.onerror = (event) => reject(event.error || new Error('Erro durante a gravação.'));
      recorder.onstop = () => {
        stream?.getTracks().forEach((track) => track.stop());
        const chunks = [...this.chunks];
        const type = chunks[0]?.type || recorder.mimeType || 'audio/webm';
        const cancelled = this.cancelled;
        this.#reset();
        if (cancelled) return reject(new Error('Gravação cancelada.'));
        if (!chunks.length) return reject(new Error('A gravação ficou vazia.'));
        resolve(new Blob(chunks, { type }));
      };
      try { recorder.requestData(); recorder.stop(); }
      catch (error) { reject(error); }
    });
  }

  #reset() {
    this.mode = null;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
  }
}

