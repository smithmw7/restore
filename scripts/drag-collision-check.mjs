import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { driveGrabbedBody, releaseGrabbedBody } from '../src/physical-drag.js';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';

await RAPIER.init();
const dt = 1 / 60;
const vector = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const identity = new THREE.Quaternion();
const checks = [];
const measurements = {};
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);
const check = (name, fn) => {
  try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
};
function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, .1, 100).setTranslation(0, -.1, 0).setFriction(.78));
  return world;
}
function box(world, position, { half = vector(.5, .5, .5), mass = 10, gravity = 1, softCcd = 0 } = {}) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
    .setCcdEnabled(true).setSoftCcdPrediction(softCcd).setGravityScale(gravity).setLinearDamping(.7).setAngularDamping(1.4));
  world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass).setFriction(.78).setRestitution(.06), body);
  return body;
}
function physicalBounds(body, half) {
  const bounds = new THREE.Box3();
  const q = new THREE.Quaternion().copy(body.rotation());
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    bounds.expandByPoint(vector(x * half.x, y * half.y, z * half.z).applyQuaternion(q).add(body.translation()));
  }
  return bounds;
}
function pull(world, body, target, seconds, observe = () => {}) {
  for (let frame = 0; frame < Math.round(seconds / dt); frame++) {
    driveGrabbedBody(world, body, target, identity, dt);
    world.step();
    observe(body);
  }
}

check('a held box slides along the floor when its target is below ground', () => {
  const world = makeWorld();
  try {
    const half = vector(.5, .5, .5);
    const body = box(world, vector(0, .55, 0), { half });
    let minimum = Infinity;
    pull(world, body, vector(4, -2, 0), 4, () => { minimum = Math.min(minimum, physicalBounds(body, half).min.y); });
    assert.ok(minimum > -.006, `floor penetration was ${-minimum} m`);
    close(body.translation().x, 4, .02);
    assert.equal(body.isDynamic(), true);
    measurements.floorPenetration = Math.max(0, -minimum);
    releaseGrabbedBody(body);
  } finally { world.free(); }
});

check('a far target behind a thin wall preserves tangential sliding and release cannot launch the blocked box', () => {
  const world = makeWorld();
  try {
    const half = vector(.5, .5, .5);
    world.createCollider(RAPIER.ColliderDesc.cuboid(.01, 3, 20).setTranslation(2, 3, 0).setFriction(.78));
    const body = box(world, vector(0, 2, 0), { half });
    let furthest = -Infinity;
    pull(world, body, vector(1000, 2, 3), 4, () => { furthest = Math.max(furthest, physicalBounds(body, half).max.x); });
    assert.ok(furthest <= 2, `box penetrated beyond the 2 cm wall centre: ${furthest}`);
    close(body.translation().z, 3, .02);
    assert.ok(vector().copy(body.linvel()).length() < .03, 'blocked goal retained a large physical velocity');
    const before = vector().copy(body.translation());
    const releaseVelocity = body.linvel();
    releaseGrabbedBody(body);
    assert.deepEqual(body.linvel(), releaseVelocity, 'release manufactured a throw from target error');
    for (let frame = 0; frame < 30; frame++) world.step();
    assert.ok(Math.hypot(body.translation().x - before.x, body.translation().z - before.z) < .03);
    assert.ok(body.translation().y < before.y - .8, 'released object did not resume falling');
    measurements.wallPenetration = Math.max(0, furthest - 1.99);
  } finally { world.free(); }
});

check('pushing retains real mass and gives equal-mass props a limited nudge', () => {
  const results = [];
  for (const [heldMass, pushedMass] of [[1, 20], [10, 10], [20, 1]]) {
    const world = makeWorld();
    try {
      const held = box(world, vector(0, .505, 0), { mass: heldMass });
      const pushed = box(world, vector(1.03, .505, 0), { mass: pushedMass });
      for (let frame = 0; frame < 90; frame++) world.step();
      const start = vector().copy(pushed.translation());
      let maximumSpeed = 0;
      pull(world, held, vector(3, .5, 0), 2, () => { maximumSpeed = Math.max(maximumSpeed, vector().copy(pushed.linvel()).length()); });
      close(held.mass(), heldMass); close(pushed.mass(), pushedMass);
      assert.ok(maximumSpeed < 3.5, `contact launched a prop at ${maximumSpeed} m/s`);
      results.push({ heldMass, pushedMass, displacement: vector().copy(pushed.translation()).distanceTo(start), maximumSpeed });
      releaseGrabbedBody(held);
    } finally { world.free(); }
  }
  assert.ok(results[0].displacement < .02, 'light prop bulldozed the heavy box');
  assert.ok(results[1].displacement > .02 && results[1].displacement < .25, 'equal mass contact should produce a small push');
  assert.ok(results[2].displacement > 1 && results[2].displacement > results[0].displacement * 20);
  measurements.massPush = results;
});

check('holding has no gravity drift or far-goal acceleration spike, and restores original gravity and CCD settings', () => {
  const world = makeWorld();
  try {
    const body = box(world, vector(0, 2, 0), { gravity: .37, softCcd: .02 });
    let maximumSpeed = 0;
    pull(world, body, vector(1000, 2, 0), 4, () => { maximumSpeed = Math.max(maximumSpeed, vector().copy(body.linvel()).length()); });
    close(body.translation().y, 2, .001);
    assert.ok(maximumSpeed <= 3.01);
    close(body.gravityScale(), 0);
    assert.ok(body.softCcdPrediction() >= .0799);
    const velocity = body.linvel();
    releaseGrabbedBody(body); releaseGrabbedBody(body);
    close(body.gravityScale(), .37); close(body.softCcdPrediction(), .02);
    assert.deepEqual(body.linvel(), velocity);
    // A later pickup must save fresh settings rather than a stale first grab.
    body.setGravityScale(.6, true); body.setSoftCcdPrediction(.12);
    driveGrabbedBody(world, body, vector().copy(body.translation()), identity, dt);
    releaseGrabbedBody(body);
    close(body.gravityScale(), .6); close(body.softCcdPrediction(), .12);
    const before = body.translation().y;
    for (let frame = 0; frame < 30; frame++) world.step();
    assert.ok(body.translation().y < before - .5);
    measurements.maximumFreeSpeed = maximumSpeed;
  } finally { world.free(); }
});

check('a rapidly moving thin fragment remains on the near side of a thin wall', () => {
  const world = makeWorld();
  try {
    world.createCollider(RAPIER.ColliderDesc.cuboid(.002, 3, 20).setTranslation(2.017, 3, 0));
    const half = vector(.005, .25, .25);
    const body = box(world, vector(0, 2, 0), { half, mass: .05 });
    body.setLinvel({ x: 30, y: 0, z: 0 }, true);
    let furthest = -Infinity;
    pull(world, body, vector(1000, 2, 0), 2, () => { furthest = Math.max(furthest, physicalBounds(body, half).max.x); });
    assert.equal(body.isCcdEnabled(), true);
    assert.ok(furthest < 2.023, `fast fragment crossed the wall: ${furthest}`);
    assert.ok(body.translation().x < 2.017);
    assert.ok(vector().copy(body.linvel()).length() < .05);
    measurements.thinFragmentPenetration = Math.max(0, furthest - 2.015);
    releaseGrabbedBody(body);
  } finally { world.free(); }
});

const scene = new THREE.Scene();
const events = [];
const wall = new THREE.Box3(vector(-1, 0, -8), vector(-.9, 6, 8));
const game = await createWarehouseGameplay({ scene, crateCount: 1, obstacles: [wall], onEvent: (event) => events.push(event) });
const advance = (seconds, inspect = () => {}) => {
  for (let frame = 0; frame < Math.round(seconds * 72); frame++) { game.step(1 / 72); inspect(); }
};
try {
  check('the real warehouse crate collides with walls and cancelling its held state restores falling', () => {
    advance(2);
    const crate = game.targets.find((mesh) => mesh.userData.kind === 'crate');
    assert.equal(game.beginGrab(crate, crate.position.clone(), 'drag-check'), true);
    assert.equal(game.moveGrab(vector(5, 2, -3), 'drag-check'), true);
    let furthest = -Infinity;
    advance(4, () => { furthest = Math.max(furthest, new THREE.Box3().setFromObject(crate).max.x); });
    assert.ok(furthest < -.975, `warehouse crate clipped through its wall: ${furthest}`);
    close(crate.position.z, -3, .08);
    assert.equal(game.getGrabState().active, true);
    const before = crate.position.clone();
    const dropCount = events.filter((event) => event.type === 'drop').length;
    assert.equal(game.cancelGrabs(), true);
    assert.equal(game.getGrabState().active, false);
    assert.equal(events.filter((event) => event.type === 'drop').length, dropCount);
    advance(.5);
    assert.ok(crate.position.y < before.y - .8, 'cancel left its gravity disabled');
    assert.ok(Math.hypot(crate.position.x - before.x, crate.position.z - before.z) < .05);
  });

  check('a loose warehouse board remains above the floor while being dragged', () => {
    game.restore(); advance(1);
    const crate = game.targets.find((mesh) => mesh.userData.kind === 'crate');
    assert.equal(game.hit(crate, crate.position.clone(), vector(0, .1, -1)), true);
    advance(2);
    const board = game.grabTargets.find((mesh) => mesh.userData.kind === 'crate-piece' && mesh.userData.panelIndex === 0);
    assert.equal(game.beginGrab(board, board.position.clone(), 'drag-check'), true);
    assert.equal(game.moveGrab(vector(-4, -3, -4), 'drag-check'), true);
    let minimum = Infinity;
    advance(4, () => { minimum = Math.min(minimum, new THREE.Box3().setFromObject(board).min.y); });
    assert.ok(minimum > -.02, `dragged board penetrated the floor by ${-minimum} m`);
    assert.ok(board.position.z < -3.8, 'board could not slide along the floor');
    assert.equal(game.endGrab('drag-check'), true);
    measurements.boardFloorPenetration = Math.max(0, -minimum);
  });
} finally { game.dispose(); }

console.log(JSON.stringify({ passed: true, checks, measurements }, null, 2));
