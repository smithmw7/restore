import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOfficeWheelDrag, OFFICE_WHEEL_TRAVEL } from '../src/office-wheel-drag.js';

const commits = [], detents = [], mesh = new THREE.Object3D();
const wheel = createOfficeWheelDrag({ onCommit: (index, value) => commits.push([index, value]), onDetent: index => detents.push(index) });
const at = steps => new THREE.Vector3(0, OFFICE_WHEEL_TRAVEL * steps, 0);
const settle = () => { for (let frame = 0; frame < 60; frame++) wheel.step(1 / 60); };
const checks = [];
const pass = name => { checks.push(name); console.log(`PASS: ${name}`); };

assert.equal(wheel.begin(0, mesh, at(0)), true);
assert.equal(wheel.getGrabState().constrained, true);
assert.equal(wheel.begin(1, mesh, at(0), 'xr-left'), false);
assert.equal(wheel.move(at(1.38), 'xr-left'), false);
assert.equal(wheel.end('xr-left'), false);
wheel.move(at(1.38));
assert.ok(Math.abs(wheel.getState().positions[0] - 1.38) < 1e-8);
assert.equal(commits.length, 0);
assert.equal(wheel.getState().settled, false);
wheel.end(); assert.deepEqual(commits.at(-1), [0, 1]);
assert.equal(wheel.getState().settled, false);
settle(); assert.equal(wheel.getState().positions[0], 1);
assert.equal(wheel.getState().settled, true);
pass('continuous travel, nearest detent easing, and exclusive hand ownership');

wheel.reset(); wheel.begin(1, mesh, at(0), 'xr-left'); wheel.move(at(-1.1), 'xr-left'); wheel.end('xr-left'); settle();
assert.equal(wheel.getState().positions[1], -1); assert.equal(wheel.getState().digits[1], 9);
assert.deepEqual(commits.at(-1), [1, 9]);
wheel.tap(1); settle(); assert.equal(wheel.getState().digits[1], 0);
pass('backward 0 to 9 wrap and forward 9 to 0 wrap');

wheel.reset(); wheel.begin(0, mesh, at(0)); wheel.end(); settle();
assert.equal(wheel.getState().digits[0], 1);
wheel.begin(0, mesh, at(0)); wheel.end('pointer', { cancelled: true }); settle();
assert.equal(wheel.getState().digits[0], 1);
wheel.begin(0, mesh, at(0)); wheel.move(at(1.7)); wheel.end('pointer', { cancelled: true }); settle();
assert.equal(wheel.getState().digits[0], 3);
pass('short tap advances once while cancellation only settles the current drum');

wheel.reset(); for (let tap = 0; tap < 12; tap++) wheel.tap(3);
assert.equal(wheel.getState().targets[3], 12); settle(); assert.equal(wheel.getState().digits[3], 2);
wheel.reset(); for (let tap = 0; tap < 12; tap++) { wheel.begin(3, mesh, at(0)); wheel.end(); }
assert.equal(wheel.getState().targets[3], 12); settle(); assert.equal(wheel.getState().digits[3], 2);
pass('rapid taps accumulate across a complete revolution');

wheel.reset([1, 9, 4, 2]); assert.deepEqual(wheel.getState().digits, [1, 9, 4, 2]); assert.equal(wheel.getState().settled, true);
wheel.begin(2, mesh, at(0)); wheel.move(at(3)); wheel.reset([1, 9, 4, 2]);
assert.equal(wheel.getGrabState().active, false); assert.deepEqual(wheel.getState().positions, [1, 9, 4, 2]);
pass('restored combinations and reset cancel stale gestures');

wheel.reset(); wheel.begin(0, mesh, at(0), 'pointer', { axisWorld: new THREE.Vector3(1, 0, 0), worldPerDetent: .04 });
wheel.move(new THREE.Vector3(.1, .4, 0)); assert.equal(wheel.getState().positions[0], 2.5);
wheel.end(); settle(); assert.equal(wheel.getState().digits[0], 3);
assert.equal(wheel.begin(9, mesh, at(0)), false);
assert.equal(wheel.begin(0, mesh, new THREE.Vector3(NaN, 0, 0)), false);
assert.equal(wheel.begin(0, mesh, at(0), 'pointer', { axisWorld: new THREE.Vector3() }), false);
assert.ok(detents.length > 0);
pass('world-space tangent supports reoriented cases and rejects invalid input');

console.log(JSON.stringify({ passed: true, checks: checks.length }));
