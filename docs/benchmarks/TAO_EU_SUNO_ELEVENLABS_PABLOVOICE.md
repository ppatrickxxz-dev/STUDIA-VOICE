# Benchmark musical — Tão eu

Date: 2026-09-13
Purpose: compare PabloVoice against the current user-level quality and editability bar of Suno and ElevenMusic using the same authored song.

## Important limitation

This benchmark defines the exact inputs and acceptance procedure. The physical generations inside Suno and ElevenMusic must be executed in those services/accounts. Do not claim a cross-platform audio comparison until the actual returned audio files are captured and reviewed.

## 1. Canonical song

Title: Tão eu
Target: ~3:20
Tempo: 120 BPM
Meter: 4/4
Language: Brazilian Portuguese
Lead vocal: male, warm low-mid range, chest-led, close, conversational, sensual and natural

## 2. Canonical creative direction

Brazilian Portuguese intimate nocturnal pagofunk: contemporary pagode + Y2K R&B + restrained funk carioca, 120 BPM, 4/4, target ~3:20. Warm low-mid male Brazilian vocal, chest-led, close-mic, conversational, sensual and natural; no high tenor, belting, falsetto dependency or excessive melisma. Tantã, pandeiro, melodic bass, clean guitar, Rhodes, deep sub and dry kicks. Keep verses spacious and seductive; chorus wider and catchy without becoming aggressive baile funk. Preserve the full lyric and do not rush lines. Use 4-bar intro, brief instrumental turn after chorus 1, another tension-building turn before rap, then a slow intimate low-register rap. At “Se prepara pra...” drop the beat; whisper “Levar...”, leave a short silence/pickup, then return with the full final chorus. Finish with a 6-bar sensual outro repeating “Tão eu / Todo meu / Tão eu”. Do not end early.

## 3. Canonical lyrics

[INTRO — 4 bars, instrumental]

[VERSE 1 — 12 bars]
Nós dois dentro do quarto
Seu lábio no meu
Tu grita baixo e fala muito
Se declara meu
Quanto mais tenta esconder
Sorrio ao te ver negar
Se a tua boca disser não
Teu beijo vai te entregar

[PRE-CHORUS — 4 bars]
Você some e depois chega perto
Eu me pergunto o que tu tem
Meu quarto tá sempre aberto
Pra tu se entregar, meu bem

[CHORUS — 12 bars]
Mas quando for embora
Jurando que já me esqueceu
Vai perdendo a hora
Nem lembra do que já viveu
Tu não sabe agora
Mal sabe onde se meteu
Gosto da nossa troca
Tudo isso é tão eu
(Tu é todo meu...)

[POST-CHORUS — 4 bars, instrumental + vocal ad-libs]

[VERSE 2 — 12 bars]
Se eu tocar, tu se desarma
Quer até chamar de amor
Finge que não disse nada
Medo do que confessou
E eu finjo que não ligo
Vivo no seu cheiro aqui
Um suspiro, te suplico
Você quem vai admitir

[CHORUS 2 — 12 bars]
Mas quando for embora
Jurando que já me esqueceu
Vai perdendo a hora
Nem lembra do que já viveu
Tu não sabe agora
Mal sabe onde se meteu
Gosto da nossa troca
Tudo isso é tão eu
(Tu é todo meu...)

[INSTRUMENTAL TENSION — 4 bars]

[RAP / BRIDGE — 16 bars, slow and intimate]
Deixo a noite correr sem pressa
Pra ver onde isso vai dar
Esse teu jeito já confessa
Tua boca quer me beijar
Chega de tanta conversa
Mesmo sem a gente falar
Nunca houve uma promessa
Mas sei que tu vai voltar
Agora é só nós dois...
no quarto
Se prepara pra...
(Levar...)

[BEAT CUT — 1 bar silence + 1 bar pickup]

[FINAL CHORUS — 12 bars]
Mas quando for embora
Jurando que já me esqueceu
Vai perdendo a hora
Nem lembra do que já viveu
Tu não sabe agora
Mal sabe onde se meteu
Gosto da nossa troca
Tudo isso é tão eu
(Tu é todo meu...)

[OUTRO — 6 bars, intimate]
Tão eu...
Todo meu...
Tão eu...

## 4. Fair-comparison protocol

Run two passes on every platform.

### Pass A — base model quality

Purpose: judge musical intelligence without relying on a trained personal style or cloned/reusable voice.

Use:
- the exact canonical lyrics;
- equivalent creative direction;
- male Brazilian vocal direction;
- no external copyrighted reference track;
- no personalized voice/style model;
- two or more candidate takes when the platform supports variants.

### Pass B — identity consistency

Purpose: judge whether the product can maintain a chosen vocal/sonic identity across the song.

Use only creator-owned/authorized references.

Where available:
- select a reusable voice/vocal identity;
- select an owned style/custom model/finetune or authorized audio reference;
- preserve the same lyrics and arrangement target.

PabloVoice should eventually support both passes inside the same project.

## 5. Suno setup

Use current flagship precise generation rather than an exploratory/wild model for the primary benchmark.

Recommended benchmark behavior:
- Custom creation with own lyrics;
- flagship v6 for primary take;
- Variety at minimum/zero for maximum prompt fidelity when comparing;
- Max Mode for this >2 minute song when available because the benchmark values whole-track consistency;
- Instrumental OFF;
- exact lyrics preserved;
- use Voice/Custom Model only in Pass B;
- generate at least the normal pair of takes and keep both.

Secondary stress tests:
- edit only the chorus;
- change one lyric line without rebuilding unrelated sections;
- split stems;
- move the chosen result into Studio and verify continued production workflow.

## 6. ElevenMusic setup

Use the current default high-quality model for prompted/reference generation (Music v2.5 as of 2026-09-11).

Recommended benchmark behavior:
- start from own lyrics and prompt;
- use section-aware Composer;
- create at least two variants/takes;
- specify the exact structure rather than treating the track as one generic prompt;
- carry positive and negative style directions at song/section level;
- use a consistent Vocal only in Pass B;
- use an owned Audio Reference or Music Finetune only in Pass B.

Secondary stress tests:
- regenerate only the chorus and audition alternatives side by side;
- preserve surrounding sections;
- change a lyric in one section;
- rearrange/extend a section;
- split stems;
- verify downloadable final audio.

## 7. PabloVoice required setup

The PabloVoice benchmark must not use the simplified local synth renderer as the music result.

Required behavior:
- preserve the complete creative direction rather than reducing it to a short generic caption;
- preserve all explicit negatives;
- pass the exact lyrics with section identity;
- maintain target duration ~3:20;
- produce a sung male lead when Song with vocals is selected;
- produce at least two candidate takes;
- save every take non-destructively in the same project;
- verify vocal presence before reporting success;
- expose the exact lyric version and direction associated with each take;
- support section regeneration without destroying approved sections;
- support stems and continued editing inside the same Studio.

### PabloVoice section plan

1. Intro — 4 bars — instrumental, establish atmosphere without overfilling.
2. Verse 1 — 12 bars — spacious, close, low-mid vocal, restrained groove.
3. Pre-Chorus — 4 bars — controlled lift, tension increases.
4. Chorus 1 — 12 bars — wider and memorable, stronger low end, still sensual.
5. Post-Chorus — 4 bars — instrumental turn + restrained vocal ad-libs.
6. Verse 2 — 12 bars — maintain identity with subtle new movement.
7. Chorus 2 — 12 bars — recognizable return with variation/fills.
8. Instrumental Tension — 4 bars — build toward rap without introducing a new genre.
9. Rap/Bridge — 16 bars — slow, intimate, lower register, rhythmically clear diction.
10. Beat Cut/Pickup — 2 bars — drop at “Se prepara pra...”, whispered “Levar...”, brief space then pickup.
11. Final Chorus — 12 bars — full return, strongest but not aggressive.
12. Outro — 6 bars — sensual de-escalation; do not truncate.

## 8. Scoring rubric

Score each returned take from 0-100.

### Musicality and arrangement — 25
- feels intentionally composed;
- groove is convincing;
- sections develop rather than loop mechanically;
- transitions/fills feel musical;
- arrangement supports the lyric.

### Prompt/style adherence — 20
- intimate nocturnal pagofunk/R&B identity is audible;
- requested instruments/feel are reflected;
- avoids aggressive baile funk, trap-like drift, excessive vocal acrobatics and other forbidden directions.

### Vocal and lyric fidelity — 20
- actual sung vocal exists;
- lyric is substantially preserved;
- lines are not rushed or randomly omitted;
- Brazilian Portuguese diction is usable;
- vocal range/delivery fit the requested profile.

### Sonic quality — 15
- instruments do not sound toy-like;
- vocal is integrated with production;
- mix is coherent;
- no obvious severe artifacts.

### Distinctiveness — 10
- does not collapse into generic AI pop;
- groove/timbre/arrangement give the song an identity.

### Editability/continuation — 10
- section can be revised without losing the rest;
- versions/takes are preserved;
- stems and project continuation are available.

## 9. Acceptance threshold for PabloVoice

PabloVoice is not considered competitive on this benchmark unless:

- total score is at least 85/100 for one take;
- it is no more than 10 points behind the best Suno/ElevenMusic take in the same pass;
- Song with vocals contains a real sung vocal;
- lyric adherence does not fail critically;
- no simplified local sketch is mislabeled as the professional result;
- the result can continue into Studio editing.

A single strong generation is not enough if the editing path destroys it.

## 10. Required artifacts per platform

Capture for every benchmark run:
- platform/model/version;
- timestamp;
- exact prompt/direction;
- exact lyrics;
- relevant settings;
- generated audio file(s);
- duration;
- whether vocal is present;
- notes on lyric deviations;
- scorecard;
- section-edit result;
- stems/editability evidence.

The benchmark should remain reproducible as models evolve.