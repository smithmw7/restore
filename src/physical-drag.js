import * as THREE from 'three';

const controlledBodies = new WeakMap();
const desired = new THREE.Vector3();
const normal = new THREE.Vector3();
const acceleration = new THREE.Vector3();
const angular = new THREE.Vector3();
const torque = new THREE.Vector3();
const rotationError = new THREE.Quaternion();
const rotation = new THREE.Quaternion();

/** Pull with finite force. The solver, not the hand target, owns the pose. */
export function driveGrabbedBody(world, body, goal, targetQuaternion, dt, {
  maxSpeed = 3, positionGain = 8, acceleration: maxAcceleration = 22,
} = {}) {
  if (!body?.isDynamic() || !(dt > 0) || !Number.isFinite(goal.x + goal.y + goal.z)) return;
  const mass = body.mass();
  if (!(mass > 0)) return;
  if (!controlledBodies.has(body)) {
    controlledBodies.set(body, { gravity: body.gravityScale(), softCcd: body.softCcdPrediction() });
    // The hand supports the held weight, but the body retains its real mass
    // and inertia in every collision. Restore gravity as soon as pulling ends.
    body.setGravityScale(0, true);
    body.setSoftCcdPrediction(Math.max(0.08, body.softCcdPrediction()));
  }

  desired.copy(goal).sub(body.translation()).multiplyScalar(positionGain);
  for (let index = 0; index < body.numColliders(); index++) {
    const collider = body.collider(index);
    world.contactPairsWith(collider, (other) => {
      if (other.isSensor() || other.parent()?.handle === body.handle) return;
      world.contactPair(collider, other, (manifold, flipped) => {
        const count = manifold.numSolverContacts();
        if (!count) return;
        let nearest = Infinity;
        for (let contact = 0; contact < count; contact++) nearest = Math.min(nearest, manifold.solverContactDist(contact));
        if (nearest > 0.01) return;
        normal.copy(manifold.normal()).multiplyScalar(flipped ? -1 : 1);
        const otherBody = other.parent();
        const velocity = otherBody?.isDynamic() ? otherBody.linvel() : null;
        const pressure = velocity ? 0.25 + Math.max(0, velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z) : 0;
        const inward = desired.dot(normal);
        if (inward > pressure) desired.addScaledVector(normal, pressure - inward);
      });
    });
  }
  // Project before capping, so a target far behind a wall cannot drown out
  // tangential movement. A little inward pressure gives dynamic props a push.
  desired.clampLength(0, maxSpeed);
  acceleration.copy(desired).sub(body.linvel()).multiplyScalar(12).clampLength(0, maxAcceleration);
  body.applyImpulse(acceleration.multiplyScalar(mass * dt), true);

  if (!targetQuaternion) return;
  rotation.copy(body.rotation()).invert();
  rotationError.copy(targetQuaternion).multiply(rotation).normalize();
  if (rotationError.w < 0) rotationError.set(-rotationError.x, -rotationError.y, -rotationError.z, -rotationError.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(rotationError.w, -1, 1));
  angular.set(rotationError.x, rotationError.y, rotationError.z).normalize()
    .multiplyScalar(Math.min(3, angle * 6)).sub(body.angvel()).multiplyScalar(10).clampLength(0, 20);
  const inertia = body.effectiveAngularInertia();
  torque.set(
    inertia.m11 * angular.x + inertia.m12 * angular.y + inertia.m13 * angular.z,
    inertia.m12 * angular.x + inertia.m22 * angular.y + inertia.m23 * angular.z,
    inertia.m13 * angular.x + inertia.m23 * angular.y + inertia.m33 * angular.z,
  ).multiplyScalar(dt);
  body.applyTorqueImpulse(torque, true);
}

/** Stop supporting the body without manufacturing a release velocity. */
export function releaseGrabbedBody(body) {
  const previous = controlledBodies.get(body);
  if (!previous) return;
  body.setGravityScale(previous.gravity, true);
  body.setSoftCcdPrediction(previous.softCcd);
  controlledBodies.delete(body);
}
