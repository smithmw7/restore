import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const out = 'output/drag-collision-browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [], samples = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5208/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 60000 });
  const read = () => page.evaluate(() => window.__restoreDiagnostics());
  const advance = ms => page.evaluate(time => window.advanceTime(time), ms);
  const crate = (data, id = 'crate-02') => data.state.crates.find(item => item.id === id);
  const vec = values => new THREE.Vector3().fromArray(values);
  function orientedBox(item) {
    const rotation = new THREE.Quaternion().fromArray(item.quaternion);
    // Closed crate front/back braces protrude beyond the nominal board faces.
    const half = item.dimensions.map((size, axis) => size * (axis === 2 ? 1.05225 : 1) / 2);
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
      .map(axis => axis.applyQuaternion(rotation));
    return { position: vec(item.position), half, axes };
  }
  function overlapDepth(a, b) {
    const one = orientedBox(a), two = orientedBox(b), delta = one.position.clone().sub(two.position);
    const axes = [...one.axes, ...two.axes];
    for (const x of one.axes) for (const y of two.axes) {
      const cross = x.clone().cross(y);
      if (cross.lengthSq() > 1e-10) axes.push(cross.normalize());
    }
    let minimum = Infinity;
    for (const axis of axes) {
      const radius = box => box.axes.reduce((sum, direction, index) => sum + box.half[index] * Math.abs(direction.dot(axis)), 0);
      const overlap = radius(one) + radius(two) - Math.abs(delta.dot(axis));
      if (overlap <= 0) return 0;
      minimum = Math.min(minimum, overlap);
    }
    return minimum;
  }
  function project(data, point) {
    const camera = new THREE.PerspectiveCamera(data.input.camera.fov, data.input.camera.aspect, .05, 260);
    camera.position.fromArray(data.input.camera.position);
    camera.quaternion.fromArray(data.input.camera.quaternion);
    camera.updateMatrixWorld(true);
    const result = point.clone().project(camera);
    return { x: (result.x * .5 + .5) * 1440, y: (-result.y * .5 + .5) * 900 };
  }
  let grabOffset;
  // Match a world-space intention with real depth-wheel and pointer input.
  // Diagnostics only supply the existing camera/drag plane; no app state is set.
  async function aim(center) {
    const point = center.clone().sub(grabOffset);
    let data;
    for (let attempt = 0; attempt < 30; attempt++) {
      data = await read();
      assert.equal(data.state.grab.objectId, 'crate-02');
      const plane = data.input.desktopGrab;
      const difference = point.dot(vec(plane.normal)) + plane.constant;
      if (Math.abs(difference) < .008) break;
      await page.mouse.wheel(0, THREE.MathUtils.clamp(difference / .002, -100, 100));
      await page.waitForTimeout(20);
    }
    data = await read();
    const screen = project(data, point);
    assert.ok(screen.x > 25 && screen.x < 1415 && screen.y > 25 && screen.y < 875, `intended pointer location is outside the canvas: ${JSON.stringify(screen)}`);
    await page.mouse.move(screen.x, screen.y, { steps: 3 });
  }
  async function observe(stage, milliseconds) {
    const observation = await page.evaluate(({ stage, milliseconds }) => {
      const samples = [];
      let data;
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 50) {
        window.advanceTime(Math.min(50, milliseconds - elapsed));
        data = window.__restoreDiagnostics();
        samples.push({ stage, crate: data.state.crates.find(item => item.id === 'crate-02'),
          blocker: data.state.crates.find(item => item.id === 'crate-01'), goal: data.state.grab.goal,
          speed: data.state.grab.speed, voices: data.audio.activeVoices, loopGain: data.audio.loopTargetGain,
          loopMaxGain: data.audio.loopMaxGain, opened: data.state.openedCrates });
      }
      return { samples, data };
    }, { stage, milliseconds });
    for (const sample of observation.samples) {
      assert.equal(sample.opened, 0, 'dragging accidentally broke a crate');
      assert.ok(sample.voices <= 12, 'collision sounds exceeded the voice budget');
      assert.ok(sample.loopGain <= sample.loopMaxGain + .0001, 'drag sound exceeded its gain limit');
    }
    samples.push(...observation.samples);
    return observation.data;
  }

  // Back away with the normal controls so both left-hand crates are visible.
  await page.keyboard.down('KeyS'); await advance(750); await page.keyboard.up('KeyS');
  await advance(1800);
  let current = await read();
  const first = current.state.objects.find(object => object.id === 'crate-02');
  await page.mouse.move(first.screen.x, first.screen.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__restoreDiagnostics().state.grab.objectId === 'crate-02', null, { timeout: 4000 });
  current = await read();
  grabOffset = vec(current.state.grab.goal).sub(vec(current.input.desktopGrab.point));
  assert.equal(current.state.grab.whole, true);
  checks.push('real pointer hold picks up the intact crate through the normal drag controls');

  const floorTarget = new THREE.Vector3(0, -.2, 1);
  await aim(floorTarget); current = await observe('floor', 1400);
  const floorSamples = samples.filter(sample => sample.stage === 'floor');
  const minimumFloor = Math.min(...floorSamples.map(sample => {
    const box = orientedBox(sample.crate);
    return box.position.y - box.axes.reduce((sum, axis, index) => sum + box.half[index] * Math.abs(axis.y), 0);
  }));
  assert.ok(minimumFloor > -.025, `crate floor clearance fell to ${minimumFloor} m`);
  assert.ok(Math.abs(crate(current).position[0]) < .12, 'the crate did not slide into the clear aisle');
  assert.ok(crate(current).position[1] > floorTarget.y + .65, 'below-floor pointer target pulled the crate through the ground');
  await page.screenshot({ path: `${out}/floor-held.png` });
  checks.push('dragging toward the ground slides the crate across the floor and keeps it supported');

  const blockerStart = vec(crate(current, 'crate-01').position);
  const contactTarget = new THREE.Vector3(blockerStart.x - .6, .55, blockerStart.z);
  await aim(contactTarget); current = await observe('contact', 1800);
  const blocked = crate(current), blocker = crate(current, 'crate-01');
  const targetError = vec(blocked.position).distanceTo(vec(current.state.grab.goal));
  assert.ok(targetError > .25, 'crate followed its target through the other box');
  assert.ok(blocked.position[0] > blocker.position[0] + .8, 'held crate crossed through its blocker');
  await page.screenshot({ path: `${out}/crate-contact.png` });
  current = await read();
  const beforeSlide = vec(crate(current).position);
  // Upward movement stays tangent to either upright crate face even if the
  // automatic pull carried the held box around a corner during the screenshot.
  // Keep this movement on the existing plane so scroll timing cannot change
  // which face is being tested before the pointer reaches its destination.
  const slidePoint = vec(current.input.desktopGrab.point);
  const slideNormal = vec(current.input.desktopGrab.normal);
  slidePoint.y += .4;
  slidePoint.z -= slideNormal.y / slideNormal.z * .4;
  const slideScreen = project(current, slidePoint);
  assert.ok(slideScreen.x > 25 && slideScreen.x < 1415 && slideScreen.y > 25 && slideScreen.y < 875);
  await page.mouse.move(slideScreen.x, slideScreen.y, { steps: 3 });
  current = await observe('slide', 700);
  assert.ok(crate(current).position[1] > beforeSlide.y + .18, 'blocked crate did not slide tangentially along the other box');
  let maximumOverlap = 0;
  for (const sample of samples.filter(item => item.stage === 'contact' || item.stage === 'slide')) {
    maximumOverlap = Math.max(maximumOverlap, overlapDepth(sample.crate, sample.blocker));
  }
  assert.ok(maximumOverlap < .025, `oriented crate envelopes interpenetrated by ${maximumOverlap} m`);
  await page.screenshot({ path: `${out}/crate-slide.png` });
  checks.push('another crate blocks the drag target while allowing visible tangential sliding with bounded overlap');

  // Lift back over the clear aisle and release with a still pointer.
  const liftTarget = new THREE.Vector3(0, 2.1, .6);
  await aim(liftTarget); current = await observe('lift', 1800);
  const releasePosition = vec(crate(current).position);
  assert.ok(releasePosition.y > 1.85);
  const drops = current.audio.eventCounts.drop || 0;
  await page.screenshot({ path: `${out}/before-release.png` });
  await page.mouse.up(); await advance(450);
  current = await read();
  assert.equal(current.state.grab.active, false);
  assert.ok(crate(current).position[1] < releasePosition.y - .65, 'pointer release left the crate hovering');
  assert.equal(current.audio.eventCounts.drop, drops + 1);
  assert.equal(current.audio.loopActive, false);
  await advance(4000);
  const quietStart = vec(crate(await read()).position);
  await advance(1000); await page.waitForTimeout(600);
  current = await read();
  const settlingMotion = vec(crate(current).position).distanceTo(quietStart);
  assert.ok(settlingMotion < .015, `released crate did not become quiet: ${settlingMotion} m`);
  assert.equal(current.state.openedCrates, 0);
  assert.equal(current.audio.loopActive, false);
  assert.equal(current.audio.fadingLoops, 0);
  assert.equal(current.audio.eventCounts.break || 0, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/final-settled.png` });
  checks.push('a stationary pointer release restores gravity, plays one drop, stops drag audio, and settles without errors');

  const result = { passed: true, checks, errors, measurements: { minimumFloor, maximumOverlap, targetError,
    tangentTravel: samples.findLast(item => item.stage === 'slide').crate.position[1] - beforeSlide.y, settlingMotion },
    samples, final: current };
  await writeFile(`${out}/browser-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors, measurements: result.measurements }, null, 2));
} catch (error) {
  await writeFile(`${out}/browser-failure.json`, JSON.stringify({ message: error.message, checks, errors, samples,
    diagnostics: await page?.evaluate(() => window.__restoreDiagnostics?.()).catch(() => null) }, null, 2));
  await page?.screenshot({ path: `${out}/browser-failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
