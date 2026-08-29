# B09 — Source separation status

## Current truth

The standalone stems route has now executed successfully in production with a legitimate user session and a real Kaggle/Demucs provider run.

Canonical standalone job:

- `render_jobs.id`: `81a17053-5789-4cf1-9ba5-21c665f3b8cb`
- `job_type`: `stems`
- `provider`: `kaggle`
- `external_job_id`: `132461854`
- `engine`: `kaggle_ticketed`
- `proof.engine`: `Demucs`
- `proof.model`: `htdemucs`
- `proof.demucs_version`: `4.0.1`
- `status`: `completed`
- `progress`: `100`
- `proof.verified`: `true`
- `finished_at`: `2026-08-29T14:10:16.740Z`

The job used the frozen source asset `a5bc5f31-a546-4ded-99fb-9a0867980202`, SHA-256 `ff57cb304fbe72783b78ab5f43137cd3daba2736e76135d86beb0e1f8f0e6e2d`.

It persisted two independent private WAV outputs in `audio-private`:

- `guide_vocal`
  - asset id `1148fc38-e2ed-4925-9dec-f843c02163d2`
  - size `32,627,022` bytes
  - SHA-256 `1180440960ee1e0288509960763aa1e646ca5689c1d657de914617bbb4c95708`
- `instrumental`
  - asset id `9bef8c45-40af-4134-b816-4d135cb574e8`
  - size `32,627,022` bytes
  - SHA-256 `db2c5ee693934133a40ab9b561bd601377c50c72bc6c3c863db30e294c2625d3`

All three source/vocal/instrumental SHA-256 values are distinct. Both output IDs are the exact `render_jobs.output_asset_ids`, both assets belong to the frozen project, both point back to the same source asset, and both record `Demucs` / `htdemucs` / `4.0.1` provenance.

## Authenticated execution evidence

GitHub Actions run `33256818152` (`B09 standalone stems live canary`) completed successfully. Its steps independently proved:

1. GitHub OIDC-backed PabloVoice user session acquisition;
2. real standalone dispatch through `compute-kaggle-v54`;
3. provider wait through the callback boundary;
4. completed `render_jobs` retrieval through user RLS;
5. exact two output assets retrieval through user RLS;
6. retained standalone evidence artifact upload.

Retained workflow artifact:

- `b09-standalone-evidence-cdf6f4413ba5d23dbe769af4e951da0d4206754c`
- artifact id `9716071373`
- digest `sha256:e9e80352233b513309195b2a946f9b0f859d8ef7262a1c9c908da1d110da0efa`
- retention expiry `2026-09-28T14:10:27Z`

## What is validated now

- real authenticated standalone user path: **validated**
- real standalone `render_jobs.job_type='stems'`: **validated**
- real Kaggle dispatch: **validated**
- real Demucs `4.0.1` / `htdemucs` execution: **validated**
- callback completion: **validated**
- private storage persistence: **validated**
- independent `guide_vocal` + `instrumental` output assets: **validated**
- source/output SHA-256 proof chain: **validated**
- exact output IDs resolving through user RLS: **validated**
- retained machine evidence: **validated**

The six terminal standalone route criteria previously frozen in this document are therefore satisfied. The standalone route itself is no longer blocked.

## Acoustic benchmark gate still pending

This route validation is not being promoted to `B09_STANDALONE_STEMS_PASSED` yet because the frozen acoustic benchmark has a separate, explicit input gate.

`benchmarks/assets/binary-reference-manifest.json` currently declares:

- `state: runtime-asset-blocked`
- `gate.acoustic_benchmark_runnable: false`

The exact blocker is the frozen `vocal_provider_input`:

- expected SHA-256 `85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95`
- expected size `15,335,120` bytes
- expected format `pcm_s16le`, `44,100 Hz`, mono
- expected duration `173.866689 s`
- `asset_id: null`
- `runtime_addressable: false`

A live database/storage inspection after the standalone run found no registered private asset matching either that exact provider-input SHA-256 or its canonical source SHA-256. Therefore the missing reference cannot be replaced by an older full-pipeline stem, approximated from another recording, or silently regenerated with unknown bytes.

To open the final acoustic gate, ingest the exact frozen bytes, verify SHA-256 `85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95`, register the resulting private asset id in the frozen manifest, and only then execute B09 `stem_isolation`, `leakage`, `phase_integrity`, and `reconstruction_similarity` measurements.

No threshold has been invented or changed after the run.

## Classification

- standalone route: **VALIDATED**
- B09 acoustic benchmark: **BLOCKED_BY_FROZEN_REFERENCE_ASSET**
- `B09_STANDALONE_STEMS_PASSED`: **not declared yet**

This distinction is intentional: a real route PASS is necessary evidence, but it does not substitute for the frozen acoustic benchmark.
