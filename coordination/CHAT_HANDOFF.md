# PabloVoice Cross-Chat Handoff

Use this protocol in every parallel ChatGPT conversation working on PabloVoice.

## Before modifying anything

Read these canonical files first:

1. `coordination/MASTER_STATE.json`
2. `coordination/MODULE_REGISTRY.json`
3. `docs/PRODUCT_CANON.md`
4. `docs/ARCHITECTURE.md`
5. `docs/QA_GATES.md`
6. `coordination/DECISION_LOG.md`
7. `coordination/BLOCKERS.md`

## Mandatory rules

- Do not restart PabloVoice or create a parallel product.
- Do not replace approved visual/character identity without an explicit new decision.
- Web and Android share the same central source and architecture.
- Compilation, preview, mocked UI and emulator-only success are not proof of full functionality.
- Never promote a capability solely because code exists. Record evidence separately from implementation.
- Do not duplicate pitch/BPM/onset/loudness/transient analysis inside features. Converge shared analysis in Audio Analysis Bus.
- Do not create competing project schemas, waveforms, provider registries or persistence formats.
- Keep provider capability honest: unavailable or unvalidated external engines remain hidden/candidate.
- Preserve user-authored musical identity and existing approved product decisions.
- If a chat discovers a conflict, do not silently pick a new truth. Record it in `DECISION_LOG.md` or `BLOCKERS.md`.

## Handoff format

Before ending work in a parallel chat, report:

```text
MODULE:
BRANCH / PR:
WHAT CHANGED:
FILES CHANGED:
STATUS: implemented | candidate | validated | blocked
EVIDENCE:
DEPENDENCIES:
NEW DECISIONS:
CONFLICTS:
NEXT GATE:
MASTER_STATE UPDATE NEEDED: yes/no
```

## State promotion

Use this progression when applicable:

`planned -> implemented -> candidate -> validated`

Historical/recovered code should use:

`recovery-candidate -> candidate -> validated`

A module may contain independent evidence axes, for example:

- `engineValidated=true`
- `routeValidated=false`

Do not collapse those into a single green status.

## Current coordination principle

The GitHub repository is the source of truth. Chats are research/execution workers. Knowledge that matters to the product must converge back into versioned source, docs, evidence, or state files.
