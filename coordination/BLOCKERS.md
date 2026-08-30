# PabloVoice Blockers

Only blockers that affect cross-module coordination belong here.

## P0

### Android physical-device gate

Status: OPEN.

The signed release and emulator evidence for the current main SHA passed, but they do not replace the required physical-device validation. The Android delta pass must cover at minimum install/open, refresh, upload, microphone, playback/export, keyboard, background/foreground and navigation on a real device.

### B09 standalone stems route

Status: CANDIDATE / NOT YET ROUTE-VALIDATED.

Demucs `htdemucs` has historical verified E2E engine evidence, and the current ticket/dispatcher/worker/callback chain is implemented/deployed. The current standalone route still requires an authenticated canary that produces two persisted stems with reconciled hashes/provenance before `routeValidated=true`.

## P1

### Advanced Voice Lab recovery

Status: OPEN.

Current canonical runtime has local WebAudio treatment, but advanced conversion/naturalness capabilities from historical RVC/Applio work are not yet fully migrated and validated behind current provider contracts.

### Breath / Alignment Intelligence

Status: BLOCKED BY ANALYZERS / VOICE PIPELINE.

Requires real breath/alignment measurements integrated through Audio Analysis Bus and Voice Lab; do not simulate these values.

### Mix Intelligence Graph

Status: PLANNED.

Requires shared measured analysis and defined graph/decision contracts before UI recommendations can be called intelligent mix analysis.

## P2

### Instrument Lab recovery

Status: RECOVERY-CANDIDATE.

Historical WebAudio/MIDI/render implementation exists but must be migrated into current Project/Audio Core and pass current gates.

### Podcast Cleanup recovery

Status: RECOVERY-CANDIDATE.

Historical silence analysis/preview/persistence exists. ASR and final export remain separate validation gaps.

### Video Audio recovery

Status: RECOVERY-CANDIDATE.

Historical remux evidence exists; current canonical integration and end-to-end product flow still require migration and regression gates.

## Coordination blocker rule

A parallel chat must not resolve a blocker by renaming it, hiding it, changing thresholds after a failed test or marking it complete without new evidence. If evidence changes, update `MASTER_STATE.json` and record the promotion in `DECISION_LOG.md`.
