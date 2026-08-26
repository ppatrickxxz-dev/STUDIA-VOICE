export function healthPayload(commit = 'unknown') {
  return {
    ok: true,
    service: 'pablovoice-api',
    mode: 'local-first',
    commit,
    capabilities: {
      projects: 'local',
      audio: 'local',
      ai: 'not-configured',
      stems: 'not-configured',
      voiceConversion: 'not-configured'
    }
  };
}

