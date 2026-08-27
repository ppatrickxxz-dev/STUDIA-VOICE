# Supabase function aliases

The PabloVoice Supabase project currently sits at the free-tier Edge Function count limit. Creating new slugs for the standalone stems route was rejected by the platform.

To preserve the free tier without deleting active functions, two superseded slugs are reused as deployment aliases for the canonical standalone stems implementation:

- Canonical dispatcher source: `supabase/functions/compute-kaggle-stems/index.ts`
  - Production alias: `compute-kaggle-v54`
  - `verify_jwt=true`
- Canonical worker source: `supabase/functions/kaggle-stems-worker/index.ts`
  - Production alias: `kaggle-worker-source-v56`
  - `verify_jwt=false` intentionally; it serves only ticket-scoped worker source and carries no service-role credential.

The current runtime client defaults to `compute-kaggle-v54` but accepts a configurable `dispatcherSlug`. When the Supabase function-count limit is removed, deploy the canonical slugs and switch the runtime alias without changing the StemEngine contract.

This aliasing does not validate the route. B09 remains `routeValidated=false` until a live authenticated dispatch produces a completed `stems` render job and persists distinct `guide_vocal` and `instrumental` assets through the canonical callback.
