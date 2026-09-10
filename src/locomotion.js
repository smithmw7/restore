import * as THREE from 'three';

export const SNAP_TURN_RADIANS = Math.PI / 6;
export const TELEPORT_CLEARANCE = 0.3;
const FLOOR_Y = 0;
const STANDING_CLEARANCE = 1.75;
const ARC_SEGMENTS = 64;
const ARC_STEP = 0.035;
const ARC_SPEED = 6.2;
const ARC_GRAVITY = 9.81;
const VALID_COLOR = 0xa6d8c9;
const INVALID_COLOR = 0xc88662;
const EMPTY_OBSTACLES = [];

// Conventional Quest controller mapping: forward stick aims, neutral confirms,
// stick click cancels, horizontal flick snaps the view 30 degrees. The same
// aiming API accepts a hand-pinch gesture from the application input layer.
// https://developers.meta.com/horizon/design/locomotion-input-maps/
export function createLocomotion({
  scene,
  rig,
  camera,
  renderer,
  bounds = { minX: -12, maxX: 12, minZ: -27, maxZ: 7 },
  getObstacles = () => EMPTY_OBSTACLES,
  onBeforeMove = () => {},
}) {
  const positions = new Float32Array((ARC_SEGMENTS + 1) * 3);
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  arcGeometry.setDrawRange(0, 0);
  const arcMaterial = new THREE.LineBasicMaterial({
    color: VALID_COLOR, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false,
  });
  const arc = new THREE.Line(arcGeometry, arcMaterial);
  arc.name = 'teleport-arc';
  arc.visible = false;
  arc.frustumCulled = false;
  const reticleGeometry = new THREE.RingGeometry(0.24, 0.275, 48);
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: VALID_COLOR, transparent: true, opacity: 0.78, side: THREE.DoubleSide,
    depthWrite: false, toneMapped: false,
  });
  const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
  reticle.name = 'teleport-destination';
  reticle.rotation.x = -Math.PI / 2;
  reticle.visible = false;
  scene.add(arc, reticle);

  const inputStates = new Map();
  const head = new THREE.Vector3();
  const beforeHead = new THREE.Vector3();
  const afterHead = new THREE.Vector3();
  const rigWorld = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const candidate = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const next = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const segmentDirection = new THREE.Vector3();
  const segmentIntersection = new THREE.Vector3();
  const blockedPoint = new THREE.Vector3();
  const aimTarget = new THREE.Vector3();
  const aimOrigin = new THREE.Vector3();
  const headLocal = new THREE.Vector3();
  const scratchBox = new THREE.Box3();
  const ray = new THREE.Ray();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let aimInput = null;
  let aimMode = null;
  let aimValid = false;
  let floorHit = false;
  let disposed = false;
  let teleportCount = 0;
  let turnCount = 0;
  let lastMove = null;
  let requireNeutralOnNewInput = false;

  function inputKey(input) {
    return input.id ?? input.controller?.uuid ?? input;
  }

  function stateFor(input) {
    const key = inputKey(input);
    let state = inputStates.get(key);
    if (!state) {
      state = { stick: requireNeutralOnNewInput ? 'latched' : 'idle', turnReady: !requireNeutralOnNewInput };
      inputStates.set(key, state);
    }
    return state;
  }

  function headPosition(out) {
    rig.updateWorldMatrix(true, false);
    // WebXRManager updates each eye's reference-space pose before the animation
    // callback, but updates camera.matrixWorld at render time. Reading the eye
    // poses directly avoids a stale head pivot after a turn or a physical step.
    const xrCamera = renderer?.xr?.isPresenting ? renderer.xr.getCamera?.() : null;
    if (xrCamera?.cameras?.length) {
      headLocal.set(0, 0, 0);
      for (const eye of xrCamera.cameras) headLocal.add(eye.position);
      headLocal.multiplyScalar(1 / xrCamera.cameras.length);
      return out.copy(headLocal).applyMatrix4(rig.matrixWorld);
    }
    return camera.getWorldPosition(out);
  }

  function worldTranslate(delta) {
    rig.getWorldPosition(rigWorld).add(delta);
    if (rig.parent) rig.parent.worldToLocal(rigWorld);
    rig.position.copy(rigWorld);
    rig.updateWorldMatrix(true, true);
  }

  function roomContains(point, clearance = 0) {
    const minX = bounds.isBox3 ? bounds.min.x : bounds.minX;
    const maxX = bounds.isBox3 ? bounds.max.x : bounds.maxX;
    const minZ = bounds.isBox3 ? bounds.min.z : bounds.minZ;
    const maxZ = bounds.isBox3 ? bounds.max.z : bounds.maxZ;
    return point.x >= minX + clearance && point.x <= maxX - clearance
      && point.z >= minZ + clearance && point.z <= maxZ - clearance;
  }

  function obstacleBox(obstacle) {
    if (!obstacle || obstacle.enabled === false) return null;
    if (obstacle.isBox3) return obstacle;
    if (obstacle.box?.isBox3) return obstacle.box;
    if (obstacle.bounds?.isBox3) return obstacle.bounds;
    if (obstacle.isObject3D && obstacle.visible !== false) return scratchBox.setFromObject(obstacle);
    return null;
  }

  function validWithObstacles(point, obstacles) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
      || !roomContains(point, TELEPORT_CLEARANCE)) return false;
    for (const obstacle of obstacles) {
      const box = obstacleBox(obstacle);
      if (!box || box.isEmpty() || box.max.y < FLOOR_Y + 0.06 || box.min.y > FLOOR_Y + STANDING_CLEARANCE) continue;
      const nearestX = THREE.MathUtils.clamp(point.x, box.min.x, box.max.x);
      const nearestZ = THREE.MathUtils.clamp(point.z, box.min.z, box.max.z);
      const dx = point.x - nearestX;
      const dz = point.z - nearestZ;
      if (dx * dx + dz * dz < TELEPORT_CLEARANCE * TELEPORT_CLEARANCE) return false;
    }
    return true;
  }

  function isValidPosition(point) {
    return !disposed && validWithObstacles(point, getObstacles() ?? EMPTY_OBSTACLES);
  }

  function clearAim() {
    aimInput = null;
    aimMode = null;
    aimValid = false;
    floorHit = false;
    arc.visible = false;
    reticle.visible = false;
  }

  function finitePose(input) {
    const elements = input?.controller?.matrixWorld?.elements;
    return elements && elements.every(Number.isFinite);
  }

  function segmentBlock(a, b, obstacles, out) {
    segmentDirection.subVectors(b, a);
    const length = segmentDirection.length();
    if (length < 1e-7) return false;
    segmentDirection.multiplyScalar(1 / length);
    ray.set(a, segmentDirection);
    let nearest = length + 1;
    for (const obstacle of obstacles) {
      const box = obstacleBox(obstacle);
      if (!box || box.isEmpty()) continue;
      if (box.containsPoint(a)) {
        nearest = 0;
        out.copy(a);
        break;
      }
      if (ray.intersectBox(box, segmentIntersection)) {
        const distance = segmentIntersection.distanceTo(a);
        if (distance <= length && distance < nearest) {
          nearest = distance;
          out.copy(segmentIntersection);
        }
      }
    }
    if (!roomContains(b)) {
      // Treat room limits as full-height walls, even if the drawn arc could
      // otherwise pass over a low decorative wall mesh.
      const minX = bounds.isBox3 ? bounds.min.x : bounds.minX;
      const maxX = bounds.isBox3 ? bounds.max.x : bounds.maxX;
      const minZ = bounds.isBox3 ? bounds.min.z : bounds.minZ;
      const maxZ = bounds.isBox3 ? bounds.max.z : bounds.maxZ;
      let fraction = 1;
      if (b.x < minX) fraction = Math.min(fraction, (minX - a.x) / (b.x - a.x));
      if (b.x > maxX) fraction = Math.min(fraction, (maxX - a.x) / (b.x - a.x));
      if (b.z < minZ) fraction = Math.min(fraction, (minZ - a.z) / (b.z - a.z));
      if (b.z > maxZ) fraction = Math.min(fraction, (maxZ - a.z) / (b.z - a.z));
      const distance = Math.max(0, fraction) * length;
      if (distance < nearest) {
        nearest = distance;
        out.copy(a).addScaledVector(segmentDirection, distance);
      }
    }
    return nearest <= length;
  }

  function writePoint(index, point) {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
  }

  function updateArc() {
    if (!aimInput || disposed) return;
    aimInput.controller.updateWorldMatrix(true, false);
    if (!finitePose(aimInput)) {
      clearAim();
      return;
    }
    origin.setFromMatrixPosition(aimInput.controller.matrixWorld);
    direction.set(0, 0, -1).transformDirection(aimInput.controller.matrixWorld);
    velocity.copy(direction).multiplyScalar(ARC_SPEED);
    aimOrigin.copy(origin);
    previous.copy(origin);
    aimValid = false;
    floorHit = false;
    const obstacles = getObstacles() ?? EMPTY_OBSTACLES;
    let pointCount = 1;
    writePoint(0, previous);
    for (let index = 1; index <= ARC_SEGMENTS; index++) {
      const time = index * ARC_STEP;
      next.copy(origin).addScaledVector(velocity, time);
      next.y -= 0.5 * ARC_GRAVITY * time * time;
      const meetsFloor = next.y <= FLOOR_Y && previous.y >= FLOOR_Y;
      if (meetsFloor) {
        const fraction = (previous.y - FLOOR_Y) / (previous.y - next.y);
        next.lerpVectors(previous, next, fraction);
        next.y = FLOOR_Y;
      }
      if (segmentBlock(previous, next, obstacles, blockedPoint)) {
        writePoint(index, blockedPoint);
        pointCount++;
        break;
      }
      writePoint(index, next);
      pointCount++;
      if (meetsFloor) {
        aimTarget.copy(next);
        floorHit = true;
        aimValid = validWithObstacles(aimTarget, obstacles);
        break;
      }
      if (next.y < FLOOR_Y) break;
      previous.copy(next);
    }
    arcGeometry.setDrawRange(0, pointCount);
    arcGeometry.attributes.position.needsUpdate = true;
    arcMaterial.color.setHex(aimValid ? VALID_COLOR : INVALID_COLOR);
    arc.visible = true;
    reticle.visible = floorHit;
    if (floorHit) {
      reticle.position.copy(aimTarget);
      reticle.position.y = FLOOR_Y + 0.012;
      reticleMaterial.color.setHex(aimValid ? VALID_COLOR : INVALID_COLOR);
    }
  }

  function beginAim(input) {
    if (disposed || !input?.controller || input.grabbing || input.pending || (aimInput && aimInput !== input)) return false;
    stateFor(input);
    aimInput = input;
    aimMode = 'manual';
    updateArc();
    return aimInput === input;
  }

  function teleportTo(worldPoint) {
    if (!isValidPosition(worldPoint)) return false;
    headPosition(beforeHead);
    movement.set(worldPoint.x - beforeHead.x, 0, worldPoint.z - beforeHead.z);
    if (movement.lengthSq() < 0.0025) return false;
    onBeforeMove('teleport');
    worldTranslate(movement);
    teleportCount++;
    lastMove = 'teleport';
    return true;
  }

  function endAim(input, commit = true) {
    if (!aimInput || aimInput !== input) return false;
    if (commit) updateArc();
    const canCommit = commit && aimValid && aimInput === input;
    if (canCommit) candidate.copy(aimTarget);
    clearAim();
    return canCommit ? teleportTo(candidate) : false;
  }

  function turn(sign) {
    if (disposed || !Number.isFinite(sign) || sign === 0) return false;
    if (aimInput) stateFor(aimInput).stick = 'latched';
    clearAim();
    onBeforeMove('turn');
    headPosition(beforeHead);
    rotation.setFromAxisAngle(up, -Math.sign(sign) * SNAP_TURN_RADIANS);
    rig.quaternion.premultiply(rotation);
    rig.updateWorldMatrix(true, true);
    headPosition(afterHead);
    movement.set(beforeHead.x - afterHead.x, 0, beforeHead.z - afterHead.z);
    worldTranslate(movement);
    turnCount++;
    lastMove = 'turn';
    return true;
  }

  function update(dt, inputs) {
    if (disposed) return;
    if (aimInput && (!inputs.includes(aimInput) || !aimInput.source
      || aimInput.controller.visible === false || aimInput.grabbing || aimInput.pending)) {
      stateFor(aimInput).stick = 'latched';
      clearAim();
    }
    for (const input of inputs) {
      const state = stateFor(input);
      const gamepad = input.source?.gamepad;
      if (!gamepad || input.source?.hand || input.controller?.visible === false) continue;
      const axes = gamepad.axes;
      if (!axes || axes.length < 2) continue;
      const axisOffset = axes.length >= 4 ? 2 : 0;
      const x = Number.isFinite(axes[axisOffset]) ? axes[axisOffset] : 0;
      const y = Number.isFinite(axes[axisOffset + 1]) ? axes[axisOffset + 1] : 0;
      const neutral = Math.abs(x) < 0.25 && Math.abs(y) < 0.25;
      if (input.grabbing || input.pending) {
        state.stick = neutral ? 'idle' : 'latched';
        state.turnReady = neutral;
        continue;
      }
      if (neutral) {
        if (aimInput === input && aimMode === 'stick') endAim(input, true);
        state.stick = 'idle';
        state.turnReady = true;
        continue;
      }
      if (aimInput === input && aimMode === 'stick') {
        if (gamepad.buttons?.[3]?.pressed || y > 0.5) {
          endAim(input, false);
          state.stick = 'latched';
        }
        continue;
      }
      if (state.stick === 'latched' || aimInput) continue;
      if (y < -0.65 && Math.abs(x) < 0.55) {
        if (beginAim(input)) {
          aimMode = 'stick';
          state.stick = 'aiming';
          state.turnReady = false;
        }
      } else if (Math.abs(x) > 0.7 && Math.abs(y) < 0.55 && state.turnReady) {
        turn(x);
        state.turnReady = false;
        state.stick = 'latched';
      }
    }
    if (aimInput) updateArc();
  }

  function moveDesktop(delta) {
    if (disposed || !Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return false;
    const distance = Math.hypot(delta.x, delta.z);
    if (distance < 1e-7) return false;
    headPosition(head);
    const steps = Math.max(1, Math.ceil(distance / (TELEPORT_CLEARANCE * 0.5)));
    const obstacles = getObstacles() ?? EMPTY_OBSTACLES;
    movement.set(0, 0, 0);
    for (let index = 0; index < steps; index++) {
      candidate.copy(head).add(movement);
      candidate.x += delta.x / steps;
      candidate.z += delta.z / steps;
      if (!validWithObstacles(candidate, obstacles)) break;
      movement.x += delta.x / steps;
      movement.z += delta.z / steps;
    }
    if (movement.lengthSq() < 1e-12) return false;
    onBeforeMove('walk');
    worldTranslate(movement);
    lastMove = 'walk';
    return true;
  }

  function reset() {
    clearAim();
    requireNeutralOnNewInput = true;
    // Require neutral after menu/focus/session loss so a still-held stick cannot
    // restart a teleport or turn as soon as the scene becomes visible again.
    for (const state of inputStates.values()) {
      state.stick = 'latched';
      state.turnReady = false;
    }
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    inputStates.clear();
    scene.remove(arc, reticle);
    arcGeometry.dispose();
    arcMaterial.dispose();
    reticleGeometry.dispose();
    reticleMaterial.dispose();
  }

  return {
    update, beginAim, endAim, turn, teleportTo, moveDesktop, isValidPosition, reset, dispose,
    isAiming: (input) => input ? aimInput === input : aimInput !== null,
    getAimTarget: () => aimInput && aimValid ? aimTarget.clone() : null,
    getState: () => ({
      aiming: aimInput !== null,
      inputId: aimInput ? String(inputKey(aimInput)) : null,
      aimMode,
      valid: aimValid,
      target: aimInput && floorHit ? aimTarget.toArray() : null,
      origin: aimInput ? aimOrigin.toArray() : null,
      rig: rig.position.toArray(),
      head: headPosition(head).toArray(),
      yaw: rig.rotation.y,
      teleportCount,
      turnCount,
      lastMove,
    }),
  };
}
