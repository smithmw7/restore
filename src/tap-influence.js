import * as THREE from 'three';

export const BREAK_REACH = 8 * .3048;
const finitePoint = p => p?.isVector3 && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

export function tapInfluence(distance) {
  if (!Number.isFinite(distance) || distance < 0) return { canBreak: false, strength: 0 };
  return { canBreak: distance <= BREAK_REACH, strength: Math.min(1, (BREAK_REACH / Math.max(distance, BREAK_REACH)) ** 2) };
}

// All input types use the current head-to-surface distance. A stored local hit
// follows its object while a short press is pending instead of using stale range.
export function dispatchTap(game, hit, viewerPosition, direction) {
  if (!game || !hit?.object || !finitePoint(viewerPosition) || !finitePoint(hit.point)) return null;
  const point = finitePoint(hit.localPoint) ? hit.object.localToWorld(hit.localPoint.clone()) : hit.point.clone();
  const distance = point.distanceTo(viewerPosition);
  const { canBreak, strength } = tapInfluence(distance);
  if (!strength) return null;
  const success = canBreak ? game.hit(hit.object, point, direction) : game.nudge(hit.object, point, direction, strength);
  return success ? { kind: canBreak ? 'break' : 'nudge', distance, strength } : null;
}

// Give differently sized props a comparable small kick without changing their
// mass, gravity, contact sleep or existing throw velocity. Off-centre taps rock
// the prop naturally. This runs once per tap, never on resting simulation ticks.
export function nudgeBody(body, point, direction, strength) {
  if (!body?.isDynamic() || !finitePoint(point) || !finitePoint(direction) || !Number.isFinite(strength) || strength <= 0 || direction.lengthSq() < 1e-8) return false;
  const push = direction.clone().normalize();
  // A slight upward rock keeps downward aim from only pressing a grounded
  // crate harder into the floor. The total kick still falls off with distance.
  push.y = Math.max(push.y, .25);
  push.normalize();
  const velocity = new THREE.Vector3().copy(body.linvel());
  const deltaSpeed = Math.max(0, Math.min(.85 * Math.min(1, strength), 2.5 - velocity.dot(push)));
  if (!deltaSpeed) return false;
  const beforeSpin = new THREE.Vector3().copy(body.angvel()).length();
  body.applyImpulseAtPoint(push.multiplyScalar(body.mass() * deltaSpeed), point, true);
  const spin = new THREE.Vector3().copy(body.angvel());
  if (spin.length() > Math.max(3, beforeSpin)) body.setAngvel(spin.clampLength(0, Math.max(3, beforeSpin)), true);
  return true;
}
