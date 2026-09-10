import * as THREE from 'three';

// Audio metadata follows the actual collider wrapper and expires with it.
// No additional bodies, proximity queries or collision events are required.
const surfaces = new WeakMap();
export function setContactSurface(collider, surface) {
  surfaces.set(collider, surface);
  return collider;
}

/** Read rubbing at physical contact points, including rotational motion. */
export function createContactAudioProbe(world) {
  const normal = new THREE.Vector3(), relative = new THREE.Vector3();
  return function read(body, goal, result = {}) {
    result.surface = null;
    result.scrapeSpeed = 0;
    result.load = 0;
    result.contact = false;
    if (!body?.isDynamic()) return result;
    let bestScore = -1;
    for (let index = 0; index < body.numColliders(); index++) {
      const collider = body.collider(index);
      world.contactPairsWith(collider, other => {
        if (other.isSensor() || other.parent()?.handle === body.handle) return;
        // Persistent Rapier manifolds may retain their original speculative
        // distance after the bodies have settled. Check current shapes once
        // per pair, then use the manifold's contact points for surface motion.
        if (!collider.contactCollider(other, .006)) return;
        result.contact = true;
        world.contactPair(collider, other, manifold => {
          const otherBody = other.parent();
          const surface = surfaces.get(other) || null;
          normal.copy(manifold.normal()).normalize();
          for (let contact = 0; contact < manifold.numSolverContacts(); contact++) {
            const point = manifold.solverContactPoint(contact);
            relative.copy(body.velocityAtPoint(point));
            if (otherBody) relative.sub(otherBody.velocityAtPoint(point));
            relative.addScaledVector(normal, -relative.dot(normal));
            const speed = relative.length();
            // Prefer a rubbing wood face over the floor at a corner tie.
            const score = speed * (surface === 'wood' ? 1.05 : 1);
            if (surface && score > bestScore) {
              bestScore = score;
              result.surface = surface;
              result.scrapeSpeed = speed;
            }
          }
        });
      });
    }
    if (result.contact && goal) {
      const blocked = relative.copy(goal).sub(body.translation()).length();
      result.load = THREE.MathUtils.clamp(blocked / .6, 0, 1)
        * THREE.MathUtils.clamp(Math.sqrt(body.mass() / 12), .25, 1);
    }
    return result;
  };
}
