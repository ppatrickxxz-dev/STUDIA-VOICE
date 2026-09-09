export function sortProjectsByContext(projects = [], activeId = null) {
  return [...projects].sort((a, b) => {
    if (activeId) {
      if (a.id === activeId && b.id !== activeId) return -1;
      if (b.id === activeId && a.id !== activeId) return 1;
    }
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });
}

export async function buildUnifiedProjectContext(project, options = {}) {
  if (!project || typeof project !== 'object') return null;
  const intelligence = await loadProjectMusicGraph();
  if (!intelligence?.buildProjectMusicGraph || !intelligence?.musicGraphContextPack) return null;
  const graph = intelligence.buildProjectMusicGraph(project, options);
  return Object.freeze({
    graph,
    contextPack: intelligence.musicGraphContextPack(graph),
  });
}

async function loadProjectMusicGraph() {
  for (const specifier of ['./music-intelligence/src/project-music-graph.mjs', '../music-intelligence/src/project-music-graph.mjs']) {
    try {
      const module = await import(specifier);
      if (typeof module.buildProjectMusicGraph === 'function' && typeof module.musicGraphContextPack === 'function') return module;
    } catch {
      // Browser build and source tests expose the shared package at different roots.
    }
  }
  return null;
}
