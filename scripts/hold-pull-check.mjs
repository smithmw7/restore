import assert from 'node:assert/strict';
import { createHoldPull, stepHoldPull } from '../src/hold-pull.js';

const checks = [];
const point = (x, y, z) => ({ x, y, z });
const origin = point(0, 1.65, 0), direction = point(0, 0, -1);
const standard = { origin, direction, viewer: origin };
const target = (pose, distance) => point(
  pose.origin.x + pose.direction.x * distance,
  pose.origin.y + pose.direction.y * distance,
  pose.origin.z + pose.direction.z * distance,
);
const headDistance = (pose, distance) => {
  const value = target(pose, distance);
  return Math.hypot(value.x - pose.viewer.x, value.y - pose.viewer.y, value.z - pose.viewer.z);
};
const check = (name, fn) => {
  try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
};
function simulate(state, distance, seconds, fps = 72, pose = standard, inspect) {
  const frames = Math.round(seconds * fps), dt = seconds / frames;
  for (let frame = 0; frame < frames; frame++) {
    const currentPose = typeof pose === 'function' ? pose(frame / fps) : pose;
    const previous = distance;
    distance = stepHoldPull(state, dt, { ...currentPose, distance });
    assert.ok(Number.isFinite(distance) && distance >= 0, `invalid distance ${distance}`);
    assert.ok(distance <= previous + 1e-8, 'automatic pull pushed the object away');
    inspect?.(currentPose, distance, previous);
  }
  return distance;
}

check('a fresh grab has a grace period before its pull gradually accelerates', () => {
  const state = createHoldPull(.9);
  let distance = simulate(state, 8, .4);
  assert.equal(distance, 8, 'the object moved during the initial grace period');
  const earlyStart = distance;
  distance = simulate(state, distance, .7);
  const earlyPull = earlyStart - distance;
  assert.ok(earlyPull > 0 && earlyPull < .2, `initial pull was not gentle: ${earlyPull}`);
  distance = simulate(state, distance, 2.4);
  const lateStart = distance;
  distance = simulate(state, distance, .7);
  const latePull = lateStart - distance;
  assert.ok(latePull > earlyPull * 2, `holding longer did not increase pull: ${earlyPull} -> ${latePull}`);
  assert.ok(latePull <= .6 * .7 + .005, `pull exceeded its speed limit: ${latePull}`);
});

check('equal elapsed holds produce consistent movement at 30, 72, and 120 Hz', () => {
  for (const seconds of [1.5, 4, 12]) {
    const distances = [30, 72, 120].map((fps) => simulate(createHoldPull(.9), 8, seconds, fps));
    assert.ok(Math.max(...distances) - Math.min(...distances) < .035, `${seconds}s frame-rate variation: ${distances}`);
  }
});

check('sustained pull eases to the comfort surface and never pushes already-near objects outward', () => {
  let smallestStep = Infinity;
  const stop = simulate(createHoldPull(.9), 3, 18, 72, standard, (_pose, value, previous) => {
    assert.ok(value >= .9 - 1e-7, 'pull entered the head clearance sphere');
    if (value < 1.15 && previous > 1) smallestStep = Math.min(smallestStep, previous - value);
  });
  assert.ok(stop < 1, `pull stopped too far from its comfort target: ${stop}`);
  assert.ok(smallestStep < .6 / 72 / 2, 'pull did not slow before reaching the clearance surface');
  const close = simulate(createHoldPull(.9), .55, 5);
  assert.equal(close, .55, 'an already-close object was repositioned automatically');
});

check('an offset controller ray stops at head clearance rather than a fixed hand-relative depth', () => {
  const pose = { origin: point(.35, 1.25, -.4), direction, viewer: origin };
  const distance = simulate(createHoldPull(.9), 3, 18, 72, pose, (current, value) => {
    assert.ok(headDistance(current, value) >= .9 - 1e-7, 'offset controller pulled the object inside head clearance');
  });
  assert.ok(headDistance(pose, distance) < 1, 'offset ray failed to approach the comfort surface');
  assert.ok(distance < .6, 'head clearance was incorrectly treated as hand-to-target distance');
  const sidePose = { origin: point(1.2, 1.65, 0), direction, viewer: origin };
  simulate(createHoldPull(.9), 2, 18, 72, sidePose, (current, value) => {
    assert.ok(headDistance(current, value) >= .9 - 1e-7, 'a ray missing the head sphere violated clearance');
  });
});

check('the comfort stop follows the current viewer pose while the object is held', () => {
  const changingPose = (time) => ({
    origin: point(.25, 1.25, -.3), direction,
    // The user moves before the approaching target reaches their stop surface.
    // If they walk into an already-close target, auto-pull must not push it away.
    viewer: point(.04 * Math.min(time, 2), 1.65, -Math.min(time * .15, .3)),
  });
  simulate(createHoldPull(.9), 5, 10, 72, changingPose, (pose, value) => {
    assert.ok(headDistance(pose, value) >= .9 - 1e-6, 'moving viewer clearance was evaluated from a stale pose');
  });
});

check('manual placement restarts the gentle ramp and a new pickup has independent timing', () => {
  const state = createHoldPull(.9);
  let distance = simulate(state, 8, 4);
  const manualDistance = distance + .8;
  distance = stepHoldPull(state, 1 / 72, { ...standard, distance: manualDistance, manual: true });
  assert.equal(distance, manualDistance, 'automatic pull fought manual placement');
  distance = simulate(state, distance, .35);
  assert.equal(distance, manualDistance, 'manual placement did not restart the grace period');
  const resumed = simulate(state, distance, .8);
  assert.ok(resumed < distance && distance - resumed < .25, 'manual release resumed at full pull speed');
  assert.equal(simulate(createHoldPull(.9), 4, .4), 4, 'new pickup inherited an earlier hold timer');
});

check('zero elapsed time and a long frame remain finite and respect the same stop', () => {
  const state = createHoldPull(.9);
  assert.equal(stepHoldPull(state, 0, { ...standard, distance: 4 }), 4);
  const result = stepHoldPull(state, 60, { ...standard, distance: 4 });
  assert.ok(Number.isFinite(result) && result >= .9 && result <= 4, `long frame produced ${result}`);
});

console.log(JSON.stringify({ passed: true, checks, frameRates: [30, 72, 120] }, null, 2));
