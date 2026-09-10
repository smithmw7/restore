import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createDestructionLab } from '../src/destruction.js';

const checks = [];
async function setup() {
  const scene = new THREE.Scene();
  const events = [];
  const lab = await createDestructionLab({ scene, wholeObjects: true, pedestals: false,
    specs: [{ id: 'cube', x: 0, y: .7, z: 0, halfHeight: .04, pedestalHeight: 0, color: '#ffffff', seed: 402, fragmentCount: 8 }],
    geometryForSpec: () => new THREE.BoxGeometry(.08, .08, .08),
    onEvent: (event) => events.push(event.type),
  });
  const mesh = lab.targets[0];
  lab.beginGrab(mesh, mesh.position.clone());
  lab.moveGrab(mesh.position.clone().add(new THREE.Vector3(.4, 0, 0)));
  const advance = (seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) lab.step(1 / 60); };
  advance(2);
  assert.ok(Math.abs(mesh.position.x - .4) < .005);
  return { lab, mesh, events, advance };
}

{
  const { lab, mesh, events } = await setup();
  lab.endGrab();
  assert.equal(lab.getState().objects[0].state, 'docking');
  assert.equal(lab.getState().physics.bodies, 1, 'the return retains its dynamic rigid body');
  let largestStep = 0;
  let previous = mesh.position.clone();
  for (let i = 0; i < 90; i++) {
    lab.step(1 / 60);
    largestStep = Math.max(largestStep, previous.distanceTo(mesh.position));
    previous.copy(mesh.position);
  }
  assert.equal(lab.getState().objects[0].state, 'intact');
  assert.equal(events.filter((type) => type === 'dock').length, 1);
  assert.ok(largestStep < .055, `dock moved ${largestStep}m in one frame`);
  lab.dispose();
  checks.push('clear docking keeps a physical body until alignment and completes without a pose jump');
}

{
  const { lab, mesh, events, advance } = await setup();
  lab.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(.07, .14, .14).setTranslation(0, .7, 0));
  advance(1 / 60);
  assert.equal(lab.getGrabState().canDock, false);
  lab.endGrab();
  advance(1);
  assert.equal(events.includes('dock'), false);
  assert.equal(lab.getState().objects[0].state, 'assembled');
  assert.ok(mesh.position.x > .3 && mesh.position.y < .1, 'blocked-home release must fall at its current location');
  lab.dispose();
  checks.push('an occupied home prevents docking and the released object falls normally');
}

{
  const { lab, mesh, events, advance } = await setup();
  lab.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(.01, 1, 1).setTranslation(.2, 1, 0));
  advance(1 / 60);
  assert.equal(lab.getGrabState().canDock, true, 'home itself is clear');
  lab.endGrab();
  let minimumX = mesh.position.x;
  for (let i = 0; i < 150; i++) { lab.step(1 / 60); minimumX = Math.min(minimumX, mesh.position.x); }
  assert.ok(minimumX > .235, `return crossed the intervening wall: ${minimumX}`);
  assert.equal(events.includes('dock'), false);
  assert.equal(lab.getState().objects[0].state, 'assembled');
  assert.ok(mesh.position.y < .1, 'a blocked return must restore gravity after timing out');
  lab.dispose();
  checks.push('a clear home behind a wall cannot pull the object through it and timeout restores gravity');
}

{
  const { lab, mesh, events, advance } = await setup();
  lab.endGrab();
  advance(.05);
  lab.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(.07, .14, .14).setTranslation(0, .7, 0));
  advance(1);
  assert.equal(events.includes('dock'), false);
  assert.equal(lab.getState().objects[0].state, 'assembled');
  assert.ok(mesh.position.y < .1, 'a newly occupied slot must cancel the return and release weight');
  lab.dispose();
  checks.push('a prop entering the home during docking cancels the return without clipping');
}

console.log(JSON.stringify({ passed: true, checks }, null, 2));
