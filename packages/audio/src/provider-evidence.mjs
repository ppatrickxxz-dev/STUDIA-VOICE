export function classifyProviderEvidence({ engineEvidence, routeEvidence } = {}) {
  const engineValidated = engineEvidence?.verified === true;
  const routeValidated = routeEvidence?.verified === true;
  return Object.freeze({
    engineValidated,
    routeValidated,
    promotable: engineValidated && routeValidated,
    state: engineValidated
      ? (routeValidated ? 'validated' : 'engine_validated_route_pending')
      : 'unvalidated',
  });
}

export const DEMUCS_HTDEMUCS_EVIDENCE = Object.freeze({
  engine: 'Demucs',
  model: 'htdemucs',
  version: '4.0.1',
  engineEvidence: {
    verified: true,
    evidenceFile: 'recovery/evidence/DEMUX_HTDEMUCS_E2E_EVIDENCE_2026-08-24.json',
    completedJobsObserved: 5,
  },
  standaloneRouteEvidence: {
    verified: false,
    route: 'create-kaggle-ticket(stems) -> Kaggle worker -> complete-kaggle-stems-job',
    reason: 'No completed standalone stems render_job observed yet.',
  },
});
