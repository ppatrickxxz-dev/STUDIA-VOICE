# device-auth — canonical contract

Production slug: `device-auth`

Current production evidence: version 7 ACTIVE on Supabase project `yokmhqoncdwvxmzzybqa`.

## Supported flows

- `GET ?health=1`: public health only; does not return credentials.
- Existing one-time internal login link flow is preserved.
- `POST { action: "login", device_token }`: rotates an existing trusted-device token and returns a fresh Supabase session.
- `POST { action: "bootstrap", code, label }`: consumes a single-use bootstrap code, creates a user session server-side, and registers a rotating trusted-device token.
- Authenticated `register`, `revoke_all`, and `status` actions remain supported.

## Bootstrap security contract

The raw bootstrap code is never stored. The backend hashes it with SHA-256 and matches only `bootstrap_login_codes.code_hash`. A code must be unused and unexpired. Claiming it sets `used_at`; reuse fails closed. A successful pairing returns a normal short-lived Supabase session plus a random device token. Only the token hash is stored in `trusted_devices`; device tokens rotate after login and expire after 180 days.

The client never receives `service_role`, provider credentials, voice-model secrets, or signing keys. `verify_jwt=false` is intentional for this endpoint because bootstrap/login must be callable before a user JWT exists; every protected action performs explicit authentication in the function body.

## Client contract

`packages/app/remote-auth.mjs` owns session persistence and rotating device-token login. `packages/app/remote-auth-ui.mjs` provides the in-app **Conectar IA** pairing surface. No password or provider key is stored in the APK.

## Release rule

Do not label Composer, stems, RVC or harmonies as authenticated/live solely because this function is deployed. Physical pairing must succeed and the target provider/engine must pass its own evidence gate.
