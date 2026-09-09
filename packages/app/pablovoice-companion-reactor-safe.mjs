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
  graph: null,
  project: null,
  playing: false,
  beatTimer: 0,
  graphTimer: 0,
  sectionHitTimer: 0,
  lastSectionId: null,
  manualUntil: 0,
  activeCompanion: 'note',
  animations: new Map(),
};

export function installPabloVoiceCompanionReactor() {
  if (runtime.installed) return teardown;
  runtime.installed = true;
  document.addEventListener('click', onClick, true);
  document.addEventListener('play', onMediaPlay, true);
  document.addEventListener('pause', onMediaPause, true);
  document.addEventListener('ended', onMediaPause, true);
  document.addEventListener('pablovoice:vnext-surface-ready', syncSurface);
  for (const eventName of ['pablovoice:musical-plan-applied', 'pablovoice:stems-imported', 'pablovoice:project-updated', 'pablovoice:song-created']) {
    document.addEventListener(eventName, onProjectMutation);
  }
  refreshGraph();
  syncSurface();
  return teardown;
}

function teardown() {
  runtime.installed = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('play', onMediaPlay, true);
  document.removeEventListener('pause', onMediaPause, true);
  document.removeEventListener('ended', onMediaPause, true);
  document.removeEventListener('pablovoice:vnext-surface-ready', syncSurface);
  for (const eventName of ['pablovoice:musical-plan-applied', 'pablovoice:stems-imported', 'pablovoice:project-updated', 'pablovoice:song-created']) {
    document.removeEventListener(eventName, onProjectMutation);
  }
  clearTimeout(runtime.graphTimer);
  clearTimeout(runtime.sectionHitTimer);
  stopBeatLoop();
  cancelMotion();
}

function onClick(event) {
  const manual = event.target.closest('[data-vnext-companion], [data-vnext-dock-companion]');
  if (manual) {
    const id = manual.dataset.vnextCompanion || manual.dataset.vnextDockCompanion;
    if (COMPANIONS[id]) runtime.activeCompanion = id;
    const bpm = resolveTempo(runtime.graph);
    runtime.manualUntil = performance.now() + (bpm ? (60_000 / bpm) * 8 : 4_800);
    syncSurface();
    return;
  }

  if (event.target.closest('[data-action="stop"]')) {
    setPlaying(false);
    return;
  }

  if (event.target.closest('[data-action="play"], [data-vnext-command="play"]')) {
    setTimeout(() => {
      const media = findPlayingMedia();
      setPlaying(media ? true : !runtime.playing);
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
  syncSurface();
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

function setPlaying(value) {
  const next = Boolean(value);
  if (runtime.playing === next) {
    syncSurface();
    return;
  }
  runtime.playing = next;
  if (next) {
    refreshGraph();
    scheduleBeatLoop(true);
  } else {
    stopBeatLoop();
    cancelMotion();
    syncSurface();
  }
}

function stopBeatLoop() {
  clearTimeout(runtime.beatTimer);
  runtime.beatTimer = 0;
}

function scheduleBeatLoop(immediate = false) {
  stopBeatLoop();
  if (!runtime.playing) return;
  const bpm = resolveTempo(runtime.graph);
  const beatMs = bpm ? clamp(60_000 / bpm, 250, 1_200) : 800;
  runtime.beatTimer = setTimeout(() => {
    reactToPlayback();
    scheduleBeatLoop(false);
  }, immediate ? 0 : beatMs);
}

function reactToPlayback() {
  const reaction = deriveCompanionReaction(runtime.graph, readPlayheadSeconds());
  if (performance.now() >= runtime.manualUntil) runtime.activeCompanion = reaction.companionId;
  const sectionChanged = Boolean(reaction.sectionId && reaction.sectionId !== runtime.lastSectionId);
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
  for (const value of [
    document.querySelector('#current-time')?.textContent,
    document.querySelector('[data-current-time]')?.textContent,
    document.querySelector('.pv-transport span')?.textContent,
  ]) {
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

function syncSurface() {
  if (runtime.playing) reactToPlayback();
  else renderIdleSurface();
}

function renderIdleSurface() {
  const visualizer = document.querySelector('[data-vnext-visualizer]');
  if (!visualizer) return;
  visualizer.dataset.vnextReactive = 'music-graph';
  visualizer.dataset.vnextReactionState = 'ready';
  delete visualizer.dataset.vnextBpm;
  delete visualizer.dataset.vnextBeatMs;
  visualizer.classList.remove('playing', 'section-hit');
  document.querySelectorAll('[data-vnext-dock-companion], [data-vnext-companion]').forEach((button) => button.classList.remove('music-reacting'));
  const spec = COMPANIONS[runtime.activeCompanion] || COMPANIONS.note;
  setText(visualizer.querySelector('[data-vnext-now-name]'), spec.name);
  setText(visualizer.querySelector('[data-vnext-now-base]'), spec.role);
  setText(visualizer.querySelector('[data-vnext-now-copy]'), 'PRONTO PARA TOCAR');
  setText(visualizer.querySelector('[data-vnext-visualizer-state]'), 'PRONTO');
}

function renderReaction(reaction, sectionChanged = false) {
  const visualizer = document.querySelector('[data-vnext-visualizer]');
  if (!visualizer) return;
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
  visualizer.dataset.vnextBeatMs = String(reaction.beatMs || 800);
  visualizer.classList.add('playing');

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

  syncBeatMotion(reaction.beatMs || 800, reaction.sectionKind);

  if (sectionChanged) {
    visualizer.classList.remove('section-hit');
    void visualizer.offsetWidth;
    visualizer.classList.add('section-hit');
    clearTimeout(runtime.sectionHitTimer);
    runtime.sectionHitTimer = setTimeout(() => visualizer.classList.remove('section-hit'), Math.max(280, reaction.beatMs || 800));
    document.dispatchEvent(new CustomEvent('pablovoice:companion-section-reaction', { detail: reaction }));
  }
  document.dispatchEvent(new CustomEvent('pablovoice:companion-beat-reaction', { detail: reaction }));
}

function syncBeatMotion(beatMs, sectionKind) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    cancelMotion();
    return;
  }
  const duration = clamp(Number(beatMs || 800), 250, 1_200);
  const motion = ['chorus', 'hook', 'postchorus'].includes(sectionKind) ? 1.25
    : ['prechorus', 'bridge', 'breakdown'].includes(sectionKind) ? 1.08
      : sectionKind === 'outro' ? 0.82 : 1;

  const sprite = document.querySelector('[data-vnext-active-sprite]');
  animateNode(sprite, 'lead', duration, [
    { transform: 'translate(-50%,-50%) scale(.99) rotate(-1deg)' },
    { transform: `translate(-50%,-56%) scale(${1.035 + 0.025 * motion}) rotate(1.5deg)`, offset: 0.28 },
    { transform: `translate(-50%,-48%) scale(${1.01 + 0.015 * motion}) rotate(-.5deg)`, offset: 0.58 },
    { transform: 'translate(-50%,-50%) scale(.99) rotate(-1deg)' },
  ]);

  [...document.querySelectorAll('[data-vnext-dock-companion]')].forEach((button, index) => {
    animateNode(button, 'dock', duration, [
      { transform: 'translateY(0) rotate(0)' },
      { transform: `translateY(${-2 - motion * 1.5}px) rotate(-.7deg)`, offset: 0.36 },
      { transform: 'translateY(1px) rotate(.5deg)', offset: 0.64 },
      { transform: 'translateY(0) rotate(0)' },
    ], -index * Math.min(80, duration / 8));
  });
}

function animateNode(node, kind, duration, keyframes, delay = 0) {
  if (!node?.animate) return;
  const signature = `${kind}:${Math.round(duration)}:${Math.round(delay)}`;
  if (node.dataset.pvMotionSignature === signature && runtime.animations.has(node)) return;
  runtime.animations.get(node)?.cancel();
  const animation = node.animate(keyframes, { duration, delay, iterations: Infinity, easing: 'ease-in-out' });
  runtime.animations.set(node, animation);
  node.dataset.pvMotionSignature = signature;
}

function cancelMotion() {
  for (const [node, animation] of runtime.animations) {
    animation.cancel();
    delete node.dataset.pvMotionSignature;
  }
  runtime.animations.clear();
}

function setText(node, value) {
  const next = String(value ?? '');
  if (node && node.textContent !== next) node.textContent = next;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export const PABLOVOICE_COMPANION_REACTION_POLICY = Object.freeze({
  source: 'project-music-graph',
  transportAware: true,
  sectionAware: true,
  tempoAware: true,
  fixedDecorativeCarousel: false,
  reducedMotionSafe: true,
  canonicalCompanionAssetsOnly: true,
  cspSafeMotion: 'web-animations-api',
  noMutationObserver: true,
});
