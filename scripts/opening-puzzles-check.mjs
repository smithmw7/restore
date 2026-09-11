import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createOpeningProgression, createOpeningPuzzles, OPENING_CODE, OPENING_SAVE_KEY } from '../src/opening-puzzles.js';

const checks = [];
const memory = (initial) => {
  const data = new Map(initial ? [[OPENING_SAVE_KEY, initial]] : []);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const check = (name, fn) => { try { fn(); checks.push(name); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
function solve(progress) { [...OPENING_CODE].forEach((digit, index) => { for (let n = 0; n < +digit; n++) progress.dispatch('wheel', { index }); }); return progress.dispatch('case-latch'); }

check('case accepts the correct code before the clue is found and preserves unlocked access', () => {
  const storage = memory(), progress = createOpeningProgression(storage);
  assert.equal(progress.dispatch('case-latch'), false);
  assert.equal(solve(progress), true);
  assert.equal(progress.getState().noteSeen, false);
  assert.equal(progress.getState().caseOpen, true);
  assert.equal(progress.dispatch('wheel', { index: 0 }), false);
  progress.dispatch('case-latch');
  const restored = createOpeningProgression(storage);
  assert.equal(restored.getState().caseOpen, false);
  assert.equal(restored.dispatch('case-latch'), true);
  assert.equal(restored.getState().caseOpen, true);
});
check('office, equipment and container branches work in every discovery order', () => {
  const branches = {
    case: progress => { assert.equal(progress.dispatch('drawer'), true); assert.equal(progress.dispatch('notebook'), true); assert.equal(solve(progress), true); },
    glove: progress => { assert.equal(progress.dispatch('locker'), true); assert.equal(progress.dispatch('equip-glove', { handedness: 'left' }), true); },
    container: progress => { assert.equal(progress.dispatch('cutters'), true); assert.equal(progress.dispatch('cut', { toolAtFastener: true }), true); assert.equal(progress.dispatch('container-door'), true); },
  };
  for (const order of [['case', 'glove', 'container'], ['glove', 'container', 'case'], ['container', 'case', 'glove']]) {
    const storage = memory(); let progress = createOpeningProgression(storage);
    for (const branch of order) { branches[branch](progress); progress = createOpeningProgression(storage); }
    assert.equal(progress.getState().caseOpen, true); assert.equal(progress.getState().containerOpen, true); assert.equal(progress.getState().gloves.left, true);
  }
});
check('tools, physical lock state and reach conditions are prerequisites without narrative gates', () => {
  const progress = createOpeningProgression(memory());
  assert.equal(progress.dispatch('notebook'), false);
  assert.equal(progress.dispatch('equip-glove', { handedness: 'right' }), false);
  assert.equal(progress.dispatch('container-door'), false);
  assert.equal(progress.dispatch('cut', { toolAtFastener: true }), false);
  progress.dispatch('cutters');
  assert.equal(progress.dispatch('cut', { toolAtFastener: false }), false);
  assert.equal(progress.dispatch('cut', { toolAtFastener: true }), true);
  assert.equal(progress.dispatch('cut', { toolAtFastener: true }), false);
  assert.equal(progress.getState().milestones.filter(id => id === 'container-released').length, 1);
});
check('ordinary recovery preserves progress while hard reset starts a new opening', () => {
  const progress = createOpeningProgression(memory()); solve(progress); progress.dispatch('locker'); progress.dispatch('equip-glove', { handedness: 'left' });
  progress.dispatch('prop-pose', { id: 'cutters', position: [0, 1, 0], quaternion: [0, 0, 0, 1] });
  progress.reset(); assert.equal(progress.getState().caseUnlocked, true); assert.equal(progress.getState().gloves.left, true); assert.deepEqual(progress.getState().propPoses, {});
  progress.reset({ hard: true }); assert.equal(progress.getState().caseUnlocked, false); assert.equal(progress.getState().gloves.left, false);
});
check('bad saves and unavailable storage cannot block the opening or create invalid poses', () => {
  assert.equal(createOpeningProgression(memory('{')).getState().caseUnlocked, false);
  assert.equal(createOpeningProgression(memory(JSON.stringify({ version: 99, caseUnlocked: true }))).getState().caseUnlocked, false);
  const guarded = createOpeningProgression({ getItem() { throw Error('storage disabled'); }, setItem() { throw Error('storage disabled'); } });
  assert.equal(solve(guarded), true); assert.equal(guarded.getState().saveAvailable, false);
  const tampered = createOpeningProgression(memory(JSON.stringify({ version: 1, caseOpen: true, containerOpen: true, photosViewed: {}, propPoses: { cutters: { position: [0, -900, 0], quaternion: [0, 0, 0, 1] } } })));
  assert.equal(tampered.getState().caseOpen, false); assert.equal(tampered.getState().containerOpen, false); assert.deepEqual(tampered.getState().propPoses, {});
});

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.createCollider(RAPIER.ColliderDesc.cuboid(90, .10, 90).setTranslation(0, -.1, 0));
const scene = new THREE.Scene(), events = [], storage = memory();
const puzzles = createOpeningPuzzles({ scene, world, storage, onEvent: event => events.push(event) });
const position = id => new THREE.Vector3(...puzzles.getState().targets.find(target => target.id === id).position);
const target = id => puzzles.targets.find(mesh => mesh.userData.openingId === id);
const tap = (id, options = {}) => puzzles.tap(target(id), position(id), { viewerPosition: position(id).clone().add(new THREE.Vector3(0, .35, .5)), ...options });
const advance = seconds => { for (let n = 0; n < Math.ceil(seconds * 60); n++) { puzzles.step(1 / 60); world.step(); } };
const hand = (pos, handedness = 'right', handId = 'test-hand') => puzzles.updateHands([{ handId, handedness, position: new THREE.Vector3(...pos), quaternion: new THREE.Quaternion() }]);
try {
  check('closed parents expose no notebook, glove or photograph ray targets', () => {
    assert.ok(target('drawer')); assert.ok(target('locker')); assert.ok(target('case-latch')); assert.ok(target('cutters'));
    assert.equal(target('notebook'), undefined); assert.equal(target('glove-left'), undefined); assert.equal(target('photo-0'), undefined);
    assert.equal(puzzles.canPower('left'), false); assert.equal(puzzles.canPower('none'), false);
    assert.equal(puzzles.tap(target('drawer'), position('drawer'), { viewerPosition: new THREE.Vector3(0, 1.6, 0) }), false);
  });
  check('drawer reveals notebook and its note remains available beside the case', () => {
    assert.equal(tap('drawer'), true); advance(1); assert.ok(target('notebook'));
    tap('notebook'); advance(1); assert.equal(puzzles.getState().noteSeen, true); assert.equal(puzzles.getState().notebookOpen, true);
    assert.ok(position('notebook').y > .98);
    tap('drawer'); advance(1); assert.ok(target('notebook'));
  });
  check('four physical wheels unlock three photographs only when the lid is open', () => {
    tap('case-latch'); assert.equal(puzzles.getState().caseOpen, false);
    [...OPENING_CODE].forEach((digit, index) => { for (let n = 0; n < +digit; n++) tap(`wheel-${index}`); });
    advance(.7);
    tap('case-latch'); assert.equal(puzzles.getState().caseOpen, true); assert.equal(target('photo-0'), undefined);
    advance(1); assert.ok(target('photo-0')); assert.ok(target('photo-1')); assert.ok(target('photo-2'));
    assert.equal(puzzles.targets.filter(mesh => mesh.userData.openingId.startsWith('wheel-')).length, 0);
  });
  check('either glove can be equipped with a single hand and no clue dependency', () => {
    tap('locker'); advance(1); assert.ok(target('glove-right')); assert.ok(target('glove-left'));
    assert.equal(tap('glove-left', { handId: 'test-hand', handedness: 'right', xr: true }), false, 'VR cannot don a distant glove by ray');
    tap('glove-left', { handId: 'test-hand', handedness: 'right' });
    assert.equal(puzzles.canPower('left'), true); assert.equal(puzzles.canPower('right'), false); assert.equal(target('glove-left'), undefined);
    hand([1, 1.2, 2], 'left'); puzzles.step(1 / 60);
    assert.deepEqual(puzzles.getState().props.find(prop => prop.id === 'glove-left').position, [1, 1.2, 2]);
  });
  check('grabs retain hand ownership and dropped photograph stays physically above the floor', () => {
    const photo = target('photo-0'); const start = position('photo-0'); hand(start.toArray());
    assert.equal(puzzles.beginGrab(photo, start, 'test-hand'), true);
    assert.equal(puzzles.moveGrab(new THREE.Vector3(3, 1, 7), 'wrong-hand'), false);
    assert.equal(puzzles.endGrab('wrong-hand'), false);
    puzzles.moveGrab(new THREE.Vector3(3, -.5, 7), 'test-hand'); advance(3);
    assert.equal(puzzles.getGrabState().active, true); assert.ok(puzzles.getGrabState().anchor[1] > -.01);
    puzzles.endGrab('test-hand'); advance(8);
    assert.ok(puzzles.getState().props.find(prop => prop.id === 'photo-0').position[1] > -.01);
    assert.ok(puzzles.getState().photosViewed.includes(0));
    assert.equal(puzzles.getGrabState().active, false);
  });
  check('container cannot open remotely or without cutters at the fastener', () => {
    tap('container-fastener'); tap('container-door--1'); assert.equal(puzzles.getState().containerCut, false); assert.equal(puzzles.getState().containerOpen, false);
    hand(HOME_CUTTERS()); tap('cutters', { handId: 'test-hand', handedness: 'right' }); advance(.5);
    tap('container-fastener'); assert.equal(puzzles.getState().containerCut, false);
    hand([-7, 1.4, 6.5]); advance(6);
    tap('container-fastener', { handId: 'test-hand', handedness: 'right' });
    assert.equal(puzzles.getState().containerCut, true); assert.equal(puzzles.getState().containerOpen, false);
    tap('container-door--1'); advance(2);
    assert.equal(puzzles.doorOpen, true); assert.equal(puzzles.getState().containerOpen, true); assert.equal(target('container-fastener'), undefined);
    assert.ok(puzzles.getState().containerLightIntensity > 25);
    assert.ok(!puzzles.getObstacles().some(box => box.containsPoint(new THREE.Vector3(-7, 1.3, 5.76))), 'opened doors must leave the central exit clear');
  });
  check('teleport carries the equipped cutter only into free space and supports a deliberate release', () => {
    const blocker = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(15, 1.4, 12)); world.step();
    hand([15, 1.4, 12]);
    assert.equal(puzzles.getState().equippedCutters, 'test-hand');
    assert.equal(puzzles.getState().carriedRelocationPending, true);
    assert.equal(puzzles.getState().props.find(prop => prop.id === 'cutters').visible, false);
    hand([15, 1.4, 14]); advance(.2);
    assert.equal(puzzles.getState().carriedRelocationPending, false);
    assert.ok(new THREE.Vector3(...puzzles.getState().props.find(prop => prop.id === 'cutters').position).distanceTo(new THREE.Vector3(15, 1.4, 14)) < .6);
    assert.equal(puzzles.releaseTool('wrong-hand'), false);
    assert.equal(puzzles.releaseTool('test-hand'), true);
    assert.equal(puzzles.getState().equippedCutters, null);
    assert.ok(target('cutters'));
    tap('cutters', { handId: 'test-hand', handedness: 'right' });
    world.removeCollider(blocker, true);
  });
  check('tracking loss releases equipped tool and reload recovery never duplicates it', () => {
    puzzles.updateHands([]); advance(7); assert.equal(puzzles.getState().equippedCutters, null);
    assert.ok(puzzles.getState().props.find(prop => prop.id === 'cutters').position[1] >= .025);
    assert.equal(puzzles.getState().props.filter(prop => prop.id === 'cutters').length, 1);
    puzzles.reset(); assert.equal(puzzles.getState().containerCut, true); assert.equal(puzzles.getState().caseUnlocked, true); assert.equal(puzzles.canPower('left'), true);
    const saved = createOpeningProgression(storage); assert.equal(saved.getState().containerCut, true);
  });
  check('a removed glove remains reachable and wearable after its locker closes', () => {
    const glove=target('glove-right'),start=position('glove-right');hand(start.toArray(),'left');
    assert.equal(puzzles.beginGrab(glove,start,'test-hand'),true);
    puzzles.moveGrab(new THREE.Vector3(10.8,1.3,12),'test-hand');advance(2);puzzles.endGrab('test-hand');
    tap('locker');advance(1);assert.equal(puzzles.getState().lockerOpen,false);
    assert.ok(target('glove-right'));assert.equal(tap('glove-right'),true);assert.equal(puzzles.canPower('right'),true);
  });
  check('physical shell stays bounded and meaningful events identify the action for sound', () => {
    assert.ok(puzzles.getState().physics.bodies < 50);
    assert.ok(events.some(event => event.action === 'cut' && event.type === 'puzzle'));
    assert.ok(events.some(event => event.action === 'equip' && event.interaction === 'equip-glove'));
    assert.ok(events.some(event => event.action === 'dial' && event.interaction === 'locked'));
    const before = world.bodies.len(); puzzles.dispose(); assert.equal(world.bodies.len(), before - puzzles.getState().physics.bodies);
    assert.equal(scene.children.length, 0);
  });
} catch (error) { console.error(error.stack); throw error; } finally { puzzles.dispose(); world.free(); }
function HOME_CUTTERS() { return [-6.7, 1.23, 10.6]; }
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
