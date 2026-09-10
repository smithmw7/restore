import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';
import { createStorageCrateSpecs } from '../src/storage-crates.js';
import { WAREHOUSE_BOUNDS } from '../src/warehouse.js';

const scene = new THREE.Scene();
const storageSpecs = createStorageCrateSpecs();
const wall = new THREE.Box3(new THREE.Vector3(-12.3, 0, -27), new THREE.Vector3(-12, 9, 7));
const game = await createWarehouseGameplay({ scene, additionalCrates: storageSpecs, bounds: WAREHOUSE_BOUNDS, obstacles: [wall] });
const checks = [];
const initialChildren = new Set(scene.children);
const initialPhysics = { ...game.getState().physics };
const initialCrates = new Map(game.targets.map((mesh) => [mesh.userData.labObject, mesh]));
const artifactById = new Map(scene.children.filter((mesh) => mesh.userData.kind === 'artifact').map((mesh) => [mesh.userData.labObject, mesh]));
const total = 176;
const advance = (seconds) => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) game.step(1 / 60); };
const check = (name, fn) => { try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } checks.push(name); };
const breakCrate = (mesh) => game.hit(mesh, mesh.position.clone(), new THREE.Vector3(0, 0.15, -1));
const assertReset = () => {
  assert.equal(game.restore(), true);
  const state = game.getState();
  assert.equal(state.closedCrates, total);
  assert.equal(state.openedCrates, 0);
  assert.equal(state.revealedArtifacts, 0);
  assert.equal(state.broken, 0);
  assert.equal(game.targets.length, total);
  assert.equal(game.grabTargets.length, total);
  assert.equal(game.occluders.length, total);
  assert.equal(new Set(game.targets).size, total);
  assert.equal(game.getObstacles().length, total + 1);
  assert.deepEqual(state.physics, initialPhysics, 'reset leaked bodies or colliders');
  assert.deepEqual(new Set(scene.children), initialChildren, 'reset replaced or leaked scene objects');
  assert.ok(state.objects.every((object) => object.state === 'hidden'));
  assert.ok([...artifactById.values()].every((mesh) => !mesh.visible));
};

try {
  check('all 176 crates share one render batch and retain independent hidden render proxies', () => {
    assert.equal(storageSpecs.length, 152);
    assert.equal(game.getState().crateCount, total);
    assert.equal(game.targets.length, total);
    assert.equal(game.grabTargets.length, total);
    assert.equal(artifactById.size, total);
    const batches = scene.children.filter((mesh) => mesh.isInstancedMesh);
    assert.equal(batches.length, 4, 'one closed-crate and three loose-board batches');
    assert.equal(batches[0].count, total);
    assert.deepEqual(batches.slice(1).map((batch) => batch.count), [total, total, total * 4]);
    assert.ok(batches[0].visible && batches[0].material.visible);
    assert.ok([...initialCrates.values()].every((mesh) => mesh.visible && !mesh.material.visible && !mesh.isInstancedMesh), 'a crate proxy would produce a duplicate draw');
    assert.ok([...artifactById.values()].every((mesh) => !mesh.visible));
    assert.equal(game.getObstacles().length, total + 1, 'storage stacks should have individual live obstacles');
    assert.equal(initialPhysics.bodies, total);
  });

  const sideCrate = initialCrates.get('storage-crate-001');
  const originalSideCenter = sideCrate.position.clone();
  const destination = new THREE.Vector3(0, 2, -18);
  check('moving a side crate clears its old obstacle and its instance follows the eased position', () => {
    assert.ok(game.getObstacles().some((box) => box.containsPoint(originalSideCenter)));
    assert.equal(game.beginGrab(sideCrate, sideCrate.position.clone(), 'left'), true);
    assert.equal(game.getObstacles().length, total);
    assert.ok(!game.getObstacles().some((box) => box.containsPoint(originalSideCenter)), 'held crate left a permanent stack obstacle');
    assert.equal(game.moveGrab(destination, 'left'), true);
    advance(2);
    assert.ok(sideCrate.position.distanceTo(destination) < 0.01);
    const matrix = new THREE.Matrix4();
    scene.children.find((mesh) => mesh.isInstancedMesh).getMatrixAt(24, matrix);
    assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(sideCrate.position) < 1e-5, 'batched crate did not follow the physics proxy');
    assert.equal(game.endGrab('left'), true);
    assert.ok(game.getObstacles().some((box) => box.containsPoint(destination)), 'released crate is missing its current obstacle');
    assert.equal(breakCrate(sideCrate), true);
    assert.ok(!game.getObstacles().some((box) => box.containsPoint(destination)), 'opened crate still blocks its cleared space');
    assert.ok(artifactById.get('storage-artifact-001').position.distanceTo(destination) < 1, 'contents jumped back to the original storage stack');
    assertReset();
  });

  check('removing a settled bottom crate causes its supported upper tier to fall', () => {
    const above = initialCrates.get('storage-crate-002');
    advance(3);
    const beforeY = above.position.y;
    assert.equal(breakCrate(sideCrate), true);
    advance(3);
    assert.ok(above.position.y < beforeY - 0.25, `unsupported upper crate stayed suspended: ${beforeY} -> ${above.position.y}`);
    assertReset();
  });

  check('every side, back, upper, and central crate can be ray-selected, grabbed, and opened to unique contents', () => {
    const specs = game.getState().crates;
    // Explicitly cover upper, back, and opposite side bays before sweeping all
    // remaining boxes. Do not step hundreds of loose panels while enumerating.
    const representatives = ['storage-crate-002', 'storage-crate-152', 'storage-crate-080'];
    const order = [...new Set([...representatives, ...specs.map((spec) => spec.id)])];
    const artifacts = new Set();
    const batch = scene.children.find((mesh) => mesh.isInstancedMesh);
    const instanceMatrix = new THREE.Matrix4();
    for (const id of order) {
      const mesh = initialCrates.get(id);
      const spec = specs.find((value) => value.id === id);
      assert.ok(mesh && game.targets.includes(mesh) && game.grabTargets.includes(mesh), `${id} is missing interaction targets`);
      mesh.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(mesh.position.clone().add(new THREE.Vector3(0, spec.dimensions[1] + 1, 0)), new THREE.Vector3(0, -1, 0));
      assert.ok(ray.intersectObject(mesh, false).length, `${id} cannot be ray selected`);
      const artifact = artifactById.get(spec.artifactId);
      assert.ok(artifact && !artifact.visible && !game.targets.includes(artifact), `${id} leaked its packed artifact`);
      assert.equal(game.beginGrab(mesh, mesh.position.clone(), 'right'), true, `${id} cannot be grabbed`);
      assert.equal(game.cancelGrabs(), true);
      assert.equal(breakCrate(mesh), true, `${id} cannot be broken`);
      assert.equal(breakCrate(mesh), false, `${id} can reveal contents twice`);
      assert.ok(artifact.visible && game.targets.includes(artifact) && game.grabTargets.includes(artifact), `${id} did not reveal its artifact`);
      assert.ok(!game.occluders.includes(mesh));
      assert.ok(!artifacts.has(spec.artifactId), `${id} shares an artifact with another crate`);
      artifacts.add(spec.artifactId);
      const panelMeshes = scene.children.filter((child) => child.userData.labObject === id && child.userData.kind === 'crate-piece');
      assert.equal(panelMeshes.length, 6);
      assert.ok(panelMeshes.every((panel) => panel.visible && game.grabTargets.includes(panel)));
      assert.ok(panelMeshes.every((panel) => !panel.material.visible), `${id} has separately rendered board proxies`);
      const crateIndex = specs.findIndex((value) => value.id === id);
      const boardBatches = scene.children.filter((child) => child.isInstancedMesh).slice(1);
      for (const panel of panelMeshes) {
        const panelIndex = panel.userData.panelIndex;
        const boardBatch = boardBatches[Math.min(panelIndex, 2)];
        const boardIndex = panelIndex < 2 ? crateIndex : crateIndex * 4 + panelIndex - 2;
        boardBatch.getMatrixAt(boardIndex, instanceMatrix);
        assert.ok(new THREE.Vector3().setFromMatrixPosition(instanceMatrix).distanceTo(panel.position) < 1e-5, `${id} board ${panelIndex} batch disagrees with physics`);
        assert.ok(boardBatch.visible && instanceMatrix.determinant() > 0, `${id} board ${panelIndex} has no visible instance`);
      }
      batch.getMatrixAt(specs.findIndex((value) => value.id === id), instanceMatrix);
      assert.equal(instanceMatrix.determinant(), 0, `${id} still renders in the closed batch`);
    }
    assert.equal(artifacts.size, total);
    assert.equal(game.getState().openedCrates, total);
    assert.equal(game.getState().revealedArtifacts, total);
    assert.equal(game.targets.length, total, 'only revealed intact artifacts should remain destruction targets');
    assert.equal(game.grabTargets.length, total * 7, 'all six boards and each artifact should remain grabbable');
    assert.equal(game.occluders.length, 0);
    assert.deepEqual(game.getObstacles(), [wall], 'opening every crate must leave only structural obstacles');
    assert.equal(game.getState().physics.bodies, total * 7, 'a crate body survived opening or a content body is missing');
    game.step(1 / 60);
    assert.ok(game.getState().objects.every((object) => object.position.every(Number.isFinite)));
  });

  check('full reset and repeated representative cycles preserve all meshes and the original physics budget', () => {
    assertReset();
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const id of ['storage-crate-001', 'storage-crate-002', 'storage-crate-152', 'crate-24']) {
        assert.equal(breakCrate(initialCrates.get(id)), true);
      }
      advance(0.25);
      assertReset();
    }
    const batch = scene.children.find((mesh) => mesh.isInstancedMesh);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < total; index++) {
      batch.getMatrixAt(index, matrix);
      assert.ok(matrix.determinant() > 0, `reset left crate ${index} hidden`);
    }
  });

  console.log(JSON.stringify({ passed: true, checks, crates: total, storageCrates: storageSpecs.length, sceneObjects: initialChildren.size, physics: initialPhysics }, null, 2));
} finally {
  game.dispose();
  assert.equal(scene.children.length, 0, 'disposing the warehouse leaked scene objects');
  assert.equal(game.targets.length, 0);
  assert.equal(game.grabTargets.length, 0);
}
