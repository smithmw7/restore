import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BREAK_REACH, tapInfluence, dispatchTap, nudgeBody } from '../src/tap-influence.js';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';
import { createDestructionLab, OBJECT_SPECS } from '../src/destruction.js';

const checks = [];
const measurements = {};
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const check = (name, fn) => {
  try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
};
const advance = (game, seconds) => { for (let frame = 0; frame < Math.round(seconds * 72); frame++) game.step(1 / 72); };
const surfaceHit = (mesh) => {
  mesh.geometry.computeBoundingBox();
  const localPoint = v(0, 0, mesh.geometry.boundingBox.max.z);
  return { object: mesh, point: mesh.localToWorld(localPoint.clone()), localPoint, distance: 999 };
};
const tapFromRange = (game, mesh, distance, direction = v(0, 0, -1)) => {
  const hit = surfaceHit(mesh);
  return dispatchTap(game, hit, hit.point.clone().add(v(0, 0, distance)), direction);
};

check('eight feet is inclusive and farther tap influence follows inverse square distance', () => {
  close(BREAK_REACH, 2.4384);
  assert.deepEqual(tapInfluence(BREAK_REACH), { canBreak: true, strength: 1 });
  assert.equal(tapInfluence(BREAK_REACH + 1e-8).canBreak, false);
  assert.deepEqual(tapInfluence(0), { canBreak: true, strength: 1 });
  close(tapInfluence(BREAK_REACH * 2).strength, .25);
  close(tapInfluence(BREAK_REACH * 4).strength, .0625);
  for (const invalid of [-1, NaN, Infinity, -Infinity]) assert.deepEqual(tapInfluence(invalid), { canBreak: false, strength: 0 });
});

check('dispatch uses the current head and transformed surface instead of stale ray distance', () => {
  const parent = new THREE.Group();
  const mesh = new THREE.Object3D(); parent.add(mesh);
  const calls = [];
  const game = { hit: (...args) => { calls.push(['break', ...args]); return true; }, nudge: (...args) => { calls.push(['nudge', ...args]); return true; } };
  const hit = { object: mesh, point: v(0, 0, -1), localPoint: v(0, 0, -1), distance: .1 };
  const head = v();
  parent.position.z = -4;
  assert.equal(dispatchTap(game, hit, head, v(0, 0, -1)).kind, 'nudge');
  close(calls.at(-1)[2].z, -5);
  close(calls.at(-1)[4], (BREAK_REACH / 5) ** 2);
  head.z = -4;
  assert.equal(dispatchTap(game, hit, head, v(0, 0, -1)).kind, 'break');
  parent.rotation.y = Math.PI;
  head.z = 0;
  const moved = dispatchTap(game, hit, head, v(0, 0, -1));
  close(moved.distance, 3);
  assert.equal(moved.kind, 'nudge');
  assert.deepEqual(hit.point.toArray(), [0, 0, -1]);
  const count = calls.length;
  assert.equal(dispatchTap(game, hit, v(NaN), v(0, 0, -1)), null);
  assert.equal(dispatchTap(game, { ...hit, point: null }, head, v(0, 0, -1)), null);
  assert.equal(dispatchTap(game, null, head, v(0, 0, -1)), null);
  assert.equal(calls.length, count);
});

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
try {
  check('native impulses scale by mass, wake sleeping bodies, and cap added speed and spin', () => {
    const bodies = [1, 8].map((density, index) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(index * 3, 0, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(.5, .5, .5).setDensity(density), body);
      return body;
    });
    world.step();
    const direction = v(0, 0, -4);
    const masses = bodies.map((body) => body.mass());
    for (const body of bodies) {
      body.sleep();
      assert.equal(nudgeBody(body, v().copy(body.translation()), direction, .25), true);
      assert.equal(body.isSleeping(), false);
      close(v().copy(body.linvel()).length(), .85 * .25);
      assert.ok(body.linvel().y > 0, 'grounded props need a small upward rock');
    }
    close(masses[1] / masses[0], 8);
    assert.deepEqual(bodies.map((body) => body.mass()), masses);
    assert.deepEqual(direction.toArray(), [0, 0, -4]);
    const body = bodies[0];
    for (let index = 0; index < 30; index++) nudgeBody(body, v(0, .45, 0), direction, 1);
    close(v().copy(body.linvel()).dot(v(0, .25, -1).normalize()), 2.5);
    const spin = v().copy(body.angvel()).length();
    assert.ok(spin > .1 && spin <= 3.000001, `off-centre tap spin ${spin}`);
    body.setLinvel({ x: 4, y: 0, z: -5 }, true);
    assert.equal(nudgeBody(body, v(), direction, 1), false);
    assert.deepEqual([body.linvel().x, body.linvel().z], [4, -5], 'tap clamped an existing throw');
    const before = body.linvel();
    for (const args of [[v(), v(), 1], [v(NaN), direction, 1], [v(), direction, NaN], [v(), direction, 0]]) assert.equal(nudgeBody(body, ...args), false);
    assert.deepEqual(body.linvel(), before);
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const held = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    for (const invalid of [fixed, held, null]) assert.equal(nudgeBody(invalid, v(), direction, 1), false);
    measurements.massRatio = masses[1] / masses[0];
    measurements.deltaSpeedAtSixteenFeet = .85 * .25;
    measurements.maximumAddedAxisSpeed = 2.5;
    measurements.offCenterSpin = spin;
  });
} finally { world.free(); }

const scene = new THREE.Scene();
const events = [];
const game = await createWarehouseGameplay({ scene, crateCount: 2, onEvent: (event) => events.push(event) });
const objectState = (id) => game.getState().objects.find((object) => object.id === id);
const interactionEvents = () => events.filter((event) => ['break', 'pickup', 'drop'].includes(event.type));
try {
  const crate = game.targets.find((mesh) => mesh.userData.labObject === 'crate-01');
  const artifactId = game.getState().crates.find((item) => item.id === 'crate-01').artifactId;
  const artifact = scene.children.find((mesh) => mesh.userData.labObject === artifactId && mesh.userData.fragmentIndex === undefined);

  check('repeated far taps move a closed crate without exposing contents or playing break/grab/drop events', () => {
    advance(game, 3);
    const before = crate.position.clone();
    const startEvents = interactionEvents().length;
    for (let index = 0; index < 12; index++) {
      const result = tapFromRange(game, crate, BREAK_REACH * 1.05);
      assert.ok(!result || result.kind === 'nudge');
      advance(game, .04);
    }
    advance(game, .5);
    measurements.crateDisplacement = crate.position.distanceTo(before);
    assert.ok(measurements.crateDisplacement > .03, `crate did not move: ${measurements.crateDisplacement}`);
    assert.equal(game.getState().closedCrates, 2);
    assert.equal(game.getState().openedCrates, 0);
    assert.equal(game.getState().revealedArtifacts, 0);
    assert.equal(objectState(artifactId).state, 'hidden');
    assert.equal(artifact.visible, false);
    assert.equal(new Set(game.getState().crates.map((item) => item.artifactId)).size, 2);
    assert.equal(interactionEvents().length, startEvents);
    assert.ok(events.some((event) => event.type === 'nudge'));
    assert.equal(game.nudge(artifact, artifact.position.clone(), v(0, 0, -1), 1), false);
    advance(game, 5);
    const atRest = crate.position.clone(); advance(game, 1);
    assert.ok(crate.position.distanceTo(atRest) < .002, 'nudged crate failed to return to rest');
  });

  check('far objects remain grabbable and held or invalid objects reject tap nudges', () => {
    const hit = surfaceHit(crate);
    assert.equal(dispatchTap(game, hit, hit.point.clone().add(v(0, 0, 12)), v(0, 0, -1)).kind, 'nudge');
    assert.equal(game.beginGrab(crate, hit.point, 'tap-test'), true, 'long-range grab was restricted by break reach');
    const eventCount = events.length;
    assert.equal(game.nudge(crate, hit.point, v(0, 0, -1), 1), false);
    assert.equal(game.nudge(game.targets.find((mesh) => mesh !== crate), v(), v(0, 0, -1), 1), false);
    assert.equal(events.length, eventCount);
    assert.equal(game.moveGrab(v(-2, 1.5, -2), 'tap-test'), true);
    advance(game, 1);
    assert.equal(game.endGrab('tap-test'), true);
    assert.equal(game.nudge(new THREE.Mesh(), v(), v(0, 0, -1), 1), false);
    assert.equal(game.nudge(crate, v(NaN), v(0, 0, -1), 1), false);
    assert.equal(game.nudge(crate, v(), v(), 1), false);
  });

  check('revealed whole artifacts accept far nudges and fracture only after a near tap', () => {
    advance(game, 2);
    assert.equal(tapFromRange(game, crate, 1).kind, 'break');
    assert.equal(game.getState().revealedArtifacts, 1);
    assert.equal(objectState(artifactId).fractured, false);
    // Put the exposed prop over an empty aisle using the same grab API as input.
    assert.equal(game.beginGrab(artifact, artifact.position.clone(), 'tap-test'), true);
    assert.equal(game.nudge(artifact, artifact.position.clone(), v(0, 0, -1), 1), false);
    game.moveGrab(v(0, 1.4, -4), 'tap-test'); advance(game, 2);
    game.endGrab('tap-test'); advance(game, 4);
    const before = artifact.position.clone();
    const startEvents = interactionEvents().length;
    for (let index = 0; index < 5; index++) {
      assert.equal(tapFromRange(game, artifact, BREAK_REACH * 1.05, v(1, 0, 0)).kind, 'nudge');
      advance(game, .08);
    }
    advance(game, .3);
    measurements.artifactDisplacement = artifact.position.distanceTo(before);
    assert.ok(measurements.artifactDisplacement > .02, `artifact did not move: ${measurements.artifactDisplacement}`);
    assert.equal(objectState(artifactId).fractured, false);
    assert.equal(artifact.visible, true);
    assert.equal(interactionEvents().length, startEvents);
    assert.equal(tapFromRange(game, artifact, 1).kind, 'break');
    assert.equal(objectState(artifactId).fractured, true);
    assert.equal(artifact.visible, false);
    assert.ok(game.grabTargets.some((mesh) => mesh.userData.labObject === artifactId && Number.isInteger(mesh.userData.fragmentIndex)));
    assert.equal(game.nudge(artifact, before, v(0, 0, -1), 1), false);
  });
} finally { game.dispose(); }

const restoreScene = new THREE.Scene();
const restoreEvents = [];
const lab = await createDestructionLab({ scene: restoreScene, wholeObjects: true, pedestals: false,
  specs: [{ ...OBJECT_SPECS.find((spec) => spec.id === 'cube'), x: 0, z: 0, pedestalHeight: 0 }], onEvent: (event) => restoreEvents.push(event) });
try {
  check('restored whole artifacts gain a dynamic body on far tap without becoming fractured', () => {
    const mesh = lab.targets[0];
    const initialBodies = lab.getState().physics.bodies;
    assert.equal(lab.nudge(mesh, v(NaN), v(0, 0, -1), 1), false);
    assert.equal(lab.getState().physics.bodies, initialBodies, 'invalid tap activated a fixed object');
    assert.equal(tapFromRange(lab, mesh, 1).kind, 'break');
    assert.equal(lab.restore(), true); advance(lab, 1);
    assert.equal(lab.getState().objects[0].state, 'intact');
    assert.equal(lab.getState().physics.bodies, initialBodies);
    const count = restoreEvents.length;
    const before = mesh.position.clone();
    assert.equal(tapFromRange(lab, mesh, BREAK_REACH * 1.05, v(1, 0, 0)).kind, 'nudge');
    assert.equal(lab.getState().physics.bodies, initialBodies + 1);
    assert.deepEqual(restoreEvents.slice(count).map((event) => event.type), ['nudge']);
    advance(lab, .4);
    measurements.restoredArtifactDisplacement = mesh.position.distanceTo(before);
    assert.ok(measurements.restoredArtifactDisplacement > .01);
    assert.equal(lab.getState().objects[0].fractured, false);
    assert.equal(mesh.visible, true);
  });
} finally { lab.dispose(); }

console.log(JSON.stringify({ passed: true, checks, measurements }, null, 2));
