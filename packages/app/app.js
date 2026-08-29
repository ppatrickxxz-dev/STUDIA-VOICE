import { createId, createProject, createTrack, snapshotProject } from './core/src/project.mjs';
import { EFFECT_LABELS, EXPORT_PRESETS, encodeWav } from './audio/src/presets.mjs';
import { analyzeLyrics, rhymeSuggestions, classifyStructure } from './songwriting/src/analyzer.mjs';
import {
  deleteProject as deleteStoredProject,
  getAudioAsset,
  getProject,
  listProjects,
  saveAudioAsset,
  saveProject as persistProject,
} from './storage.mjs';
import { RecordingAdapter } from './recording.mjs';
import { PabloAudioEngine } from './audio-engine.mjs';

const VERSION = '2.4.0-rc.1';
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const app = document.querySelector('#app');
const picker = document.querySelector('#audio-picker');
const engine = new PabloAudioEngine();
const recorder = new RecordingAdapter();
const waveformWorker = new Worker('./workers/waveform-worker.js');
const waveCache = new Map();

const state = {
  route: 'home',
  studioTab: 'edit',
  project: null,
  projects: [],
  cursor: 0,
  playbackMode: 'processed',
  recording: false,
  recordStartedAt: 0,
  recordTimer: 0,
  busy: null,
  modal: null,
  songwriting: analyzeLyrics(''),
  rhymeWord: '',
  rhymeResults: [],
  bootMs: 0,
  lastDecodeMs: 0,
  lastRenderMs: 0,
};

const capabilities = Object.freeze([
  ['Importação e decode', true, 'WebAudio local'],
  ['Waveform e playback', true, 'local'],
  ['Gravação', true, recorder.platform === 'android' ? 'AudioRecord nativo' : 'MediaRecorder Web'],
  ['Edição não destrutiva', true, 'local'],
  ['Voice Lab', true, 'processamento WebAudio'],
  ['Projetos', true, 'IndexedDB local'],
  ['Exportação WAV', true, 'render local 16-bit'],
  ['Songwriting', true, 'análise PT-BR local'],
  ['IA generativa', false, 'provider seguro não configurado'],
  ['Separação de stems', false, 'runtime de modelo não configurado'],
  ['Conversão vocal', false, 'modelo mantido fora do app'],
]);

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function formatTime(value = 0) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
}

function activeTrack() {
  return state.project?.tracks.find((track) => track.id === state.project.activeTrackId) || state.project?.tracks[0] || null;
}

function companionMarkup(compact = false) {
  return `<div class="pv-companion ${compact ? 'compact' : ''}" data-state="${state.recording ? 'listen' : engine.playing ? 'speak' : 'idle'}">
    <div class="pv-device" aria-label="Pablo, companheiro do estúdio">
      <div class="pv-device-top">PABLO<small>VOICE</small></div>
      <div class="pv-screen"><div class="pv-screen-glow"></div><div class="pv-pablo">
        <i class="hair h1"></i><i class="hair h2"></i><i class="hair h3"></i>
        <i class="ear left"></i><i class="ear right"></i><div class="face"><i class="brow left"></i><i class="brow right"></i><i class="eye left"></i><i class="eye right"></i><i class="nose"></i><i class="mouth"></i></div>
      </div></div>
      <div class="pv-device-controls"><i></i><b></b><b></b></div>
    </div>
    <div class="pv-companion-status"><span class="pv-live-dot"></span>${state.recording ? 'ouvindo sua voz' : engine.playing ? 'tocando no Studio' : 'pronto no aparelho'}</div>
  </div>`;
}

function shell(content) {
  return `<div class="pv-shell">
    <header class="pv-top">
      <button class="pv-brand" data-action="home" aria-label="Ir ao início"><span>PV</span> PABLOVOICE <small>${VERSION}</small></button>
      <div class="pv-top-actions"><span class="pv-health connected"><span></span>local pronto</span><button class="pv-icon-btn" data-action="settings" aria-label="Abrir configurações">⚙</button></div>
    </header>
    <main>${content}</main>
  </div>
  <nav class="pv-nav" aria-label="Navegação principal">
    ${navButton('home', '⌂', 'Início')}${navButton('studio', '◉', 'Studio')}${navButton('projects', '▤', 'Projetos')}${navButton('compose', '✎', 'Compor')}${navButton('pablo', '✦', 'Pablo')}
  </nav>${modalView()}`;
}

function navButton(route, icon, label) {
  return `<button class="${state.route === route ? 'active' : ''}" data-route="${route}" aria-label="${label}"><b>${icon}</b><span>${label}</span></button>`;
}

function navigate(route, push = true) {
  if (route !== 'studio' && engine.playing) state.cursor = engine.stop(true);
  state.route = route;
  if (push) history.pushState({ route }, '', route === 'home' ? '#/' : `#/${route}`);
  render();
}

function homeView() {
  const project = state.project;
  return `<section class="pv-hero"><div class="pv-kicker">PabloVoice · estúdio local</div><h1 class="pv-title">Você tá no <em>estúdio</em></h1><p class="pv-lead">Sua ideia ganha som. Grave, importe, edite e exporte sem depender de login ou servidor.</p></section>
  <div class="pv-grid pv-home-grid"><article class="pv-card chrome"><div class="pv-card-head"><div><h2>${project ? 'Continue de onde parou' : 'Comece uma ideia'}</h2><p>${project ? `${esc(project.name)} · ${project.tracks.length} faixa(s)` : 'O projeto e os áudios ficam neste aparelho.'}</p></div><span class="pv-tag ok">LOCAL</span></div>
    ${project ? `<button class="pv-project-now" data-route="studio"><span class="pv-album">♫</span><span><b>${esc(project.name)}</b><small>${project.tracks.length ? esc(activeTrack()?.name || 'Studio pronto') : 'Pronto para receber áudio'}</small></span><i>›</i></button>` : ''}
    <div class="pv-quick"><button class="pv-btn" data-action="new-project">＋ <span>Novo projeto<small>nome e histórico local</small></span></button><button class="pv-btn" data-action="import">↥ <span>Importar áudio<small>WAV, MP3, M4A, OGG e mais</small></span></button><button class="pv-btn record" data-action="record">● <span>Gravar voz<small>${recorder.platform === 'android' ? 'captura nativa' : 'microfone do navegador'}</small></span></button><button class="pv-btn" data-route="projects">▤ <span>Meus projetos<small>salvar, fechar e reabrir</small></span></button></div>
  </article><article class="pv-card companion-card">${companionMarkup()}</article></div>
  <article class="pv-card pv-cap-card"><div class="pv-card-head"><div><h3>Ferramentas desta versão</h3><p>Recursos externos ficam identificados, nunca simulados.</p></div></div><div class="pv-chip-list">${capabilities.map(([name, ok]) => `<span class="pv-chip ${ok ? 'on' : 'off'}">${ok ? '✓' : '—'} ${esc(name)}</span>`).join('')}</div></article>`;
}

function studioView() {
  if (!state.project) return emptyProjectView('Studio');
  const track = activeTrack();
  return `<section class="pv-hero compact"><div class="pv-kicker">Studio · não destrutivo</div><h1 class="pv-title">${esc(state.project.name)}</h1><p class="pv-lead">${track ? esc(track.name) : 'Importe ou grave uma faixa para começar.'}</p></section>
  <div class="pv-studio-actions"><button class="pv-btn" data-action="import">↥ Importar</button><button class="pv-btn record" data-action="record">● Gravar</button><button class="pv-btn" data-action="save">Salvar</button><button class="pv-btn primary" data-action="export" ${track ? '' : 'disabled'}>Exportar WAV</button></div>
  <article class="pv-card chrome pv-transport-card"><canvas id="waveform" class="pv-wave-canvas" data-action="seek" aria-label="Forma de onda"></canvas>${track ? `<div class="pv-transport"><span id="current-time">${formatTime(state.cursor)}</span><button class="pv-play" data-action="play" aria-label="${engine.playing ? 'Pausar' : 'Reproduzir'}">${engine.playing ? '❚❚' : '▶'}</button><button class="pv-stop" data-action="stop" aria-label="Parar">■</button><span>${formatTime(engine.duration(state.project))}</span></div><div class="pv-ab-switch" aria-label="Comparação A/B"><button class="${state.playbackMode === 'original' ? 'active' : ''}" data-action="ab" data-value="original">A · Original</button><button class="${state.playbackMode === 'processed' ? 'active' : ''}" data-action="ab" data-value="processed">B · Processado</button></div>` : '<div class="pv-empty">Seu áudio aparece aqui.<div class="pv-actions"><button class="pv-btn primary" data-action="import">Importar áudio</button><button class="pv-btn record" data-action="record">● Gravar voz</button></div></div>'}</article>
  ${track ? `<div class="pv-tabs" role="tablist">${studioTab('edit', 'Editar')}${studioTab('voice', 'Voice Lab')}${studioTab('mixer', 'Mixer')}${studioTab('export', 'Exportar')}</div>${studioPanel(track)}` : ''}`;
}

function studioTab(tab, label) {
  return `<button class="${state.studioTab === tab ? 'active' : ''}" data-action="studio-tab" data-value="${tab}" role="tab">${label}</button>`;
}

function studioPanel(track) {
  if (state.studioTab === 'voice') return voicePanel(track);
  if (state.studioTab === 'mixer') return mixerPanel();
  if (state.studioTab === 'export') return exportPanel();
  return editPanel(track);
}

function editPanel(track) {
  return `<div class="pv-grid equal pv-panel-grid"><article class="pv-card"><div class="pv-card-head"><div><h3>Corte e volume</h3><p>O arquivo original permanece preservado.</p></div><span class="pv-tag ok">reversível</span></div>
    ${range('trimStart', 'Começo', track.trimStart, 0, track.duration, 0.01, formatTime(track.trimStart))}
    ${range('trimEnd', 'Fim', track.trimEnd, 0, track.duration, 0.01, formatTime(track.trimEnd))}
    ${range('gain', 'Volume', track.gain, 0, 2, 0.01, `${Math.round(track.gain * 100)}%`)}</article>
    <article class="pv-card"><div class="pv-card-head"><div><h3>Entradas e saídas</h3><p>Fades renderizados também na prévia B.</p></div></div>${range('fadeIn', 'Fade in', track.effects.fadeIn, 0, Math.min(10, track.duration / 2), 0.05, `${Number(track.effects.fadeIn).toFixed(1)} s`)}${range('fadeOut', 'Fade out', track.effects.fadeOut, 0, Math.min(10, track.duration / 2), 0.05, `${Number(track.effects.fadeOut).toFixed(1)} s`)}<div class="pv-status ok">A/B ativo: os efeitos são ouvidos antes da exportação.</div></article></div>`;
}

function voicePanel(track) {
  const toggles = ['clean', 'compressor', 'deEsser', 'warm', 'presence', 'normalize', 'double'];
  return `<div class="pv-grid equal pv-panel-grid"><article class="pv-card"><div class="pv-card-head"><div><h3>Tratamento vocal</h3><p>Camada audível e não destrutiva.</p></div><span class="pv-tag">A/B</span></div><div class="pv-chip-list pv-effect-list">${toggles.map((key) => `<button class="pv-chip ${track.effects[key] ? 'on' : ''}" data-action="effect" data-value="${key}">${track.effects[key] ? '✓' : '＋'} ${EFFECT_LABELS[key]}</button>`).join('')}</div><div class="pv-note">“Limpar voz” combina corte de graves, redução de lama, compressão e clareza. Não é rotulado como denoise neural.</div></article>
  <article class="pv-card"><h3>Cor e afinação</h3>${range('lowEq', 'EQ grave', track.effects.lowEq, -12, 12, 0.5, `${Number(track.effects.lowEq).toFixed(1)} dB`)}${range('midEq', 'EQ médio', track.effects.midEq, -12, 12, 0.5, `${Number(track.effects.midEq).toFixed(1)} dB`)}${range('highEq', 'EQ agudo', track.effects.highEq, -12, 12, 0.5, `${Number(track.effects.highEq).toFixed(1)} dB`)}${range('saturation', 'Saturação', track.effects.saturation, 0, 1, 0.01, `${Math.round(track.effects.saturation * 100)}%`)}${range('pitchSemitones', 'Pitch', track.effects.pitchSemitones, -6, 6, 1, `${Number(track.effects.pitchSemitones) > 0 ? '+' : ''}${track.effects.pitchSemitones} st`)}<div class="pv-note">Pitch altera altura e duração. Formant e conversão vocal permanecem bloqueados até existir runtime seguro.</div></article></div>`;
}

function mixerPanel() {
  return `<article class="pv-card"><div class="pv-card-head"><div><h3>Mixer multipista</h3><p>Mute, solo, ganho e panorama entram na prévia e no render.</p></div><span class="pv-tag ok">${state.project.tracks.length} faixa(s)</span></div><div class="pv-track-list">${state.project.tracks.map(trackRow).join('')}</div></article>`;
}

function trackRow(track) {
  return `<div class="pv-track ${track.id === state.project.activeTrackId ? 'selected' : ''}"><button class="pv-track-main" data-action="select-track" data-id="${track.id}"><span class="pv-track-icon">${track.kind === 'recording' ? '●' : '♫'}</span><span><b>${esc(track.name)}</b><small>${formatTime(track.duration)} · ${Math.round(track.sampleRate / 1000)} kHz</small></span></button><div class="pv-track-buttons"><button class="${track.muted ? 'on' : ''}" data-action="mute" data-id="${track.id}" aria-label="Mute">M</button><button class="${track.solo ? 'on' : ''}" data-action="solo" data-id="${track.id}" aria-label="Solo">S</button><button data-action="export-track" data-id="${track.id}" aria-label="Exportar ${esc(track.name)} processada">⇩</button></div><div class="pv-mixer-ranges">${range('trackGain', 'Volume', track.gain, 0, 2, 0.01, `${Math.round(track.gain * 100)}%`, track.id)}${range('pan', 'Pan', track.pan, -1, 1, 0.01, Number(track.pan).toFixed(2), track.id)}</div></div>`;
}

function exportPanel() {
  const preset = state.project.preset;
  return `<article class="pv-card"><div class="pv-card-head"><div><h3>Exportar áudio processado</h3><p>Render real das faixas, cortes, ganho, panorama, efeitos e tratamentos regionais salvos.</p></div><span class="pv-tag">WAV PCM 16-bit</span></div><div class="pv-preset-grid">${Object.entries(EXPORT_PRESETS).map(([key, value]) => `<button class="pv-preset ${preset === key ? 'active' : ''}" data-action="preset" data-value="${key}"><b>${value.label}</b><span>${value.sampleRate / 1000} kHz · pico ${value.peak}</span></button>`).join('')}</div><div class="pv-actions"><button class="pv-btn primary" data-action="export">Renderizar mix WAV</button>${state.project.tracks.map((track) => `<button class="pv-btn" data-action="export-track" data-id="${track.id}">Exportar ${esc(track.name)}</button>`).join('')}</div><div class="pv-note">Cada faixa é exportada alinhada à timeline e usa o mesmo caminho processado da prévia B. MP3, AAC e M4A continuam bloqueados até existir encoder real.</div></article>`;
}

function range(key, label, value, min, max, step, display, trackId = '') {
  return `<div class="pv-range"><label><span>${label}</span><output data-output="${key}" ${trackId ? `data-id="${trackId}"` : ''}>${display}</output></label><input type="range" min="${min}" max="${max}" step="${step}" value="${Number(value) || 0}" data-control="${key}" ${trackId ? `data-id="${trackId}"` : ''}></div>`;
}

function projectsView() {
  return `<section class="pv-hero compact"><div class="pv-kicker">Projetos & versões</div><h1 class="pv-title">Volte sem <em>perder o som.</em></h1><p class="pv-lead">Arquivos, edições e histórico ficam salvos no armazenamento local.</p></section><article class="pv-card chrome"><div class="pv-card-head"><div><h3>Biblioteca local</h3><p>${state.projects.length} projeto(s) neste aparelho.</p></div><button class="pv-btn primary" data-action="new-project">＋ Novo</button></div><div class="pv-list">${state.projects.length ? state.projects.map((project) => `<div class="pv-row"><button class="pv-row-main" data-action="open-project" data-id="${project.id}"><b>${esc(project.name)}</b><span>${project.tracks.length} faixa(s) · ${new Date(project.updatedAt).toLocaleString('pt-BR')}</span></button><span class="pv-tag ${state.project?.id === project.id ? 'ok' : ''}">${state.project?.id === project.id ? 'aberto' : 'local'}</span><button class="pv-icon-btn danger" data-action="delete-project" data-id="${project.id}" aria-label="Excluir ${esc(project.name)}">×</button></div>`).join('') : '<div class="pv-empty">Nenhum projeto salvo ainda.</div>'}</div></article>`;
}

function composeView() {
  const analysis = state.songwriting;
  return `<section class="pv-hero compact"><div class="pv-kicker">Songwriting Engine · PT-BR</div><h1 class="pv-title">Escreva com sua <em>própria voz.</em></h1><p class="pv-lead">Métrica, rima e cantabilidade são analisadas localmente; o texto não é enviado para um provider.</p></section><div class="pv-grid"><article class="pv-card chrome"><label class="pv-text-label" for="lyrics">Letra do projeto</label><textarea id="lyrics" class="pv-textarea" data-control="lyrics" placeholder="[Verso]\nEscreva sua ideia aqui…">${esc(state.project?.lyrics || '')}</textarea><div class="pv-actions"><button class="pv-btn" data-action="save">Salvar letra</button><button class="pv-btn" data-action="insert-structure">＋ Estrutura</button></div></article><article class="pv-card"><div class="pv-stat-grid"><div class="pv-stat"><strong>${analysis.targetSyllables}</strong><span>métrica central</span></div><div class="pv-stat"><strong>${analysis.meterConsistency}%</strong><span>consistência</span></div><div class="pv-stat"><strong>${analysis.rhymeCoverage}%</strong><span>rimas</span></div><div class="pv-stat"><strong>${analysis.singability}</strong><span>cantabilidade</span></div></div><div class="pv-tips">${analysis.suggestions.map((tip) => `<div class="pv-tip">${esc(tip)}</div>`).join('')}</div></article></div>
  <div class="pv-grid equal pv-panel-grid"><article class="pv-card"><h3>Mapa de linhas</h3><div class="pv-line-map">${analysis.lines.length ? analysis.lines.map((line) => `<div><span>${line.index + 1}</span><b>${esc(line.content)}</b><small>${line.syllables} sílabas · final “${esc(line.rhyme)}”</small></div>`).join('') : '<p class="muted">A análise aparece enquanto você escreve.</p>'}</div></article><article class="pv-card"><h3>Inteligência de rima</h3><div class="pv-compose-row"><input id="rhyme-word" value="${esc(state.rhymeWord)}" placeholder="Ex.: coração"><button class="pv-btn" data-action="find-rhymes">Buscar</button></div><div class="pv-chip-list">${state.rhymeResults.length ? state.rhymeResults.map((word) => `<button class="pv-chip on" data-action="copy-rhyme" data-value="${esc(word)}">${esc(word)}</button>`).join('') : '<span class="muted">Dicionário local por família sonora.</span>'}</div><div class="pv-note">Estrutura detectada: ${classifyStructure(state.project?.lyrics || '').join(' → ')}.</div></article></div>`;
}

function pabloView() {
  const project = state.project;
  const track = activeTrack();
  const tips = [];
  if (!project) tips.push('Crie um projeto para eu ler o estado do Studio.');
  else if (!track) tips.push('Importe uma base ou grave uma voz para começar o trabalho de áudio.');
  else {
    if (track.effects.clean) tips.push('A limpeza vocal está ativa. Compare A e B antes de aumentar outros efeitos.');
    if (track.gain > 1.35) tips.push('O ganho da faixa está alto; confira o mix para evitar limitação excessiva.');
    if (!project.lyrics.trim()) tips.push('A composição ainda está vazia. O módulo PT-BR pode medir métrica e rima localmente.');
    if (project.tracks.length > 1) tips.push(`O mixer tem ${project.tracks.length} faixas. Use Solo para revisar uma camada por vez.`);
  }
  return `<section class="pv-hero compact"><div class="pv-kicker">Pablo · assistente local</div><h1 class="pv-title">Contexto real, <em>sem fingimento.</em></h1><p class="pv-lead">Nesta release, Pablo lê o estado local e sugere próximos ajustes determinísticos. IA online só aparece quando houver provider seguro e saudável.</p></section><div class="pv-chat-shell"><article class="pv-card chrome"><div class="pv-tips">${tips.map((tip) => `<div class="pv-msg assistant">${esc(tip)}<small>análise local do projeto</small></div>`).join('')}</div><div class="pv-actions"><button class="pv-btn" data-route="studio">Abrir Studio</button><button class="pv-btn" data-route="compose">Abrir composição</button></div></article>${companionMarkup(true)}</div><article class="pv-card pv-panel-grid"><div class="pv-card-head"><div><h3>Capacidades</h3><p>Estado verificável desta build.</p></div></div><div class="pv-cap-table">${capabilities.map(([name, ok, engineName]) => `<div><b>${esc(name)}</b><span>${esc(engineName)}</span><em class="${ok ? 'ok' : 'off'}">${ok ? 'ATIVO' : 'INDISPONÍVEL'}</em></div>`).join('')}</div></article>`;
}

function emptyProjectView(area) {
  return `<section class="pv-hero"><div class="pv-kicker">${area}</div><h1 class="pv-title">Primeiro, uma <em>ideia.</em></h1><p class="pv-lead">Crie um projeto local para manter arquivos, edições e versões juntos.</p><div class="pv-actions"><button class="pv-btn primary" data-action="new-project">Criar projeto</button><button class="pv-btn" data-action="import">Importar e criar</button></div></section>`;
}

function modalView() {
  if (state.modal === 'new') return `<div class="pv-modal-back"><form class="pv-modal" data-form="new-project"><h2>Novo projeto</h2><p>Use um nome que você reconheça depois.</p><input name="name" class="pv-field" value="Minha ideia" maxlength="80" autofocus><div class="pv-actions"><button type="button" class="pv-btn" data-action="close-modal">Cancelar</button><button class="pv-btn primary">Criar</button></div></form></div>`;
  if (state.modal === 'record') return `<div class="pv-modal-back"><div class="pv-modal"><div class="pv-record-dot"></div><h2>Gravando voz</h2><p>O áudio fica no aparelho e entra automaticamente no projeto.</p><div id="record-clock" class="pv-record-clock">0:00.0</div><div class="pv-actions"><button class="pv-btn" data-action="cancel-record">Cancelar</button><button class="pv-btn primary record" data-action="stop-record">■ Parar e usar</button></div></div></div>`;
  if (state.modal === 'settings') return `<div class="pv-modal-back"><div class="pv-modal wide"><div class="pv-card-head"><div><h2>PabloVoice ${VERSION}</h2><p>Build canônica Web + Android.</p></div><button class="pv-icon-btn" data-action="close-modal">×</button></div><div class="pv-cap-table">${capabilities.map(([name, ok, detail]) => `<div><b>${esc(name)}</b><span>${esc(detail)}</span><em class="${ok ? 'ok' : 'off'}">${ok ? 'PASS' : 'N/A'}</em></div>`).join('')}</div><div class="pv-metrics"><span>Boot <b>${Math.round(state.bootMs)} ms</b></span><span>Decode <b>${Math.round(state.lastDecodeMs)} ms</b></span><span>Render <b>${Math.round(state.lastRenderMs)} ms</b></span></div>${state.project?.revisions?.length ? `<h3>Histórico do projeto</h3><div class="pv-history">${[...state.project.revisions].reverse().slice(0, 10).map((revision) => `<div><b>${esc(revision.label)}</b><span>${new Date(revision.at).toLocaleString('pt-BR')}</span></div>`).join('')}</div>` : ''}</div></div>`;
  return '';
}

function view() {
  if (state.route === 'studio') return studioView();
  if (state.route === 'projects') return projectsView();
  if (state.route === 'compose') return composeView();
  if (state.route === 'pablo') return pabloView();
  return homeView();
}

function render() {
  app.innerHTML = shell(view());
  requestAnimationFrame(() => {
    drawWaveform();
    const name = document.querySelector('[data-form="new-project"] input');
    if (name) { name.focus(); name.select(); }
  });
}

function toast(message, type = '') {
  const wrap = document.querySelector('[data-toasts]');
  const element = document.createElement('div');
  element.className = `pv-toast ${type}`;
  element.textContent = message;
  wrap.appendChild(element);
  try { globalThis.PabloVoiceAndroid?.toast?.(message); } catch { /* browser path */ }
  setTimeout(() => element.remove(), 3000);
}

async function ensureProject() {
  if (state.project) return state.project;
  state.project = createProject(`Projeto ${new Date().toLocaleDateString('pt-BR')}`);
  state.project = await persistProject(state.project);
  await refreshProjects();
  return state.project;
}

async function refreshProjects() {
  state.projects = await listProjects();
  if (state.project) state.projects = state.projects.map((project) => project.id === state.project.id ? state.project : project);
}

async function createNamedProject(name) {
  engine.stop(false);
  state.project = createProject(name);
  state.project = await persistProject(state.project);
  state.cursor = 0;
  state.modal = null;
  state.route = 'studio';
  await refreshProjects();
  render();
  toast('Projeto criado no aparelho.', 'ok');
}

async function importFile(file, kind = 'audio') {
  if (!file) return;
  if (file.size <= 0) throw new Error('O arquivo está vazio.');
  if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo ultrapassa o limite local de 300 MB.');
  await ensureProject();
  const assetId = createId('asset');
  const provisional = createTrack({ name: file.name || 'Áudio importado', assetId, type: file.type, kind });
  const { buffer, decodeMs } = await engine.decode(provisional.id, file);
  state.lastDecodeMs = decodeMs;
  provisional.duration = buffer.duration;
  provisional.trimEnd = buffer.duration;
  provisional.sampleRate = buffer.sampleRate;
  provisional.channels = buffer.numberOfChannels;
  await saveAudioAsset({ id: assetId, blob: file, name: provisional.name, type: file.type });
  state.project.tracks.push(provisional);
  state.project.activeTrackId = provisional.id;
  state.project = snapshotProject(state.project, kind === 'recording' ? 'Gravação adicionada' : 'Áudio importado');
  state.project = await persistProject(state.project);
  state.cursor = 0;
  state.route = 'studio';
  state.studioTab = 'edit';
  waveCache.delete(provisional.id);
  await refreshProjects();
  render();
  toast(kind === 'recording' ? 'Gravação pronta no Studio.' : 'Áudio pronto no Studio.', 'ok');
}

async function openStoredProject(id, { route = 'studio', notify = true } = {}) {
  engine.stop(false);
  const project = await getProject(id);
  if (!project) throw new Error('Projeto não encontrado.');
  if (project.legacyAudioId && !project.tracks.length) {
    const legacy = await getAudioAsset(project.legacyAudioId);
    if (legacy?.blob) {
      const assetId = legacy.id;
      const track = createTrack({ name: legacy.name, assetId, type: legacy.type || legacy.blob.type });
      const { buffer } = await engine.decode(track.id, legacy.blob);
      track.duration = buffer.duration;
      track.trimStart = Number(project.legacySettings?.trimStart || 0);
      track.trimEnd = Number(project.legacySettings?.trimEnd || buffer.duration);
      track.gain = Number(project.legacySettings?.gain ?? 1);
      track.sampleRate = buffer.sampleRate;
      track.channels = buffer.numberOfChannels;
      track.effects = { ...track.effects, ...(project.legacySettings?.filters || {}) };
      project.tracks.push(track);
      project.activeTrackId = track.id;
      delete project.legacyAudioId;
      delete project.legacySettings;
      await persistProject(snapshotProject(project, 'Migração do projeto v2.3'));
    }
  }
  for (const track of project.tracks) {
    const asset = await getAudioAsset(track.assetId);
    if (!asset?.blob) continue;
    try { await engine.decode(track.id, asset.blob); }
    catch (error) { console.error('Decode project track', track.id, error); }
  }
  state.project = project;
  state.songwriting = analyzeLyrics(project.lyrics);
  state.cursor = 0;
  state.route = route;
  await refreshProjects();
  render();
  if (notify) toast('Projeto reaberto com o estado salvo.', 'ok');
}

async function consumeAndroidImport() {
  const bridge = globalThis.PabloVoiceAndroid;
  const size = Number(bridge?.pendingImportSize?.() || 0);
  if (!size) return;
  const bytes = new Uint8Array(size);
  const chunkSize = 48 * 1024;
  for (let offset = 0; offset < size; offset += chunkSize) {
    const encoded = bridge.pendingImportChunkBase64(offset, Math.min(chunkSize, size - offset));
    if (!encoded) throw new Error('Falha ao receber o áudio compartilhado.');
    const binary = atob(encoded);
    for (let index = 0; index < binary.length; index += 1) bytes[offset + index] = binary.charCodeAt(index);
  }
  const name = String(bridge.pendingImportName?.() || 'audio-compartilhado');
  const type = String(bridge.pendingImportMime?.() || 'application/octet-stream');
  await importFile(new File([bytes], name, { type }));
  bridge.clearPendingImport();
}

async function saveCurrent(label = 'Salvamento manual') {
  if (!state.project) return toast('Crie um projeto primeiro.', 'error');
  state.project = snapshotProject(state.project, label);
  state.project = await persistProject(state.project);
  await refreshProjects();
  render();
  toast('Projeto salvo neste aparelho.', 'ok');
}

async function exportMix() {
  if (!state.project?.tracks.length) throw new Error('Adicione uma faixa antes de exportar.');
  const projectBeforeExport = structuredClone(state.project);
  engine.stop(false);
  render();
  const started = performance.now();
  const buffer = await engine.render(projectBeforeExport, projectBeforeExport.preset);
  state.lastRenderMs = performance.now() - started;
  const blob = new Blob([encodeWav(buffer)], { type: 'audio/wav' });
  const projectName = projectBeforeExport.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'PabloVoice';
  const filename = `${projectName}-${projectBeforeExport.preset}.wav`;
  await saveBlob(blob, filename);
  toast(`WAV exportado · ${formatTime(buffer.duration)} · ${Math.round(buffer.sampleRate / 1000)} kHz`, 'ok');
}

async function exportTrack(trackId) {
  if (!state.project?.tracks.length) throw new Error('Adicione uma faixa antes de exportar.');
  const projectBeforeExport = structuredClone(state.project);
  const track = projectBeforeExport.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error('Faixa inválida para exportação.');
  engine.stop(false);
  render();
  const started = performance.now();
  const buffer = await engine.renderTrack(projectBeforeExport, track.id, projectBeforeExport.preset);
  state.lastRenderMs = performance.now() - started;
  const blob = new Blob([encodeWav(buffer)], { type: 'audio/wav' });
  const projectName = projectBeforeExport.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'PabloVoice';
  const trackName = track.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'Faixa';
  await saveBlob(blob, `${projectName}-${trackName}-${projectBeforeExport.preset}.wav`);
  toast(`Faixa processada exportada · ${track.name} · ${formatTime(buffer.duration)}`, 'ok');
}

async function saveBlob(blob, filename) {
  const bridge = globalThis.PabloVoiceAndroid;
  if (bridge?.beginSave) {
    if (!bridge.beginSave(filename, blob.type)) throw new Error('O Android não iniciou o salvamento.');
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const chunkSize = 48 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const part = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
        let binary = '';
        for (const byte of part) binary += String.fromCharCode(byte);
        if (!bridge.appendBase64(btoa(binary))) throw new Error('Falha durante a gravação do arquivo.');
      }
      if (!bridge.finishSave()) throw new Error('O Android não concluiu o arquivo.');
      return;
    } catch (error) {
      bridge.abortSave();
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function startRecording() {
  await ensureProject();
  try {
    await recorder.start();
    state.recording = true;
    state.recordStartedAt = Date.now();
    state.modal = 'record';
    render();
    state.recordTimer = window.setInterval(() => {
      const clock = document.querySelector('#record-clock');
      if (clock) clock.textContent = formatTime((Date.now() - state.recordStartedAt) / 1000);
    }, 100);
    toast('Gravando…');
  } catch (error) {
    if (error.code !== 'PERMISSION_PENDING') toast(error.message, 'error');
  }
}

async function stopRecording() {
  clearInterval(state.recordTimer);
  state.recording = false;
  state.modal = null;
  render();
  const blob = await recorder.stop();
  const extension = blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const name = `voz-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
  await importFile(new File([blob], name, { type: blob.type }), 'recording');
}

async function cancelRecording() {
  clearInterval(state.recordTimer);
  await recorder.cancel();
  state.recording = false;
  state.modal = null;
  render();
  toast('Gravação cancelada.');
}

async function togglePlayback() {
  if (engine.playing) {
    state.cursor = engine.stop(true);
    render();
    return;
  }
  await engine.play(state.project, {
    position: state.cursor,
    mode: state.playbackMode,
    onTime: (position) => {
      state.cursor = position;
      const label = document.querySelector('#current-time');
      if (label) label.textContent = formatTime(position);
      drawPlayhead(position);
    },
    onEnded: render,
  });
  render();
}

async function restartPreview() {
  if (!engine.playing) return;
  const position = engine.position();
  engine.stop(false);
  state.cursor = position;
  await togglePlayback();
}

function updateTrack(id, updater, restart = true) {
  const track = state.project?.tracks.find((candidate) => candidate.id === id);
  if (!track) return;
  updater(track);
  track.updatedAt = Date.now();
  scheduleAutosave();
  if (restart) restartPreview().catch((error) => toast(error.message, 'error'));
}

let autosaveTimer;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    if (!state.project) return;
    state.project.updatedAt = Date.now();
    state.project = await persistProject(state.project);
    await refreshProjects();
  }, 500);
}

function drawWaveform() {
  const canvas = document.querySelector('#waveform');
  const track = activeTrack();
  const buffer = track && engine.getBuffer(track.id);
  if (!canvas || !track || !buffer) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(100, Math.floor(rect.width * Math.min(2, devicePixelRatio || 1)));
  const cacheKey = `${track.id}:${width}`;
  if (waveCache.has(cacheKey)) return paintWave(canvas, track, waveCache.get(cacheKey));
  const id = `${cacheKey}:${Date.now()}`;
  const samples = buffer.getChannelData(0).slice().buffer;
  waveformWorker.postMessage({ id, samples, width }, [samples]);
  waveformWorker.addEventListener('message', function response(event) {
    if (event.data.id !== id) return;
    waveformWorker.removeEventListener('message', response);
    const peaks = new Float32Array(event.data.peaks);
    waveCache.set(cacheKey, peaks);
    const current = document.querySelector('#waveform');
    if (current && activeTrack()?.id === track.id) paintWave(current, track, peaks);
  });
  canvas.onclick = seekFromCanvas;
}

function paintWave(canvas, track, peaks) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  context.fillStyle = '#090b11'; context.fillRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#53d8ff'); gradient.addColorStop(0.45, '#955dff'); gradient.addColorStop(1, '#e679c7');
  context.strokeStyle = gradient; context.lineWidth = Math.max(1, dpr); context.beginPath();
  const columns = peaks.length / 2;
  for (let column = 0; column < columns; column += 1) {
    const x = (column / columns) * width;
    context.moveTo(x, height / 2 + peaks[column * 2] * height * 0.42);
    context.lineTo(x, height / 2 + peaks[column * 2 + 1] * height * 0.42);
  }
  context.stroke();
  const start = (track.trimStart / track.duration) * width;
  const end = (track.trimEnd / track.duration) * width;
  context.fillStyle = 'rgba(0,0,0,.62)'; context.fillRect(0, 0, start, height); context.fillRect(end, 0, width - end, height);
  context.strokeStyle = '#c7a7ff'; context.lineWidth = 2 * dpr; context.strokeRect(start, 1, Math.max(1, end - start), height - 2);
  drawPlayhead(state.cursor);
}

function drawPlayhead(position) {
  const canvas = document.querySelector('#waveform');
  const track = activeTrack();
  if (!canvas || !track) return;
  const cacheKey = [...waveCache.keys()].find((key) => key.startsWith(`${track.id}:`));
  if (!cacheKey) return;
  paintWaveBase(canvas, track, waveCache.get(cacheKey), position);
}

function paintWaveBase(canvas, track, peaks, position) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  context.fillStyle = '#090b11'; context.fillRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#53d8ff'); gradient.addColorStop(0.45, '#955dff'); gradient.addColorStop(1, '#e679c7');
  context.strokeStyle = gradient; context.lineWidth = Math.max(1, Math.min(2, devicePixelRatio || 1)); context.beginPath();
  const columns = peaks.length / 2;
  for (let column = 0; column < columns; column += 1) {
    const x = (column / columns) * width;
    context.moveTo(x, height / 2 + peaks[column * 2] * height * 0.42);
    context.lineTo(x, height / 2 + peaks[column * 2 + 1] * height * 0.42);
  }
  context.stroke();
  const start = (track.trimStart / track.duration) * width;
  const end = (track.trimEnd / track.duration) * width;
  context.fillStyle = 'rgba(0,0,0,.62)'; context.fillRect(0, 0, start, height); context.fillRect(end, 0, width - end, height);
  context.strokeStyle = '#c7a7ff'; context.lineWidth = 2; context.strokeRect(start, 1, Math.max(1, end - start), height - 2);
  const projectDuration = Math.max(0.01, engine.duration(state.project));
  const x = (position / projectDuration) * width;
  context.strokeStyle = '#ffffff'; context.lineWidth = 1.5; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
}

function seekFromCanvas(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  state.cursor = Math.max(0, Math.min(engine.duration(state.project), ((event.clientX - rect.left) / rect.width) * engine.duration(state.project)));
  if (engine.playing) restartPreview(); else drawPlayhead(state.cursor);
  const label = document.querySelector('#current-time');
  if (label) label.textContent = formatTime(state.cursor);
}

async function withBusy(name, task) {
  if (state.busy) return;
  state.busy = name;
  document.querySelector(`[data-action="${name}"]`)?.classList.add('busy');
  try { await task(); }
  catch (error) { console.error(error); toast(error.message || 'A operação falhou.', 'error'); }
  finally { state.busy = null; document.querySelector(`[data-action="${name}"]`)?.classList.remove('busy'); }
}

document.addEventListener('click', (event) => {
  const route = event.target.closest('[data-route]')?.dataset.route;
  if (route) {
    navigate(route); return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const { action, value, id } = target.dataset;
  if (action === 'home') navigate('home');
  else if (action === 'settings') { state.modal = 'settings'; render(); }
  else if (action === 'close-modal') { state.modal = null; render(); }
  else if (action === 'new-project') { state.modal = 'new'; render(); }
  else if (action === 'import') picker.click();
  else if (action === 'record') withBusy('record', startRecording);
  else if (action === 'stop-record') withBusy('stop-record', stopRecording);
  else if (action === 'cancel-record') withBusy('cancel-record', cancelRecording);
  else if (action === 'play') withBusy('play', togglePlayback);
  else if (action === 'stop') { state.cursor = 0; engine.stop(false); render(); }
  else if (action === 'save') withBusy('save', () => saveCurrent());
  else if (action === 'export') withBusy('export', exportMix);
  else if (action === 'export-track') withBusy('export-track', () => exportTrack(id));
  else if (action === 'studio-tab') { state.studioTab = value; render(); }
  else if (action === 'ab') { state.playbackMode = value; render(); restartPreview(); }
  else if (action === 'effect') { const track = activeTrack(); updateTrack(track.id, (item) => { item.effects[value] = !item.effects[value]; }); render(); }
  else if (action === 'preset') { state.project.preset = value; scheduleAutosave(); render(); }
  else if (action === 'select-track') { state.project.activeTrackId = id; state.cursor = 0; engine.stop(false); scheduleAutosave(); render(); }
  else if (action === 'mute') { updateTrack(id, (track) => { track.muted = !track.muted; }); render(); }
  else if (action === 'solo') { updateTrack(id, (track) => { track.solo = !track.solo; }); render(); }
  else if (action === 'open-project') withBusy('open-project', () => openStoredProject(id));
  else if (action === 'delete-project') {
    if (confirm('Excluir este projeto e seus arquivos locais?')) withBusy('delete-project', async () => {
      await deleteStoredProject(id);
      if (state.project?.id === id) { state.project = null; engine.stop(false); }
      await refreshProjects(); render(); toast('Projeto excluído.');
    });
  }
  else if (action === 'find-rhymes') {
    state.rhymeWord = document.querySelector('#rhyme-word')?.value.trim() || '';
    state.rhymeResults = rhymeSuggestions(state.rhymeWord);
    render();
  }
  else if (action === 'copy-rhyme') { navigator.clipboard?.writeText(value); toast(`“${value}” copiado.`); }
  else if (action === 'insert-structure') {
    ensureProject().then(() => {
      if (!state.project.lyrics.trim()) state.project.lyrics = '[Verso]\n\n[Pré-refrão]\n\n[Refrão]\n\n[Ponte]\n';
      state.songwriting = analyzeLyrics(state.project.lyrics); scheduleAutosave(); render();
    });
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.dataset.form !== 'new-project') return;
  event.preventDefault();
  createNamedProject(new FormData(event.target).get('name') || 'Minha ideia').catch((error) => toast(error.message, 'error'));
});

document.addEventListener('input', (event) => {
  const key = event.target.dataset.control;
  if (!key) return;
  if (key === 'lyrics') {
    ensureProject().then(() => {
      state.project.lyrics = event.target.value;
      state.songwriting = analyzeLyrics(event.target.value);
      scheduleAutosave();
      const selection = event.target.selectionStart;
      render();
      const next = document.querySelector('#lyrics');
      next?.focus(); next?.setSelectionRange(selection, selection);
    });
    return;
  }
  const id = event.target.dataset.id || activeTrack()?.id;
  const number = Number(event.target.value);
  updateTrack(id, (track) => {
    if (key === 'trimStart') track.trimStart = Math.min(number, track.trimEnd - 0.01);
    else if (key === 'trimEnd') track.trimEnd = Math.max(number, track.trimStart + 0.01);
    else if (key === 'gain' || key === 'trackGain') track.gain = number;
    else if (key === 'pan') track.pan = number;
    else track.effects[key] = number;
  });
  const output = document.querySelector(`[data-output="${key}"]${id ? `[data-id="${id}"]` : ''}`) || document.querySelector(`[data-output="${key}"]`);
  if (output) output.textContent = key.startsWith('trim') ? formatTime(number) : key === 'gain' || key === 'trackGain' ? `${Math.round(number * 100)}%` : key === 'pan' ? number.toFixed(2) : key.startsWith('fade') ? `${number.toFixed(1)} s` : key === 'saturation' ? `${Math.round(number * 100)}%` : key === 'pitchSemitones' ? `${number > 0 ? '+' : ''}${number} st` : `${number.toFixed(1)} dB`;
  if (key.startsWith('trim')) drawWaveform();
});

picker.addEventListener('change', () => {
  const file = picker.files?.[0];
  picker.value = '';
  if (file) withBusy('import', () => importFile(file));
});

globalThis.PabloVoiceOnMicPermission = (granted) => {
  if (!granted) return toast('Permissão de microfone negada.', 'error');
  toast('Microfone autorizado.');
  startRecording();
};

globalThis.PabloVoiceConsumeAndroidImport = () => withBusy('import', consumeAndroidImport);

window.addEventListener('popstate', (event) => {
  const route = event.state?.route || location.hash.replace(/^#\//, '') || 'home';
  state.route = ['home', 'studio', 'projects', 'compose', 'pablo'].includes(route) ? route : 'home';
  render();
});

window.addEventListener('resize', () => { waveCache.clear(); drawWaveform(); });
window.addEventListener('beforeunload', () => { engine.stop(false); if (recorder.active) recorder.cancel(); });

async function boot() {
  const started = performance.now();
  try {
    await refreshProjects();
    if (state.projects[0]) await openStoredProject(state.projects[0].id, { route: 'home', notify: false });
    else render();
    history.replaceState({ route: state.route }, '', state.route === 'home' ? '#/' : `#/${state.route}`);
    if (globalThis.PabloVoiceAndroid?.pendingImportSize?.() > 0) await consumeAndroidImport();
    if ('serviceWorker' in navigator && location.protocol !== 'file:' && recorder.platform !== 'android') {
      window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.warn), { once: true });
    }
  } catch (error) {
    console.error(error);
    render();
    toast('O Studio abriu, mas não conseguiu restaurar o último projeto.', 'error');
  } finally {
    state.bootMs = performance.now() - started;
    document.documentElement.dataset.pvReady = 'true';
  }
}

boot();
