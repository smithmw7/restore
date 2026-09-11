import * as THREE from 'three';

export const OFFICE_WHEEL_STEP = Math.PI * 2 / 10;
export const OFFICE_WHEEL_TRAVEL = .0475 * OFFICE_WHEEL_STEP;
const digit = value => ((Math.round(value) % 10) + 10) % 10;
const validPoint = point => point?.isVector3 && Number.isFinite(point.x + point.y + point.z);

/** A fixed drum can turn continuously without entering the physical prop grab path. */
export function createOfficeWheelDrag({ digits = [0, 0, 0, 0], onCommit = () => {}, onDetent = () => {} } = {}) {
  const positions = Array.from({ length: 4 }, (_, index) => digit(Number.isFinite(digits[index]) ? digits[index] : 0));
  const targets = [...positions];
  let drag = null;
  const settled = () => !drag && positions.every((position, index) => Math.abs(position - targets[index]) < .002);
  function commit(index, target) {
    targets[index] = target;
    onCommit(index, digit(target));
  }
  function begin(index, mesh, point, handId = 'pointer', options = {}) {
    if (drag || !Number.isInteger(index) || index < 0 || index > 3 || !mesh?.isObject3D || !validPoint(point)) return false;
    // The proxy cylinder has its own rotated local axes. Use the case's tangent,
    // supplied by the caller, rather than deriving it from the proxy rotation.
    const axis = validPoint(options.axisWorld) ? options.axisWorld.clone() : new THREE.Vector3(0, 1, 0);
    if (axis.lengthSq() < .0001) return false;
    axis.normalize();
    drag = { index, mesh, handId, startPoint: point.clone(), point: point.clone(), axis,
      startValue: positions[index], startTarget: targets[index], moved: false, lastDetent: Math.round(positions[index]),
      travel: Number.isFinite(options.worldPerDetent) && options.worldPerDetent > .001 ? options.worldPerDetent : OFFICE_WHEEL_TRAVEL };
    return true;
  }
  function move(point, handId = 'pointer') {
    if (!drag || drag.handId !== handId || !validPoint(point)) return false;
    drag.point.copy(point);
    const distance = point.clone().sub(drag.startPoint).dot(drag.axis);
    drag.moved ||= Math.abs(distance) > Math.min(.003, drag.travel * .12);
    positions[drag.index] = drag.startValue + THREE.MathUtils.clamp(distance / drag.travel, -1000, 1000);
    const next = Math.round(positions[drag.index]);
    if (next !== drag.lastDetent) { drag.lastDetent = next; onDetent(drag.index); }
    return true;
  }
  function end(handId = 'pointer', { cancelled = false } = {}) {
    if (!drag || drag.handId !== handId) return false;
    const previous = drag; drag = null;
    const tap = !cancelled && !previous.moved;
    commit(previous.index, tap ? previous.startTarget + 1 : Math.round(positions[previous.index]));
    if (tap) onDetent(previous.index);
    return true;
  }
  function tap(index, direction = 1) {
    if (drag || !Number.isInteger(index) || index < 0 || index > 3) return false;
    // Advance the destination, so quick successive taps are never swallowed
    // while the preceding detent is still easing into place.
    commit(index, targets[index] + (direction === -1 ? -1 : 1));
    onDetent(index); return true;
  }
  function step(dt = 1 / 60) {
    const blend = 1 - Math.exp(-18 * THREE.MathUtils.clamp(dt, 0, .05));
    positions.forEach((position, index) => {
      if (drag?.index === index) return;
      positions[index] += (targets[index] - position) * blend;
      if (Math.abs(positions[index] - targets[index]) < .0001) positions[index] = targets[index];
    });
  }
  function reset(next = [0, 0, 0, 0]) {
    drag = null;
    positions.forEach((_, index) => { positions[index] = targets[index] = digit(Number.isFinite(next[index]) ? next[index] : 0); });
  }
  function getState() {
    return { positions: [...positions], targets: [...targets], digits: positions.map(digit), settled: settled(),
      dragging: drag ? { index: drag.index, handId: drag.handId, moved: drag.moved, worldPerDetent: drag.travel, axis: drag.axis.toArray() } : null };
  }
  function getGrabState() {
    if (!drag) return { active: false, handId: null, objectId: null, heldMesh: null, anchor: null, radius: 0, speed: 0, goal: null, canDock: false };
    return { active: true, handId: drag.handId, objectId: `wheel-${drag.index}`, heldMesh: drag.mesh,
      anchor: drag.mesh.getWorldPosition(new THREE.Vector3()).toArray(), goal: drag.point.toArray(), radius: 0, speed: 0,
      canDock: false, constrained: true, kind: 'opening-wheel', soundId: 'tablet', whole: true, complete: true, assembled: 1, total: 1 };
  }
  return { begin, move, end, tap, step, reset, getState, getGrabState };
}
