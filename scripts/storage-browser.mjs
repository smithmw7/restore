import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'output/warehouse/storage';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5209/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 60000 });
  const read = () => page.evaluate(() => window.__restoreDiagnostics());
  const advance = (ms) => page.evaluate((time) => window.advanceTime(time), ms);
  const visible = (object) => object?.screen.x > 65 && object.screen.x < 1375 && object.screen.y > 65 && object.screen.y < 810;
  const metrics = (data) => ({ drawCalls: data.drawCalls, triangles: data.triangles, geometries: data.geometries, openedCrates: data.state.openedCrates });
  await advance(3000);
  const initial = await read();
  assert.equal(initial.state.crateCount, 176);
  assert.equal(initial.state.warehouse.staticCrates, 0);
  assert.equal(initial.state.warehouse.obstacleCount, 14, 'storage piles must not leave permanent structural obstacles');
  assert.equal(await page.locator('body').innerText(), '');
  await page.screenshot({ path: `${out}/initial.png` });

  for (let turn = 0; turn < 3; turn++) await page.keyboard.press('KeyQ');
  let current = await read();
  assert.equal(current.state.locomotion.turnCount, 3);
  const upperId = 'storage-crate-002';
  const upper = current.state.objects.find((object) => object.id === upperId);
  assert.ok(visible(upper), `upper side crate is outside the turned view: ${JSON.stringify(upper)}`);
  await page.mouse.click(upper.screen.x, upper.screen.y);
  await page.waitForFunction((id) => window.__restoreDiagnostics().state.crates.find((crate) => crate.id === id)?.state === 'open', upperId);
  current = await read();
  assert.ok(current.state.objects.some((object) => object.id === 'storage-artifact-002'), 'upper crate did not reveal its unique content');
  assert.equal(current.state.openedCrates, 1);
  checks.push('three real keyboard snap turns expose an upper side crate that a pointer tap opens to its unique artifact');

  // Open multiple visible crates through the normal UI to exercise board batches
  // and confirm that former scenery stack boxes no longer intercept selection.
  const attempted = new Set([upperId]);
  for (let attempt = 0; attempt < 18 && current.state.openedCrates < 4; attempt++) {
    current = await read();
    const next = current.state.objects.filter((object) => object.kind === 'crate' && object.id.startsWith('storage-crate-') && visible(object) && !attempted.has(object.id))
      .sort((a, b) => Math.hypot(a.screen.x - 720, a.screen.y - 450) - Math.hypot(b.screen.x - 720, b.screen.y - 450))[0];
    if (!next) break;
    attempted.add(next.id);
    await page.mouse.click(next.screen.x, next.screen.y);
    await advance(150);
    current = await read();
  }
  assert.ok(current.state.openedCrates >= 4, `only ${current.state.openedCrates} side crates could be opened`);
  assert.equal(current.state.warehouse.obstacleCount, 14);
  const severalOpen = metrics(current);
  await page.screenshot({ path: `${out}/storage-open.png` });
  checks.push('multiple side and upper storage crates open without fixed stack obstacles intercepting selection');

  await page.locator('#restore').click();
  for (let turn = 0; turn < 3; turn++) await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyQ');
  current = await read();
  const crate = current.state.objects.find((object) => object.id === 'crate-01');
  assert.ok(visible(crate));
  await page.mouse.click(crate.screen.x, crate.screen.y);
  await page.waitForFunction(() => window.__restoreDiagnostics().state.crates.find((item) => item.id === 'crate-01').state === 'open');
  await advance(900);
  current = await read();
  const alienMeta = current.state.objectStates.find((object) => object.id === 'artifact-01');
  assert.ok(alienMeta, 'alien thruster content is missing');

  let grabbed = false;
  for (let attempt = 0; attempt < 10 && !grabbed; attempt++) {
    current = await read();
    const target = current.state.objects.find((object) => object.id === 'artifact-01');
    assert.ok(visible(target), `alien artifact left the visible play area: ${JSON.stringify(target)}`);
    // Ringed machinery can have an open center. Small offsets still use real
    // pointer rays while trying its shell if the first centroid ray passes through.
    const offset = [[0, 0], [7, 0], [-7, 0], [0, -7], [0, 7]][attempt % 5];
    await page.mouse.move(target.screen.x + offset[0], target.screen.y + offset[1]);
    await page.mouse.down();
    await page.waitForTimeout(280);
    current = await read();
    grabbed = current.state.grab.active && current.state.grab.objectId === 'artifact-01';
    if (grabbed) break;
    if (current.state.grab.active) {
      await page.mouse.move(1180, 230, { steps: 14 });
      await advance(650);
    }
    await page.mouse.up();
  }
  assert.ok(grabbed, 'alien thruster could not be picked up after clearing nearby boards');
  await page.mouse.move(620, 260, { steps: 18 });
  await advance(1200);
  current = await read();
  const lifted = current.state.objects.find((object) => object.id === 'artifact-01');
  assert.ok(lifted.position[1] > 1.5, 'alien machinery was not lifted above the floor');
  assert.equal(current.state.grab.whole, true);
  await page.screenshot({ path: `${out}/alien-held.png` });
  const dropCount = current.audio.eventCounts.drop || 0;
  const releaseY = lifted.position[1];
  await page.mouse.up();
  await advance(400);
  current = await read();
  assert.equal(current.state.grab.active, false);
  assert.equal(current.audio.eventCounts.drop, dropCount + 1);
  assert.equal(current.audio.loopActive, false);
  assert.ok(current.state.objects.find((object) => object.id === 'artifact-01').position[1] < releaseY - 0.35, 'released alien machinery stayed in the air');
  checks.push('a real pointer grabs and lifts alien ship machinery; release drops it under gravity with one drop sound');

  let target = current.state.objects.find((object) => object.id === 'artifact-01');
  await page.mouse.click(target.screen.x, target.screen.y);
  await page.waitForFunction(() => window.__restoreDiagnostics().state.objectStates.find((object) => object.id === 'artifact-01').state === 'broken');
  current = await read();
  assert.ok(current.state.pieces.filter((piece) => piece.id === 'artifact-01' && piece.kind === 'fragment').length >= 6);
  await advance(350);
  await page.screenshot({ path: `${out}/alien-fragments.png` });
  checks.push('the released alien artifact breaks into visible magnetic fragments');
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, errors, initial: metrics(initial), severalOpen, alienArtifact: alienMeta, final: metrics(await read()) };
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
