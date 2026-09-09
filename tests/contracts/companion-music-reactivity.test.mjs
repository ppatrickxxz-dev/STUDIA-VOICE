import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reactor = await readFile(new URL('../../packages/app/pablovoice-companion-reactor.mjs', import.meta.url), 'utf8');
const routeCompat = await readFile(new URL('../../packages/app/pablovoice-vnext-route-compat.mjs', import.meta.url), 'utf8');

test('Companions react to the real project Music Graph, transport, tempo and sections', () => {
  assert.match(reactor, /buildUnifiedProjectContext/);
  assert.match(reactor, /songCreation\?\.latestTake\?\.bpm/);
  assert.match(reactor, /graph\?\.structure\?\.sections/);
  assert.match(reactor, /readPlayheadSeconds/);
  assert.match(reactor, /findPlayingMedia/);
  assert.match(reactor, /source:\s*'project-music-graph'/);
  assert.match(reactor, /transportAware:\s*true/);
  assert.match(reactor, /sectionAware:\s*true/);
  assert.match(reactor, /tempoAware:\s*true/);
  assert.match(reactor, /fixedDecorativeCarousel:\s*false/);
});

test('Companion motion is beat-derived and section-aware instead of a decorative fixed carousel', () => {
  assert.match(reactor, /60_000 \/ bpm/);
  assert.match(reactor, /currentSection\(graph, seconds\)/);
  assert.match(reactor, /SECTION_SEQUENCES/);
  assert.match(reactor, /pvCompanionMusicBeat/);
  assert.match(reactor, /prefers-reduced-motion/);
  assert.doesNotMatch(reactor, /setInterval\([^,]+,\s*6200\)/);
});

test('All six canonical Companions have contextual musical roles', () => {
  for (const name of ['Nota Drop', 'Wave Ribbon', 'Chime Lantern', 'EQ Bloom', 'Vinyl Groove', 'Star Spark']) {
    assert.ok(reactor.includes(name), `missing companion ${name}`);
  }
  for (const kind of ['intro', 'verse', 'prechorus', 'chorus', 'hook', 'bridge', 'breakdown', 'interlude', 'outro']) {
    assert.ok(reactor.includes(`${kind}:`), `missing section reaction ${kind}`);
  }
});

test('vNext installs the reactor and hides connectivity as a product mode', () => {
  assert.match(routeCompat, /installPabloVoiceCompanionReactor/);
  assert.match(routeCompat, /musicGraphCompanionReactor:\s*true/);
  assert.match(routeCompat, /unifiedConnectivityLanguage:\s*true/);
  assert.match(routeCompat, /\[data-vnext-online\], \[data-vnext-network\]/);
  assert.match(routeCompat, /node\.textContent = 'STUDIO'/);
});
