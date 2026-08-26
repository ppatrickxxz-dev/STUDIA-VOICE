import { getProvider } from '../../packages/providers/src/registry.mjs';

const provider = getProvider('suno');

const MANUAL_PROTOCOL = Object.freeze({
  B01: ['Open Create or Studio', 'Use the frozen lyrics and brief unchanged', 'Record generated output and model/version used'],
  B02: ['Open Replace Section', 'Select the frozen benchmark region', 'Regenerate only that section', 'Export/retain the whole-song result and selected take'],
  B03: ['Use Edit Lyrics / Replace Section', 'Change only the frozen target line', 'Retain surrounding audio for locality comparison'],
  B04: ['Use only official voice/identity controls available to the account', 'Do not substitute an unofficial voice-cloning service'],
  B05: ['Generate the frozen PT-BR passage', 'Do not rewrite contractions or vocabulary before generation'],
  B06: ['Use Studio pitch/formant controls only where applicable', 'Record every manual parameter change'],
  B07: ['Use Studio Chat or generation controls to request high/low harmonies', 'Export the resulting tracks/stems when available'],
  B08: ['Apply the frozen arrangement-change request in Studio', 'Preserve melody/lyrics/voice constraints'],
  B09: ['Use Advanced Stem Separation / Split from Mix', 'Export all returned stems without post-processing'],
  B10: ['Submit the frozen natural-language instruction to Studio Chat', 'Record the exact instruction and resulting operation'],
  B11: ['Apply the three frozen local edits sequentially', 'Keep Take Lanes/original state available for comparison'],
  B12: ['Export full song and multitrack/stems using official Studio export', 'Record selected formats and resulting file metadata'],
});

export function createSunoManualRun({ testId, inputHashes, notes = null } = {}) {
  const capability = provider.capabilities[testId];
  if (!capability) throw new Error(`Unknown Suno benchmark test: ${testId}`);
  if (!MANUAL_PROTOCOL[testId]) throw new Error(`No frozen Suno manual protocol for ${testId}`);

  return Object.freeze({
    provider: 'suno',
    transport: provider.transport,
    test_id: testId,
    status: 'awaiting_human_execution',
    capability_status: capability.status,
    input_hashes: Object.freeze({ ...inputHashes }),
    protocol: MANUAL_PROTOCOL[testId],
    evidence_required: Object.freeze([
      'timestamp_utc',
      'account_tier',
      'model_or_studio_version',
      'exact_prompt_or_chat_instruction',
      'output_file_hashes',
      'screenshots_or_export_metadata_when_applicable',
    ]),
    notes,
  });
}

export function sunoSupportsOfficialAutomation() {
  return false;
}
