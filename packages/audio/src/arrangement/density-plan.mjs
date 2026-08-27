export const ARRANGEMENT_DENSITY_POLICY_V1 = Object.freeze({
  source: 'b08_arrangement_v1',
  mode: 'attenuation_only',
  minGainDb: -12,
  maxGainDb: 0,
  maxRegions: 12,
  preserveLeadTrack: true,
  preserveLyrics: true,
  preserveTrackOrder: true,
  preserveAssetIdentity: true,
  preserveSongDuration: true,
});

export function applyArrangementDensityPlan(project, {
  leadTrackId,
  targetTrackIds = [],
  regions = [],
  policy = ARRANGEMENT_DENSITY_POLICY_V1,
} = {}) {
  validateInputs(project, { leadTrackId, targetTrackIds, regions, policy });
  const targetSet = new Set(targetTrackIds);
  const cleanRegions = regions.map((region, index) => normalizeRegion(region, index, policy));
  const next = structuredClone(project);

  next.tracks = next.tracks.map((track) => {
    if (!targetSet.has(track.id)) return track;
    const existing = Array.isArray(track.regionAutomation)
      ? track.regionAutomation.filter((event) => event?.source !== policy.source)
      : [];
    return {
      ...track,
      regionAutomation: [
        ...existing,
        ...cleanRegions.map((region, index) => ({
          id: `${policy.source}_${index + 1}`,
          kind: 'gain',
          startSeconds: region.startSeconds,
          endSeconds: region.endSeconds,
          gainDb: region.gainDb,
          confidence: 1,
          source: policy.source,
          enabled: true,
        })),
      ],
    };
  });

  assertArrangementPreservation(project, next, { leadTrackId, targetTrackIds, policy });
  return Object.freeze({
    project: next,
    plan: Object.freeze({
      leadTrackId,
      targetTrackIds: Object.freeze([...targetTrackIds]),
      regions: Object.freeze(cleanRegions),
      policy: Object.freeze({ ...policy }),
    }),
  });
}

export function assertArrangementPreservation(before, after, {
  leadTrackId,
  targetTrackIds = [],
  policy = ARRANGEMENT_DENSITY_POLICY_V1,
} = {}) {
  if (!before || !after) throw new TypeError('Projetos de comparação são obrigatórios.');
  if (before.id !== after.id) throw new Error('Arrangement guard: project identity changed.');
  if (policy.preserveLyrics && before.lyrics !== after.lyrics) throw new Error('Arrangement guard: lyrics changed.');
  if (before.tracks.length !== after.tracks.length) throw new Error('Arrangement guard: track count changed.');
  const targetSet = new Set(targetTrackIds);

  for (let index = 0; index < before.tracks.length; index += 1) {
    const a = before.tracks[index];
    const b = after.tracks[index];
    if (!b || a.id !== b.id) throw new Error('Arrangement guard: track order changed.');
    for (const key of ['assetId', 'duration', 'sampleRate', 'channels', 'offset', 'trimStart', 'trimEnd', 'gain', 'pan', 'muted', 'solo']) {
      if (!same(a[key], b[key])) throw new Error(`Arrangement guard: ${key} changed on ${a.id}.`);
    }
    if (!same(a.effects || {}, b.effects || {})) throw new Error(`Arrangement guard: effects changed on ${a.id}.`);

    const beforeAutomation = Array.isArray(a.regionAutomation) ? a.regionAutomation : [];
    const afterAutomation = Array.isArray(b.regionAutomation) ? b.regionAutomation : [];
    if (!targetSet.has(a.id) && !same(beforeAutomation, afterAutomation)) {
      throw new Error(`Arrangement guard: non-target automation changed on ${a.id}.`);
    }
    if (a.id === leadTrackId && !same(beforeAutomation, afterAutomation)) {
      throw new Error('Arrangement guard: lead vocal automation changed.');
    }
  }
  return true;
}

export function classifyArrangementReadiness({
  plannerPresent,
  runtimeRegionAutomationPresent,
  leadPreservationGuardPresent,
  retainedBenchmarkOutput = false,
} = {}) {
  const implementationReady = [plannerPresent, runtimeRegionAutomationPresent, leadPreservationGuardPresent].every(Boolean);
  return Object.freeze({
    implementationReady,
    retainedBenchmarkOutput: retainedBenchmarkOutput === true,
    scorable: implementationReady && retainedBenchmarkOutput === true,
    state: implementationReady
      ? retainedBenchmarkOutput === true ? 'evidence_ready' : 'implementation_ready_unexecuted'
      : 'blocked',
  });
}

function validateInputs(project, { leadTrackId, targetTrackIds, regions, policy }) {
  if (!project || !Array.isArray(project.tracks)) throw new TypeError('Projeto inválido.');
  if (!leadTrackId || !project.tracks.some((track) => track.id === leadTrackId)) throw new Error('Lead vocal explícita é obrigatória.');
  if (!Array.isArray(targetTrackIds) || !targetTrackIds.length) throw new Error('Ao menos uma faixa instrumental alvo é obrigatória.');
  if (new Set(targetTrackIds).size !== targetTrackIds.length) throw new Error('Faixas alvo duplicadas.');
  if (targetTrackIds.includes(leadTrackId)) throw new Error('A lead vocal não pode ser alvo do arranjo.');
  for (const id of targetTrackIds) if (!project.tracks.some((track) => track.id === id)) throw new Error(`Faixa alvo ausente: ${id}`);
  if (!Array.isArray(regions) || !regions.length || regions.length > policy.maxRegions) throw new Error('Plano de regiões inválido.');
}

function normalizeRegion(region, index, policy) {
  const startSeconds = Number(region?.startSeconds ?? region?.start);
  const endSeconds = Number(region?.endSeconds ?? region?.end);
  const gainDb = Number(region?.gainDb);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || startSeconds < 0) {
    throw new Error(`Região ${index + 1} inválida.`);
  }
  if (!Number.isFinite(gainDb) || gainDb < policy.minGainDb || gainDb > policy.maxGainDb) {
    throw new Error(`Ganho da região ${index + 1} viola a política attenuation-only.`);
  }
  return Object.freeze({
    startSeconds: round(startSeconds, 6),
    endSeconds: round(endSeconds, 6),
    gainDb: round(gainDb, 3),
    label: String(region?.label || `contrast_${index + 1}`).slice(0, 64),
  });
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
