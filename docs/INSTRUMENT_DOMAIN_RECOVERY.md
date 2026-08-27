# PabloVoice — Instrument Domain Recovery Audit

Status: CANONICAL RECOVERY AUDIT
Date: 2026-08-27
Scope: instruments, sampler, MIDI, piano roll, audio-to-instrument, rhythm programming, arrangement and conversational generation of instrumental parts.

## Executive conclusion

The instrument area is not a blank roadmap item. PabloVoice already has two complementary implementation lineages plus a much broader product specification:

1. **Current canonical Audio Intelligence** already provides the analytical half of Audio-to-Instrument: onset-derived slicing, note-event to Piano Roll mapping, and chromatic-instrument descriptors gated by pitch confidence.
2. **Historical runtime 8.1** contains a working browser Instrument Engine: touch keyboard, Web Audio synthesis, note recording with velocity/start/duration, BPM, MIDI input, playback, offline WAV render, project persistence, undo/redo and insertion of rendered audio into the Studio timeline.
3. **Recovered product requirements** define a more complete Piano Roll: notes, velocity, length, quantize, transpose and scale highlighting; browser-friendly/open-source instrument sources such as SoundFonts/SF2/SFZ, samplers and Web Audio/WASM synths; and a browse → audition → add → edit flow.
4. **Conversational creation requirements** explicitly call for commands such as “Crie um baixo para esse refrão”, “Faça bateria funk aqui” and “Crie piano só no verso”, preserving project BPM, key, structure, selected range, duration and existing instruments, with output entering as a new track/clip.
5. **PMI/music-intelligence knowledge** can provide the musical guard layer, including confidence, cultural/meter regime checks and abstention when forcing a 12-TET/beat-grid/functional-harmony interpretation would be inappropriate.

Therefore the correct product direction is not to restore one old Instrument Lab card verbatim. It is to consolidate a **PabloVoice Instrument System** around the shared Audio Analysis Bus and project/timeline model.

## Recovered implementation evidence

### A. Instrument Engine from runtime 8.1

Recovered behavior:

- presets: Warm Keys, Soft Pad, Bass;
- dual-oscillator Web Audio voices with low-pass filtering and ADSR-like attack/release behavior;
- BPM 40–240;
- touch/pointer keyboard;
- MIDI note-on/note-off input through Web MIDI when available;
- performance recording with MIDI pitch, velocity, start beat and duration beats;
- sequence playback;
- local state snapshot/setData;
- OfflineAudioContext render;
- WAV generation at up to 48 kHz, mono/stereo;
- four-minute defensive render limit;
- project-module persistence as `instrument_lab`;
- render to a real project asset/track/clip;
- undo/redo scoped both to sequence edits and rendered timeline insertion.

This is **IMPLEMENTED HISTORICALLY / NOT YET PORTED TO CURRENT MAIN**. It should be treated as recoverable code and behavior, not as a new feature proposal.

### B. Current canonical Audio-to-Instrument

Current `packages/audio/src/sampler/audio-to-instrument.mjs` already contains:

- `createSlicesFromAnalysis`: derives slices from onset events and source duration;
- confidence gating for onset use;
- `mapNoteEventsToPianoRoll`: maps detected note events into MIDI notes, ticks, durations, velocities and confidence using BPM/PPQ;
- `createChromaticInstrumentDescriptor`: derives root pitch/root MIDI/detune, with optional formant preservation and confidence gating;
- `buildAudioToInstrumentPlan`: returns slices + piano roll + chromatic descriptor tied to analysis/source identity.

This is **IMPLEMENTED IN MAIN** and must be the analysis source for the new instrument system. Do not duplicate pitch/onset detection inside Instrument Lab.

## Canonical product architecture

The instrument domain should be split into reusable layers.

### 1. Instrument Core

Purpose: deterministic note/event model shared by UI, MIDI, AI and render.

Canonical event fields:

- id
- midi
- pitchClass / octave derived
- velocity 1–127
- startBeat
- durationBeats
- channel/lane
- confidence when inferred from audio/AI
- source (`played`, `midi`, `audio_inferred`, `ai_generated`, `manual`)

Required operations:

- add/remove/move/resize note;
- transpose semitone/octave;
- velocity editing;
- quantize strength rather than destructive-only snap;
- duplicate/copy/paste;
- selection by time/pitch;
- undo/redo;
- project persistence.

### 2. Piano Roll / Sequencer

Beginner-first surface with advanced disclosure.

Guided controls:

- “Arrumar tempo” (quantize)
- “Subir / baixar notas”
- “Deixar mais humano”
- “Destacar notas do tom”
- “Mais forte / mais suave”

Advanced controls:

- grid resolution;
- PPQ/quantize subdivision;
- quantize strength;
- swing;
- velocity;
- note length;
- transpose;
- scale/key highlighting;
- probability/variation only after deterministic base is reliable.

### 3. Performance Input

Inputs:

- touch keyboard;
- computer keyboard mapping;
- Web MIDI where available;
- pad/drum mode;
- later: external hardware mapping.

Mobile must remain first-class: touch keyboard/pads cannot be a desktop fallback.

### 4. Instrument Rack

Do not lock the product to three oscillator presets.

Provider-neutral contract:

- `instrumentId`
- `family`
- `engine` (`webaudio_synth`, `soundfont`, `sfz`, `sample`, later `wasm_synth`)
- `source/licence/provenance`
- polyphony
- velocity support
- pitch-bend support
- ADSR/filter controls where relevant
- downloadable/lazy-load asset manifest

Initial families:

- Keys
- Piano / EP
- Pads
- Bass
- Synth lead/pluck
- Drum kit
- Percussion
- Simple strings/guitar textures only where the source library/license/quality is adequate

Do not claim realistic acoustic-instrument emulation from the old oscillator presets.

### 5. Sampler / Audio-to-Instrument

This is one of the strongest differentiators because it works on user material.

Modes:

**Slice mode**
- detect onsets;
- create editable slices;
- audition each slice;
- map slices to pads/keys;
- trim/fade/gain per slice;
- build a beat or sequence from slices.

**Chromatic mode**
- detect root pitch/confidence;
- map the source across notes;
- preserve formants when evidence/engine supports it;
- expose root note/detune;
- refuse automatic chromatic mapping when pitch confidence is weak.

**Melody extraction mode**
- detected note events → editable Piano Roll;
- preserve confidence per note;
- low-confidence events require review rather than silent commitment.

### 6. Drum / Groove Engine

Recovered creative requirements repeatedly use beat programming and genre-specific drum requests. This deserves a dedicated note/percussion view, not forcing drums into a melodic keyboard UX.

Minimum v1:

- 16-step grid with variable pattern length;
- kick/snare/clap/closed hat/open hat/percussion lanes;
- velocity;
- swing;
- per-step mute/remove;
- pattern duplicate;
- render as project track;
- MIDI-note representation underneath so the same history/render architecture is reused.

Later intelligence:

- groove extraction from reference audio;
- humanization constrained by genre/context;
- fill generation;
- density changes by song section.

### 7. Musical Guard / PMI integration

Instrument suggestions must consume project context:

- BPM/tempo map;
- key hypothesis + confidence;
- sections;
- selected range;
- existing notes/tracks/instruments;
- groove/onset evidence;
- harmonic confidence;
- genre/mood from composition session;
- user authorial preferences.

Important rule: **key/scale highlighting is guidance, not a universal prohibition**.

The system must be able to abstain from:

- forcing 12-TET when material is microtonal;
- forcing a beat grid on non-metric material;
- forcing functional Roman-numeral harmony where inappropriate;
- quantizing expressive timing when confidence/context says not to.

### 8. Pablo conversational instrument tools

The conversational layer should not merely answer with text. It should produce structured, previewable operations.

Target commands:

- “Crie um baixo para esse refrão.”
- “Faça bateria funk aqui.”
- “Coloca um pad entrando no pré.”
- “Faz um piano mais simples no verso.”
- “Transforma esse som num instrumento.”
- “Pega essa melodia e coloca no piano roll.”
- “Deixa essa bateria menos reta.”
- “Faz uma virada antes do refrão.”
- “Toca esses acordes com outro timbre.”
- “Crie três opções e deixa eu ouvir.”

Structured output should include:

- target project/track/range/section;
- proposed instrument/provider;
- note/pattern data;
- confidence/provenance;
- reason/short user-facing explanation;
- preview first;
- apply creates new clip/track by default;
- action history + undo.

Generation must work **over the user's material**, not turn PabloVoice into a Suno clone.

## Application map

### Composition
- chord/progression audition;
- hook/melody sketching;
- bassline ideation;
- drum/groove sketching;
- section-specific arrangement.

### Production
- MIDI/piano-roll editing;
- instrument replacement without rewriting notes;
- sampler/chop workflows;
- rhythmic layering;
- rendered audio tracks for the existing mixer/export path.

### Audio intelligence
- convert recorded/hummed melody to editable notes;
- convert percussive audio to slices/pattern candidates;
- derive playable chromatic instruments from user recordings;
- use tempo/key/onset confidence rather than blind automation.

### Learning without blocking creation
- scale/chord highlighting;
- one-line explanations;
- “ouvir diferença / aplicar / entender melhor” pattern;
- progressive reveal of technical language.

### Pocket Studio / character integration

Instrument objects in Studio Life should deep-link into actual musical creation, not become decorative-only toys.

Examples:

- touching the room keyboard opens the same current project Instrument surface;
- drum-machine object opens the beat sequencer;
- sampler/microphone object opens Audio-to-Instrument;
- avatar/Pablo can visually react to real playback/render events;
- future rhythm/ear/sample-puzzle microgames may reuse the same note/groove engine, but cannot replace Studio work.

## What is already strong enough to port now

P0 recovery slice:

1. Port historical `InstrumentEngine` into a modular current package rather than copying the old monolithic HTML.
2. Replace its private note schema with the canonical Instrument Core schema.
3. Reuse current `audio-to-instrument` analysis rather than duplicate detection.
4. Add a current UI surface with touch keys, record, play, BPM, preset and render-to-timeline.
5. Preserve current project/history model and non-destructive behavior.
6. Re-run Web Functional Gate + Android build/emulator + physical-device touch/audio gate.

P1 immediately after:

1. Piano Roll editor.
2. quantize/transpose/velocity/length/scale highlighting;
3. real sampler slice mode;
4. SoundFont/SFZ provider evaluation;
5. drum step sequencer;
6. Pablo structured instrument commands.

P2 expansion:

1. richer synth engines/WASM;
2. groove extraction/humanization;
3. chord/voicing assistant;
4. section-aware arrangement generation;
5. instrument library browsing/auditioning;
6. optional desktop VST3/CLAP bridge only if a desktop product is later justified.

## Explicit non-goals / guards

- Do not restore the historical Instrument Lab as a parallel product.
- Do not write a second audio analyzer for instruments.
- Do not claim VST/VST3/CLAP support in the browser.
- Do not silently quantize all user material.
- Do not force Western functional harmony on every repertoire.
- Do not make AI-generated notes destructive or auto-apply by default.
- Do not require users to understand MIDI/PPQ before they can make music.
- Do not make Studio Life instruments decorative dead ends.

## Validation gates

A capability is not “done” because a button exists.

Required evidence by layer:

- touch keyboard produces audible notes on Android physical device;
- note-off never leaves stuck voices after pointer cancel/route changes;
- recorded note timing/velocity persists across reload;
- MIDI input passes browser-support-specific tests where available;
- offline render is audibly/non-silently valid and returns expected duration/sample rate/channels;
- rendered instrument becomes a real project asset/track/clip;
- undo removes the timeline reference without destroying retained source asset;
- Audio-to-Instrument slice boundaries derive from actual analysis evidence;
- Piano Roll inference preserves per-note confidence;
- low-confidence pitch mapping fails closed;
- AI-created part respects selected section/duration and does not mutate unrelated tracks;
- Web + Android builds share the same instrument core.

## Final disposition

The instrument domain is **high-value, high-recovery-readiness and materially closer to implementation than the old master state implied**.

Recommended canonical naming:

- **Instrument System** — umbrella architecture
- **Instrument Lab** — user-facing performance/editing surface
- **Sampler** — Audio-to-Instrument/playable sample surface
- **Piano Roll** — note editor
- **Beat Lab** — drum/groove sequencer
- **Instrument Intelligence** — Pablo/PMI planning and contextual generation layer

This hierarchy preserves the familiar “Instrument Lab” idea while preventing one UI card from becoming the architecture itself.
