import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { driveGrabbedBody, releaseGrabbedBody } from './physical-drag.js';

const HOME = new THREE.Vector3(-3.42, 1.08, 9.7);
const UP = new THREE.Vector3(0, 1, 0);

/** A repeatable experiment: the restored mechanism can suspend a real loose body. */
export function createFieldSample({ root, world, onEvent = () => {}, saved, onSave = () => {} }) {
  const fixture = new THREE.Group(); fixture.name = 'Unmarked field test stand'; root.add(fixture);
  const metal = new THREE.MeshStandardMaterial({ color: '#4e574f', roughness: .64, metalness: .73 });
  const dark = new THREE.MeshStandardMaterial({ color: '#202b27', roughness: .83, metalness: .2 });
  const jade = new THREE.MeshStandardMaterial({ color: '#497c70', emissive: '#5be3bb', emissiveIntensity: .03, roughness: .4, metalness: .6 });
  const geometries = [], colliders = [], meshes = [];
  function fixed(geometry, material, position, collider) {
    geometries.push(geometry); const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position); mesh.castShadow = true; mesh.receiveShadow = true; fixture.add(mesh); meshes.push(mesh);
    if (collider) colliders.push(world.createCollider(collider.setTranslation(...position.toArray()).setFriction(.9)));
    return mesh;
  }
  fixed(new THREE.CylinderGeometry(.13, .21, .16, 16), metal, HOME.clone().setY(.08), RAPIER.ColliderDesc.cylinder(.08, .21));
  fixed(new THREE.CylinderGeometry(.035, .075, .79, 12), metal, HOME.clone().setY(.535), RAPIER.ColliderDesc.cylinder(.395, .075));
  fixed(new THREE.CylinderGeometry(.21, .19, .035, 32), metal, HOME.clone().setY(.9475), RAPIER.ColliderDesc.cylinder(.0175, .21));
  const ring = fixed(new THREE.TorusGeometry(.17, .006, 6, 40), jade, HOME.clone().setY(.97)); ring.rotation.x = Math.PI / 2;
  const geometry = new THREE.IcosahedronGeometry(.11, 1); geometries.push(geometry);
  const specimen = new THREE.Mesh(geometry, dark); specimen.name = 'Suspended specimen'; specimen.castShadow = true; specimen.receiveShadow = true;
  Object.assign(specimen.userData, { kind: 'mechanism-sample', openingAssembly: true, labObject: 'field-specimen', soundId: 'gem' }); root.add(specimen);
  const valid = Array.isArray(saved?.position) && saved.position.length === 3 && saved.position.every(Number.isFinite)
    && Math.abs(saved.position[0]) < 45 && saved.position[1] >= .06 && saved.position[1] < 30 && saved.position[2] > -165 && saved.position[2] < 13.3;
  specimen.position.copy(valid ? new THREE.Vector3(...saved.position) : HOME);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...specimen.position.toArray()).setLinearDamping(2).setAngularDamping(2.5).setCcdEnabled(true).setCanSleep(true));
  const collider = world.createCollider(RAPIER.ColliderDesc.convexHull(geometry.attributes.position.array).setMass(.22).setFriction(.85).setRestitution(.02), body);
  const scratch = new THREE.Vector3(), rotation = new THREE.Quaternion();
  let held = null, elapsed = 0, lifting = false, wasEnabled = false, saveDelay = 0, lastSaved = specimen.position.clone(), disposed = false;
  function event(type, extra = {}) { onEvent({ type, objectId: 'field-specimen', soundId: 'gem', position: specimen.position.clone(), kind: 'mechanism-sample', ...extra }); }
  function save() { lastSaved.copy(specimen.position); onSave(); }
  function beginGrab(mesh, point, handId) {
    if (disposed || held || mesh !== specimen || !point?.isVector3 || !Number.isFinite(point.x + point.y + point.z)) return false;
    releaseGrabbedBody(body); lifting = false; body.wakeUp();
    held = { handId, goal: specimen.position.clone(), offset: specimen.position.clone().sub(point) };
    event('pickup', { complete: true, whole: true }); return true;
  }
  function moveGrab(point, handId) { if (!held || held.handId !== handId || !point?.isVector3 || !Number.isFinite(point.x + point.y + point.z)) return false; held.goal.copy(point).add(held.offset); held.goal.y = Math.max(.12, held.goal.y); return true; }
  function endGrab(handId, { cancelled = false } = {}) {
    if (!held || held.handId !== handId) return false;
    releaseGrabbedBody(body); held = null; saveDelay = .8; event('enddrag', { reason: cancelled ? 'cancel' : 'release' });
    if (!cancelled) event('drop'); save(); return true;
  }
  function tap(mesh, point, options = {}) {
    if (disposed || held || mesh !== specimen) return false;
    const origin = options.viewerPosition; if (origin && point.distanceTo(origin) > 2.44) return false;
    scratch.copy(specimen.position).sub(origin || HOME.clone().add(new THREE.Vector3(0, 0, 1))).normalize().multiplyScalar(.055); scratch.y += .065;
    body.applyImpulse(scratch, true); event('nudge', { strength: .25 }); saveDelay = 1; return true;
  }
  function step(dt, { completed, activationAge = 100 } = {}) {
    if (disposed) return; elapsed += dt;
    specimen.position.copy(body.translation()); specimen.quaternion.copy(body.rotation());
    if (specimen.position.y < -.5 || Math.abs(specimen.position.x) > 45 || specimen.position.z < -165 || specimen.position.z > 13.4) reset();
    if (held) driveGrabbedBody(world, body, held.goal, null, dt, { maxSpeed: 2.5, acceleration: 20 });
    else {
      const distance = specimen.position.distanceTo(HOME);
      lifting = !!completed && distance < .75;
      if (lifting) {
        const rise = THREE.MathUtils.smoothstep(activationAge, .65, 3.6);
        scratch.copy(HOME).add(new THREE.Vector3(Math.sin(elapsed * .47) * .017, rise * .33 + Math.sin(elapsed * .73) * .012, Math.cos(elapsed * .41) * .017));
        rotation.setFromAxisAngle(UP, elapsed * .16);
        driveGrabbedBody(world, body, scratch, rotation, dt, { maxSpeed: .65, positionGain: 3.2, acceleration: 8 });
      } else releaseGrabbedBody(body);
    }
    jade.emissiveIntensity = completed ? .45 + Math.sin(elapsed * .65) * .08 : .03;
    if (completed && !wasEnabled) saveDelay = 4;
    wasEnabled = !!completed;
    if (saveDelay > 0) { saveDelay -= dt; if (saveDelay <= 0) save(); }
    if (!held && !lifting && body.isSleeping() && specimen.position.distanceToSquared(lastSaved) > .0001) save();
  }
  function reset() {
    if (held) endGrab(held.handId, { cancelled: true }); releaseGrabbedBody(body); lifting = false;
    body.setTranslation(HOME, true); body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    specimen.position.copy(HOME); specimen.quaternion.identity(); saveDelay = 1;
  }
  return {
    targets: [specimen], owns: mesh => mesh === specimen, beginGrab, moveGrab, endGrab, tap, step, reset,
    snapshot: () => ({ position: specimen.position.toArray() }),
    getState: () => ({ active: wasEnabled, levitating: lifting, held: !!held, position: specimen.position.toArray(), home: HOME.toArray() }),
    getGrabState: () => held ? { active: true, handId: held.handId, objectId: 'field-specimen', heldMesh: specimen, anchor: specimen.position.toArray(), goal: held.goal.toArray(), speed: Math.hypot(...Object.values(body.linvel())), kind: 'mechanism-sample', complete: true, whole: true } : { active: false },
    getObstacles: () => meshes.slice(0, 3).map(mesh => new THREE.Box3().setFromObject(mesh)),
    dispose() { if (disposed) return; if (held) endGrab(held.handId, { cancelled: true }); releaseGrabbedBody(body); world.removeRigidBody(body); colliders.forEach(c => world.removeCollider(c, true)); fixture.removeFromParent(); specimen.removeFromParent(); geometries.forEach(g => g.dispose()); [metal, dark, jade].forEach(m => m.dispose()); disposed = true; },
  };
}
