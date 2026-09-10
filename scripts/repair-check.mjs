import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDestructionLab, MAGNET_RADIUS } from '../src/destruction.js';

// Exercise the real fracture and rigid-body simulation without a browser or XR
// emulator. All manipulations go through the same grab API used by the hands.
const scene = new THREE.Scene();
const events = [];
const checks = [];
const lab = await createDestructionLab({ scene, onEvent: (event) => events.push(event) });
const hand = 'repair-test-left';
const otherHand = 'repair-test-right';
const vec = (value) => new THREE.Vector3().fromArray(value);
const objectState = (id) => lab.getState().objects.find((object) => object.id === id);
const original = (id) => scene.children.find((mesh) => mesh.userData.labObject === id && mesh.userData.fragmentIndex === undefined);
const fragments = (id) => scene.children.filter((mesh) => mesh.userData.labObject === id && mesh.userData.fragmentIndex !== undefined);
const homes = new Map(scene.children.map((mesh) => [mesh, mesh.position.clone()]));
const homeRotations = new Map(scene.children.map((mesh) => [mesh, mesh.quaternion.clone()]));
const initialMeshCount = scene.children.length;
const initialPhysics = { ...lab.getState().physics };
let inputOffset = new THREE.Vector3();

function begin(mesh, point, owner = hand) {
  const result = lab.beginGrab(mesh, point, owner);
  if (result && owner === hand) inputOffset = vec(lab.getGrabState().goal).sub(point);
  return result;
}

function moveAnchor(point) {
  return lab.moveGrab(point.clone().sub(inputOffset), hand);
}

function advance(seconds, eachFrame) {
  for (let index = 0; index < Math.ceil(seconds * 60); index++) {
    eachFrame?.(index);
    lab.step(1 / 60);
  }
}

function check(name, test) {
  try { test(); } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  checks.push(name);
}

function noDuplicates() {
  assert.equal(new Set(lab.targets).size, lab.targets.length, 'duplicate break targets');
  assert.equal(new Set(lab.grabTargets).size, lab.grabTargets.length, 'duplicate grab targets');
  assert.equal(scene.children.length, initialMeshCount, 'repair must reuse the original meshes');
}

function restoreAll() {
  lab.cancelGrabs();
  lab.restore();
  advance(1);
  assert.equal(lab.getState().broken, 0, 'Restore all did not finish');
  assert.equal(lab.getGrabState().active, false, 'Restore all left a grab active');
  assert.deepEqual(lab.getState().physics, initialPhysics, 'Restore all leaked physics bodies or colliders');
  noDuplicates();
}

function breakObject(id) {
  const mesh = original(id);
  assert.ok(mesh, `missing original ${id}`);
  assert.equal(lab.hit(mesh, mesh.position.clone(), new THREE.Vector3(0, 0, -1)), true);
  return fragments(id);
}

function gatherUntil(id, count) {
  let elapsed = 0;
  while (!lab.getGrabState().complete && objectState(id).snapped < count && elapsed < 40) {
    const held = lab.getGrabState();
    const heldHome = homes.get(held.heldMesh);
    const rotation = held.heldMesh.quaternion.clone().multiply(homeRotations.get(held.heldMesh).clone().invert());
    assert.ok(heldHome, 'held mesh was not one of the prepared meshes');
    const anchor = vec(held.anchor);
    const candidates = fragments(id).filter((piece) => piece.visible && piece !== held.heldMesh)
      .map((piece) => ({ piece, offset: homes.get(piece).clone().sub(heldHome).applyQuaternion(rotation) }))
      .filter(({ piece, offset }) => piece.position.distanceTo(anchor.clone().add(offset)) > 0.045)
      .sort((a, b) => a.piece.position.distanceTo(anchor) - b.piece.position.distanceTo(anchor));
    assert.ok(candidates.length, `no loose shard found with ${objectState(id).snapped}/${count} attached`);
    const candidate = candidates[0];
    const before = objectState(id).snapped;
    for (let frame = 0; frame < 180; frame++) {
      // Move the hand toward a loose shard, preserving each shard's authored
      // offset so collection results in the actual object silhouette.
      const goal = candidate.piece.position.clone().sub(candidate.offset);
      moveAnchor(goal);
      lab.step(1 / 60);
      elapsed += 1 / 60;
      if (lab.getGrabState().complete || objectState(id).snapped > before) break;
    }
  }
  assert.ok(lab.getGrabState().complete || objectState(id).snapped >= count, `gathering stalled at ${objectState(id).snapped}/${count}`);
}

try {
  check('starts with reusable meshes and one collider per intact object', () => {
    assert.equal(lab.getState().ready, true);
    assert.equal(lab.getState().broken, 0);
    assert.equal(lab.targets.length, 8);
    assert.equal(lab.getGrabState().active, false);
    assert.ok(MAGNET_RADIUS > 0 && MAGNET_RADIUS < 2);
    assert.ok(fragments('cube').length > 1);
    noDuplicates();
  });

  const cubePieces = breakObject('cube');
  advance(11); // Let loose shards rest before measuring movement or attraction.
  const picked = cubePieces.at(-1);
  const start = picked.position.clone();
  const clickOffset = new THREE.Vector3(0.025, 0.02, -0.01);
  const click = start.clone().add(clickOffset);

  check('any shard can be grabbed without teleporting or losing its grab offset', () => {
    assert.ok(lab.grabTargets.includes(picked), 'a non-first shard is missing from grab targets');
    assert.equal(begin(picked, click, hand), true);
    assert.equal(lab.getGrabState().active, true);
    assert.equal(lab.getGrabState().objectId, 'cube');
    assert.ok(picked.position.distanceTo(start) < 1e-6);
    assert.ok(vec(lab.getGrabState().anchor).distanceTo(start) < 1e-6);
    assert.ok(vec(lab.getGrabState().goal).distanceTo(start) < 1e-6);
    assert.equal(lab.getGrabState().radius, MAGNET_RADIUS);
    assert.equal(events.at(-1).type, 'pickup');
    assert.equal(events.at(-1).objectId, 'cube');
  });

  check('the other hand cannot steal, move, or release the active grab', () => {
    const before = lab.getGrabState();
    assert.equal(lab.beginGrab(cubePieces[0], cubePieces[0].position.clone(), otherHand), false);
    lab.moveGrab(click.clone().add(new THREE.Vector3(5, 0, 0)), otherHand);
    lab.endGrab(otherHand);
    assert.equal(lab.getGrabState().active, true);
    assert.deepEqual(lab.getGrabState().goal, before.goal);
  });

  check('dragging eases toward the hand instead of snapping to it', () => {
    const movement = new THREE.Vector3(0, 1.5, 0);
    const target = start.clone().add(movement);
    lab.moveGrab(click.clone().add(movement), hand);
    assert.ok(vec(lab.getGrabState().goal).distanceTo(target) < 1e-6, 'grab offset changed');
    assert.ok(vec(lab.getGrabState().anchor).distanceTo(start) < 1e-6, 'moveGrab teleported the shard');
    lab.step(1 / 60);
    // The public anchor follows the rendered pose, which interpolates between
    // fixed steps and must advance even without another physics tick.
    assert.ok(vec(lab.getGrabState().anchor).distanceTo(start) < 1e-6, 'the first fixed step jumped the rendered shard');
    lab.step(1 / 120);
    const moved = vec(lab.getGrabState().anchor).distanceTo(start);
    assert.ok(moved > 0, 'held shard never moved');
    assert.ok(moved < movement.length() * 0.8, 'held shard follows too directly');
    advance(1.5);
    assert.ok(vec(lab.getGrabState().anchor).distanceTo(target) < 0.02, 'held shard did not settle at its target');
  });

  check('free shards outside the magnetic sphere remain at rest', () => {
    const anchor = vec(lab.getGrabState().anchor);
    const distant = cubePieces.filter((piece) => piece.visible && piece.position.distanceTo(anchor) > MAGNET_RADIUS + 0.3);
    assert.ok(distant.length, 'fixture needs at least one shard outside the magnetic range');
    const before = distant.map((piece) => piece.position.clone());
    advance(0.4);
    distant.forEach((piece, index) => assert.ok(piece.position.distanceTo(before[index]) < 0.002, 'out-of-range shard moved'));
  });

  check('a loose shard accelerates as it closes the final magnetic gap', () => {
    const held = lab.getGrabState();
    const candidate = cubePieces.filter((piece) => piece !== held.heldMesh)
      .sort((a, b) => b.position.distanceTo(vec(held.anchor)) - a.position.distanceTo(vec(held.anchor)))[0];
    const goal = candidate.position.clone().add(new THREE.Vector3(0, MAGNET_RADIUS * 0.93, 0));
    moveAnchor(goal);
    const samples = [];
    let previous = candidate.position.clone();
    for (let frame = 0; frame < 240; frame++) {
      lab.step(1 / 60);
      const now = lab.getGrabState();
      if (now.complete) break;
      const rotation = now.heldMesh.quaternion.clone().multiply(homeRotations.get(now.heldMesh).clone().invert());
      const slot = homes.get(candidate).clone().sub(homes.get(now.heldMesh)).applyQuaternion(rotation).add(vec(now.anchor));
      const distance = candidate.position.distanceTo(slot);
      const speed = candidate.position.distanceTo(previous) * 60;
      if (now.speed < 0.03 && distance > 0.04 && speed > 0.01) samples.push({ distance, speed });
      previous.copy(candidate.position);
      if (distance < 0.004) break;
    }
    assert.ok(samples.length >= 8, `insufficient settled-hand attraction samples (${samples.length})`);
    const firstSpeed = samples.slice(0, 3).reduce((sum, sample) => sum + sample.speed, 0) / 3;
    const last = samples.at(-1);
    assert.ok(last.distance < samples[0].distance * 0.6, 'magnetic gap did not close');
    assert.ok(last.speed > firstSpeed * 1.8, `approach did not accelerate: ${firstSpeed.toFixed(3)} to ${last.speed.toFixed(3)} m/s`);
  });

  check('cancel clears the held state and Restore all cleans up every body', () => {
    const eventStart = events.length;
    lab.cancelGrabs();
    assert.equal(lab.getGrabState().active, false);
    assert.deepEqual(events.slice(eventStart).map((event) => [event.type, event.reason]), [['enddrag', 'cancelled']], 'cancelling must stop the drag sound without playing a drop');
    restoreAll();
  });

  check('magnetism only collects shards from the object being held', () => {
    const own = breakObject('cube');
    const foreign = breakObject('orb');
    advance(11);
    const foreignPiece = [...foreign].sort((a, b) => b.position.x - a.position.x)[0];
    const foreignProgress = objectState('orb').snapped;
    const source = own.at(-1);
    assert.equal(begin(source, source.position.clone(), hand), true);
    // This stays inside the magnet sphere but above collision contact.
    lab.moveGrab(foreignPiece.position.clone().add(new THREE.Vector3(0, MAGNET_RADIUS * 0.72, 0)), hand);
    advance(2);
    assert.ok(foreignPiece.position.distanceTo(vec(lab.getGrabState().anchor)) < MAGNET_RADIUS);
    const before = foreign.map((piece) => piece.position.clone());
    advance(0.5);
    foreign.forEach((piece, index) => assert.ok(piece.position.distanceTo(before[index]) < 0.002, 'a foreign shard was attracted'));
    assert.equal(objectState('orb').snapped, foreignProgress);
    restoreAll();
  });

  const gatherPieces = breakObject('cube');
  advance(11);
  const first = [...gatherPieces].sort((a, b) => a.position.x - b.position.x)[0];
  assert.equal(begin(first, first.position.clone(), hand), true);

  check('sweeping near scattered shards builds a correctly aligned partial assembly', () => {
    gatherUntil('cube', 2);
    const held = lab.getGrabState();
    assert.ok(objectState('cube').snapped > 1);
    assert.ok(objectState('cube').snapped < objectState('cube').total, 'fixture should still contain loose shards');
    const anchor = vec(held.anchor);
    const rotation = held.heldMesh.quaternion.clone().multiply(homeRotations.get(held.heldMesh).clone().invert());
    const aligned = gatherPieces.filter((piece) => piece.position.distanceTo(anchor.clone().add(homes.get(piece).clone().sub(homes.get(held.heldMesh)).applyQuaternion(rotation))) < 0.004);
    assert.equal(aligned.length, objectState('cube').snapped, 'snapped shards do not occupy their authored offsets');
  });

  check('released partial assemblies persist and can be picked up by a joined shard', () => {
    const held = lab.getGrabState();
    const anchor = vec(held.anchor);
    const rotation = held.heldMesh.quaternion.clone().multiply(homeRotations.get(held.heldMesh).clone().invert());
    const joined = gatherPieces.find((piece) => piece !== held.heldMesh && piece.position.distanceTo(anchor.clone().add(homes.get(piece).clone().sub(homes.get(held.heldMesh)).applyQuaternion(rotation))) < 0.004);
    assert.ok(joined, 'no joined shard found');
    const snapped = objectState('cube').snapped;
    const eventStart = events.length;
    lab.endGrab(hand);
    assert.deepEqual(events.slice(eventStart).map((event) => event.type), ['enddrag', 'drop'], 'release must stop the drag sound and play one drop');
    assert.equal(lab.getGrabState().active, false);
    advance(0.8);
    assert.equal(objectState('cube').snapped, snapped, 'dropping separated the partial assembly');
    assert.ok(lab.grabTargets.includes(joined), 'joined shard cannot be grabbed again');
    assert.equal(begin(joined, joined.position.clone(), hand), true);
    assert.equal(lab.getGrabState().assembled, snapped, 'regrabbing lost existing assembly progress');
  });

  check('a different loose shard can pull in an already joined partial assembly', () => {
    const held = lab.getGrabState();
    const rotation = held.heldMesh.quaternion.clone().multiply(homeRotations.get(held.heldMesh).clone().invert());
    const joined = gatherPieces.filter((piece) => piece.position.distanceTo(vec(held.anchor).add(homes.get(piece).clone().sub(homes.get(held.heldMesh)).applyQuaternion(rotation))) < 0.004);
    const loose = gatherPieces.find((piece) => !joined.includes(piece));
    assert.ok(loose);
    lab.endGrab(hand);
    advance(0.8);
    assert.equal(begin(loose, loose.position.clone(), hand), true);
    assert.equal(lab.getGrabState().assembled, 1);
    const clusterTouch = joined[0];
    let collected = false;
    for (let frame = 0; frame < 300; frame++) {
      const current = lab.getGrabState();
      const q = current.heldMesh.quaternion.clone().multiply(homeRotations.get(current.heldMesh).clone().invert());
      const offset = homes.get(clusterTouch).clone().sub(homes.get(current.heldMesh)).applyQuaternion(q);
      moveAnchor(clusterTouch.position.clone().sub(offset));
      lab.step(1 / 60);
      const after = lab.getGrabState();
      if (after.complete) { collected = true; break; }
      const afterRotation = after.heldMesh.quaternion.clone().multiply(homeRotations.get(after.heldMesh).clone().invert());
      collected = joined.every((piece) => piece.position.distanceTo(vec(after.anchor).add(homes.get(piece).clone().sub(homes.get(after.heldMesh)).applyQuaternion(afterRotation))) < 0.004);
      if (collected) break;
    }
    assert.equal(collected, true, 'the previous partial assembly could not be collected from a different loose shard');
    assert.ok(lab.getGrabState().assembled >= joined.length + 1, 'joining discarded earlier repair progress');
  });

  check('sweeping the remaining shards completes a movable whole object', () => {
    const eventStart = events.length;
    gatherUntil('cube', objectState('cube').total);
    assert.equal(lab.getGrabState().complete, true);
    assert.equal(lab.getGrabState().heldMesh, original('cube'));
    assert.equal(original('cube').visible, true);
    assert.equal(gatherPieces.filter((piece) => piece.visible).length, 0);
    const recent = events.slice(eventStart);
    assert.equal(recent.filter((event) => event.type === 'complete').length, 1);
    assert.deepEqual(recent.slice(-3).map((event) => [event.type, event.reason]), [['snap', undefined], ['enddrag', 'complete'], ['complete', undefined]], 'final snap must immediately end the drag loop');
    noDuplicates();
  });

  check('dropping a complete object away from home leaves it movable', () => {
    const mesh = original('cube');
    const far = homes.get(mesh).clone().add(new THREE.Vector3(2.5, 0.7, 0));
    const delta = far.clone().sub(mesh.position);
    moveAnchor(vec(lab.getGrabState().anchor).add(delta));
    advance(2);
    assert.ok(mesh.position.distanceTo(far) < 0.03, `complete drag missed target: actual ${mesh.position.toArray()}, target ${far.toArray()}, grab ${JSON.stringify({ ...lab.getGrabState(), heldMesh: undefined })}`);
    lab.endGrab(hand);
    advance(0.6);
    assert.equal(lab.getGrabState().active, false);
    assert.equal(lab.getState().broken, 1, 'object restored despite being far from home');
    assert.ok(lab.grabTargets.includes(mesh));
    assert.equal(begin(mesh, mesh.position.clone(), hand), true);
    assert.equal(lab.getGrabState().complete, true);
    advance(1); // Allow the lifted assembly's rotation to ease upright.
  });

  check('releasing a complete object near home smoothly docks it and restores its collider', () => {
    const mesh = original('cube');
    const home = homes.get(mesh);
    const near = home.clone().add(new THREE.Vector3(0.25, 0.05, 0));
    moveAnchor(vec(lab.getGrabState().anchor).add(near.clone().sub(mesh.position)));
    advance(2);
    assert.equal(lab.getGrabState().canDock, true);
    const distance = mesh.position.distanceTo(home);
    lab.endGrab(hand);
    assert.ok(mesh.position.distanceTo(home) > distance * 0.95, 'docking teleported directly home');
    advance(0.15);
    assert.ok(mesh.position.distanceTo(home) > 0.001);
    assert.ok(mesh.position.distanceTo(home) < distance, 'docking did not ease toward home');
    advance(0.5);
    assert.ok(mesh.position.distanceTo(home) < 1e-6);
    assert.equal(lab.getState().broken, 0);
    assert.ok(lab.targets.includes(mesh));
    assert.deepEqual(lab.getState().physics, initialPhysics);
    noDuplicates();
  });

  check('Restore all interrupts a live grab and repeated cycles do not leak', () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const pieces = breakObject('cube');
      advance(0.6);
      assert.equal(begin(pieces[cycle], pieces[cycle].position.clone(), hand), true);
      assert.equal(lab.restore(), true);
      assert.equal(lab.getGrabState().active, false);
      advance(1);
      assert.equal(lab.getState().broken, 0);
      assert.deepEqual(lab.getState().physics, initialPhysics);
      noDuplicates();
    }
  });

  check('audio callbacks supply material ownership, spatial positions, and bounded impact strengths', () => {
    for (const type of ['pickup', 'enddrag', 'snap', 'complete', 'drop', 'dock', 'collision']) {
      assert.ok(events.some((event) => event.type === type), `no ${type} audio event was exercised`);
    }
    const ids = new Set(lab.getState().objects.map((object) => object.id));
    for (const event of events) {
      assert.ok(ids.has(event.objectId), `${event.type} event has no material-owning object`);
      assert.ok(event.position?.isVector3);
      assert.ok(event.position.toArray().every(Number.isFinite));
      if ('strength' in event) assert.ok(event.strength > 0 && event.strength <= 1);
    }
  });

  console.log(JSON.stringify({ passed: true, checks, eventCount: events.length, physics: lab.getState().physics }, null, 2));
} finally {
  lab.dispose();
  assert.equal(scene.children.length, 0, 'dispose left lab meshes in the scene');
  assert.equal(lab.targets.length, 0);
  assert.equal(lab.grabTargets.length, 0);
}
