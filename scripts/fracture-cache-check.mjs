import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import { createDestructionLab } from '../src/destruction.js';

// Exercise real fracture geometry across finishes. The explicit key describes
// geometry, so material changes must not rerun Voronoi or copy a prior finish.
const fracture = DestructibleMesh.prototype.fracture;
const disposeGeometry = THREE.BufferGeometry.prototype.dispose;
let fractureCalls = 0;
const geometryDisposals = new Map();
DestructibleMesh.prototype.fracture = function (...args) {
  fractureCalls++;
  return fracture.apply(this, args);
};
THREE.BufferGeometry.prototype.dispose = function () {
  geometryDisposals.set(this, (geometryDisposals.get(this) || 0) + 1);
  return disposeGeometry.call(this);
};

const palettes = ['#49dccc', '#f16fa8', '#c7a4ff'].map((color, index) => ({
  outside: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.1 + index * 0.2, metalness: 0.8 }),
  inside: new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.45), roughness: 0.8 }),
}));
const scene = new THREE.Scene();
const checks = [];
let lab;
try {
  const specs = Array.from({ length: 6 }, (_, index) => ({
    id: `artifact-${index}`, form: 'cube', label: `Artifact ${index}`, fractureKey: 'cache-box-1.15',
    scale: 1.15, color: `#${palettes[index % 3].outside.color.getHexString()}`,
    x: index * 0.7 - 2, y: 1, z: -1, fragmentCount: 8, seed: 42,
  }));
  const progress = [];
  const sourceDisposals = new Map();
  for (const pair of palettes) {
    for (const material of Object.values(pair)) material.addEventListener('dispose', () => sourceDisposals.set(material, 1));
  }
  const geometryForSpec = (spec) => new THREE.BoxGeometry(0.4, 0.4, 0.4).scale(spec.scale, spec.scale, spec.scale);
  lab = await createDestructionLab({ scene, specs, pedestals: false, wholeObjects: true,
    geometryForSpec,
    materialForSpec: (spec) => palettes[Number(spec.id.split('-')[1]) % 3],
    onProgress: (current) => progress.push(current),
  });
  assert.equal(fractureCalls, 1, 'six identical geometries across three finishes fracture once');
  assert.deepEqual(progress, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(geometryDisposals.size, 8, 'temporary fragment templates are released immediately after setup');
  checks.push('one fracture across different colors, materials, and emissive palettes with per-object progress');

  const originals = specs.map((spec) => scene.children.find((mesh) => mesh.userData.labObject === spec.id && mesh.userData.kind !== 'fragment'));
  const fragments = specs.map((spec) => scene.children.filter((mesh) => mesh.userData.labObject === spec.id && mesh.userData.kind === 'fragment'));
  assert.equal(fragments.flat().length, 48);
  assert.equal(new Set(scene.children.map((mesh) => mesh.geometry)).size, 54);
  const originalLocal = fragments[0].map((mesh) => originals[0].worldToLocal(mesh.position.clone()));
  for (let objectIndex = 0; objectIndex < specs.length; objectIndex++) {
    const source = palettes[objectIndex % 3];
    const outside = originals[objectIndex].material;
    const inside = fragments[objectIndex][0].material[1];
    assert.notEqual(outside, source.outside);
    assert.notEqual(inside, source.inside);
    assert.ok(outside.color.equals(source.outside.color));
    assert.ok(outside.emissive.equals(source.outside.emissive));
    assert.equal(outside.emissiveIntensity, source.outside.emissiveIntensity);
    assert.ok(inside.color.equals(source.inside.color));
    for (let fragmentIndex = 0; fragmentIndex < 8; fragmentIndex++) {
      const piece = fragments[objectIndex][fragmentIndex];
      assert.equal(piece.material[0], outside, 'outer surfaces keep this object material');
      assert.equal(piece.material[1], inside, 'fractured surfaces keep this object material');
      const local = originals[objectIndex].worldToLocal(piece.position.clone());
      assert.ok(local.distanceTo(originalLocal[fragmentIndex]) < 1e-8, 'cached centers include baked scale and world rotation');
      assert.deepEqual(Array.from(piece.geometry.attributes.position.array), Array.from(fragments[0][fragmentIndex].geometry.attributes.position.array));
    }
  }
  assert.equal(new Set(originals.map((mesh) => mesh.material)).size, 6);
  assert.equal(new Set(fragments.map((pieces) => pieces[0].material[1])).size, 6);
  checks.push('scaled fragment geometry and home transforms match while each instance owns its meshes and finish');

  assert.ok(lab.hit(originals[0], originals[0].position.clone(), new THREE.Vector3(0, 0, -1)));
  assert.equal(lab.getState().broken, 1);
  assert.equal(lab.getState().objects[1].state, 'intact');
  const secondVertices = fragments[1][0].geometry.attributes.position.array.slice();
  fragments[0][0].geometry.attributes.position.array[0] += 0.1;
  assert.deepEqual(fragments[1][0].geometry.attributes.position.array, secondVertices);
  checks.push('fracture state and writable vertex buffers remain isolated between cached instances');

  const ownedMaterials = new Set(originals.map((mesh) => mesh.material).concat(fragments.map((pieces) => pieces[0].material[1])));
  const materialDisposals = new Map();
  for (const material of ownedMaterials) material.addEventListener('dispose', () => materialDisposals.set(material, (materialDisposals.get(material) || 0) + 1));
  lab.dispose();
  lab.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(geometryDisposals.size, 62, '54 object geometries and 8 templates are all disposed');
  assert.ok([...geometryDisposals.values()].every((count) => count === 1));
  assert.equal(materialDisposals.size, 12);
  assert.ok([...materialDisposals.values()].every((count) => count === 1));
  assert.equal(sourceDisposals.size, 0, 'caller-owned source materials survive lab disposal');
  lab = null;
  checks.push('all templates, cloned geometry, and owned materials dispose exactly once without disposing sources');

  const startCalls = fractureCalls;
  const guardedSpecs = specs.slice(0, 5).map((spec, index) => ({ ...spec,
    form: index === 1 ? 'custom-box' : 'cube', scale: index === 2 ? 1.55 : 1.15,
    seed: index === 3 ? 43 : 42, fragmentCount: index === 4 ? 9 : 8,
  }));
  lab = await createDestructionLab({ scene, specs: guardedSpecs, geometryForSpec, pedestals: false });
  assert.equal(fractureCalls - startCalls, 5, 'form, baked scale, seed and fragment count each invalidate a template');
  lab.dispose();
  lab = null;
  const uncachedCalls = fractureCalls;
  lab = await createDestructionLab({ scene, specs: specs.slice(0, 2).map(({ fractureKey, ...spec }) => spec), geometryForSpec, pedestals: false });
  assert.equal(fractureCalls - uncachedCalls, 2, 'caching remains opt-in');
  checks.push('form, scale, seed, and fragment count remain guarded and missing keys preserve uncached behavior');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  lab?.dispose();
  DestructibleMesh.prototype.fracture = fracture;
  THREE.BufferGeometry.prototype.dispose = disposeGeometry;
  for (const pair of palettes) { pair.outside.dispose(); pair.inside.dispose(); }
}
