# PabloVoice — Runtime Delta: recovered 8.1 lineage vs 2.4.0-rc.1

## Purpose
This document records only evidence-backed gaps between the recovered 8.x lineage and the current canonical source. It is not a claim that recovered candidate modules were production-ready.

## Present in canonical 2.4.0-rc.1
- local-first Web + Android shared source;
- versioned project core;
- real browser playback/render path;
- recording/import/storage adapters;
- PT-BR deterministic songwriting analysis;
- CI with Web build, Android APK validation and Android emulator gate;
- honest capability gating when providers are unavailable;
- per-track aligned render for stem export.

## Recovered capabilities not yet equivalent in canonical runtime
- shared persistent Audio Analysis Bus;
- provider-backed source separation (recovered lineage used Demucs contracts/pipeline);
- RVC/Applio voice conversion contracts and GPU fallback;
- Instrument Lab Web Audio/MIDI/render workflow;
- Podcast Cleanup analysis/preview/persistence;
- Video Audio treatment/remux workflow;
- PMI runtime retrieval/context integration;
- remote model/provider route;
- adaptive harmony/voice fidelity candidates.

## Migration rule
Do not paste the 8.1 self-contained runtime over the canonical source. Promote capability by capability into packages/services with tests, provenance and capability gates.

## Current migration wave
Audio Analysis Bus v1 creates a neutral shared schema, persistence/subscription contract and reproducible provider recipe/capability contract. It intentionally does not fabricate BPM, pitch, loudness, stem or voice measurements. Metrics remain null until produced by a real analyzer/provider.

## Next waves
1. connect Audio Analysis Bus to decoded/imported assets and project persistence;
2. add analyzer providers for cheap deterministic signal metrics first;
3. restore StemEngine provider contract and benchmark Demucs/alternatives;
4. restore Voice Lab provider contract without exposing conversion until E2E validated;
5. migrate Instrument Lab, Podcast Cleanup and Video Audio as isolated modules;
6. connect PMI/Pablo AI only after project/audio context contracts are stable;
7. execute Web + Android CI and physical-device gate before release promotion.
