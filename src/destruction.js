import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import { nudgeBody } from './tap-influence.js';
import { driveGrabbedBody, releaseGrabbedBody } from './physical-drag.js';
import { setContactSurface } from './contact-audio.js';

// Dimensions are metres. The stage uses these same specs for its pedestal visuals.
export const OBJECT_SPECS = Object.freeze([
  { id: 'vase', label: 'Vase', x: -1.38, z: -1.40, pedestalHeight: 0.74, halfHeight: 0.29, color: '#f39a86', seed: 401 },
  { id: 'cube', label: 'Cube', x: -0.46, z: -1.02, pedestalHeight: 0.74, halfHeight: 0.215, color: '#a8c8b0', seed: 402 },
  { id: 'orb', label: 'Orb', x: 0.46, z: -1.02, pedestalHeight: 0.74, halfHeight: 0.25, color: '#e7bd66', seed: 403 },
  { id: 'gem', label: 'Gem', x: 1.38, z: -1.40, pedestalHeight: 0.74, halfHeight: 0.30, color: '#b5a7d6', seed: 402 },
  { id: 'bottle', label: 'Bottle', x: -1.65, z: -2.55, pedestalHeight: 0.84, halfHeight: 0.31, color: '#81b8bb', seed: 403 },
  { id: 'column', label: 'Column', x: -0.55, z: -2.55, pedestalHeight: 0.84, halfHeight: 0.29, color: '#dda078', seed: 405 },
  { id: 'ring', label: 'Ring', x: 0.55, z: -2.55, pedestalHeight: 0.84, halfHeight: 0.277, color: '#d8a9ba', seed: 406 },
  { id: 'tablet', label: 'Tablet', x: 1.65, z: -2.55, pedestalHeight: 0.84, halfHeight: 0.285, color: '#91accf', seed: 407 },
]);

const FIXED_STEP = 1 / 60;
const RESTORE_SECONDS = 0.8;
export const MAGNET_RADIUS = 0.85;
const DOCK_RADIUS = 0.48;
const DOCK_SECONDS = 0.34;
const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

function closedLathe(profile, radialSegments = 20) {
  const geometry = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), radialSegments);
  // Radius-zero cap poles generate zero-area faces. Remove those before slicing.
  const vertices = geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const indices = [];
  for (let index = 0; index < geometry.index.count; index += 3) {
    const ia = geometry.index.getX(index);
    const ib = geometry.index.getX(index + 1);
    const ic = geometry.index.getX(index + 2);
    a.fromBufferAttribute(vertices, ia);
    b.fromBufferAttribute(vertices, ib).sub(a);
    c.fromBufferAttribute(vertices, ic).sub(a);
    if (b.cross(c).lengthSq() > 1e-16) indices.push(ia, ib, ic);
  }
  geometry.setIndex(indices);
  return geometry;
}

function makeGeometry(id) {
  switch (id) {
    case 'vase': return closedLathe([[0, -0.29], [0.17, -0.29], [0.23, -0.20], [0.20, 0.05], [0.10, 0.20], [0.12, 0.29], [0, 0.29]]);
    case 'cube': return new THREE.BoxGeometry(0.43, 0.43, 0.43);
    case 'orb': return new THREE.SphereGeometry(0.25, 20, 12);
    case 'gem': return new THREE.OctahedronGeometry(0.30);
    case 'bottle': return closedLathe([[0, -0.31], [0.15, -0.31], [0.17, -0.26], [0.17, 0.07], [0.08, 0.17], [0.075, 0.31], [0, 0.31]]);
    // Avoid a coplanar slicing degeneracy at the cylinder's axis-aligned seam.
    case 'column': return new THREE.CylinderGeometry(0.20, 0.20, 0.58, 10).rotateY(0.13);
    case 'ring': return new THREE.TorusGeometry(0.20, 0.077, 10, 24);
    case 'tablet': return new THREE.BoxGeometry(0.40, 0.57, 0.12);
    // Warehouse additions retain the original demo's eight fracture templates.
    case 'obelisk': return closedLathe([[0, -0.27], [0.17, -0.27], [0.17, -0.22], [0.14, -0.20], [0.095, 0.15], [0, 0.27]], 4).rotateY(Math.PI / 4);
    case 'chalice': return closedLathe([[0, -0.27], [0.13, -0.27], [0.15, -0.245], [0.13, -0.20],
      [0.055, -0.16], [0.05, 0.015], [0.115, 0.04], [0.175, 0.13], [0.205, 0.22],
      [0.20, 0.27], [0.178, 0.27], [0.178, 0.22], [0.15, 0.14], [0.09, 0.095], [0, 0.085]]);
    case 'stela': {
      const outline = new THREE.Shape().moveTo(-0.175, -0.28).lineTo(0.175, -0.28).lineTo(0.175, 0.13)
        .quadraticCurveTo(0.175, 0.28, 0, 0.28).quadraticCurveTo(-0.175, 0.28, -0.175, 0.13).closePath();
      return new THREE.ExtrudeGeometry(outline, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.012,
        bevelSize: 0.012, bevelSegments: 2, curveSegments: 8, steps: 1 }).translate(0, 0, -0.045);
    }
    default: throw new Error(`Unknown Restore object: ${id}`);
  }
}

function makeHull(geometry, shrink = 1) {
  const vertices = new Float32Array(geometry.attributes.position.array);
  if (shrink !== 1) {
    for (let index = 0; index < vertices.length; index++) vertices[index] *= shrink;
  }
  const hull = RAPIER.ColliderDesc.convexHull(vertices);
  if (!hull) throw new Error('A fracture fragment did not produce a valid convex hull.');
  // A 4mm contact margin keeps sharp cut hulls from repeatedly penetrating the
  // floor and rocking awake. The visible fracture geometry stays unchanged.
  return hull.setFriction(0.66).setRestitution(0.24).setContactSkin(0.004);
}

/**
 * Fracture geometry is cached once. Each physical unit is a loose shard or a
 * compound group of reunited shards. Releasing a partial repair preserves it.
 * Unit rotations are relative to the immutable, world-oriented home geometry.
 */
export async function createDestructionLab({ scene, onProgress = () => {}, onChange = () => {}, onEvent = () => {},
  specs = OBJECT_SPECS, materialForSpec = null, geometryForSpec = null, fractureGeometryForSpec = null, wholeObjects = false, pedestals = true,
  bounds = { minX: -6, maxX: 6, minZ: -7, maxZ: 6 }, statics = [],
  beforePhysicsStep = () => {}, afterPhysicsStep = () => {}, solverIterations = 4,
}) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const events = new RAPIER.EventQueue(true);
  world.numSolverIterations = solverIterations;
  world.timestep = FIXED_STEP;
  const targets = [];
  const grabTargets = [];
  const objects = [];
  const objectById = new Map();
  const colliderUnits = new Map();
  const collisionTimes = new Map();
  const identity = new THREE.Quaternion();
  const scratch = new THREE.Vector3();
  const scratch2 = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const repairBounds = new THREE.Box3();
  const repairTransform = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);
  let ready = false;
  let restoring = false;
  let restoreTime = 0;
  let accumulator = 0;
  let elapsed = 0;
  let lastCollisionTime = -Infinity;
  let disposed = false;
  let grab = null;
  // Opt-in keys describe identical local geometry. A positive fractureScale
  // explicitly permits uniformly scaled copies of one canonical cut. Templates
  // exist only during setup; objects always own their geometry and physics hulls.
  const fractureTemplates = new Map();
  let pendingObject = null;

  function fracturePieces(mesh, spec, inside) {
    const options = { fractureMethod: 'voronoi', fragmentCount: spec.fragmentCount || 16, seed: spec.seed,
      voronoiOptions: { mode: '3D', useApproximation: false } };
    const key = typeof spec.fractureKey === 'string' && spec.fractureKey ? spec.fractureKey : null;
    const variants = key ? fractureTemplates.get(key) || [] : [];
    const form = spec.form || spec.id;
    const uniformScale = key && Number.isFinite(spec.fractureScale) && spec.fractureScale > 0 ? spec.fractureScale : null;
    const scale = uniformScale === null ? JSON.stringify(spec.scale ?? null) : 'uniform';
    const cached = variants.find((template) => template.form === form && template.scale === scale
      && template.seed === spec.seed && template.count === options.fragmentCount);
    function copyTemplate(template) {
      return template.fragments.map((fragment) => {
        // Templates contain geometry only. Every instance keeps its own finish,
        // including emissive palettes and the material on newly exposed faces.
        const geometry = fragment.geometry.clone();
        if (uniformScale !== null) geometry.scale(uniformScale, uniformScale, uniformScale);
        const piece = new DestructibleMesh(geometry, mesh.material, inside);
        piece.material = [mesh.material, inside];
        piece.position.copy(fragment.center).multiplyScalar(uniformScale ?? 1).applyMatrix4(mesh.matrixWorld);
        piece.quaternion.copy(mesh.quaternion);
        piece.scale.copy(mesh.scale);
        return piece;
      });
    }
    if (cached) return copyTemplate(cached);
    if (uniformScale !== null) {
      // Cut the proven metre-sized form once, at the origin. Scaling both its
      // vertices and centers afterward preserves volume and avoids 176 separate
      // cuts merely because every storage crate has different dimensions.
      // Prefer original source vertices to a Float32 scale/unscale round trip;
      // tiny rounding changes can destabilize a cut through a thin flange.
      const geometry = fractureGeometryForSpec ? fractureGeometryForSpec(spec)
        : mesh.geometry.clone().scale(1 / uniformScale, 1 / uniformScale, 1 / uniformScale);
      const canonical = new DestructibleMesh(geometry, mesh.material, inside);
      canonical.updateMatrixWorld(true);
      let pieces;
      try { pieces = canonical.fracture(new FractureOptions(options)); }
      finally { geometry.dispose(); }
      const template = { form, scale, seed: spec.seed, count: options.fragmentCount,
        fragments: pieces.map((piece) => ({ geometry: piece.geometry, center: piece.position.clone() })) };
      variants.push(template);
      fractureTemplates.set(key, variants);
      return copyTemplate(template);
    }
    const pieces = mesh.fracture(new FractureOptions(options));
    pendingObject.pieces = pieces;
    if (key) {
      const inverse = mesh.matrixWorld.clone().invert();
      variants.push({ form, scale, seed: spec.seed, count: options.fragmentCount,
        fragments: pieces.map((piece) => ({ geometry: piece.geometry.clone(), center: piece.position.clone().applyMatrix4(inverse) })),
      });
      fractureTemplates.set(key, variants);
    }
    return pieces;
  }

  setContactSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(8, (bounds.maxX - bounds.minX) / 2 + 1), 0.05, Math.max(8, (bounds.maxZ - bounds.minZ) / 2 + 1))
    .setTranslation((bounds.minX + bounds.maxX) / 2, -0.05, (bounds.minZ + bounds.maxZ) / 2).setFriction(0.8)), 'concrete');
  for (const box of statics) {
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const center = box.getCenter(new THREE.Vector3());
    setContactSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z).setTranslation(center.x, center.y, center.z).setFriction(0.8)), box.audioSurface || 'concrete');
  }
  for (const spec of pedestals ? specs : []) {
    world.createCollider(RAPIER.ColliderDesc.cylinder(spec.pedestalHeight / 2, 0.32)
      .setTranslation(spec.x, spec.pedestalHeight / 2, spec.z).setFriction(0.8));
  }

  function emit(type, object, position, extra = {}) {
    onEvent({ type, objectId: object.spec.id, soundId: object.spec.soundId || object.spec.form || object.spec.id, position: position.clone(), ...extra });
  }

  function assemblyCenter(unit, result = new THREE.Vector3()) {
    return result.copy(unit.anchor.homePosition).sub(unit.object.homePosition)
      .applyQuaternion(unit.quaternion).negate().add(unit.position);
  }

  function isComplete(object) {
    return object.units.length === 1 && object.units[0].members.length === object.fragments.length;
  }

  function getGrabState() {
    if (!grab) return { active: false, objectId: null, anchor: null, radius: MAGNET_RADIUS, assembled: 0, total: 0, complete: false, speed: 0, goal: null, canDock: false, heldMesh: null };
    const { object, unit } = grab;
    const complete = unit.members.length === object.fragments.length;
    return {
      active: true,
      objectId: object.spec.id,
      handId: grab.handId,
      soundId: object.spec.soundId || object.spec.form || object.spec.id,
      kind: object.spec.kind || 'artifact',
      whole: !object.fractured,
      // Visual/audio consumers share the interpolated pose. Magnetic decisions
      // continue to use unit.position inside the fixed-step simulation.
      anchor: unit.anchor.mesh.position.toArray(),
      radius: MAGNET_RADIUS,
      assembled: unit.members.length,
      total: object.fragments.length,
      complete,
      speed: grab.speed,
      goal: grab.goal.toArray(),
      canDock: complete && assemblyCenter(unit, scratch).distanceTo(object.homePosition) <= DOCK_RADIUS && isDockHomeClear(object),
      heldMesh: complete ? object.mesh : unit.anchor.mesh,
    };
  }

  function getState() {
    const broken = objects.filter((object) => object.fractured).length;
    const { heldMesh, ...grabState } = getGrabState();
    return {
      ready,
      intact: objects.length - broken,
      broken,
      debris: objects.reduce((total, object) => total + (object.broken && !isComplete(object) ? object.fragments.length : 0), 0),
      restoring,
      total: specs.length,
      objects: objects.map((object) => ({
        id: object.spec.id,
        form: object.spec.form || object.spec.id,
        label: object.spec.label,
        category: object.spec.category || 'relic',
        state: !object.enabled ? 'hidden' : object.docking ? 'docking' : grab?.object === object ? 'held' : !object.broken ? 'intact' : isComplete(object) ? 'assembled' : 'broken',
        visible: object.enabled,
        fractured: object.fractured,
        kind: object.spec.kind || 'artifact',
        soundId: object.spec.soundId || object.spec.form || object.spec.id,
        snapped: object.broken ? Math.max(grab?.object === object ? 1 : 0, ...object.units.map((unit) => unit.members.length > 1 ? unit.members.length : 0)) : object.fragments.length,
        total: object.fragments.length,
        position: object.mesh.position.toArray(),
        home: object.homePosition.toArray(),
      })),
      grab: grabState,
      physics: { bodies: disposed ? 0 : world.bodies.len(), colliders: disposed ? 0 : world.colliders.len() },
    };
  }

  function notify() { onChange(getState()); }

  function refreshTargets() {
    // Mutate in place because input systems retain these array references.
    targets.length = 0;
    grabTargets.length = 0;
    for (const object of objects) {
      if (!object.enabled || restoring || object.docking) continue;
      if (!object.broken) { targets.push(object.mesh); if (wholeObjects) grabTargets.push(object.mesh); }
      else if (!restoring && !object.docking) {
        if (wholeObjects && isComplete(object)) targets.push(object.mesh);
        if (isComplete(object)) grabTargets.push(object.mesh);
        else for (const fragment of object.fragments) grabTargets.push(fragment.mesh);
      }
    }
  }

  function addIntactCollider(object) {
    if (!object.enabled) return;
    object.intactCollider = world.createCollider(object.intactHull
      .setTranslation(object.mesh.position.x, object.mesh.position.y, object.mesh.position.z)
      .setRotation(object.mesh.quaternion));
  }

  function removeBody(unit) {
    for (const handle of unit.colliderHandles) colliderUnits.delete(handle);
    unit.colliderHandles.length = 0;
    if (unit.body) {
      releaseGrabbedBody(unit.body);
      world.removeRigidBody(unit.body);
    }
    unit.body = null;
    unit.magnetized = false;
  }

  function addUnitCollider(unit, fragment) {
    scratch.copy(fragment.homePosition).sub(unit.anchor.homePosition);
    const collider = world.createCollider(fragment.hull
      .setTranslation(scratch.x, scratch.y, scratch.z)
      .setRotation(fragment.homeQuaternion)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), unit.body);
    unit.colliderHandles.push(collider.handle);
    colliderUnits.set(collider.handle, { unit, fragment });
  }

  function addBody(unit, initialVelocity = null) {
    const p = unit.position;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z).setRotation(unit.quaternion)
      .setLinearDamping(0.45).setAngularDamping(0.85).setCcdEnabled(true));
    unit.body = body;
    unit.previousPosition.copy(p);
    unit.previousQuaternion.copy(unit.quaternion);
    for (const fragment of unit.members) addUnitCollider(unit, fragment);
    if (initialVelocity) body.setLinvel(initialVelocity, true);
  }

  function reanchorUnit(unit, fragment) {
    if (unit.anchor === fragment) return;
    const offset = fragment.homePosition.clone().sub(unit.anchor.homePosition);
    // Change the body's coordinate origin without moving its world-space hulls,
    // including either end of the current render interpolation interval.
    unit.position.add(offset.clone().applyQuaternion(unit.quaternion));
    unit.previousPosition.add(offset.clone().applyQuaternion(unit.previousQuaternion));
    unit.anchor = fragment;
    for (const handle of unit.colliderHandles) {
      const collider = world.getCollider(handle);
      const member = colliderUnits.get(handle).fragment;
      collider.setTranslationWrtParent(scratch.copy(member.homePosition).sub(fragment.homePosition));
    }
    unit.body.setTranslation(unit.position, true);
    unit.body.recomputeMassPropertiesFromColliders();
  }

  const physicsHooks = {
    filterContactPair(handleA, handleB) {
      const a = colliderUnits.get(handleA)?.unit;
      const b = colliderUnits.get(handleB)?.unit;
      // Only active pieces of this repair may pass one another while lining up.
      // Floors, walls, foreign props, and loose inactive pieces stay solid.
      if (grab && a?.object === grab.object && b?.object === grab.object &&
        (a === grab.unit || a.magnetized) && (b === grab.unit || b.magnetized)) return null;
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair: () => true,
  };

  function makeUnit(object, members, position, quaternion = identity) {
    const unit = {
      object, members: [...members], anchor: members[0], body: null,
      position: position.clone(), quaternion: quaternion.clone(),
      previousPosition: position.clone(), previousQuaternion: quaternion.clone(),
      velocity: new THREE.Vector3(), colliderHandles: [], magnetized: false,
    };
    for (const fragment of members) fragment.unit = unit;
    object.units.push(unit);
    return unit;
  }

  function syncUnit(unit, alpha = 1) {
    // Only rendering is interpolated; magnetic decisions use fixed-step transforms.
    const p = scratch2.lerpVectors(unit.previousPosition, unit.position, alpha);
    const q = scratchQuaternion.slerpQuaternions(unit.previousQuaternion, unit.quaternion, alpha);
    const complete = unit.members.length === unit.object.fragments.length;
    for (const fragment of unit.members) {
      fragment.mesh.position.copy(fragment.homePosition).sub(unit.anchor.homePosition).applyQuaternion(q).add(p);
      fragment.mesh.quaternion.copy(q).multiply(fragment.homeQuaternion);
      fragment.mesh.visible = !complete;
    }
    if (complete) {
      const { object } = unit;
      object.mesh.position.copy(unit.anchor.homePosition).sub(object.homePosition).applyQuaternion(q).negate().add(p);
      object.mesh.quaternion.copy(q).multiply(object.homeQuaternion);
      object.mesh.visible = true;
    }
  }

  function resetObjectHome(object) {
    for (const unit of object.units) removeBody(unit);
    object.units.length = 0;
    object.docking = null;
    object.broken = false;
    object.fractured = false;
    object.mesh.position.copy(object.homePosition);
    object.mesh.quaternion.copy(object.homeQuaternion);
    object.mesh.visible = object.enabled;
    for (const fragment of object.fragments) {
      fragment.unit = null;
      fragment.mesh.visible = false;
      fragment.mesh.position.copy(fragment.homePosition);
      fragment.mesh.quaternion.copy(fragment.homeQuaternion);
    }
    if (!object.intactCollider) addIntactCollider(object);
  }

  onProgress(0, specs.length);
  try {
    for (const spec of specs) {
      await yieldFrame();
      const supplied = materialForSpec?.(spec);
      const outside = supplied?.outside?.clone() || new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.38, metalness: 0.06 });
      const inside = supplied?.inside?.clone() || new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color).lerp(new THREE.Color('#fff8eb'), 0.58), roughness: 0.92, metalness: 0 });
      const form = spec.form || spec.id;
      // The callback transfers ownership of its geometry to this lab.
      const mesh = new DestructibleMesh(geometryForSpec ? geometryForSpec(spec) : makeGeometry(form), outside, inside);
      pendingObject = { mesh, outside, inside, pieces: [] };
      mesh.name = spec.label;
      mesh.position.set(spec.x, spec.y ?? spec.pedestalHeight + spec.halfHeight + 0.004, spec.z);
      if (form === 'cube') mesh.rotation.y = 0.22;
      if (form === 'tablet') mesh.rotation.y = -0.16;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.labObject = spec.id;
      mesh.userData.soundId = spec.soundId || form;
      mesh.userData.kind = spec.kind || 'artifact';
      mesh.userData.wholeGrabbable = wholeObjects;
      scene.add(mesh);
      mesh.updateMatrixWorld(true);
      mesh.geometry.computeBoundingBox();
      const pieces = fracturePieces(mesh, spec, inside);
      pendingObject.pieces = pieces;
      if (pieces.length < 2) throw new Error(`Could not fracture ${spec.label}.`);
      const fragments = pieces.map((piece, index) => {
        piece.visible = false;
        piece.name = `${spec.label} fragment ${index + 1}`;
        piece.userData.labObject = spec.id;
        piece.userData.fragmentIndex = index;
        piece.userData.soundId = spec.soundId || form;
        piece.userData.kind = 'fragment';
        piece.castShadow = true;
        piece.receiveShadow = true;
        scene.add(piece);
        return {
          mesh: piece, index, unit: null,
          hull: makeHull(piece.geometry, 0.975).setDensity(350),
          homePosition: piece.position.clone(), homeQuaternion: piece.quaternion.clone(),
          returnPosition: piece.position.clone(), returnQuaternion: piece.quaternion.clone(),
        };
      });
      const object = {
        spec, mesh, fragments, units: [], broken: false, fractured: false, enabled: !spec.initialHidden, docking: null, age: 0,
        homePosition: mesh.position.clone(), homeQuaternion: mesh.quaternion.clone(),
        intactHull: makeHull(mesh.geometry), intactCollider: null, localBounds: mesh.geometry.boundingBox.clone(),
      };
      objects.push(object);
      pendingObject = null;
      objectById.set(spec.id, object);
      mesh.visible = object.enabled;
      addIntactCollider(object);
      onProgress(objects.length, specs.length);
    }
  } catch (error) {
    events.free();
    world.free();
    for (const object of objects) {
      scene.remove(object.mesh);
      object.mesh.geometry.dispose();
      for (const fragment of object.fragments) { scene.remove(fragment.mesh); fragment.mesh.geometry.dispose(); }
      object.mesh.material.dispose();
      object.fragments[0]?.mesh.material[1]?.dispose();
    }
    if (pendingObject) {
      scene.remove(pendingObject.mesh);
      pendingObject.mesh.geometry.dispose();
      for (const piece of pendingObject.pieces) { scene.remove(piece); piece.geometry.dispose(); }
      pendingObject.outside.dispose();
      pendingObject.inside.dispose();
    }
    throw error;
  } finally {
    for (const variants of fractureTemplates.values()) {
      for (const template of variants) {
        for (const fragment of template.fragments) fragment.geometry.dispose();
      }
    }
    fractureTemplates.clear();
  }

  function hit(mesh, point, direction) {
    if (!ready || restoring || disposed) return false;
    const object = objectById.get(mesh?.userData?.labObject);
    if (!object || !object.enabled || mesh !== object.mesh || (object.broken && (!wholeObjects || !isComplete(object))) || grab?.object === object) return false;
    const origin = point?.isVector3 ? point : object.mesh.position;
    const forceDirection = direction?.isVector3 ? direction.clone() : new THREE.Vector3(0, 0, -1);
    if (forceDirection.lengthSq() < 0.0001) forceDirection.set(0, 0, -1);
    forceDirection.normalize();
    for (const unit of object.units) removeBody(unit);
    object.units.length = 0;
    const fracturePosition = object.mesh.position.clone();
    const fractureRotation = object.mesh.quaternion.clone().multiply(object.homeQuaternion.clone().invert());
    object.broken = true;
    object.fractured = true;
    object.age = 0;
    object.mesh.visible = false;
    if (object.intactCollider) world.removeCollider(object.intactCollider, true);
    object.intactCollider = null;
    object.fragments.forEach((fragment, index) => {
      const position = fragment.homePosition.clone().sub(object.homePosition).applyQuaternion(fractureRotation).add(fracturePosition);
      const unit = makeUnit(object, [fragment], position, fractureRotation);
      const velocity = position.clone().sub(origin);
      if (velocity.lengthSq() < 0.0001) velocity.set(Math.sin(index * 2.4), 0.5, Math.cos(index * 2.4));
      velocity.normalize().multiplyScalar(0.8 + (index % 5) * 0.1).addScaledVector(forceDirection, 0.65);
      velocity.y += 1.5;
      addBody(unit, velocity);
      unit.body.setAngvel({ x: Math.sin(index * 2.1) * 5, y: Math.cos(index * 1.7) * 4, z: Math.sin(index * 1.3) * 5 }, true);
      syncUnit(unit);
    });
    emit('break', object, origin, { strength: 0.8 });
    refreshTargets();
    notify();
    return true;
  }

  function nudge(mesh, point, direction, strength) {
    if (!ready || disposed || restoring || grab) return false;
    const object = objectById.get(mesh?.userData?.labObject);
    // Only exposed, complete props accept ray taps. Fragments retain their
    // immediate grab gesture and hidden contents cannot be touched through wood.
    if (!object?.enabled || object.docking || !targets.includes(mesh) || mesh !== object.mesh || (object.broken ? !isComplete(object) : !wholeObjects)) return false;
    if (!point?.isVector3 || !direction?.isVector3 || !Number.isFinite(point.x + point.y + point.z + direction.x + direction.y + direction.z + strength) || strength <= 0 || direction.lengthSq() < 1e-8) return false;
    const unit = activateWholeObject(object);
    if (!unit.body) addBody(unit);
    if (!nudgeBody(unit?.body, point, direction, strength)) return false;
    refreshTargets();
    emit('nudge', object, point, { strength });
    return true;
  }

  function activateWholeObject(object) {
    if (object.broken) return object.units[0];
    const rotation = object.mesh.quaternion.clone().multiply(object.homeQuaternion.clone().invert());
    const anchor = object.fragments[0].homePosition.clone().sub(object.homePosition).applyQuaternion(rotation).add(object.mesh.position);
    if (object.intactCollider) world.removeCollider(object.intactCollider, true);
    object.intactCollider = null;
    object.broken = true;
    return makeUnit(object, object.fragments, anchor, rotation);
  }

  function beginGrab(mesh, worldPoint, handId = 'primary') {
    if (!ready || disposed || restoring || grab || !worldPoint?.isVector3 || !Number.isFinite(worldPoint.x + worldPoint.y + worldPoint.z)) return false;
    const object = objectById.get(mesh?.userData?.labObject);
    if (!object?.enabled || object.docking || !grabTargets.includes(mesh)) return false;
    if (!object.broken) {
      if (!wholeObjects || mesh !== object.mesh) return false;
      activateWholeObject(object);
    }
    const fragment = Number.isInteger(mesh.userData.fragmentIndex) ? object.fragments[mesh.userData.fragmentIndex] : null;
    const unit = fragment?.unit || (mesh === object.mesh && isComplete(object) ? object.units[0] : null);
    if (!unit) return false;
    if (!unit.body) addBody(unit);
    if (fragment) reanchorUnit(unit, fragment);
    unit.body.wakeUp();
    // The hand offset refers to the actual physics anchor. Keeping the render
    // history avoids rewinding a moving body's colliders to its displayed pose.
    const offset = unit.position.clone().sub(worldPoint);
    grab = { object, unit, handId, offset, goal: worldPoint.clone().add(offset), speed: 0, velocity: new THREE.Vector3(), soundEnded: false };
    emit('pickup', object, unit.position, { complete: isComplete(object), whole: !object.fractured, assembled: unit.members.length, total: object.fragments.length });
    syncUnit(unit, accumulator / FIXED_STEP);
    notify();
    return true;
  }

  function moveGrab(worldPoint, handId = 'primary') {
    if (!grab || grab.handId !== handId || !worldPoint?.isVector3 || !Number.isFinite(worldPoint.x + worldPoint.y + worldPoint.z)) return false;
    grab.goal.copy(worldPoint).add(grab.offset);
    grab.goal.x = THREE.MathUtils.clamp(grab.goal.x, bounds.minX, bounds.maxX);
    grab.goal.y = THREE.MathUtils.clamp(grab.goal.y, 0.07, 6);
    grab.goal.z = THREE.MathUtils.clamp(grab.goal.z, bounds.minZ, bounds.maxZ);
    return true;
  }

  function stopDragSound(activeGrab, reason) {
    if (!activeGrab.soundEnded) {
      activeGrab.soundEnded = true;
      emit('enddrag', activeGrab.object, activeGrab.unit.position, { reason });
    }
  }

  function releaseMagnetized(object) {
    for (const unit of object.units) {
      if (!unit.magnetized || !unit.body) continue;
      unit.magnetized = false;
      releaseGrabbedBody(unit.body);
    }
  }

  function isDockHomeClear(object) {
    let blocked = false;
    world.intersectionsWithShape(object.homePosition, object.homeQuaternion, object.intactHull.shape, (collider) => {
      if (collider.isSensor() || colliderUnits.get(collider.handle)?.unit.object === object) return true;
      const contact = collider.contactShape(object.intactHull.shape, object.homePosition, object.homeQuaternion, 0);
      if (contact && contact.distance < -0.001) { blocked = true; return false; }
      return true;
    });
    return !blocked;
  }

  function endGrab(handId = 'primary', { cancelled = false } = {}) {
    if (!grab || grab.handId !== handId) return false;
    const activeGrab = grab;
    const { object, unit } = activeGrab;
    grab = null;
    releaseGrabbedBody(unit.body);
    stopDragSound(activeGrab, cancelled ? 'cancelled' : 'release');
    releaseMagnetized(object);
    const complete = unit.members.length === object.fragments.length;
    const canDock = complete && assemblyCenter(unit, scratch).distanceTo(object.homePosition) <= DOCK_RADIUS && isDockHomeClear(object);
    if (!cancelled) emit('drop', object, unit.position, { strength: THREE.MathUtils.clamp(0.4 + activeGrab.speed * 0.2, 0.4, 1), complete });
    if (!cancelled && canDock) {
      // Keep the dynamic hulls throughout the return so another prop can block
      // or deflect docking just as it can block a hand-driven object.
      object.docking = { elapsed: 0, unit };
    }
    refreshTargets();
    notify();
    return true;
  }

  function cancelGrabs() {
    return grab ? endGrab(grab.handId, { cancelled: true }) : false;
  }

  function joinUnit(unit) {
    const { object, unit: held } = grab;
    const count = unit.members.length;
    removeBody(unit);
    object.units.splice(object.units.indexOf(unit), 1);
    for (const fragment of unit.members) {
      fragment.unit = held;
      held.members.push(fragment);
      addUnitCollider(held, fragment);
    }
    held.body.recomputeMassPropertiesFromColliders();
    syncUnit(held);
    emit('snap', object, unit.position, { strength: 0.45 + Math.min(count, 4) * 0.1, count, assembled: held.members.length, total: object.fragments.length });
    if (held.members.length === object.fragments.length) {
      stopDragSound(grab, 'complete');
      emit('complete', object, assemblyCenter(held), { total: object.fragments.length });
      refreshTargets();
    }
    notify();
  }

  function canJoinUnit(unit, held) {
    // A final magnetic snap must not create a hull inside an unrelated prop or
    // below the floor, even if its requested slot is only a few centimetres away.
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    for (const fragment of unit.members) {
      position.copy(fragment.homePosition).sub(held.anchor.homePosition)
        .applyQuaternion(held.quaternion).add(held.position);
      quaternion.copy(held.quaternion).multiply(fragment.homeQuaternion);
      let blocked = false;
      world.intersectionsWithShape(position, quaternion, fragment.hull.shape, collider => {
        if (collider.isSensor() || colliderUnits.get(collider.handle)?.unit.object === held.object) return true;
        const contact = collider.contactShape(fragment.hull.shape, position, quaternion, 0);
        if (contact && contact.distance < -0.001) { blocked = true; return false; }
        return true;
      });
      if (blocked) return false;
    }
    return true;
  }

  function updateGrab(dt) {
    if (!grab) return;
    const { unit: held, object } = grab;
    scratch.copy(grab.goal);
    if (object.fractured && (held.members.length > 1 || object.units.some((unit) => unit !== held && unit.magnetized))) {
      // Leave room for the assembling object's underside. Otherwise a large
      // cluster held at floor level can ask its last shard to occupy a slot
      // below the concrete forever. Lift the group's requested target, keeping
      // the same finite-force movement and all external collision constraints.
      scratch2.copy(object.homePosition).sub(held.anchor.homePosition).applyQuaternion(held.quaternion).add(scratch);
      scratchQuaternion.copy(held.quaternion).multiply(object.homeQuaternion);
      repairTransform.compose(scratch2, scratchQuaternion, unitScale);
      repairBounds.copy(object.localBounds).applyMatrix4(repairTransform);
      scratch.y += Math.max(0, 0.008 - repairBounds.min.y);
    }
    driveGrabbedBody(world, held.body, scratch, identity, dt);
    if (held.members.length === object.fragments.length) return;
    // Candidates belong to this original object only. A collected cluster moves
    // as one rigid unit, so previous assembly progress survives every release.
    for (const candidate of [...object.units]) {
      if (candidate === held || !candidate.body) continue;
      let nearest = Infinity;
      for (const fragment of candidate.members) {
        scratch.copy(fragment.homePosition).sub(candidate.anchor.homePosition)
          .applyQuaternion(candidate.quaternion).add(candidate.position);
        nearest = Math.min(nearest, scratch.distanceTo(held.position));
      }
      if (nearest > MAGNET_RADIUS * (candidate.magnetized ? 1.12 : 1)) {
        if (candidate.magnetized) {
          candidate.magnetized = false;
          releaseGrabbedBody(candidate.body);
        }
        continue;
      }
      const target = scratch.copy(candidate.anchor.homePosition).sub(held.anchor.homePosition)
        .applyQuaternion(held.quaternion).add(held.position);
      const distance = candidate.position.distanceTo(target);
      if (distance <= 0.026 && candidate.quaternion.angleTo(held.quaternion) < 0.20 && canJoinUnit(candidate, held)) {
        joinUnit(candidate);
        continue;
      }
      candidate.magnetized = true;
      // Gentle at the edge, steeply accelerating over the final few centimetres.
      const speed = 0.10 + 5.4 * Math.exp(-5 * distance / MAGNET_RADIUS);
      driveGrabbedBody(world, candidate.body, target, held.quaternion, dt, { maxSpeed: speed });
    }
  }

  function restore() {
    if (!ready || restoring || disposed || !objects.some((object) => object.broken)) return false;
    cancelGrabs();
    restoring = true;
    restoreTime = 0;
    accumulator = 0;
    for (const object of objects) {
      if (!object.broken) continue;
      object.docking = null;
      object.mesh.visible = false;
      for (const unit of object.units) { syncUnit(unit); removeBody(unit); }
      object.mesh.visible = false;
      for (const fragment of object.fragments) {
        fragment.mesh.visible = true;
        fragment.returnPosition.copy(fragment.mesh.position);
        fragment.returnQuaternion.copy(fragment.mesh.quaternion);
      }
    }
    refreshTargets();
    notify();
    return true;
  }

  function stepRestore(dt) {
    restoreTime += dt;
    const progress = Math.min(restoreTime / RESTORE_SECONDS, 1);
    const smooth = progress * progress * (3 - 2 * progress);
    for (const object of objects) {
      if (!object.broken) continue;
      for (const fragment of object.fragments) {
        fragment.mesh.position.lerpVectors(fragment.returnPosition, fragment.homePosition, smooth);
        fragment.mesh.quaternion.slerpQuaternions(fragment.returnQuaternion, fragment.homeQuaternion, smooth);
        fragment.mesh.position.y += Math.sin(progress * Math.PI) * 0.18;
      }
    }
    if (progress >= 1) {
      for (const object of objects) if (object.broken) resetObjectHome(object);
      restoring = false;
      refreshTargets();
      notify();
    }
  }

  function stepDocking(dt) {
    let changed = false;
    for (const object of objects) {
      const dock = object.docking;
      if (!dock) continue;
      dock.elapsed += dt;
      const aligned = dock.unit.position.distanceTo(dock.unit.anchor.homePosition) <= .012
        && dock.unit.quaternion.angleTo(identity) <= .025;
      if (aligned && isDockHomeClear(object)) {
        resetObjectHome(object);
        emit('dock', object, object.homePosition, { strength: 0.85 });
        changed = true;
      } else if (dock.elapsed > DOCK_SECONDS * 4 || !isDockHomeClear(object)) {
        // A newly occupied slot or a blocked path cancels the return. Restore
        // weight and leave the object at its real physical pose so it falls.
        releaseGrabbedBody(dock.unit.body);
        object.docking = null;
        changed = true;
      } else {
        driveGrabbedBody(world, dock.unit.body, dock.unit.anchor.homePosition, identity, dt,
          { positionGain: 16, maxSpeed: 2.8, acceleration: 24 });
      }
    }
    if (changed) { refreshTargets(); notify(); }
  }

  function drainCollisionSounds() {
    events.drainCollisionEvents((handleA, handleB, started) => {
      if (!started || elapsed - lastCollisionTime < 0.045) return;
      const a = colliderUnits.get(handleA);
      const b = colliderUnits.get(handleB);
      if (!a && !b || a?.unit === b?.unit) return;
      const source = a || b;
      if (source.unit.object.age < 0.15) return;
      scratch.copy(a?.unit.velocity || { x: 0, y: 0, z: 0 }).sub(b?.unit.velocity || { x: 0, y: 0, z: 0 });
      const speed = scratch.length();
      if (speed < 0.32) return;
      const pair = handleA < handleB ? `${handleA}:${handleB}` : `${handleB}:${handleA}`;
      if (elapsed - (collisionTimes.get(pair) ?? -Infinity) < 0.18) return;
      collisionTimes.set(pair, elapsed);
      lastCollisionTime = elapsed;
      emit('collision', source.unit.object, source.fragment.mesh.position, {
        strength: THREE.MathUtils.clamp(speed / 3.5, 0.1, 1),
        otherObjectId: (source === a ? b : a)?.unit.object.spec.id || null,
      });
    });
    for (const [pair, time] of collisionTimes) if (elapsed - time > 1) collisionTimes.delete(pair);
  }

  function step(dt) {
    if (!ready || disposed) return 1;
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.05) : 0;
    if (restoring) { stepRestore(delta); return 1; }
    accumulator += delta;
    while (accumulator >= FIXED_STEP) {
      elapsed += FIXED_STEP;
      for (const object of objects) {
        if (!object.broken) continue;
        object.age += FIXED_STEP;
        for (const unit of object.units) {
          if (!unit.body) continue;
          unit.previousPosition.copy(unit.position);
          unit.previousQuaternion.copy(unit.quaternion);
          unit.velocity.copy(unit.body.linvel());
        }
      }
      beforePhysicsStep(FIXED_STEP);
      updateGrab(FIXED_STEP);
      stepDocking(FIXED_STEP);
      world.step(events, physicsHooks);
      drainCollisionSounds();
      afterPhysicsStep(FIXED_STEP);
      for (const object of objects) {
        if (!object.broken) continue;
        for (const unit of object.units) {
          if (!unit.body) continue;
          unit.position.copy(unit.body.translation());
          unit.quaternion.copy(unit.body.rotation());
          if (unit.position.y < -2 || unit.position.x < bounds.minX - 2 || unit.position.x > bounds.maxX + 2 || unit.position.z < bounds.minZ - 2 || unit.position.z > bounds.maxZ + 2) {
            unit.position.set(THREE.MathUtils.clamp(unit.position.x, bounds.minX + 0.4, bounds.maxX - 0.4), 0.12, THREE.MathUtils.clamp(unit.position.z, bounds.minZ + 0.4, bounds.maxZ - 0.4));
            unit.previousPosition.copy(unit.position);
            unit.body.setTranslation(unit.position, false);
            unit.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
            unit.body.sleep();
          }
        }
      }
      if (grab) {
        grab.velocity.copy(grab.unit.position).sub(grab.unit.previousPosition).multiplyScalar(1 / FIXED_STEP);
        grab.speed = grab.velocity.length();
      }
      accumulator -= FIXED_STEP;
    }
    const alpha = accumulator / FIXED_STEP;
    for (const object of objects) {
      if (!object.broken) continue;
      for (const unit of object.units) syncUnit(unit, alpha);
    }
    return alpha;
  }

  // Warehouse contents stay physically dormant and unselectable while packed.
  // Their immutable repair layout is rebased only before they are revealed.
  function placeObject(id, position, quaternion = identity, { visible = true, rebaseHome = true, dynamic = false } = {}) {
    const object = objectById.get(id);
    if (!object || object.broken || !position?.isVector3 || disposed) return false;
    if (object.intactCollider) world.removeCollider(object.intactCollider, true);
    object.intactCollider = null;
    const rotation = quaternion.clone().multiply(object.homeQuaternion.clone().invert());
    if (rebaseHome) {
      for (const fragment of object.fragments) {
        fragment.homePosition.sub(object.homePosition).applyQuaternion(rotation).add(position);
        fragment.homeQuaternion.premultiply(rotation);
        fragment.mesh.position.copy(fragment.homePosition);
        fragment.mesh.quaternion.copy(fragment.homeQuaternion);
      }
      object.homePosition.copy(position);
      object.homeQuaternion.copy(quaternion);
    }
    object.mesh.position.copy(position);
    object.mesh.quaternion.copy(quaternion);
    object.enabled = visible;
    object.mesh.visible = visible;
    if (visible && dynamic) {
      object.broken = true;
      const q = quaternion.clone().multiply(object.homeQuaternion.clone().invert());
      const anchor = object.fragments[0].homePosition.clone().sub(object.homePosition).applyQuaternion(q).add(position);
      const unit = makeUnit(object, object.fragments, anchor, q);
      addBody(unit);
      syncUnit(unit);
    } else addIntactCollider(object);
    refreshTargets();
    return true;
  }

  function resetImmediately() {
    cancelGrabs();
    restoring = false;
    accumulator = 0;
    for (const object of objects) resetObjectHome(object);
    refreshTargets();
    notify();
  }

  function dispose() {
    if (disposed) return;
    cancelGrabs();
    disposed = true;
    ready = false;
    targets.length = 0;
    grabTargets.length = 0;
    colliderUnits.clear();
    collisionTimes.clear();
    events.free();
    world.free();
    for (const object of objects) {
      scene.remove(object.mesh);
      object.mesh.geometry.dispose();
      for (const fragment of object.fragments) { scene.remove(fragment.mesh); fragment.mesh.geometry.dispose(); }
      object.mesh.material.dispose();
      object.fragments[0].mesh.material[1].dispose();
    }
  }

  function registerExternalCollider(collider, unit, mesh) {
    colliderUnits.set(collider.handle, { unit, fragment: { mesh } });
  }
  function unregisterExternalCollider(handle) { colliderUnits.delete(handle); }

  ready = true;
  refreshTargets();
  notify();
  return { targets, grabTargets, step, hit, nudge, beginGrab, moveGrab, endGrab, cancelGrabs, restore, getState, getGrabState, dispose, placeObject, resetImmediately, physicsWorld: world, registerExternalCollider, unregisterExternalCollider };
}
