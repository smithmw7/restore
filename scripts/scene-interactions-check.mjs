import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarehouseGameplay } from '../src/warehouse-gameplay.js';
import { createHangingLights } from '../src/hanging-lights.js';
import { createSceneInteractions } from '../src/scene-interactions.js';
import { dispatchTap } from '../src/tap-influence.js';
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
  app.restore();
  assert.equal(app.getState().hangingLights.active, 0);
  assert.equal(app.getState().closedCrates, 1);
  assert.ok(!app.getGrabState().active);
  checks.push('scene reset restores lamps and props together');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { lights.dispose(); app.dispose(); assert.equal(scene.children.length, 0); }
