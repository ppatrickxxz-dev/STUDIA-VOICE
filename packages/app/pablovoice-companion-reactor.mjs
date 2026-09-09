import { activeProjectSessionId, getProject, listProjects } from './storage.mjs';
import { buildUnifiedProjectContext } from './project-context.mjs';

const COMPANIONS = Object.freeze({
  note: { name: 'Nota Drop', role: 'ritmo e ideias' },
  wave: { name: 'Wave Ribbon', role: 'arranjo e flow' },
  chime: { name: 'Chime Lantern', role: 'letra e harmonia' },
  eq: { name: 'EQ Bloom', role: 'voz e timbre' },
  vinyl: { name: 'Vinyl Groove', role: 'mix e finalização' },
  star: { name: 'Star Spark', role: 'inspiração e direção' },
});

const SECTION_SEQUENCES = Object.freeze({
  intro: ['star', 'note', 'wave', 'vinyl'],
  verse: ['chime', 'eq', 'note', 'wave'],
  prechorus: ['wave', 'star', 'eq', 'note'],
  chorus: ['star', 'note', 'eq', 'vinyl'],
  hook: ['star', 'note', 'vinyl', 'eq'],
  postchorus: ['note', 'vinyl', 'star', 'wave'],
  bridge: ['wave', 'chime', 'eq', 'star'],
  breakdown: ['wave', 'eq', 'chime', 'note'],
  interlude: ['wave', 'note', 'star', 'vinyl'],
  outro: ['vinyl', 'wave', 'chime', 'star'],
});

const runtime = {
  installed: false,
  observer: null,
  graph: null,
  project: null,
  playing: false,
  beatTimer: 0,
  graphTimer: 0,
  surfaceTimer: 0,
  lastSectionId: null,
  sectionHitTimer: 0,
  manualUntil: 0,
  activeCompanion: 'note',
  syncing: false,
};

export function installPabloVoiceCompanionReactor() {
  if (runtime.installed) return teardown;
  runtime.installed = true;
  ensureStyles();
  runtime.observer = new MutationObserver(queueSurfaceSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('play', onMediaPlay, true);
  document.addEventListener('pause', onMediaPause, true);
  document.addEventListener('ended', onMediaPause, true);
  for (const eventName of ['pablovoice:musical-plan-applied', 'pablovoice:stems-imported', 'pablovoice:project-updated', 'pablovoice:song-created']) {
    document.addEventListener(eventName, onProjectMutation);
  }
  refreshGraph();
  queueSurfaceSync();
  return teardown;
}

function teardown() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  runtime.installed = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('play', onMediaPlay, true);
  document.removeEventListener('pause', onMediaPause, true);
  document.removeEventListener('ended', onMediaPause, true);
  for (const eventName of ['pablovoice:musical-plan-applied', 'pablovoice:stems-imported', 'pablovoice:project-updated', 'pablovoice:song-created']) {
    document.removeEventListener(eventName, onProjectMutation);
  }
  clearTimeout(runtime.graphTimer);
  clearTimeout(runtime.surfaceTimer);
  clearTimeout(runtime.sectionHitTimer);
  stopBeatLoop();
}

function ensureStyles() {
  if (document.querySelector('style[data-pv-companion-reactor-style]')) return;
  const style = document.createElement('style');
  style.dataset.pvCompanionReactorStyle = 'true';
  style.textContent = `
    .pv-vnext-visualizer[data-vnext-reactive="music-graph"] {
      --pv-companion-beat-ms: 600ms;
      --pv-companion-motion: 1;
    }
    .pv-vnext-visualizer[data-vnext-reactive="music-graph"].playing .pv-vnext-device-screen > .pv-canon-companion-sprite {
      animation: pvCompanionMusicBeat var(--pv-companion-beat-ms) cubic-bezier(.2,.72,.28,1) infinite !important;
      transform-origin: 50% 76%;
    }
    .pv-vnext-visualizer[data-vnext-reactive="music-graph"].section-hit .pv-vnext-device-screen {
      animation: pvCompanionSectionHit calc(var(--pv-companion-beat-ms) * 1.25) ease-out 1;
    }
    .pv-vnext-mini-carousel button.music-reacting,
    .pv-vnext-companion-dock button.music-reacting {
      opacity: 1 !important;
      border-color: rgba(199,167,255,.66) !important;
      box-shadow: 0 0 0 1px rgba(199,167,255,.16), 0 0 24px rgba(149,93,255,.28) !important;
    }
    .pv-vnext-companion-dock button.music-reacting {
      animation: pvCompanionDockBeat var(--pv-companion-beat-ms) ease-in-out infinite;
    }
    .pv-vnext-visualizer[data-vnext-section="chorus"] .pv-vnext-device-screen,
    .pv-vnext-visualizer[data-vnext-section="hook"] .pv-vnext-device-screen {
      box-shadow: inset 0 0 0 1px rgba(199,167,255,.12), inset 0 0 44px rgba(115,63,225,.18), 0 0 26px rgba(149,93,255,.15);
    }
    @keyframes pvCompanionMusicBeat {
      0%,100% { transform: translate(-50%,-50%) scale(calc(.98 + (.01 * var(--pv-companion-motion)))) rotate(-1deg); }
      28% { transform: translate(-50%,-55%) scale(calc(1.02 + (.025 * var(--pv-companion-motion)))) rotate(1.5deg); }
      58% { transform: translate(-50%,-48%) scale(calc(1 + (.015 * var(--pv-companion-motion)))) rotate(-.5deg); }
    }
    @keyframes pvCompanionDockBeat {
      0%,100% { transform: translateY(0); }
      35% { transform: translateY(-4px); }
    }
    @keyframes pvCompanionSectionHit {
      0% { filter: brightness(1); }
      24% { filter: brightness(1.22); }
      100% { filter: brightness(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pv-vnext-visualizer[data-vnext-reactive="music-graph"].playing .pv-vnext-device-screen > .pv-canon-companion-sprite,
      .pv-vnext-companion-dock button.music-reacting,
      .pv-vnext-visualizer[data-vnext-reactive="music-graph"].section-hit .pv-vnext-device-screen { animation: none !important; }
      .pv-vnext-mini-carousel button.music-reacting,
      .pv-vnext-companion-dock button.music-reacting { outline: 2px solid rgba(199,167,255,.58); }
    }
  `;
  document.head.appendChild(style);
}

function onClick(event) {
  const manual = event.target.closest('[data-vnext-companion], [data-vnext-dock-companion]');
  if (manual) {
    const bpm = resolveTempo(runtime.graph);
    runtime.manualUntil = performance.now() + (bpm ? (60_000 / bpm) * 8 : 4_800);
    return;
  }
  const stop = event.target.closest('[data-action="stop"]');
  if (stop) {
    setPlaying(false);
    return;
  }
  const play = event.target.closest('[data-action="play"], [data-vnext-command="play"]');
  if (play) {
    setTimeout(() => {
      const mediaPlaying = findPlayingMedia();
      setPlaying(mediaPlaying ? true : !runtime.playing);
    }, 80);
  }
}

function onMediaPlay() { setPlaying(true); }
function onMediaPause() {
  queueMicrotask(() => {
    if (!findPlayingMedia()) setPlaying(false);
  });
}

function onProjectMutation() {
  clearTimeout(runtime.graphTimer);
  runtime.graphTimer = setTimeout(refreshGraph, 120);
}

async function refreshGraph() {
  clearTimeout(runtime.graphTimer);
  try {
    const project = await currentProject();
    runtime.project = project;
    runtime.graph = project ? (await buildUnifiedProjectContext(project))?.graph || null : null;
  } catch (error) {
    console.warn('PABLOVOICE_COMPANION_REACTOR_GRAPH_UNAVAILABLE', error);
    runtime.graph = null;
  }
  queueSurfaceSync();
  if (runtime.playing) scheduleBeatLoop(true);
}

async function currentProject() {
  const activeId = activeProjectSessionId();
  if (activeId) {
    const active = await getProject(activeId);
    if (active) return active;
  }
  return (await listProjects())[0] || null;
}

function setPlaying(playing) {
  const next = Boolean(playing);
  if (runtime.playing === next) {
    queueSurfaceSync();
    return;
  }
  runtime.playing = next;
  if (next) {
    refreshGraph();
    scheduleBeatLoop(true);
  } else {
    stopBeatLoop();
  }
  queueSurfaceSync();
}

function stopBeatLoop() {
  clearTimeout(runtime.beatTimer);
  runtime.beatTimer = 0;
}

function scheduleBeatLoop(immediate = false) {
  stopBeatLoop();
  if (!runtime.playing) return;
  const bpm = resolveTempo(runtime.graph);
  const beatMs = bpm ? Math.max(250, Math.min(1_200, 60_000 / bpm)) : 800;
  const delay = immediate ? 0 : beatMs;
  runtime.beatTimer = setTimeout(() => {
    reactToPlayback();
    scheduleBeatLoop(false);
  }, delay);
}

function reactToPlayback() {
  const seconds = readPlayheadSeconds();
  const reaction = deriveCompanionReaction(runtime.graph, seconds);
  if (performance.now() >= runtime.manualUntil) runtime.activeCompanion = reaction.companionId;
  const sectionChanged = reaction.sectionId && reaction.sectionId !== runtime.lastSectionId;
  if (reaction.sectionId) runtime.lastSectionId = reaction.sectionId;
  renderReaction({ ...reaction, companionId: runtime.activeCompanion }, sectionChanged);
}

export function deriveCompanionReaction(graph, playheadSeconds = 0) {
  const seconds = Math.max(0, Number(playheadSeconds || 0));
  const bpm = resolveTempo(graph);
  const section = currentSection(graph, seconds);
  const sectionKind = normalizeSectionKind(section?.kind || section?.label || '');
  const roles = new Set((graph?.tracks || []).filter((track) => !track.muted).map((track) => String(track.role || '')));
  const hasVocal = [...roles].some((role) => /vocal|voice/.test(role));
  const hasRhythm = [...roles].some((role) => /drum|bass|instrument|synth|guitar/.test(role));
  let sequence = [...(SECTION_SEQUENCES[sectionKind] || ['note', 'wave', 'star', 'vinyl'])];
  if (!hasVocal) sequence = sequence.filter((id) => id !== 'eq');
  if (!hasRhythm) sequence = sequence.filter((id) => !['note', 'vinyl'].includes(id));
  if (!sequence.length) sequence = ['wave', 'star'];
  const beatSeconds = bpm ? 60 / bpm : 0.8;
  const barIndex = Math.floor(seconds / Math.max(0.2, beatSeconds * 4));
  const companionId = sequence[Math.abs(barIndex) % sequence.length];
  return {
    companionId,
    bpm,
    beatMs: bpm ? Math.round(60_000 / bpm) : null,
    sectionId: section?.id || null,
    sectionKind: sectionKind || null,
    sectionLabel: section?.label || section?.kind || null,
    playheadSeconds: seconds,
    barIndex,
    source: 'project-music-graph',
  };
}

function resolveTempo(graph) {
  const candidates = [
    graph?.songCreation?.latestTake?.bpm,
    graph?.labs?.beat?.bpm,
    graph?.labs?.instrument?.bpm,
    runtime.project?.beatLab?.bpm,
    runtime.project?.instrumentLab?.bpm,
  ];
  for (const candidate of candidates) {
    const bpm = Number(candidate);
    if (Number.isFinite(bpm) && bpm >= 30 && bpm <= 320) return bpm;
  }
  return null;
}

function currentSection(graph, seconds) {
  const sections = graph?.structure?.sections || [];
  if (!sections.length) return null;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const start = Number(section.startSeconds || 0);
    const nextStart = Number(sections[index + 1]?.startSeconds);
    const explicitEnd = Number(section.endSeconds);
    const end = Number.isFinite(explicitEnd) && explicitEnd > start
      ? explicitEnd
      : Number.isFinite(nextStart) ? nextStart : Number(graph?.structure?.durationSeconds || Number.POSITIVE_INFINITY);
    if (seconds >= start && seconds < end) return section;
  }
  return sections.at(-1) || null;
}

function normalizeSectionKind(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function readPlayheadSeconds() {
  const media = findPlayingMedia();
  if (media && Number.isFinite(media.currentTime)) return media.currentTime;
  const readouts = [
    document.querySelector('#current-time')?.textContent,
    document.querySelector('[data-current-time]')?.textContent,
    document.querySelector('.pv-transport span')?.textContent,
  ];
  for (const value of readouts) {
    const seconds = parseTime(value);
    if (seconds !== null) return seconds;
  }
  return 0;
}

function findPlayingMedia() {
  return [...document.querySelectorAll('audio,video')].find((media) => !media.paused && !media.ended && Number.isFinite(media.currentTime)) || null;
}

function parseTime(value) {
  const match = String(value || '').match(/(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function queueSurfaceSync() {
  if (runtime.syncing || runtime.surfaceTimer) return;
  runtime.surfaceTimer = setTimeout(() => {
    runtime.surfaceTimer = 0;
    if (runtime.playing) reactToPlayback();
    else renderIdleSurface();
  }, 0);
}

function renderIdleSurface() {
  const visualizer = document.querySelector('[data-vnext-visualizer]');
  if (!visualizer) return;
  visualizer.dataset.vnextReactive = 'music-graph';
  visualizer.dataset.vnextReactionState = 'ready';
  visualizer.classList.remove('section-hit');
  visualizer.style.removeProperty('--pv-companion-beat-ms');
  visualizer.style.removeProperty('--pv-companion-motion');
  document.querySelectorAll('[data-vnext-dock-companion]').forEach((button) => button.classList.remove('music-reacting'));
}

function renderReaction(reaction, sectionChanged = false) {
  const visualizer = document.querySelector('[data-vnext-visualizer]');
  if (!visualizer) return;
  runtime.syncing = true;
  try {
    const spec = COMPANIONS[reaction.companionId] || COMPANIONS.note;
    const sprite = visualizer.querySelector('[data-vnext-active-sprite]');
    if (sprite) {
      sprite.className = `pv-canon-companion-sprite ${reaction.companionId}`;
      sprite.setAttribute('aria-label', spec.name);
    }
    visualizer.dataset.vnextReactive = 'music-graph';
    visualizer.dataset.vnextReactionState = 'playing';
    visualizer.dataset.vnextReaction = reaction.companionId;
    visualizer.dataset.vnextSection = reaction.sectionKind || 'unmapped';
    if (reaction.bpm) visualizer.dataset.vnextBpm = String(reaction.bpm);
    else delete visualizer.dataset.vnextBpm;
    visualizer.classList.add('playing');
    const beatMs = reaction.beatMs || 800;
    visualizer.style.setProperty('--pv-companion-beat-ms', `${beatMs}ms`);
    visualizer.style.setProperty('--pv-companion-motion', sectionMotion(reaction.sectionKind));

    setText(visualizer.querySelector('[data-vnext-now-name]'), spec.name);
    setText(visualizer.querySelector('[data-vnext-now-base]'), `${spec.role} · ${reaction.sectionLabel || 'projeto'}${reaction.bpm ? ` · ${reaction.bpm} BPM` : ''}`);
    setText(visualizer.querySelector('[data-vnext-now-copy]'), reaction.sectionLabel ? `${String(reaction.sectionLabel).toUpperCase()} · REAGINDO AO MUSIC GRAPH` : 'REAGINDO AO PROJETO');
    setText(visualizer.querySelector('[data-vnext-visualizer-state]'), 'REAGINDO');

    document.querySelectorAll('[data-vnext-companion]').forEach((button) => {
      const active = button.dataset.vnextCompanion === reaction.companionId;
      button.classList.toggle('active', active);
      button.classList.toggle('music-reacting', active);
    });
    document.querySelectorAll('[data-vnext-dock-companion]').forEach((button) => {
      button.classList.toggle('music-reacting', button.dataset.vnextDockCompanion === reaction.companionId);
    });

    if (sectionChanged) {
      visualizer.classList.remove('section-hit');
      void visualizer.offsetWidth;
      visualizer.classList.add('section-hit');
      clearTimeout(runtime.sectionHitTimer);
      runtime.sectionHitTimer = setTimeout(() => visualizer.classList.remove('section-hit'), Math.max(280, beatMs));
      document.dispatchEvent(new CustomEvent('pablovoice:companion-section-reaction', { detail: reaction }));
    }
    document.dispatchEvent(new CustomEvent('pablovoice:companion-beat-reaction', { detail: reaction }));
  } finally {
    runtime.syncing = false;
  }
}

function sectionMotion(kind) {
  if (['chorus', 'hook', 'postchorus'].includes(kind)) return '1.25';
  if (['prechorus', 'bridge', 'breakdown'].includes(kind)) return '1.08';
  if (kind === 'outro') return '.82';
  return '1';
}

function setText(node, value) {
  const next = String(value ?? '');
  if (node && node.textContent !== next) node.textContent = next;
}

export const PABLOVOICE_COMPANION_REACTION_POLICY = Object.freeze({
  source: 'project-music-graph',
  transportAware: true,
  sectionAware: true,
  tempoAware: true,
  fixedDecorativeCarousel: false,
  reducedMotionSafe: true,
  canonicalCompanionAssetsOnly: true,
});
