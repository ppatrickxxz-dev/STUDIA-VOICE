# PabloVoice — QA Gates

## Release principle
Compilation, syntax checks, preview HTTP 200, smoke rendering and generated APK/AAB are necessary evidence but never sufficient proof of a working product.

## Functional Gate
`FUNCTIONAL GATE PASSED` may be declared only when all critical paths below have platform-relevant evidence.

### Render/retry
- Historical render errors classified with root-cause disposition.
- No current unexplained critical errors.
- Transient retry is selective, bounded and idempotent.
- Permanent errors do not loop.
- Job state includes status/progress/timestamps/heartbeat/error/attempt.
- UI progress reflects real stages, never invented percentages.

### Upload/persistence
- Android physical file picker works.
- Upload ticket -> object upload -> finalize -> persistent asset/take/project state is confirmed.
- Small files pass.
- Files above ~6 MiB receive a reliable strategy (resumable/TUS where appropriate) and a physical stress test.
- Refresh/reopen preserves committed work without duplication.

### Android lifecycle
- Open/startup.
- Login/session restore.
- Refresh.
- File picker and picker cancel.
- Microphone permission + real recording.
- Playback and download/export.
- Keyboard/input behavior.
- Background/foreground short and extended cases.
- Navigation across critical routes.
- Reopen after process/app lifecycle change.

### Desktop/Web
- Critical routes and project flows pass.
- No uncaught critical JavaScript/API errors.
- No P0/P1 overflow/duplication/navigation defects.
- Import/record/play/edit/save/reopen/export operate on real data.

### Security/observability
- No privileged/service-role secret in client distribution.
- Private assets remain private by contract.
- Render/upload IDs and logs are persisted sufficiently for RCA.
- Candidate and production environments remain distinguishable.

## Current recovered status (2026-08-26)
- Modular checks: evidence exists for 8.0.x candidates.
- Android physical validation: NOT VERIFIED/PASSED.
- Instrument authenticated physical E2E: NOT VERIFIED/PASSED in recovered 8.0.4 evidence.
- Remote LLM/provider: NOT VERIFIED CONFIGURED in recovered manifests.
- Motion Review 2: PENDING.
- Production promotion: BLOCKED.

## Promotion order
1. recover/version source;
2. reproducible build;
3. render/retry and observability;
4. upload/persistence;
5. Android physical lifecycle;
6. desktop regression;
7. freeze functional build;
8. Motion Review 2;
9. production promotion.
