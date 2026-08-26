# Test and release gates

| Area | Automated gate | Current evidence before remote CI | Promotion rule |
|---|---|---|---|
| Web boot/build | syntax, unit, contract, static build | PASS (15 tests; build contract) | Browser preview must also pass |
| Import/decode/waveform | browser preview with real fixture | Pending preview | Required |
| Playback/trim/effects/A-B | browser preview + REGRESSION-003 | Contract PASS; functional preview pending | Required |
| Web recording | secure-context capture or controlled MediaRecorder fixture | Pending preview | Required |
| Save/reopen/export/download | browser preview | Unit/contract partial | Required |
| Android package | Gradle, zipalign, apksigner, aapt, size and embedded-assets gate | Pending CI | Required |
| Android offline boot | emulator text + non-black screenshot | Pending CI | Required |
| Android native microphone | physical device | Not executable by emulator | Required for Android Functional Gate |
| Android background/relaunch | emulator plus physical checklist | Pending | Required |
| Security | CSP, secret scan, WebView policy, permission allowlist | Static tests PASS; script pending CI | Required |
| Performance | Web bundle budget plus runtime boot/decode/render metrics | Runtime preview pending | Required |

The emulator gate explicitly prints `MIC_CAPTURE_REQUIRES_PHYSICAL_DEVICE`. It cannot be used to claim the physical Android gate.

