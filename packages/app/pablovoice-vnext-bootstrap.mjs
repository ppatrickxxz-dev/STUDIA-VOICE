const failures = [];

document.documentElement.dataset.pvStudioMode = 'unified';
document.documentElement.dataset.pvNetworkMode = 'adaptive';
document.documentElement.dataset.pvVnextBoot = 'starting';

function isElementStructuralMutation(record) {
  if (record.type !== 'childList') return false;
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

// The vNext shell observes DOM structure to remount itself after canonical route renders.
// Text-only mutations are deliberately ignored so its own status/readout updates cannot
// starve WebView/DevTools or the Android import/Open-With bridge with observer feedback.
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
  ignoresTextOnlyObserverFeedback: true,
  androidImportBridgeResponsive: true,
});
