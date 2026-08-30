# Release operations

## Branches

- `main`: approved production only
- `develop` / `integration/*`: combined verified work
- `feature/*`: isolated change
- `release/*`: frozen release candidate; fixes only

## Signing secrets

Configure these only in the protected `pablovoice-production` GitHub environment:

- `PV_RELEASE_KEYSTORE_BASE64`
- `PV_RELEASE_STORE_PASSWORD`
- `PV_RELEASE_KEY_ALIAS`
- `PV_RELEASE_KEY_PASSWORD`

The keystore file is reconstructed in the runner temporary directory and is never uploaded as an artifact. Keep an offline backup; losing it prevents compatible app updates.

## Promotion

1. CI and browser Web gate pass for one commit.
2. A signed release candidate APK/AAB is built from that same commit.
3. Install that exact APK on a physical Android device and record every item in `physical-android-gate.md`.
4. Freeze the RC and rerun regression, security and performance gates.
5. Merge the reviewed commit to `main`; verify the production Cloudflare Workers deployment, `/api/provider-readiness` and the authenticated Composer canary point to the same commit.
6. Create the tag on that commit and manually run the signed release workflow. It creates a draft GitHub Release with hashes.
7. Publish the draft only after the URL, APK and AAB commit identifiers match.


## Latest release ledger

- Main commit: `14c01351db671c0e5737ec78ae7b015cfef6df84`
- Merged PR: #201
- Cloudflare production: `https://studia-voice.ppatrickxxz.workers.dev`
- Workers Build: `5d834187-190d-4c0f-8b10-5800b91079eb`
- Automated evidence: Cloudflare Runtime, Web Functional, CI, Android build/emulators, signed release emulator and authenticated Composer production canary all passed.
- Physical Android delta: still open; emulator evidence is not a physical-device installation.

