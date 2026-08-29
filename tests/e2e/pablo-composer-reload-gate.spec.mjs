import { test, expect } from '@playwright/test';

async function waitForHydratedShell(page) {
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
}

test('COMPOSER RELOAD GATE: pending review survives IndexedDB reload and discard stays non-destructive', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Composer Reload');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Composer Reload' })).toBeVisible();

  const seeded = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const composer = await import('./pmi-composer-state.mjs');
    const projectId = storage.activeProjectSessionId();
    const project = await storage.getProject(projectId);
    if (!project?.id) throw new Error('Composer reload gate project missing.');
    const state = await composer.savePmiComposerState(project.id, {
      text: '[Refrão]\nAté onde deu, ainda era caminho',
      version: 3,
      command: 'rewrite',
      targetSection: 'refrão',
      baseLyrics: String(project.lyrics || ''),
    });

    const request = indexedDB.open('pablovoice_mobile_v2', 3);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const key = composer.composerStateKey(project.id);
    const stored = await new Promise((resolve, reject) => {
      const read = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    db.close();
    return { projectId: project.id, key, lyrics: project.lyrics, state, stored };
  });

  expect(seeded.state?.version).toBe(3);
  expect(seeded.stored?.value?.version ?? seeded.stored?.version).toBe(3);
  expect(seeded.stored?.value?.text ?? seeded.stored?.text).toBe('[Refrão]\nAté onde deu, ainda era caminho');

  await page.reload({ waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.getByText(/Rascunho v3 restaurado após recarregar/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Até onde deu, ainda era caminho/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar como letra' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar à letra' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descartar' })).toBeVisible();

  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByText(/Rascunho descartado/i)).toBeVisible();

  const afterDiscard = await page.evaluate(async ({ projectId, key }) => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(projectId);
    const request = indexedDB.open('pablovoice_mobile_v2', 3);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise((resolve, reject) => {
      const read = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    db.close();
    return { lyrics: project?.lyrics ?? null, stored: stored?.value ?? stored ?? null };
  }, { projectId: seeded.projectId, key: seeded.key });

  expect(afterDiscard.lyrics).toBe(seeded.lyrics);
  expect(afterDiscard.stored).toBeNull();
});
