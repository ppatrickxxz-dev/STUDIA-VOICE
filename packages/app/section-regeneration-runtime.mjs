import { MusicGenerationClient } from './music-generation-client.mjs';
import { NativeMusicGenerationClient } from './native-music-generation-client.mjs';

let nativeClient = null;
let legacyClient = null;

export async function executeSectionRegenerationRuntime(project, plan, {
  native = null,
  legacy = null,
  signal,
  onProgress = () => {},
} = {}) {
  if (!plan?.ok || !plan?.section?.id) return { ok: false, error: 'invalid_inpainting_plan', fallback_allowed: false };
  if (plan.sourceProvider === 'pablovoice_native_repaint' && plan.sourceAssetId) {
    const runtime = native || nativeClient || (nativeClient = new NativeMusicGenerationClient());
    return runtime.repaintSection({
      localProject: project,
      sourceAssetId: plan.sourceAssetId,
      durationMs: plan.durationMs,
      section: plan.section,
      signal,
      onProgress,
    });
  }
  if (plan.sourceSongId) {
    const runtime = legacy || legacyClient || (legacyClient = new MusicGenerationClient());
    return runtime.regenerateSection({
      localProject: project,
      sourceSongId: plan.sourceSongId,
      durationMs: plan.durationMs,
      section: plan.section,
      signal,
    });
  }
  return { ok: false, error: 'inpainting_source_missing', fallback_allowed: false };
}

export const SECTION_REGENERATION_RUNTIME_POLICY = Object.freeze({
  nativeFirst: true,
  nativeJobType: 'music_repaint',
  legacySongIdCompatibility: true,
  silentLocalFallback: false,
  preservesPreviousTake: true,
});
