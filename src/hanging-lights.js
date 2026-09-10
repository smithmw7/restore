import * as THREE from 'three';

const FIXED_STEP = 1 / 120;
const MAX_ANGLE = THREE.MathUtils.degToRad(50);
const MIN_DOWN = Math.cos(MAX_ANGLE);
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = new THREE.Vector3(0, -9.81, 0);
const finitePoint = (point) => point?.isVector3 && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

// These fixtures are pendulums, with no idle animation and no extra Rapier
// bodies. The cable length is a geometric constraint throughout integration
// and interpolation; the lamp cannot follow a hand through its anchor.
export function createHangingLights({ parent, fixtures = [], housingMaterial, diffuserMaterial, farDiffuserMaterial, onEvent = () => {} }) {
  const root = new THREE.Group();
  root.name = 'Suspended archive lights';
  parent.add(root);
  const ownedMaterials = [];
  const fallback = (material, parameters, basic = false) => {
    if (material) return material;
    const result = basic ? new THREE.MeshBasicMaterial(parameters) : new THREE.MeshStandardMaterial(parameters);
    ownedMaterials.push(result);
    return result;
  };
  const housing = fallback(housingMaterial, { color: '#444139', roughness: .72, metalness: .6 });
  const diffuser = fallback(diffuserMaterial, { color: new THREE.Color('#ffc68b').multiplyScalar(2), toneMapped: false }, true);
  const farDiffuser = fallback(farDiffuserMaterial, { color: '#a68760', toneMapped: false }, true);
  const housingGeometry = new THREE.BoxGeometry(1.6, .3, .78);
  const diffuserGeometry = new THREE.BoxGeometry(1.32, .055, .58);
  // Include the illuminated underside in the canonical selection target. At a
  // shallow distant angle, a ray aimed at the glow can miss the housing above it.
  const pickGeometry = new THREE.BoxGeometry(1.6, .356, .78).translate(0, -.028, 0);
  const wireGeometry = new THREE.CylinderGeometry(.018, .018, 1, 6);
  const geometries = [housingGeometry, diffuserGeometry, pickGeometry, wireGeometry];
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  ownedMaterials.push(pickMaterial);
  const litCount = fixtures.filter((fixture) => fixture.lit).length;
  const housingBatch = new THREE.InstancedMesh(housingGeometry, housing, fixtures.length);
  const wireBatch = new THREE.InstancedMesh(wireGeometry, housing, fixtures.length);
  const litBatch = new THREE.InstancedMesh(diffuserGeometry, diffuser, litCount);
  const farBatch = new THREE.InstancedMesh(diffuserGeometry, farDiffuser, fixtures.length - litCount);
  const batches = [housingBatch, wireBatch, litBatch, farBatch];
  batches.forEach((batch) => {
    batch.frustumCulled = false;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(batch);
  });
  const emissionTransform = new THREE.Object3D();
  const targets = [];
  const atmosphereLights = [];
  const meshUnits = new Map();
  const units = [];
  const axis = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const desiredVelocity = new THREE.Vector3();
  const goalDirection = new THREE.Vector3();
  const goalPosition = new THREE.Vector3();
  const physicalPosition = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const renderDirection = new THREE.Vector3();
  const renderQuaternion = new THREE.Quaternion();
  const beamDirection = new THREE.Vector3();
  const lampBeam = new THREE.Vector3(0, -1, -.135).normalize();
  let held = null;
  let accumulator = 0;
  let disposed = false;

  function positionOf(unit, target) {
    return target.copy(unit.anchor).addScaledVector(unit.direction, unit.length);
  }

  function limitDirection(direction) {
    direction.normalize();
    if (direction.y <= -MIN_DOWN) return false;
    const horizontal = Math.hypot(direction.x, direction.z);
    if (horizontal < 1e-8) direction.set(0, -1, 0);
    else direction.set(direction.x / horizontal * Math.sin(MAX_ANGLE), -MIN_DOWN, direction.z / horizontal * Math.sin(MAX_ANGLE));
    return true;
  }

  function sync(unit, alpha = 1) {
    // Normalized interpolation stays on the cable sphere, including between
    // physics ticks on 72/90 Hz headsets.
    renderDirection.copy(unit.previousDirection).lerp(unit.direction, alpha).normalize();
    renderQuaternion.setFromUnitVectors(DOWN, renderDirection);
    unit.mesh.position.copy(unit.anchor).addScaledVector(renderDirection, unit.length);
    unit.mesh.quaternion.copy(renderQuaternion);
    unit.wire.position.copy(unit.anchor).addScaledVector(renderDirection, (unit.length - .15) / 2);
    unit.wire.quaternion.setFromUnitVectors(UP, renderDirection);
    unit.wire.scale.y = unit.length - .15;
    unit.mesh.updateMatrix(); unit.wire.updateMatrix();
    housingBatch.setMatrixAt(unit.index, unit.mesh.matrix);
    wireBatch.setMatrixAt(unit.index, unit.wire.matrix);
    emissionTransform.position.set(0, -.178, 0).applyQuaternion(renderQuaternion).add(unit.mesh.position);
    emissionTransform.quaternion.copy(renderQuaternion);
    emissionTransform.updateMatrix();
    unit.emissionBatch.setMatrixAt(unit.emissionIndex, emissionTransform.matrix);
    housingBatch.instanceMatrix.needsUpdate = true;
    wireBatch.instanceMatrix.needsUpdate = true;
    unit.emissionBatch.instanceMatrix.needsUpdate = true;
    if (unit.spot) {
      unit.spot.position.set(0, -.19, 0).applyQuaternion(renderQuaternion).add(unit.mesh.position);
      beamDirection.copy(lampBeam).applyQuaternion(renderQuaternion);
      // A tilted luminaire carries both its real pool of light and volumetric
      // shaft. Keep the target on the floor while preserving its beam axis.
      const floorDistance = Math.max(.5, (unit.spot.position.y - .2) / Math.max(.08, -beamDirection.y));
      unit.spot.target.position.copy(unit.spot.position).addScaledVector(beamDirection, floorDistance);
      unit.atmosphere.source.copy(unit.spot.position);
      unit.atmosphere.target.copy(unit.spot.target.position);
    }
  }

  let nextLit = 0, nextFar = 0;
  fixtures.forEach((fixture, index) => {
    const { x = 0, z = 0, y = 10.4, anchorY = 27.6, lit = false } = fixture;
    if (![x, y, z, anchorY].every(Number.isFinite) || anchorY - y <= .3) throw new Error('A hanging light needs a finite position below its ceiling anchor.');
    const id = fixture.id || `hanging-light-${String(index + 1).padStart(2, '0')}`;
    // Raycast proxies stay visible to the input system, but their material
    // does not render. The whole archive's fixtures cost only four batches.
    const mesh = new THREE.Mesh(pickGeometry, pickMaterial);
    mesh.name = id;
    mesh.userData = { kind: 'hanging-light', labObject: id, soundId: 'tablet' };
    const wire = new THREE.Object3D();
    wire.name = `${id} / fixed wire`;
    root.add(mesh, wire);
    const unit = {
      id, mesh, wire, index, emissionBatch: lit ? litBatch : farBatch, emissionIndex: lit ? nextLit++ : nextFar++,
      anchor: new THREE.Vector3(x, anchorY, z), length: anchorY - y,
      direction: DOWN.clone(), previousDirection: DOWN.clone(), velocity: new THREE.Vector3(),
      active: false, quietTime: 0, elapsed: 0, spot: null, atmosphere: null,
    };
    if (lit) {
      unit.spot = new THREE.SpotLight(fixture.color || '#ffbd7d', fixture.intensity ?? 780, 29, .49, .66, 2);
      unit.spot.name = `${id} / warm pool`;
      unit.spot.castShadow = fixture.castShadow === true;
      if (unit.spot.castShadow) {
        unit.spot.shadow.mapSize.set(1024, 1024);
        unit.spot.shadow.normalBias = .02;
        unit.spot.shadow.bias = -.0001;
        Object.assign(unit.spot.shadow.camera, { near: .15, far: 29 });
      }
      root.add(unit.spot, unit.spot.target);
      unit.atmosphere = {
        source: new THREE.Vector3(), target: new THREE.Vector3(), startRadius: .22, endRadius: 2.45,
        color: fixture.shaftColor || '#eab67e', density: fixture.density ?? .046, moving: true,
      };
      atmosphereLights.push(unit.atmosphere);
    }
    meshUnits.set(mesh, unit);
    targets.push(mesh);
    units.push(unit);
    sync(unit);
  });

  function emit(type, unit, extra = {}) {
    onEvent({ type, kind: 'hanging-light', objectId: unit.id, soundId: 'tablet', position: unit.mesh.position.clone(), strength: .35, ...extra });
  }

  function beginGrab(mesh, point, handId = 'primary') {
    const unit = meshUnits.get(mesh);
    if (disposed || held || !unit || !finitePoint(point)) return false;
    positionOf(unit, physicalPosition);
    held = { unit, handId, goal: physicalPosition.clone(), offset: physicalPosition.clone().sub(point), speed: unit.velocity.length() };
    unit.active = true;
    unit.quietTime = 0;
    emit('pickup', unit, { whole: true });
    return true;
  }

  function moveGrab(point, handId = 'primary') {
    if (!held || held.handId !== handId || !finitePoint(point)) return false;
    held.goal.copy(point).add(held.offset);
    return true;
  }

  function endGrab(handId = 'primary', { cancelled = false } = {}) {
    if (!held || held.handId !== handId) return false;
    const { unit } = held;
    held = null;
    unit.quietTime = 0;
    unit.elapsed = 0;
    // Its existing tangential velocity continues the swing; this is attached
    // to the ceiling, so releasing never emits the dropped-object kick sound.
    emit('enddrag', unit, { cancelled, reason: cancelled ? 'cancelled' : 'release' });
    return true;
  }

  function nudge(mesh, point, direction, strength = 1) {
    const unit = meshUnits.get(mesh);
    if (disposed || !unit || !finitePoint(point) || !finitePoint(direction) || direction.lengthSq() < 1e-8 || !Number.isFinite(strength) || strength <= 0) return false;
    tangent.copy(direction).normalize().addScaledVector(unit.direction, -direction.clone().normalize().dot(unit.direction));
    let tangentialFraction = tangent.length();
    if (tangentialFraction < 1e-5) {
      positionOf(unit, physicalPosition);
      tangent.copy(point).sub(physicalPosition).addScaledVector(unit.direction, -point.clone().sub(physicalPosition).dot(unit.direction));
      if (tangent.lengthSq() < 1e-8) tangent.set(.45, 0, .89).addScaledVector(unit.direction, -unit.direction.dot(axis.set(.45, 0, .89)));
      tangentialFraction = .35;
    }
    tangent.normalize();
    const influence = THREE.MathUtils.clamp(strength, 0, 1);
    unit.velocity.addScaledVector(tangent, 3.2 * influence * Math.max(.35, tangentialFraction)).clampLength(0, 4);
    unit.active = true;
    unit.quietTime = 0;
    unit.elapsed = 0;
    emit('nudge', unit, { strength: influence * .45 });
    return true;
  }

  function fixedStep(dt) {
    for (const unit of units) {
      unit.previousDirection.copy(unit.direction);
      if (!unit.active) continue;
      unit.elapsed += dt;
      if (held?.unit === unit) {
        goalDirection.copy(held.goal).sub(unit.anchor);
        if (goalDirection.lengthSq() < 1e-8) goalDirection.copy(unit.direction);
        limitDirection(goalDirection);
        goalPosition.copy(unit.anchor).addScaledVector(goalDirection, unit.length);
        positionOf(unit, physicalPosition);
        desiredVelocity.copy(goalPosition).sub(physicalPosition).multiplyScalar(3.5);
        desiredVelocity.addScaledVector(unit.direction, -desiredVelocity.dot(unit.direction)).clampLength(0, 2.8);
        acceleration.copy(desiredVelocity).sub(unit.velocity).multiplyScalar(6).clampLength(0, 9);
      } else {
        acceleration.copy(GRAVITY).addScaledVector(unit.direction, -GRAVITY.dot(unit.direction));
      }
      unit.velocity.addScaledVector(acceleration, dt);
      if (held?.unit !== unit) unit.velocity.multiplyScalar(Math.exp(-.58 * dt));
      unit.direction.addScaledVector(unit.velocity, dt / unit.length);
      const reachedLimit = limitDirection(unit.direction);
      unit.velocity.addScaledVector(unit.direction, -unit.velocity.dot(unit.direction));
      if (reachedLimit) {
        // Remove only the outward angular motion at the cable's safety cone;
        // sideways motion remains free to slide around that cone.
        tangent.copy(UP).addScaledVector(unit.direction, -UP.dot(unit.direction)).normalize();
        const outward = unit.velocity.dot(tangent);
        if (outward > 0) unit.velocity.addScaledVector(tangent, -outward);
      }
      if (held?.unit === unit) {
        held.speed = unit.velocity.length();
        continue;
      }
      const displacement = Math.sqrt(Math.max(0, 2 + 2 * unit.direction.y)) * unit.length;
      unit.quietTime = displacement < .012 && unit.velocity.lengthSq() < .012 ** 2 ? unit.quietTime + dt : 0;
      if (unit.quietTime > .55 && unit.elapsed >= 12) {
        unit.direction.copy(DOWN);
        unit.previousDirection.copy(DOWN);
        unit.velocity.set(0, 0, 0);
        unit.active = false;
      }
    }
  }

  function step(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    accumulator += Math.min(dt, .1);
    while (accumulator + 1e-10 >= FIXED_STEP) {
      fixedStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    accumulator = Math.max(0, accumulator);
    const alpha = accumulator / FIXED_STEP;
    for (const unit of units) sync(unit, alpha);
  }

  function getGrabState() {
    if (!held) return { active: false, objectId: null, anchor: null, radius: 0, assembled: 0, total: 0, complete: false, speed: 0, goal: null, canDock: false, heldMesh: null };
    return { active: true, objectId: held.unit.id, soundId: 'tablet', kind: 'hanging-light', handId: held.handId,
      whole: true, anchor: held.unit.mesh.position.toArray(), radius: 0, assembled: 1, total: 1, complete: false,
      speed: held.speed, load: Math.sin(Math.acos(THREE.MathUtils.clamp(-held.unit.direction.y, -1, 1))),
      goal: held.goal.toArray(), canDock: false, heldMesh: held.unit.mesh };
  }

  function getState() {
    return { count: units.length, realSpotlights: atmosphereLights.length, renderBatches: batches.filter((batch) => batch.count > 0).length,
      active: units.filter((unit) => unit.active).length,
      lights: units.map((unit) => ({ id: unit.id, state: held?.unit === unit ? 'held' : unit.active ? 'swinging' : 'resting',
        anchor: unit.anchor.toArray(), position: unit.mesh.position.toArray(), velocity: unit.velocity.toArray(),
        cableLength: unit.length - .15, pendulumLength: unit.length,
        angle: Math.acos(THREE.MathUtils.clamp(-unit.direction.y, -1, 1)), lit: !!unit.spot })) };
  }

  function reset() {
    if (held) endGrab(held.handId, { cancelled: true });
    accumulator = 0;
    for (const unit of units) {
      unit.direction.copy(DOWN); unit.previousDirection.copy(DOWN); unit.velocity.set(0, 0, 0);
      unit.active = false; unit.quietTime = 0; unit.elapsed = 0;
      sync(unit);
    }
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    root.removeFromParent();
    units.forEach((unit) => unit.spot?.shadow.dispose());
    batches.forEach((batch) => batch.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    ownedMaterials.forEach((material) => material.dispose());
    targets.length = 0;
    meshUnits.clear();
  }

  return { targets, grabTargets: targets, atmosphereLights, beginGrab, moveGrab, endGrab, hit: nudge, nudge,
    getGrabState, step, reset, getState, dispose };
}
