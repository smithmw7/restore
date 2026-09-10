import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDestructionLab } from '../src/destruction.js';

const checks = [];
const metrics = {};
const point = (x, y, z) => new THREE.Vector3(x, y, z);
const vec = (value) => new THREE.Vector3().fromArray(value);
const shapeBounds = (mesh) => { mesh.updateMatrixWorld(true); return new THREE.Box3().setFromObject(mesh, true); };
const spec = (id, x = 0) => ({ id, form: 'cube', x, y: .9, z: 0, halfHeight: .215, pedestalHeight: 0, color: '#bcb49d', seed: 402, fragmentCount: 16 });
async function fixture(specs = [spec('own')], wallX = 2.4) {
  const scene = new THREE.Scene(), events = [];
  const wall = new THREE.Box3(point(wallX - .035, 0, -5), point(wallX + .035, 5, 5));
  const lab = await createDestructionLab({ scene, specs, wholeObjects: true, pedestals: false, statics: [wall],
    bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, onEvent: (event) => events.push(event) });
  const pieces = (id = 'own') => scene.children.filter((mesh) => mesh.userData.labObject === id && mesh.userData.fragmentIndex !== undefined);
  const original = (id = 'own') => scene.children.find((mesh) => mesh.userData.labObject === id && mesh.userData.fragmentIndex === undefined);
  const homes = new Map(pieces().map((mesh) => [mesh, mesh.position.clone()]));
  const rotations = new Map(pieces().map((mesh) => [mesh, mesh.quaternion.clone()]));
  let inputOffset = point(0, 0, 0);
  const begin = (mesh) => {
    const hit = mesh.position.clone().add(point(.012, .009, -.007));
    assert.equal(lab.beginGrab(mesh, hit), true);
    inputOffset = vec(lab.getGrabState().goal).sub(hit);
  };
  const moveAnchor = (anchor) => lab.moveGrab(anchor.clone().sub(inputOffset));
  const advance = (seconds, frame) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) { lab.step(1 / 60); frame?.(i); } };
  const bodies = () => { const result = []; lab.physicsWorld.forEachRigidBody((body) => result.push(body)); return result; };
  return { scene, lab, wall, events, pieces, original, homes, rotations, begin, moveAnchor, advance, bodies };
}

{
  const f = await fixture();
  const { lab, wall, original, begin, advance, bodies } = f;
  const mesh = original();
  begin(mesh);
  lab.moveGrab(point(4, 1.1, 0));
  let greatestX = -Infinity, peakSpeed = 0, blockedSpeed = 0;
  advance(8, (frame) => {
    greatestX = Math.max(greatestX, shapeBounds(mesh).max.x);
    peakSpeed = Math.max(peakSpeed, lab.getGrabState().speed);
    if (frame > 360) blockedSpeed = Math.max(blockedSpeed, lab.getGrabState().speed);
  });
  assert.ok(greatestX <= wall.min.x + .015, `held artifact crossed wall by ${greatestX - wall.min.x}m`);
  assert.ok(peakSpeed < 3.5, `artifact pull speed escaped its bound: ${peakSpeed}`);
  assert.ok(blockedSpeed < .3, `blocked artifact reports excessive motion: ${blockedSpeed}`);
  lab.moveGrab(point(4, 1.1, -1.4));
  advance(2);
  assert.ok(mesh.position.z < -1.2, 'blocked artifact did not slide along the wall');
  assert.ok(shapeBounds(mesh).max.x <= wall.min.x + .015);
  lab.moveGrab(point(1.2, -5, -1.4));
  let minimumY = Infinity;
  advance(3, () => { minimumY = Math.min(minimumY, shapeBounds(mesh).min.y); });
  assert.ok(minimumY >= -.015, `held artifact penetrated floor by ${-minimumY}m`);
  lab.moveGrab(point(1.2, 1.4, -1.4));
  advance(2);
  const releasedY = mesh.position.y;
  lab.endGrab();
  assert.ok(bodies().every((body) => body.gravityScale() === 1), 'release did not restore gravity');
  advance(1.5);
  assert.ok(mesh.position.y < releasedY - .7 && shapeBounds(mesh).min.y >= -.015);
  metrics.whole = { wallErrorMeters: Math.max(0, greatestX - wall.min.x), floorErrorMeters: Math.max(0, -minimumY), peakSpeed, blockedSpeed };
  lab.dispose();
  checks.push('whole artifacts stop at wall and floor, slide tangentially, bound blocked motion, and fall after release');
}

{
  const f = await fixture();
  const { lab, original, pieces, homes, rotations, begin, moveAnchor, advance, bodies, wall } = f;
  lab.hit(original(), original().position.clone(), point(0, 0, -1));
  advance(11);
  const picked = [...pieces()].sort((a, b) => a.position.x - b.position.x)[0];
  begin(picked);
  // Gather a partial compound using the same authored offsets as the repair UI.
  for (let attempt = 0; lab.getGrabState().assembled < 2 && attempt < 30; attempt++) {
    const held = lab.getGrabState();
    const rotation = held.heldMesh.quaternion.clone().multiply(rotations.get(held.heldMesh).clone().invert());
    const anchor = vec(held.anchor);
    const candidate = pieces().filter((mesh) => mesh.visible && mesh !== held.heldMesh)
      .map((mesh) => ({ mesh, offset: homes.get(mesh).clone().sub(homes.get(held.heldMesh)).applyQuaternion(rotation) }))
      .filter(({ mesh, offset }) => mesh.position.distanceTo(anchor.clone().add(offset)) > .045)
      .sort((a, b) => a.mesh.position.distanceTo(anchor) - b.mesh.position.distanceTo(anchor))[0];
    assert.ok(candidate, 'missing candidate for partial assembly');
    const initial = held.assembled;
    for (let frame = 0; frame < 180 && lab.getGrabState().assembled === initial; frame++) {
      moveAnchor(candidate.mesh.position.clone().sub(candidate.offset));
      lab.step(1 / 60);
    }
  }
  let held = lab.getGrabState();
  assert.ok(held.assembled > 1 && !held.complete, 'fixture must produce a partial compound');
  const anchorHome = homes.get(held.heldMesh);
  const orientation = held.heldMesh.quaternion.clone().multiply(rotations.get(held.heldMesh).clone().invert());
  const joined = pieces().filter((mesh) => mesh.visible && mesh !== held.heldMesh
    && mesh.position.distanceTo(homes.get(mesh).clone().sub(anchorHome).applyQuaternion(orientation).add(vec(held.anchor))) < .002);
  assert.ok(joined.length, 'no non-anchor joined shard available for regrab');
  const body = bodies().find((value) => value.numColliders() === held.assembled);
  assert.ok(body, 'joined compound has no matching physical body');
  lab.cancelGrabs();
  const colliderCenters = Array.from({ length: body.numColliders() }, (_, i) => new THREE.Vector3().copy(body.collider(i).translation()));
  begin(joined[0]);
  assert.equal(lab.getGrabState().assembled, held.assembled);
  colliderCenters.forEach((center, index) => assert.ok(center.distanceTo(body.collider(index).translation()) < .00001, 'reanchoring moved a collider before physics'));
  moveAnchor(point(4, 1.3, 1.7));
  let maxWallError = 0, minFloorY = Infinity;
  const memberMeshes = [picked, ...joined];
  advance(4, () => {
    for (const mesh of memberMeshes.filter((item) => item.visible)) maxWallError = Math.max(maxWallError, shapeBounds(mesh).max.x - wall.min.x);
  });
  assert.ok(maxWallError <= .016, `joined compound hull clipped wall by ${maxWallError}m`);
  moveAnchor(point(1.2, -4, 1.7));
  advance(3, () => {
    for (const mesh of memberMeshes.filter((item) => item.visible)) minFloorY = Math.min(minFloorY, shapeBounds(mesh).min.y);
  });
  assert.ok(minFloorY >= -.016, `reanchored compound clipped floor by ${-minFloorY}m`);
  lab.cancelGrabs();
  assert.ok(bodies().every((value) => value.gravityScale() === 1));
  metrics.reanchoredCompound = { pieces: held.assembled, wallErrorMeters: Math.max(0, maxWallError), floorErrorMeters: Math.max(0, -minFloorY) };
  lab.dispose();
  checks.push('joined fragment colliders remain in place when regrabbed through a different shard and stay solid against wall and floor');
}

{
  const f = await fixture([spec('own'), spec('foreign', -2)]);
  const { lab, original, pieces, begin, advance, bodies, wall, events } = f;
  for (const id of ['own', 'foreign']) lab.hit(original(id), original(id).position.clone(), point(0, 0, -1));
  const allBodies = bodies();
  const byMesh = new Map([...pieces('own'), ...pieces('foreign')].map((mesh) => [mesh,
    [...allBodies].sort((a, b) => mesh.position.distanceTo(a.translation()) - mesh.position.distanceTo(b.translation()))[0]]));
  assert.equal(new Set(byMesh.values()).size, 32, 'each prepared shard needs a unique physical body');
  let index = 0;
  for (const body of allBodies) {
    body.setTranslation(point(-4 + (index % 4) * .25, .35 + Math.floor(index / 4) * .24, 3), true);
    body.setLinvel(point(0, 0, 0), true); body.setAngvel(point(0, 0, 0), true);
    index++;
  }
  const source = pieces('own')[0], candidate = pieces('own').at(-1), foreign = pieces('foreign')[5];
  byMesh.get(source).setTranslation(point(2.08, 1.2, 0), true);
  byMesh.get(candidate).setTranslation(point(2.75, 1.2, .12), true);
  byMesh.get(foreign).setTranslation(point(2.82, .8, -.2), true);
  advance(2 / 60);
  begin(source);
  const foreignBodies = pieces('foreign').map((mesh) => byMesh.get(mesh));
  let activated = false, candidateWallError = 0, foreignWallError = 0;
  advance(4, () => {
    const body = byMesh.get(candidate);
    assert.ok(body.isValid(), 'blocked same-object shard attached through the wall');
    activated ||= body.gravityScale() === 0;
    candidateWallError = Math.max(candidateWallError, wall.max.x - shapeBounds(candidate).min.x);
    foreignWallError = Math.max(foreignWallError, wall.max.x - shapeBounds(foreign).min.x);
    for (const foreignBody of foreignBodies) assert.equal(foreignBody.gravityScale(), 1, 'repair took over a foreign fragment');
  });
  assert.ok(activated, 'same-object shard must enter magnetic attraction for this fixture');
  assert.ok(candidateWallError < .016, `magnetic candidate crossed wall by ${candidateWallError}m`);
  assert.ok(foreignWallError < .016, `foreign fragment crossed wall by ${foreignWallError}m`);
  assert.equal(lab.getState().objects.find((object) => object.id === 'foreign').snapped, 0);
  for (const event of events.filter((value) => value.type === 'collision')) assert.ok(event.strength >= 0 && event.strength <= 1);
  lab.cancelGrabs();
  assert.ok(bodies().every((body) => body.gravityScale() === 1), 'cancel left a magnetized candidate floating');
  metrics.magneticBarrier = { candidateWallErrorMeters: candidateWallError, foreignWallErrorMeters: foreignWallError };
  lab.dispose();
  checks.push('magnetic siblings stay behind intervening walls and never take over foreign fragment physics or gravity');
}

console.log(JSON.stringify({ passed: true, checks, metrics }, null, 2));
