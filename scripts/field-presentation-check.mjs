import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFieldBlueprint } from '../src/opening-assembly.js';
import { createFieldPresentation } from '../src/field-presentation.js';

const root = new THREE.Group(), origin = new THREE.Vector3(-5, 1.13, 8.7);
const parts = createFieldBlueprint().map(p => {
  const mesh = new THREE.Mesh(p.geometry, new THREE.MeshStandardMaterial());
  mesh.position.copy(p.goal); root.add(mesh);
  return { ...p, mesh, installed: false, prepared: true };
});
const seat = new THREE.Mesh(new THREE.TorusGeometry(.74, .018, 5, 32), new THREE.MeshStandardMaterial()); seat.position.copy(origin); seat.rotation.x = Math.PI / 2; root.add(seat);
const presentation = createFieldPresentation({ root, parts, origin, seat });
const before = parts.map(p => ({ id: p.id, position: p.mesh.position.toArray(), quaternion: p.mesh.quaternion.toArray() }));
let geometryCount = 0, materialCount = 0, disposedGeometry = 0, disposedMaterial = 0;
const seenGeometry = new Set(parts.map(p => p.geometry)), seenMaterial = new Set(parts.map(p => p.mesh.material));
seenGeometry.add(seat.geometry); seenMaterial.add(seat.material);
root.traverse(node => {
  if (node.geometry && !seenGeometry.has(node.geometry)) {
    geometryCount++; seenGeometry.add(node.geometry); node.geometry.addEventListener('dispose', () => disposedGeometry++);
    const position = node.geometry.getAttribute('position');
    assert.ok(position?.array.every(Number.isFinite), `${node.name}: positions are finite`);
    assert.ok(node.geometry.getAttribute('normal')?.array.every(Number.isFinite) ?? true, `${node.name}: normals are finite`);
  }
  if (node.material && !seenMaterial.has(node.material)) {
    materialCount++; seenMaterial.add(node.material); node.material.addEventListener('dispose', () => disposedMaterial++);
  }
  if (node.isLight) assert.equal(node.castShadow, false);
});
assert.ok(presentation.getState().decorativeTriangles < 20000, JSON.stringify(presentation.getState()));
assert.equal(presentation.getState().decorativeMeshes, 24);
assert.equal(presentation.getState().connectorVisible, false);
const nearby = origin.clone().add(new THREE.Vector3(0, .55, 1.8));
for (let i = 0; i < 120; i++) presentation.update({ dt: 1 / 60, viewerPosition: nearby });
assert.equal(presentation.getState().connectorInvitation, false, 'Bare hands have no technology invitation');
presentation.update({ dt: 1 / 60, viewerPosition: nearby, gauntletEquipped: true });
const firstInvitationOpacity = presentation.getState().invitationOpacity;
assert.ok(firstInvitationOpacity > 0 && firstInvitationOpacity < .025, 'Invitation eases in instead of blinking');
for (let i = 0; i < 120; i++) presentation.update({ dt: 1 / 60, viewerPosition: nearby, gauntletEquipped: true });
const invitation = presentation.getState();
assert.equal(invitation.connectorInvitation, true); assert.equal(invitation.connectorVisible, true);
assert.ok(invitation.invitationOpacity > .40 && invitation.invitationOpacity <= .42);
assert.ok(seat.material.emissiveIntensity > .28 && seat.material.emissiveIntensity <= .294, 'Actual cradle metal softly answers nearby powered attention');
const cradleMark = new THREE.Vector3().fromArray(invitation.connectorTarget).sub(origin);
assert.ok(Math.abs(Math.hypot(cradleMark.x, cradleMark.z) - .763) < .00001);
assert.ok(Math.abs(cradleMark.y) < .00001, 'Invitation sits on the real cradle ring, not the absent component');
root.updateMatrixWorld(true);
const markerPosition = new THREE.Vector3().fromArray(invitation.connectorTarget);
const ray = new THREE.Raycaster(nearby, markerPosition.clone().sub(nearby).normalize());
const occlusion = ray.intersectObject(seat, false)[0];
assert.ok(!occlusion || occlusion.distance >= nearby.distanceTo(markerPosition) - .001, 'Outer-facing cradle mark is visible from the actual player approach');
presentation.update({ dt: 1 / 60, viewerPosition: nearby.clone().add(new THREE.Vector3(0, 0, 4)), gauntletEquipped: true });
assert.ok(presentation.getState().invitationOpacity < invitation.invitationOpacity && presentation.getState().invitationOpacity > .15, 'Leaving range eases the invitation out');
for (let i = 0; i < 120; i++) presentation.update({ dt: 1 / 60, viewerPosition: nearby.clone().add(new THREE.Vector3(0, 0, 4)), gauntletEquipped: true });
assert.equal(presentation.getState().connectorInvitation, false, 'No long-distance beacon');
assert.ok(seat.material.emissiveIntensity < .001, 'Cradle response fades away at distance');
for (let i = 0; i < 120; i++) presentation.update({ dt: 1 / 60, viewerPosition: nearby, gauntletEquipped: true });
presentation.update({ dt: 1 / 60, viewerPosition: nearby, gauntletEquipped: true, heldId: 'strut-0', eligible: false });
assert.equal(presentation.getState().connectorVisible, false, 'Holding an unsupported part cannot suggest a false fit');
assert.equal(seat.material.emissiveIntensity, 0);
const firstFrame = parts.find(p => p.id === 'frame-0-0'); firstFrame.installed = true;
const strut = parts.find(p => p.id === 'strut-0'); strut.mesh.position.x += .24;
presentation.update({ dt: .016, heldId: strut.id, eligible: true, separation: .24, alignment: .8, signal: .75, stage: 0 });
const keyState = presentation.getState();
assert.equal(keyState.connectorVisible, true); assert.equal(keyState.connectorInvitation, false, 'Physical alignment replaces the invitation');
assert.ok(Math.abs(keyState.connectorDistance - .24) < .00001);
assert.ok(new THREE.Vector3().fromArray(keyState.connectorTarget).distanceTo(strut.goal) < .45, 'Marker remains on a local connector, not an entire hull');
presentation.update({ heldId: strut.id, eligible: false, signal: 1, stage: 0 });
assert.equal(presentation.getState().connectorVisible, false, 'Unsupported pieces have no false target');
strut.mesh.position.copy(strut.goal);
const stageEnergy = [];
for (let stage = 0; stage <= 4; stage++) {
  if (stage >= 2) parts.filter(p => p.id.startsWith('frame-0')).forEach(p => p.installed = true);
  if (stage >= 3) parts.find(p => p.id === 'core').installed = true;
  if (stage === 4) parts.forEach(p => p.installed = true);
  for (let i = 0; i < 180; i++) presentation.update({ dt: 1 / 60, elapsed: i / 60, stage, stageAge: 100, completed: stage === 4, activationAge: 100 });
  stageEnergy.push(presentation.getState().energy);
}
assert.ok(stageEnergy[0] === 0 && stageEnergy[1] === 0 && stageEnergy[2] > 0 && stageEnergy[3] > stageEnergy[2] && stageEnergy[4] > stageEnergy[3]);
for (let i = 0; i < 120; i++) presentation.update({ dt: 1 / 60, elapsed: i / 60, stage: 4, stageAge: i / 60, completed: true, activationAge: i / 60 });
const surgeEnergy = presentation.getState().energy;
assert.ok(surgeEnergy > stageEnergy[4] * 2, 'Fresh awakening has a controlled buildup');
for (let i = 0; i < 400; i++) presentation.update({ dt: 1 / 60, elapsed: i / 60, stage: 4, stageAge: 8, completed: true, activationAge: 8 });
assert.ok(presentation.getState().energy < .3, 'Awakening settles to quiet field');
root.updateMatrixWorld(true);
root.traverse(node => { assert.ok(node.matrixWorld.elements.every(Number.isFinite), `${node.name}: matrix remains finite`); });
assert.deepEqual(parts.map(p => ({ id: p.id, position: p.mesh.position.toArray(), quaternion: p.mesh.quaternion.toArray() })), before, 'Cosmetics never move the rigid-body visual boundary');
presentation.dispose(); presentation.dispose();
assert.equal(disposedGeometry, geometryCount); assert.equal(disposedMaterial, materialCount);
assert.ok(parts.every(p => p.mesh.children.length === 0));
assert.equal(root.children.length, 25);
console.log(JSON.stringify({ passed: true, decorativeTriangles: keyState.decorativeTriangles, detailDrawCalls: keyState.decorativeMeshes, maximumEffectDrawCalls: 5, pooledParticles: keyState.pooledParticles, stageEnergy: stageEnergy.map(x => Number(x.toFixed(3))), surgeEnergy: Number(surgeEnergy.toFixed(3)), disposedGeometry, disposedMaterial }, null, 2));
