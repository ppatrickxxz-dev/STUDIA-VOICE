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

## 2026-08-28 — Future editing architecture is project-state + reversible actions

Decision: future PabloVoice evolution will use the existing canonical core as the base for a project-state editing architecture built around Audio Analysis Bus v2, Section Take Graph, Pablo Action Contract, Action Ledger/provenance and Mix Intelligence Graph.

Consequence: Pablo AI should resolve typed, targeted, non-destructive actions over real project objects rather than grow through unrelated phrase-specific features. Existing validated section/vocal adapters are migrated behind the action contract instead of being rewritten in parallel.

## 2026-08-28 — Sections gain takes instead of provider-owned mutations

Decision: `arrangementMap` remains the canonical section map, while future updates may attach multiple non-destructive takes/variants to a section with one active take.

Consequence: recordings, generated alternatives, tuning, conversion, harmony and future provider outputs become candidate takes/assets. External providers must not directly overwrite canonical project state; adoption occurs through preview/review/commit.

## 2026-08-28 — Analysis v2 must be proven end-to-end before consumers claim evidence

Decision: declaring a feature in the analysis schema is insufficient if runtime, adapters or persistence drop it before a consumer receives it.

Consequence: the first closure target is spectral-envelope delivery into Mix Intelligence, followed by other v2 fields. Higher-level masking/stereo/depth claims require real propagated evidence and fail closed when it is absent.

## 2026-08-28 — Pablo edits converge on preview, commit and selective undo

Decision: AI-driven edits should converge on the lifecycle `interpret -> validate -> plan -> preview -> A/B -> commit -> selective undo`, with safe reversible exceptions explicitly registered.

Consequence: action ownership, preservation constraints, processing recipes, provider/model versions, confidence and provenance are recorded in an Action Ledger so project history is finer-grained than global snapshots alone.

## 2026-08-30 — Cloudflare Worker is the canonical online Composer runtime

Decision: Composer health and turns use the canonical Cloudflare Worker, with Supabase retained only for device authentication and project ownership. Cloudflare Worker responses are origin-scoped for the WebView/local gate and the app CSP names the Worker explicitly.

Evidence: PR #201 merged as `14c01351db671c0e5737ec78ae7b015cfef6df84`; Cloudflare Workers Build `5d834187-190d-4c0f-8b10-5800b91079eb`; Cloudflare Runtime Gate, Web Functional Gate, CI, signed release and authenticated production canary all passed.

Consequence: no client may route Composer turns to the retired `validate-app-js-v71` endpoint. Preview and production Workers resolve same-origin, Android resolves the canonical Worker, and local functional gates fail closed without inventing remote success.

## 2026-08-30 — Release evidence is SHA-bound and physical Android remains open

Decision: automated release evidence is recorded against main SHA `14c01351db671c0e5737ec78ae7b015cfef6df84`; emulator, signed artifact and production canary are separate evidence axes and do not close the physical-device delta gate.

Consequence: the next Android validation must install this signed update on real hardware and record lifecycle/export/navigation evidence before physical release promotion is marked complete.
