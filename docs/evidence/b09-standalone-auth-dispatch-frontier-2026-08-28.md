# B09 standalone stems — authenticated dispatch frontier

Date: 2026-08-28

This note records only evidence revalidated against the current repository and live Supabase project. It does not mark B09 as passed and does not claim physical Android validation.

## PR #29 gate evidence

Head `399b66ba592f08dca7d0566d7af44efd272664c8` has exactly four GitHub Actions check runs relevant to the canonical gate set, all `completed` / `success`:

- `web-and-contracts`
- `browser-gate`
- `android-build`
- `android-emulator`

The independent Vercel status failure on that commit is a free-tier deployment quota (`api-deployments-free-per-day`), not one of the four canonical gates.

## Safe promotion state

PR #29 itself was not merged. Its safe current-main successor PR #37 (`Reconcile B09 stems canary onto current main safely`) was merged as `2d5585ccbb2fba364f362659e68f0b36ed7053c9`. It fixes the two P1 issues identified during review and explicitly keeps `routeValidated=false` until standalone evidence exists.

PR #111 (`docs: record live B09 standalone readiness evidence`) was later merged as `4142958f8040729698435e7c3495ce6b44545dfd`, preserving the same evidence boundary.

## Live backend readiness revalidation

The active Supabase project currently reports these B09 functions as `ACTIVE`:

- `compute-kaggle-v54` v3
- `kaggle-worker-source-v56` v3
- `complete-kaggle-stems-job` v1
- `recording-ticket-v63` v4
- `recording-finalize-v63` v5

The database still contains zero rows in `public.render_jobs` where `job_type='stems'`.

A real source asset suitable for an authenticated canary is already persisted in the canonical project: asset `a5bc5f31-a546-4ded-99fb-9a0867980202`, `kind='source'`, SHA-256 `ff57cb304fbe72783b78ab5f43137cd3daba2736e76135d86beb0e1f8f0e6e2d`. The same source has already produced verified Demucs outputs inside completed `full_pipeline` jobs, proving the separation engine independently of the standalone route.

## Current evidence boundary

The remaining B09 blocker is no longer source availability, Demucs engine proof, deployed worker availability, or callback deployment. It is execution of the **authenticated standalone dispatch path itself** through the promoted Studio candidate.

Do not create a `stems` row manually and do not bypass the authenticated client path, because that would not validate the route being tested.

The next terminal evidence must be a naturally created `public.render_jobs` row with:

- `job_type='stems'`
- `status='completed'`
- `proof.verified=true`
- two persisted output asset IDs for vocal and instrumental
- distinct source / vocal / instrumental SHA-256 values

Until that evidence exists:

- `routeValidated=false`
- B09 = pending
- no physical Android approval is claimed
