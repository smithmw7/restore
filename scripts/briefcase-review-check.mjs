import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.RESTORE_REVIEW_URL || 'http://127.0.0.1:5211/briefcase-review.html';
const out = 'output/briefcase/review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, hasTouch: true });
const errors = [], checks = [];
const step = Math.PI / 5;
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const state = () => page.evaluate(() => window.__briefcaseReview.getState());
const angles = () => page.evaluate(() => [0, 1, 2, 3].map(index => window.__briefcaseReview.asset.getObjectByName(`Wheel_${index}`).rotation.x));
const camera = () => page.evaluate(() => window.__briefcaseReview.camera.position.toArray());
const angleError = (angle, digit) => Math.abs(Math.atan2(Math.sin(angle + digit * step), Math.cos(angle + digit * step)));
const digitsOf = value => value.digits || value.selectedDigits;

async function project(point) {
  return page.evaluate(point => {
    const review = window.__briefcaseReview;
    const p = review.asset.position.clone().fromArray(point);
    review.asset.localToWorld(p); p.project(review.camera);
    const rect = document.querySelector('#study').getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, point);
}
async function wheelStart(index) { return project([(index - 1.5) * .132, .01, .403]); }
async function reset() {
  await page.click('#reset-lock');
  await page.waitForFunction(() => {
    const s = window.__briefcaseReview.getState();
    return (s.digits || s.selectedDigits).every(d => d === 0) && s.open < .01 && !s.dragging;
  });
  await settled([0, 0, 0, 0]);
}
async function settled(digits) {
  await page.waitForFunction(digits => [0, 1, 2, 3].every(index => {
    const angle = window.__briefcaseReview.asset.getObjectByName(`Wheel_${index}`).rotation.x;
    return Math.abs(Math.atan2(Math.sin(angle + digits[index] * Math.PI / 5), Math.cos(angle + digits[index] * Math.PI / 5))) < .003;
  }), digits);
  assert.deepEqual(digitsOf(await state()), digits);
}

// Interaction helpers send real browser input. The scene is read only to aim at
// the visible modeled surfaces; no test writes a wheel angle or puzzle digit.
async function beginDrag(index) {
  const start = await wheelStart(index);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForFunction(() => Boolean(window.__briefcaseReview.getState().dragging));
  return start;
}
async function dragEndPoint(start, index, detents) {
  const { axis, pixelsPerDetent } = (await state()).dragging;
  assert.ok(pixelsPerDetent >= 14 && pixelsPerDetent <= 72);
  return { x: start.x + axis.x * pixelsPerDetent * detents, y: start.y + axis.y * pixelsPerDetent * detents };
}
async function moveDrag(start, index, detents) {
  const end = await dragEndPoint(start, index, detents);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  return end;
}
async function dragWheel(index, detents) {
  const start = await beginDrag(index);
  await moveDrag(start, index, detents);
  await page.mouse.up();
  await page.waitForFunction(() => !window.__briefcaseReview.getState().dragging);
}
async function clickLatch(side) {
  const p = await page.evaluate(side => {
    const review = window.__briefcaseReview;
    const latch = review.asset.getObjectByName(`LatchPivot_${side === 'left' ? 'L' : 'R'}`);
    const point = latch.position.clone().set(0, -.055, .021);
    latch.localToWorld(point); point.project(review.camera);
    const rect = document.querySelector('#study').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, side);
  await page.mouse.click(p.x, p.y);
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__briefcaseReview?.ready, null, { timeout: 90000 });
  for (const name of ['front', 'rear', 'top', 'under', 'detail']) {
    await page.click(`[data-angle="${name}"]`);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await reset();
  await page.click('[data-lid="1"]');
  await page.waitForTimeout(300);
  assert.ok((await state()).open < .01, 'A wrong combination cannot open from the inspection button');
  await page.click('[data-angle="front"]');
  await clickLatch('left');
  await page.waitForTimeout(300);
  assert.ok((await state()).open < .01, 'A wrong combination cannot open the modeled latch');
  checks.push('Incorrect code keeps both the inspection control and modeled latch locked');

  await page.click('[data-angle="detail"]');
  await page.waitForTimeout(400);
  const cameraBefore = await camera();
  const start = await beginDrag(0);
  await moveDrag(start, 0, 1.35);
  await page.waitForTimeout(80);
  const freeAngle = (await angles())[0];
  assert.ok(Math.abs(freeAngle / step - Math.round(freeAngle / step)) > .15, 'The wheel turns continuously between detents while held');
  assert.ok((await state()).dragging, 'Pointer remains captured while dragging');
  const cameraDuring = await camera();
  assert.ok(Math.hypot(...cameraDuring.map((value, index) => value - cameraBefore[index])) < 1e-6, 'Dragging a wheel does not orbit the camera');
  await page.screenshot({ path: `${out}/drag-between-detents.png` });
  await page.mouse.up();
  await settled([1, 0, 0, 0]);
  const afterSnap = (await angles())[0];
  assert.ok(angleError(afterSnap, 1) < .003, 'Release snaps to the nearest 36 degree detent');
  assert.ok(Math.abs(afterSnap - freeAngle) > .1, 'Snapping visibly resolves a partial detent');
  checks.push('Direct drag is continuous and captures the pointer; release settles to the nearest numeral without camera motion');

  await dragWheel(0, -.8); await settled([0, 0, 0, 0]);
  await dragWheel(0, -1); await settled([9, 0, 0, 0]);
  const nineAngle = (await angles())[0];
  await page.screenshot({ path: `${out}/numeral-9.png` });
  await dragWheel(0, 1); await settled([0, 0, 0, 0]);
  const zeroAngle = (await angles())[0];
  assert.ok(Math.abs(zeroAngle - nineAngle) < step * 1.02, '9 to 0 advances one detent rather than reversing nine');
  checks.push('Both drag directions and the 0/9 boundary use one continuous detent');

  const cancelStart = await beginDrag(1);
  await moveDrag(cancelStart, 1, .7);
  await page.evaluate(() => {
    const { pointerId } = window.__briefcaseReview.getState().dragging;
    document.querySelector('#study').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId, pointerType: 'mouse' }));
  });
  await page.mouse.up();
  assert.ok(!(await state()).dragging, 'Pointer cancellation releases the drag');
  assert.equal(await page.evaluate(() => window.__briefcaseReview.controls.enabled), true, 'Orbit controls recover after cancellation');
  await reset();
  checks.push('Cancelled input releases the wheel and restores orbit controls');

  const orbitBefore = await camera();
  await page.mouse.move(1390, 230); await page.mouse.down();
  await page.mouse.move(1300, 270, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const orbitAfter = await camera();
  assert.ok(Math.hypot(...orbitAfter.map((value, index) => value - orbitBefore[index])) > .01, 'Dragging the background still orbits');
  await page.click('[data-angle="detail"]'); await page.waitForTimeout(400);
  checks.push('Background dragging retains model orbit');

  const touch = await page.context().newCDPSession(page);
  const touchStart = await wheelStart(2);
  const touchPoint = p => ({ x: p.x, y: p.y, radiusX: 2, radiusY: 2, force: 1, id: 7 });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(touchStart)] });
  await page.waitForFunction(() => Boolean(window.__briefcaseReview.getState().dragging));
  const touchEnd = await dragEndPoint(touchStart, 2, 1.2);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(touchEnd)] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled([0, 0, 1, 0]);
  await touch.detach();
  checks.push('Touch dragging uses the same continuous rotation and nearest-detent snap');
  await reset();

  for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    await dragWheel(2, 1);
    await settled([0, 0, digit, 0]);
  }
  const partial = await beginDrag(2);
  await moveDrag(partial, 2, .35); await page.mouse.up();
  await settled([0, 0, 0, 0]);
  checks.push('All ten modeled numeral detents align after direct drags; a sub-half turn returns to its original detent');
  await reset();

  for (const [index, amount] of [[0, 1], [1, -1], [2, 4], [3, 2]]) {
    if (index === 3) {
      const finalStart = await beginDrag(index);
      await moveDrag(finalStart, index, amount);
      assert.equal((await state()).unlocked, false, 'Passing through 1942 while held does not unlock');
      await page.mouse.up();
    } else await dragWheel(index, amount);
    const expected = [[1, 0, 0, 0], [1, 9, 0, 0], [1, 9, 4, 0], [1, 9, 4, 2]][index];
    await settled(expected);
  }
  await page.waitForTimeout(100);
  const unlocked = await state();
  assert.ok(unlocked.unlocked === true || unlocked.locked === false, 'Only the released 1942 combination unlocks');
  await page.screenshot({ path: `${out}/combination-1942.png` });
  await page.click('[data-angle="front"]'); await page.waitForTimeout(400);
  await clickLatch('right'); await page.waitForTimeout(1100);
  assert.ok((await state()).open > .99, 'The actual modeled latch opens after solving 1942');
  await page.screenshot({ path: `${out}/open.png` });
  await page.click('[data-lid="0"]'); await page.waitForTimeout(1100);
  assert.ok((await state()).open < .01);
  await page.click('[data-lid="1"]'); await page.waitForTimeout(1100);
  assert.ok((await state()).open > .99, 'The inspection button can reopen a solved case');
  checks.push('1942 unlocks through pointer input; modeled latch opens and inspection controls close/reopen');

  await page.locator('#explode').fill('1'); await page.waitForTimeout(1200);
  assert.ok((await state()).explode > .99);
  await page.screenshot({ path: `${out}/exploded.png` });
  const explodedDigits = digitsOf(await state());
  const explodedStart = await project([-.198 - .0525, .01 + .04, .403 + .20]);
  await page.mouse.move(explodedStart.x, explodedStart.y); await page.mouse.down();
  await page.mouse.move(explodedStart.x, explodedStart.y - 90, { steps: 8 }); await page.mouse.up();
  assert.deepEqual(digitsOf(await state()), explodedDigits, 'Exploded inspection does not alter the combination');
  assert.ok(!(await state()).dragging);
  await page.locator('#explode').fill('0'); await page.waitForTimeout(1100);
  await reset();
  const resetState = await state();
  assert.ok(resetState.locked === true || resetState.unlocked === false, 'Reset relocks the case');
  checks.push('Exploded inspection disables wheel input and reset returns a closed locked 0000 case');

  assert.deepEqual(errors, []);
  const report = { url, views: 5, checks, freeAngle, afterSnap, wrap: { nineAngle, zeroAngle }, errors, finalState: await state(), stats: await page.evaluate(() => window.__briefcaseReview.stats) };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
