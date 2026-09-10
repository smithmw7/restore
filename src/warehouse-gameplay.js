import * as THREE from 'three';
import { nudgeBody } from './tap-influence.js';
import { driveGrabbedBody, releaseGrabbedBody } from './physical-drag.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createDestructionLab } from './destruction.js';
import { ARTIFACT_CATALOG, createArtifactGeometry } from './artifact-forms.js';
import { fitArtifactToCrate } from './artifact-fit.js';
import { createAlienMaterials } from './artifact-materials.js';
import { createContactAudioProbe, setContactSurface } from './contact-audio.js';

export const WAREHOUSE_BOUNDS = Object.freeze({ minX: -11.4, maxX: 11.4, minZ: -26.4, maxZ: 6.4 });
const IDENTITY = new THREE.Quaternion();
// Raised braces project beyond the 55 mm board. Include their outer surface
// in contact bounds so a face-down board or a pressed crate cannot sink in.
const BRACED_DEPTH = 0.081125;
const BRACE_OFFSET = 0.0130625;
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
  obstacles = [], bounds = WAREHOUSE_BOUNDS, crateCount = 24, seed = 1701, additionalCrates = [], excludeRegions = [],
} = {}) {
  const crateSpecs = [...createCrateSpecs(crateCount, seed), ...additionalCrates].filter(spec => {
    const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(spec.x,spec.y,spec.z),new THREE.Vector3(spec.width+.2,spec.height,spec.depth+.2));
    return !excludeRegions.some(region=>region.intersectsBox(box));
  }).map((spec, index) => ({ ...spec, index }));
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
  const obstacleBoxes = [];
  const ownMaterials = [];
  const defaultWood = materials.wood || new THREE.MeshStandardMaterial({ color: '#72553c', roughness: 0.85 });
  if (!materials.wood) ownMaterials.push(defaultWood);
  // All closed crates share one draw, including the remote stacks. Lightweight
  // mesh proxies keep ray/hand interaction identical to the individual panels.
  const closedDefinitions = createPanelDefinitions({ width: 1, height: 1, depth: 1 });
  const panelGeometries = [closedDefinitions[0].geometry.clone(), closedDefinitions[1].geometry.clone(), new THREE.BoxGeometry(1, 1, 1)];
  const closedGeometry = mergeAndDispose(closedDefinitions.map((panel) => panel.geometry.translate(panel.center.x, panel.center.y, panel.center.z)));
  const closedBatch = new THREE.InstancedMesh(closedGeometry, defaultWood, crateSpecs.length);
  closedBatch.name = 'All breakable warehouse crates';
  closedBatch.castShadow = true; closedBatch.receiveShadow = true;
  closedBatch.frustumCulled = false;
  closedBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
  ownMaterials.push(proxyMaterial);
  scene.add(closedBatch);
  const panelBatches = panelGeometries.map((geometry, index) => {
    const batch = new THREE.InstancedMesh(geometry, defaultWood, crateSpecs.length * (index === 2 ? 4 : 1));
    batch.name = `Breakable crate boards / ${['front', 'back', 'plain'][index]}`;
    batch.castShadow = true; batch.receiveShadow = true; batch.frustumCulled = false; batch.visible = false;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(batch); return batch;
  });
  const instanceTransform = new THREE.Object3D();

  function syncCrateInstance(crate) {
    instanceTransform.position.copy(crate.mesh.position);
    instanceTransform.quaternion.copy(crate.mesh.quaternion);
    instanceTransform.scale.copy(crate.mesh.scale).multiplyScalar(crate.open ? 0 : 1);
    instanceTransform.updateMatrix();
    closedBatch.setMatrixAt(crate.instanceIndex, instanceTransform.matrix);
    closedBatch.instanceMatrix.needsUpdate = true;
  }

  function syncPanelInstance(panel) {
    instanceTransform.position.copy(panel.mesh.position);
    instanceTransform.quaternion.copy(panel.mesh.quaternion);
    instanceTransform.scale.copy(panel.renderScale).multiplyScalar(panel.mesh.visible ? 1 : 0);
    instanceTransform.updateMatrix();
    panel.renderBatch.setMatrixAt(panel.instanceIndex, instanceTransform.matrix);
    panel.renderBatch.instanceMatrix.needsUpdate = true;
  }
  const alienMaterials = createAlienMaterials(materials);
  const collection = ARTIFACT_CATALOG.filter((entry) => entry.form !== 'obelisk');
  const materialSounds = { ceramic: 'vase', marble: 'gem', bronze: 'orb', copper: 'orb', stone: 'gem', concrete: 'column', gold: 'ring', metal: 'tablet' };
  const artifactSpecs = crateSpecs.map((crate, index) => {
    const entry = index === 1 ? ARTIFACT_CATALOG.find((item) => item.form === 'obelisk') : collection[(Math.max(0, index - 1)) % collection.length];
    const fit = fitArtifactToCrate(entry.form, crate);
    const variation = Math.floor(index / collection.length);
    const materialKey = variation % 3 === 2 && ['copper', 'bronze', 'gold'].includes(entry.materialKey)
      ? ['bronze', 'gold', 'copper'][variation % 3] : entry.materialKey;
    return { ...entry, ...fit, id: crate.artifactId, kind: 'artifact', materialKey,
      color: entry.category === 'alien' ? '#8ca5ae' : '#cfb88e', accent: ['#68e8d5', '#ffad59', '#8ea6ff'][(index + variation) % 3],
      soundId: materialSounds[materialKey], x: crate.x, y: crate.y + fit.crateOffsetY, z: crate.z,
      fractureKey: entry.form, fractureScale: fit.scale, initialHidden: true, pedestalHeight: 0 };
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
    // Resolve heavy crate / tiny shard contacts enough for entire piles to rest.
    solverIterations: 8,
    geometryForSpec: (spec) => createArtifactGeometry(spec.form).scale(spec.scale, spec.scale, spec.scale),
    fractureGeometryForSpec: (spec) => createArtifactGeometry(spec.form),
    materialForSpec: (spec) => ({ outside: alienMaterials.get(spec), inside: ['gold', 'bronze', 'copper', 'metal'].includes(spec.materialKey) ? materials[spec.materialKey] : materials.stone }),
    onProgress,
    onChange: () => { refreshTargets(); notify(); },
    onEvent,
    beforePhysicsStep,
    afterPhysicsStep,
  });
  const world = lab.physicsWorld;
  const readContactAudio = createContactAudioProbe(world);

  function registerBody(part, colliderDescriptions, type = 'dynamic') {
    const position = part.mesh.position;
    const quaternion = part.mesh.quaternion;
    const desc = type === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    const body = world.createRigidBody(desc.setTranslation(position.x, position.y, position.z).setRotation(quaternion)
      .setLinearDamping(0.7).setAngularDamping(1.4).setCcdEnabled(true));
    part.body = body;
    part.position = position.clone();
    part.quaternion = quaternion.clone();
    part.previousPosition = position.clone();
    part.previousQuaternion = quaternion.clone();
    part.handles = [];
    part.velocity.set(0, 0, 0);
    for (const description of colliderDescriptions) {
      const collider = world.createCollider(description.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      setContactSurface(collider, 'wood');
      part.handles.push(collider.handle);
      lab.registerExternalCollider(collider, part, part.mesh);
    }
    return body;
  }

  function removeBody(part) {
    for (const handle of part.handles || []) lab.unregisterExternalCollider(handle);
    if (part.body) { releaseGrabbedBody(part.body); world.removeRigidBody(part.body); }
    part.body = null;
    part.handles = [];
  }

  for (const spec of crateSpecs) {
    const definitions = createPanelDefinitions(spec);
    const mesh = new THREE.Mesh(closedGeometry, proxyMaterial);
    mesh.position.set(spec.x, spec.y, spec.z);
    mesh.rotation.y = spec.yaw;
    mesh.scale.set(spec.width, spec.height, spec.depth);
    Object.assign(mesh.userData, { labObject: spec.id, soundId: 'cube', kind: 'crate', wholeGrabbable: true });
    mesh.name = spec.id;
    scene.add(mesh);
    const crate = { spec, mesh, instanceIndex: crates.length, open: false, age: 1, body: null, handles: [], velocity: new THREE.Vector3(),
      homePosition: mesh.position.clone(), homeQuaternion: mesh.quaternion.clone(), panels: [], box: new THREE.Box3(), object: null };
    crate.object = crate;
    // A sealed crate has no accessible interior. One solid contact shape avoids
    // interlocking panel seams when extracting boxes from settled stacks, and
    // costs less than six overlapping hulls. Keep the original wood mass.
    const woodMass = definitions.reduce((sum, definition) => sum + definition.size.x * definition.size.y * definition.size.z * 90, 0);
    crate.descriptions = [RAPIER.ColliderDesc.cuboid(spec.width / 2, spec.height / 2, (0.5 + BRACE_OFFSET * 2) * spec.depth)
      .setFriction(0.78).setRestitution(0.06).setMass(woodMass)];
    crate.panels = definitions.map((definition, index) => {
      const panelMesh = new THREE.Mesh(definition.geometry, proxyMaterial);
      panelMesh.visible = false;
      Object.assign(panelMesh.userData, { labObject: spec.id, soundId: 'cube', kind: 'crate-piece', panelIndex: index });
      panelMesh.name = `${spec.id}-panel-${index}`;
      scene.add(panelMesh);
      return { mesh: panelMesh, offset: definition.center, size: definition.size, body: null, handles: [], object: crate,
        renderBatch: panelBatches[Math.min(index, 2)], instanceIndex: index < 2 ? crate.instanceIndex : crate.instanceIndex * 4 + index - 2,
        renderScale: index < 2 ? new THREE.Vector3(spec.width, spec.height, 1) : definition.size.clone(),
        velocity: new THREE.Vector3(), description: RAPIER.ColliderDesc.cuboid(definition.size.x / 2, definition.size.y / 2, (index < 2 ? BRACED_DEPTH : definition.size.z) / 2)
          .setTranslation(0, 0, index < 2 ? (index === 0 ? 1 : -1) * BRACE_OFFSET : 0)
          .setFriction(0.72).setRestitution(0.12).setMass(definition.size.x * definition.size.y * definition.size.z * 90) };
    });
    crates.push(crate); crateById.set(spec.id, crate);
    closedBatch.setColorAt(crate.instanceIndex, new THREE.Color(spec.tint || '#ffffff'));
    syncCrateInstance(crate);
    for (const panel of crate.panels) {
      panel.renderBatch.setColorAt(panel.instanceIndex, new THREE.Color(spec.tint || '#ffffff'));
      syncPanelInstance(panel);
    }
    // Let the initially separated tiers settle into contact, so removing their
    // support wakes the rest of the stack and it can collapse naturally.
    registerBody(crate, crate.descriptions);
    const pose = artifactPose(crate);
    lab.placeObject(spec.artifactId, pose.position, pose.quaternion, { visible: false, rebaseHome: true });
  }
  closedBatch.instanceColor.needsUpdate = true;
  for (const batch of panelBatches) batch.instanceColor.needsUpdate = true;

  function artifactPose(crate) {
    const artifact = artifactSpecs[crate.spec.index];
    const local = new THREE.Vector3(0, artifact.crateOffsetY, 0);
    return { position: local.applyQuaternion(crate.mesh.quaternion).add(crate.mesh.position), quaternion: crate.mesh.quaternion.clone() };
  }

  function getGrabState() {
    if (!held) return lab ? lab.getGrabState() : emptyGrab();
    return { active: true, objectId: held.crate.spec.id, soundId: 'cube', kind: held.panel ? 'crate-piece' : 'crate', whole: true,
      handId: held.handId, anchor: held.part.mesh.position.toArray(), radius: 0,
      assembled: 1, total: 1, complete: true, speed: held.speed,
      surface: held.contact.surface, scrapeSpeed: held.contact.scrapeSpeed, load: held.contact.load,
      goal: held.goal.toArray(), canDock: false, heldMesh: held.part.mesh };
  }

  function getState() {
    const base = lab?.getState() || { ready: false, intact: 0, broken: 0, debris: 0, restoring: false, total: 0, objects: [] };
    const { heldMesh, ...grab } = getGrabState();
    const opened = crates.filter((crate) => crate.open).length;
    return { ...base, ready, mode: 'warehouse', crateCount: crates.length, storageCrates: additionalCrates.length,
      artifactForms: [...new Set(artifactSpecs.map((spec) => spec.form))], alienArtifacts: artifactSpecs.filter((spec) => spec.category === 'alien').length, openedCrates: opened,
      closedCrates: crates.length - opened, revealedArtifacts: opened,
      debris: base.debris + opened * 6, grab, resetCount,
      crates: crates.map((crate) => ({ id: crate.spec.id, artifactId: crate.spec.artifactId, state: crate.open ? 'open' : held?.crate === crate ? 'held' : 'closed',
        position: crate.mesh.position.toArray(), quaternion: crate.mesh.quaternion.toArray(), dimensions: [crate.spec.width, crate.spec.height, crate.spec.depth] })),
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
    syncCrateInstance(crate);
    const push = direction?.isVector3 ? direction.clone().normalize() : new THREE.Vector3(0, 0, -1);
    for (let index = 0; index < crate.panels.length; index++) {
      const panel = crate.panels[index];
      panel.mesh.position.copy(panel.offset).applyQuaternion(crate.mesh.quaternion).add(crate.mesh.position);
      panel.mesh.quaternion.copy(crate.mesh.quaternion);
      panel.mesh.visible = true;
      panel.renderBatch.visible = true;
      syncPanelInstance(panel);
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

  function nudge(mesh, point, direction, strength) {
    if (!ready || disposed || held || lab.getGrabState().active) return false;
    const crate = crateById.get(mesh?.userData?.labObject);
    if (!crate) return lab.nudge(mesh, point, direction, strength);
    if (crate.open || mesh !== crate.mesh || !crate.mesh.visible) return false;
    if (!nudgeBody(crate.body, point, direction, strength)) return false;
    emit('nudge', crate, point, { strength });
    return true;
  }

  function beginGrab(mesh, worldPoint, handId = 'primary') {
    if (!ready || disposed || held || lab.getGrabState().active || !finitePoint(worldPoint) || !grabTargets.includes(mesh)) return false;
    const crate = crateById.get(mesh?.userData?.labObject);
    if (!crate) return lab.beginGrab(mesh, worldPoint, handId);
    const panel = Number.isInteger(mesh.userData.panelIndex) ? crate.panels[mesh.userData.panelIndex] : null;
    const part = panel || crate;
    if (!part.body || !part.mesh.visible) return false;
    // Preserve the last physical pose and momentum. Rewinding to a rendered
    // interpolation sample could place the collider inside its neighbour.
    held = { crate, part, panel, handId, offset: part.position.clone().sub(worldPoint),
      goal: part.position.clone(), speed: 0, velocity: new THREE.Vector3(), contact: { surface: null, scrapeSpeed: 0, load: 0 } };
    emit('pickup', crate, part.mesh.position, { kind: panel ? 'crate-piece' : 'crate', complete: true, whole: true, assembled: 1, total: 1 });
    notify();
    return true;
  }

  function moveGrab(worldPoint, handId = 'primary') {
    if (!held) return lab.moveGrab(worldPoint, handId);
    if (held.handId !== handId || !finitePoint(worldPoint)) return false;
    held.goal.copy(worldPoint).add(held.offset);
    const margin = held.panel ? 0.15 : Math.max(held.crate.spec.width, held.crate.spec.depth) / 2;
    held.goal.x = THREE.MathUtils.clamp(held.goal.x, bounds.minX + margin, bounds.maxX - margin);
    // A low hand target may press the prop into contact for floor dragging.
    // Its dynamic collider, rather than a hovering target clamp, stops it.
    held.goal.y = THREE.MathUtils.clamp(held.goal.y, 0.01, 5.8);
    held.goal.z = THREE.MathUtils.clamp(held.goal.z, bounds.minZ + margin, bounds.maxZ - margin);
    return true;
  }

  function endGrab(handId = 'primary', { cancelled = false } = {}) {
    if (!held) return lab.endGrab(handId, { cancelled });
    if (held.handId !== handId) return false;
    const previous = held;
    held = null;
    releaseGrabbedBody(previous.part.body);
    if (cancelled) previous.part.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
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
      for (const panel of crate.panels) { removeBody(panel); panel.mesh.visible = false; syncPanelInstance(panel); }
      crate.open = false; crate.age = 1;
      crate.mesh.visible = true;
      crate.mesh.position.copy(crate.homePosition);
      crate.mesh.quaternion.copy(crate.homeQuaternion);
      registerBody(crate, crate.descriptions);
      syncCrateInstance(crate);
      const pose = artifactPose(crate);
      lab.placeObject(crate.spec.artifactId, pose.position, pose.quaternion, { visible: false, rebaseHome: true });
    }
    for (const batch of panelBatches) batch.visible = false;
    resetCount++;
    refreshTargets(); notify();
    return true;
  }

  function beforePhysicsStep(dt) {
    for (const crate of crates) {
      crate.age += dt;
      for (const part of crate.open ? crate.panels : [crate]) if (part.body) {
        part.previousPosition.copy(part.position);
        part.previousQuaternion.copy(part.quaternion);
        part.velocity.copy(part.body.linvel());
      }
    }
    if (held) {
      driveGrabbedBody(world, held.part.body, held.goal, held.panel ? IDENTITY : held.crate.homeQuaternion, dt);
    }
  }

  function afterPhysicsStep(dt) {
    for (const crate of crates) {
      for (const part of crate.open ? crate.panels : [crate]) {
        if (!part.body) continue;
        part.position.copy(part.body.translation());
        part.quaternion.copy(part.body.rotation());
        const p = part.position;
        if (p.y < -2 || p.x < bounds.minX - 1 || p.x > bounds.maxX + 1 || p.z < bounds.minZ - 1 || p.z > bounds.maxZ + 1) {
          p.set(THREE.MathUtils.clamp(p.x, bounds.minX + 0.8, bounds.maxX - 0.8), crate.spec.height / 2 + 0.15, THREE.MathUtils.clamp(p.z, bounds.minZ + 0.8, bounds.maxZ - 0.8));
          part.body.setTranslation(p, true);
          part.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          part.previousPosition.copy(p);
        }
      }
    }
    if (held) {
      held.velocity.copy(held.part.position).sub(held.part.previousPosition).divideScalar(dt);
      held.speed = held.velocity.length();
      readContactAudio(held.part.body, held.goal, held.contact);
    }
  }

  function step(dt) {
    if (!ready || disposed) return;
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.05) : 0;
    if (!delta) return;
    elapsed += delta;
    const alpha = lab.step(delta);
    for (const crate of crates) {
      for (const part of crate.open ? crate.panels : [crate]) {
        if (!part.body) continue;
        part.mesh.position.lerpVectors(part.previousPosition, part.position, alpha);
        part.mesh.quaternion.slerpQuaternions(part.previousQuaternion, part.quaternion, alpha);
        if (crate.open) syncPanelInstance(part); else syncCrateInstance(crate);
        // Rapier sleeps entire settled contact islands naturally. Never freeze
        // a body just because it is old or was released with zero velocity.
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
      scene.remove(crate.mesh);
      for (const panel of crate.panels) { removeBody(panel); scene.remove(panel.mesh); panel.mesh.geometry.dispose(); }
    }
    scene.remove(closedBatch); closedBatch.dispose(); closedGeometry.dispose();
    for (const batch of panelBatches) { scene.remove(batch); batch.dispose(); batch.geometry.dispose(); }
    disposed = true; ready = false;
    lab.dispose();
    alienMaterials.dispose();
    targets.length = 0; grabTargets.length = 0; occluders.length = 0;
    for (const material of ownMaterials) material.dispose();
  }

  ready = true;
  refreshTargets(); notify();
  return { targets, grabTargets, occluders, hit, nudge, beginGrab, moveGrab, endGrab, cancelGrabs, restore, step, getGrabState, getState, getObstacles, dispose, physicsWorld: world };
}
