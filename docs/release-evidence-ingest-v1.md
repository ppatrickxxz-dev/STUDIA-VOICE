# Release Evidence Ingest v1

## Purpose

Materialize release-frozen binary evidence into PabloVoice private runtime storage without substituting bytes, weakening frozen contracts, or writing directly to `storage.objects`.

This path exists for release evidence that has already been staged in the private `benchmark_binary_transport_sessions` / `benchmark_binary_transport_chunks` transport tables. It is not a general anonymous upload API and it is not a user-facing recording path.

## Authentication

The Edge Function validates a GitHub Actions OIDC token cryptographically against GitHub's JWKS and requires all of the following claims:

- audience: `pablovoice-signing`
- repository: `ppatrickxxz-dev/STUDIA-VOICE`
- ref: `refs/heads/main`
- workflow ref: `.github/workflows/materialize-frozen-release-evidence.yml@refs/heads/main`
- event: `workflow_dispatch` or `push`

No repository, Supabase service-role, Kaggle, or provider secret is stored in the workflow.

## Frozen vocal contract

The only accepted artifacts are:

| Role | Name | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| Canonical source | `voz.wav` | `852890854c128a4ee222505a910c3dc01465579d34ed6b49b5019aec8f16ad83` | 13,909,412 |
| Provider input | `vocal_provider_input.wav` | `5d02cef6ddb423f95485f2f202dba0c1634ab7a001307743f631f5078a2f1439` | 15,335,120 |

The provider input is bound to the deterministic derivation:

```text
ffmpeg -hide_banner -loglevel error -i voz.wav -vn -ac 1 -ar 44100 -c:a pcm_s16le
```

The frozen provider bytes were regenerated from the exact canonical source with FFmpeg 6.1.1 (`libavformat 60.16.100`, `libswresample 4.12.100`). The earlier `85b634...` digest could not be reproduced from the retained source by FFmpeg 4.2.2, 4.4.1, 4.4.2, or 6.1.1 and had no retained binary payload. Benchmark v1 therefore binds to the reproducible 6.1.1 output above; the canonical source digest remains unchanged.

## Fail-closed sequence

For each artifact the runtime must:

1. find an unconsumed, non-expired transport session for the exact project and SHA;
2. validate expected filename, MIME type, size, and chunk count;
3. require contiguous chunk indexes starting at zero;
4. decode and concatenate all chunks;
5. require exact byte count;
6. calculate SHA-256 over the reconstructed bytes and require exact equality;
7. upload the exact verified bytes to private storage;
8. insert `audio_assets` provenance with `runtime_addressable=true` and `verified_sha256=true`;
9. mark the transport session consumed;
10. remove transport chunks only after persistence succeeds.

If an asset with the exact project/user/SHA already exists, the operation is idempotent and returns that asset after verifying its stored byte-size contract.

## Deployment slot

The current Supabase project is at its free-tier Edge Function count cap. `diagnose-once-v56` was already retired and returned HTTP 410. Its existing slot is retained to host Release Evidence Ingest v1 so the release does not add another function or incur a paid-plan dependency. The canonical source is versioned here; the old diagnostic behavior is intentionally retired.
