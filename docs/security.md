# Security model

- No provider key, model weight, keystore or password belongs in Web assets, the APK or Git history.
- Android release signing reads four protected CI secrets and refuses the release job when any is absent.
- The app uses a restrictive CSP, rejects mixed/cleartext WebView traffic, blocks file-scheme access and opens non-local HTTPS links outside the WebView.
- Audio imports are limited to 300 MB and must decode successfully before becoming tracks.
- Android uses the system picker and MediaStore; broad storage permissions are not requested.
- Microphone permission is requested only from the local app origin and immediately precedes recording.
- The local product remains usable when every cloud capability is unavailable.
- Voice-model checkpoints remain in protected storage and are not copied into clients.

Run `bash scripts/security-gate.sh` on every candidate. Production environments should require review and restrict access to signing and deployment secrets.

