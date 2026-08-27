export const ENGINE_KINDS = Object.freeze({
  STEM: 'stem',
  VOICE_CONVERSION: 'voice_conversion',
  VOICE_CORRECTION: 'voice_correction',
  ALIGNMENT: 'alignment',
  SAMPLER: 'sampler',
  MIX_INTELLIGENCE: 'mix_intelligence',
  MASTER: 'master'
});

export function providerCapability({ kind, provider, version, available = false, validated = false, reason = null } = {}) {
  if (!Object.values(ENGINE_KINDS).includes(kind)) throw new Error(`Unknown engine kind: ${kind}`);
  if (!provider) throw new Error('provider is required');
  return {
    kind,
    provider,
    version: version || null,
    available: available === true,
    validated: validated === true,
    reason: reason || null
  };
}

export function canExposeCapability(capability) {
  return Boolean(capability?.available && capability?.validated);
}

export function technicalRecipe({ provider, providerVersion, model, modelVersion, runtime = {}, parameters = {} } = {}) {
  if (!provider) throw new Error('provider is required');
  return {
    provider,
    providerVersion: providerVersion || null,
    model: model || null,
    modelVersion: modelVersion || null,
    runtime: {
      commit: runtime.commit || null,
      python: runtime.python || null,
      torch: runtime.torch || null,
      cuda: runtime.cuda || null,
      ffmpeg: runtime.ffmpeg || null,
      worker: runtime.worker || null
    },
    parameters: structuredClone(parameters),
    createdAt: new Date().toISOString()
  };
}

export function assertProviderResult({ capability, recipe, output } = {}) {
  if (!canExposeCapability(capability)) throw new Error('Provider capability is not validated for product exposure');
  if (!recipe?.provider) throw new Error('Technical recipe is required');
  if (!output) throw new Error('Provider output is required');
  return true;
}
