import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFieldBlueprint, createOpeningAssembly, fieldStage } from '../src/opening-assembly.js';
import { createOpeningEnvironment } from '../src/opening-environment.js';
import { createOpeningPuzzles } from '../src/opening-puzzles.js';

await RAPIER.init();
const SAVE_KEY = 'restore.opening.mechanism.v1';
const specs = createFieldBlueprint(), byId = new Map(specs.map(p => [p.id, p]));
const checks = [];
const V = a => new THREE.Vector3(...a);
function saveFor(ids, positions = {}) {
  return { version: 1, layout: 2, revealed: true, parts: specs.map(p => ({ id: p.id, installed: ids.includes(p.id), position: positions[p.id] || p.goal.clone().add(new THREE.Vector3(-6, 2, 0)).toArray() })) };
}
function fixture({ saved, room = false } = {}) {
  const scene = new THREE.Scene(), world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }), data = new Map(), events = [];
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, .05, 180).setTranslation(0, -.05, -70));
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  if (saved) data.set(SAVE_KEY, JSON.stringify(saved));
  let environment, puzzles, opened = false;
  if (room) {
    environment = createOpeningEnvironment({ scene });
    for (const bounds of environment.obstacles) {
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      world.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(...center.toArray()));
    }
    puzzles = createOpeningPuzzles({ scene, world, storage });
  }
  let assembly = createOpeningAssembly({ scene, world, storage, onEvent: e => events.push(e), containerOpen: () => opened });
  const api = {
    world, scene, data, events,
    get assembly() { return assembly; },
    open() { opened = true; },
    step(frames = 1) { for (let i = 0; i < frames; i++) { world.timestep = 1 / 72; world.step(); puzzles?.step(1 / 72); assembly.step(1 / 72); } },
    reload() { assembly.dispose(); events.length = 0; assembly = createOpeningAssembly({ scene, world, storage, onEvent: e => events.push(e), containerOpen: () => opened }); },
    dispose() { assembly.dispose(); puzzles?.dispose(); environment?.dispose(); world.free(); },
  };
  return api;
}
function install(f, id, height = 2.55) {
  const mesh = f.assembly.targets.find(m => m.name === id), goal = byId.get(id).goal;
  assert.ok(mesh, `${id} is accessible`);
  assert.ok(f.assembly.beginGrab(mesh, mesh.position.clone(), 'test-left'));
  for (const waypoint of [[mesh.position.x, height, mesh.position.z], [goal.x, height, goal.z], goal.toArray()]) {
    if (!f.assembly.getGrabState().active) break;
    assert.ok(f.assembly.moveGrab(V(waypoint), 'test-left'));
    f.step(700);
  }
  const part = f.assembly.getState().parts.find(p => p.id === id);
  assert.ok(part.installed, `${id} installs through physical motion: ${JSON.stringify({ part, resonance: f.assembly.getResonanceState() })}`);
}

// A fresh real room, with no save or unlocked container, already permits the
// first discovery. The test only uses ordinary grabs, waypoints, and physics.
{
  const f = fixture({ room: true });
  assert.equal(f.assembly.targets.length, 18);
  assert.equal(f.assembly.getState().parts.filter(p => p.visible).length, 17);
  install(f, 'frame-0-0'); assert.equal(f.assembly.getState().stage, 0);
  install(f, 'strut-0');
  assert.equal(f.assembly.getState().installed, 2); assert.equal(f.assembly.getState().stage, 1);
  assert.equal(f.assembly.getState().revealed, false);
  assert.deepEqual(f.events.filter(e => e.type === 'field-milestone').map(e => e.stage), [1]);
  assert.equal(f.assembly.getGrabState().active, false);
  f.reload(); f.step(144);
  assert.equal(f.assembly.getState().stageName, 'first-contact'); assert.equal(f.assembly.getState().installed, 2);
  assert.equal(f.events.filter(e => e.type === 'field-milestone' || e.type === 'complete').length, 0);
  assert.equal(f.assembly.getState().presentation.energy, 0);
  f.dispose(); checks.push('A fresh room offers a real two-part first contact before the container, then reloads quietly');
}

// Long idle time must not put a sleeping part through the container deck.
// The new first discovery deliberately gives the player time to explore.
{
  const f = fixture({ room: true }); f.open(); f.step(7200);
  for (const p of specs.filter(p => p.packed)) {
    const actual = f.assembly.getState().parts.find(part => part.id === p.id);
    assert.ok(actual.position[1] > .14, `${p.id} stays above the container deck after 100 seconds: ${JSON.stringify(actual.position)}`);
  }
  f.dispose(); checks.push('Packed frames stay supported above the container deck throughout a long exploration pause');
}

// Recovery saves immediately, before another physics frame has synchronized
// the render mesh. Its saved orientation must match the newly upright body.
{
  const saved = saveFor([]), strutSave = saved.parts.find(p => p.id === 'strut-0');
  strutSave.position = [-6.69, 1.8, 10.12];
  strutSave.quaternion = [0, 0, Math.sin(.4), Math.cos(.4)];
  const f = fixture({ saved });
  const strut = f.assembly.targets.find(m => m.name === 'strut-0');
  assert.ok(strut.quaternion.angleTo(new THREE.Quaternion()) > .7);
  let body;
  f.world.forEachRigidBody(candidate => {
    if (V(Object.values(candidate.translation())).distanceTo(strut.position) < .001) body = candidate;
  });
  assert.ok(body); body.setAngvel({ x: .4, y: .7, z: -.3 }, true);
  f.assembly.reset();
  const stored = JSON.parse(f.data.get(SAVE_KEY)).parts.find(p => p.id === 'strut-0');
  assert.deepEqual(stored.quaternion, [0, 0, 0, 1]);
  assert.deepEqual(strut.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(Object.values(body.angvel()), [0, 0, 0]);
  f.reload();
  const reloaded = f.assembly.targets.find(m => m.name === 'strut-0');
  assert.deepEqual(reloaded.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(reloaded.position.toArray(), stored.position);
  f.dispose(); checks.push('Recovery immediately saves and reloads a tilted loose strut upright with no residual angular velocity');
}

// Signal depends on the actual body. Merely putting the hand target at the
// goal while the body is remote does not create an alignment indication.
{
  const f = fixture(), mesh = f.assembly.targets.find(m => m.name === 'frame-0-0');
  f.assembly.beginGrab(mesh, mesh.position.clone(), 'remote');
  f.assembly.moveGrab(byId.get('frame-0-0').goal.clone(), 'remote');
  f.assembly.step(1 / 72); // Deliberately do not integrate the world yet.
  const resonance = f.assembly.getResonanceState();
  assert.ok(resonance.separation > 1.2); assert.equal(resonance.active, false); assert.equal(resonance.signal, 0);
  assert.equal(f.assembly.getState().presentation.connectorVisible, false);
  assert.equal(f.assembly.endGrab('remote', { cancelled: true }), true);
  assert.equal(f.assembly.getResonanceState().active, false); assert.equal(f.assembly.getResonanceState().signal, 0);
  assert.equal(f.events.filter(e => e.type === 'drop').length, 0);
  f.step(); assert.equal(f.assembly.getState().presentation.connectorVisible, false);
  f.dispose(); checks.push('A remote physical body cannot align from its hand goal, and cancellation leaves no guidance or drop cue');
}

// A physical obstruction sits between a nearby frame and its socket. The
// normal grab can press against it but neither promise nor perform seating.
{
  const goal = byId.get('frame-0-0').goal;
  const f = fixture({ saved: saveFor([], { 'frame-0-0': goal.clone().add(new THREE.Vector3(0, .8, 0)).toArray() }) });
  f.world.createCollider(RAPIER.ColliderDesc.cuboid(.7, .045, .7).setTranslation(goal.x, goal.y + .34, goal.z));
  f.step(); const mesh = f.assembly.targets.find(m => m.name === 'frame-0-0');
  f.assembly.beginGrab(mesh, mesh.position.clone(), 'blocked'); f.assembly.moveGrab(goal.clone(), 'blocked'); f.step(144);
  const resonance = f.assembly.getResonanceState();
  assert.equal(resonance.active, false); assert.equal(resonance.clear, false); assert.equal(resonance.signal, 0);
  assert.equal(f.assembly.getState().parts.find(p => p.id === 'frame-0-0').installed, false);
  assert.ok(mesh.position.y > goal.y + .34);
  f.assembly.endGrab('blocked'); assert.equal(f.assembly.getResonanceState().signal, 0); f.step();
  assert.equal(f.assembly.getState().presentation.connectorVisible, false);
  assert.equal(f.events.filter(e => e.type === 'drop').length, 1);
  f.dispose(); checks.push('A blocked route stays physically blocked and gives no false alignment; release clears the cue');
}

const lower = [0, 1, 2, 3].map(i => `frame-0-${i}`), emitters = [0, 1, 2, 3, 4, 5].map(i => `emitter-${i}`);
assert.deepEqual([[], ['frame-0-0', 'strut-0'], lower, [...lower, ...emitters, 'core'], specs.map(p => p.id)].map(fieldStage), [0, 1, 2, 3, 4]);
{
  for (const [stage, ids] of [[2, lower], [3, [...lower, ...emitters, 'core']], [4, specs.map(p => p.id)]]) {
    const f = fixture({ saved: saveFor(ids) }); f.step(360);
    assert.equal(f.assembly.getState().stage, stage);
    assert.equal(f.events.filter(e => e.type === 'field-milestone' || e.type === 'complete').length, 0);
    assert.ok(Math.abs(f.assembly.getState().presentation.energy - [0, 0, .055, .18, .28][stage]) < .002);
    f.dispose();
  }
  checks.push('Lower ring, field core and full awakening restore the correct quiet stage without replaying milestones');
}

// One final physical placement must generate the fresh awakening exactly once.
{
  const lens = byId.get('field-lens');
  const f = fixture({ saved: saveFor(specs.filter(p => p.id !== 'field-lens').map(p => p.id), { 'field-lens': lens.goal.clone().add(new THREE.Vector3(0, .7, 0)).toArray() }) });
  install(f, 'field-lens', 2.8);
  assert.equal(f.assembly.getState().completed, true);
  assert.deepEqual(f.events.filter(e => e.type === 'field-milestone').map(e => e.stage), [4]);
  assert.equal(f.events.filter(e => e.type === 'complete').length, 1);
  f.step(500); assert.equal(f.events.filter(e => e.type === 'complete').length, 1);
  assert.ok(f.assembly.getState().presentation.energy < .3);
  f.dispose(); checks.push('The last physical lens placement awakens once and its field settles');
}

{
  const f = fixture(); f.step(540);
  const rest = f.assembly.getState().sample, position = V(rest.position);
  assert.equal(rest.active, false); assert.equal(rest.levitating, false);
  assert.ok(Math.abs(rest.position[1] - rest.home[1]) < .035);
  f.step(144); assert.ok(position.distanceTo(V(f.assembly.getState().sample.position)) < .003);
  f.dispose(); checks.push('The unpowered specimen comes to rest on its stand');
}
{
  const f = fixture({ saved: saveFor(specs.map(p => p.id)) }); f.step(420);
  let state = f.assembly.getState().sample; const home = V(state.home);
  assert.equal(state.active, true); assert.equal(state.levitating, true);
  assert.ok(state.position[1] > home.y + .27 && state.position[1] < home.y + .39);
  const mesh = f.assembly.targets.find(m => m.userData.kind === 'mechanism-sample');
  assert.ok(f.assembly.beginGrab(mesh, mesh.position.clone(), 'sample'));
  assert.equal(f.assembly.beginGrab(mesh, mesh.position.clone(), 'other'), false);
  f.assembly.moveGrab(home.clone().add(new THREE.Vector3(1.2, .62, 0)), 'sample'); f.step(210);
  assert.equal(f.assembly.getState().sample.held, true); assert.equal(f.assembly.getState().sample.levitating, false);
  const releaseY = mesh.position.y;
  f.assembly.endGrab('sample'); f.step(40);
  assert.equal(f.assembly.getState().sample.levitating, false);
  assert.ok(mesh.position.y < releaseY - .25, `specimen falls under gravity after leaving the field: ${mesh.position.y} vs ${releaseY}`);
  f.step(420); assert.ok(mesh.position.y < .15);
  assert.ok(f.assembly.beginGrab(mesh, mesh.position.clone(), 'sample'));
  for (const point of [mesh.position.clone().setY(2), home.clone().setY(2), home.clone().add(new THREE.Vector3(0, .37, 0))]) {
    f.assembly.moveGrab(point, 'sample'); f.step(180);
  }
  f.assembly.endGrab('sample'); f.step(260); state = f.assembly.getState().sample;
  assert.equal(state.levitating, true); assert.ok(state.position[1] > home.y + .27);
  f.dispose(); checks.push('The completed field levitates a real body that can be plucked away, dropped under gravity and returned to suspend again');
}
for (const p of specs) p.geometry.dispose();
console.log(JSON.stringify({ passed: true, checks }, null, 2));
