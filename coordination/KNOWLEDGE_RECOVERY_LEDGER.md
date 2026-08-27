# PabloVoice — Knowledge Recovery Ledger

Status: AUDIT IN PROGRESS. This file exists to prevent loss of ideas, research, prototypes and validated work before any candidate PR (including #35) is promoted as the new canonical truth.

## Source policy

The canonical source is GitHub `main`, but historical knowledge is being recovered from every source that is actually accessible in this environment: ChatGPT Library files, current/recent conversation context, historical runtime/manifests, notebooks, Supabase live backend, Vercel deployments, open/closed PRs and Git history.

Important limitation: ChatGPT does not expose a complete searchable endpoint for the literal text of every historical chat in the account. Therefore no document may claim that every message in every chat was read. Any inaccessible chat-only material remains `UNVERIFIED_SOURCE`, not silently discarded.

## Preservation rule

No idea is lost merely because it is not ready to merge. Every recovered item must be classified as one of:

- CANONICAL
- IMPLEMENTED_VALIDATED
- IMPLEMENTED_NOT_VALIDATED
- RECOVERY_CANDIDATE
- RESEARCH_KNOWLEDGE
- PROPOSED
- SUPERSEDED
- REJECTED
- CONFLICT
- UNVERIFIED_SOURCE

Implementation is not equivalent to validation. Research is not equivalent to implementation. Internal PMI mastery claims are not equivalent to independently reproduced capability.

## Recovered domains and current disposition

### Product / Studio core
- One shared core for Web + Android: CANONICAL.
- Do not restart the product or create parallel mockups: CANONICAL.
- Beginner-first UX with advanced controls progressively exposed: CANONICAL.
- Home copy `Você tá no estúdio.` / `Sua ideia ganha som.`: CANONICAL.
- Real import, recording, playback, non-destructive editing, projects and export: P0 CANONICAL.

### Audio Intelligence
- Shared Audio Analysis Bus: CANONICAL.
- Deterministic PCM measurements with provenance/confidence and fail-closed unknown fields: IMPLEMENTED.
- Pitch, note events, tempo/BPM, beat grid, tempo map, onset foundations, voice summary and breath confidence: RECOVERY/PR #35 CANDIDATE; do not promote until reconciled with current main and re-gated.
- Audio-to-Instrument, slices, Piano Roll and chromatic instrument descriptors: RECOVERY/PR #35 CANDIDATE.
- Mix Intelligence Graph: CANONICAL PLANNED P1.
- Breath / Alignment Intelligence: CANONICAL PLANNED P1.

### Stem separation
- Abstract StemEngine rather than hard-wiring one model: CANONICAL.
- Demucs/htdemucs has historical real E2E evidence: ENGINE VALIDATED.
- Current standalone route is implemented/deployed, but current authenticated route proof is still pending: ROUTE CANDIDATE.
- MDX/MDXC/RoFormer remain provider candidates, not promoted without benchmark.

### Voice Lab / personal voice
- Preserve original timbre/naturalness; robotic output is a failure mode: CANONICAL.
- Voice Lab A/B and non-destructive treatment: CANONICAL.
- Historical Kaggle/Applio pipeline contains actual RVC training/loading/conversion logic and a PabloVoice model workflow: RECOVERY CANDIDATE.
- Historical Pipeline V2 implements STEMS -> RVC -> MIX/MASTER with temporary tickets and SHA-256 proof: RECOVERY CANDIDATE / evidence source.
- Pitch/formant/timing/denoise/de-esser/EQ/compression/saturation/harmonies/doubles/alignment must be modular and evidence-gated: CANONICAL.
- Natural Voice Guard / vocal identity preservation: CANONICAL requirement; current full validation pending.

### Harmonies
- High/low harmony workflow is a distinct capability, not merely a UI toggle: CANONICAL.
- PR #36 contains a provider route and explicitly keeps low harmony unexecuted; B07 must not be marked PASS until both retained high + low outputs exist: ACTIVE CANDIDATE.

### Songwriting / composition
- Songwriting Engine + Rhyme Intelligence + Prosody Engine + Authorial Voice Guard: CANONICAL product direction.
- Generator Adapter / model-provider contract: CANONICAL requirement.
- Composition must support PT-BR and multiple international/Brazilian genres, preserving authorial identity instead of rewriting the user's intent: CANONICAL.
- Blind review / constrained rewrite / prosody and identity tests remain required for strong capability claims: CANONICAL gate.
- PMI research includes prosody, culture-aware harmony, vocal preservation and authorial-preservation concepts; internal `MASTERED` claims must be treated as scoped/internal unless evidence is reproducible.

### Pablo AI / creative copilot
- Pablo must work with actual project context and guide a non-technical user: CANONICAL.
- Historical runtime 8.1 contains a Create/Chat experience with project context, PMI, music mapping, voice preparation, harmony prompts and local/remote routing: RECOVERY CANDIDATE.
- PR #24 contains current remote conversation work but predates current main and needs reconciliation before promotion: ACTIVE CANDIDATE.
- Advice-only/fail-safe behavior is required until action tools are explicitly authorized and validated.

### Instrument Lab / sampler / MIDI
- Historical runtime 8.1 contains WebAudio note-on/off, MIDI connection, recording, save, render, undo/redo and timeline insertion: RECOVERY CANDIDATE.
- Audio-to-Instrument should consume the shared Analysis Bus rather than duplicate pitch/onset analysis: CANONICAL.

### Podcast
- Historical runtime contains silence analysis, preview normal/compact and module persistence: RECOVERY CANDIDATE.
- ASR/transcript-assisted editing and final validated export remain gaps.

### Video Audio
- Historical runtime contains video selection, audio profile/gain, render/export and undo/redo; prior remux evidence exists: RECOVERY CANDIDATE.
- Must be migrated module-by-module and re-gated in canonical runtime.

### Mix / master / export
- Historical Kaggle V2 performs mix/master, WAV 48 kHz stereo 24-bit plus M4A 256 kbps and QA: RECOVERY CANDIDATE / evidence source.
- Local export already exists in current canonical runtime; advanced master must not replace it until provider path is reliable.
- Loudness-controlled A/B and preference-vs-technical-quality separation are canonical evaluation principles.

### PMI / knowledge service
- PMI is an auxiliary retrieval/knowledge service, not a second product: CANONICAL.
- Music/audio, culture, theory, production, voice, visual and industry knowledge should keep provenance/confidence.
- Internal mastery labels require scope and reproducible evidence; research audits explicitly warn that passing internal tests is not universal mastery.
- Visual PMI includes color science, compositing, HDR, retouching, PSD interoperability and C2PA/provenance research; only capabilities with executed gates can be promoted.

### Visual / cover-art intelligence
- Album/single/podcast cover creation, photo treatment, typography, color, compositing and identity preservation belong as auxiliary creative intelligence: CANONICAL AUXILIARY.
- C2PA is provenance evidence, not proof of factual truth; official validator execution is required for cryptographic certification.

### Pocket Studio / Studio Life
- Product direction: avatar + Pablo + micro-studio + memories + Eras, not a punitive virtual pet: CANONICAL CONCEPT.
- `Music keeps the world alive`, not hunger/health/streak mechanics: CANONICAL.
- Vibe/Focus/Inspiration/Moment as contextual states: CANONICAL concept.
- Eras: Quarto -> Demo -> Session -> Release -> Stage -> Archive; no regression or streak requirement: CANONICAL concept.
- Creative milestones should create memories/objects (mic, notebook, MiniDisc, poster, record, etc.): CANONICAL concept.
- Pocket is a compact window into the same Room, not a separate fake world: CANONICAL concept.
- Avoid Tamagotchi branding/visual cloning; use Pocket Studio / Studio Companion language: CANONICAL brand guard.
- Canvas 2D first; PixiJS/Phaser only if later complexity justifies them; Godot/3D not MVP: RESEARCH DECISION.

### Character / pets / animation
- Approved character identity must not be regenerated casually: CANONICAL visual guard.
- Companion/pet concepts should be musical, expressive, cute without becoming generic animal mascots; multiple bodies/faces/personalities, not skin-only variants: CANONICAL creative direction from conversation history.
- Distinct central personalities/emotions rather than every character smiling: CANONICAL creative direction.
- Ambient animation should rely on many small motions (LED, equalizer, breathing, particles, hair/cable movement, city lights) rather than expensive frame counts: RESEARCH/CANONICAL direction.

### Infrastructure / release
- GitHub main must become the single implementation truth: CANONICAL.
- Supabase stores auth/project/assets/jobs; private storage and ownership checks are required: CANONICAL.
- Kaggle can be a zero-cost GPU fallback using temporary scoped tickets, never frontend service-role keys: CANONICAL.
- Vercel Hobby build-rate limits are currently a delivery blocker; Vercel availability must not block APK/CI delivery or force parallel source branches.
- CI/emulator success is not physical-device approval: CANONICAL.
- Release must produce a single Web + Android candidate from the same main, then physical Android gate.

## Current open candidates that must be reconciled before claiming `main` contains everything

- PR #35 — Audio Analysis Bus v2 + Audio-to-Instrument: valuable, large, currently candidate; not canonical truth yet.
- PR #36 — B07 high/low harmony provider: implementation-ready but acoustic pair proof incomplete.
- PR #24 — Pablo remote conversation: useful but stale relative to current main; reconcile instead of raw merge.
- Any other open PR discovered after this ledger update must be added here before promotion.

## Historical runtime capabilities that must not be forgotten

Runtime 8.1 artifacts demonstrate implementation work for:
- project-aware Pablo/Create UI;
- Instrument Lab + MIDI + render/history;
- Podcast Cleanup;
- Video Audio/remux;
- Voice Lab assets and module persistence;
- analysis/project summaries;
- sound/motion/companion runtime.

These are not automatically validated in the current source. They are migration evidence and requirements to preserve.

## Guarantee policy

We can guarantee **process preservation**, not omniscience over inaccessible chat text:
1. no candidate becomes canonical merely because it is newer;
2. every accessible historical artifact/decision is classified in this ledger or a linked register;
3. superseded ideas remain recorded rather than silently deleted;
4. every future chat must hand off work through the coordination layer;
5. anything found later is reconciled against this ledger before merge;
6. inaccessible chat-only content is explicitly marked as a source gap rather than treated as nonexistent.

## Release objective after audit

The target remains a single PabloVoice that lets a non-technical creator:
1. open/create a project;
2. import or record audio;
3. analyze/map the music;
4. converse with Pablo in project context;
5. compose/rewrite with authorial guards;
6. separate stems;
7. prepare/convert/tune the user's voice naturally;
8. create harmonies/doubles;
9. create instruments/samples/MIDI parts;
10. edit/mix/master;
11. work with podcast/video audio when desired;
12. export real files;
13. persist versions/history;
14. use the same project on Web/Android;
15. progress visually through Studio Life without gamification blocking creation.

No future release should be called complete while these canonical requirements are silently missing; incomplete advanced providers may remain gated, but the product must expose their true state honestly.