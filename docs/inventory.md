# PabloVoice preservation inventory

Inventory date: 2026-08-26. Production and `main` were not modified during recovery.

| Origin | Version / ref | Role and quality | Dependencies / state | Decision |
|---|---|---|---|---|
| `ppatrickxxz-dev/STUDIA-VOICE` | `main` at `2fd7687` | Repository shell only; no application source | Broken Vercel build configuration | Preserve history; replace only through integration/RC gates |
| `ppatrickxxz-dev/pablovoice-android` | `mobile/standalone-20260825` at `ef7bb825` | Physically proven behavioral baseline: local boot, import, waveform, preview effects, native recording, IndexedDB, WAV export | Android WebViewAssetLoader + AudioRecord | Migrated into canonical core and Android adapter |
| GitHub Actions run `32915420797` | Android v2.3 validation APK | Installable debug evidence; emulator DOM gate passed, screenshots visually black | APK SHA-256 `a495f8e9294756b0d4d8876c335b804d6fd58c3528c297717678e1f7765ad8e5` | Preserve hash; do not promote because visual evidence was insufficient |
| Vercel `pablovoice-unified-runtime-8-1-0-direct-hosted` | UI/runtime v7.5.5 | Feature-rich cloud monolith with Studio, voice, project, mixer, A/B and backend contracts | Supabase-dependent and authentication-coupled | Preserve by hash; mine product behavior, not runtime coupling |
| Recovered v7.5.5 source | 189,592 bytes | Complete self-contained source | SHA-256 `fc3cfa7f606b00e4f5e4a03de7b5b3ba5fe6569cd9ba0d4550dcf0bed5d46025` | Reference only |
| Vercel `pablovoice-studio-801-preview` + chunk projects | UI v8.0.1 | Complete approved visual system, companion device, responsive shell | Recovered from three gzip/base64 chunks; SHA-256 `62e91565679093eb7fe623af02d56b60f251fc7b589d5b12a9fe596e300af4ca` | Visual baseline migrated |
| Vercel `pablovoice-unified-mobile-repair-8-1-1-r2` | 8.1.1 experiment | Protected deployment; incomplete recoverability | Two-file server deployment; no trustworthy functional evidence | Preserve remotely; do not use as canonical |
| Vercel `pv813-*` | 8.1.3 chunk/probe experiments | Six source chunks reported, but source paths were not fully recoverable | Probe infrastructure, not product deployment | Obsolete after full 8.0.1 recovery; retain remote history |
| Google Drive `PABLOVOICE_STUDIO_V5_2_SOURCE.html` | v5.2 | Earlier Web baseline with project/voice/Kaggle concepts | SHA-256 `3ad3043521b8e43c5fe8110afb917ce2f02c48ea8079996a5e70384f895f90a8` | Preserve by hash; superseded visually |
| Google Drive `Pablovoice1` | RVC model through `Pablovoice1_140e_2520s.pth` plus `.index` | User voice-model assets and recordings | Requires a protected model runtime; must never ship in Web/APK | Preserve in Drive; capability stays disabled |
| Previous local `android-pablovoice` / public `android/package-gate-*` | remote WebView wrappers | Small APKs that boot a hosted URL | Violates offline/local Android requirement; one artifact was about 20 KB | Discard from canonical source; preserve branch history |

## Canonical selection

The canonical release line combines the v2.3 behavioral baseline with the complete v8.0.1 identity. Cloud-only code and embedded provider configuration were intentionally not copied. The source of truth is this repository branch until its gates permit promotion.

