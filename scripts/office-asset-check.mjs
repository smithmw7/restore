import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadOfficeAssets, OFFICE_ASSET_NAMES, OFFICE_ASSET_URL } from '../src/office-assets.js';

const file = 'public/models/office/office-kit.glb', bytes = await readFile(file);
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'glTF binary header');
assert.equal(bytes.readUInt32LE(4), 2, 'glTF version 2');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'complete binary payload');
assert.ok(bytes.length <= 12 * 1024 * 1024, 'office kit stays below 12 MiB');
let document, binary;
for (let at = 12; at < bytes.length;) {
  const length = bytes.readUInt32LE(at), type = bytes.readUInt32LE(at + 4);
  assert.ok(at + 8 + length <= bytes.length, 'chunk inside file');
  const data = bytes.subarray(at + 8, at + 8 + length);
  if (type === 0x4e4f534a) document = JSON.parse(data.toString('utf8'));
  if (type === 0x004e4942) binary = data;
  at += 8 + length;
}
assert.ok(document && binary, 'JSON and binary chunks exported');
assert.equal(document.asset.version, '2.0');
assert.ok(document.buffers.every(buffer => !buffer.uri), 'geometry has no external downloads');
const named = name => document.nodes.findIndex(node => node.name === name);
const kitIndex = named('OfficeKit');
assert.ok(kitIndex >= 0, 'OfficeKit hierarchy root');
assert.equal(document.nodes[kitIndex].extras.kitId, 'restore-retro-office');
assert.ok(document.nodes[kitIndex].extras.assetVersion, 'versioned asset');
const parents = new Map();
document.nodes.forEach((node, index) => (node.children || []).forEach(child => parents.set(child, index)));
const localMatrix = node => node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
  new THREE.Vector3(...node.translation || [0, 0, 0]), new THREE.Quaternion(...node.rotation || [0, 0, 0, 1]), new THREE.Vector3(...node.scale || [1, 1, 1]),
);
function matrix(index) {
  const local = localMatrix(document.nodes[index]);
  return parents.has(index) ? matrix(parents.get(index)).multiply(local) : local;
}
function ancestor(index, ancestorIndex) {
  while (index !== ancestorIndex && parents.has(index)) index = parents.get(index);
  return index === ancestorIndex;
}
const component = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function values(index) {
  const accessor = document.accessors[index], view = document.bufferViews[accessor.bufferView];
  assert.ok(view && !accessor.sparse, 'direct geometry buffer accessors');
  const [read, size] = component[accessor.componentType], width = widths[accessor.type];
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength), stride = view.byteStride || width * size;
  return Array.from({ length: accessor.count }, (_, row) => Array.from({ length: width }, (_, col) => {
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + row * stride + col * size;
    assert.ok(offset + size <= (view.byteOffset || 0) + view.byteLength, 'accessor inside declared view');
    return data[read](offset, true);
  }));
}

const expected = {
  Desk: { min: [-1.36, -.03, -.53], max: [1.36, 1.02, .53], size: [2.5, .92, .9] },
  Drawer: { min: [-.6, -.15, -.55], max: [.6, .15, .14], size: [1.03, .2, .45] },
  Notebook: { min: [-.24, -.02, -.18], max: [.24, .1, .23], size: [.4, .04, .29] },
  LockerShell: { min: [-.7, -.03, -.38], max: [.7, 2.25, .38], size: [1.25, 2.15, .6] },
  LockerDoor: { min: [-.04, -.01, -.06], max: [1.35, 2.21, .15], size: [1.24, 2.08, .03] },
  Chair: { min: [-.32, -.64, -.34], max: [.32, .64, .34], size: [.48, .95, .43] },
  Pen: { min: [-.1, -.025, -.025], max: [.1, .025, .025], size: [.155, .008, .008] },
  Pencil: { min: [-.105, -.015, -.015], max: [.105, .015, .015], size: [.17, .007, .007] },
  Logbook: { min: [-.18, -.05, -.14], max: [.18, .05, .14], size: [.28, .045, .2] },
};
let triangles = 0, primitives = 0, texturedPrimitives = 0;
const parts = {};
for (const name of OFFICE_ASSET_NAMES) {
  assert.equal(document.nodes.filter(node => node.name === name).length, 1, `one ${name} template`);
  const index = named(name), node = document.nodes[index];
  assert.equal(parents.get(index), kitIndex, `${name} is a top-level reusable template`);
  const local = localMatrix(node).elements, identity = new THREE.Matrix4().elements;
  assert.ok(local.every((value, i) => Math.abs(value - identity[i]) < 1e-5), `${name} root preserves authored origin`);
  const inverse = matrix(index).invert(), bounds = new THREE.Box3();
  let partTriangles = 0, partPrimitives = 0;
  for (const [meshIndex, meshNode] of document.nodes.entries()) {
    if (meshNode.mesh === undefined || !ancestor(meshIndex, index)) continue;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, matrix(meshIndex));
    for (const primitive of document.meshes[meshNode.mesh].primitives) {
      assert.ok(primitive.mode === undefined || primitive.mode === 4, 'triangle geometry');
      const positions = values(primitive.attributes.POSITION), normals = values(primitive.attributes.NORMAL);
      assert.equal(normals.length, positions.length, 'normal for every vertex');
      positions.forEach(position => {
        assert.ok(position.every(Number.isFinite), 'finite geometry');
        bounds.expandByPoint(new THREE.Vector3(...position).applyMatrix4(transform));
      });
      normals.forEach(normal => assert.ok(Math.abs(Math.hypot(...normal) - 1) < .035, 'unit normals'));
      const material = document.materials[primitive.material];
      assert.ok(material, 'assigned surface material');
      if (material.pbrMetallicRoughness?.baseColorTexture) {
        assert.notEqual(primitive.attributes.TEXCOORD_0, undefined, 'textured surfaces have UVs');
        const uv = values(primitive.attributes.TEXCOORD_0);
        assert.equal(uv.length, positions.length, 'UV for every textured vertex');
        assert.ok(uv.every(pair => pair.every(value => Number.isFinite(value) && value >= -.001 && value <= 1.001)), 'UVs inside atlas');
        texturedPrimitives++;
      }
      const indices = primitive.indices === undefined ? null : values(primitive.indices).flat();
      if (indices) assert.ok(indices.every(value => Number.isInteger(value) && value >= 0 && value < positions.length), 'valid triangle indices');
      const count = indices?.length ?? positions.length;
      assert.equal(count % 3, 0, 'complete triangles');
      partTriangles += count / 3; partPrimitives++;
    }
  }
  const { min, max, size } = expected[name], actualSize = bounds.getSize(new THREE.Vector3()).toArray();
  assert.ok(partTriangles > 0, `${name} has visible geometry`);
  bounds.min.toArray().forEach((value, axis) => assert.ok(value >= min[axis] - .001, `${name} minimum axis ${axis}: ${value}`));
  bounds.max.toArray().forEach((value, axis) => assert.ok(value <= max[axis] + .001, `${name} maximum axis ${axis}: ${value}`));
  actualSize.forEach((value, axis) => assert.ok(value >= size[axis], `${name} useful size axis ${axis}: ${value}`));
  parts[name] = { triangles: partTriangles, primitives: partPrimitives, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
  triangles += partTriangles; primitives += partPrimitives;
}
const notebookIndex = named('Notebook'), coverIndex = named('NotebookCover');
assert.ok(coverIndex >= 0 && ancestor(coverIndex, notebookIndex), 'notebook has an independent cover');
const hinge = new THREE.Vector3().setFromMatrixPosition(matrix(notebookIndex).invert().multiply(matrix(coverIndex)));
assert.ok(hinge.distanceTo(new THREE.Vector3(-.215, .055, 0)) < .002, 'cover opens around the bound spine');
assert.ok(triangles <= 70000, `kit triangle budget: ${triangles}`);
assert.ok(primitives <= 100, `kit draw primitive budget: ${primitives}`);
assert.ok(document.materials.length <= 12, 'shared material budget');
assert.ok(texturedPrimitives >= OFFICE_ASSET_NAMES.length, 'all object types use authored UV textures');
const images = (document.images || []).map(image => {
  assert.ok(image.bufferView !== undefined && !image.uri, 'all PBR maps are embedded');
  const view = document.bufferViews[image.bufferView], data = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  assert.ok(data.length > 1000, 'nonempty image');
  return { name: image.name, mimeType: image.mimeType, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
assert.equal(images.length, 3, 'color, normal and ORM share a three-map atlas');
const refinedAtlas = await readFile('art/office/textures/office-basecolor-final.png');
const refinedAtlasHash = createHash('sha256').update(refinedAtlas).digest('hex');
assert.ok(images.some(image => image.sha256 === refinedAtlasHash), 'final refined texture is embedded in the shipped kit');

// Verify real loader ownership semantics without needing a DOM image decoder.
const scene = new THREE.Group(), kit = new THREE.Group();
kit.name = 'OfficeKit'; kit.userData = { kitId: 'restore-retro-office', assetVersion: 'fixture' }; scene.add(kit);
const geometry = new THREE.BoxGeometry(.1, .1, .1), texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
for (const name of OFFICE_ASSET_NAMES) {
  const group = new THREE.Group(); group.name = name; group.add(new THREE.Mesh(geometry, material)); kit.add(group);
  if (name === 'Notebook') { const cover = new THREE.Group(); cover.name = 'NotebookCover'; cover.position.set(-.215, .055, 0); group.add(cover); }
}
let geometriesDisposed = 0, materialsDisposed = 0, texturesDisposed = 0;
geometry.addEventListener('dispose', () => geometriesDisposed++);
material.addEventListener('dispose', () => materialsDisposed++);
texture.addEventListener('dispose', () => texturesDisposed++);
const assets = await loadOfficeAssets({ loader: { loadAsync: async url => { assert.equal(url, OFFICE_ASSET_URL); return { scene }; } } });
const first = assets.create('Notebook'), second = assets.create('Notebook');
assert.notEqual(first, second, 'each instance owns its pose');
assert.equal(first.children[0].geometry, second.children[0].geometry, 'instances share geometry');
assert.equal(first.children[0].material, second.children[0].material, 'instances share materials');
first.getObjectByName('NotebookCover').rotation.z = -1;
assert.ok(Math.abs(second.getObjectByName('NotebookCover').rotation.z) < 1e-10, 'articulation does not mutate another instance');
assert.ok(Math.abs(kit.getObjectByName('NotebookCover').rotation.z) < 1e-10, 'articulation leaves template immutable');
const owner = new THREE.Group(); owner.add(first, second);
assets.dispose(); assets.dispose();
assert.equal(owner.children.length, 0, 'disposal detaches live instances');
assert.deepEqual([geometriesDisposed, materialsDisposed, texturesDisposed], [1, 1, 1], 'each shared GPU resource disposed exactly once');
assert.throws(() => assets.create('Chair'), /disposed/);

const report = {
  file, version: document.nodes[kitIndex].extras.assetVersion, bytes: bytes.length, triangles, primitives,
  materials: document.materials.length, images, parts, notebookHinge: hinge.toArray(),
  loader: { sharedResources: true, independentArticulation: true, singleDisposal: true },
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
await mkdir('output/office', { recursive: true });
await writeFile('output/office/asset-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
