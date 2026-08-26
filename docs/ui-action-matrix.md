# UI action matrix

| UI element | Action | Engine / adapter | Automated evidence |
|---|---|---|---|
| New project | Create versioned project | Core + IndexedDB | `project.test.mjs`, UI contract |
| Import audio | Pick, size-check, decode, persist, add track | File picker + WebAudio + IndexedDB | canonical/UI/security contracts |
| Record / stop / cancel | Permission, timer, capture, WAV/WebM, add track | AudioRecord on Android; MediaRecorder on Web | Android bridge contract; emulator permission gate |
| Waveform | Worker peak extraction and seek | Worker + Canvas | Web browser gate |
| Play / stop | Multipista transport | WebAudio graph | Web browser gate |
| A original / B processed | Bypass or enable effect graph at current cursor | WebAudio graph reconstruction | REGRESSION-003 contract + browser A/B gate |
| Trim / gain / fades | Mutate non-destructive metadata and autosave | Core project model | project unit + browser gate |
| Voice Lab toggles | Real filters, compressor, de-esser shelf, saturation, pitch and double | WebAudio nodes | audio contract + browser gate |
| Mixer M/S/gain/pan | Select audible tracks and render mixer state | WebAudio / OfflineAudioContext | browser + export gate |
| Save | Snapshot bounded history and persist | IndexedDB | project lifecycle unit |
| Export WAV | Offline mix, preset peak, PCM16, download/MediaStore | Audio engine + native save bridge | WAV unit + APK bridge contract |
| Projects open/delete | Restore blobs/settings or delete project assets | IndexedDB | migration unit + browser persistence gate |
| Composition editor | Rhyme, meter, sections and singability | PT-BR deterministic analyzer | songwriting unit |
| Pablo | Contextual local suggestions | Project-state rules | UI contract |
| Settings | Version, capabilities, performance and revisions | Local state | browser gate |

Disabled cloud capabilities have no action button. Their status is rendered as unavailable rather than mocked.

