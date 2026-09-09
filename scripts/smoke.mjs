import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Real pointer inputs exercise the same raycast, fracture and restore path as play.
// Chrome is used so a second Playwright browser download is not required on this Mac.
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const results = [];
await mkdir('output/smoke', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5207');
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready);
  await page.screenshot({ path: 'output/smoke/ready.png' });
  let warmGeometryCount;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const id of ['vase', 'cube', 'orb', 'gem', 'bottle', 'column', 'ring', 'tablet']) {
      const target = await page.evaluate((objectId) => JSON.parse(window.render_game_to_text()).objects.find((object) => object.id === objectId), id);
      if (!target) throw new Error(`Missing target ${id}`);
      // The ring center is correctly empty; click its upper rim.
      await page.mouse.click(target.screen.x, target.screen.y - (id === 'ring' ? 20 : 0));
      await page.waitForFunction((objectId) => !JSON.parse(window.render_game_to_text()).objects.some((object) => object.id === objectId), id);
    }
    const broken = await page.evaluate(() => window.__restoreDiagnostics());
    if (broken.state.broken !== 8 || broken.state.debris !== 125) throw new Error('Incomplete fracture');
    await page.screenshot({ path: `output/smoke/broken-${cycle}.png` });
    if (cycle === 0) await page.keyboard.press('Space');
    else if (cycle === 1) await page.locator('#restore').click();
    else await page.mouse.click(630, 407); // In-world Restore all button.
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).intact === 8);
    const restored = await page.evaluate(() => window.__restoreDiagnostics());
    if (restored.state.broken !== 0 || restored.state.restoring) throw new Error('Restore did not finish');
    // Geometry uploads occur lazily on the first break. Subsequent cycles must be stable.
    if (warmGeometryCount !== undefined && restored.geometries !== warmGeometryCount) throw new Error('Repeated play leaked GPU geometries');
    warmGeometryCount = restored.geometries;
    results.push({ cycle: cycle + 1, broken: broken.state.broken, debris: broken.state.debris, restored: restored.state.intact, geometries: restored.geometries });
  }
  await page.screenshot({ path: 'output/smoke/restored.png' });
  await page.locator('#sound').click();
  if (await page.locator('#sound').getAttribute('aria-pressed') !== 'false') throw new Error('Sound toggle failed');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ passed: true, cycles: results, errors }, null, 2));
  await writeFile('output/smoke/results.json', JSON.stringify({ passed: true, cycles: results, errors }, null, 2));
} finally {
  await browser.close();
}
