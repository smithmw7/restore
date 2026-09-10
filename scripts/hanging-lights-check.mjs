import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHangingLights } from '../src/hanging-lights.js';

const checks = [];
const vector = (value) => new THREE.Vector3().fromArray(value);
const check = (name, callback) => {
  try { callback(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  checks.push(name);
};
function create(fixtures = [{ id: 'near-light', x: 0, z: -2, lit: true }]) {
  const parent = new THREE.Group(), events = [];
  const lights = createHangingLights({ parent, fixtures, onEvent: (event) => events.push(event) });
  return { lights, parent, events, mesh: lights.targets[0] };
}
function advance(lights, seconds, fps = 72, inspect) {
  const frames = Math.round(seconds * fps);
  for (let index = 0; index < frames; index++) {
    lights.step(seconds / frames);
    inspect?.(lights.getState(), (index + 1) * seconds / frames);
  }
}
function assertConstraint(light) {
  const distance = vector(light.position).distanceTo(vector(light.anchor));
  assert.ok(Math.abs(distance - light.pendulumLength) < 1e-9, `wire length changed: ${distance}`);
  assert.ok(light.angle <= THREE.MathUtils.degToRad(50) + 1e-9, `unsafe ceiling angle: ${light.angle}`);
  assert.ok(light.position[1] >= light.anchor[1] - light.pendulumLength - 1e-9, 'lamp fell below its fixed wire');
  assert.ok([...light.position, ...light.velocity].every(Number.isFinite), 'non-finite fixture state');
}

check('untouched fixtures remain exactly still and all lamps share four render batches', () => {
  const { lights, parent } = create([
    { x: 0, z: -2, lit: true }, { x: 0, z: -13, lit: true }, { x: 0, z: -26, lit: true },
    ...Array.from({ length: 33 }, (_, index) => ({ x: (index % 3 - 1) * 24, z: -38 - Math.floor(index / 3) * 12 })),
  ]);
  const initial = lights.getState();
  advance(lights, 60);
  assert.deepEqual(lights.getState(), initial, 'idle animation moved an untouched light');
  assert.equal(initial.count, 36);
  assert.equal(initial.realSpotlights, 3);
  assert.equal(initial.renderBatches, 4);
  let batchCount = 0, spotCount = 0;
  parent.traverse((object) => {
    if (object.isInstancedMesh) batchCount++;
    if (object.isSpotLight) { spotCount++; assert.equal(object.castShadow, false); }
  });
  assert.equal(batchCount, 4);
  assert.equal(spotCount, 3);
  lights.dispose();
  assert.equal(parent.children.length, 0);
});

check('hidden rendering proxies still select the visible fixture with a real raycast', () => {
  const { lights, parent, mesh } = create();
  parent.updateMatrixWorld(true);
  const origin = new THREE.Vector3(0, 1.65, 2);
  const ray = new THREE.Raycaster(origin, mesh.position.clone().sub(origin).normalize());
  const hits = ray.intersectObjects(lights.targets, false);
  assert.equal(hits[0]?.object, mesh);
  assert.equal(mesh.userData.kind, 'hanging-light');
  assert.equal(mesh.userData.soundId, 'tablet');
  assert.equal(lights.targets, lights.grabTargets);
  lights.dispose();
});

check('30, 80 and 150 metre underside rays select and pull only the visible lamp', () => {
  for (const distance of [30, 80, 150]) for (const underside of [-.178, -.2]) {
    const { lights, parent, mesh } = create([
      { id: 'target', x: 0, z: -2, lit: true },
      { id: 'left-neighbour', x: -4, z: -2, lit: true },
      { id: 'right-neighbour', x: 4, z: -2, lit: true },
    ]);
    const initial = lights.getState().lights;
    parent.updateMatrixWorld(true);
    const origin = new THREE.Vector3(0, 1.65, mesh.position.z + distance);
    const visiblePoint = mesh.localToWorld(new THREE.Vector3(0, underside, 0));
    const ray = new THREE.Raycaster(origin, visiblePoint.clone().sub(origin).normalize());
    const hits = ray.intersectObjects(lights.targets, false);
    assert.equal(hits.length, 1, `${distance}m underside ray selected an unrelated fixture`);
    assert.equal(hits[0]?.object, mesh, `${distance}m underside ray missed its canonical lamp target`);
    assert.ok(hits[0].distance > distance - 1, 'fixture was selected at an incorrect distance');
    assert.equal(lights.beginGrab(hits[0].object, hits[0].point, 'remote'), true);
    assert.equal(lights.moveGrab(hits[0].point.clone().addScaledVector(ray.ray.direction, -4), 'remote'), true);
    advance(lights, 5, 72, (state) => {
      assertConstraint(state.lights[0]);
      assert.deepEqual(state.lights.slice(1), initial.slice(1), 'remote pull disturbed a neighbouring lamp');
      assert.equal(lights.getGrabState().heldMesh, mesh);
    });
    assert.ok(mesh.position.distanceTo(vector(initial[0].position)) > 1, 'distant underside grab did not pull the lamp');
    assert.equal(lights.endGrab('remote'), true);
    lights.dispose();
  }
});

check('a remote tap shakes only its own lamp and then returns to exact rest', () => {
  const { lights, mesh, events } = create([{ id: 'near', z: -2, lit: true }, { id: 'other', z: -13 }]);
  const original = lights.getState().lights;
  assert.equal(lights.nudge(mesh, mesh.position.clone(), new THREE.Vector3(1, .5, 0), .07), true);
  let largestSwing = 0, firstRest = null;
  advance(lights, 25, 72, (state, seconds) => {
    const light = state.lights[0];
    assertConstraint(light);
    largestSwing = Math.max(largestSwing, vector(light.position).distanceTo(vector(original[0].position)));
    assert.deepEqual(state.lights[1], original[1], 'tap disturbed an unrelated fixture');
    if (light.state === 'resting' && firstRest === null) firstRest = seconds;
  });
  assert.ok(largestSwing > .15 && largestSwing < .3, `remote tap had an unsuitable shake: ${largestSwing}m`);
  assert.ok(firstRest >= 12 && firstRest < 22, `swing did not settle over a lingering interval: ${firstRest}s`);
  assert.deepEqual(lights.getState().lights[0].position, original[0].position);
  assert.deepEqual(lights.getState().lights[0].velocity, [0, 0, 0]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'nudge');
  assert.ok(events[0].strength < .07, 'wired impact audio was not softened');
  lights.dispose();
});

check('distance influence reduces swing and repeated close taps stay bounded', () => {
  const peaks = [.01, .07, 1].map((strength) => {
    const { lights, mesh } = create();
    const initial = mesh.position.clone();
    lights.hit(mesh, mesh.position.clone(), new THREE.Vector3(1, 0, 0), strength);
    let peak = 0;
    advance(lights, 4, 120, (state) => {
      assertConstraint(state.lights[0]);
      peak = Math.max(peak, vector(state.lights[0].position).distanceTo(initial));
    });
    lights.dispose();
    return peak;
  });
  assert.ok(peaks[0] < peaks[1] / 5 && peaks[1] < peaks[2] / 10, `distance failed to weaken taps: ${peaks}`);
  const { lights, mesh } = create();
  for (let frame = 0; frame < 240; frame++) {
    lights.nudge(mesh, mesh.position.clone(), new THREE.Vector3(1, 0, 0), 1);
    lights.step(1 / 120);
    const light = lights.getState().lights[0];
    assertConstraint(light);
    assert.ok(vector(light.velocity).length() <= 4.01, 'repeated taps built unlimited velocity');
  }
  lights.dispose();
});

check('grab ownership is exclusive, pickup is continuous and held motion respects its fixed wire', () => {
  const { lights, mesh, events } = create();
  const initial = mesh.position.clone();
  assert.equal(lights.beginGrab(mesh, initial.clone(), 'left'), true);
  assert.equal(lights.beginGrab(mesh, initial.clone(), 'right'), false);
  assert.equal(lights.moveGrab(new THREE.Vector3(100, 14, 100), 'right'), false);
  assert.equal(lights.endGrab('right'), false);
  assert.deepEqual(mesh.position, initial, 'pickup teleported the light');
  assert.equal(lights.moveGrab(new THREE.Vector3(100, 14, 100), 'left'), true);
  lights.step(1 / 60);
  assert.ok(mesh.position.distanceTo(initial) < .005, 'pull snapped immediately to the hand');
  advance(lights, 10, 72, (state) => assertConstraint(state.lights[0]));
  const state = lights.getGrabState();
  assert.equal(state.kind, 'hanging-light');
  assert.equal(state.heldMesh, mesh);
  assert.equal(state.radius, 0);
  assert.equal(state.whole, true);
  assert.equal(state.complete, false);
  assert.ok(mesh.position.distanceTo(initial) > 8, 'lamp did not follow a sustained pull');
  const beforeRelease = lights.getState().lights[0];
  assert.equal(lights.endGrab('left'), true);
  assert.deepEqual(lights.getState().lights[0].velocity, beforeRelease.velocity, 'release discarded swing momentum');
  assert.equal(lights.getGrabState().active, false);
  advance(lights, 36, 120, (current) => assertConstraint(current.lights[0]));
  assert.equal(lights.getState().lights[0].state, 'resting');
  assert.deepEqual(mesh.position, initial);
  assert.deepEqual(events.map((event) => event.type), ['pickup', 'enddrag'], 'wired release incorrectly played a drop');
  lights.dispose();
});

check('spotlights, shafts and instanced geometry follow the same interpolated pose', () => {
  const { lights, parent, mesh } = create();
  const descriptor = lights.atmosphereLights[0];
  const sourceReference = descriptor.source, targetReference = descriptor.target;
  let spotlight = null, housingBatch = null;
  parent.traverse((object) => {
    if (object.isSpotLight) spotlight = object;
    if (!housingBatch && object.isInstancedMesh) housingBatch = object;
  });
  const originalTarget = descriptor.target.clone();
  lights.nudge(mesh, mesh.position.clone(), new THREE.Vector3(1, 0, 0), .5);
  advance(lights, 2.13, 72, (state) => {
    assertConstraint(state.lights[0]);
    assert.equal(descriptor.source, sourceReference);
    assert.equal(descriptor.target, targetReference);
    assert.ok(descriptor.source.distanceTo(spotlight.position) < 1e-10);
    assert.ok(descriptor.target.distanceTo(spotlight.target.position) < 1e-10);
    assert.ok(Math.abs(descriptor.source.distanceTo(mesh.position) - .19) < 1e-10);
    assert.ok(Math.abs(descriptor.target.y - .2) < 1e-10);
    const matrix = new THREE.Matrix4(); housingBatch.getMatrixAt(0, matrix);
    assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(mesh.position) < 1e-5, 'batched housing lagged behind its target');
  });
  assert.equal(descriptor.moving, true);
  assert.ok(descriptor.target.distanceTo(originalTarget) > 1, 'the moving lamp left its light pool behind');
  lights.dispose();
});

check('30, 72 and 120 Hz produce the same constrained swing over equal time', () => {
  const results = [30, 72, 120].map((fps) => {
    const { lights, mesh } = create();
    lights.nudge(mesh, mesh.position.clone(), new THREE.Vector3(1, .3, .6), .7);
    advance(lights, 4, fps);
    lights.beginGrab(mesh, mesh.position.clone(), 'hand');
    lights.moveGrab(new THREE.Vector3(-8, 12, -9), 'hand');
    advance(lights, 5, fps);
    lights.endGrab('hand');
    advance(lights, 7, fps);
    const result = lights.getState().lights[0];
    lights.dispose();
    return result;
  });
  for (const result of results.slice(1)) {
    assert.ok(vector(result.position).distanceTo(vector(results[0].position)) < 1e-8, 'frame rate changed fixture position');
    assert.ok(vector(result.velocity).distanceTo(vector(results[0].velocity)) < 1e-8, 'frame rate changed swing momentum');
  }
});

check('reset cancels the owner, clears motion and ignores invalid inputs safely', () => {
  const { lights, mesh, events } = create();
  const original = lights.getState();
  const point = mesh.position.clone();
  assert.equal(lights.beginGrab(new THREE.Mesh(), point), false);
  assert.equal(lights.beginGrab(mesh, new THREE.Vector3(NaN, 0, 0)), false);
  assert.equal(lights.nudge(mesh, point, new THREE.Vector3(), .7), false);
  assert.equal(lights.nudge(mesh, point, new THREE.Vector3(1, 0, 0), Infinity), false);
  lights.beginGrab(mesh, point, 'left');
  lights.moveGrab(point.clone().add(new THREE.Vector3(4, 0, 3)), 'left');
  advance(lights, 3);
  lights.reset();
  assert.deepEqual(lights.getState(), original);
  assert.equal(lights.getGrabState().active, false);
  assert.equal(events.at(-1).type, 'enddrag');
  assert.equal(events.at(-1).cancelled, true);
  for (const dt of [-1, NaN, Infinity, 0]) lights.step(dt);
  assert.deepEqual(lights.getState(), original);
  lights.dispose(); lights.dispose();
  assert.equal(lights.beginGrab(mesh, point), false);
  assert.equal(lights.hit(mesh, point, new THREE.Vector3(1, 0, 0)), false);
});

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
