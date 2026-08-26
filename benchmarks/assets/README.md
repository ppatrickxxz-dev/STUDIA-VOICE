# PabloVoice Benchmark v1 — Frozen Reference Pack

This directory contains the frozen, text-addressable inputs for the benchmark.

## Frozen now
- `frozen-lyrics.txt`
- `frozen-brief.json`
- `edit-regions.json`

## Binary assets still required before any acoustic gate can pass
- `reference-vocal.wav`
- `reference-mix.wav`
- `reference-instrumental.wav`

The benchmark MUST remain `audio-pending` until all three binary files are present and SHA-256 hashes are recorded before provider generation begins.

## Voice reference rule
Use one clean, consented reference vocal from the canonical PabloVoice voice dataset/model lineage. Do not change the reference between providers. Do not denoise, retune or otherwise improve one provider's input differently from another provider's input.

## Freeze rule
After the first provider output is generated, do not alter lyrics, BPM, key, edit regions, hard-gate thresholds, reference audio, scoring schema or reviewer instructions for that benchmark round. Any change requires a new benchmark version.
