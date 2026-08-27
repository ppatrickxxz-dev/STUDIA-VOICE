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

## What is still pending

The newly canonical standalone route:

`create-kaggle-ticket(job_type=stems) -> worker -> complete-kaggle-stems-job`

has not yet produced a completed standalone `render_jobs.job_type='stems'` row. Therefore the engine is evidence-backed, but the new standalone transport remains hidden from product promotion until its own canary completes.

This distinction is intentional: engine validation is not the same as route validation.
