# PabloVoice Benchmark v1 — Frozen Reference Pack

This directory contains the frozen, text-addressable inputs and metadata for the benchmark. Binary benchmark audio is intentionally **not** committed to the public repository.

## Frozen text inputs
- `frozen-lyrics.txt`
- `frozen-brief.json`
- `edit-regions.json`
- `binary-reference-manifest.json`

## Binary asset policy
The canonical audio fixtures live in private storage. The repository stores their immutable SHA-256 hashes, metadata, lineage and runtime asset identifiers only.

An acoustic benchmark is runnable only when every required binary fixture is both:

1. frozen by SHA-256 before execution; and
2. registered as a runtime-addressable private asset whose bytes can be retrieved by the authorized benchmark path.

A hash in the manifest by itself is **not** evidence that the binary is available to execute.

Current required runtime fixtures are:
- `vocal_provider_input`
- `reference_mix`
- `reference_instrumental`

If any required fixture lacks a runtime `asset_id`, the acoustic gate must remain blocked. Do not copy audio into the public repository to unblock it.

## Voice reference rule
Use the single clean, consented vocal frozen in `binary-reference-manifest.json`. Do not substitute another render, model output, complementary recording or historical benchmark artifact. Do not denoise, retune or otherwise improve one provider's input differently from another provider's input.

If the frozen provider input must be re-ingested, the resulting private asset is eligible only when its bytes reproduce the exact frozen SHA-256 recorded in the manifest.

## Freeze rule
After the first provider output is generated, do not alter lyrics, BPM, key, edit regions, hard-gate thresholds, reference audio, scoring schema or reviewer instructions for that benchmark round. Any such change requires a new benchmark version.
