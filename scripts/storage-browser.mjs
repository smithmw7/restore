import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const out = 'output/warehouse/storage';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  const obstacleCount = initial.state.warehouse.obstacleCount;
  assert.ok(obstacleCount >= initial.state.warehouse.structuralObstacleCount, 'fixed metal storage and architecture have explicit obstacles');
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
  const attempted = new Map();
  for (let attempt = 0; attempt < 36 && current.state.openedCrates < 4; attempt++) {
    current = await read();
    const eye = current.input.camera.position;
    const distance = (object) => Math.hypot(...object.position.map((value, index) => value - eye[index]));
    const next = current.state.objects.filter((object) => object.kind === 'crate' && object.id.startsWith('storage-crate-') && visible(object) && (attempted.get(object.id) || 0) < 5)
      // Screen centroids alone favor distant boxes hidden behind the front row.
      // Work from near to far, revisiting a face after loose boards have settled.
      .sort((a, b) => distance(a) - distance(b) || (attempted.get(a.id) || 0) - (attempted.get(b.id) || 0))[0];
    if (!next) break;
    const tries = attempted.get(next.id) || 0;
    attempted.set(next.id, tries + 1);
    const offset = [[0, 0], [12, 0], [-12, 0], [0, -14], [0, 14]][tries];
    await page.mouse.click(next.screen.x + offset[0], next.screen.y + offset[1]);
    await advance(550);
    current = await read();
    if (current.state.crates.find((item) => item.id === next.id)?.state !== 'open') {
      // A released board may lie across the chosen face. Pick it up using the
      // same real pointer ray and clear it, rather than counting an occluded tap.
      await page.mouse.move(next.screen.x + offset[0], next.screen.y + offset[1]);
      await page.mouse.down();
      await page.waitForTimeout(260);
      current = await read();
      if (current.state.grab.active && current.state.grab.kind === 'crate-piece') {
        await page.mouse.move(1210, 230, { steps: 12 });
        await advance(650);
      }
      await page.mouse.up();
      await advance(400);
      current = await read();
    }
  }
  assert.ok(current.state.openedCrates >= 4, `only ${current.state.openedCrates} side crates could be opened`);
  assert.equal(current.state.warehouse.obstacleCount, obstacleCount, 'opening wood does not add fixed obstacles');
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
  // Drop over the clear central aisle. The old fixed screen point placed the
  // thruster above a foreground crate, where its fall could hide the shell.
  current = await read();
  const plane = current.input.desktopGrab;
  const camera = new THREE.PerspectiveCamera(current.input.camera.fov, current.input.camera.aspect, .05, 220);
  camera.position.fromArray(current.input.camera.position);
  camera.quaternion.fromArray(current.input.camera.quaternion);
  camera.updateMatrixWorld(true);
  const liftPoint = new THREE.Vector3(0, 2.4, -(plane.normal[1] * 2.4 + plane.constant) / plane.normal[2]);
  const liftScreen = liftPoint.clone().project(camera);
  const liftX = (liftScreen.x * .5 + .5) * 1440, liftY = (-liftScreen.y * .5 + .5) * 900;
  assert.ok(liftX > 65 && liftX < 1375 && liftY > 65 && liftY < 810, 'clear aisle lift target is outside the view');
  await page.mouse.move(liftX, liftY, { steps: 18 });
  await advance(1200);
  current = await read();
  const lifted = current.state.objects.find((object) => object.id === 'artifact-01');
  assert.ok(lifted.position[1] > 1.5, 'alien machinery was not lifted above the floor');
  assert.ok(Math.abs(lifted.position[0]) < .65, 'alien machinery was not moved above the clear aisle');
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

  // Let the dropped machinery settle before aiming. Its ringed shell has an
  // open center, so a centroid ray is not guaranteed to strike solid geometry.
  await advance(1200);
  await page.screenshot({ path: `${out}/alien-settled.png` });
  let broken = false;
  for (const [dx, dy] of [[0, 0], [5, 0], [-5, 0], [0, -5], [0, 5], [9, 0], [-9, 0], [0, -9], [0, 9]]) {
    current = await read();
    const target = current.state.objects.find((object) => object.id === 'artifact-01');
    assert.ok(visible(target), 'settled machinery is outside the visible play area');
    await page.mouse.click(target.screen.x + dx, target.screen.y + dy);
    current = await read();
    broken = current.state.objectStates.find((object) => object.id === 'artifact-01').state === 'broken';
    if (broken) break;
  }
  if (!broken) await writeFile(`${out}/failed-target.json`, JSON.stringify(await read(), null, 2));
  assert.ok(broken, 'a pointer tap could not strike the settled alien shell');
  current = await read();
  assert.ok(current.state.pieces.filter((piece) => piece.id === 'artifact-01' && piece.kind === 'fragment').length >= 6);
  await advance(350);
  await page.screenshot({ path: `${out}/alien-fragments.png` });
  checks.push('the released alien artifact breaks into visible magnetic fragments');
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, errors, initial: metrics(initial), severalOpen, alienArtifact: alienMeta, final: metrics(await read()) };
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ message: error.message, checks, errors, diagnostics: await page?.evaluate(() => window.__restoreDiagnostics?.()).catch(() => null) }, null, 2));
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
