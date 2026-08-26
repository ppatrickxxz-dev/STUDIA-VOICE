# PMI Mastery Wave 5 — Cadence Correction Report

## Outcome
Wave 5 corrects the cadence failure preserved in v9.1.4 and promotes one competency from `MASTERY_CANDIDATE` to `MASTERED` in a deliberately narrow symbolic scope:

- `pitch_harmony:09` — analyze cadences.

Project state after promotion: **22 MASTERED / 4 MASTERY_CANDIDATE / 1496 STUDIED** out of **1522** atomic competencies.

The repository regression suite passes **174/174 tests** before packaging.

## Scope discipline
The active reasoner separates local/global tonal roles, carries applied cadential targets, requires explicit phrase closure, distinguishes authentic/half/deceptive families, supports evasion only with continuation evidence, and abstains when structural information is insufficient.

Final post-freeze held-out evaluation used all cadence-annotated rows in DCML Beethoven 24-2: **23/23 passed**. Five adversarial cases also passed, for **28/28 total external checks**.

`pitch_harmony:09` is promoted only for hierarchical symbolic cadence-family reasoning over explicit phrase closure, DCML local/applied tonal context, and calibrated uncertainty. This does **not** imply real-audio cadence perception, stylistic universality, automatic score-level PAC/IAC analysis without necessary cues, or human music-theory proficiency.

## Remaining MASTERY_CANDIDATE competencies
- `songwriting:05` — align lyric stress to musical stress
- `songwriting:07` — preserve authorial voice
- `songwriting:08` — rewrite minimally under metric constraint
- `voice:11` — preserve identity through correction

These remain blocked from artificial promotion and require appropriate real material and/or blind human evaluation.

## Historical evidence policy
Previous failed calibration is preserved rather than rewritten. Mastery evidence must retain freezes, negative results and scope limitations.
