# PabloVoice — Future Editing Architecture Base

Status: approved architectural base for a future PabloVoice update. This document does not redefine the current stable runtime and must be implemented incrementally over the existing canonical core.

## Purpose

Evolve PabloVoice from a set of isolated audio/AI tools into a project-state editing system where music can be understood, changed locally, previewed, compared, reverted and continued through conversation without destroying previously accepted work.

The implementation must preserve the existing canonical rules:

- Web and Android share one product core.
- Existing validated regional audio operations are migrated, not rewritten in parallel.
- Providers remain interchangeable.
- A capability is not considered complete without evidence.
- Unsupported or low-confidence AI actions fail closed or require review.

## Target architecture

```text
                    ┌─ Audio Analysis Bus v2
                    │
PROJECT STATE ──────┼─ Tracks / Clips / Regions
                    │        └─ Mix Intelligence Graph
                    │
                    ├─ Sections
                    │    └─ Takes / Variants
                    │
                    ├─ Lyrics / Composition / PMI
                    │
                    └─ Action Ledger / Provenance
                              ▲
                              │
                       PABLO ACTION ENGINE
                              │
                    ┌─────────┴─────────┐
                    │                   │
               Local processors     Providers
                    │                   │
                    └──── Result/Take ──┘
```

Pablo AI is not the final step of a fixed pipeline. Pablo observes project state, resolves a target, proposes a typed action and executes that action as a reversible transaction.

## 1. Audio Analysis Bus v2 end-to-end

The v2 analysis contract becomes the canonical representation consumed by higher-level intelligence.

Required shared evidence includes, when genuinely measured:

- BPM / tempo map / beats / downbeats;
- key / scale / note events;
- onsets / transients;
- peak / true peak / RMS / LUFS / dynamic range;
- spectral envelope;
- stereo / phase correlation;
- pitch contour / range / stability;
- voiced and unvoiced regions;
- formants;
- SNR / room-reverb estimate;
- sibilance and breath events;
- section/segment information;
- confidence, validity and provenance.

### Integration requirement

No consumer may depend on a v2 feature that the live analysis path silently drops. The runtime, adapters, persistence and consumers must be tested end-to-end for each promoted feature.

The first explicit closure target is ensuring `signal.spectralEnvelope` survives analysis -> adapter/persistence -> track analysis -> Mix Intelligence Graph so masking calculations are based on real evidence rather than an empty field.

Regional edits must invalidate only affected analysis ranges/features when possible instead of forcing unrelated recomputation.

## 2. Section Take Graph

Keep `arrangementMap` as the canonical structural map and extend section state with non-destructive takes/variants.

Conceptual model:

```text
Section
├── id / kind / timing / confidence
├── activeTakeId
├── takes[]
│   ├── id
│   ├── sourceType
│   ├── asset/clip references
│   ├── lyricsVariant
│   ├── generationRecipe
│   ├── processingRecipe
│   ├── provenance
│   ├── createdAt
│   └── reviewState
└── section-level metadata
```

A take may originate from recording, imported audio, a cut from an existing asset, local processing, voice conversion, tuning, harmony generation, remixing or an online generation provider.

Providers must return candidate takes or assets. They must not directly overwrite canonical project state.

Switching the active take must be non-destructive and reversible.

## 3. Pablo Action Contract

Replace growth through isolated phrase-specific adapters with a typed action contract. Existing adapters remain valid executors during migration.

Conceptual action shape:

```text
PabloAction
├── id
├── intent
├── target
│   ├── projectId
│   ├── sectionId / occurrence
│   ├── trackId / role
│   └── region
├── operation
├── parameters
├── preserve[]
├── evidenceRequirements[]
├── confidence
├── previewPolicy
├── destructive: false by default
└── provenance
```

Example user intent:

`Deixa meu vocal mais na frente só no segundo refrão, mas não mexe nas respirações.`

Expected internal resolution:

```text
Target: chorus[2]
Track: lead-vocal
Operation: bring_forward
Preserve: breath_events
Preview: A/B required
Commit: explicit/reviewed
```

Natural-language interpretation and execution are separate responsibilities. A model may help interpret intent, but only registered typed operations are executable.

## 4. Action Ledger and reversible transactions

Every Pablo edit should produce a ledger record containing:

- action and resolved target;
- previous state reference;
- resulting state reference;
- processor/provider and version;
- parameters/recipe;
- evidence used;
- confidence;
- preserved constraints;
- A/B decision;
- timestamp and provenance.

The default lifecycle is:

`interpret -> validate target/evidence -> plan -> preview -> A/B -> commit -> selective undo`

A preview may be skipped only for operations explicitly classified as safe and trivially reversible.

This ledger should gradually supersede dependence on coarse global project snapshots for AI-driven edits while remaining compatible with project revisions.

## 5. Mix Intelligence Graph evolution

Do not introduce a generic "AI mastering" claim before the underlying relationships are measurable.

Evolution order:

1. level relationships;
2. spectral overlap and masking;
3. stereo relationships;
4. front/middle/back depth intent;
5. transient competition;
6. dynamic competition;
7. vocal intelligibility;
8. multi-track corrective plans with confidence.

Mix plans must remain non-destructive and generate typed actions that can be previewed and selectively undone.

## 6. Breath, Alignment, Harmony and Voice intelligence

Existing breath semantics are preserved: natural/keep, soften/attenuate and remove/suppress, with confidence-based automatic/suggest/manual decisions.

Future detector/model upgrades must preserve the public action semantics unless benchmark evidence justifies a versioned contract change.

Harmony Intelligence must operate as performance-aware generation rather than simple duplicated pitch shifting. Lead melody, timing, phrasing, key/scale, voicing and humanization should be represented independently from the provider used to render the result.

Voice processing must continue to preserve identity, attacks, consonants, breaths, vibrato, dynamics and expression. Robotic/metallic output and formant drift remain failure diagnostics.

## 7. Provider boundary

Online providers are optional executors behind stable contracts.

The core owns:

- project and section semantics;
- actions and targets;
- take/version state;
- recipes and provenance;
- review and undo;
- capability/evidence state.

Providers own only the external computation needed to produce a result.

Provider failure, billing unavailability or account limits must not corrupt or block unrelated local editing workflows.

## 8. Migration order

Implement incrementally in this order:

1. close Analysis Bus v2 live-path gaps, beginning with spectral-envelope delivery into Mix Intelligence;
2. add Section Take Graph while preserving `arrangementMap` compatibility;
3. introduce Pablo Action Contract and Action Ledger;
4. wrap existing regional vocal operations as typed actions without rewriting their DSP;
5. standardize preview/A-B/commit/selective-undo lifecycle;
6. connect Mix Intelligence plans to typed actions using real analysis evidence;
7. make generation providers return candidate takes rather than mutate projects;
8. migrate harmony, voice and breath operations onto the same contracts;
9. let Instrument/Sampler/Beat Lab consume the shared project/action/analysis model;
10. only then expand advanced generative DAW behavior.

## Non-goals for the first migration

- no full rewrite of the current PabloVoice;
- no parallel project architecture;
- no provider lock-in;
- no arbitrary plugin generation as a prerequisite;
- no claim of autonomous mastering without measured evidence;
- no deletion of currently validated regional vocal operations;
- no UI redesign requirement solely because the internal contracts evolve.

## Promotion gates

A future implementation is promotable only when it proves:

- project migration preserves existing projects;
- active and alternate section takes survive save/reload;
- changing one section does not mutate untouched sections/tracks;
- provider results cannot overwrite canonical state without commit;
- A/B and selective undo restore exact intended ownership boundaries;
- required analysis evidence reaches every consumer that claims to use it;
- unsupported natural-language actions fail closed;
- Web and Android consume the same domain contracts;
- physical-device delta validation passes for newly exposed behavior.

## Product outcome

The intended product behavior is simple even though the internal architecture is rich: a creator can ask Pablo to change a specific musical idea, hear the alternative, keep or reject it, return to a previous version and continue creating without losing what was already good.
