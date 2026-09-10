import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const out = 'output/action-audio-browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [], samples = [];
const contactCaptures = new Set();
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5209/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 60000 });
  const read = () => page.evaluate(() => window.__restoreDiagnostics());
  const advance = ms => page.evaluate(time => window.advanceTime(time), ms);
  const vec = values => new THREE.Vector3().fromArray(values);
  const crate = (data, id = 'crate-02') => data.state.crates.find(item => item.id === id);
  const target = (data, id) => data.state.objects.find(item => item.id === id);
  function project(data, point) {
    const camera = new THREE.PerspectiveCamera(data.input.camera.fov, data.input.camera.aspect, .05, 260);
    camera.position.fromArray(data.input.camera.position); camera.quaternion.fromArray(data.input.camera.quaternion); camera.updateMatrixWorld(true);
    const result = point.clone().project(camera);
    return { x: (result.x * .5 + .5) * 1440, y: (-result.y * .5 + .5) * 900 };
  }
  let grabOffset;
  async function grab(id) {
    const item = target(await read(), id);
    assert.ok(item?.screen.x > 25 && item.screen.x < 1415 && item.screen.y > 25 && item.screen.y < 875, `${id} lies outside the current view`);
    await page.mouse.move(item.screen.x, item.screen.y); await page.mouse.down();
    await page.waitForFunction(id => window.__restoreDiagnostics().state.grab.objectId === id, id, { timeout: 4000 });
    const data = await read();
    grabOffset = vec(data.state.grab.goal).sub(vec(data.input.desktopGrab.point));
    return item;
  }
  async function aim(center) {
    const point = center.clone().sub(grabOffset);
    for (let attempt = 0; attempt < 30; attempt++) {
      const data = await read(), plane = data.input.desktopGrab;
      assert.ok(plane, 'the real desktop drag lost its pointer owner');
      const difference = point.dot(vec(plane.normal)) + plane.constant;
      if (Math.abs(difference) < .008) break;
      await page.mouse.wheel(0, THREE.MathUtils.clamp(difference / .002, -100, 100));
      await page.waitForTimeout(20);
    }
    const screen = project(await read(), point);
    assert.ok(screen.x > 25 && screen.x < 1415 && screen.y > 25 && screen.y < 875, `drag point outside canvas: ${JSON.stringify(screen)}`);
    await page.mouse.move(screen.x, screen.y, { steps: 3 });
  }
  async function observe(stage, milliseconds) {
    let data;
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 80) {
      await advance(Math.min(80, milliseconds - elapsed));
      // The 120ms texture hysteresis and gain envelopes run on WebAudio time,
      // so actual timer slices accompany physics advances in this test.
      await page.waitForTimeout(35);
      data = await read();
      const sample = { stage, grab: data.state.grab, crate: crate(data), audio: data.audio };
      assert.ok(sample.audio.activeVoices <= 12); assert.ok(sample.audio.loopVoices <= 2);
      assert.ok(sample.audio.loopTargetGain <= sample.audio.loopMaxGain + .0001);
      samples.push(sample);
      if (['wood', 'concrete'].includes(sample.grab.surface) && sample.grab.scrapeSpeed > .08
        && sample.audio.loopFamily === `scrape-wood-${sample.grab.surface}` && sample.audio.loopTargetGain > .01
        && !contactCaptures.has(sample.grab.surface)) {
        contactCaptures.add(sample.grab.surface);
        await page.screenshot({ path: `${out}/${sample.grab.surface}-contact.png` });
      }
    }
    return data;
  }
  async function look(pixels) {
    await page.mouse.move(720, pixels > 0 ? 500 : 140); await page.mouse.down({ button: 'right' });
    await page.mouse.move(720, pixels > 0 ? 500 - pixels : 140 - pixels, { steps: 12 });
    await page.mouse.up({ button: 'right' });
  }

  await page.keyboard.down('KeyS'); await advance(750); await page.keyboard.up('KeyS'); await advance(1800);
  assert.equal((await read()).audio.loaded, 40);
  await grab('crate-02');
  await aim(new THREE.Vector3(.5, .01, 1));
  let current = await observe('concrete slide', 1100);
  const concrete = samples.filter(sample => sample.stage === 'concrete slide')
    .find(sample => sample.grab.surface === 'concrete' && sample.grab.scrapeSpeed > .08 && sample.audio.loopFamily === 'scrape-wood-concrete' && sample.audio.loopTargetGain > .01);
  assert.ok(concrete, 'sliding the real crate on the concrete floor did not select its concrete scrape');
  await page.screenshot({ path: `${out}/concrete-slide.png` });
  checks.push('a real dragged crate selects the quiet wood-on-concrete texture from physical floor contact');

  const blocker = vec(crate(current, 'crate-01').position);
  await aim(new THREE.Vector3(blocker.x - .6, .55, blocker.z));
  current = await observe('wood press', 1100);
  const beforeSlide = crate(current).position[1];
  const slidePoint = vec(current.input.desktopGrab.point), normal = vec(current.input.desktopGrab.normal);
  slidePoint.y += .55; slidePoint.z -= normal.y / normal.z * .55;
  const screen = project(current, slidePoint);
  await page.mouse.move(screen.x, screen.y, { steps: 3 });
  current = await observe('wood slide', 850);
  const wood = samples.filter(sample => sample.stage.startsWith('wood'))
    .find(sample => sample.grab.surface === 'wood' && sample.grab.scrapeSpeed > .08 && sample.audio.loopFamily === 'scrape-wood-wood' && sample.audio.loopTargetGain > .01);
  assert.ok(wood, 'rubbing the dragged crate along another wooden crate did not select its wood scrape');
  assert.ok(crate(current).position[1] > beforeSlide + .12, 'the held crate did not slide upward along the box face');
  await page.screenshot({ path: `${out}/wood-slide.png` });
  checks.push('sliding against another crate switches to the distinct wood-on-wood texture');

  await aim(new THREE.Vector3(0, 2.4, .6));
  current = await observe('airborne lift', 1400);
  const airborne = samples.filter(sample => sample.stage === 'airborne lift')
    .find(sample => sample.grab.surface === null && sample.grab.speed > .15 && sample.audio.loopTargetGain === 0);
  assert.ok(airborne, 'wood scraping continued despite airborne movement');
  assert.ok(crate(current).position[1] > 1.85);
  await page.screenshot({ path: `${out}/airborne-silent.png` });
  const dropCount = current.audio.eventCounts.drop || 0;
  await page.mouse.up(); await advance(500); await page.waitForTimeout(160);
  current = await read();
  assert.equal(current.audio.eventCounts.drop, dropCount + 1); assert.equal(current.audio.loopVoices, 0);
  assert.match(current.audio.lastEvents.findLast(event => event.type === 'drop')?.clip || '', /repair\/drop-/);
  checks.push('wood falls silent during airborne travel and release stops the loop while preserving the Heavy Kick drop');

  await page.keyboard.press('KeyR'); await advance(1000);
  await look(360);
  const lamp = await grab('hanging-light-01');
  await page.mouse.move(lamp.screen.x + 240, Math.min(790, lamp.screen.y + 130), { steps: 5 });
  current = await observe('lamp creak', 750);
  assert.equal(current.state.grab.kind, 'hanging-light');
  assert.ok(samples.some(sample => sample.stage === 'lamp creak' && sample.grab.speed > .1 && sample.audio.loopFamily === 'metal-creak' && sample.audio.loopTargetGain > .01));
  await page.screenshot({ path: `${out}/lamp-metal-creak.png` });
  const lampDropCount = current.audio.eventCounts.drop || 0;
  // Enter activates the sound icon while the real pointer remains held.
  await page.locator('#sound').press('Enter'); await page.waitForTimeout(60);
  current = await read();
  assert.equal(current.audio.muted, true); assert.equal(current.audio.loopVoices, 0);
  await page.mouse.up();
  assert.equal((await read()).audio.eventCounts.drop || 0, lampDropCount);
  await page.locator('#sound').press('Enter');
  await page.keyboard.press('KeyR');
  const resetLamp = await grab('hanging-light-01');
  await page.mouse.move(resetLamp.screen.x - 190, Math.min(790, resetLamp.screen.y + 80), { steps: 3 });
  await observe('before reset', 400); await page.keyboard.press('KeyR'); await page.mouse.up(); await page.waitForTimeout(60);
  current = await read();
  assert.equal(current.state.grab.active, false); assert.equal(current.audio.loopVoices, 0); assert.equal(current.state.hangingLights.active, 0);
  checks.push('a pulled lamp uses quiet metal creaking; mute, release, and reset remove its loop without a drop kick');

  await look(-360);
  const destination = project(await read(), new THREE.Vector3(0, 0, 2.2));
  await page.keyboard.down('Shift'); await page.mouse.click(destination.x, destination.y); await page.keyboard.up('Shift');
  await page.keyboard.press('KeyQ');
  const closeCrate = target(await read(), 'crate-02');
  await page.mouse.click(closeCrate.screen.x, closeCrate.screen.y); await advance(180);
  current = await read();
  assert.equal(current.input.lastTap?.objectId, 'crate-02'); assert.equal(current.input.lastTap.kind, 'break');
  assert.equal(crate(current).state, 'open');
  assert.match(current.audio.lastEvents.findLast(event => event.type === 'break')?.clip || '', /actions\/timber-break-/);
  await page.screenshot({ path: `${out}/timber-break.png` });
  await page.keyboard.press('KeyR'); await page.waitForTimeout(80); current = await read();
  assert.equal(current.state.closedCrates, 176); assert.equal(current.audio.loopVoices, 0); assert.deepEqual(errors, []);
  checks.push('a close-range pointer tap breaks wood with the timber recording; final reset restores 176 crates without audio leaks');
  const report = { passed: true, checks, errors, concrete, wood, airborne, final: current, samples };
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors, samples: samples.length }, null, 2));
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ message: error.message, checks, errors, samples,
    diagnostics: await page?.evaluate(() => window.__restoreDiagnostics?.()).catch(() => null) }, null, 2));
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
