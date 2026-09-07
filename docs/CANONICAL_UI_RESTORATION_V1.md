# Canonical UI Restoration v1

This increment restores the approved PabloVoice visual identity without rewriting the audio/music architecture.

## What changes

- use the repository's canonical `pablo_fullbody.webp` for Pablo IA instead of reconstructing the character in CSS;
- surface the canonical `companions_board.webp` and all six fixed companion identities;
- restore the Retro Tape + Ônix Galáxia presentation language as an additive skin;
- give Home and Creator a clearer music-first path (`Criar música`, `Abrir Studio`, then voice/mix/master);
- keep the existing route, project, audio, Creator, Studio and Section Map contracts intact;
- translate provider/model names out of user-facing presentation while retaining technical provenance in backend/metadata;
- add a contract test that locks brand, character assets, companion names and creative-flow invariants.

## What does not change

No audio DSP, provider request contract, project schema, timeline engine, persistence, authentication or release gate is replaced by this PR. Canonical visuals are loaded from the already-approved assets under `packages/site-vivo/assets` that ship in the Web/Android build.
