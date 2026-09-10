import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'output/hanging-lights-browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [], samples = [];
const id = 'hanging-light-01';
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5209/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 60000 });
  const read = () => page.evaluate(() => window.__restoreDiagnostics());
  const advance = ms => page.evaluate(time => window.advanceTime(time), ms);
  const light = data => data.state.hangingLights.lights.find(item => item.id === id);
  const target = data => data.state.objects.find(item => item.id === id);
  const gestureSounds = data => Object.fromEntries(['break', 'pickup', 'drop'].map(type => [type, data.audio.eventCounts[type] || 0]));
  async function look(pixels) {
    await page.mouse.move(720, pixels > 0 ? 500 : 140);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(720, pixels > 0 ? 500 - pixels : 140 - pixels, { steps: 12 });
    await page.mouse.up({ button: 'right' });
  }
  async function observe(stage, milliseconds) {
    const observation = await page.evaluate(({ stage, milliseconds, id }) => {
      const samples = [];
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
        window.advanceTime(Math.min(100, milliseconds - elapsed));
        const data = window.__restoreDiagnostics();
        samples.push({ stage, light: data.state.hangingLights.lights.find(item => item.id === id),
          grab: data.state.grab, opened: data.state.openedCrates,
          loopGain: data.audio.loopTargetGain, loopMaxGain: data.audio.loopMaxGain });
      }
      return { samples, data: window.__restoreDiagnostics() };
    }, { stage, milliseconds, id });
    for (const sample of observation.samples) {
      assert.ok(Math.abs(distance(sample.light.position, sample.light.anchor) - sample.light.pendulumLength) < 1e-7, 'the light stretched or detached from its ceiling wire');
      assert.equal(sample.opened, 0, 'interacting with a light broke a wooden crate');
      assert.ok(sample.loopGain <= sample.loopMaxGain + .0001, 'a light drag exceeded the quiet sound budget');
    }
    samples.push(...observation.samples);
    return observation.data;
  }

  const initial = await read();
  assert.equal(initial.state.hangingLights.count, 36);
  assert.equal(initial.state.hangingLights.realSpotlights, 3);
  assert.equal(initial.state.warehouse.atmosphere.movingLightVolumes, 3);
  assert.equal(initial.state.warehouse.atmosphere.mistBanks, 12);
  await advance(4000);
  let current = await read();
  assert.deepEqual(current.state.hangingLights, initial.state.hangingLights, 'untouched hanging lights drifted or animated');
  checks.push('all 36 lamps start exactly still on fixed wires, with only three real lights and moving shafts');

  await look(360);
  const lampTarget = target(await read());
  assert.ok(lampTarget.screen.x > 50 && lampTarget.screen.x < 1390 && lampTarget.screen.y > 50 && lampTarget.screen.y < 850, 'the first pendant is outside the upward view');
  await page.mouse.click(lampTarget.screen.x, lampTarget.screen.y);
  current = await read();
  assert.equal(current.input.lastTap?.objectId, id);
  assert.equal(current.input.lastTap.kind, 'nudge');
  assert.equal(light(current).state, 'swinging');
  assert.deepEqual(gestureSounds(current), gestureSounds(initial), 'a tethered-light tap played a break, pickup, or drop sound');
  const tapSound = current.audio.lastEvents.findLast(event => event.type === 'nudge');
  assert.match(tapSound?.clip || '', /repair\/hit-metal-heavy-/, 'the lamp tap did not use its metal contact sound');
  const tapped = await observe('tap swing', 650);
  assert.ok(distance(light(tapped).position, light(initial).position) > .002, 'tapping did not produce a visible physical swing');
  await page.screenshot({ path: `${out}/tapped-light.png` });
  current = await observe('tap settling', 30000);
  assert.equal(light(current).state, 'resting');
  assert.deepEqual(light(current).position, light(initial).position);
  assert.deepEqual(light(current).velocity, [0, 0, 0]);
  checks.push('a real pointer tap rocks the fixed-wire lamp with metal audio, never breaks it, and settles exactly');

  const pickTarget = target(current);
  await page.mouse.move(pickTarget.screen.x, pickTarget.screen.y);
  await page.mouse.down();
  await page.waitForFunction(id => window.__restoreDiagnostics().state.grab.objectId === id, id, { timeout: 4000 });
  current = await read();
  assert.equal(current.state.grab.kind, 'hanging-light');
  assert.equal(current.state.grab.handId, 'pointer');
  assert.ok(current.input.desktopGrab, 'holding a lamp did not use the existing desktop drag path');
  assert.equal(current.audio.eventCounts.pickup, (initial.audio.eventCounts.pickup || 0) + 1);
  const pickupSound = current.audio.lastEvents.findLast(event => event.type === 'pickup');
  assert.match(pickupSound?.clip || '', /repair\/pickup-/, 'the first hold did not play the pickup sound');
  const pickupPosition = light(current).position;
  await page.mouse.move(Math.min(1320, pickTarget.screen.x + 250), Math.min(790, pickTarget.screen.y + 150), { steps: 6 });
  current = await observe('held pull', 4500);
  assert.equal(current.state.grab.objectId, id);
  assert.equal(current.state.grab.handId, 'pointer');
  assert.equal(light(current).state, 'held');
  assert.ok(distance(light(current).position, pickupPosition) > 1, 'the real drag did not pull the light toward the pointer');
  assert.ok(distance(light(current).position, current.state.grab.goal) > .5, 'the lamp snapped to the hand goal instead of staying cable-constrained');
  assert.equal(current.state.openedCrates, 0);
  await page.screenshot({ path: `${out}/pulled-light.png` });
  const drops = current.audio.eventCounts.drop || 0;
  const held = light(current);
  await page.mouse.up();
  current = await read();
  assert.equal(current.state.grab.active, false);
  assert.equal(current.audio.eventCounts.drop || 0, drops, 'releasing a ceiling fixture played the dropped-object kick');
  assert.equal(current.audio.loopActive, false, 'releasing did not stop the drag loop');
  await page.waitForTimeout(400);
  current = await observe('release swing', 1600);
  assert.equal(light(current).state, 'swinging');
  assert.ok(distance(light(current).position, held.position) > .05, 'the released lamp did not continue its physical swing');
  current = await observe('release settling', 30000);
  assert.equal(light(current).state, 'resting');
  assert.deepEqual(light(current).position, light(initial).position);
  assert.equal(current.audio.loopActive, false);
  assert.equal(current.audio.fadingLoops, 0);
  checks.push('a pointer hold owns the shared grab, pulls against a fixed wire, then releases into a damped swing without a drop sound');

  // Reset while this time still holding the lamp to exercise interaction and
  // sound cleanup through the normal shortcut, along with the full collection.
  const resetTarget = target(current);
  await page.mouse.move(resetTarget.screen.x, resetTarget.screen.y);
  await page.mouse.down();
  await page.waitForFunction(id => window.__restoreDiagnostics().state.grab.objectId === id, id, { timeout: 4000 });
  await page.mouse.move(resetTarget.screen.x - 180, resetTarget.screen.y + 60, { steps: 3 });
  await observe('before reset', 500);
  await page.keyboard.press('KeyR');
  await page.mouse.up();
  current = await read();
  assert.equal(current.state.grab.active, false);
  assert.equal(current.state.closedCrates, 176);
  assert.equal(current.state.hangingLights.active, 0);
  assert.deepEqual(current.state.hangingLights, initial.state.hangingLights);
  assert.equal(current.audio.loopActive, false);
  await look(-360);
  await page.screenshot({ path: `${out}/warm-archive.png` });
  assert.deepEqual(errors, []);
  checks.push('reset during a real lamp drag clears ownership and audio, restores every light and all 176 crates');
  const result = { passed: true, checks, errors, tap: tapped.input.lastTap, tapSound, held, final: current.state.hangingLights,
    postprocessing: current.state.postprocessing, samples };
  await writeFile(`${out}/browser-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors, samples: samples.length, postprocessing: current.state.postprocessing }, null, 2));
} catch (error) {
  await writeFile(`${out}/browser-failure.json`, JSON.stringify({ message: error.message, checks, errors,
    diagnostics: await page?.evaluate(() => window.__restoreDiagnostics?.()).catch(() => null), samples }, null, 2));
  await page?.screenshot({ path: `${out}/browser-failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
