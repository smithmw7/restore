import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMetalStorage, createMetalStorageSpecs } from '../src/metal-storage.js';
import { createLocomotion, TELEPORT_CLEARANCE } from '../src/locomotion.js';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';
import { createStorageCrateSpecs } from '../src/storage-crates.js';
import { WAREHOUSE_BOUNDS, getArchiveColumnObstacles } from '../src/warehouse.js';

const checks = [];
const check = (name, fn) => {
  try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
const scene = new THREE.Scene(), metal = new THREE.MeshStandardMaterial({ metalness: .78 });
const storage = createMetalStorage({ scene, materials: { metal }, bounds: WAREHOUSE_BOUNDS });
const stacks = createMetalStorageSpecs(WAREHOUSE_BOUNDS), columns = getArchiveColumnObstacles();
const collection = new THREE.Box3(new THREE.Vector3(-12.3, 0, -26.4), new THREE.Vector3(12.3, 28, 7.3));
let game, locomotion;

try {
  check('sealed archive stays within the hall and leaves the wooden collection and structural columns clear', () => {
    assert.ok(storage.stats.crates >= 1000 && storage.stats.crates <= 2000);
    assert.ok(storage.stats.stacks < 400);
    assert.ok(storage.stats.maxHeight < 12);
    assert.ok(columns.length > 0, 'missing actual structural columns');
    for (const [index, stack] of stacks.entries()) {
      const box = stack.obstacle;
      assert.ok(box.min.x >= WAREHOUSE_BOUNDS.minX && box.max.x <= WAREHOUSE_BOUNDS.maxX);
      assert.ok(box.min.z >= WAREHOUSE_BOUNDS.minZ && box.max.z <= WAREHOUSE_BOUNDS.maxZ);
      assert.ok(!box.intersectsBox(collection), `${stack.id} intrudes into the live collection`);
      assert.ok(columns.every((column) => !box.intersectsBox(column)), `${stack.id} overlaps a structural column`);
      assert.ok(stacks.slice(index + 1).every((other) => !box.intersectsBox(other.obstacle)), `${stack.id} overlaps another stack`);
      for (const item of stack.cases) {
        assert.equal(item.breakable, false);
        assert.equal(item.material, 'metal');
        assert.ok(box.containsBox(new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(item.x, item.y, item.z), new THREE.Vector3(item.width, item.height - 1e-8, item.depth),
        )), `${item.id} is not contained by its stack collider`);
      }
    }
  });

  game = await createWarehouseGameplay({
    scene, additionalCrates: createStorageCrateSpecs(), bounds: WAREHOUSE_BOUNDS,
    obstacles: [...columns, ...storage.obstacles],
  });
  check('all 176 original wooden crates and their separate hidden artifacts remain interactive', () => {
    const state = game.getState();
    assert.equal(state.crateCount, 176);
    assert.equal(state.closedCrates, 176);
    assert.equal(game.targets.length, 176);
    assert.equal(game.grabTargets.length, 176);
    assert.equal(game.occluders.length, 176);
    assert.equal(state.objects.length, 176);
    assert.ok(state.objects.every((artifact) => artifact.state === 'hidden'));
    assert.equal(state.physics.bodies, 176, 'metal scenery added dynamic bodies');
    assert.ok(storage.root.children.every((mesh) => !game.targets.includes(mesh) && !game.grabTargets.includes(mesh)));
  });

  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(), controller = new THREE.Group();
  camera.position.set(0, 1.65, 0);
  controller.position.set(0, 1.2, 0);
  rig.add(camera, controller); scene.add(rig);
  let includeLiveCollection = true;
  locomotion = createLocomotion({
    scene, rig, camera, bounds: WAREHOUSE_BOUNDS,
    renderer: { xr: { isPresenting: false } },
    getObstacles: () => includeLiveCollection ? game.getObstacles() : [...columns, ...storage.obstacles],
  });
  check('metal leaves the center line clear and the expanded central and cross aisles are navigable with live wood present', () => {
    // Preserve the original interactive rear crates at z=-23. They can occupy
    // the collection's center line; no new sealed freight may add to that block.
    includeLiveCollection = false;
    for (let z = 10; z >= -164; z -= 1) {
      assert.equal(locomotion.isValidPosition(new THREE.Vector3(0, 0, z)), true, `central aisle blocked at z=${z}`);
    }
    includeLiveCollection = true;
    for (let z = -30; z >= -164; z -= 1) {
      assert.equal(locomotion.isValidPosition(new THREE.Vector3(0, 0, z)), true, `expanded center aisle blocked at z=${z}`);
    }
    for (const z of [-46, -70, -94, -118, -142]) {
      for (let x = -46; x <= 46; x += .5) {
        assert.equal(locomotion.isValidPosition(new THREE.Vector3(x, 0, z)), true, `cross aisle blocked at (${x}, ${z})`);
      }
      assert.equal(locomotion.teleportTo(new THREE.Vector3(-44, 0, z)), true);
      assert.equal(locomotion.moveDesktop(new THREE.Vector3(88, 0, 0)), true);
      near(locomotion.getState().head[0], 44);
      near(locomotion.getState().head[2], z);
    }
    assert.equal(locomotion.teleportTo(new THREE.Vector3(0, 0, -30)), true);
    assert.equal(locomotion.moveDesktop(new THREE.Vector3(0, 0, -134)), true);
    near(locomotion.getState().head[2], -164);
  });

  check('metal stacks reject occupied teleports, stop swept walking, and block a hand teleport arc', () => {
    const stack = stacks.find((value) => value.z < -34 && value.x < -5 && value.x > -10);
    assert.ok(stack);
    const center = new THREE.Vector3(stack.x, 0, stack.z);
    assert.equal(locomotion.isValidPosition(center), false);
    assert.equal(locomotion.teleportTo(center), false);
    assert.equal(locomotion.teleportTo(new THREE.Vector3(stack.x, 0, stack.obstacle.max.z + 1.1)), true);
    const startingZ = locomotion.getState().head[2];
    assert.equal(locomotion.moveDesktop(new THREE.Vector3(0, 0, -10)), true);
    const stoppedZ = locomotion.getState().head[2];
    assert.ok(stoppedZ < startingZ, 'walk failed to approach the stack');
    assert.ok(stoppedZ >= stack.obstacle.max.z + TELEPORT_CLEARANCE - 1e-5, 'walk passed through a metal case');
    assert.equal(locomotion.isValidPosition(new THREE.Vector3(stack.x, 0, stoppedZ)), true);
    const input = { id: 'left', controller, grabbing: false, source: { hand: new Map() } };
    assert.equal(locomotion.beginAim(input), true);
    assert.equal(locomotion.getAimTarget(), null, 'teleport arc passed through a sealed case');
    assert.equal(locomotion.endAim(input), false);
    assert.equal(locomotion.teleportTo(new THREE.Vector3(0, 0, -180)), false, 'teleport escaped the larger building');
  });

  check('three shared render batches release each instance buffer, geometry, material, and texture exactly once', () => {
    const meshes = [...storage.root.children];
    assert.equal(meshes.length, 3);
    assert.ok(meshes.every((mesh) => mesh.isInstancedMesh && !mesh.castShadow));
    assert.ok(storage.stats.instances <= 15000);
    const geometries = new Set(meshes.map((mesh) => mesh.geometry));
    const materials = new Set(meshes.map((mesh) => mesh.material));
    const textures = new Set(meshes.flatMap((mesh) => [mesh.material.map, mesh.material.normalMap]).filter(Boolean));
    assert.equal(geometries.size, 1);
    assert.equal(materials.size, 3);
    assert.equal(textures.size, 2);
    const resources = [...meshes, ...geometries, ...materials, ...textures], disposalCounts = new Map();
    for (const resource of resources) {
      disposalCounts.set(resource, 0);
      resource.addEventListener('dispose', () => disposalCounts.set(resource, disposalCounts.get(resource) + 1));
    }
    let borrowedDisposals = 0;
    metal.addEventListener('dispose', () => borrowedDisposals++);
    storage.dispose(); storage.dispose();
    assert.equal(storage.root.parent, null);
    assert.equal(storage.root.children.length, 0);
    assert.ok(resources.every((resource) => disposalCounts.get(resource) === 1), 'owned resource disposal was missing or repeated');
    assert.equal(borrowedDisposals, 0, 'disposed the shared library material');
  });
  console.log(JSON.stringify({ passed: true, checks, metalArchive: storage.stats, woodenCrates: 176, structuralColumns: columns.length }, null, 2));
} finally {
  locomotion?.dispose();
  game?.dispose();
  storage.dispose();
  metal.dispose();
}
