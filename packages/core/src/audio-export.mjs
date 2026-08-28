import { migrateProject, validateProject } from './project.mjs';

export function prepareAudioExport(project, { hasBuffer } = {}) {
  const validation = validateProject(project);
  if (!validation.valid) throw new Error(`Projeto inválido para exportação: ${validation.errors.join(' ')}`);
  if (typeof hasBuffer !== 'function') throw new TypeError('Validador de áudio ausente para exportação.');

  const snapshot = migrateProject(structuredClone(project));
  const audible = audibleTracks(snapshot);
  if (!audible.length) throw new Error('Nenhuma faixa audível disponível para exportação.');

  for (const track of audible) {
    if (!track.id || !track.assetId) throw new Error('Faixa inválida para exportação.');
    if (!hasBuffer(track.id)) throw new Error(`Áudio da faixa “${track.name || track.id}” não está disponível para exportação.`);
  }

  return snapshot;
}

function audibleTracks(project) {
  const tracks = project?.tracks || [];
  const hasSolo = tracks.some((track) => track.solo && !track.muted);
  return tracks.filter((track) => !track.muted && (!hasSolo || track.solo));
}
