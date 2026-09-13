# PabloVoice — Product Canon

Date: 2026-09-13
Status: canonical product direction for the next product pass

## 1. Why this document exists

PabloVoice has accumulated many valid technical modules but the user experience drifted away from the original goal: make a complete, good song inside one virtual studio. This canon centralizes the user corrections that override earlier interface decisions.

Latest correction wins: the only visual product element that must be preserved as-is in the redesign is the approved artistic direction around Pablo's canonical character. Existing code may be reused underneath when it is useful, but the current interface is not protected from redesign.

## 2. North-star outcome

A PabloVoice session is successful when the artist can go from idea/lyrics/voice to a musically convincing complete song, continue editing it without losing good work, replace the guide vocal with their own recording or vocal identity, mix it, save it, reopen it and export it.

The product is not validated by a green build, a render job, a valid WAV or a deployed page. It is validated by:

real input -> real musical generation -> usable result -> editable result -> persistence -> reopen -> export -> understandable failure handling.

A technically valid audio file that sounds generic, childish or unrelated to the requested style is a failed musical result.

## 3. Product identity

PabloVoice is one product: app and site are the same studio.

There is no separate "offline PabloVoice", "online PabloVoice", "local creator" or "cloud creator" in the user experience.

Connectivity changes only which operations can execute at that moment. It must not change the product, project, navigation or artistic quality target.

When an operation needs the network and connectivity is unavailable, PabloVoice keeps the request with the project and clearly says that generation will run when connection is available. It must never silently substitute a toy or lower-quality generator and present that as the requested song.

## 4. Music is the center, tools are subordinate

The project is the primary object. A song such as "Tão eu" contains everything:

- lyrics;
- prompt and artistic direction;
- arrangement and sections;
- generated versions;
- instrumentals;
- guide vocals;
- recorded vocals;
- stems;
- MIDI/instrument parts;
- takes;
- mix states;
- master/final exports;
- history;
- collaborators;
- pending online work.

Beat Lab, Instrument Lab, Piano Roll, Sampler, Voice Lab, cleanup, tuning, stems and AI operations are tools inside the project/Studio. They are not competing top-level products.

## 5. Primary navigation

### Home
Recent songs, continue where you stopped, create a new song.

### Create
A focused entry surface with:

1. Lyrics
2. "How should this song sound?"
3. Song with vocals / Instrumental
4. Create

Advanced settings are secondary: BPM, key, duration, vocal range, voice identity, references, negative directions and detailed structure.

### Studio
The unified production environment for the current song:

- timeline;
- sections;
- tracks;
- lyrics synced to sections;
- recording;
- instruments/MIDI;
- stems;
- regeneration by section;
- A/B takes;
- mixer;
- automation;
- vocal processing;
- history/undo.

### Versions
All generated and edited variants remain attached to the same song. A new generation never destroys an approved version.

### Collaborators
The same project can be shared and synchronized. Collaboration must never prevent solo work.

### Export
Full mix, instrumental, vocals/acapella when available, stems, WAV/MP3 and final versions.

## 6. Creation result semantics

There are only two primary generation intents:

### Instrumental
A complete musical production without sung vocals.

### Song with vocals
A complete musical production with a real/synthetic singing performance using the project lyrics.

A "melody guide" is a utility track. It may be MIDI or an instrument carrying the target melody. It is not a vocal and must never be labeled "guide voice".

"Guide vocal" means an actual sung voice performing words.

"My voice" means a recorded vocal or an explicitly selected vocal identity/model.

If the artist requested "Song with vocals" and the result has no vocal, does not sing, or materially fails to use the requested lyrics, PabloVoice must not mark the generation as successfully completed.

## 7. Song states

Song state changes emphasis, not permissions.

### Draft
Prioritize lyrics, direction, structure, generation, variations and experimentation.

### In production
Prioritize timeline, recording, section editing, instruments, stems, replacement and arrangement.

### Mix
Prioritize mixer, automation, EQ/dynamics/effects, vocal cleanup and A/B. Structural changes remain possible but PabloVoice protects the current mix snapshot first.

### Final
Represents an artist-approved version. It is preserved. Editing a Final creates a new working version based on it instead of destroying it.

## 8. Lessons from current Suno and ElevenMusic workflows

The goal is not to copy their UI. The goal is to match the quality and continuity expectations users now have from leading AI-music products.

PabloVoice should support the same product-level expectations:

- own lyrics as first-class input;
- detailed style and negative directions;
- high-quality full-song generation with vocals;
- multiple candidate takes;
- consistent vocal identity when selected;
- consistent sonic/style identity when selected;
- audio reference as creative guidance;
- section-aware composition;
- regenerate/change one section while preserving the rest;
- edit one lyric/line without rebuilding unrelated sections;
- rearrange/extend sections;
- split stems;
- continue into a real DAW-like Studio;
- MIDI and instruments in the same project;
- effects/automation/mixing in the same project;
- versions and non-destructive history;
- export that reflects the exact approved project state.

PabloVoice can go further by keeping the same project usable offline for local editing/recording/playback and by integrating the Pablo character as a contextual creative companion.

## 9. The Pablo character

Keep the approved Pablo artistic direction and canonical character.

Pablo is not a decorative mascot layer covering the Studio. His role is contextual:

- understands the current song and selected section;
- translates plain-language requests into musical actions;
- explains failures in normal language;
- suggests relevant actions without interrupting flow;
- reacts visually to creation/recording/listening states;
- never replaces the main music workspace.

The character and visual world must add identity without reducing time spent making music.

## 10. Quality rules for the music engine

The main Create action must use the professional generation path. A simplified local synth renderer may remain as an internal utility for metronome, melody sketch, MIDI audition or emergency preview, but it must never be returned as the requested final/professional generation.

The artistic brief must be preserved with enough detail to carry:

- groove;
- rhythmic feel;
- instrumentation;
- timbre;
- section contrast;
- dynamics;
- vocal profile;
- lyric structure;
- transitions/fills;
- explicit negatives;
- duration and ending behavior.

Do not aggressively compress the artist's musical direction into a tiny generic caption before generation.

Generation quality must be evaluated musically, not only technically.

## 11. Required generation contract

For every requested song generation, the system should persist:

- full user brief;
- exact lyrics/version used;
- song/instrumental intent;
- section plan;
- positive directions by song and section;
- negative directions by song and section;
- BPM/key/time signature when specified;
- vocal profile/identity when specified;
- audio/style references when specified;
- model/provider identity internally;
- seed/variation information when available;
- resulting asset;
- quality verification;
- provenance/version link.

Provider/model names should not dominate the primary UI.

## 12. Vocal validation

For "Song with vocals", success requires a vocal-aware check before the UI says "ready":

- a vocal component is present;
- vocal activity spans the expected lyrical sections;
- the rendered duration is plausible;
- lyric structure sent to the model matches the project version;
- no instrumental flag accidentally replaced the vocal request.

A later quality layer should evaluate lyric adherence more deeply rather than only detecting vocal energy.

## 13. Offline/online behavior

Offline must still allow:

- open/create local project;
- edit lyrics and structure;
- play downloaded/project audio;
- record vocals and new takes;
- edit clips;
- use installed/local instruments and MIDI;
- mix local assets;
- save/history/undo;
- export from assets already available locally;
- prepare network-dependent generation requests.

Online adds:

- high-quality generative music operations;
- remote separation/AI operations when required;
- synchronization;
- collaboration;
- remote backup;
- optional remote vocal/style identity services.

The navigation and project remain the same.

## 14. What should disappear from the primary experience

- separate online/offline product modes;
- "local draft" presented as a different PabloVoice;
- technical provider/infrastructure choices;
- access codes for normal owner functionality;
- login friction where transparent access is intended;
- duplicated creation surfaces;
- multiple competing Studio shells layered by runtime DOM observers;
- dozens of product cards before the first musical result;
- misleading "ready" states based only on file existence;
- toy synthetic music returned under the same label as professional generation.

## 15. What can be preserved under the hood

Reuse existing working foundations when they satisfy this canon:

- local project/audio persistence;
- recording;
- audio engine;
- stems;
- section regeneration;
- vocal cleanup/restoration;
- instrument engines;
- piano roll;
- sampler;
- mixer/history/version primitives;
- native music generation dispatch/results;
- release evidence and validation infrastructure.

Preserve capability; replace confusing presentation.

## 16. Benchmark before calling the redesign successful

The canonical benchmark song is "Tão eu".

The same lyrics and equivalent artistic direction must be tested against current Suno and ElevenMusic, then against PabloVoice.

PabloVoice does not need to produce identical audio, because the models are different. It must deliver a result in the same professional class for:

- musicality;
- arrangement;
- vocal performance;
- lyric adherence;
- prompt adherence;
- sonic quality;
- section coherence;
- editability.

If the result sounds like a simplistic synth sketch, omits the requested vocal, ignores the lyrics, collapses the style into generic pop or cannot be continued inside the Studio, it fails the benchmark.

## 17. Canonical user-level acceptance flow

1. Open PabloVoice.
2. Open/create "Tão eu".
3. Paste/use the existing lyrics.
4. Describe the production in natural language.
5. Select Song with vocals.
6. Create at least two professional takes.
7. Audition and choose a take.
8. Change only one section while preserving the rest.
9. Change one lyric line while preserving unrelated audio where possible.
10. Split stems.
11. Record/import the artist vocal.
12. Replace or mute guide vocal.
13. Mix and save.
14. Close and reopen the same project.
15. Export the approved WAV/MP3.

This is the product path that development should optimize before secondary surfaces.