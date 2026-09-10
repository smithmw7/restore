import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createDestructionLab, OBJECT_SPECS } from './destruction.js';

export const WAREHOUSE_BOUNDS = Object.freeze({ minX: -11.4, maxX: 11.4, minZ: -26.4, maxZ: 6.4 });
const IDENTITY = new THREE.Quaternion();
const emptyGrab = () => ({ active: false, objectId: null, anchor: null, radius: 0, assembled: 0, total: 0, complete: false, speed: 0, goal: null, canDock: false, heldMesh: null });
const finitePoint = (point) => point?.isVector3 && Number.isFinite(point.x + point.y + point.z);

// Seeded positions and dimensions keep this collection reproducible across
// reloads and let resets reuse every mesh and collider description.
export function createCrateSpecs(count = 24, seed = 1701) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const specs = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / 4);
    const lane = index % 4;
    const width = [0.92, 1.12, 0.82, 1.20][index % 4];
    const height = [0.90, 1.04, 0.82, 1.18][(index + row) % 4];
    const depth = [0.96, 0.84, 1.12][index % 3];
    let x = [-3.15, -1.65, 1.65, 3.15][lane] + (random() - 0.5) * 0.10;
    let z = 1 - row * 3.05 + (random() - 0.5) * 0.20;
    let y = height / 2 + 0.012;
    if (lane === 3 && (row === 1 || row === 4)) {
      const below = specs[index - 1];
      x = below.x; z = below.z;
      y = below.y + below.height / 2 + height / 2 + 0.012;
    }
    specs.push({ id: `crate-${String(index + 1).padStart(2, '0')}`, artifactId: `artifact-${String(index + 1).padStart(2, '0')}`,
      index, width, height, depth, x, y, z, yaw: (random() - 0.5) * 0.08, soundId: 'cube', kind: 'crate' });
  }
  return specs;
}

function boxGeometry(width, height, depth, x = 0, y = 0, z = 0, rotation = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  if (rotation) geometry.rotateZ(rotation);
  return geometry.translate(x, y, z);
}

function mergeAndDispose(parts) {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

function createPanelDefinitions(spec) {
  const { width: w, height: h, depth: d } = spec;
  const t = 0.055;
  const rail = 0.065;
  const horizontal = (side) => ({
    center: new THREE.Vector3(0, 0, side * (d / 2 - t / 2)), size: new THREE.Vector3(w, h, t),
    geometry: mergeAndDispose([
      boxGeometry(w, h, t),
      boxGeometry(w, rail, t * 0.65, 0, h / 2 - rail, side * t * 0.65),
      boxGeometry(w, rail, t * 0.65, 0, -h / 2 + rail, side * t * 0.65),
      boxGeometry(rail, h - rail * 2, t * 0.65, -w / 2 + rail, 0, side * t * 0.65),
      boxGeometry(rail, h - rail * 2, t * 0.65, w / 2 - rail, 0, side * t * 0.65),
      boxGeometry(Math.hypot(w - rail * 3, h - rail * 3), rail * 0.8, t * 0.6, 0, 0, side * t * 0.65, Math.atan2(h - rail * 3, w - rail * 3)),
    ]),
  });
  return [horizontal(1), horizontal(-1),
    { center: new THREE.Vector3(-w / 2 + t / 2, 0, 0), size: new THREE.Vector3(t, h, d - t * 2), geometry: boxGeometry(t, h, d - t * 2) },
    { center: new THREE.Vector3(w / 2 - t / 2, 0, 0), size: new THREE.Vector3(t, h, d - t * 2), geometry: boxGeometry(t, h, d - t * 2) },
    { center: new THREE.Vector3(0, -h / 2 + t / 2, 0), size: new THREE.Vector3(w - t * 2, t, d - t * 2), geometry: boxGeometry(w - t * 2, t, d - t * 2) },
    { center: new THREE.Vector3(0, h / 2 - t / 2, 0), size: new THREE.Vector3(w - t * 2, t, d - t * 2), geometry: boxGeometry(w - t * 2, t, d - t * 2) },
  ];
}

/** One physical world for packed crates, revealed artifacts, and loose pieces. */
export async function createWarehouseGameplay({ scene, materials = {}, onEvent = () => {}, onProgress = () => {}, onChange = () => {},
  obstacles = [], bounds = WAREHOUSE_BOUNDS, crateCount = 24, seed = 1701,
} = {}) {
  const crateSpecs = createCrateSpecs(crateCount, seed);
  const targets = [];
  const grabTargets = [];
  const occluders = [];
  const crates = [];
  const crateById = new Map();
  let held = null;
  let lab = null;
  let disposed = false;
  let elapsed = 0;
  let ready = false;
  let resetCount = 0;
  const scratch = new THREE.Vector3();
  const obstacleBoxes = [];
  const ownMaterials = [];
  const defaultWood = materials.wood || new THREE.MeshStandardMaterial({ color: '#72553c', roughness: 0.85 });
  if (!materials.wood) ownMaterials.push(defaultWood);
  const collectionMaterials = [
    ['ceramic', 'marble', 'bronze', 'stone', 'ceramic', 'concrete', 'gold', 'metal'],
    ['copper', 'stone', 'gold', 'marble', 'bronze', 'marble', 'copper', 'concrete'],
    ['marble', 'bronze', 'copper', 'gold', 'ceramic', 'stone', 'bronze', 'ceramic'],
  ];
  const materialSounds = { ceramic: 'vase', marble: 'gem', bronze: 'orb', copper: 'orb', stone: 'gem', concrete: 'column', gold: 'ring', metal: 'tablet' };
  const warehouseForms = { cube: { form: 'obelisk', halfHeight: 0.27 }, orb: { form: 'chalice', halfHeight: 0.27 }, tablet: { form: 'stela', halfHeight: 0.292 } };
  const artifactSpecs = crateSpecs.map((crate, index) => {
    const base = OBJECT_SPECS[index % OBJECT_SPECS.length];
    const materialKey = collectionMaterials[Math.floor(index / 8) % collectionMaterials.length][index % 8];
    const silhouette = warehouseForms[base.id] || { form: base.id, halfHeight: base.halfHeight };
    return { ...base, ...silhouette, id: crate.artifactId, kind: 'artifact',
      soundId: materialSounds[materialKey], x: crate.x, y: crate.y - crate.height / 2 + 0.08 + silhouette.halfHeight, z: crate.z,
      label: base.label, materialKey,
      fragmentCount: 12, seed: base.seed, initialHidden: true, pedestalHeight: 0 };
  });

  function emit(type, crate, position, extra = {}) {
    onEvent({ type, objectId: crate.spec.id, soundId: 'cube', position: position.clone(), ...extra });
  }

  function refreshTargets() {
    targets.length = 0; grabTargets.length = 0; occluders.length = 0;
    if (lab) { targets.push(...lab.targets); grabTargets.push(...lab.grabTargets); }
    for (const crate of crates) {
      if (!crate.open) {
        targets.push(crate.mesh); grabTargets.push(crate.mesh); occluders.push(crate.mesh);
      } else {
        for (const panel of crate.panels) if (panel.mesh.visible) grabTargets.push(panel.mesh);
      }
    }
  }

  function notify() { if (ready) onChange(getState()); }

  lab = await createDestructionLab({ scene, specs: artifactSpecs, wholeObjects: true, pedestals: false, bounds, statics: obstacles,
    materialForSpec: (spec) => ({ outside: materials[spec.materialKey], inside: ['gold', 'bronze', 'copper', 'metal'].includes(spec.materialKey) ? materials[spec.materialKey] : materials.stone }),
    onProgress,
    onChange: () => { refreshTargets(); notify(); },
    onEvent,
  });
  const world = lab.physicsWorld;

  function registerBody(part, colliderDescriptions, type = 'dynamic') {
    const position = part.mesh.position;
    const quaternion = part.mesh.quaternion;
    const desc = type === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    const body = world.createRigidBody(desc.setTranslation(position.x, position.y, position.z).setRotation(quaternion)
      .setLinearDamping(0.7).setAngularDamping(1.4).setCcdEnabled(true));
    part.body = body;
    part.handles = [];
    part.velocity.set(0, 0, 0);
    for (const description of colliderDescriptions) {
      const collider = world.createCollider(description.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      part.handles.push(collider.handle);
      lab.registerExternalCollider(collider, part, part.mesh);
    }
    return body;
  }

  function removeBody(part) {
    for (const handle of part.handles || []) lab.unregisterExternalCollider(handle);
    if (part.body) world.removeRigidBody(part.body);
    part.body = null;
    part.handles = [];
  }

  for (const spec of crateSpecs) {
    const definitions = createPanelDefinitions(spec);
    const closedGeometry = mergeAndDispose(definitions.map((panel) => panel.geometry.clone().translate(panel.center.x, panel.center.y, panel.center.z)));
    const mesh = new THREE.Mesh(closedGeometry, defaultWood);
    mesh.position.set(spec.x, spec.y, spec.z);
    mesh.rotation.y = spec.yaw;
    mesh.castShadow = true; mesh.receiveShadow = true;
    Object.assign(mesh.userData, { labObject: spec.id, soundId: 'cube', kind: 'crate', wholeGrabbable: true });
    mesh.name = spec.id;
    scene.add(mesh);
    const crate = { spec, mesh, open: false, age: 1, body: null, handles: [], velocity: new THREE.Vector3(),
      homePosition: mesh.position.clone(), homeQuaternion: mesh.quaternion.clone(), panels: [], box: new THREE.Box3(), object: null };
    crate.object = crate;
    crate.descriptions = definitions.map((definition) => RAPIER.ColliderDesc.cuboid(definition.size.x / 2, definition.size.y / 2, definition.size.z / 2)
      .setTranslation(definition.center.x, definition.center.y, definition.center.z).setFriction(0.78).setRestitution(0.06).setDensity(90));
    crate.panels = definitions.map((definition, index) => {
      const panelMesh = new THREE.Mesh(definition.geometry, defaultWood);
      panelMesh.visible = false; panelMesh.castShadow = true; panelMesh.receiveShadow = true;
      Object.assign(panelMesh.userData, { labObject: spec.id, soundId: 'cube', kind: 'crate-piece', panelIndex: index });
      panelMesh.name = `${spec.id}-panel-${index}`;
      scene.add(panelMesh);
      return { mesh: panelMesh, offset: definition.center, size: definition.size, body: null, handles: [], object: crate,
        velocity: new THREE.Vector3(), description: RAPIER.ColliderDesc.cuboid(definition.size.x / 2, definition.size.y / 2, definition.size.z / 2)
          .setFriction(0.72).setRestitution(0.12).setDensity(90) };
    });
    crates.push(crate); crateById.set(spec.id, crate);
    registerBody(crate, crate.descriptions).sleep();
  }

  function artifactPose(crate) {
    const artifact = artifactSpecs[crate.spec.index];
    const local = new THREE.Vector3(0, -crate.spec.height / 2 + 0.08 + artifact.halfHeight, 0);
    return { position: local.applyQuaternion(crate.mesh.quaternion).add(crate.mesh.position), quaternion: crate.mesh.quaternion.clone() };
  }

  function getGrabState() {
    if (!held) return lab ? lab.getGrabState() : emptyGrab();
    return { active: true, objectId: held.crate.spec.id, soundId: 'cube', kind: held.panel ? 'crate-piece' : 'crate', whole: true,
      handId: held.handId, anchor: held.part.mesh.position.toArray(), radius: 0,
      assembled: 1, total: 1, complete: true, speed: held.speed,
      goal: held.goal.toArray(), canDock: false, heldMesh: held.part.mesh };
  }

  function getState() {
    const base = lab?.getState() || { ready: false, intact: 0, broken: 0, debris: 0, restoring: false, total: 0, objects: [] };
    const { heldMesh, ...grab } = getGrabState();
    const opened = crates.filter((crate) => crate.open).length;
    return { ...base, ready, mode: 'warehouse', crateCount: crates.length, openedCrates: opened,
      closedCrates: crates.length - opened, revealedArtifacts: opened,
      debris: base.debris + opened * 6, grab, resetCount,
      crates: crates.map((crate) => ({ id: crate.spec.id, artifactId: crate.spec.artifactId, state: crate.open ? 'open' : held?.crate === crate ? 'held' : 'closed',
        position: crate.mesh.position.toArray(), dimensions: [crate.spec.width, crate.spec.height, crate.spec.depth] })),
    };
  }

  function hit(mesh, point, direction) {
    if (!ready || disposed || held || lab.getGrabState().active) return false;
    const crate = crateById.get(mesh?.userData?.labObject);
    if (!crate) return lab.hit(mesh, point, direction);
    if (crate.open || mesh !== crate.mesh) return false;
    const velocity = crate.body ? new THREE.Vector3().copy(crate.body.linvel()) : new THREE.Vector3();
    removeBody(crate);
    crate.open = true; crate.age = 0;
    crate.mesh.visible = false;
    const push = direction?.isVector3 ? direction.clone().normalize() : new THREE.Vector3(0, 0, -1);
    for (let index = 0; index < crate.panels.length; index++) {
      const panel = crate.panels[index];
      panel.mesh.position.copy(panel.offset).applyQuaternion(crate.mesh.quaternion).add(crate.mesh.position);
      panel.mesh.quaternion.copy(crate.mesh.quaternion);
      panel.mesh.visible = true;
      const body = registerBody(panel, [panel.description]);
      const outward = panel.offset.clone().normalize().applyQuaternion(crate.mesh.quaternion).multiplyScalar(index === 4 ? 0.45 : 1.25);
      outward.addScaledVector(push, 0.3).addScaledVector(velocity, 0.25);
      outward.y += index === 4 ? 0.08 : 0.85;
      body.setLinvel(outward, true);
      body.setAngvel({ x: Math.sin(index * 2.7) * 2.3, y: Math.cos(index * 1.9) * 1.5, z: Math.sin(index * 1.1) * 2.3 }, true);
    }
    const pose = artifactPose(crate);
    lab.placeObject(crate.spec.artifactId, pose.position, pose.quaternion, { visible: true, rebaseHome: true, dynamic: true });
    emit('break', crate, finitePoint(point) ? point : crate.mesh.position, { strength: 0.9 });
    refreshTargets(); notify();
    return true;
  }

  function beginGrab(mesh, worldPoint, handId = 'primary') {
    if (!ready || disposed || held || lab.getGrabState().active || !finitePoint(worldPoint) || !grabTargets.includes(mesh)) return false;
    const crate = crateById.get(mesh?.userData?.labObject);
    if (!crate) return lab.beginGrab(mesh, worldPoint, handId);
    const panel = Number.isInteger(mesh.userData.panelIndex) ? crate.panels[mesh.userData.panelIndex] : null;
    const part = panel || crate;
    if (!part.body || !part.mesh.visible) return false;
    // Kinematic dragging preserves contact with surrounding piles and artifacts.
    part.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    held = { crate, part, panel, handId, offset: part.mesh.position.clone().sub(worldPoint),
      goal: part.mesh.position.clone(), speed: 0, velocity: new THREE.Vector3() };
    emit('pickup', crate, part.mesh.position, { complete: true, whole: true, assembled: 1, total: 1 });
    notify();
    return true;
  }

  function moveGrab(worldPoint, handId = 'primary') {
    if (!held) return lab.moveGrab(worldPoint, handId);
    if (held.handId !== handId || !finitePoint(worldPoint)) return false;
    held.goal.copy(worldPoint).add(held.offset);
    const margin = held.panel ? 0.15 : Math.max(held.crate.spec.width, held.crate.spec.depth) / 2;
    held.goal.x = THREE.MathUtils.clamp(held.goal.x, bounds.minX + margin, bounds.maxX - margin);
    held.goal.y = THREE.MathUtils.clamp(held.goal.y, held.panel ? 0.12 : held.crate.spec.height / 2 + 0.03, 5.8);
    held.goal.z = THREE.MathUtils.clamp(held.goal.z, bounds.minZ + margin, bounds.maxZ - margin);
    return true;
  }

  function endGrab(handId = 'primary', { cancelled = false } = {}) {
    if (!held) return lab.endGrab(handId, { cancelled });
    if (held.handId !== handId) return false;
    const previous = held;
    held = null;
    previous.part.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    previous.part.body.setLinvel(cancelled ? { x: 0, y: 0, z: 0 } : previous.velocity.clone().clampLength(0, 3), true);
    emit('enddrag', previous.crate, previous.part.mesh.position, { reason: cancelled ? 'cancelled' : 'release' });
    if (!cancelled) emit('drop', previous.crate, previous.part.mesh.position, { strength: THREE.MathUtils.clamp(0.45 + previous.speed * 0.12, 0.45, 1), complete: true });
    notify();
    return true;
  }

  function cancelGrabs() {
    if (held) return endGrab(held.handId, { cancelled: true });
    return lab.cancelGrabs();
  }

  function restore() {
    if (!ready || disposed) return false;
    cancelGrabs();
    lab.resetImmediately();
    for (const crate of crates) {
      removeBody(crate);
      for (const panel of crate.panels) { removeBody(panel); panel.mesh.visible = false; }
      crate.open = false; crate.age = 1;
      crate.mesh.visible = true;
      crate.mesh.position.copy(crate.homePosition);
      crate.mesh.quaternion.copy(crate.homeQuaternion);
      registerBody(crate, crate.descriptions).sleep();
      const pose = artifactPose(crate);
      lab.placeObject(crate.spec.artifactId, pose.position, pose.quaternion, { visible: false, rebaseHome: true });
    }
    resetCount++;
    refreshTargets(); notify();
    return true;
  }

  function step(dt) {
    if (!ready || disposed) return;
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.05) : 0;
    if (!delta) return;
    elapsed += delta;
    for (const crate of crates) {
      crate.age += delta;
      for (const part of crate.open ? crate.panels : [crate]) if (part.body) part.velocity.copy(part.body.linvel());
    }
    if (held) {
      const next = scratch.copy(held.part.mesh.position).lerp(held.goal, 1 - Math.exp(-10 * delta));
      held.velocity.copy(next).sub(held.part.mesh.position).divideScalar(delta);
      held.speed = held.velocity.length();
      held.part.body.setNextKinematicTranslation(next);
      held.part.body.setNextKinematicRotation(held.part.mesh.quaternion.clone().slerp(held.panel ? IDENTITY : held.crate.homeQuaternion, 1 - Math.exp(-6 * delta)));
    }
    lab.step(delta);
    for (const crate of crates) {
      for (const part of crate.open ? crate.panels : [crate]) {
        if (!part.body) continue;
        part.mesh.position.copy(part.body.translation());
        part.mesh.quaternion.copy(part.body.rotation());
        const p = part.mesh.position;
        if (p.y < -2 || p.x < bounds.minX - 1 || p.x > bounds.maxX + 1 || p.z < bounds.minZ - 1 || p.z > bounds.maxZ + 1) {
          p.set(THREE.MathUtils.clamp(p.x, bounds.minX + 0.8, bounds.maxX - 0.8), crate.spec.height / 2 + 0.15, THREE.MathUtils.clamp(p.z, bounds.minZ + 0.8, bounds.maxZ - 0.8));
          part.body.setTranslation(p, true);
          part.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        // Rapier sleeps settled bodies naturally. A still-handed release starts
        // with zero velocity even in midair, so age/speed alone must not sleep it.
      }
    }
  }

  function getObstacles() {
    obstacleBoxes.length = 0;
    obstacleBoxes.push(...obstacles);
    for (const crate of crates) {
      if (crate.open || held?.crate === crate) continue;
      crate.mesh.updateMatrixWorld(true);
      crate.box.setFromObject(crate.mesh);
      obstacleBoxes.push(crate.box);
    }
    return obstacleBoxes;
  }

  function dispose() {
    if (disposed) return;
    cancelGrabs();
    for (const crate of crates) {
      removeBody(crate);
      scene.remove(crate.mesh); crate.mesh.geometry.dispose();
      for (const panel of crate.panels) { removeBody(panel); scene.remove(panel.mesh); panel.mesh.geometry.dispose(); }
    }
    disposed = true; ready = false;
    lab.dispose();
    targets.length = 0; grabTargets.length = 0; occluders.length = 0;
    for (const material of ownMaterials) material.dispose();
  }

  ready = true;
  refreshTargets(); notify();
  return { targets, grabTargets, occluders, hit, beginGrab, moveGrab, endGrab, cancelGrabs, restore, step, getGrabState, getState, getObstacles, dispose };
}
