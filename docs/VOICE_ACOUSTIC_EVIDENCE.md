# Voice Acoustic Evidence Gate

This gate prevents PabloVoice from treating a successful remote render as proof of vocal quality or identity preservation.

## Evidence layers

1. **Technical quality** — peak/clipping and other measurable signal faults.
2. **Temporal fidelity** — only valid for aligned same-content comparisons; speech-vs-singing or different phrases must not be scored as duration/pitch identity drift.
3. **Timbre/formants** — median formant drift when formant evidence exists.
4. **Speaker identity** — requires a speaker-embedding similarity measurement. If no embedding exists, identity is `missing`, not inferred from pitch or spectral brightness.

## Promotion rule

A Voice Lab result is not promotable as identity-preserving unless technical quality passes, available temporal/timbre gates pass, and speaker identity evidence passes. Missing speaker-identity evidence fails closed with `identity_evidence_pending`.

`PROVISIONAL_VOICE_EVIDENCE_POLICY` contains conservative engineering defaults only. They are not a mastery benchmark and must be recalibrated from retained blind/acoustic evaluations before becoming release thresholds.

## Privacy

User reference recordings and biometric-like measurements must not be committed to the public repository. The repository stores the generic evaluator and evidence contract; user-specific evidence belongs in private runtime/evaluation storage.

## Important non-claims

- Pitch similarity alone is not speaker identity.
- A render completing successfully is not acoustic validation.
- Speech and singing distributions are not directly interchangeable.
- `Natural`, `Identity`, and `Smooth` may eventually use profile-specific policies, but those thresholds require real retained evidence first.
