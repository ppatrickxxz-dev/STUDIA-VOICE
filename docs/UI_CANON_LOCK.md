# PabloVoice UI Canon Lock

Status: CANONICAL — changes require an explicit product decision.

## Product identity

- Product name: **PabloVoice**.
- Pablo is the central creative companion/AI inside the product; he is not a replacement brand and must not be redrawn as a generic robot or unrelated mascot.
- Canonical Pablo visual source: `packages/site-vivo/assets/pablo_fullbody.webp`.
- Canonical companions visual source: `packages/site-vivo/assets/companions_board.webp`.
- Canonical companion names are fixed: **Nota Drop, Star Spark, Wave Ribbon, EQ Bloom, Chime Lantern, Vinyl Groove**.
- Pablo must feel intimate and alive: the product recognizes at least the interaction states **IDLE/CALMO, LISTENING/OUVINDO, THINKING/PENSANDO, RECORDING/GRAVANDO, HAPPY/FELIZ and DANCING/DANÇANDO** without replacing the canonical character.

## Visual language — Intimate Recorder

The approved evolution keeps the original **Retro Tape + Ônix** DNA and makes it more tactile and intimate:

- dominant palette: **black, graphite, gunmetal, smoke glass, silver/chrome and clear crystal**;
- violet/purple is no longer the primary product color; saturated color is reserved for small semantic states/evidence when it improves comprehension;
- physical references: old pocket recorder, cassette/field-recorder transport, tiny LCD/OLED readouts, VU/meters, tape counters, screws, vents, knobs and segmented controls;
- Pablo lives visually inside a **black Tamagotchi/pocket-recorder** object rather than floating as a generic dashboard mascot;
- crystal/faceted details represent Companion presence and musical state without replacing their names, roles or canonical board;
- layouts remain modern, accessible and app-first: the hardware language is tactile atmosphere, not skeuomorphic clutter.

Canonical visual reference assets already in the repository:

- `packages/site-vivo/assets/pablo_fullbody.webp`
- `packages/site-vivo/assets/companions_board.webp`
- `packages/site-vivo/assets/hero_ui.webp`
- `packages/site-vivo/assets/studio_dashboard.webp`
- `packages/site-vivo/assets/projects.webp`
- `packages/site-vivo/assets/lyrics.webp`
- `packages/site-vivo/assets/voice_lab.webp`
- `packages/site-vivo/assets/beat_lab.webp`

## Experience invariants

The interface optimizes for **finishing a song**, not exposing engine/provider plumbing. The canonical creative flow is:

`idea / brief -> lyrics or instrumental-first -> music take -> guide -> record/voice -> section editing -> stems/arrangement -> mix/master -> export`.

Required stable destinations are: **Início, Criar música/Compor, Studio, Projetos, Pablo**. Section Map, Voice Lab, Beat Lab, Instrument Lab and related tools remain capabilities within that one product rather than parallel apps.

Pablo reacts to the current creative context without changing identity. Companions are working creative partners, not decorative filler. Their default functional associations are:

- **Star Spark** — idea/start/inspiration;
- **Nota Drop** — lyrics/melody/composition;
- **Wave Ribbon** — sections/arrangement/flow;
- **Vinyl Groove** — beat/groove/rhythm;
- **EQ Bloom** — voice/timbre/mix tone;
- **Chime Lantern** — transitions/finish/master/export.

PMI/Wave intelligence should be visible as explainable creative understanding: intent, scope, preserved regions, review, A/B/versioning and undo should be surfaced when relevant rather than hidden as backend-only intelligence.

## Network policy

PabloVoice is **online-first, offline-safe**:

1. when internet connectivity exists, connected/full production is the normal creative path;
2. the user should not be asked to choose between “local” and “online/HQ” as equivalent product modes;
3. local generation is an automatic contingency when the device is genuinely offline;
4. an authentication/provider/service failure while internet exists must **not** silently downgrade to local and must not fabricate a connected result;
5. project state, original media and local editing remain available when the network disappears;
6. authentication is contextual and one-time where possible; it must not dominate Home or Creator before the user requests a connected action.

## Provider abstraction

Suno and ElevenLabs are benchmark/research references used to learn capabilities and validate PabloVoice behavior. They are **not product identity**. User-facing primary navigation, hero copy, creation controls and creative actions use PabloVoice concepts: **Criar música, Criar instrumental, Produzir, Refazer seção, Guia, Stems, Mix, Master**.

Provider and model identities may remain in authenticated backend code, evidence, diagnostics, provenance and technical metadata where required for safety/auditability. They must not become the visual product architecture.

## Change-control rules

A feature patch must not silently:

1. replace Pablo or any canonical companion visual;
2. rename canonical companions;
3. replace the Intimate Recorder / Retro Tape / Ônix / crystal system with an unrelated theme;
4. restore purple/violet as the dominant product color without a new explicit product decision;
5. add a provider/model name as a top-level product feature or navigation item;
6. create a second Studio/Creator architecture when the current route can be extended;
7. move or remove core creative destinations solely to accommodate one new feature;
8. turn an unavailable capability into a decorative/fake enabled action;
9. silently fall back from connected production to local while the device is online.

When a deliberate visual redesign is approved, update this document in the same PR and include before/after functional screenshots plus Web and Android evidence.
