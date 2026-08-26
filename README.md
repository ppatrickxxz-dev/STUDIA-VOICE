# PabloVoice

PabloVoice is a local-first audio studio delivered from one canonical source to the Web and Android. The shared application lives in `packages/`; Android adds native recording, file, and lifecycle adapters without loading a remote wrapper.

## Local verification

```bash
npm run test:all
```

Serve `apps/web/dist` over HTTP after the build. Browser microphone capture requires a secure context (`https` or localhost).

## Repository layout

- `packages/app`: responsive PabloVoice product shell and browser adapters
- `packages/core`: versioned project model
- `packages/audio`: audio presets and WAV utilities
- `packages/songwriting`: deterministic PT-BR rhyme, meter, and prosody analysis
- `apps/web`: generated Web output
- `apps/android`: local Android host and native adapters
- `services/api`: optional cloud contracts; the local studio does not depend on them
- `tests`: unit, contract, regression, and gate scripts
- `docs`: inventory, architecture, test evidence, release, and operations

AI generation, source separation, and voice conversion are capability-gated. The interface never presents those as working unless a real provider is configured and healthy.

