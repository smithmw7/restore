import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createContactAudioProbe, setContactSurface } from '../src/contact-audio.js';
import { driveGrabbedBody } from '../src/physical-drag.js';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';

await RAPIER.init();
const checks = [], measurements = {};
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const q = new THREE.Quaternion(), dt = 1 / 60;
function fixture() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = dt;
  setContactSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(10, .1, 10).setTranslation(0, -.1, 0).setFriction(.7)), 'concrete');
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, .5, 0));
  setContactSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(.3, .3, .3).setMass(5).setFriction(.7), body), 'wood');
  return { world, body, read: createContactAudioProbe(world) };
}

{
  const { world, body, read } = fixture();
  try {
    const goal = v(3, .1, 0); let peak = 0, minimumY = Infinity;
    for (let i = 0; i < 300; i++) {
      driveGrabbedBody(world, body, goal, q, dt); world.step();
      const state = read(body, goal);
      minimumY = Math.min(minimumY, body.translation().y);
      if (state.surface === 'concrete') peak = Math.max(peak, state.scrapeSpeed);
    }
    assert.ok(peak > .4, 'floor contact did not produce concrete rubbing');
    assert.ok(minimumY > .294, 'sound-aware dragging changed floor solidity');
    assert.ok(read(body, goal).scrapeSpeed < .012, 'settled contact still sounds like sliding');
    measurements.floorPeakSpeed = peak;
    checks.push('floor sliding uses concrete contacts and settles below the audible motion threshold');
  } finally { world.free(); }
}
{
  const { world, body, read } = fixture();
  try {
    setContactSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(.2, 3, 10).setTranslation(1, 3, 0)), 'wood');
    body.setTranslation(v(0, 1.5, 0), true);
    const goal = v(4, 1.5, 3); let peak = 0, peakLoad = 0;
    for (let i = 0; i < 150; i++) {
      driveGrabbedBody(world, body, goal, q, dt); world.step();
      const state = read(body, goal);
      if (state.surface === 'wood') { peak = Math.max(peak, state.scrapeSpeed); peakLoad = Math.max(peakLoad, state.load); }
    }
    assert.ok(peak > .4 && peakLoad > .35, 'wood sliding or constrained load was not recognized');
    assert.ok(body.translation().x < .51 && body.translation().z > 2.9);
    measurements.woodPeakSpeed = peak;
    checks.push('rubbing a wood face selects wood, measures strain and retains tangential sliding');
  } finally { world.free(); }
}
{
  const { world, body, read } = fixture();
  try {
    body.setGravityScale(0, true); body.setTranslation(v(0, 4, 0), true); body.setLinvel(v(2, 0, 0), true); world.step();
    assert.deepEqual(read(body, v(4, 4, 0)), { surface: null, scrapeSpeed: 0, load: 0, contact: false });
    checks.push('moving airborne wood has no rubbing surface, scrape velocity or contact strain');
  } finally { world.free(); }
}
{
  const { world, body, read } = fixture();
  try {
    const support = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(0, .2, 0));
    setContactSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(3, .2, 3), support), 'wood');
    body.setTranslation(v(0, .71, 0), true);
    for (let i = 0; i < 90; i++) world.step();
    body.setLinvel(v(.5, 0, 0), true); support.setLinvel(v(.5, 0, 0), true);
    // Refresh solver contacts after waking the previously resting pair.
    world.step();
    body.setLinvel(v(.5, 0, 0), true); support.setLinvel(v(.5, 0, 0), true);
    body.setAngvel(v(), true); support.setAngvel(v(), true);
    assert.ok(read(body).contact);
    assert.ok(read(body).scrapeSpeed < .00001, 'objects travelling together were treated as rubbing');
    body.setAngvel(v(0, 1, 0), true);
    const rotating = read(body);
    assert.equal(rotating.surface, 'wood'); assert.ok(rotating.scrapeSpeed > .1);
    checks.push('contact speed is relative to the other body and includes rotating surfaces');
  } finally { world.free(); }
}
{
  const events = [], game = await createWarehouseGameplay({ scene: new THREE.Scene(), crateCount: 1, onEvent: event => events.push(event) });
  try {
    for (let i = 0; i < 60; i++) game.step(dt);
    const crate = game.targets.find(mesh => mesh.userData.kind === 'crate');
    assert.ok(game.beginGrab(crate, crate.position.clone(), 'test'));
    assert.equal(events.findLast(event => event.type === 'pickup').kind, 'crate');
    game.moveGrab(v(.5, .01, crate.position.z), 'test');
    let peak = 0;
    for (let i = 0; i < 210; i++) {
      game.step(dt); const grab = game.getGrabState();
      if (grab.surface === 'concrete') peak = Math.max(peak, grab.scrapeSpeed);
    }
    assert.ok(peak > .3, 'real held crate floated above its floor-scrape contact');
    assert.ok(crate.position.y > .44, 'held crate penetrated the floor');
    assert.ok(game.getGrabState().scrapeSpeed < .012);
    game.endGrab('test'); assert.equal(game.getGrabState().active, false);
    game.hit(crate, crate.position.clone(), v(0, 0, -1));
    for (let i = 0; i < 120; i++) game.step(dt);
    const board = game.grabTargets.find(mesh => mesh.userData.kind === 'crate-piece');
    assert.ok(game.beginGrab(board, board.position.clone(), 'test'));
    assert.equal(events.findLast(event => event.type === 'pickup').kind, 'crate-piece');
    game.restore(); assert.equal(game.getGrabState().active, false);
    measurements.cratePeakSpeed = peak;
    checks.push('actual crate/board pickups expose contact-aware audio data and reset clears their owner');
  } finally { game.dispose(); }
}
console.log(JSON.stringify({ passed: true, checks, measurements }, null, 2));
