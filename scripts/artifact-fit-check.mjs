import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import { ARTIFACT_CATALOG, createArtifactGeometry } from '../src/artifact-forms.js';
import { crateInterior, fitArtifactToCrate } from '../src/artifact-fit.js';
import { createWarehouseGameplay, createCrateSpecs } from '../src/warehouse-gameplay.js';
import { createStorageCrateSpecs } from '../src/storage-crates.js';
import { createDestructionLab } from '../src/destruction.js';

const checks = [];
const specs = [...createCrateSpecs(), ...createStorageCrateSpecs()];
const fracture = DestructibleMesh.prototype.fracture;
let cuts = 0;
DestructibleMesh.prototype.fracture = function (...args) { cuts++; return fracture.apply(this, args); };
const scene = new THREE.Scene();
let game;

function volume(geometry) {
  const p = geometry.attributes.position, index = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let value = 0;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, index ? index.getX(i) : i);
    b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
    value += a.dot(b.cross(c)) / 6;
  }
  return value;
}

function localBounds(mesh, crateMesh) {
  const inverse = crateMesh.quaternion.clone().invert();
  const transform = new THREE.Matrix4().compose(mesh.position.clone().sub(crateMesh.position).applyQuaternion(inverse),
    inverse.multiply(mesh.quaternion), mesh.scale);
  return new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(transform);
}

function assertContained(mesh, crateMesh, spec) {
  const box = localBounds(mesh, crateMesh);
  const inside = crateInterior(spec);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(box.min.getComponent(axis) >= -inside.dimensions[axis] / 2 - 2e-6, `${spec.id} extends through its negative face`);
    assert.ok(box.max.getComponent(axis) <= inside.dimensions[axis] / 2 + 2e-6, `${spec.id} extends through its positive face`);
  }
  assert.ok(box.min.y >= inside.bottom + .0249, `${spec.id} starts within its bottom board`);
}

try {
  for (const entry of ARTIFACT_CATALOG) {
    for (const spec of specs) {
      const fit = fitArtifactToCrate(entry.form, spec), inside = crateInterior(spec);
      const ratios = fit.dimensions.map((size, i) => size / inside.dimensions[i]);
      assert.ok(Math.abs(Math.max(...ratios) - .9) < 1e-10, `${entry.form} leaves too much space in ${spec.id}`);
      const larger = fitArtifactToCrate(entry.form, { width: spec.width * 1.6, height: spec.height * 1.6, depth: spec.depth * 1.6 });
      assert.ok(larger.scale >= fit.scale * 1.59, 'a larger crate must produce a proportionately larger artifact');
    }
  }
  checks.push('all 15 forms fit all 176 crate interiors while preserving proportions and scaling up with larger crates');

  const started = performance.now();
  game = await createWarehouseGameplay({ scene, additionalCrates: createStorageCrateSpecs() });
  const preparationMs = performance.now() - started;
  assert.equal(cuts, 15, 'unique crate sizes must reuse one canonical fracture per form');
  const state = game.getState();
  const forms = new Map(state.objects.map((object) => [object.id, object.form]));
  const crates = new Map(game.targets.map((mesh) => [mesh.userData.labObject, mesh]));
  const artifacts = new Map(scene.children.filter((mesh) => mesh.userData.kind === 'artifact').map((mesh) => [mesh.userData.labObject, mesh]));
  const fragments = new Map(specs.map((spec) => [spec.artifactId, scene.children.filter((mesh) => mesh.userData.kind === 'fragment' && mesh.userData.labObject === spec.artifactId)]));
  assert.equal(artifacts.size, 176);
  let maximumVolumeError = 0;
  const sizes = [];
  for (const spec of specs) {
    const mesh = artifacts.get(spec.artifactId), crate = crates.get(spec.id);
    assert.ok(!mesh.visible && !game.grabTargets.includes(mesh));
    assertContained(mesh, crate, spec);
    assert.ok(mesh.quaternion.angleTo(crate.quaternion) < 1e-7, 'packed contents share the crate orientation');
    const fit = fitArtifactToCrate(forms.get(spec.artifactId), spec);
    const measured = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
    measured.forEach((size, i) => assert.ok(Math.abs(size - fit.dimensions[i]) < 1e-6));
    const originalVolume = volume(mesh.geometry);
    const totalVolume = fragments.get(spec.artifactId).reduce((sum, piece) => sum + volume(piece.geometry), 0);
    maximumVolumeError = Math.max(maximumVolumeError, Math.abs(totalVolume - originalVolume) / originalVolume);
    sizes.push({ id: spec.id, height: measured[1] });
  }
  assert.ok(maximumVolumeError < 2e-5, `scaled shard volume error: ${maximumVolumeError}`);
  checks.push('all actual packed meshes fit their boards, are hidden, share crate yaw, and retain their full volume across scaled shards');
  checks.push('176 independently sized artifacts prepare using only 15 canonical cuts');

  // Place crates at deliberate translated/tilted poses before opening them.
  // This isolates packing transforms from the independent physical grab tests.
  for (const [index, spec] of specs.entries()) {
    const crate = crates.get(spec.id), mesh = artifacts.get(spec.artifactId);
    crate.position.set(0, 2.4 + index * .002, -8);
    crate.quaternion.setFromEuler(new THREE.Euler(.24, .8, -.19));
    assert.equal(game.hit(crate, crate.position.clone(), new THREE.Vector3(0, .2, -1)), true);
    assert.ok(mesh.visible && game.grabTargets.includes(mesh));
    assertContained(mesh, crate, spec);
    assert.ok(mesh.quaternion.angleTo(crate.quaternion) < 1e-7);
    const wholeBox = new THREE.Box3().setFromObject(mesh, true);
    const shardBox = new THREE.Box3();
    for (const shard of fragments.get(spec.artifactId)) {
      shard.updateMatrixWorld(true);
      shardBox.union(new THREE.Box3().setFromObject(shard, true));
    }
    assert.ok(wholeBox.min.distanceTo(shardBox.min) < .0001 && wholeBox.max.distanceTo(shardBox.max) < .0001,
      `${spec.id} fragment homes do not reconstruct the newly revealed artifact`);
  }
  checks.push('every artifact reveals inside a moved and tilted crate with its intact size and matching repair layout');
  game.restore();
  for (const spec of specs) assertContained(artifacts.get(spec.artifactId), crates.get(spec.id), spec);
  assert.equal(game.getState().closedCrates, 176);
  assert.equal(game.getState().physics.bodies, 176);
  assert.equal(cuts, 15, 'reset must not prepare new fracture geometry');
  checks.push('reset restores fitted home poses and the original body budget without cutting new geometry');
  game.dispose(); game = null;

  const cutStart = cuts;
  const massScene = new THREE.Scene();
  const entry = ARTIFACT_CATALOG[0];
  const lab = await createDestructionLab({ scene: massScene, pedestals: false, wholeObjects: true,
    specs: [1, 2].map((scale, index) => ({ ...entry, id: `mass-${index}`, x: index * 3, y: 2, z: 0, scale, color: '#ffffff',
      halfHeight: entry.halfHeight * scale, fractureKey: entry.form, fractureScale: scale })),
    geometryForSpec: (spec) => createArtifactGeometry(spec.form).scale(spec.scale, spec.scale, spec.scale),
    fractureGeometryForSpec: (spec) => createArtifactGeometry(spec.form),
  });
  try {
    for (const mesh of [...lab.targets]) {
      assert.ok(lab.beginGrab(mesh, mesh.position.clone()));
      lab.endGrab('primary', { cancelled: true });
    }
    const masses = [];
    lab.physicsWorld.forEachRigidBody((body) => masses.push(body.mass()));
    masses.sort((a, b) => a - b);
    assert.equal(masses.length, 2);
    assert.ok(Math.abs(masses[1] / masses[0] - 8) < .0001, 'twice the artifact dimensions must produce eight times the physical mass');
    assert.equal(cuts - cutStart, 1);
  } finally { lab.dispose(); }
  checks.push('uniformly scaled cached shards produce their own physics hulls and volume-proportional mass');

  const repairScene = new THREE.Scene();
  const crescent = ARTIFACT_CATALOG.find((item) => item.form === 'crescent-hull');
  const largeFit = fitArtifactToCrate(crescent.form, { width: 1.6, height: 1.35, depth: 2.5 });
  const repair = await createDestructionLab({ scene: repairScene, pedestals: false, wholeObjects: true,
    specs: [{ ...crescent, ...largeFit, id: 'large-crescent', x: 0, y: 1.2, z: 0, color: '#ffffff',
      fractureKey: crescent.form, fractureScale: largeFit.scale }],
    geometryForSpec: (spec) => createArtifactGeometry(spec.form).scale(spec.scale, spec.scale, spec.scale),
    fractureGeometryForSpec: (spec) => createArtifactGeometry(spec.form),
  });
  try {
    const original = repair.targets[0];
    const shards = repairScene.children.filter((mesh) => mesh.userData.kind === 'fragment');
    const homes = new Map(shards.map((piece) => [piece, piece.position.clone()]));
    const rotations = new Map(shards.map((piece) => [piece, piece.quaternion.clone()]));
    assert.ok(repair.hit(original, original.position.clone(), new THREE.Vector3(0, 0, -1)));
    for (let i = 0; i < 360; i++) repair.step(1 / 60);
    const first = shards.at(-1);
    assert.ok(repair.beginGrab(first, first.position.clone()));
    for (let frame = 0; frame < 60 * 45 && !repair.getGrabState().complete; frame++) {
      const grab = repair.getGrabState(), anchor = new THREE.Vector3().fromArray(grab.anchor);
      const rotation = first.quaternion.clone().multiply(rotations.get(first).clone().invert());
      const candidates = shards.map((piece) => ({ piece, offset: homes.get(piece).clone().sub(homes.get(first)).applyQuaternion(rotation) }))
        .filter(({ piece, offset }) => piece.position.distanceTo(anchor.clone().add(offset)) > .025)
        .sort((a, b) => a.piece.position.distanceTo(anchor) - b.piece.position.distanceTo(anchor));
      if (candidates.length) {
        const goal = candidates[0].piece.position.clone().sub(candidates[0].offset);
        goal.y = .07;
        repair.moveGrab(goal);
      }
      repair.step(1 / 60);
    }
    assert.ok(repair.getGrabState().complete, `near-floor crescent stalled at ${repair.getGrabState().assembled}/12`);
    assert.ok(new THREE.Box3().setFromObject(original, true).min.y >= -.001, 'repair put visible geometry through the floor');
    repair.endGrab('primary', { cancelled: true });
  } finally { repair.dispose(); }
  checks.push('a large crescent completes magnetic repair with the hand at floor level without placing its visible underside below concrete');
  console.log(JSON.stringify({ passed: true, checks, crates: specs.length, canonicalCuts: 15,
    preparationMs: Math.round(preparationMs), maximumVolumeError,
    artifactHeightRange: [Math.min(...sizes.map((item) => item.height)), Math.max(...sizes.map((item) => item.height))] }, null, 2));
} finally {
  game?.dispose();
  DestructibleMesh.prototype.fracture = fracture;
}
