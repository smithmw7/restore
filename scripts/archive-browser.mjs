import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'output/archive';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [], views = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const start = Date.now();
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5209/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 60000 });
  const readyMs = Date.now() - start;
  const read = () => page.evaluate(() => window.__restoreDiagnostics());
  async function screenPoint(point) {
    const d = await read(), c = d.input.camera;
    const camera = new THREE.PerspectiveCamera(c.fov, c.aspect, .05, 260);
    camera.position.fromArray(c.position); camera.quaternion.fromArray(c.quaternion); camera.updateMatrixWorld();
    const p = new THREE.Vector3(...point).project(camera);
    assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1, `point outside view: ${point}`);
    return [(p.x * .5 + .5) * 1440, (-p.y * .5 + .5) * 900];
  }
  async function teleport(point, valid = true) {
    const before = await read(), position = await screenPoint(point);
    await page.keyboard.down('Shift');
    await page.mouse.click(...position);
    await page.keyboard.up('Shift');
    const after = await read();
    assert.equal(after.state.locomotion.teleportCount, before.state.locomotion.teleportCount + Number(valid));
    if (valid) assert.ok(Math.hypot(after.state.locomotion.head[0] - point[0], after.state.locomotion.head[2] - point[2]) < .15, 'teleport reaches its floor destination');
    else assert.deepEqual(after.state.locomotion.head, before.state.locomotion.head, 'blocked teleport does not move the player');
  }
  async function capture(name) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png` });
    const d = await read();
    views.push({ name, head: d.state.locomotion.head, drawCalls: d.drawCalls, triangles: d.triangles, geometries: d.geometries });
  }
  async function lookUp(pixels) {
    await page.mouse.move(720, 650);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(720, 650 - pixels, { steps: 12 });
    await page.mouse.up({ button: 'right' });
  }
  const initial = await read(), warehouse = initial.state.warehouse;
  assert.equal(initial.state.crateCount, 176);
  assert.ok(warehouse.metalStorage.crates > 1000 && warehouse.metalStorage.batches <= 3);
  assert.equal(warehouse.metalStorage.breakable, false);
  assert.equal(warehouse.atmosphere.extraScenePasses, 0);
  assert.equal(warehouse.atmosphere.dustParticles, 900);
  assert.equal((await page.locator('body').innerText()).trim(), '');
  await capture('entrance');
  await lookUp(190); await capture('roof'); await lookUp(-190);
  checks.push('text-free 176-crate collection, instanced sealed metal archive, mist, dust and volume shaders initialize');

  await teleport([0, 0, -50]);
  await capture('deep-aisle');
  const metalFace = await screenPoint([7.5, 1.2, -62.1]);
  await page.mouse.click(...metalFace);
  assert.equal((await read()).state.openedCrates, 0, 'metal tap cannot break a case or select a wooden crate through it');
  assert.equal((await read()).state.grab.active, false);
  await teleport([7.5, 0, -64], false);
  checks.push('deep aisle teleport succeeds; tapping sealed metal leaves the collection intact and teleport into its stack is rejected');
  await teleport([0, 0, -132]);
  await capture('far-archive');
  await lookUp(170); await capture('far-roof');
  checks.push('far archive remains enclosed and reachable beyond the previous camera and room bounds');
  await page.keyboard.press('KeyR');
  assert.equal((await read()).state.closedCrates, 176);
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, readyMs, warehouse, views, errors };
  await writeFile(`${out}/browser-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
