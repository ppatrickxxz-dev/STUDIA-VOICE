const failures = [];

document.documentElement.dataset.pvStudioMode = 'unified';
document.documentElement.dataset.pvNetworkMode = 'adaptive';
document.documentElement.dataset.pvVnextBoot = 'starting';

async function install(label, modulePath, exportName) {
  try {
    const mod = await import(modulePath);
    const installer = mod?.[exportName];
    if (typeof installer !== 'function') throw new Error(`missing ${exportName}`);
    installer();
  } catch (error) {
    failures.push(label);
    console.error(`PABLOVOICE_VNEXT_${label.toUpperCase()}_INSTALL_FAILED`, error);
  }
}

await install('ui', './pablovoice-vnext-ui.mjs', 'installPabloVoiceVNextUI');
await install('route', './pablovoice-vnext-route-compat.mjs', 'installPabloVoiceVNextRouteCompat');

document.documentElement.dataset.pvVnextBoot = failures.length ? 'degraded' : 'ready';
if (failures.length) document.documentElement.dataset.pvVnextFailures = failures.join(',');
else delete document.documentElement.dataset.pvVnextFailures;

export const PABLOVOICE_VNEXT_BOOT_POLICY = Object.freeze({
  coreBootIndependent: true,
  studioMode: 'unified',
  connectivityMode: 'adaptive',
  vnextFailureScope: 'surface-only',
});
