# PabloVoice Music Creation Method v2

## Guarantee boundary

PabloVoice will reproduce the observable creation method and product behavior of leading AI-music systems, not proprietary weights, private training data, or hidden source code.

Success is judged by output quality and editing behavior against the same benchmark song, not by architectural similarity to a closed vendor.

## Target creation method

1. Capture artist intent without destructive compression
   - exact lyrics/version
   - free-form artistic brief
   - positive directions
   - negative directions
   - BPM/key/meter/duration
   - vocal profile
   - references
   - preservation locks

2. Build a structured Song Blueprint
   - section list and timing
   - energy curve
   - groove/rhythm plan
   - harmony/key plan
   - instrumentation/timbre palette
   - vocal delivery plan
   - transition/fill plan
   - lyric-to-section mapping
   - hard negatives

3. Build per-section generation instructions
   - global song identity remains locked
   - each section gets local variation and purpose
   - chorus/verse/bridge are not flattened into one generic caption

4. Generate multiple candidate takes
   - at least 2 candidates for important operations
   - fresh seed/variation per take
   - all candidates remain non-destructive versions

5. Validate before declaring success
   - valid audio and expected duration
   - vocal present when requested
   - lyric-bearing sections contain vocal activity
   - requested language/profile preserved
   - gross prompt/style violations rejected
   - no silent fallback to toy/local synth output

6. Rank and present candidates
   - technical integrity
   - prompt adherence
   - lyric/vocal adherence
   - structure coherence
   - musical movement vs mechanical looping
   - artifact score
   - user chooses final artistic preference

7. Lock approved material
   - user can lock sections/tracks/lyrics/style identity
   - later operations must preserve locks unless explicitly released

8. Section-level edit/regeneration
   - select time/section
   - new instruction/lyrics
   - regenerate only target context
   - audition multiple alternatives
   - preserve surrounding approved audio
   - create a new project version, never overwrite the source

9. Track/stem operations
   - vocals/instrumental separation
   - drums/bass/other stems when supported
   - add/extract/replace instrument layers
   - import recording/MIDI/reference audio

10. Vocal replacement path
   - generated guide vocal may be muted/replaced
   - artist recording/model is aligned to the same song structure
   - cleanup/tuning/harmony/doubles remain non-destructive

11. Studio continuation
   - generated song enters the same timeline/project
   - MIDI, instruments, automation, mixer, effects, versions and lyrics remain linked

12. Final render
   - render exact approved project state
   - WAV/MP3/stems
   - persist provenance, version and settings

## Engine strategy

The product contract is engine-agnostic.

A `MusicEngine` adapter must support capabilities instead of provider-specific UI. Possible engines include open/local models such as ACE-Step 1.5 and future replacements. Remote GPU execution is an implementation detail.

Required capability flags:
- full_song_with_lyrics
- instrumental
- reference_audio
- multiple_candidates
- section_repaint
- lyric_edit
- style_lock/reference
- stems
- add_or_extract_layer
- metadata_control
- vocal_language

If an engine lacks one capability, PabloVoice may route that operation to another compatible engine. The user remains in the same project and UI.

## Cost strategy

Use local compute whenever the device can meet the quality target. Otherwise use on-demand GPU execution. Paid proprietary APIs are optional benchmark/escape-hatch providers, never mandatory dependencies.

Cheap experimentation must happen before expensive full renders:
- reuse semantic/reference encodings where safe
- regenerate only changed sections
- avoid re-rendering locked regions
- batch candidates when GPU is already warm
- cache reusable model state locally/remotely

Cost optimization must never silently reduce the requested quality class.

## Suno/ElevenMusic behavior we explicitly reproduce

Publicly observable capabilities as of Sep 2026 include:
- own lyrics as first-class input
- full vocal song generation
- multiple alternatives
- edit one part while preserving the rest
- change individual lyrics without rebuilding unrelated content
- section-by-section composition
- reference-driven generation
- stems
- continuation into a Studio/production workflow

PabloVoice recreates those behaviors with its own implementation and open/substitutable engines.

## Acceptance gate: Tão eu

No implementation is considered complete until the same `Tão eu` benchmark can demonstrate:
1. exact project lyrics used;
2. professional sung male vocal in PT-BR when requested;
3. arrangement consistent with the detailed artistic brief;
4. at least two useful candidates;
5. no toy/synth fallback labeled professional;
6. chorus-only regeneration preserving the rest;
7. single lyric-line change without unrelated rebuild where engine capability permits;
8. stems available;
9. guide vocal replaceable by artist recording/model;
10. save/reopen/export from the same Studio project.

The quality gate remains comparative: PabloVoice must enter the same usable professional class as the contemporary Suno/ElevenMusic benchmark, even if the underlying model architecture differs.