import { PabloAudioEngine } from './audio-engine.mjs';
import { analyzeAudioBuffer, registerSourceAnalysis } from './analysis/src/analyzer.mjs';

const originalDecode = PabloAudioEngine.prototype.decode;

if (!PabloAudioEngine.prototype.__pvAnalysisWrapped) {
  Object.defineProperty(PabloAudioEngine.prototype, '__pvAnalysisWrapped', { value: true, configurable: false });
  PabloAudioEngine.prototype.decode = async function decodeWithAnalysis(trackId, blob) {
    const decoded = await originalDecode.call(this, trackId, blob);
    const analysis = analyzeAudioBuffer(decoded.buffer);
    registerSourceAnalysis(blob, analysis);
    return { ...decoded, analysis };
  };
}
