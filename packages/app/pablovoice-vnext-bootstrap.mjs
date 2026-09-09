const failures = [];
const VNEXT_OWNED_SELECTOR = '[data-vnext-sidebar], [data-vnext-brain], [data-vnext-companion-dock], [data-vnext-arrangement-overview]';

document.documentElement.dataset.pvStudioMode = 'unified';
document.documentElement.dataset.pvNetworkMode = 'adaptive';
document.documentElement.dataset.pvVnextBoot = 'starting';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mutationTargetElement(record) {
  if (record.target instanceof Element) return record.target;
  return record.target?.parentElement || null;
}

function isVnextOwnedMutation(record) {
  return Boolean(mutationTargetElement(record)?.closest?.(VNEXT_OWNED_SELECTOR));
}

function isElementStructuralMutation(record) {
  if (record.type !== 'childList' || isVnextOwnedMutation(record)) return false;
  return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE);
}

function installWithStructuralObserver(installer) {
  const NativeMutationObserver = globalThis.MutationObserver;
  if (typeof NativeMutationObserver !== 'function') return installer();

  class StructuralMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((records, observer) => {
        const structural = records.filter(isElementStructuralMutation);
        if (structural.length) callback(structural, observer);
      });
    }
  }

  let swapped = false;
  try {
    globalThis.MutationObserver = StructuralMutationObserver;
    swapped = globalThis.MutationObserver === StructuralMutationObserver;
    return installer();
  } finally {
    if (swapped) globalThis.MutationObserver = NativeMutationObserver;
  }
}

async function waitForCanonicalCore(timeoutMs = 12_000) {
  const started = performance.now();
  while (document.documentElement.dataset.pvReady !== 'true') {
    if (performance.now() - started >= timeoutMs) {
      document.documentElement.dataset.pvVnextCoreWait = 'timeout';
      return false;
    }
    await delay(25);
  }
  document.documentElement.dataset.pvVnextCoreWait = 'ready';
  return true;
}

function androidPendingImportSize() {
  try {
    return Math.max(0, Number(globalThis.PabloVoiceAndroid?.pendingImportSize?.() || 0));
  } catch {
    return 0;
  }
}

async function prioritizeAndroidImport(timeoutMs = 30_000) {
  if (!globalThis.PabloVoiceAndroid?.pendingImportSize) {
    document.documentElement.dataset.pvVnextAndroidImport = 'not-android';
    return true;
  }

  let pending = androidPendingImportSize();
  if (!pending) {
    document.documentElement.dataset.pvVnextAndroidImport = 'clear';
    return true;
  }

  document.documentElement.dataset.pvVnextBoot = 'waiting-import';
  document.documentElement.dataset.pvVnextAndroidImport = 'draining';
  const started = performance.now();
  let requested = false;

  while (pending > 0 && performance.now() - started < timeoutMs) {
    if (!requested && typeof globalThis.PabloVoiceConsumeAndroidImport === 'function') {
      requested = true;
      try {
        await globalThis.PabloVoiceConsumeAndroidImport();
      } catch (error) {
        console.error('PABLOVOICE_VNEXT_ANDROID_IMPORT_PRIORITY_FAILED', error);
      }
    }
    pending = androidPendingImportSize();
    if (!pending) {
      document.documentElement.dataset.pvVnextAndroidImport = 'drained';
      return true;
    }
    await delay(25);
  }

  document.documentElement.dataset.pvVnextAndroidImport = pending > 0 ? 'timeout' : 'drained';
  return pending <= 0;
}

async function install(label, modulePath, exportName, { structuralObserver = false } = {}) {
  try {
    const mod = await import(modulePath);
    const installer = mod?.[exportName];
    if (typeof installer !== 'function') throw new Error(`missing ${exportName}`);
    if (structuralObserver) installWithStructuralObserver(installer);
    else installer();
  } catch (error) {
    failures.push(label);
    console.error(`PABLOVOICE_VNEXT_${label.toUpperCase()}_INSTALL_FAILED`, error);
  }
}

// Canonical app boot and Android Open-With/import own the first interactive slice.
// vNext mounts only after the core declares readiness and any pending native import
// has been consumed, so presentation/reactivity can never starve the bridge.
document.documentElement.dataset.pvVnextBoot = 'waiting-core';
await waitForCanonicalCore();
await prioritizeAndroidImport();
document.documentElement.dataset.pvVnextBoot = 'mounting';

// The vNext shell observes only structural mutations outside its own rails.
// Its own brain/readout/companion updates are intentionally excluded so UI feedback
// cannot create observer feedback loops on WebView or Chromium.
await install('ui', './pablovoice-vnext-ui.mjs', 'installPabloVoiceVNextUI', { structuralObserver: true });
await install('route', './pablovoice-vnext-route-compat.mjs', 'installPabloVoiceVNextRouteCompat');

document.documentElement.dataset.pvVnextBoot = failures.length ? 'degraded' : 'ready';
if (failures.length) document.documentElement.dataset.pvVnextFailures = failures.join(',');
else delete document.documentElement.dataset.pvVnextFailures;

export const PABLOVOICE_VNEXT_BOOT_POLICY = Object.freeze({
  coreBootIndependent: true,
  studioMode: 'unified',
  connectivityMode: 'adaptive',
  vnextFailureScope: 'surface-only',
  waitsForCanonicalCore: true,
  prioritizesPendingAndroidImport: true,
  ignoresTextOnlyObserverFeedback: true,
  ignoresVnextOwnedObserverFeedback: true,
  androidImportBridgeResponsive: true,
});
