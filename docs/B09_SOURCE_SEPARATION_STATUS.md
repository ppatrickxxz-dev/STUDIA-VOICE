# B09 — Source separation status

## Current truth

Demucs `htdemucs` is no longer an unproven engine in PabloVoice. The live Supabase database contains five completed `full_pipeline` jobs with `proof.verified=true` and the chain `demucs_htdemucs -> applio_rvc_natural -> ffmpeg_mix_v4_1 -> qa`.

The latest verified job persisted two real lossless stem assets:

- `guide_vocal`: 16,670,393 bytes, SHA-256 `7a5e7f293f4b856a1035390dc87dfff27434e0806e20a4e42391d3fff9656499`
- `instrumental`: 15,893,538 bytes, SHA-256 `163c1cb9cbeb0fe17ad69ca9166f264bbead646e91671fdbe3c7d980ac6d983b`

Both assets declare `engine=Demucs`, `model=htdemucs`, and point to the same source asset. The job records Demucs version `4.0.1` and QA passed.

## What this validates

- real Demucs execution: **validated**
- real vocal/instrumental output persistence: **validated**
- SHA-256 proof chain: **validated**
- lossless stem asset creation: **validated**
- repeated execution evidence: **validated** (5 completed full-pipeline jobs observed)

## Standalone candidate readiness

The original candidate from PR #29 passed the four canonical repository gates on its final head:

- `web-and-contracts`: **success**
- `browser-gate`: **success**
- `android-build`: **success**
- `android-emulator`: **success**

PR #29 itself was not merged because review found route-safety defects. Its corrected current-main successor, PR #37, was merged as commit `2d5585ccbb2fba364f362659e68f0b36ed7053c9`.

A fresh live Supabase inspection on 2026-08-28 verified the deployed standalone path up to the live-canary boundary:

- project `yokmhqoncdwvxmzzybqa`: `ACTIVE_HEALTHY`
- `compute-kaggle-v54` version 3: `ACTIVE`, JWT required, dispatches `job_type='stems'` and records `compute-kaggle-v54:standalone-stems-v1`
- dispatcher resolves worker `kaggle-worker-source-v56`
- `kaggle-worker-source-v56` version 3: `ACTIVE`, installs Demucs `4.0.1`, runs `htdemucs --two-stems=vocals`, verifies source SHA-256 and rejects identical/tiny outputs
- `complete-kaggle-stems-job` version 1: `ACTIVE`, requires three distinct SHA-256 proofs, verifies both uploaded objects exist, persists independent `guide_vocal` and `instrumental` assets, and only then completes the job

Canonical machine-readable evidence: `docs/B09_STANDALONE_READINESS_EVIDENCE_2026-08-28.json`.

## What is still pending

The canonical standalone route:

`recording-ticket-v63 source_import -> recording-finalize-v63 -> create-kaggle-ticket(job_type=stems) -> compute-kaggle-v54 -> kaggle-worker-source-v56 -> complete-kaggle-stems-job`

still has no completed standalone `render_jobs.job_type='stems'` row in the live database.

The next terminal evidence for B09 is therefore exactly one live completed standalone stems job with:

1. `job_type='stems'`;
2. `proof.verified=true`;
3. two independent persisted output assets (`guide_vocal` and `instrumental`);
4. distinct source/vocal/instrumental SHA-256 values;
5. non-trivial output sizes;
6. the job's two `output_asset_ids` resolving to those persisted assets.

Until that row exists, `routeValidated` remains false and B09 remains **not passed**.

No physical Android approval is implied by CI or emulator evidence.

This distinction is intentional: engine validation and route readiness are not the same as standalone route validation.
