import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.RESTORE_URL || 'http://127.0.0.1:5211/';
const out = 'output/office/desk-fix';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1150 } });
const errors = [], checks = [];
let navigations = 0;
page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const state = () => page.evaluate(() => window.__restoreDiagnostics().state);
const view = async (position, target) => {
  assert.ok(await page.evaluate(({ position, target }) => window.__restoreOpening.view(position, target), { position, target }));
  await page.waitForTimeout(220);
  assert.equal(navigations, 1, 'keep the asset/source stable during the pointer test');
};
const tap = async id => {
  const item = (await state()).objects.find(item => item.id === id);
  assert.ok(item, `${id} is selectable`);
  await page.mouse.click(item.screen.x, item.screen.y, { delay: 35 });
  await page.evaluate(() => window.advanceTime(1200));
  assert.equal(navigations, 1, 'no unexpected development reload during interaction');
};
const geometry = () => page.evaluate(() => {
  const scene = window.__restoreOpening.scene;
  const desk = scene.getObjectByName('Desk'), drawer = scene.getObjectByName('Drawer');
  scene.updateMatrixWorld(true);
  const describe = object => {
    let bounds;
    object.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      if (bounds) bounds.union(box); else bounds = box;
    });
    return { min: bounds.min.toArray(), max: bounds.max.toArray(), origin: object.localToWorld(object.position.clone().set(0, 0, 0)).toArray() };
  };
  return { desk: describe(desk), drawer: describe(drawer) };
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  assert.equal((await state()).opening.office.loaded, true);
  await page.evaluate(() => window.advanceTime(4000));
  const closed = await geometry();
  assert.equal((await state()).opening.drawerOpen, false);
  assert.ok(closed.drawer.origin[2] < closed.desk.max[2], 'closed drawer face sits behind the tabletop overhang');
  await view([8.30, 0, 9.45], [7.1, .86, 8.32]);
  await page.screenshot({ path: `${out}/desk-closed-closeup.png` });

  await view([7, 0, 10.18], [7, .72, 8.48]);
  await tap('drawer');
  assert.equal((await state()).opening.drawerOpen, true);
  const open = await geometry(), extension = open.drawer.origin[2] - closed.drawer.origin[2];
  assert.ok(extension >= .28 && extension <= .36, `bounded useful drawer travel: ${extension}`);
  assert.ok(open.desk.max[2] - open.drawer.min[2] >= .14, 'open tray retains meaningful overlap beneath the desk');
  assert.deepEqual(open.desk, closed.desk, 'desk stays fixed during drawer movement');
  await view([8.30, 0, 9.45], [7.12, .81, 8.58]);
  await page.screenshot({ path: `${out}/desk-open-closeup.png` });
  checks.push('Actual pointer opens the drawer while its tray remains supported beneath a fixed desk');

  const notebook = (await state()).objects.find(item => item.id === 'notebook');
  assert.ok(notebook, 'the shorter stroke still exposes the notebook');
  await view([7, 0, 9.50], [7, .73, 8.72]);
  await tap('notebook');
  assert.equal((await state()).opening.notebookOpen, true);
  assert.equal((await state()).opening.noteSeen, true);
  assert.equal((await state()).opening.code, '1942');
  await page.screenshot({ path: `${out}/desk-clue-access.png` });
  checks.push('Notebook remains reachable and opens to the 1942 clue with the corrected drawer');

  await view([7, 0, 10.18], [7, .72, 8.48]);
  await tap('drawer');
  assert.equal((await state()).opening.drawerOpen, false);
  const reclosed = await geometry();
  assert.ok(Math.abs(reclosed.drawer.origin[2] - closed.drawer.origin[2]) < .002, 'closing returns to the authored face alignment');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  assert.equal((await state()).opening.drawerOpen, false);
  assert.equal((await state()).opening.noteSeen, true);
  checks.push('Closing and reloading retain the corrected rest pose and discovered clue');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ url, passed: checks.length, checks, closed, open, extension, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, extension, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await writeFile(`${out}/failure.json`, JSON.stringify({ message: error.message, errors, state: await state().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
