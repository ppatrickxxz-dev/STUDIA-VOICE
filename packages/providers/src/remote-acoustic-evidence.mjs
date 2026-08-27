const VALIDATED = 'validated';

export function normalizeRemoteAcousticEvidence(input) {
  const raw = acousticPayload(input);
  if (!raw || typeof raw !== 'object') return null;

  const technicalPass = raw.technical?.pass === true;
  const identityStatus = String(raw.identity?.status || 'missing');
  const timbreStatus = String(raw.timbre?.status || 'missing');
  const claimedValidated = raw.state === VALIDATED && raw.promotable === true;
  const validated = claimedValidated && technicalPass && identityStatus === 'pass' && timbreStatus === 'pass';
  const pending = raw.state === 'identity_evidence_pending' || identityStatus === 'missing' || timbreStatus === 'missing';

  return Object.freeze({
    schemaVersion: Number(raw.schemaVersion || raw.schema_version || 0) || null,
    state: validated ? VALIDATED : pending ? 'pending' : 'not_validated',
    promotable: validated,
    technicalPass,
    identityStatus,
    timbreStatus,
    pairId: stringOrNull(raw.pairId ?? raw.pair_id ?? metadataOf(input)?.harmonyPairId ?? metadataOf(input)?.harmony_pair_id),
    profile: stringOrNull(metadataOf(input)?.profile),
    voice: stringOrNull(metadataOf(input)?.voice),
  });
}

export function summarizePersistedAcousticEvidence(tracks = []) {
  const rows = Array.isArray(tracks) ? tracks.map(trackEvidenceRow).filter(Boolean) : [];
  const voiceRows = rows.filter((row) => row.kind === 'voice');
  const harmonyRows = rows.filter((row) => row.kind === 'harmony');

  const voice = summarizeVoiceRows(voiceRows);
  const harmony = summarizeHarmonyRows(harmonyRows);
  return Object.freeze({ voice, harmony });
}

function trackEvidenceRow(track) {
  const evidence = normalizeRemoteAcousticEvidence(track);
  if (!evidence) return null;
  const kind = track?.kind === 'voice_variant' ? 'voice' : track?.kind === 'harmony' ? 'harmony' : null;
  if (!kind) return null;
  return Object.freeze({
    trackId: stringOrNull(track?.id),
    kind,
    evidence,
    pairId: evidence.pairId,
    voice: evidence.voice,
  });
}

function summarizeVoiceRows(rows) {
  const validated = rows.filter((row) => row.evidence.promotable).length;
  const failed = rows.filter((row) => row.evidence.state === 'not_validated').length;
  const pending = rows.length - validated - failed;
  const state = validated > 0 ? 'validated_available' : failed > 0 && pending === 0 ? 'not_validated' : 'pending';
  return Object.freeze({ total: rows.length, validated, failed, pending, state });
}

function summarizeHarmonyRows(rows) {
  const groups = new Map();
  let unpaired = 0;
  for (const row of rows) {
    if (!row.pairId) {
      unpaired += 1;
      continue;
    }
    const group = groups.get(row.pairId) || { pairId: row.pairId, high: null, low: null };
    if (row.voice === 'high') group.high = row.evidence;
    if (row.voice === 'low') group.low = row.evidence;
    groups.set(row.pairId, group);
  }

  const completePairs = [...groups.values()].filter((group) => group.high && group.low);
  const validatedPair = completePairs.find((group) => group.high.promotable && group.low.promotable) || null;
  const failedPairs = completePairs.filter((group) => group.high.state === 'not_validated' || group.low.state === 'not_validated').length;

  return Object.freeze({
    total: rows.length,
    correlatedPairs: completePairs.length,
    unpaired,
    validatedPairId: validatedPair?.pairId || null,
    pairValidated: Boolean(validatedPair),
    state: validatedPair ? 'pair_validated' : failedPairs > 0 ? 'pair_not_validated' : 'pair_evidence_pending',
  });
}

function acousticPayload(input) {
  const metadata = metadataOf(input);
  return input?.acousticEvidence
    ?? input?.acoustic_evidence
    ?? metadata?.acousticEvidence
    ?? metadata?.acoustic_evidence
    ?? input?.remoteEvidence?.acousticEvidence
    ?? input?.remoteEvidence?.acoustic_evidence
    ?? null;
}

function metadataOf(input) {
  return input?.remoteEvidence?.metadata ?? input?.metadata ?? {};
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
