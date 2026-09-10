import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLocomotion, SNAP_TURN_RADIANS, TELEPORT_CLEARANCE } from '../src/locomotion.js';

const checks = [];
const vector = (values) => new THREE.Vector3().fromArray(values);
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} versus ${expected}`);
}
function fixture({ xr = false, beforeMove } = {}) {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0.7, 1.65, 0.35);
  const controller = new THREE.Group();
  controller.position.set(0, 1.2, 0);
  const otherController = new THREE.Group();
  otherController.position.set(0.25, 1.2, 0);
  rig.add(camera, controller, otherController);
  scene.add(rig);
  const gamepad = { axes: [0, 0, 0, 0], buttons: [{}, {}, {}, { pressed: false }] };
  const otherGamepad = { axes: [0, 0, 0, 0], buttons: [{}, {}, {}, { pressed: false }] };
  const input = { id: 'left', controller, grabbing: false, source: { gamepad } };
  const otherInput = { id: 'right', controller: otherController, grabbing: false, source: { gamepad: otherGamepad } };
  const obstacles = [];
  const calls = [];
  const eyes = [-0.032, 0.032].map((offset) => ({ position: new THREE.Vector3(0.9 + offset, 1.7, 0.45) }));
  const locomotion = createLocomotion({
    scene, rig, camera,
    renderer: { xr: { isPresenting: xr, getCamera: () => ({ cameras: eyes }) } },
    bounds: { minX: -10, maxX: 10, minZ: -12, maxZ: 10 },
    getObstacles: () => obstacles,
    onBeforeMove: (kind) => { calls.push(kind); beforeMove?.(kind); },
  });
  const tick = () => locomotion.update(1 / 72, [input, otherInput]);
  return { scene, rig, camera, controller, input, otherInput, gamepad, otherGamepad, obstacles, calls, locomotion, tick, eyes };
}
function check(name, test) {
  try { test(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
}

check('turns around a physically offset head and preserves its height and local tracking pose', () => {
  const { rig, camera, locomotion, calls } = fixture();
  rig.position.set(2.2, 0, -1.5);
  const originalLocal = camera.position.clone();
  const before = vector(locomotion.getState().head);
  assert.equal(locomotion.turn(1), true);
  const after = vector(locomotion.getState().head);
  assert.ok(after.distanceTo(before) < 1e-6, 'turn translated the head');
  assert.ok(camera.position.distanceTo(originalLocal) < 1e-6, 'turn altered physical tracking');
  near(rig.rotation.y, -SNAP_TURN_RADIANS, 'right turn angle');
  assert.deepEqual(calls, ['turn']);
  assert.equal(locomotion.turn(-1), true);
  assert.ok(vector(locomotion.getState().head).distanceTo(before) < 1e-6);
  near(rig.rotation.y, 0, 'left turn restores yaw');
  locomotion.dispose();
});

check('teleport places the tracked head at the destination rather than placing the rig origin there', () => {
  const { rig, camera, locomotion } = fixture();
  rig.rotation.y = 0.85;
  rig.position.set(1, 0, -2);
  const originalLocal = camera.position.clone();
  const target = new THREE.Vector3(-3, 0, -7);
  assert.equal(locomotion.teleportTo(target), true);
  const head = vector(locomotion.getState().head);
  near(head.x, target.x, 'teleport head x');
  near(head.z, target.z, 'teleport head z');
  near(head.y, originalLocal.y, 'teleport head height');
  assert.ok(camera.position.distanceTo(originalLocal) < 1e-6);
  near(rig.rotation.y, 0.85, 'teleport does not rotate the user');
  assert.equal(locomotion.getState().teleportCount, 1);
  locomotion.dispose();
});

check('uses current stereo eye poses instead of stale render-time camera world matrices', () => {
  const { rig, locomotion, eyes } = fixture({ xr: true });
  rig.position.set(2, 0, -1);
  const before = vector(locomotion.getState().head);
  near(before.x, 2.9, 'current XR head x');
  near(before.z, -0.55, 'current XR head z');
  locomotion.turn(1);
  assert.ok(vector(locomotion.getState().head).distanceTo(before) < 1e-6);
  for (const eye of eyes) eye.position.x += 0.2;
  const physicallyMoved = vector(locomotion.getState().head);
  assert.ok(physicallyMoved.distanceTo(before) > 0.19);
  locomotion.turn(-1);
  assert.ok(vector(locomotion.getState().head).distanceTo(physicallyMoved) < 1e-6);
  locomotion.teleportTo(new THREE.Vector3(0, 0, -5));
  const arrived = locomotion.getState().head;
  near(arrived[0], 0, 'XR teleport x');
  near(arrived[2], -5, 'XR teleport z');
  locomotion.dispose();
});

check('rejects warehouse exits, occupied destinations and inadequate standing clearance', () => {
  const { locomotion, obstacles, calls } = fixture();
  obstacles.push(new THREE.Box3(new THREE.Vector3(1, 0, 1), new THREE.Vector3(2, 2, 2)));
  assert.equal(locomotion.isValidPosition(new THREE.Vector3(1.5, 0, 1.5)), false);
  assert.equal(locomotion.isValidPosition(new THREE.Vector3(1 - TELEPORT_CLEARANCE + 0.01, 0, 1.5)), false);
  assert.equal(locomotion.isValidPosition(new THREE.Vector3(1 - TELEPORT_CLEARANCE - 0.01, 0, 1.5)), true);
  assert.equal(locomotion.isValidPosition(new THREE.Vector3(9.9, 0, 0)), false);
  assert.equal(locomotion.isValidPosition(new THREE.Vector3(NaN, 0, 0)), false);
  assert.equal(locomotion.teleportTo(new THREE.Vector3(1.5, 0, 1.5)), false);
  assert.equal(calls.length, 0, 'invalid teleport fired movement side effects');
  obstacles[0].min.y = 2;
  obstacles[0].max.y = 3;
  assert.equal(locomotion.isValidPosition(new THREE.Vector3(1.5, 0, 1.5)), true, 'high beam incorrectly blocks the floor');
  locomotion.dispose();
});

check('hand aim produces a floor arc and release teleports only to its valid destination', () => {
  const { scene, locomotion, input, tick } = fixture();
  input.source.hand = new Map();
  assert.equal(locomotion.beginAim(input), true);
  tick();
  const target = locomotion.getAimTarget();
  assert.ok(target && target.z < -2 && target.y === 0, 'arc did not reach the floor ahead');
  assert.equal(scene.getObjectByName('teleport-arc').visible, true);
  assert.equal(scene.getObjectByName('teleport-destination').visible, true);
  assert.equal(locomotion.endAim(input), true);
  near(locomotion.getState().head[0], target.x, 'hand teleport x');
  near(locomotion.getState().head[2], target.z, 'hand teleport z');
  assert.equal(scene.getObjectByName('teleport-arc').visible, false);
  assert.equal(scene.getObjectByName('teleport-destination').visible, false);
  locomotion.dispose();
});

check('teleport arc cannot pass through crates or warehouse walls', () => {
  const { locomotion, input, controller, obstacles } = fixture();
  obstacles.push(new THREE.Box3(new THREE.Vector3(-3, 0, -1.1), new THREE.Vector3(3, 4, -0.9)));
  locomotion.beginAim(input);
  assert.equal(locomotion.getState().valid, false);
  assert.equal(locomotion.getAimTarget(), null);
  assert.equal(locomotion.endAim(input), false);
  assert.equal(locomotion.getState().teleportCount, 0);
  obstacles.length = 0;
  controller.position.z = -11.5;
  locomotion.beginAim(input);
  assert.equal(locomotion.getState().valid, false);
  assert.equal(locomotion.endAim(input), false);
  locomotion.dispose();
});

check('controller forward-stick aim commits once on neutral and thumbstick click cancels', () => {
  const { locomotion, input, gamepad, tick } = fixture();
  gamepad.axes[3] = -1;
  tick();
  assert.equal(locomotion.isAiming(input), true);
  const target = locomotion.getAimTarget();
  assert.ok(target);
  for (let frame = 0; frame < 12; frame++) tick();
  assert.equal(locomotion.getState().teleportCount, 0);
  gamepad.axes[3] = 0;
  tick();
  tick();
  assert.equal(locomotion.getState().teleportCount, 1);
  near(locomotion.getState().head[2], target.z, 'stick release target');
  gamepad.axes[3] = -1;
  tick();
  gamepad.buttons[3].pressed = true;
  tick();
  assert.equal(locomotion.isAiming(), false);
  gamepad.buttons[3].pressed = false;
  tick();
  assert.equal(locomotion.isAiming(), false, 'held stick restarted cancelled aim');
  gamepad.axes[3] = 0;
  tick();
  assert.equal(locomotion.getState().teleportCount, 1, 'cancelled aim teleported on neutral');
  locomotion.dispose();
});

check('horizontal flick turns once and requires neutral before another turn', () => {
  const { locomotion, gamepad, tick } = fixture();
  gamepad.axes[2] = 1;
  for (let frame = 0; frame < 90; frame++) tick();
  assert.equal(locomotion.getState().turnCount, 1);
  gamepad.axes[2] = -1;
  tick();
  assert.equal(locomotion.getState().turnCount, 1, 'opposite deflection bypassed neutral latch');
  gamepad.axes[2] = 0;
  tick();
  gamepad.axes[2] = -1;
  tick();
  assert.equal(locomotion.getState().turnCount, 2);
  near(locomotion.getState().yaw, 0, 'opposite flick angle');
  locomotion.dispose();
});

check('grabbing reserves that hand thumbstick while the free hand can still move', () => {
  const { locomotion, input, gamepad, otherGamepad, tick } = fixture();
  input.grabbing = true;
  gamepad.axes[2] = 1;
  tick();
  gamepad.axes[2] = 0;
  gamepad.axes[3] = -1;
  tick();
  assert.equal(locomotion.getState().turnCount, 0);
  assert.equal(locomotion.isAiming(), false);
  assert.equal(locomotion.beginAim(input), false);
  input.grabbing = false;
  tick();
  assert.equal(locomotion.isAiming(), false, 'releasing a held object armed a still-deflected stick');
  gamepad.axes[3] = 0;
  tick();
  input.pending = { hit: {} };
  gamepad.axes[3] = -1;
  tick();
  assert.equal(locomotion.isAiming(), false, 'a pending object press armed teleport');
  assert.equal(locomotion.beginAim(input), false, 'a pending object press armed hand teleport');
  input.pending = null;
  otherGamepad.axes[2] = 1;
  tick();
  assert.equal(locomotion.getState().turnCount, 1, 'free hand movement was blocked');
  locomotion.dispose();
});

check('commit clears aim before the application cancels its interactions', () => {
  let locomotion;
  let input;
  const app = fixture({ beforeMove: () => { locomotion.endAim(input, false); } });
  ({ locomotion, input } = app);
  locomotion.beginAim(input);
  assert.equal(locomotion.endAim(input, true), true);
  assert.equal(locomotion.getState().teleportCount, 1);
  assert.equal(locomotion.isAiming(), false);
  assert.deepEqual(app.calls, ['teleport']);
  locomotion.dispose();
});

check('focus reset, input removal and hand ownership cannot commit an accidental teleport', () => {
  const { locomotion, input, otherInput, gamepad, tick } = fixture();
  locomotion.beginAim(input);
  assert.equal(locomotion.beginAim(otherInput), false);
  assert.equal(locomotion.endAim(otherInput), false);
  locomotion.reset();
  assert.equal(locomotion.endAim(input), false);
  gamepad.axes[3] = -1;
  tick();
  assert.equal(locomotion.isAiming(), false);
  gamepad.axes[3] = 0;
  tick();
  gamepad.axes[3] = -1;
  tick();
  assert.equal(locomotion.isAiming(), true);
  locomotion.update(1 / 72, [otherInput]);
  assert.equal(locomotion.isAiming(), false);
  gamepad.axes[3] = 0;
  tick();
  assert.equal(locomotion.getState().teleportCount, 0);
  locomotion.dispose();
});

check('desktop swept movement cannot tunnel through a thin obstacle', () => {
  const { locomotion, obstacles } = fixture();
  obstacles.push(new THREE.Box3(new THREE.Vector3(-3, 0, -1), new THREE.Vector3(3, 2, -0.9)));
  assert.equal(locomotion.moveDesktop(new THREE.Vector3(0, 0, -8)), true);
  const head = locomotion.getState().head;
  assert.ok(head[2] > -0.9 + TELEPORT_CLEARANCE, 'walking tunneled through wall');
  assert.equal(locomotion.moveDesktop(new THREE.Vector3(0, 0, -1)), false);
  locomotion.dispose();
});

check('disposal removes only locomotion visuals and disables further movement', () => {
  const { scene, locomotion, input } = fixture();
  locomotion.beginAim(input);
  locomotion.dispose();
  locomotion.dispose();
  assert.equal(scene.children.length, 1, 'locomotion left scene objects behind');
  assert.equal(locomotion.turn(1), false);
  assert.equal(locomotion.teleportTo(new THREE.Vector3(0, 0, -4)), false);
  assert.equal(locomotion.beginAim(input), false);
});

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
