# PabloVoice Decision Log

This file records decisions that affect more than one module or parallel workstream.

## 2026-08-27 — GitHub is the canonical source

Decision: the repository `ppatrickxxz-dev/STUDIA-VOICE` is the single canonical source for PabloVoice product state, architecture, implementation and evidence.

Consequence: chat history, notebooks, ZIPs and historical runtimes are recovery/research inputs until their relevant knowledge is migrated into versioned source or evidence.

## 2026-08-27 — Web and Android are one product

Decision: Web and Android are delivery targets of the same central product and architecture.

Consequence: do not create a parallel Android product, parallel project schema or platform-specific business logic unless unavoidable and documented.

## 2026-08-27 — Capability requires evidence

Decision: code existence, compilation, preview and emulator success do not automatically promote a feature to functional/validated.

Consequence: capability state must preserve implementation evidence, engine evidence, route evidence and physical-device evidence independently where relevant.

## 2026-08-27 — Audio Analysis Bus is shared infrastructure

Decision: reusable measurements such as pitch, BPM, beats, onsets, transients, amplitude/loudness, sections and confidence should converge into the shared Audio Analysis Bus.

Consequence: Voice Lab, sampler, tuning, harmonies, remix, alignment, piano roll, Mix Intelligence and Pablo AI should consume shared analysis rather than independently recomputing competing values.

## 2026-08-27 — Stem providers are interchangeable behind StemEngine

Decision: Demucs is a validated engine/fallback candidate, not permanent architecture. MDX/MDXC, RoFormer and future engines plug into StemEngine and must be benchmarked before promotion.

Consequence: `engineValidated` and the validation state of a current route must remain distinct.

## 2026-08-27 — Songwriting mastery cannot be declared from symbolic tests alone

Decision: prosody, authorial voice preservation, constrained rewriting and vocal-identity preservation remain mastery candidates until real material/blind review supports promotion.

Consequence: songwriting benchmarks may prove narrow competencies without implying general human-level creative mastery.

## 2026-08-27 — PMI is a knowledge service

Decision: PMI supports Pablo AI through retrieval, provenance and domain knowledge; it is not a separate product or the sole core of PabloVoice.

Consequence: interface features should use relevant retrieved knowledge rather than exposing the entire knowledge database directly.

## 2026-08-27 — Studio Life supports creation

Decision: Pocket Studio, Room, Eras, memories, character and companions are a creative-retention layer, not punitive gamification.

Consequence: no streak punishment, forced decay, grinding or infantilized pet mechanics that compete with music creation.

## 2026-08-27 — Preserve approved identity

Decision: approved visual identity, character canon and product language are preserved unless an explicit later decision replaces them.

Consequence: recovered prototypes or parallel chats cannot silently redefine visual baseline or character identity.
