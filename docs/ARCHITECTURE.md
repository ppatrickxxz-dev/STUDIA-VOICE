# PabloVoice — Canonical Architecture

## Top-level rule
Web and Android are two shells over one product core. Shared domain logic, project state, audio contracts and AI tool contracts should not diverge by platform unless a native platform constraint requires an adapter.

## Architecture

```text
PabloVoice
├── Product Shell
│   ├── Web/PWA
│   └── Android shell/adapters
├── Project Core
│   ├── Auth
│   ├── Projects / Versions
│   ├── Assets
│   ├── Tracks / Clips
│   ├── Undo / Redo
│   └── Render recipes / provenance
├── Audio Core
│   ├── Recorder / Import / Player
│   ├── Timeline / Waveform
│   ├── Audio Analysis Bus
│   ├── StemEngine
│   ├── Voice Lab
│   ├── Breath & Alignment Intelligence
│   ├── Audio-to-Instrument / Sampler
│   ├── Mix Intelligence Graph
│   └── Master / Export
├── Creative Intelligence
│   ├── Pablo AI
│   ├── Songwriting Engine
│   ├── Rhyme Intelligence
│   ├── Prosody Engine
│   ├── Authorial Voice Guard
│   ├── Arrangement Engine
│   └── Generator Adapter
├── Knowledge
│   └── PMI contextual retrieval
├── Provider Layer
│   ├── Stem providers
│   ├── Voice conversion providers
│   ├── GPU workers
│   ├── AI model providers
│   └── Codec/export adapters
└── Studio Life
    ├── Companion
    ├── Pocket / Room
    ├── Eras / Memories
    └── Cosmetics / pets
```

## Audio Analysis Bus
Calculate reusable analysis once per asset/version and persist it. Consumers should subscribe to common measurements rather than reimplement independent detectors.

Candidate shared fields include BPM, beat/downbeat positions, musical key, pitch/pitch contour, onsets, transients, amplitude/loudness, true peak, silence, clipping, sections, SNR/noise, sibilance, room/reverb estimates, dynamic range, pitch stability and confidence/provenance.

Consumers include Voice Lab, sampler, piano roll, harmonies, remix, alignment, arrangement, Mix Intelligence and Pablo AI.

## StemEngine
Demucs remains a valid provider/fallback until a replacement wins a controlled benchmark. The architecture must support provider interchange (Demucs, MDX/MDXC, RoFormer or later validated engines) without exposing impossible stem promises in the UI.

## Voice Lab
Non-destructive A/B states should cover Original / Guide / Converted / Treated / Mix. Processing may include pitch correction, timing, formant, denoise, de-essing, EQ, compression, harmonies, doubles, backing vocals, reverb and delay.

Adaptive voice conversion must aim to preserve timbre, attacks, consonants, breath, vibrato, dynamics and expression. Robotic/metallic output, broken consonants, over-tuning, formant drift and separation artifacts are diagnostics, not acceptable outcomes.

## Provider/reproducibility policy
Production jobs must record a technical recipe: provider/model version, commit/version where applicable, Torch/CUDA/Python/FFmpeg/worker version and relevant processing parameters. Avoid uncontrolled `latest` dependencies in production.

## Knowledge routing
PMI is a contextual knowledge service, not a separate academic UI. Retrieve only relevant knowledge; retain provenance; never present BPM, pitch, loudness or other measurements as measured unless produced by a real analysis tool.
