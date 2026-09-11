import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.RESTORE_URL || 'http://127.0.0.1:5212/';
const reviewUrl = process.env.RESTORE_REVIEW_URL || new URL('briefcase-review.html', url).href;
const out = 'output/desktop-navigation';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [], measurements = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const read = () => page.evaluate(() => window.__restoreDiagnostics());
const ready = () => page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
const pass = label => { checks.push(label); console.log(`PASS: ${label}`); };
const distanceXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function progression(diagnostics) {
  const { opening, resetCount, openedCrates, broken, debris } = diagnostics.state;
  return {
    resetCount, openedCrates, broken, debris,
    ...Object.fromEntries(['wheels', 'drawerOpen', 'notebookOpen', 'noteSeen', 'lockerOpen', 'caseUnlocked', 'caseOpen',
      'gloves', 'cuttersFound', 'containerCut', 'containerOpen', 'photosViewed', 'milestones'].map(key => [key, opening[key]])),
  };
}

function office(diagnostics) {
  assert.ok(distanceXZ(diagnostics.state.locomotion.head, [7, 0, 11.4]) < .015, 'O places the player in the clear office aisle');
  const [x, y, z, w] = diagnostics.input.camera.quaternion;
  const forward = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
  const position = diagnostics.input.camera.position;
  const target = [7 - position[0], 1.1 - position[1], 8.15 - position[2]];
  const length = Math.hypot(...target);
  assert.ok(forward.reduce((sum, value, index) => sum + value * target[index] / length, 0) > .999, 'O faces the office desk');
}

async function advance(milliseconds = 100) {
  // Keyboard input is real browser input. Take both samples in one synchronous
  // task so normal animation frames cannot alter the measured movement rate.
  return page.evaluate(milliseconds => {
    const before = window.__restoreDiagnostics().state.locomotion.head;
    window.advanceTime(milliseconds);
    const after = window.__restoreDiagnostics().state.locomotion.head;
    const seconds = Math.max(1, Math.round(milliseconds / (1000 / 72))) / 72;
    return { before, after, seconds, speed: Math.hypot(after[0] - before[0], after[2] - before[2]) / seconds };
  }, milliseconds);
}

async function keyMotion(keys, milliseconds = 100) {
  for (const key of keys) await page.keyboard.down(key);
  try { return await advance(milliseconds); }
  finally { for (const key of keys) await page.keyboard.up(key); }
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready();
  const initial = await read(), unchanged = progression(initial);
  const briefcase = initial.state.opening.briefcase;
  assert.equal(briefcase.loaded, true, briefcase.error || 'office briefcase did not load');
  assert.equal(briefcase.version, '1.1.0');
  assert.equal(briefcase.physicalNumerals, true);
  assert.equal(briefcase.numeralsPerWheel, 10);
  assert.equal(briefcase.handle, false);
  pass('The office loads the handle-free Blender briefcase with all ten physical numerals per wheel');

  await page.keyboard.press('o');
  office(await read());
  const straight = await keyMotion(['s']);
  measurements.push({ control: 'S', ...straight });
  assert.ok(straight.speed > 4.9 && straight.speed < 5.1, `desktop movement is 5 m/s, got ${straight.speed}`);
  assert.ok(distanceXZ(straight.after, [7, 0, 11.4]) > .4, 'S moves the player away from the office arrival point');
  await page.keyboard.press('o');
  office(await read());
  pass('Keyboard movement is 5 m/s and O returns from another position to the office desk');

  const diagonal = await keyMotion(['w', 'd']);
  measurements.push({ control: 'W+D', ...diagonal });
  assert.ok(diagonal.speed > 4.9 && diagonal.speed < 5.1, `diagonal movement stays normalized, got ${diagonal.speed}`);
  await page.keyboard.press('o');
  office(await read());
  pass('Diagonal keyboard movement has the same speed as forward and backward movement');

  await page.keyboard.press('ArrowRight');
  const turned = await read();
  await page.keyboard.press('o');
  office(await read());
  assert.ok(turned.state.locomotion.turnCount > initial.state.locomotion.turnCount, 'the test really changed player orientation');
  pass('O restores the desk view after turning even when already standing at the office arrival point');

  await page.keyboard.down('w');
  await page.keyboard.press('o');
  const cleared = await advance();
  await page.keyboard.up('w');
  assert.ok(distanceXZ(cleared.before, cleared.after) < .001, 'teleport clears held movement keys');
  office(await read());
  pass('O clears held movement so an old key press cannot carry the player away after teleporting');

  await keyMotion(['s'], 1000);
  const cabinet = (await read()).state.locomotion.head;
  assert.ok(cabinet[2] > 12.1 && cabinet[2] < 12.5, `backward movement stops before the office map cabinet: ${cabinet}`);
  const blocked = await keyMotion(['s'], 300);
  assert.ok(distanceXZ(blocked.before, blocked.after) < .01, 'continued movement cannot pass through the office cabinet');
  await keyMotion(['d'], 400);
  await keyMotion(['s'], 1000);
  const wall = (await read()).state.locomotion.head;
  assert.ok(wall[2] > 12.9 && wall[2] < 13.2, `movement beside the cabinet stops at the office wall: ${wall}`);
  const wallBlocked = await keyMotion(['s'], 300);
  assert.ok(distanceXZ(wallBlocked.before, wallBlocked.after) < .01, 'continued movement cannot pass through the office wall');
  measurements.push({ control: 'S into office wall', position: wall });
  await page.screenshot({ path: `${out}/office-wall-stop.png` });
  await page.keyboard.press('o');
  office(await read());
  pass('The faster movement still respects office furniture and wall collision');

  await keyMotion(['s']);
  const beforeText = await read();
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'navigation-input-check';
    input.style.cssText = 'position:fixed;top:50px;left:50px;z-index:1000';
    document.body.append(input); input.focus();
  });
  await page.keyboard.type('or');
  const typing = await keyMotion(['w']);
  assert.ok(distanceXZ(typing.before, typing.after) < .001, 'typing W does not move the player');
  assert.equal(await page.inputValue('#navigation-input-check'), 'orw');
  assert.ok(distanceXZ((await read()).state.locomotion.head, beforeText.state.locomotion.head) < .001, 'typing O does not teleport');
  assert.deepEqual(progression(await read()), unchanged, 'typing R does not reset the warehouse or puzzle');
  await page.evaluate(() => document.querySelector('#navigation-input-check').remove());
  await page.keyboard.press('o');
  office(await read());
  pass('Typing in an editable field does not trigger movement, office teleport or warehouse reset');

  const final = await read();
  assert.deepEqual(progression(final), unchanged, 'navigation preserves puzzle knowledge, equipment and crate state');
  assert.equal(final.state.grab.active, false);
  assert.equal(final.audio.loopActive, false);
  await page.screenshot({ path: `${out}/office-shortcut.png` });
  pass('Office navigation leaves progression and destruction state untouched, with no stuck grab or drag sound');

  await page.goto(reviewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__briefcaseReview?.ready, null, { timeout: 90000 });
  await page.keyboard.press('o');
  await page.waitForURL(current => !current.pathname.includes('briefcase-review.html'), { timeout: 15000 });
  await ready();
  office(await read());
  assert.deepEqual(progression(await read()), unchanged, 'returning from the review preserves saved puzzle state');
  await page.screenshot({ path: `${out}/review-to-office.png` });
  pass('O from the briefcase review returns directly to the main office');

  assert.deepEqual(errors, []);
  pass('No browser or console errors');
  await writeFile(`${out}/report.json`, JSON.stringify({ url, reviewUrl, checks, measurements, errors, state: await read() }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.stack, checks, measurements, errors, diagnostics: await read().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
