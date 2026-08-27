export function attachAnalysisV2(baseRecord, v2Result) {
  if (!baseRecord?.assetId) throw new Error('base analysis record is required');
  if (!v2Result || typeof v2Result !== 'object') throw new Error('v2 analysis result is required');
  return {
    ...structuredClone(baseRecord),
    music: {
      ...structuredClone(baseRecord.music || {}),
      ...(v2Result.music || {})
    },
    voice: {
      ...structuredClone(baseRecord.voice || {}),
      ...(v2Result.voice || {})
    },
    analysisV2: {
      confidence: structuredClone(v2Result.confidence || {}),
      attachedAt: new Date().toISOString()
    }
  };
}
