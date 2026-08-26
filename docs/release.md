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
5. Merge the reviewed commit to `main`; verify the production Vercel deployment points to it.
6. Create the tag on that commit and manually run the signed release workflow. It creates a draft GitHub Release with hashes.
7. Publish the draft only after the URL, APK and AAB commit identifiers match.

