const REQUIRED_OUTPUTS = Object.freeze({
  '2stem': ['vocals', 'instrumental'],
  '4stem': ['vocals', 'drums', 'bass', 'other'],
});

export class StemEngineRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    validateProvider(provider);
    this.providers.set(provider.id, Object.freeze({ ...provider }));
    return this;
  }

  get(id) {
    return this.providers.get(id) || null;
  }

  list({ includeUnavailable = true } = {}) {
    return [...this.providers.values()].filter((provider) => includeUnavailable || isPromotable(provider));
  }

  select({ mode = '2stem', prefer = [] } = {}) {
    const required = REQUIRED_OUTPUTS[mode];
    if (!required) throw new Error(`Unsupported stem mode: ${mode}`);

    const candidates = this.list({ includeUnavailable: false })
      .filter((provider) => provider.outputs?.[mode] === true)
      .sort((a, b) => scoreProvider(b, prefer) - scoreProvider(a, prefer));

    return candidates[0] || null;
  }

  capabilitySnapshot() {
    return this.list().map((provider) => ({
      id: provider.id,
      family: provider.family,
      available: provider.available === true,
      validated: provider.validated === true,
      promotable: isPromotable(provider),
      outputs: { ...(provider.outputs || {}) },
      model: provider.model || null,
      version: provider.version || null,
    }));
  }
}

export function isPromotable(provider) {
  return provider?.available === true && provider?.validated === true && typeof provider?.separate === 'function';
}

export function defaultStemRegistry() {
  return new StemEngineRegistry()
    .register({
      id: 'demucs',
      family: 'demucs',
      available: false,
      validated: false,
      outputs: { '2stem': true, '4stem': true },
      model: null,
      version: null,
      separate: null,
      note: 'Canonical fallback candidate. Must remain hidden until a real worker/provider is connected and validated.',
    })
    .register({
      id: 'mdx',
      family: 'mdx-mdxc',
      available: false,
      validated: false,
      outputs: { '2stem': true, '4stem': false },
      model: null,
      version: null,
      separate: null,
    })
    .register({
      id: 'roformer',
      family: 'roformer',
      available: false,
      validated: false,
      outputs: { '2stem': true, '4stem': false },
      model: null,
      version: null,
      separate: null,
    });
}

export function validateStemResult(result, mode = '2stem') {
  const required = REQUIRED_OUTPUTS[mode];
  if (!required) throw new Error(`Unsupported stem mode: ${mode}`);
  if (!result || typeof result !== 'object') throw new TypeError('Stem result must be an object.');

  for (const stem of required) {
    const value = result[stem];
    if (!value) throw new Error(`Missing required stem: ${stem}`);
  }

  return true;
}

function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new TypeError('Provider must be an object.');
  if (!provider.id || !provider.family) throw new Error('Provider id and family are required.');
  if (!provider.outputs || typeof provider.outputs !== 'object') throw new Error('Provider outputs are required.');
  if ((provider.available === true || provider.validated === true) && typeof provider.separate !== 'function') {
    throw new Error('A provider cannot be available/validated without a real separate() implementation.');
  }
}

function scoreProvider(provider, prefer) {
  const preference = prefer.indexOf(provider.id);
  const preferenceScore = preference === -1 ? 0 : (prefer.length - preference) * 10;
  const validationScore = provider.validated === true ? 100 : 0;
  return validationScore + preferenceScore;
}
