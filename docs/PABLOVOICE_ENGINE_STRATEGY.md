# PabloVoice — Professional Music Engine Strategy

Date: 2026-09-13
Status: product/engine direction for PR #257

## Goal

Build a Suno-class creation experience that the owner can use far more freely financially. The product must prioritize professional musical output, not merely cheap generation.

The engine strategy therefore must optimize three things at the same time:

1. professional song quality;
2. freedom from per-generation subscription dependence;
3. the ability to replace the underlying model as open music models improve.

## Core decision

PabloVoice must be an open-first hybrid studio, not a thin wrapper around a paid music API and not a local-only toy generator.

The user sees one product and one Create action. PabloVoice chooses the best available execution path without changing the project experience.

### Preferred execution order

1. Local professional open model when compatible hardware is available.
2. Self-hosted/rented GPU running the same open engine when the device is not capable or when higher quality is requested.
3. Future stronger open model through the same engine contract when it beats the current baseline.
4. Optional commercial providers may exist only as explicit comparison/optional premium connectors, never as the mandatory core of PabloVoice.

## Primary open baseline

ACE-Step 1.5 is the primary candidate baseline because it currently combines:

- full-song generation with vocals/lyrics;
- long duration support;
- prompt/style control;
- reference audio;
- cover/remix/repaint editing;
- stems/track separation;
- BPM/key/time-signature metadata control;
- lightweight LoRA personalization;
- consumer-hardware support;
- permissive MIT license.

However, ACE-Step 1.5 is a baseline, not the product identity. PabloVoice must never hard-wire its project model, UI or editing semantics to ACE-Step-specific parameters.

## Why not depend on Suno/ElevenLabs APIs

Paid APIs can be useful for benchmark comparisons and optional interoperability, but they conflict with the core financial-freedom goal if every serious generation requires buying credits.

PabloVoice must own:

- projects;
- prompts/directions;
- lyrics;
- song plans;
- versions;
- assets;
- stems;
- recording;
- editing;
- mix/master state;
- model routing;
- generation provenance.

A provider should only execute a generation contract and return assets. No provider should become the PabloVoice data model.

## Quality tiers are execution choices, not different products

The UI must not expose confusing Online/Offline or Local/Cloud product modes.

Internally PabloVoice may have:

### Standard professional generation

Fast professional model suitable for repeated takes and section work.

### Maximum-quality generation

Heavier model/configuration for the selected take or final regeneration when hardware/remote GPU allows it.

Both are PabloVoice. Neither may silently fall back to the legacy toy synth renderer.

## Local generation

Local execution is the cheapest long-term path because repeated generations have no provider credit cost after hardware/electricity.

The app should detect available compute and choose an appropriate model configuration automatically.

Local generation should be optional and transparent. A weak phone or PC must not receive a low-quality fake substitute; it should use remote compute when connected or queue the request when not connected.

## Remote self-hosted compute

Remote generation should run PabloVoice-owned containers on usage-based GPU infrastructure. The objective is paying for actual compute rather than paying a music-platform subscription per user or per song.

The runtime must be portable between GPU vendors. The product should not be permanently coupled to Kaggle, RunPod, Modal, Vast, or any single provider.

Cloudflare/Supabase may coordinate the product, authentication, sync and job metadata, but heavy music generation belongs on appropriate GPU compute.

## One Music Engine contract

The frontend and project layer talk to one PabloVoice Music Engine interface.

Inputs should include at minimum:

- generation intent: full song / instrumental / section edit / continuation / cover-remix;
- exact lyric version;
- full artist brief;
- per-section direction;
- negative directions;
- arrangement plan;
- duration;
- BPM/key/meter when specified;
- vocal profile/identity;
- sound/style identity;
- owned audio reference(s);
- preserved/locked regions;
- variation/seed controls;
- quality target.

Outputs should include:

- one or more candidate takes;
- full audio asset;
- vocal-present verification for vocal requests;
- duration/format/sample-rate metadata;
- provider/model/config provenance internally;
- stems when requested/available;
- section timing map;
- exact inputs used;
- quality checks;
- deterministic linkage to project/version.

## Do not compress the artistic direction into a tiny caption

The existing generation path asks an AI layer to reduce the production direction to a very short phrase before dispatch. That should not be the canonical contract.

Instead:

- preserve the complete artist request;
- preserve explicit negatives;
- create a structured song blueprint;
- send compact model-specific fields only at the final adapter boundary;
- keep the full source direction attached to every take.

A model adapter may summarize only when the target model has a hard input limit, and that summary must preserve section identity, groove, instrumentation, dynamics and vocal requirements.

## Song planner before audio generation

To compete with Suno/ElevenMusic on control, PabloVoice should not treat a 3-minute song as one undifferentiated prompt.

Before generation, build a structured blueprint:

- intro;
- verse(s);
- pre-chorus;
- chorus(es);
- post-chorus;
- bridge/rap;
- instrumental turns;
- outro;
- energy curve;
- vocal density;
- instrumentation changes;
- transitions/fills;
- lyrical assignment.

The generator receives both the global direction and section plan.

## Professional-generation acceptance

"File generated" is not success.

For full Song with vocals, require at minimum:

- audible sung vocal;
- plausible lyric coverage;
- expected duration;
- no accidental instrumental mode;
- no gross clipping/corruption;
- project lyric version preserved;
- prompt/style direction attached;
- result saved and playable.

Then run musical-quality scoring/benchmarking separately.

## Editing is part of generation quality

A Suno-class result is not useful if PabloVoice cannot preserve the good parts.

The core engine roadmap must therefore include:

- regenerate a selected section;
- preserve everything outside that section;
- change one lyric line where technically possible;
- extend beginning/end/selected section;
- remix/cover from owned audio;
- create multiple alternatives side-by-side;
- stems;
- use MIDI/audio as generation guidance;
- reference audio/style identity;
- vocal identity.

## Vocal strategy

Do not make personal voice cloning a blocker for music creation.

Phase 1:
- high-quality generated guide singer that actually sings the lyrics.

Phase 2:
- replace guide vocal with the artist's recorded vocal in the Studio.

Phase 3:
- optional authorized vocal identity/conversion model integrated into the same project.

The artist must always be able to mute/remove the guide vocal and keep the instrumental/arrangement.

## Financial-freedom principle

The cheapest operation should be used only when it still meets the required quality.

Target economics:

- editing, recording, project management, MIDI, local effects, playback and mixing: local/no per-use fee;
- professional music generation: local when possible;
- remote generation: usage-based self-hosted GPU;
- storage/sync/collaboration: low-cost cloud services;
- paid external music APIs: optional, not required.

This is how PabloVoice can offer far more experimentation than a credit-limited music service without sacrificing the professional-quality target.

## Model replacement policy

Every major open music model should be benchmarked against the canonical `Tão eu` test before adoption.

A new model becomes preferred only if it improves the combined score for:

- musicality;
- lyric fidelity;
- vocal quality;
- prompt/style adherence;
- sonic quality;
- section coherence;
- editing capability;
- compute cost;
- license suitability.

Do not migrate simply because a model is newer.

## Immediate implementation direction

1. Decouple the current music client from a single `compute-kaggle-v58` dispatch endpoint.
2. Introduce a provider-independent PabloVoice Music Engine contract.
3. Add ACE-Step 1.5 as the first open professional adapter.
4. Preserve the full artistic brief and structured section plan end-to-end.
5. Add explicit output validation for Song with vocals.
6. Generate multiple candidate takes by default.
7. Persist every take non-destructively in the song project.
8. Add section regeneration/repaint using the same engine contract.
9. Run the canonical `Tão eu` benchmark against current Suno and ElevenMusic outputs.
10. Keep the best-scoring engine/configuration as the default; continue benchmarking newer open models.

## What not to do next

Do not spend the next increment on:

- marketplace/community;
- decorative dashboards;
- separate offline UI;
- new access gates;
- another parallel creator screen;
- another toy music renderer;
- Android-specific polish before the core song path is proven;
- provider-specific product UI.

The first objective is still: create one musically convincing full song with vocals and lyrics, then continue editing it inside the same PabloVoice project.