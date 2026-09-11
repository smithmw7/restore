import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.RESTORE_URL || 'http://127.0.0.1:5211/';
const out = 'output/briefcase/browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const read = () => page.evaluate(() => window.__restoreDiagnostics());
const pause = milliseconds => page.waitForTimeout(milliseconds);
async function view(position, target) {
  assert.equal(await page.evaluate(({ position, target }) => window.__restoreOpening.view(position, target), { position, target }), true);
  await pause(300);
}
async function target(id) {
  const object = (await read()).state.objects.find(object => object.id === id);
  assert.ok(object, `available interaction ${id}`);
  assert.ok(object.screen.x > 0 && object.screen.x < 1440 && object.screen.y > 0 && object.screen.y < 1000, `${id} is on screen`);
  return object.screen;
}
async function tap(id) {
  const point = await target(id);
  await page.mouse.click(point.x, point.y, { delay: 30 }); await pause(130);
}
async function dragWheel(index, detents, { cancel = false, hold = false } = {}) {
  const screen = await target(`wheel-${index}`);
  const start = await read(), before = start.state.opening.wheelDrag.positions[index], ticksBefore = start.audio.eventCounts['puzzle:dial'] || 0;
  await page.mouse.move(screen.x, screen.y); await page.mouse.down(); await pause(50);
  assert.equal((await read()).state.grab.objectId, `wheel-${index}`, 'wheel captures the press immediately');
  const destination = await page.evaluate(({ detents, screen }) => {
    const { camera, opening } = window.__restoreOpening;
    const drag = opening.getState().wheelDrag.dragging, grab = opening.getGrabState();
    const axis = camera.position.clone().fromArray(drag.axis), normal = camera.getWorldDirection(camera.position.clone());
    // Match the game's camera-facing drag plane while preserving the requested
    // travel along the drum's actual world-space tangent.
    const tangent = axis.clone().addScaledVector(normal, -axis.dot(normal));
    tangent.multiplyScalar(drag.worldPerDetent * detents / tangent.dot(axis));
    const start = camera.position.clone().fromArray(grab.goal), end = start.clone().add(tangent);
    start.project(camera); end.project(camera);
    return { x: screen.x + (end.x - start.x) * innerWidth / 2, y: screen.y - (end.y - start.y) * innerHeight / 2 };
  }, { detents, screen });
  await page.mouse.move(destination.x, destination.y, { steps: 8 }); await pause(70);
  const moving = (await read()).state.opening.wheelDrag;
  assert.ok(Math.abs(moving.positions[index] - before - detents) < .09, 'wheel follows fractional finger travel');
  assert.equal(moving.settled, false);
  assert.ok((await read()).audio.eventCounts['puzzle:dial'] > ticksBefore, 'moving past a detent plays its recorded click');
  if (hold) {
    await page.mouse.wheel(0, 300); await pause(1100);
    assert.ok(Math.abs((await read()).state.opening.wheelDrag.positions[index] - moving.positions[index]) < .001, 'fixed drum cannot be reeled toward the player by holding or scrolling');
    await page.screenshot({ path: `${out}/01c-wheel-drag-fractional.png` });
  }
  if (cancel) await page.evaluate(() => document.querySelector('#scene').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
  await page.mouse.up();
  await page.waitForFunction(() => window.__restoreDiagnostics().state.opening.wheelDrag.settled);
  assert.equal((await read()).state.grab.active, false);
}
async function verifyWheelPose(digits) {
  await page.waitForFunction(expected => {
    const root = window.__restoreOpening.scene.getObjectByName('Briefcase');
    return expected.every((digit, index) => {
      const angle = root.getObjectByName(`Wheel_${index}`).rotation.x + digit * Math.PI * 2 / 10;
      return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) < .004;
    });
  }, digits, { timeout: 10000 });
  const poses = await page.evaluate(() => {
    const root = window.__restoreOpening.scene.getObjectByName('Briefcase');
    root.updateMatrixWorld(true);
    return [0, 1, 2, 3].map(index => {
      const wheel = root.getObjectByName(`Wheel_${index}`), glyphs = root.getObjectByName(`WheelNumerals_${index}`);
      const marker = glyphs.position.clone().setFromMatrixPosition(glyphs.matrixWorld).applyMatrix4(wheel.parent.matrixWorld.clone().invert()).sub(wheel.position);
      const expected = glyphs.position.clone().applyEuler(wheel.rotation);
      return { angle: wheel.rotation.x, markerError: marker.distanceTo(expected), visible: glyphs.visible };
    });
  });
  assert.ok(poses.every(pose => pose.markerError < 1e-6 && pose.visible), 'physical numeral origins follow their rotating drums');
  return poses;
}
const pass = name => { checks.push(name); console.log(`PASS: ${name}`); };

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  const state = (await read()).state.opening;
  assert.equal(state.briefcase.loaded, true, state.briefcase.error || 'authored asset did not load');
  assert.ok(state.briefcase.triangles > 1000);
  assert.equal(state.briefcase.physicalNumerals, true);
  assert.equal(state.briefcase.numeralsPerWheel, 10);
  assert.equal(state.briefcase.handle, false);
  assert.equal(state.caseOpen, false);
  const asset = await page.evaluate(() => {
    const { scene, opening } = window.__restoreOpening;
    const root = scene.getObjectByName('Office briefcase');
    root.updateMatrixWorld(true);
    const lidProxy = root.getObjectByName('Briefcase lid collision proxy');
    lidProxy.geometry.computeBoundingBox();
    const proxyBounds = lidProxy.geometry.boundingBox.clone().expandByScalar(.0005);
    const inverseProxy = lidProxy.matrixWorld.clone().invert();
    let lidVerticesOutsideProxy = 0;
    root.getObjectByName('LidPivot').traverse(mesh => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position, point = mesh.position.clone();
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseProxy);
        if (!proxyBounds.containsPoint(point)) lidVerticesOutsideProxy++;
      }
    });
    return {
      roots: root.children.filter(child => child.getObjectByName('Briefcase')).length,
      lidVerticesOutsideProxy,
      controls: opening.targets.filter(mesh => mesh.userData.openingId.startsWith('wheel-') || mesh.userData.openingId.startsWith('case-latch')).map(mesh => ({
        id: mesh.userData.openingId, visible: mesh.visible, rendered: mesh.material.visible,
      })),
      handle: !!root.getObjectByName('HandlePivot'),
      numeralWheels: [0, 1, 2, 3].map(index => {
        const glyphs = root.getObjectByName(`WheelNumerals_${index}`), wheel = root.getObjectByName(`Wheel_${index}`);
        return {
          stationaryDisplay: !!root.getObjectByName(`NumberDisplay_${index}`),
          mesh: glyphs?.isMesh,
          carried: !!wheel.getObjectById(glyphs.id),
          black: glyphs.material.color.toArray().every(value => value < .025),
          textured: Object.values(glyphs.material).some(value => value?.isTexture),
          visible: glyphs.visible,
        };
      }),
    };
  });
  assert.equal(asset.roots, 1, 'one authored case replaces the fallback');
  assert.equal(asset.lidVerticesOutsideProxy, 0, 'the articulated collision proxy encloses the imported lid, rim and caps');
  assert.equal(asset.controls.length, 6);
  assert.ok(asset.controls.every(control => control.visible && !control.rendered), 'all six proxy targets remain selectable without duplicate visible meshes');
  assert.equal(asset.handle, false);
  assert.ok(asset.numeralWheels.every(wheel => !wheel.stationaryDisplay && wheel.mesh && wheel.carried && wheel.black && !wheel.textured && wheel.visible), 'black modeled numerals rotate with their wheels without stationary displays or numeral textures');
  pass('authored briefcase replaces placeholder rendering and retains six physical input targets');

  await view([6.15, 0, 9.45], [6.15, 1.12, 8.35]);
  await page.screenshot({ path: `${out}/01-closed.png` });
  await tap('case-latch-left');
  assert.equal((await read()).state.opening.caseOpen, false);
  const detents = [];
  await verifyWheelPose([0, 0, 0, 0]);
  for (let turn = 1; turn <= 10; turn++) {
    for (let index = 0; index < 4; index++) await tap(`wheel-${index}`);
    const digits = Array(4).fill(turn % 10);
    assert.deepEqual((await read()).state.opening.wheels, digits);
    detents.push({ digits, poses: await verifyWheelPose(digits) });
    if (turn === 9) await page.screenshot({ path: `${out}/01b-digits-9999.png` });
  }
  assert.ok(detents[9].poses.every((pose, index) => Math.abs(pose.angle - detents[8].poses[index].angle + Math.PI * 2 / 10) < .008), '9 to 0 advances one detent without reversing a full revolution');
  await writeFile(`${out}/wheel-detents.json`, JSON.stringify(detents, null, 2));
  pass('all four physical numeral rings complete 0 through 9 and wrap smoothly back to 0 with actual pointer taps');
  // Exercise arbitrary fractional travel, reverse wrap, long holds and the
  // nearest-detent cancellation path before opening the same office asset.
  await dragWheel(0, 1.36, { hold: true });
  await dragWheel(1, -1.12);
  await dragWheel(2, 4.31, { cancel: true });
  await dragWheel(3, 2.19);
  assert.deepEqual((await read()).state.opening.wheels, [1, 9, 4, 2]);
  await verifyWheelPose([1, 9, 4, 2]);
  await page.screenshot({ path: `${out}/02-code.png` });
  await tap('case-latch-left');
  await page.waitForFunction(() => {
    const root = window.__restoreOpening.scene.getObjectByName('Briefcase');
    return root.getObjectByName('LidPivot').rotation.x < -1.7 && ['L', 'R'].every(side => root.getObjectByName(`LatchPivot_${side}`).rotation.x < -.9);
  });
  assert.equal((await read()).state.opening.caseOpen, true);
  const opened = await page.evaluate(() => {
    const root = window.__restoreOpening.scene.getObjectByName('Briefcase');
    return { lid: root.getObjectByName('LidPivot').rotation.x, latches: ['L', 'R'].map(side => root.getObjectByName(`LatchPivot_${side}`).rotation.x) };
  });
  assert.ok(opened.lid < -1.7);
  assert.ok(opened.latches.every(angle => angle < -.9));
  pass('continuous pointer drags snap to 1942, cancel safely, release both latches and open the articulated lid');

  await page.screenshot({ path: `${out}/03-interior.png` });
  for (const id of ['photo-2', 'photo-1', 'photo-0']) await tap(id);
  assert.equal((await read()).state.opening.photosViewed.length, 3);
  const photo = await target('photo-0');
  await page.mouse.move(photo.x, photo.y); await page.mouse.down();
  await pause(220); await page.mouse.move(photo.x, photo.y - 12, { steps: 2 });
  await pause(100);
  assert.equal((await read()).state.grab.objectId, 'photo-0');
  await page.mouse.move(photo.x, photo.y - 250, { steps: 16 }); await pause(1600);
  assert.ok((await read()).state.grab.anchor[1] > 1.28, 'photo lifts out of the hollow body without a solid proxy trapping it');
  await page.screenshot({ path: `${out}/04-photo-lifted.png` });
  await page.mouse.up(); await pause(400);
  assert.equal((await read()).state.grab.active, false);
  pass('recessed photographs remain reachable and can be physically lifted out of the hollow shell');

  await tap('case-latch'); await pause(900);
  assert.equal((await read()).state.opening.caseOpen, false);
  await tap('case-latch'); await pause(900);
  assert.equal((await read()).state.opening.caseOpen, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  assert.equal((await read()).state.opening.caseOpen, true);
  assert.equal((await read()).state.opening.briefcase.loaded, true);
  assert.deepEqual((await read()).state.opening.wheels, [1, 9, 4, 2]);
  await verifyWheelPose([1, 9, 4, 2]);
  pass('either latch can close and reopen the case, and the saved open pose reloads');
  assert.deepEqual(errors, []);
  pass('no browser or console errors');
  await writeFile(`${out}/report.json`, JSON.stringify({ url, checks, errors, briefcase: (await read()).state.opening.briefcase }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.stack, checks, errors, diagnostics: await read().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
