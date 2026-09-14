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

### Studio
The Studio is where the chosen song continues:
- timeline and sections;
- versions/takes;
- stems;
- record/import vocal;
- replace guide singer with My Voice;
- instruments/MIDI;
- section regeneration;
- mixer/effects/automation;
- history/undo;
- export.

## 5. Voice model

Voice must never block music creation.

### Guide Voice
The default generated singer must be a real sung performance good enough to judge the composition. A synth melody is not a guide vocal and must never be labeled as one.

### My Voice
My Voice is an authorized private voice profile created from the owner's samples with identity/consent verification.

The normal UI does not expose checkpoint, RVC index, pitch extractor or other implementation terminology.

Two user flows are valid:
1. Create with Guide Voice → choose the song → Replace Voice → My Voice.
2. Create with My Voice selected from the start when generation-time voice conditioning is available.

For post-generation replacement, preserve the song's lyrics, melody, phrasing/timing, BPM, key, arrangement, instrumental and duration. Change singer identity/timbre, not the composition.

Old voice-cloning benchmark failures do not block the music-first product. They remain evidence for improving Voice quality, not a reason to prevent song generation.

## 6. Versions, not destructive regeneration

Every professional generation is a version attached to the same song.

Creating again never deletes an approved take.

Editing a section should preserve unrelated approved sections whenever the engine permits it.

A result becomes Final only when the artist explicitly approves it.

## 7. Professional music quality

The main Create action uses the professional music path.

Local/simple synthesis may be used for metronome, MIDI audition, melody sketch and offline composition utilities, but it must never be presented as the requested professional song.

For a requested song with vocals, success requires a sung vocal using the intended lyrics closely enough to be useful. If no sung vocal is present, the request did not succeed.

## 8. Professional visual direction

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

## 9. Conflict-resolution rules

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

## 10. Release priorities

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

## 11. Canonical acceptance song

Use `Tão eu` as the first full user-path benchmark because it represents the intended Brazilian pop/R&B/funk workflow.

Acceptance means the user can:
1. open/create the song;
2. use the real lyrics;
3. give the intended production direction;
4. create at least one usable professional song with vocals;
5. audition it;
6. choose and preserve it;
7. continue in Studio;
8. save/reopen;
9. export.

Voice replacement and deeper editing follow without invalidating the first musical result.

## 12. Definition of done

A feature is done only at the layer being claimed.

Examples:
- `UI done` means the UI behavior is physically usable.
- `generation done` means a real generation completed and returned verified audio.
- `song flow done` means the resulting song was saved, reopened and exported through the user path.
- `voice replacement done` means the guide singer was actually replaced while the rest of the song remained materially preserved.

Do not use a narrower proof to claim a broader completion.