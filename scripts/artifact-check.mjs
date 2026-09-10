import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import { ARTIFACT_CATALOG, createArtifactGeometry } from '../src/artifact-forms.js';

function inspectGeometry(geometry, topology = false) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const edges = new Map();
  const vertexKey = (vertex) => vertex.toArray().map((value) => Math.round(value * 1e6)).join(',');
  let volume = 0; let degenerate = 0;
  for (const name of ['position', 'normal', 'uv']) {
    assert(geometry.getAttribute(name), `missing ${name}`);
    assert(Array.from(geometry.getAttribute(name).array).every(Number.isFinite), `nonfinite ${name}`);
  }
  const count = index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i);
    b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
    if (!topology) continue;
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-16) degenerate++;
    const keys = [vertexKey(a), vertexKey(b), vertexKey(c)];
    for (let j = 0; j < 3; j++) {
      const first = keys[j]; const second = keys[(j + 1) % 3];
      const key = [first, second].sort().join('|');
      const edge = edges.get(key) || { count: 0, winding: 0 };
      edge.count++; edge.winding += first < second ? 1 : -1; edges.set(key, edge);
    }
  }
  if (topology) {
    assert.equal(degenerate, 0, 'degenerate intact faces');
    assert.equal([...edges.values()].filter((edge) => edge.count !== 2 || edge.winding !== 0).length, 0,
      'intact surface must be closed with consistent face orientation');
  }
  assert(volume > 1e-10, 'geometry has positive enclosed volume');
  return { volume, triangles: count / 3 };
}

async function checkCase(form, scale, seedOverride = null) {
  await RAPIER.init();
  const entry = ARTIFACT_CATALOG.find((item) => item.form === form);
  const geometry = createArtifactGeometry(form).scale(scale, scale, scale);
  const original = inspectGeometry(geometry, true);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  assert(Math.abs(size.y - entry.halfHeight * 2 * scale) < 2e-6, 'catalog halfHeight matches actual bounds');
  assert(size.x < 0.61 * scale && size.z < 0.61 * scale, 'artifact fits the crate width and depth');
  const material = new THREE.MeshStandardMaterial();
  const mesh = new DestructibleMesh(geometry, material, material);
  mesh.updateMatrixWorld(true);
  let warnings = 0;
  const oldWarn = console.warn;
  console.warn = () => warnings++;
  let pieces;
  try {
    pieces = mesh.fracture(new FractureOptions({ fractureMethod: 'voronoi', fragmentCount: entry.fragmentCount,
      seed: seedOverride ?? entry.seed, voronoiOptions: { mode: '3D', useApproximation: false } }));
  } finally { console.warn = oldWarn; }
  assert(pieces.length >= 2, 'artifact fractures into multiple pieces');
  assert.equal(warnings, 0, 'fracture must complete without triangulation warnings');
  let totalVolume = 0;
  for (const piece of pieces) {
    totalVolume += inspectGeometry(piece.geometry).volume;
    assert(RAPIER.ColliderDesc.convexHull(piece.geometry.attributes.position.array), 'fragment produces a valid physics hull');
  }
  const volumeError = Math.abs(totalVolume - original.volume) / original.volume;
  assert(volumeError < 0.00001, `fracture volume changed ${(volumeError * 100).toFixed(5)}%`);
  pieces.forEach((piece) => piece.geometry.dispose()); geometry.dispose(); material.dispose();
  return { form, scale, pieces: pieces.length, triangles: original.triangles, volumeError, size: size.toArray() };
}

if (process.argv[2] === '--case') {
  console.log(JSON.stringify(await checkCase(process.argv[3], Number(process.argv[4]), process.argv[5] ? Number(process.argv[5]) : null)));
} else {
  // Isolating cuts makes a regression in the geometry library fail within a
  // bounded time instead of leaving the test runner stuck inside a slicer.
  const run = promisify(execFile);
  const cases = ARTIFACT_CATALOG.flatMap((entry) => [1, 1.15, 1.55].map((scale) => ({ form: entry.form, scale })));
  const results = []; const failures = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const test = cases[next++];
      try {
        const { stdout } = await run(process.execPath, ['--max-old-space-size=512', fileURLToPath(import.meta.url),
          '--case', test.form, String(test.scale)], { timeout: 6000, maxBuffer: 512 * 1024 });
        results.push(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) { failures.push(`${test.form} at ${test.scale}: ${error.stderr || error.message}`); }
    }
  };
  await Promise.all([worker(), worker()]);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(JSON.stringify({ passed: results.length, forms: ARTIFACT_CATALOG.length, scales: [1, 1.15, 1.55],
    maximumVolumeErrorPct: Math.max(...results.map((result) => result.volumeError)) * 100,
    checks: ['closed oriented manifold surfaces', 'finite positions, normals and UVs', 'catalog dimensions',
      'fracture volume conservation', 'warning-free slicing', 'valid fragment physics hulls'] }, null, 2));
}
