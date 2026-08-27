# Pablo Music Intelligence 1.0

PMI Music is the reusable decision layer for assisted music creation in PabloVoice.

## 1.0 scope

- Concept Engine: preserves the user's premise and turns it into explicit creative questions.
- Composition Session Engine: moves from discovery to development without forcing immediate full-song generation.
- Existing Songwriting Analyzer: reused for structure, approximate meter, rhyme coverage and singability signals.
- Critic: explains what needs attention before rewriting.
- Authorial Memory contract: records accepted/rejected creative choices as evidence.

## Non-goals

- This package does not claim to generate finished music by itself.
- It does not silently overwrite user lyrics.
- It does not treat heuristic syllable/rhyme analysis as ground-truth PT-BR prosody.
- Model/provider calls belong behind adapters; the intelligence contract must survive provider changes.

## Session principle

idea -> concept -> alternatives -> user choice -> structure/hook -> draft -> analysis -> critique -> revision -> musical/vocal direction

The original material remains available throughout the session. Rewrites require an explicit reason and should be comparable with the previous version.
