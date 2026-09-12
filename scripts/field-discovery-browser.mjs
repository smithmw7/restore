import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// All opening progress and the first two installations below use pointer
// input in a fresh browser context. The explicitly marked final-lens fixture
// covers presentation/reload separately from natural player discovery.
const url = process.env.RESTORE_URL || 'http://127.0.0.1:5211/';
const out = process.env.RESTORE_FIELD_OUTPUT || 'output/field-discovery';
const width = 1800, height = 1000;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const errors = [], checks = [], observations = [];
let mouse = { x: width / 2, y: height / 2 };
let navigations = 0, expectedNavigations = 0;
page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const pause = milliseconds => page.waitForTimeout(milliseconds);
const read = () => page.evaluate(() => {
  const d = window.__restoreDiagnostics();
  return { opening: d.state.opening, mechanism: d.state.mechanism, grab: d.state.grab, audio: d.audio };
});
const part = async id => (await read()).mechanism.parts.find(p => p.id === id);
const distance = (a, b) => Math.hypot(...a.map((n, index) => n - b[index]));
function pass(label) { checks.push(label); console.log(`PASS: ${label}`); }
async function ready() {
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  assert.ok(await page.evaluate(() => !!window.__restoreOpening), 'field QA requires the development server');
  assert.equal(navigations, expectedNavigations, 'no unexpected Vite reload interrupted the physical sequence');
}
async function reload() { expectedNavigations++; await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
async function view(position, target) {
  // Framing only. This helper uses the normal locomotion clearance checks.
  assert.equal(await page.evaluate(({ position, target }) => window.__restoreOpening.view(position, target), { position, target }), true, `clear viewing position ${position}`);
  await pause(180);
}
async function move(x, y, steps = 1) {
  assert.ok(x > 5 && x < width - 5 && y > 5 && y < height - 5, `pointer remains in canvas: ${x}, ${y}`);
  mouse = { x, y };
  await page.mouse.move(x, y, { steps });
}
async function tap(id) {
  const target = await page.evaluate(id => window.__restoreDiagnostics().state.objects.find(p => p.id === id), id);
  assert.ok(target, `visible input target ${id}`);
  await move(target.screen.x, target.screen.y);
  await page.mouse.click(mouse.x, mouse.y, { delay: 30 });
  await pause(230);
}
async function screenshot(name) { await page.screenshot({ path: `${out}/${name}.png` }); }
async function grab(id, { objectId = `mechanism-${id}`, hold = 35 } = {}) {
  const points = await page.evaluate(id => {
    const { assembly, camera } = window.__restoreOpening;
    const mesh = assembly.targets.find(p => p.name === id || p.userData.labObject === id);
    if (!mesh) return [];
    mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.attributes.position, index = mesh.geometry.index, points = [];
    for (let i = 0; i + 2 < (index ? index.count : positions.count); i += 9) {
      const point = mesh.position.clone().set(0, 0, 0);
      for (let j = 0; j < 3; j++) point.add(mesh.position.clone().fromBufferAttribute(positions, index ? index.getX(i + j) : i + j));
      point.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld).project(camera);
      const x = (point.x * .5 + .5) * innerWidth, y = (-point.y * .5 + .5) * innerHeight;
      if (point.z > -1 && point.z < 1 && x > 35 && x < innerWidth - 35 && y > 35 && y < innerHeight - 35) points.push({ x, y });
    }
    return points;
  }, id);
  assert.ok(points.length, `${id} has visible surface candidates`);
  for (const candidate of points) {
    await move(candidate.x, candidate.y);
    await page.mouse.down();
    await pause(hold);
    if ((await read()).grab.objectId === objectId) return;
    await page.mouse.up();
  }
  assert.fail(`actual pointer could not select ${id}`);
}
async function goalAdjustment(target) {
  return page.evaluate(target => {
    const { assembly, camera } = window.__restoreOpening;
    const state = assembly.getGrabState();
    if (!state.active) return null;
    const current = camera.position.clone().fromArray(state.goal), destination = current.clone().fromArray(target);
    const forward = camera.getWorldDirection(current.clone());
    const pointer = window.__restoreDiagnostics().input.desktopGrab?.point;
    if (!pointer) return null;
    const currentTouch = current.clone().fromArray(pointer);
    const nextTouch = currentTouch.clone().add(destination.clone().sub(current));
    const depth = nextTouch.clone().sub(currentTouch).dot(forward);
    const b = nextTouch.clone().project(camera);
    return { depth, x: (b.x * .5 + .5) * innerWidth, y: (-b.y * .5 + .5) * innerHeight, error: current.distanceTo(destination), actual: state.anchor };
  }, target);
}
async function aim(target, { maxIterations = 36 } = {}) {
  // Mouse wheel is the game's actual held-depth control. Screen projection
  // supplies the drag delta; no body, goal, transform or progression API is set.
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let adjust = await goalAdjustment(target);
    if (!adjust || adjust.error < .012) return adjust;
    await page.mouse.wheel(0, Math.max(-100, Math.min(100, adjust.depth * 500)));
    await pause(20);
    adjust = await goalAdjustment(target);
    if (!adjust) return null;
    await move(adjust.x, adjust.y);
    await pause(20);
  }
  const adjust = await goalAdjustment(target);
  assert.ok(!adjust || adjust.error < .04, `pointer requested the intended position: ${JSON.stringify({ target, adjust })}`);
  return adjust;
}
async function carry(id, target, { installed = false, timeout = 7000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await aim(target);
    const current = await read();
    const p = current.mechanism.parts.find(p => p.id === id);
    if (p.installed) return p;
    if (!installed && distance(p.position, target) < .09) return p;
    assert.equal(current.grab.objectId, `mechanism-${id}`, `${id} retains grab ownership while travelling`);
    // Repeating the depth control resets the normal delayed hold-to-pull
    // behavior while the solver catches up to the selected waypoint.
    await page.mouse.wheel(0, 0);
    await pause(90);
  }
  assert.fail(`${id} did not ${installed ? 'install' : 'reach waypoint'}: ${JSON.stringify({ target, part: await part(id), grab: (await read()).grab })}`);
}
async function release() { await page.mouse.up(); await pause(250); }
function assertNoResonance(state, label) {
  assert.equal(state.mechanism.resonance.active, false, `${label}: assembly resonance stops`);
  assert.equal(state.audio.fieldActive, false, `${label}: actual sustained field voice stops`);
}

try {
  expectedNavigations++;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready();
  let state = await read();
  assert.equal(state.opening.caseUnlocked, false);
  assert.equal(state.opening.noteSeen, false);
  assert.equal(state.opening.containerCut, false);
  assert.equal(state.opening.containerOpen, false);
  assert.deepEqual(state.opening.gloves, { left: false, right: false });
  assert.equal(state.mechanism.installed, 0);
  assert.equal(state.mechanism.stage, 0);
  assert.equal((await part('frame-0-0')).visible, true, 'the first support is accessible before the cutter branch');
  assert.equal((await part('strut-0')).visible, true);
  await view([10.6, 0, 12.25], [10.6, 1.22, 10.95]);
  await tap('locker'); await pause(650); await tap('glove-right');
  state = await read();
  assert.equal(state.opening.gloves.right, true);
  assert.equal(state.opening.gloves.left, false);
  assert.equal(state.opening.caseUnlocked || state.opening.containerOpen || state.opening.cuttersFound, false);
  pass('a fresh player equips one glove before solving either clue or cutter branch');

  await view([-5.2, 0, 11.55], [-5.4, 1.4, 8.7]);
  await pause(650);
  const invitation = (await read()).mechanism.presentation;
  assert.equal(invitation.connectorInvitation, true, 'a nearby equipped player sees the local first-fit invitation');
  observations.push({ name: 'first-fit-invitation', presentation: invitation });
  await screenshot('01-first-pair-available');
  await view([-5.8, 0, 12], [-5.4, 1.65, 8.7]);
  await grab('frame-0-0');
  const firstGoal = (await part('frame-0-0')).goal;
  const firstAnchor = (await part('frame-0-0')).position;
  assert.ok(distance(firstAnchor, firstGoal) > .8, 'first frame begins beyond the local alignment range');
  // Move the *requested* target near its destination while the real body
  // still has to travel. A distant physical part must not report a valid fit.
  await aim(firstGoal);
  state = await read();
  const separation = distance(state.mechanism.parts.find(p => p.id === 'frame-0-0').position, firstGoal);
  observations.push({ name: 'goal-versus-body', separation, resonance: state.mechanism.resonance });
  assert.ok(Math.abs(state.mechanism.resonance.separation - separation) < .03, 'cue distance reports the physical part, not its requested hand target');
  if (separation > 1.2) assert.equal(state.mechanism.resonance.active, false, 'a remote drag target does not create a local alignment cue');
  await carry('frame-0-0', [firstGoal[0], 2.55, 10.3]);
  await carry('frame-0-0', [firstGoal[0], 2.55, firstGoal[2]]);
  await carry('frame-0-0', firstGoal, { installed: true });
  await release();
  assert.equal((await part('frame-0-0')).installed, true);
  assert.equal((await read()).opening.containerOpen, false);
  await screenshot('02-first-frame-seated');
  pass('the first frame travels through real collisions and seats with the container still closed');

  await grab('strut-0');
  const strutGoal = (await part('strut-0')).goal;
  await carry('strut-0', [strutGoal[0], 2.5, 10.25]);
  await carry('strut-0', [strutGoal[0], 2.5, strutGoal[2]]);
  await carry('strut-0', strutGoal, { installed: true });
  await release();
  state = await read();
  assert.equal(state.mechanism.installed, 2);
  assert.equal(state.mechanism.stage, 1);
  assert.ok(state.mechanism.milestones.length > 0);
  assert.equal(state.opening.containerOpen || state.opening.containerCut || state.opening.caseUnlocked, false);
  assertNoResonance(state, 'first pair installed');
  await screenshot('03-first-connection');
  pass('matching strut produces the first persistent discovery milestone using actual pointer input');

  const firstConnection = { stage: state.mechanism.stage, milestones: state.mechanism.milestones, installed: state.mechanism.installed };
  await reload();
  state = await read();
  assert.equal(state.mechanism.installed, 2);
  assert.equal(state.mechanism.stage, firstConnection.stage);
  assert.deepEqual(state.mechanism.milestones, firstConnection.milestones);
  assert.equal(state.opening.containerOpen, false);
  assertNoResonance(state, 'reload');
  pass('first connection and its earned response survive reload independently of container progress');

  await view([-8, 0, 12.55], [-7.4, 1.65, 9]);
  await grab('shield-0');
  const shieldGoal = (await part('shield-0')).goal;
  const shieldStart = (await part('shield-0')).position;
  await carry('shield-0', [shieldStart[0], 2.4, shieldStart[2]]);
  await carry('shield-0', [shieldGoal[0], shieldGoal[1] + .65, shieldGoal[2]]);
  await pause(400);
  state = await read();
  assert.equal(state.mechanism.resonance.active, true, 'the physically nearby compatible piece produces a local cue');
  assert.equal(state.audio.fieldActive, true, 'the real shared audio system sustains its quiet alignment voice');
  observations.push({ name: 'local-alignment', resonance: state.mechanism.resonance });
  await screenshot('04-local-alignment');
  await release();
  state = await read();
  assert.equal(state.grab.active, false);
  assertNoResonance(state, 'drop');
  assert.equal(state.audio.loopActive, false, 'drop stops the ordinary quiet dragging voice');
  pass('dropping a part ends local resonance and dragging audio');

  await view([-10.5, 0, 11.05], [-10.5, 1.3, 9.35]);
  await grab('field-lens');
  state = await read();
  assert.equal((await part('field-lens')).available, false);
  assert.equal(state.mechanism.resonance.eligible, false);
  assert.equal(state.mechanism.resonance.signal, 0);
  await page.keyboard.press('o'); await release();
  state = await read();
  assert.equal(state.grab.active, false);
  assertNoResonance(state, 'office shortcut cancels input');
  pass('a physically unsupported piece gives no fit cue and the office shortcut safely cancels manipulation');

  // Presentation fixture: the natural first-connection evidence above is
  // kept distinct from this 23-installed-parts save. Only the final lens is
  // installed by pointer in this scenario, exercising activation and reload.
  const fixtureParts = (await read()).mechanism.parts.map(p => ({ id: p.id, installed: p.id !== 'field-lens', position: p.id === 'field-lens' ? [-6.1, 1.045, 10.55] : p.goal }));
  await page.evaluate(parts => localStorage.setItem('restore.opening.mechanism.v1', JSON.stringify({ version: 1, revealed: true, completed: false, parts })), fixtureParts);
  await reload();
  await view([-5.8, 0, 12], [-5.4, 1.65, 8.7]);
  assert.equal((await read()).mechanism.stage, 3);
  await grab('field-lens');
  const lensGoal = (await part('field-lens')).goal;
  await carry('field-lens', [lensGoal[0], 2.55, 10.3]);
  await carry('field-lens', [lensGoal[0], 2.55, lensGoal[2]]);
  await carry('field-lens', lensGoal, { installed: true }); await release();
  await view([-5, 0, 11.4], [-5, 1.75, 8.7]);
  state = await read();
  assert.equal(state.mechanism.stage, 4);
  assert.equal(state.mechanism.completed, true);
  assert.equal(state.mechanism.installed, 24);
  await screenshot('05-awakening-staged-last-lens');
  await pause(5500);
  await screenshot('06-awakened-resting-state');
  state = await read();
  assert.equal(state.mechanism.sample.active, true);
  assert.equal(state.mechanism.sample.levitating, true);
  assert.ok(state.mechanism.sample.position[1] > state.mechanism.sample.home[1] + .2, 'a real specimen has risen off its stand');

  await view([-3.45, 0, 11.35], [-3.42, 1.4, 9.7]);
  await grab('field-specimen', { objectId: 'field-specimen', hold: 240 });
  const sampleHome = (await read()).mechanism.sample.home;
  const outsideField = [sampleHome[0], sampleHome[1] + .1, sampleHome[2] + 1.05];
  await aim(outsideField); await pause(700); await aim(outsideField); await pause(200);
  assert.equal((await read()).mechanism.sample.held, true);
  await screenshot('07-specimen-removed-from-field');
  await release(); await pause(1400);
  state = await read();
  assert.equal(state.mechanism.sample.levitating, false);
  assert.ok(state.mechanism.sample.position[1] < .4, 'outside the field the released physical specimen falls');
  await view([-3.45, 0, 12.2], [-3.42, .8, 10.25]);
  await grab('field-specimen', { objectId: 'field-specimen', hold: 240 });
  await aim([sampleHome[0], 1.5, sampleHome[2] + 1.05]); await pause(700);
  await aim([sampleHome[0], 1.5, sampleHome[2]]); await pause(700);
  await release(); await pause(1800);
  state = await read();
  assert.equal(state.mechanism.sample.levitating, true);
  assert.ok(state.mechanism.sample.position[1] > sampleHome[1] + .2);
  await screenshot('08-specimen-returned-to-field');
  pass('the awakened mechanism suspends a real pickable specimen; removal restores gravity and returning it resumes lift');

  const completed = (await read()).mechanism;
  await reload();
  state = await read();
  assert.equal(state.mechanism.stage, 4);
  assert.equal(state.mechanism.completed, true);
  assert.deepEqual(state.mechanism.milestones, completed.milestones);
  assertNoResonance(state, 'completed save reload');
  assert.equal(state.audio.eventCounts.fieldMilestone || 0, 0, 'reload does not replay the milestone sound');
  pass('staged 23-part save plus an actual final lens drag awakens once and preserves the completed milestone');

  assert.deepEqual(errors, []);
  assert.equal(navigations, expectedNavigations, 'no unexpected runtime reload contaminated browser evidence');
  pass('no page or console errors');
  await writeFile(`${out}/report.json`, JSON.stringify({ url, passed: checks.length, checks, errors, observations, firstConnection, evidence: { opening: 'fresh context; actual locker/glove pointer input; actual frame and strut dragging', completion: 'explicit 23-installed-parts save fixture; actual final lens pointer drag' }, final: state }, null, 2));
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.stack, checks, errors, observations, state: await read().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
