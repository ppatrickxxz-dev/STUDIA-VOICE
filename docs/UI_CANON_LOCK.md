# PabloVoice UI Canon Lock

Status: CANONICAL — changes require an explicit product decision.

## Product identity

- Product name: **PabloVoice**.
- Pablo is the central creative companion/AI inside the product; he is not a replacement brand and must not be redrawn as a generic robot or unrelated mascot.
- Canonical Pablo visual source: `packages/site-vivo/assets/pablo_fullbody.webp`.
- Canonical companions visual source: `packages/site-vivo/assets/companions_board.webp`.
- Canonical companion names are fixed: **Nota Drop, Star Spark, Wave Ribbon, EQ Bloom, Chime Lantern, Vinyl Groove**.

## Visual language

The product keeps the approved **Retro Tape + Ônix Galáxia** language: near-black/onyx surfaces, restrained galaxy depth/noise, violet as the primary glow, cyan/pink as supporting accents, subtle green/gold states, compact app-first typography and tactile cards. Neon is an accent and state language, not a replacement for hierarchy or readability.

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

The interface must optimize for finishing a song rather than exposing engine/provider plumbing. The canonical creative flow is:

`idea / brief -> lyrics or instrumental-first -> music take -> guide -> record/voice -> section editing -> stems/arrangement -> mix/master -> export`.

Required stable destinations are: **Início, Criar música/Compor, Studio, Projetos, Pablo**. Section Map, Voice Lab, Beat Lab, Instrument Lab and related tools remain capabilities within that one product rather than parallel apps.

Pablo reacts to the current creative context without changing identity. Companions appear when their musical role is relevant; they are not decorative filler.

## Provider abstraction

Suno and ElevenLabs are benchmark/research references used to learn capabilities and validate PabloVoice behavior. They are **not product identity**. User-facing primary navigation, hero copy, creation cards and creative actions must use PabloVoice language such as **Rascunho**, **Alta qualidade**, **Demo HQ**, **Refazer seção**, **Guia**, **Stems**, **Mix** and **Master** rather than provider/model branding.

Provider and model identities may remain in authenticated backend code, evidence, diagnostics, provenance and technical metadata where required for safety/auditability. They must not become the visual product architecture.

## Change-control rules

A feature patch must not silently:

1. replace Pablo or any canonical companion visual;
2. rename canonical companions;
3. replace the Retro Tape + Ônix Galáxia palette with an unrelated theme;
4. add a provider/model name as a top-level product feature or navigation item;
5. create a second Studio/Creator architecture when the current route can be extended;
6. move or remove core creative destinations solely to accommodate one new feature;
7. turn an unavailable capability into a decorative/fake enabled action.

When a deliberate visual redesign is approved, update this document in the same PR and include before/after functional screenshots plus Web and Android evidence.
