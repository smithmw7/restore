import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { OFFICE_ASSET_NAMES } from '../src/office-assets.js';

const url = process.env.RESTORE_OFFICE_REVIEW_URL || 'http://127.0.0.1:5211/office-review.html';
const out = 'output/office/review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__restoreOfficeReview?.state().ready || window.__restoreOfficeReview?.state().error);
  let current = await state();
  assert.equal(current.error, null, 'office kit loaded');
  assert.equal(current.asset.textures, 3, 'gallery shares three maps');
  assert.equal(await page.locator('#model option').count(), 9);
  for (const name of OFFICE_ASSET_NAMES) {
    await page.selectOption('#model', name);
    current = await state();
    assert.equal(current.selected, name);
    assert.ok(current.model.triangles > 0, `${name} has a visible surface`);
    const views = [];
    for (const angle of ['front', 'rear', 'above', 'under']) {
      await page.click(`[data-angle="${angle}"]`);
      await page.evaluate(() => window.advanceTime(240));
      current = await state();
      assert.equal(current.angle, angle);
      assert.ok(current.camera.position.every(Number.isFinite), 'camera is finite');
      await page.screenshot({ path: `${out}/${name.toLowerCase()}-${angle}.png` });
      views.push({ angle, camera: current.camera });
    }
    assert.equal(new Set(views.map(view => view.camera.position.join(','))).size, 4, `${name} gets four distinct views`);
    if (['Desk', 'Drawer', 'Notebook', 'LockerShell', 'LockerDoor'].includes(name)) {
      await page.click('[data-angle="front"]');
      await page.click('#pose');
      await page.evaluate(() => window.advanceTime(1100));
      current = await state();
      assert.ok(current.open && current.openAmount > .999, `${name} open pose settles`);
      if (name === 'Notebook') assert.ok(current.articulation.rotation[2] > 2.8, 'notebook swings upward around its spine');
      else if (name.startsWith('Locker')) assert.ok(current.articulation.rotation[1] < -1.7, 'locker door swings outward');
      else assert.ok(current.articulation.position[2] > .44, 'drawer slides outward');
      await page.screenshot({ path: `${out}/${name.toLowerCase()}-open.png` });
      await page.click('#pose');
      await page.evaluate(() => window.advanceTime(1100));
      current = await state();
      assert.ok(!current.open && current.openAmount < .001, `${name} returns closed`);
    } else assert.equal(await page.locator('#pose').isDisabled(), true, `${name} has no fictitious hinge`);
    checks.push({ name, triangles: current.model.triangles, views, articulation: current.articulation });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption('#model', 'Pen');
  await page.click('[data-angle="front"]');
  await page.evaluate(() => window.advanceTime(240));
  const mobileFits = await page.locator('.panel').evaluate(panel => {
    const rect = panel.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  });
  assert.equal(mobileFits, true, 'model controls fit a narrow viewport');
  await page.screenshot({ path: `${out}/pen-mobile.png` });
  assert.deepEqual(errors, [], 'gallery has no browser errors');
  const report = { url, scenarios: checks.length, anglesPerObject: 4, screenshots: 42, mobileFits, checks, errors };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ url, scenarios: checks.length, screenshots: 42, mobileFits, errors }));
} finally {
  await browser.close();
}
