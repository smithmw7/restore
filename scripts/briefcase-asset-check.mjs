import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

const file = 'public/models/briefcase/briefcase.glb';
const bytes = await readFile(file);
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'glTF binary header');
assert.equal(bytes.readUInt32LE(4), 2, 'glTF version 2');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'complete binary payload');
let document, binary;
for (let at = 12; at < bytes.length;) {
  const length = bytes.readUInt32LE(at), type = bytes.readUInt32LE(at + 4);
  const chunk = bytes.subarray(at + 8, at + 8 + length);
  if (type === 0x4e4f534a) document = JSON.parse(chunk.toString('utf8'));
  if (type === 0x004e4942) binary = chunk;
  at += 8 + length;
}
assert.ok(document && binary, 'JSON and geometry chunks present');
assert.equal(document.asset.version, '2.0');
assert.ok(bytes.length < 12 * 1024 * 1024, 'single prop download remains under 12 MiB');
assert.ok(!document.buffers.some(buffer => buffer.uri), 'geometry is self-contained');
const named = name => document.nodes.find(node => node.name === name);
for (const name of ['Briefcase', 'BodyStatic', 'LidPivot', 'LidStatic', ...Array.from({length:4}, (_,i)=>`Wheel_${i}`)]) assert.ok(named(name), `articulated node ${name} exported`);
assert.ok(!document.nodes.some(node => /Handle|NumberDisplay/i.test(node.name || '')), 'handle and stationary digit displays removed');
const metadata = named('Briefcase').extras;
assert.equal(metadata.numeralGeometry, true, 'numbers are authored geometry');
assert.equal(metadata.numeralsPerWheel, 10);
assert.equal(metadata.wheelNumerals, '0123456789');
assert.equal(metadata.handleRemoved, true);
assert.equal(metadata.separatorCountPerWheel, 10);
assert.ok(Math.abs(metadata.wheelStep - Math.PI * 2 / 10) < 1e-8);
assert.equal(metadata.wheelZeroAngle, 0);
const parents = new Map();
document.nodes.forEach((node, index) => (node.children || []).forEach(child => parents.set(child, index)));
function matrix(index) {
  const node = document.nodes[index], local = new THREE.Matrix4();
  if (node.matrix) local.fromArray(node.matrix);
  else local.compose(new THREE.Vector3(...node.translation || [0,0,0]), new THREE.Quaternion(...node.rotation || [0,0,0,1]), new THREE.Vector3(...node.scale || [1,1,1]));
  return parents.has(index) ? matrix(parents.get(index)).multiply(local) : local;
}
const rootIndex = document.nodes.findIndex(node => node.name === 'Briefcase');
const inverseRoot = matrix(rootIndex).invert();
const rootRelative = name => matrix(document.nodes.findIndex(node => node.name === name)).premultiply(inverseRoot);
const pivot = new THREE.Vector3().setFromMatrixPosition(rootRelative('LidPivot'));
assert.ok(pivot.distanceTo(new THREE.Vector3(0,.12,-.315)) < .001, `lid hinge position: ${pivot.toArray()}`);
const elementSizes = { SCALAR: 1, VEC2:2, VEC3:3, VEC4:4, MAT4:16 };
const component = {5120:['getInt8',1],5121:['getUint8',1],5122:['getInt16',2],5123:['getUint16',2],5125:['getUint32',4],5126:['getFloat32',4]};
function values(accessorIndex) {
  const accessor = document.accessors[accessorIndex], view = document.bufferViews[accessor.bufferView];
  assert.ok(view && !accessor.sparse, 'export uses direct buffer accessors');
  const [read,size] = component[accessor.componentType], width = elementSizes[accessor.type];
  const data = new DataView(binary.buffer,binary.byteOffset,binary.byteLength), stride=view.byteStride || width*size;
  return Array.from({length:accessor.count},(_,index)=>Array.from({length:width},(_,c)=>data[read]((view.byteOffset||0)+(accessor.byteOffset||0)+index*stride+c*size,true)));
}
const numeralWheels = [];
for (let wheel = 0; wheel < 4; wheel++) {
  const wheelIndex = document.nodes.findIndex(node => node.name === `Wheel_${wheel}`);
  const numeralIndex = document.nodes.findIndex(node => node.name === `WheelNumerals_${wheel}`);
  assert.ok(numeralIndex >= 0, `wheel ${wheel} exports numeral geometry`);
  let ancestor = numeralIndex;
  while (parents.has(ancestor) && ancestor !== wheelIndex) ancestor = parents.get(ancestor);
  assert.equal(ancestor, wheelIndex, `numerals rotate with wheel ${wheel}`);
  const numeralNode = document.nodes[numeralIndex];
  assert.notEqual(numeralNode.mesh, undefined, `wheel ${wheel} numbers are a mesh`);
  const transform = matrix(wheelIndex).invert().multiply(matrix(numeralIndex));
  const sectors = Array(10).fill(0);
  for (const primitive of document.meshes[numeralNode.mesh].primitives) {
    const material = document.materials[primitive.material];
    const pbr = material.pbrMetallicRoughness;
    assert.ok(pbr.baseColorFactor.slice(0, 3).every(value => value < .025), 'physical numeral inlay is black');
    assert.ok(!pbr.baseColorTexture && !pbr.metallicRoughnessTexture && !material.normalTexture && !material.emissiveTexture, 'numerals need no bitmap or displacement texture');
    for (const point of values(primitive.attributes.POSITION)) {
      const local = new THREE.Vector3(...point).applyMatrix4(transform);
      assert.ok(Math.hypot(local.y, local.z) > .035, 'numerals sit on the outer drum surface');
      const angle = (Math.atan2(-local.y, local.z) + Math.PI * 2) % (Math.PI * 2);
      const sector = Math.round(angle / metadata.wheelStep) % 10;
      sectors[sector]++;
    }
  }
  assert.ok(sectors.every(count => count > 12), `wheel ${wheel} contains substantial physical glyph geometry in all ten detents: ${sectors}`);
  numeralWheels.push({ wheel, verticesPerDetent: sectors });
}
let triangles=0, vertices=0, primitives=0, texturedPrimitives=0;
const bounds=new THREE.Box3();
for (const [nodeIndex,node] of document.nodes.entries()) {
  if (node.mesh === undefined) continue;
  const transform=matrix(nodeIndex).premultiply(inverseRoot);
  for (const primitive of document.meshes[node.mesh].primitives) {
    assert.ok(primitive.mode === undefined || primitive.mode === 4, 'triangular export');
    const positions=values(primitive.attributes.POSITION), normals=values(primitive.attributes.NORMAL);
    assert.equal(normals.length,positions.length);
    positions.forEach(p=>{assert.ok(p.every(Number.isFinite),'finite positions');bounds.expandByPoint(new THREE.Vector3(...p).applyMatrix4(transform));});
    normals.forEach(n=>{const length=Math.hypot(...n);assert.ok(Number.isFinite(length)&&Math.abs(length-1)<.035,'unit surface normals');});
    const material=document.materials[primitive.material];
    if(material?.pbrMetallicRoughness?.baseColorTexture){
      assert.notEqual(primitive.attributes.TEXCOORD_0,undefined,'textured surface has UVs');
      const uv=values(primitive.attributes.TEXCOORD_0);
      assert.ok(uv.every(pair=>pair.every(v=>Number.isFinite(v)&&v>=-.001&&v<=1.001)),'atlas UV bounds');
      texturedPrimitives++;
    }
    const count=primitive.indices===undefined?positions.length:document.accessors[primitive.indices].count;
    assert.equal(count%3,0,'complete triangles');
    triangles+=count/3;vertices+=positions.length;primitives++;
  }
}
assert.ok(triangles>=2000 && triangles<=60000, `prop geometry budget: ${triangles} triangles`);
assert.ok(texturedPrimitives>0,'Blender UV textures shipped with model');
assert.ok(primitives<=40,`bounded draw primitives: ${primitives}`);
assert.ok(document.materials.length<=12, 'bounded material count');
const size=bounds.getSize(new THREE.Vector3());
assert.ok(size.x>.94&&size.x<1.15&&size.z>.62&&size.z<.9&&size.y>.22&&size.y<.5,`closed-case dimensions: ${size.toArray()}`);
const images=document.images.map(image=>{
 assert.ok(image.bufferView!==undefined&&!image.uri,'all PBR textures embedded');
 const view=document.bufferViews[image.bufferView], data=binary.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
 assert.ok(data.length>1000,'nonempty embedded texture');
 return {name:image.name,mimeType:image.mimeType,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
});
assert.equal(images.length,3,'only the three shared PBR maps are embedded, with no numeral bitmap');
const finalAlbedo = await readFile('art/briefcase/textures/briefcase-basecolor-final.png');
assert.ok(images.some(image=>image.sha256===createHash('sha256').update(finalAlbedo).digest('hex')),'enhanced atlas is actually embedded in the final model');
const report={file,bytes:bytes.length,version:metadata.assetVersion,triangles,vertices,primitives,materials:document.materials.length,images,numeralWheels,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},lidPivot:pivot.toArray(),sha256:createHash('sha256').update(bytes).digest('hex')};
await mkdir('output/briefcase',{recursive:true});
await writeFile('output/briefcase/asset-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
