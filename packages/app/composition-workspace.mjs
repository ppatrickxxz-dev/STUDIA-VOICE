let installed = false;

/**
 * Compatibility installer kept because older boot paths still import this module.
 * The professional song-first Creator now owns the creation surface directly.
 * This module must never move fields, inject competing cards, or rewrite the
 * artist brief before dispatch.
 */
export function installCompositionWorkspace() {
  if (installed) return;
  installed = true;
  document.documentElement.dataset.pvCompositionWorkspace = 'song-first-v2';
}

installCompositionWorkspace();

export const PABLOVOICE_COMPOSITION_WORKSPACE_VERSION = 'v2-song-first';
export const PABLOVOICE_COMPOSITION_WORKSPACE_POLICY = Object.freeze({
  injectsParallelCreator: false,
  movesCreatorFields: false,
  rewritesArtistBrief: false,
  owner: 'song-creation-studio',
});
