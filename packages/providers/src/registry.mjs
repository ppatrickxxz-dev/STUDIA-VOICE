export const BENCHMARK_TEST_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`),
);

const capability = (mode, status, evidence, requirements = []) => Object.freeze({
  mode,
  status,
  evidence,
  requirements: Object.freeze([...requirements]),
});

export const PROVIDERS = Object.freeze({
  elevenmusic: Object.freeze({
    id: 'elevenmusic',
    label: 'ElevenLabs Music v2',
    transport: 'official_api',
    model: 'music_v2',
    auth: 'ELEVENLABS_API_KEY',
    capabilities: Object.freeze({
      B01: capability('api', 'ready', 'POST /v1/music with model_id=music_v2'),
      B02: capability('api', 'ready', 'Music v2 inpainting with AudioRefChunk + GenerationChunk'),
      B03: capability('api', 'ready', 'Music v2 inpainting can retain surrounding chunks and regenerate lyrics locally'),
      B04: capability('api', 'conditional', 'Compose accepts finetune_id; Music Finetunes can include vocal style', ['completed_music_v2_finetune']),
      B05: capability('api', 'ready', 'Music v2 supports multilingual vocal generation'),
      B06: capability('interactive', 'unsupported_api', 'Voice-to-Song exists in ElevenMusic product UI; no matching public API endpoint verified for exact-performance pitch correction'),
      B07: capability('api', 'conditional', 'Can generate harmony-oriented chunks, but no dedicated harmony endpoint verified', ['benchmark_prompt_protocol']),
      B08: capability('api', 'ready', 'Composition plans, conditioning_ref and inpainting support arrangement changes'),
      B09: capability('api', 'ready', 'POST /v1/music/stem-separation with two- or six-stem variants'),
      B10: capability('adapter', 'ready', 'PabloVoice translates natural-language edits into Music v2 composition-plan operations'),
      B11: capability('api', 'ready', 'Stored songs + AudioRefChunk allow unchanged regions across repeated local edits'),
      B12: capability('api', 'ready', 'Music endpoints return explicit output formats; stems return an aligned ZIP archive'),
    }),
  }),

  suno: Object.freeze({
    id: 'suno',
    label: 'Suno / Studio 2.0',
    transport: 'interactive_manual',
    model: 'current_account_model',
    auth: null,
    capabilities: Object.freeze({
      B01: capability('interactive', 'ready_manual', 'Suno Create / Studio generation'),
      B02: capability('interactive', 'ready_manual', 'Official Replace Section workflow'),
      B03: capability('interactive', 'ready_manual', 'Official Edit Lyrics / Replace Section workflow'),
      B04: capability('interactive', 'manual_only', 'Voice-related controls are product features; no official public API verified'),
      B05: capability('interactive', 'ready_manual', 'Generate and review PT-BR vocals in product UI'),
      B06: capability('interactive', 'manual_only', 'Studio audio clip pitch/formant controls; no official pitch-correction API verified'),
      B07: capability('interactive', 'manual_only', 'Studio Chat can generate vocals/parts; must be evaluated interactively'),
      B08: capability('interactive', 'ready_manual', 'Studio Chat, clips, MIDI and generative replacement support arrangement edits'),
      B09: capability('interactive', 'ready_manual', 'Advanced Stem Separation / Split from Mix'),
      B10: capability('interactive', 'ready_manual', 'Studio 2.0 Chat Bar accepts natural-language editing requests'),
      B11: capability('interactive', 'ready_manual', 'Take Lanes and Replace Section preserve originals non-destructively'),
      B12: capability('interactive', 'ready_manual', 'Studio exports full song/range/multitrack and individual stems'),
    }),
  }),

  pablovoice: Object.freeze({
    id: 'pablovoice',
    label: 'PabloVoice native runtime',
    transport: 'internal_runtime',
    model: 'frozen_runtime',
    auth: null,
    capabilities: Object.freeze(Object.fromEntries(
      BENCHMARK_TEST_IDS.map((testId) => [
        testId,
        capability('internal', 'benchmark_target', 'Must be proven by Benchmark v1; capability is not pre-awarded'),
      ]),
    )),
  }),
});

export function getProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  return provider;
}

export function assertProviderMatrix() {
  for (const provider of Object.values(PROVIDERS)) {
    const ids = Object.keys(provider.capabilities).sort();
    const expected = [...BENCHMARK_TEST_IDS].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error(`${provider.id} capability matrix must cover B01-B12 exactly`);
    }
  }
  return true;
}
