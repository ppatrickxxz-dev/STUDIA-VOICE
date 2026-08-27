# PabloVoice — Android physical gate 2026-08-27

Evidence source: physical Android screenshots supplied by the product owner after installing the current Unified AI candidate.

## Confirmed on physical Android

- Application package opened successfully after removing the prior conflicting debug-signed installation.
- Native microphone permission was granted.
- Native recording started and stopped successfully.
- Recorded audio entered the Studio and produced a waveform.
- Playback transport advanced through the recorded clip.
- Non-destructive Edit UI rendered and accepted trim/fade/gain controls.
- Voice Lab local treatment controls rendered.
- Mixer rendered the recorded track with gain/pan/mute/solo controls.
- Export surface rendered with WAV presets.
- Compose textarea accepted keyboard input on Android.
- Pablo conversation surface rendered.

## Physical failures / blockers captured

1. Pablo does not route the natural-language request “Criar música” into the Composer flow and answers that no safe action is available.
2. Remote generative AI remains GATED in the capability table.
3. Voice conversion remains GATED because the Android installation has no usable PabloVoice remote session.
4. Stem separation remains CANDIDATE and is not yet route-validated.
5. The Studio can emit “Nenhuma faixa audível foi carregada” even though the current project visibly contains a decoded recording. Playback must self-rehydrate missing buffers from IndexedDB before failing.
6. The advanced AI modules currently resolve `listProjects()[0]` instead of a guaranteed active-project identity; this must not be allowed to target the wrong project.
7. User-facing Android builds must not be distributed from ephemeral debug keystores. Stable signing work is tracked separately in PR #45.

## Gate truth

This evidence proves important physical Android functionality, but it is **not** `FUNCTIONAL GATE PASSED` yet. The blockers above must be corrected and then re-tested on the same physical-device path.
