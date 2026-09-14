# PabloVoice — Product Canon v3

Date: 2026-09-14
Status: canonical product direction. This document overrides older product/UI directions when they conflict.

## 1. Product promise

PabloVoice exists to let an artist make a complete song in one place.

The shortest successful path is:

idea or lyrics → musical direction → complete song → choose a version → edit → use guide voice or own authorized voice → mix → save → reopen → export.

A green build, a deployed page or a technically valid WAV is not the product goal. The product is successful only when the artist receives a musically usable result and can continue working on it.

## 2. One PabloVoice

There is one PabloVoice experience across app and web.

Online and offline are execution states, not separate products.

Offline must keep the project usable for writing, editing, playback of local assets, recording, arrangement, MIDI/instruments, mixing, history and export of available assets.

Online adds heavy AI generation, remote separation/processing, sync, backup and collaboration.

The project, navigation and file history remain the same in both states.

## 3. Music first

The song/project is the primary object. Labs are tools inside the Studio, not competing products.

A project can contain:
- lyrics and song brief;
- versions/takes;
- generated mixes;
- instrumental and vocal stems;
- guide vocal;
- own authorized voice profile;
- recordings and takes;
- MIDI/instruments;
- arrangement/sections;
- mixer state and automation;
- history;
- exports;
- pending online jobs.

Beat Lab, Instrument Lab, Voice Lab, Stems, Recording, Mixer and Master belong inside this project workflow.

## 4. Primary experience

### Home
Home answers one question first: **what music do you want to create or continue?**

It prioritizes:
1. create song with vocals;
2. create instrumental;
3. continue an existing song.

It does not present a wall of modules, technical providers, model names, access codes or release concepts.

### Create
The primary fields are:
- lyrics;
- how the song should sound;
- Song with vocals / Instrumental;
- Voice: Guide Voice / My Voice when an authorized profile is available;
- Create.

BPM, key, duration, negative directions, vocal range, detailed sections and references are advanced controls, not prerequisites.

Starting a song from Home must create and bind its project automatically when no project exists. A first-time user must never hit an internal “create/open a project first” requirement after already choosing Create Song.

### Studio
The Studio is where the chosen song continues.

The first professional Studio cut is `song_completion_v1` and puts only the finishing path at the front:
- current song/player and A/B;
- sections/timeline when available;
- import and recording;
- **Música** for song/section edits;
- **Voz** for vocal work;
- **Mix** for tracks and balance;
- **Exportar** for the deliverable.

Stems belong to the same project and feed these surfaces. Beat Lab, Instrument Lab, Piano Roll, Sampler and other deep tools remain available as advanced production tools inside the Studio; they are not primary navigation competing with the song.

## 5. Song data model

Composition, vocal performance, voice identity and mix are different layers and must never be collapsed into one opaque result.

Every persisted song is normalized to `pablovoice_song_model_v3`:

1. **Composition** — lyrics, BPM, key, sections, arrangement, duration and musical intent.
2. **Master Vocal Performance** — what was sung and how it was sung: lyrics/phonemes, melody/notes, pitch contour, timing, durations, phrasing, dynamics, breaths, vibrato intent, harmonies and ad-libs as those representations become available.
3. **Voice** — who is singing: Guide Voice or an authorized private My Voice profile.
4. **Mix** — master mix, tracks/stems, balances and production state.

A legacy synthetic melody guide is never promoted to Master Vocal Performance. If the native generator currently returns only a flattened sung mix, the actual sung vocal stem separated from that mix may become the audio authority for Master Vocal Performance, while richer symbolic analysis can be added later.

The first finished song does **not** wait for My Voice or voice replacement readiness. A verified complete guide-voice mix can be saved, reopened and exported while the Master Vocal Performance / My Voice path continues to mature.

## 6. Voice model

Voice must never block music creation.

### Guide Voice
The default generated singer must be a real sung performance good enough to judge the composition. A synth melody is not a guide vocal and must never be labeled as one.

### My Voice
My Voice is an authorized private voice profile created from the owner's samples with identity/consent verification.

The normal UI does not expose checkpoint, RVC index, pitch extractor or other implementation terminology.

Two user flows are valid:
1. Create with Guide Voice → choose the song → Replace Voice → My Voice.
2. Create with My Voice selected from the start when generation-time voice conditioning is available.

For post-generation replacement, the `Voice Replacement Lock` uses `identity_only`: lyrics, phonemes, vocal melody, notes, pitch contour, timing, durations, phrasing, dynamics, breath placement, vibrato intent, harmonies, ad-libs, song structure, BPM, key, instrumental, arrangement and song duration are immutable. Only vocal identity characteristics may change. Any forbidden delta rejects the render.

Old voice-cloning benchmark failures do not block the music-first product. They remain evidence for improving Voice quality, not a reason to prevent song generation.

## 7. Versions, not destructive regeneration

Every professional generation is a version attached to the same song.

Creating again never deletes an approved take.

Editing a section should preserve unrelated approved sections whenever the engine permits it.

A result becomes Final only when the artist explicitly approves it.

## 8. Professional music quality

The main Create action uses the professional music path.

Local/simple synthesis may be used for metronome, MIDI audition, melody sketch and offline composition utilities, but it must never be presented as the requested professional song.

For a requested song with vocals, success requires a sung vocal using the intended lyrics closely enough to be useful. If no sung vocal is present, the request did not succeed.

## 9. Professional visual direction

PabloVoice is a music-production application, not a gamified dashboard.

Visual rules:
- dark onyx base;
- restrained purple/cyan/magenta accents;
- strong typography and spacing;
- fewer, larger decisions per screen;
- real waveform/timeline/audio information gets visual priority;
- no cartoon-card wall for core production features;
- no oversized decorative mascots covering work areas;
- no emoji-driven navigation as a design system;
- no childish copy or fake AI jargon;
- Pablo's canonical character may appear contextually, but never replace the work surface.

The approved Pablo character remains part of the identity; the old interface layout is not protected.

## 10. Conflict-resolution rules

When old requirements conflict, apply these rules in order:

1. The latest explicit user correction wins.
2. Ability to make and finish a song wins over preservation of an old screen or workflow.
3. Music creation must not wait for optional voice-quality work.
4. Solo/local work must not wait for collaboration/cloud features.
5. A working existing engine/module is reused unless it prevents the canonical flow.
6. Provider/model details stay behind the product; users choose musical intent, not infrastructure.
7. Do not create a second PabloVoice to solve a problem in the first one.
8. Do not duplicate a feature as a new lab/page when it can live inside the song Studio.
9. Do not weaken integrity/security gates that prevent corrupt or substituted audio, but do separate those gates from unrelated legacy requirements.
10. Do not call work complete based only on UI, mocks, green builds or file existence; require the real user path for the capability being claimed.

## 11. Release priorities

P0 — make a real song:
- create from lyrics + detailed prompt;
- professional generated vocal or instrumental;
- save multiple versions;
- audition and choose one;
- reopen project;
- export playable audio.

P1 — make the song editable:
- sections;
- stems;
- regenerate/replace one section;
- record/import vocal;
- mix and history.

P2 — make voice ownership first-class:
- create private My Voice profile;
- verify owner/consent;
- create with My Voice where supported;
- replace guide singer with My Voice while preserving the song.

P3 — collaboration, advanced assistants and secondary labs.

No P2/P3 item may prevent P0 from shipping and being used.

## 12. Canonical first-song flow

Use `Tão eu` as the first full user-path benchmark because it represents the intended Brazilian pop/R&B/funk workflow.

The mandatory flow is:

1. **Idea** — type the musical direction on Home.
2. **Project** — PabloVoice creates/binds the song project automatically if needed.
3. **Composition** — add/use lyrics and musical direction.
4. **Generate** — obtain a physically verified professional full mix from the real music runtime.
5. **Listen** — audition the resulting version; generating again must preserve older takes.
6. **Continue** — open the same song in Studio, not another product.
7. **Edit optionally** — sections, stems, recording, voice and mix do not erase the approved result.
8. **Persist** — close/reopen and recover the same song and audio.
9. **Export** — produce playable output from that reopened project.

My Voice is intentionally outside the blocking path for step 9. It is an upgrade to the approved song, not permission to have a song at all.

Browser continuity gates may use deterministic audio fixtures only **after** the verified-generation boundary so they can test persistence/reopen/export without pretending a fixture proves AI generation. Physical music generation remains a separate live canary and must remain real.

## 13. Definition of done

A feature is done only at the layer being claimed.

Examples:
- `UI done` means the UI behavior is physically usable.
- `generation done` means a real generation completed and returned verified audio.
- `song flow done` means the resulting song was saved, reopened and exported through the user path.
- `voice replacement done` means the guide singer was actually replaced while the rest of the song remained materially preserved.

Do not use a narrower proof to claim a broader completion.