# PabloVoice — Product Canon

## Product definition
PabloVoice is an intelligent music/audio studio for Web and Android. It is not a mockup, not a parallel redesign, and not "Suno with more buttons". The primary product job is to help a user move from an idea, lyric, instrumental direction or recording to an editable, persistent, exportable finished song while keeping deep audio tools available in the same project.

## Canonical experience
Real input -> real creative understanding -> real generation/processing -> real editable result -> persistence -> undo/versioning -> section/stem control -> mix/master -> export -> evidence-backed QA.

The same core can also support voice-over, podcast, narration, video audio, restoration, cleanup and general audio editing, but those domains must not make music creation feel secondary.

## UX principles
- Beginner-first language; technical detail is progressive/advanced.
- Preserve the approved identity: **Intimate Recorder + Retro Tape + Ônix/Chrome + refined Y2K + crystal details**.
- Canonical Home copy remains rooted in: "Você tá no estúdio." / "Sua ideia ganha som."
- Pablo is a living creative companion with contextual states and memory, not a generic help bot.
- Companions are functional creative partners and appear in the musical context where they help.
- Never create a visual control that does not alter real navigation, state, project data or audio.
- Never destroy original media; edits are non-destructive where technically feasible.
- Pablo AI should understand the current project/session and act through real tools/contracts.
- PMI/Wave intelligence should explain what Pablo understood, what will change, what will be preserved and how to undo it.

## Connectivity policy
PabloVoice is **online-first and offline-safe**. When a network exists, full connected production is the normal path. Local generation is the automatic fallback only when the device is genuinely offline. Authentication/provider failures while online are surfaced honestly and must not silently downgrade to local or fabricate success. Local project editing, original media and saved work remain available during network loss.

## Definition of done
A feature is not done because code compiles or a button exists. Done requires:
1. real input;
2. real execution;
3. real output;
4. persisted state/assets;
5. accessible UI result;
6. handled errors/retry where applicable;
7. evidence from the relevant platform gate.

## Product domains
- Project Core: auth, projects, versions, assets, tracks, clips, undo/redo.
- Audio Core: recorder/import, player, timeline, waveform, analysis, stems, Voice Lab, mixing/mastering, export.
- Creative Intelligence: Pablo AI, songwriting, rhyme, prosody, authorial-voice protection, musical intent, arrangement and reversible operations.
- Music Creation: full-song generation, instrumental-first creation, guide melody, takes, section regeneration, stems, vocal replacement/recording, mix/master.
- Knowledge: PMI/music/voice/production/cultural/visual/industry retrieval.
- Studio Life: Pablo states, Companions, Pocket/Room, Eras, memories and cosmetics; always subordinate to finishing music.

## Non-goals / prohibited regressions
- Do not restart the product from scratch.
- Do not replace the approved identity with a generic SaaS dashboard or unrelated mockup.
- Do not call a candidate release production-ready without physical evidence.
- Do not duplicate Web and Android business/audio logic unnecessarily.
- Do not promote benchmark scope beyond what was actually validated.
- Do not let gamification reduce meaningful music creation.
- Do not expose provider/model branding as the product architecture.
- Do not make users choose “local vs online” when connectivity can select the correct path automatically.
