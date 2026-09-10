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
    const mesh = game.targets.find((item) => item.userData.labObject === 'storage-crate-003');
    assert.equal(game.beginGrab(mesh, mesh.position.clone(), 'settling-check'), true);
    // Take the exposed top tier; a solid grab cannot lift through its stack.
    game.moveGrab(new THREE.Vector3(0, mesh.position.y, mesh.position.z), 'settling-check'); advance(4);
    game.moveGrab(new THREE.Vector3(0, 3.5, mesh.position.z), 'settling-check'); advance(2);
    game.moveGrab(new THREE.Vector3(0, 3.5, -8), 'settling-check'); advance(6);
    const before = mesh.position.y;
    assert.equal(game.endGrab('settling-check'), true); advance(.4);
    assert.ok(mesh.position.y < before - .35, 'a stationary release was frozen above its support');
    game.restore();
  });

  check('a settled upper crate wakes and falls when its remaining support board is pulled clear', () => {
    advance(3);
    const lower = game.targets.find((item) => item.userData.labObject === 'storage-crate-001');
    const upper = game.targets.find((item) => item.userData.labObject === 'storage-crate-002');
    const before = upper.position.y;
    assert.equal(game.hit(lower, lower.position.clone(), new THREE.Vector3(0, .15, -1)), true);
    advance(3);
    const support = scene.children.find(mesh => mesh.userData.labObject === 'storage-crate-001' && mesh.userData.panelIndex === 0);
    const supportStart = support.position.clone();
    assert.equal(game.beginGrab(support, supportStart, 'settling-check'), true);
    game.moveGrab(supportStart.clone().add(new THREE.Vector3(0, 0, 2.5)), 'settling-check'); advance(5);
    assert.ok(support.position.z > supportStart.z + 1.5, 'the load-bearing board was not pulled clear');
    game.endGrab('settling-check'); advance(1);
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

  // Earlier release/reset checks must not alter the dense pile's seeded world.
  game.dispose();
  assert.equal(scene.children.length, 0);
  game = await createWarehouseGameplay({ scene, bounds: WAREHOUSE_BOUNDS, additionalCrates: createStorageCrateSpecs() });

  check('a dense pile of dropped crates, broken boards, and artifact shards becomes quiet', () => {
    advance(3);
    // These are the exposed top tiers of the eight inner left bays. A dynamic
    // grab must lift above surrounding stacks before entering the clear aisle.
    const ids = ['storage-crate-003', 'storage-crate-007', 'storage-crate-009', 'storage-crate-012', 'storage-crate-014', 'storage-crate-017', 'storage-crate-019', 'storage-crate-023'];
    for (const [index, id] of ids.entries()) {
      const mesh = game.targets.find((item) => item.userData.labObject === id);
      assert.equal(game.beginGrab(mesh, mesh.position.clone(), 'settling-check'), true);
      const pickupOffset = new THREE.Vector3().fromArray(game.getGrabState().goal).sub(mesh.position);
      const carryTo = point => {
        const allowance = mesh.position.distanceTo(point) / 2 + 3;
        game.moveGrab(point.clone().sub(pickupOffset), 'settling-check');
        let elapsed = 0;
        while (mesh.position.distanceTo(point) > .025 && elapsed < allowance) { advance(.1); elapsed += .1; }
        assert.ok(mesh.position.distanceTo(point) < .025, `${id} was blocked before reaching its carry waypoint: ${mesh.position.toArray()} -> ${point.toArray()}`);
      };
      const sourceZ = mesh.position.z;
      carryTo(new THREE.Vector3(mesh.position.x, 5.6, sourceZ));
      carryTo(new THREE.Vector3(0, 5.6, sourceZ));
      // Three overlapping drop columns keep the eight-crate pile below the
      // reachable ceiling, rather than forcing a new box inside an occupied slot.
      carryTo(new THREE.Vector3(index % 2 ? .14 : -.12, 5.6, [-9.7, -7.2, -8.4][index % 3]));
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
