import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';
import { createStorageCrateSpecs } from '../src/storage-crates.js';
import { WAREHOUSE_BOUNDS } from '../src/warehouse.js';

const checks = [];
const dt = 1 / 72;
const check = (name, fn) => {
  try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
};
const scene = new THREE.Scene();
let game = await createWarehouseGameplay({ scene, bounds: WAREHOUSE_BOUNDS, additionalCrates: createStorageCrateSpecs() });
const advance = (seconds) => { for (let index = 0; index < Math.round(seconds / dt); index++) game.step(dt); };
try {
  check('large live crate stacks still fall after a stationary held release', () => {
    advance(3);
    assert.equal(game.getState().crateCount, 176);
    const mesh = game.targets.find((item) => item.userData.labObject === 'storage-crate-001');
    assert.equal(game.beginGrab(mesh, mesh.position.clone(), 'settling-check'), true);
    game.moveGrab(new THREE.Vector3(0, 3.5, -8), 'settling-check'); advance(3);
    const before = mesh.position.y;
    assert.equal(game.endGrab('settling-check'), true); advance(.4);
    assert.ok(mesh.position.y < before - .35, 'a stationary release was frozen above its support');
    game.restore();
  });

  check('a settled upper crate wakes and falls when its support is removed', () => {
    advance(3);
    const lower = game.targets.find((item) => item.userData.labObject === 'storage-crate-001');
    const upper = game.targets.find((item) => item.userData.labObject === 'storage-crate-002');
    const before = upper.position.y;
    assert.equal(game.hit(lower, lower.position.clone(), new THREE.Vector3(0, .15, -1)), true);
    advance(2);
    assert.ok(upper.position.y < before - .25, 'the settled upper tier remained suspended without support');
    game.restore();
  });

  check('a settled crate responds when another held crate bumps into it', () => {
    advance(3);
    const resting = game.targets.find((item) => item.userData.labObject === 'crate-01');
    const bumper = game.targets.find((item) => item.userData.labObject === 'crate-02');
    const before = resting.position.clone();
    assert.equal(game.beginGrab(bumper, bumper.position.clone(), 'settling-check'), true);
    game.moveGrab(new THREE.Vector3(before.x + 1.8, bumper.position.y, before.z), 'settling-check'); advance(2);
    game.moveGrab(new THREE.Vector3(before.x + .55, bumper.position.y, before.z), 'settling-check'); advance(1);
    assert.ok(resting.position.distanceTo(before) > .12, 'the settled crate did not wake and respond to contact');
    game.endGrab('settling-check');
  });

  // Match the original dense-pile probe in a fresh world. Earlier release and
  // reset checks must not alter this seeded stack arrangement or contact order.
  game.dispose();
  assert.equal(scene.children.length, 0);
  game = await createWarehouseGameplay({ scene, bounds: WAREHOUSE_BOUNDS, additionalCrates: createStorageCrateSpecs() });

  check('a dense pile of dropped crates, broken boards, and artifact shards becomes quiet', () => {
    advance(3);
    const ids = ['storage-crate-001', 'storage-crate-005', 'storage-crate-008', 'storage-crate-010', 'storage-crate-014', 'storage-crate-018', 'storage-crate-022', 'storage-crate-025'];
    for (const id of ids) {
      const mesh = game.targets.find((item) => item.userData.labObject === id);
      assert.equal(game.beginGrab(mesh, mesh.position.clone(), 'settling-check'), true);
      game.moveGrab(new THREE.Vector3(0, 2.8, -8), 'settling-check'); advance(2);
      game.endGrab('settling-check'); advance(.4);
    }
    for (const id of ids.slice(-3)) {
      const mesh = game.targets.find((item) => item.userData.labObject === id);
      assert.equal(game.hit(mesh, mesh.position.clone(), new THREE.Vector3(0, .15, -1)), true);
      const artifactId = game.getState().crates.find((item) => item.id === id).artifactId;
      const artifact = game.targets.find((item) => item.userData.labObject === artifactId);
      assert.equal(game.hit(artifact, artifact.position.clone(), new THREE.Vector3(0, .2, -1)), true);
    }
    advance(5);
    const tracked = scene.children.filter((mesh) => mesh.visible && mesh.userData.labObject).map((mesh) => ({
      mesh, position: mesh.position.clone(), quaternion: mesh.quaternion.clone().normalize(), maxMotion: 0, maxRotation: 0,
    }));
    for (let frame = 0; frame < 3 / dt; frame++) {
      game.step(dt);
      for (const item of tracked) {
        item.maxMotion = Math.max(item.maxMotion, item.mesh.position.distanceTo(item.position));
        item.maxRotation = Math.max(item.maxRotation, item.mesh.quaternion.clone().normalize().angleTo(item.quaternion));
      }
    }
    const moving = tracked.filter((item) => item.maxMotion > .002 || item.maxRotation > .025);
    assert.equal(moving.length, 0, `pile is still chattering: ${JSON.stringify(moving.slice(0, 8).map((item) => ({ id: item.mesh.userData.labObject, motion: item.maxMotion, rotation: item.maxRotation })))}`);
  });
} finally { game.dispose(); }

const cadenceScene = new THREE.Scene();
const cadence = await createWarehouseGameplay({ scene: cadenceScene, bounds: WAREHOUSE_BOUNDS, crateCount: 1 });
try {
  check('held crate motion is consistent across display rates and interpolates between physics ticks', () => {
    const positions = [];
    for (const fps of [72, 90, 120]) {
      cadence.restore();
      for (let frame = 0; frame < 72; frame++) cadence.step(1 / 72);
      const mesh = cadence.targets.find((item) => item.userData.kind === 'crate');
      assert.equal(cadence.beginGrab(mesh, mesh.position.clone(), 'cadence-check'), true);
      const goal = new THREE.Vector3(0, 2.4, -3);
      cadence.moveGrab(goal, 'cadence-check');
      let previous = mesh.position.clone(), movingFrames = 0;
      for (let frame = 0; frame < fps / 2; frame++) {
        cadence.step(1 / fps);
        if (mesh.position.distanceTo(previous) > 1e-5) movingFrames++;
        previous.copy(mesh.position);
      }
      positions.push(mesh.position.clone());
      if (fps === 120) assert.ok(movingFrames >= 55, `${movingFrames}/60 render frames moved; presentation still repeats fixed-step poses`);
      assert.equal(cadence.endGrab('cadence-check'), true);
    }
    assert.ok(positions.every((position) => position.distanceTo(positions[0]) < .003), `held motion changed with display rate: ${positions.map((position) => position.toArray())}`);
  });
} finally { cadence.dispose(); }

console.log(JSON.stringify({ passed: true, checks, woodenCrates: 176, densePileCrates: 8, observationWindowSeconds: [5, 8], displayRates: [72, 90, 120] }, null, 2));
