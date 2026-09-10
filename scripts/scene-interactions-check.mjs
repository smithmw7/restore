import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';
import { createHangingLights } from '../src/hanging-lights.js';
import { createSceneInteractions } from '../src/scene-interactions.js';
import { dispatchTap } from '../src/tap-influence.js';
import { adjustHoldDistance, createHoldPull, stepHoldPull } from '../src/hold-pull.js';
const scene = new THREE.Scene(), events = [], checks = [];
const lights = createHangingLights({ parent: scene, fixtures: [{ id: 'pendant-1', x: 0, z: -2, y: 10.4, anchorY: 27.6, lit: true }], onEvent: e => events.push(e) });
const game = await createWarehouseGameplay({ scene, crateCount: 1 });
const app = createSceneInteractions(game, lights);
const lamp = lights.targets[0], crate = game.targets[0];
const point = new THREE.Vector3(); lamp.getWorldPosition(point);
try {
  assert.ok(app.targets.includes(lamp) && app.grabTargets.includes(lamp) && app.targets.includes(crate));
  for (const distance of [1, 9]) {
    lights.reset(); scene.updateMatrixWorld(true);
    const hit = lamp.getWorldPosition(new THREE.Vector3());
    const effect = dispatchTap(app, { object: lamp, point: hit }, hit.clone().add(new THREE.Vector3(0, 0, distance)), new THREE.Vector3(0, 0, -1));
    assert.equal(effect.kind, 'nudge');
    assert.equal(game.getState().openedCrates, 0);
    for (let i = 0; i < 120; i++) { app.step(1/120); lights.step(1/120); }
    assert.ok(lights.getState().active > 0);
  }
  assert.ok(!events.some(e => e.type === 'break' || e.type === 'drop'));
  checks.push('near and far lamp taps always push without breaking or dropping anything');
  assert.equal(app.beginGrab(lamp, lamp.getWorldPosition(new THREE.Vector3()), 'left'), true);
  assert.equal(app.beginGrab(crate, crate.position.clone(), 'right'), false);
  assert.equal(app.moveGrab(new THREE.Vector3(2, 9, 1), 'right'), false);
  assert.equal(app.endGrab('right'), false);
  assert.equal(app.nudge(crate, crate.position.clone(), new THREE.Vector3(0,0,-1), 1), false);
  assert.equal(app.getState().grab.kind, 'hanging-light');
  assert.equal(app.cancelGrabs(), true);
  assert.equal(app.getGrabState().active, false);
  assert.equal(app.beginGrab(crate, crate.position.clone(), 'right'), true);
  assert.equal(app.beginGrab(lamp, lamp.getWorldPosition(new THREE.Vector3()), 'left'), false);
  assert.equal(app.hit(lamp, point, new THREE.Vector3(0,0,-1)), false);
  assert.equal(app.endGrab('right'), true);
  checks.push('props and pendants share one grab owner across hands and tapping');
  lights.reset(); scene.updateMatrixWorld(true);
  const viewer = new THREE.Vector3(0, 1.65, 78);
  const ray = new THREE.Raycaster(viewer, lamp.getWorldPosition(new THREE.Vector3()).sub(viewer).normalize());
  const farHit = ray.intersectObjects(app.targets, false)[0];
  assert.equal(farHit.object, lamp);
  assert.ok(farHit.distance > 79, 'fixture must exercise a real distant selection ray');
  assert.equal(app.beginGrab(farHit.object, farHit.point, 'far-controller'), true);
  const original = lamp.position.clone(), wireLength = lights.getState().lights[0].pendulumLength;
  const pull = createHoldPull(1.2);
  let distance = farHit.distance;
  for (let frame = 0; frame < 72 * 6; frame++) {
    distance = adjustHoldDistance(distance, 0, 'hanging-light');
    distance = stepHoldPull(pull, 1 / 72, { origin: ray.ray.origin, direction: ray.ray.direction, viewer, distance });
    app.moveGrab(ray.ray.at(distance, new THREE.Vector3()), 'far-controller');
    app.step(1 / 72); lights.step(1 / 72);
    const state = lights.getState().lights[0];
    assert.ok(Math.abs(new THREE.Vector3().fromArray(state.position).distanceTo(new THREE.Vector3().fromArray(state.anchor)) - wireLength) < 1e-7);
    assert.equal(app.getGrabState().objectId, 'pendant-1');
  }
  assert.ok(lamp.position.distanceTo(original) > 1, 'distant hold did not pull the real light');
  assert.ok(distance > 75, 'held lamp range collapsed to the prop depth limit');
  assert.equal(app.endGrab('far-controller'), true);
  checks.push('an 80 metre selection ray can hold and gradually pull a real lamp while preserving its fixed wire');
  app.restore();
  assert.equal(app.getState().hangingLights.active, 0);
  assert.equal(app.getState().closedCrates, 1);
  assert.ok(!app.getGrabState().active);
  checks.push('scene reset restores lamps and props together');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { lights.dispose(); app.dispose(); assert.equal(scene.children.length, 0); }
