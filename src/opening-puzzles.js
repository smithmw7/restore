import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { driveGrabbedBody, releaseGrabbedBody } from './physical-drag.js';
import { loadBriefcaseAsset, BRIEFCASE_ASSET_URL } from './briefcase-asset.js';

export const OPENING_SAVE_KEY = 'restore.opening.v1';
export const OPENING_CODE = '4172';
const HOME = {
  cutters: [-6.7, 1.13, 10.5],
  'glove-left': [10.30, 1.30, 10.97],
  'glove-right': [10.83, 1.30, 10.97],
  'photo-0': [5.94, 1.017, 8.15],
  'photo-1': [6.15, 1.023, 8.15],
  'photo-2': [6.36, 1.029, 8.15],
};
const clone = value => JSON.parse(JSON.stringify(value));
const initial = () => ({ version: 1, code: OPENING_CODE, wheels: [0, 0, 0, 0], drawerOpen: false,
  notebookOpen: false, noteSeen: false, lockerOpen: false, caseUnlocked: false, caseOpen: false,
  gloves: { left: false, right: false }, cuttersFound: false, containerCut: false, containerOpen: false,
  photosViewed: [], propPoses: {}, milestones: [] });

/** Knowledge is never an access gate. The actual mechanism owns each prerequisite. */
export function createOpeningProgression(storage) {
  let state = initial();
  let saveAvailable = true;
  try {
    const loaded = JSON.parse(storage?.getItem(OPENING_SAVE_KEY) || 'null');
    if (loaded?.version === 1) {
      for (const key of ['drawerOpen', 'notebookOpen', 'noteSeen', 'lockerOpen', 'caseUnlocked', 'caseOpen', 'cuttersFound', 'containerCut', 'containerOpen']) {
        state[key] = loaded[key] === true;
      }
      state.wheels = Array.isArray(loaded.wheels) && loaded.wheels.length === 4
        ? loaded.wheels.map(n => Number.isInteger(n) && n >= 0 && n <= 9 ? n : 0) : [0, 0, 0, 0];
      state.gloves = { left: loaded.gloves?.left === true, right: loaded.gloves?.right === true };
      state.photosViewed = [...new Set((Array.isArray(loaded.photosViewed) ? loaded.photosViewed : []).filter(n => Number.isInteger(n) && n >= 0 && n < 3))];
      state.milestones = [...new Set((Array.isArray(loaded.milestones) ? loaded.milestones : []).filter(n => typeof n === 'string'))];
      for (const [id, pose] of Object.entries(loaded.propPoses || {})) {
        if (HOME[id] && Array.isArray(pose?.position) && pose.position.length === 3 && pose.position.every(Number.isFinite)
          && Array.isArray(pose?.quaternion) && pose.quaternion.length === 4 && pose.quaternion.every(Number.isFinite)
          && Math.abs(pose.position[0]) < 90 && Math.abs(pose.position[2]) < 90 && pose.position[1] >= .02 && pose.position[1] < 6) state.propPoses[id] = clone(pose);
      }
      state.caseOpen &&= state.caseUnlocked;
      state.containerOpen &&= state.containerCut;
      if (state.notebookOpen) state.drawerOpen = true;
    }
  } catch { saveAvailable = false; }
  function save() {
    try { storage?.setItem(OPENING_SAVE_KEY, JSON.stringify(state)); } catch { saveAvailable = false; }
  }
  function milestone(id) { if (!state.milestones.includes(id)) state.milestones.push(id); }
  function dispatch(action, data = {}) {
    let accepted = true;
    switch (action) {
      case 'drawer': state.drawerOpen = !state.drawerOpen; break;
      case 'notebook':
        if (!state.drawerOpen && !state.noteSeen) return false;
        state.notebookOpen = !state.notebookOpen;
        if (state.notebookOpen) { state.noteSeen = true; milestone('combination-found'); }
        break;
      case 'locker': state.lockerOpen = !state.lockerOpen; break;
      case 'wheel':
        if (state.caseUnlocked || !Number.isInteger(data.index) || data.index < 0 || data.index > 3) return false;
        state.wheels[data.index] = (state.wheels[data.index] + (data.direction === -1 ? 9 : 1)) % 10;
        break;
      case 'case-latch':
        if (!state.caseUnlocked && state.wheels.join('') !== state.code) return false;
        state.caseUnlocked = true; state.caseOpen = !state.caseOpen; milestone('photographs-unlocked'); break;
      case 'equip-glove':
        if (!['left', 'right'].includes(data.handedness) || (!state.lockerOpen && !data.loose) || state.gloves[data.handedness]) return false;
        state.gloves[data.handedness] = true; milestone('gauntlet-equipped'); break;
      case 'cutters': state.cuttersFound = true; milestone('cutters-found'); break;
      case 'cut':
        if (!state.cuttersFound || !data.toolAtFastener || state.containerCut) return false;
        state.containerCut = true; milestone('container-released'); break;
      case 'container-door':
        if (!state.containerCut) return false;
        state.containerOpen = !state.containerOpen; break;
      case 'photo':
        if (!state.caseUnlocked || !Number.isInteger(data.index) || data.index < 0 || data.index > 2) return false;
        if (!state.photosViewed.includes(data.index)) state.photosViewed.push(data.index);
        break;
      case 'prop-pose':
        if (!HOME[data.id] || !Array.isArray(data.position) || data.position.length !== 3 || !data.position.every(Number.isFinite)
          || !Array.isArray(data.quaternion) || data.quaternion.length !== 4 || !data.quaternion.every(Number.isFinite)) return false;
        state.propPoses[data.id] = { position: [...data.position], quaternion: [...data.quaternion] }; break;
      default: accepted = false;
    }
    if (accepted) save();
    return accepted;
  }
  return {
    getState: () => ({ ...clone(state), saveAvailable }), dispatch,
    reset({ hard = false } = {}) { if (hard) state = initial(); else state.propPoses = {}; save(); return this.getState(); },
  };
}

function texture(paint, width = 512, height = 512) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) { const map = new THREE.DataTexture(new Uint8Array([192, 184, 154, 255]), 1, 1); map.needsUpdate = true; return map; }
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return map;
}

// These images are authored visual clues, never a full hull silhouette or blueprint.
function photograph(index) {
  return texture((ctx, w, h) => {
    ctx.fillStyle = '#d4cdb7'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#42413c'; ctx.fillRect(28, 26, w - 56, h - 70);
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#65655e'); g.addColorStop(1, '#282c2b'); ctx.fillStyle = g; ctx.fillRect(36, 34, w - 72, h - 86);
    ctx.fillStyle = '#77746a'; ctx.beginPath(); ctx.moveTo(40, 340); ctx.lineTo(390, 275); ctx.lineTo(470, 372); ctx.lineTo(450, 435); ctx.lineTo(40, 435); ctx.fill();
    if (index === 0) {
      ctx.save(); ctx.translate(255, 238); ctx.scale(1, .65);
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; ctx.strokeStyle = i % 2 ? '#c3bca5' : '#9b9583'; ctx.lineWidth = 37; ctx.beginPath(); ctx.arc(0, 0, 132, a + .06, a + .62); ctx.stroke(); }
      ctx.strokeStyle = '#d6caae'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 105, .1, 4.3); ctx.stroke(); ctx.restore();
    } else if (index === 1) {
      ctx.strokeStyle = '#afa78f'; ctx.lineWidth = 45; ctx.lineJoin = 'bevel'; ctx.beginPath(); ctx.moveTo(135, 310); ctx.lineTo(170, 135); ctx.lineTo(320, 155); ctx.lineTo(350, 300); ctx.stroke();
      ctx.strokeStyle = '#d6c9a7'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(155, 310); ctx.lineTo(185, 161); ctx.lineTo(302, 180); ctx.stroke();
      ctx.fillStyle = '#343831'; ctx.fillRect(370, 130, 62, 165); ctx.strokeStyle = '#c5bba4'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(400, 210, 23, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = '#aea999'; ctx.beginPath(); ctx.moveTo(112, 135); ctx.lineTo(240, 170); ctx.lineTo(214, 323); ctx.lineTo(80, 279); ctx.fill();
      ctx.fillStyle = '#c7beab'; ctx.beginPath(); ctx.moveTo(246, 172); ctx.lineTo(383, 147); ctx.lineTo(407, 296); ctx.lineTo(223, 325); ctx.fill();
      ctx.strokeStyle = '#65645a'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(240, 172); ctx.lineTo(235, 225); ctx.lineTo(223, 243); ctx.lineTo(230, 265); ctx.lineTo(214, 323); ctx.stroke();
      ctx.fillStyle = '#645f52'; ctx.fillRect(298, 300, 120, 55); ctx.strokeStyle = '#c6bba0'; ctx.lineWidth = 12; ctx.strokeRect(306, 304, 61, 47);
    }
    let seed = index + 8149;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let n = 0; n < 17000; n++) { ctx.fillStyle = random() > .5 ? 'rgba(250,237,198,.10)' : 'rgba(10,12,12,.10)'; ctx.fillRect(35 + random() * (w - 70), 33 + random() * (h - 87), 1.5, 1.5); }
    ctx.strokeStyle = 'rgba(221,212,183,.28)'; ctx.lineWidth = 1;
    for (let n = 0; n < 8; n++) { const x = 40 + random() * 410; ctx.beginPath(); ctx.moveTo(x, 38); ctx.lineTo(x + random() * 15, 410); ctx.stroke(); }
  });
}

export function createOpeningPuzzles({ scene, onEvent = () => {}, storage, world } = {}) {
  if (!scene) throw new Error('Opening puzzles need a Three.js scene.');
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const progression = createOpeningProgression(storage);
  let state = progression.getState();
  const root = new THREE.Group(); root.name = 'Opening tools and clues'; scene.add(root);
  const materials = new Set(), geometries = new Set(), maps = new Set(), colliders = [], bodies = [];
  const items = new Map(), targetList = [], obstacleMeshes = [], props = new Map(), hands = new Map();
  const v = new THREE.Vector3(), q = new THREE.Quaternion();
  let held = null, equippedCutters = null, carriedRelocationPending = false, disposed = false, cutTime = 0;
  let briefcaseAsset = null, briefcaseLoading = null;
  let briefcaseState = { loaded: false, error: null, url: BRIEFCASE_ASSET_URL, version: null, meshes: 0, triangles: 0, materials: 0, textures: 0 };
  const mat = (color, roughness = .7, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); materials.add(m); return m; };
  const metal = mat('#62695f', .68, .68), dark = mat('#222925', .88, .4), brass = mat('#96754d', .49, .72), ivory = mat('#c6c4ab', .53, .22);
  const leather = mat('#55463a', .92), paper = mat('#d3c8a7', .92), red = mat('#824a31', .79);
  const glow = mat('#799f92', .38, .35); glow.emissive.set('#67b6a1'); glow.emissiveIntensity = .35;
  function box(parent, size, position, material = metal, name = '') {
    const geometry = new THREE.BoxGeometry(...size); geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function cylinder(parent, radius, length, position, material = metal, zAxis = false) {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12); geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); if (zAxis) mesh.rotation.x = Math.PI / 2; mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function mappedMaterial(map) { maps.add(map); const material = new THREE.MeshStandardMaterial({ map, roughness: .95, side: THREE.DoubleSide }); materials.add(material); return material; }
  function surface(parent, size, position, map, rotationX = -Math.PI / 2) {
    const geometry = new THREE.PlaneGeometry(...size); geometries.add(geometry); const mesh = new THREE.Mesh(geometry, mappedMaterial(map)); mesh.position.fromArray(position); mesh.rotation.x = rotationX; parent.add(mesh); return mesh;
  }
  function target(mesh, id, { grab = false, eligible = () => true } = {}) {
    mesh.userData = { ...mesh.userData, kind: 'opening-puzzle', labObject: id, openingId: id, soundId: 'tablet' };
    const entry = { mesh, id, grab, eligible }; items.set(mesh, entry); targetList.push(entry); return mesh;
  }
  function rigid(mesh, size, dynamic = false) {
    if (!world) return null;
    mesh.updateWorldMatrix(true, false); mesh.getWorldPosition(v); mesh.getWorldQuaternion(q);
    const desc = (dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased()).setTranslation(v.x, v.y, v.z).setRotation(q);
    if (dynamic) desc.setLinearDamping(2.2).setAngularDamping(3).setCcdEnabled(true).setCanSleep(true);
    const body = world.createRigidBody(desc); bodies.push(body);
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(...size.map(n => n / 2)).setFriction(.85).setRestitution(0).setDensity(dynamic ? 130 : 500), body); colliders.push(collider);
    return body;
  }
  function obstacle(mesh, size) { obstacleMeshes.push(mesh); const body = rigid(mesh, size); return { mesh, body }; }
  const movingObstacles = [];

  // Drawer starts under the existing desk. The notebook moves onto the desktop
  // after discovery so the note and the lock can be inspected side by side.
  const drawer = new THREE.Group(); drawer.position.set(7, .70, 8.48); root.add(drawer);
  box(drawer, [1.03, .035, .50], [0, -.09, -.06], dark);
  const drawerFront = target(box(drawer, [1.1, .23, .07], [0, 0, .14], leather), 'drawer');
  box(drawer, [.30, .028, .045], [0, 0, .19], brass);
  movingObstacles.push(obstacle(drawerFront, [1.1, .23, .07]));
  const notebook = new THREE.Group(); root.add(notebook);
  const notebookBody = target(box(notebook, [.43, .055, .31], [0, 0, 0], leather), 'notebook', { eligible: () => drawer.position.z > 8.73 || state.noteSeen });
  box(notebook, [.39, .04, .28], [0, .021, 0], paper);
  const cover = new THREE.Group(); cover.position.set(-.215, .05, 0); notebook.add(cover);
  box(cover, [.43, .015, .31], [.215, 0, 0], leather);
  const note = surface(notebook, [.25, .19], [.045, .047, .01], texture((ctx, w, h) => {
    ctx.fillStyle = '#d3bd68'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#443b2e'; ctx.lineWidth = 9;
    ctx.strokeRect(176, 65, 155, 71); ctx.beginPath(); ctx.moveTo(220, 65); ctx.lineTo(220, 42); ctx.lineTo(278, 42); ctx.lineTo(278, 65); ctx.stroke();
    ctx.fillStyle = '#352e26'; ctx.font = 'bold 130px Georgia'; ctx.textAlign = 'center'; ctx.fillText(OPENING_CODE, w / 2, 325);
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(76, 360); ctx.lineTo(438, 360); ctx.stroke();
  }));
  note.visible = state.notebookOpen;

  const caseRoot = new THREE.Group(); caseRoot.name = 'Office briefcase'; caseRoot.position.set(6.15, 1.06, 8.15); root.add(caseRoot);
  // One hollow shell serves both the authored asset and the fallback. A solid
  // box would block photo selection and eject a photo as soon as it is picked up.
  for (const [size, position] of [
    [[.96, .026, .63], [0, -.087, 0]],
    [[.018, .187, .63], [-.471, .0065, 0]], [[.018, .187, .63], [.471, .0065, 0]],
    [[.924, .187, .018], [0, .0065, -.306]], [[.924, .187, .018], [0, .0065, .306]],
  ]) obstacle(box(caseRoot, size, position, metal), size);
  box(caseRoot, [.91, .017, .576], [0, -.065, 0], dark);
  for (const x of [-.48, .48]) box(caseRoot, [.025, .22, .65], [x, .005, 0], brass);
  const lid = new THREE.Group(); lid.position.set(0, .12, -.315); caseRoot.add(lid);
  // Enclose the exported shell, rolled rim and corner caps in the same hinge
  // space. The lid's local Y bounds are -.014 through .083 meters.
  const lidSize = [.98, .098, .662];
  const lidPanel = box(lid, lidSize, [0, .0345, .3134], metal, 'Briefcase lid collision proxy');
  box(lid, [.86, .025, .51], [0, -.043, .325], leather);
  movingObstacles.push(obstacle(lidPanel, lidSize));
  const wheels = [];
  for (let index = 0; index < 4; index++) {
    const wheel = target(cylinder(caseRoot, .057, .08, [(index - 1.5) * .132, .01, .358], brass, true), `wheel-${index}`, { eligible: () => !state.caseUnlocked });
    const digit = surface(wheel, [.071, .096], [0, .046, 0], texture(() => {}), -Math.PI / 2);
    digit.rotation.x = -Math.PI / 2;
    wheels.push({ wheel, digit, digitValue: -1 });
  }
  const latch = target(box(caseRoot, [.11, .13, .075], [.365, .02, .362], brass), 'case-latch');
  const leftLatch = target(box(caseRoot, [.11, .13, .075], [-.365, .02, .362], brass), 'case-latch-left');
  const caseFallbackMeshes = [];
  caseRoot.traverse(object => { if (object.isMesh) caseFallbackMeshes.push(object); });

  const locker = new THREE.Group(); locker.position.set(10.6, 0, 10.9); root.add(locker);
  for (const [size, pos] of [ [[1.3, .05, .65], [0, .025, 0]], [[1.3, .05, .65], [0, 2.175, 0]], [[.045, 2.2, .65], [-.63, 1.1, 0]], [[.045, 2.2, .65], [.63, 1.1, 0]], [[1.3, 2.2, .035], [0, 1.1, -.31]], [[1.26, .035, .59], [0, 1.12, 0]] ]) obstacle(box(locker, size, pos, metal), size);
  const lockerHinge = new THREE.Group(); lockerHinge.position.set(-.65, 0, .345); locker.add(lockerHinge);
  const lockerDoor = target(box(lockerHinge, [1.3, 2.14, .045], [.65, 1.10, 0], metal), 'locker');
  box(lockerHinge, [.045, .24, .065], [1.15, 1.12, .06], brass);
  for (let i = 0; i < 5; i++) box(lockerHinge, [.7, .018, .01], [.65, 1.72 + i * .045, .03], dark);
  movingObstacles.push(obstacle(lockerDoor, [1.3, 2.14, .045]));

  function makeProp(id, size, home, build, eligible) {
    const group = new THREE.Group(); group.position.fromArray(home); root.add(group);
    const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false }); materials.add(proxyMaterial);
    const proxy = target(box(group, size, [0, 0, 0], proxyMaterial), id, { grab: true, eligible });
    build(group);
    const body = rigid(group, size, true);
    const prop = { id, group, proxy, body, size, home: new THREE.Vector3(...home), active: false, equipped: false, saved: false };
    props.set(id, prop);
    if (body) { body.setEnabled(false); body.sleep(); }
    return prop;
  }
  const gauntlets = {};
  for (const side of ['left', 'right']) {
    gauntlets[side] = makeProp(`glove-${side}`, [.21, .20, .34], HOME[`glove-${side}`], group => {
      const ringGeo = new THREE.TorusGeometry(.073, .022, 8, 18); geometries.add(ringGeo);
      const cuff = new THREE.Mesh(ringGeo, brass); cuff.position.z = .10; group.add(cuff);
      box(group, [.125, .07, .21], [0, .027, -.03], dark);
      box(group, [.14, .035, .16], [0, .071, -.045], ivory);
      box(group, [.028, .018, .14], [0, .097, -.05], glow);
      for (const x of [-.055, .055]) box(group, [.025, .04, .21], [x, .05, -.02], brass);
      box(group, [.065, .023, .055], [side === 'left' ? .066 : -.066, .073, -.063], brass);
    }, () => (props.get(`glove-${side}`)?.active || state.lockerOpen && lockerHinge.rotation.y < -1) && !state.gloves[side]);
  }
  const cutters = makeProp('cutters', [.29, .10, .68], HOME.cutters, group => {
    for (const sign of [-1, 1]) {
      const handle = box(group, [.045, .047, .43], [sign * .065, 0, .06], red); handle.rotation.y = sign * .16;
      const shank = box(group, [.035, .043, .25], [sign * .035, 0, -.17], metal); shank.rotation.y = -sign * .20;
      const jaw = box(group, [.047, .055, .115], [sign * .033, .006, -.285], dark); jaw.rotation.y = sign * .3;
    }
    cylinder(group, .031, .071, [0, 0, -.17], brass);
  }, () => !equippedCutters);
  const photos = [], photoSurfaces = [];
  for (let index = 0; index < 3; index++) photos.push(makeProp(`photo-${index}`, [.27, .013, .32], HOME[`photo-${index}`], group => {
    box(group, [.27, .008, .32], [0, 0, 0], paper);
    photoSurfaces.push(surface(group, [.266, .316], [0, .005, 0], photograph(index)));
  }, () => props.get(`photo-${index}`)?.active || state.caseOpen && lid.rotation.x < -.65));

  // One durable corrugated container; the thin keeper is the explicit cutting target.
  const container = new THREE.Group(); container.position.set(-7, 0, 2.7); root.add(container);
  const containerPaint = mat('#4b5850', .91, .38);
  for (const [size, pos] of [ [[3.2, .14, 6], [0, .07, 0]], [[3.2, .13, 6], [0, 2.835, 0]], [[.14, 2.9, 6], [-1.53, 1.45, 0]], [[.14, 2.9, 6], [1.53, 1.45, 0]], [[3.2, 2.9, .14], [0, 1.45, -2.93]] ]) obstacle(box(container, size, pos, containerPaint), size);
  for (const sign of [-1, 1]) for (let n = 0; n < 16; n++) box(container, [.07, 2.65, .065], [sign * 1.61, 1.45, -2.75 + n * .365], metal);
  const doors = [];
  for (const sign of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(sign * 1.6, 0, 3.06); container.add(hinge);
    const door = target(box(hinge, [1.6, 2.76, .12], [-sign * .8, 1.45, 0], containerPaint), `container-door-${sign}`);
    for (let n = 0; n < 6; n++) box(hinge, [.035, 2.55, .055], [-sign * (.18 + n * .235), 1.45, .085], metal);
    box(hinge, [.034, 2.43, .08], [-sign * .47, 1.45, .13], brass);
    box(hinge, [.20, .065, .13], [-sign * .48, 1.25, .20], brass);
    movingObstacles.push(obstacle(door, [1.6, 2.76, .12]));
    doors.push({ hinge, sign });
  }
  const fastener = target(box(container, [.17, .24, .095], [0, 1.3, 3.20], brass), 'container-fastener', { eligible: () => !state.containerCut });
  const linkGeo = new THREE.TorusGeometry(.094, .018, 6, 12); geometries.add(linkGeo);
  const link = new THREE.Mesh(linkGeo, brass); link.position.set(0, 1.3, 3.25); link.scale.y = 1.5; container.add(link);
  const fastenerWorld = new THREE.Vector3(-7, 1.3, 5.9);
  const stripMaterial = mat('#dbba82', .5, .1); stripMaterial.emissive.set('#ffd198');
  const strip = box(container, [1.3, .045, .14], [0, 2.72, 1.35], stripMaterial);
  const interiorLight = new THREE.PointLight('#ffd09a', 0, 6.2, 2); interiorLight.position.set(0, 2.38, .6); container.add(interiorLight);

  const soundActions = { wheel: 'dial', 'case-latch': 'case-open', 'equip-glove': 'equip', cutters: 'cutter-pickup', 'tool-equip': 'cutter-pickup', locked: 'dial' };
  function emit(action, mesh, extra = {}) { onEvent({ type: 'puzzle', action: soundActions[action] || action, interaction: action, kind: 'opening-puzzle', objectId: mesh?.userData.openingId || action, soundId: 'tablet', position: mesh?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3(), strength: .35, ...extra }); }
  function act(action, data, mesh) { const success = progression.dispatch(action, data); state = progression.getState(); if (success) emit(action, mesh, data); return success; }
  function visible(entry) { if (!entry.eligible()) return false; for (let p = entry.mesh; p; p = p.parent) if (!p.visible) return false; return true; }
  function entryOf(mesh) { for (let p = mesh; p; p = p.parent) if (items.has(p)) return items.get(p); return null; }
  function handFor(id, handedness) { return hands.get(id) || [...hands.values()].find(hand => hand.handedness === handedness); }
  function reachable(mesh, options) { const hand = handFor(options.handId, options.handedness); const origin = options.viewerPosition || hand?.position; return !origin || mesh.getWorldPosition(v).distanceTo(origin) <= 2; }
  function enable(prop) {
    if (prop.active) return;
    prop.active = true; prop.group.visible = true;
    prop.body?.setEnabled(true); prop.body?.wakeUp();
  }
  function setPropPose(prop, position, quaternion) {
    prop.group.position.copy(position); if (quaternion) prop.group.quaternion.copy(quaternion);
    prop.body?.setTranslation(prop.group.position, true); prop.body?.setRotation(prop.group.quaternion, true); prop.body?.setLinvel({ x: 0, y: 0, z: 0 }, true); prop.body?.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  function saveProp(prop) { progression.dispatch('prop-pose', { id: prop.id, position: prop.group.position.toArray(), quaternion: prop.group.quaternion.toArray() }); state = progression.getState(); }
  function equipGlove(side, mesh) {
    if (!act('equip-glove', { handedness: side, loose: gauntlets[side].active }, mesh)) return false;
    const prop = gauntlets[side]; prop.body?.setEnabled(false); prop.active = false; prop.equipped = true;
    if (held?.prop === prop) { releaseGrabbedBody(prop.body); held = null; }
    return true;
  }
  function equipCutters(handId, mesh) {
    act('cutters', {}, mesh); enable(cutters); equippedCutters = handId || 'pointer';
    return true;
  }
  function releaseTool(handId, { cancelled = false } = {}) {
    if (!equippedCutters || equippedCutters !== handId) return false;
    if (cutters.body) releaseGrabbedBody(cutters.body);
    if (carriedRelocationPending) { setPropPose(cutters, cutters.home, new THREE.Quaternion()); enable(cutters); }
    equippedCutters = null; carriedRelocationPending = false; cutters.group.visible = true;
    saveProp(cutters); emit(cancelled ? 'release' : 'cutter-pickup', cutters.proxy, { cancelled }); return true;
  }
  function relocateCarriedTool(hand) {
    const shape = new RAPIER.Cuboid(...cutters.size.map(size => size / 2 + .012));
    for (const offset of [[0, -.07, -.28], [.25, -.08, -.12], [-.25, -.08, -.12], [0, .12, -.12], [0, 0, .18]]) {
      const candidate = new THREE.Vector3(...offset).applyQuaternion(hand.quaternion).add(hand.position);
      if (candidate.y < .1) continue;
      if (world?.intersectionWithShape(candidate, hand.quaternion, shape, undefined, undefined, undefined, cutters.body, collider => !collider.isSensor())) continue;
      setPropPose(cutters, candidate, hand.quaternion); enable(cutters); cutters.group.visible = true; carriedRelocationPending = false; return true;
    }
    // A teleport can end with a tracked hand inside a wall. Keep ownership,
    // holster the same tool, and restore it once a real free pose is available.
    if (cutters.body) releaseGrabbedBody(cutters.body);
    cutters.body?.setEnabled(false); cutters.active = false; cutters.group.visible = false; carriedRelocationPending = true; return false;
  }
  function tap(mesh, point, options = {}) {
    const entry = entryOf(mesh);
    if (disposed || !entry || !visible(entry) || !reachable(mesh, options)) return false;
    const { id } = entry;
    if (id === 'drawer' || id === 'notebook' || id === 'locker' || id === 'case-latch' || id === 'case-latch-left') {
      const action = id === 'case-latch-left' ? 'case-latch' : id;
      const success = act(action, {}, mesh); if (!success && action === 'case-latch') emit('locked', mesh); return true;
    }
    if (id.startsWith('wheel-')) { act('wheel', { index: Number(id.at(-1)), direction: options.direction === -1 ? -1 : 1 }, mesh); return true; }
    if (id.startsWith('glove-')) {
      const side = id.slice(6);
      if (options.kind === 'controller' || options.kind === 'hand' || options.xr) {
        const wrist = [...hands.values()].find(hand => hand.handedness === side);
        if (!wrist || gauntlets[side].group.position.distanceTo(wrist.position) > .38) return false;
      }
      return equipGlove(side, mesh);
    }
    if (id === 'cutters') return equipCutters(options.handId || 'pointer', mesh);
    if (id.startsWith('photo-')) {
      act('photo', { index: Number(id.at(-1)) }, mesh);
      return true;
    }
    if (id === 'container-fastener') {
      const carrying = equippedCutters || held?.prop === cutters;
      const toolAtFastener = !!carrying && !carriedRelocationPending && cutters.group.getWorldPosition(v).distanceTo(fastenerWorld) < .90;
      if (act('cut', { toolAtFastener }, mesh)) { cutTime = .45; return true; }
      emit('locked', mesh); return true;
    }
    if (id.startsWith('container-door')) {
      if (!act('container-door', {}, mesh)) emit('locked', mesh); return true;
    }
    return false;
  }
  function beginGrab(mesh, point, handId = 'pointer', options = {}) {
    const entry = entryOf(mesh); const prop = props.get(entry?.id);
    if (disposed || held || !prop || !visible(entry) || !point?.isVector3 || !Number.isFinite(point.x + point.y + point.z)) return false;
    const hand = hands.get(handId);
    const origin = options.viewerPosition || hand?.position;
    if (origin && point.distanceTo(origin) > 2) return false;
    if (equippedCutters) releaseTool(equippedCutters);
    enable(prop);
    if (prop.id === 'cutters') act('cutters', {}, mesh);
    if (prop.id.startsWith('photo-')) act('photo', { index: Number(prop.id.at(-1)) }, mesh);
    held = { prop, handId, goal: prop.group.position.clone(), offset: prop.group.position.clone().sub(point), speed: 0 };
    emit('pickup', mesh); return true;
  }
  function moveGrab(point, handId = 'pointer') { if (!held || held.handId !== handId || !point?.isVector3 || !Number.isFinite(point.x + point.y + point.z)) return false; held.goal.copy(point).add(held.offset); return true; }
  function endGrab(handId = 'pointer', { cancelled = false } = {}) {
    if (!held || held.handId !== handId) return false;
    const { prop } = held;
    if (!cancelled && prop.id.startsWith('glove-')) {
      const side = prop.id.slice(6); const wrist = [...hands.values()].find(hand => hand.handedness === side);
      if (wrist && prop.group.position.distanceTo(wrist.position) < .38) { equipGlove(side, prop.proxy); held = null; return true; }
    }
    if (prop.body) releaseGrabbedBody(prop.body);
    held = null; saveProp(prop); emit(cancelled ? 'release' : 'drop', prop.proxy, { cancelled }); return true;
  }
  function updateHands(poses = []) {
    const previousToolHand = equippedCutters ? hands.get(equippedCutters) : null;
    hands.clear();
    for (const pose of poses) {
      const position = pose.position?.isVector3 ? pose.position.clone() : Array.isArray(pose.position) ? new THREE.Vector3(...pose.position) : null;
      if (!position || !Number.isFinite(position.x + position.y + position.z)) continue;
      const quaternion = pose.quaternion?.isQuaternion ? pose.quaternion.clone() : Array.isArray(pose.quaternion) ? new THREE.Quaternion(...pose.quaternion) : new THREE.Quaternion();
      hands.set(pose.handId ?? pose.id ?? pose.handedness, { ...pose, position, quaternion });
    }
    if (equippedCutters && !hands.has(equippedCutters)) releaseTool(equippedCutters, { cancelled: true });
    else if (equippedCutters && previousToolHand && hands.get(equippedCutters).position.distanceTo(previousToolHand.position) > 1.5) relocateCarriedTool(hands.get(equippedCutters));
  }
  function redrawWheels() {
    wheels.forEach(({ digit, digitValue }, index) => {
      if (digitValue === state.wheels[index]) return;
      const old = digit.material.map;
      const map = texture((ctx, w, h) => {
        const shade = ctx.createLinearGradient(0, 0, 0, h);
        shade.addColorStop(0, '#9b9889'); shade.addColorStop(.32, '#e0dbc9'); shade.addColorStop(.68, '#d1cbb7'); shade.addColorStop(1, '#999586');
        ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#222720'; ctx.font = 'bold 285px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(state.wheels[index]), w / 2, h * .53);
      }, 256, 384);
      maps.add(map); digit.material.map = map; digit.material.needsUpdate = true; old?.dispose(); maps.delete(old); wheels[index].digitValue = state.wheels[index];
    });
  }
  function restoreProps() {
    for (const prop of props.values()) {
      const pose = state.propPoses[prop.id];
      setPropPose(prop, pose ? new THREE.Vector3(...pose.position) : prop.home, pose ? new THREE.Quaternion(...pose.quaternion).normalize() : new THREE.Quaternion());
      prop.active = false; prop.body?.setEnabled(false);
      const worn=prop.id.startsWith('glove-')&&state.gloves[prop.id.slice(6)];
      if (pose && !worn && (!prop.id.startsWith('photo-') || state.caseUnlocked)) enable(prop);
    }
  }
  function step(dt = 1 / 60) {
    if (disposed) return;
    dt = Math.min(.05, Math.max(0, dt)); const blend = 1 - Math.exp(-8 * dt);
    drawer.position.z = THREE.MathUtils.lerp(drawer.position.z, state.drawerOpen ? 8.94 : 8.48, blend);
    notebook.position.set(state.noteSeen ? 7.35 : 7, state.noteSeen ? 1.024 : .68, state.noteSeen ? 8.20 : drawer.position.z - .035);
    cover.rotation.z = THREE.MathUtils.lerp(cover.rotation.z, state.notebookOpen ? Math.PI * .95 : 0, blend);
    note.visible = state.notebookOpen;
    lid.rotation.x = THREE.MathUtils.lerp(lid.rotation.x, state.caseOpen ? -1.75 : 0, blend);
    lockerHinge.rotation.y = THREE.MathUtils.lerp(lockerHinge.rotation.y, state.lockerOpen ? -2.0 : 0, blend);
    doors.forEach(({ hinge, sign }) => { hinge.rotation.y = THREE.MathUtils.lerp(hinge.rotation.y, state.containerOpen ? sign * 1.80 : 0, blend * .65); });
    interiorLight.intensity = THREE.MathUtils.lerp(interiorLight.intensity, state.containerOpen ? 34 : 0, blend * .65);
    stripMaterial.emissiveIntensity = .12 + interiorLight.intensity / 34 * .88;
    fastener.visible = !state.containerCut; link.visible = !state.containerCut || cutTime > 0;
    if (cutTime > 0) { cutTime = Math.max(0, cutTime - dt); link.position.y -= dt * (1 + (1 - cutTime) * 3); link.rotation.z += dt * 5; }
    for (const prop of photos) if (!prop.active) prop.group.visible = state.caseOpen && lid.rotation.x < -.65;
    for (const side of ['left', 'right']) {
      const prop = gauntlets[side];
      if (state.gloves[side]) {
        const pose = [...hands.values()].find(hand => hand.handedness === side);
        prop.group.visible = !!pose;
        if (pose) { prop.group.position.copy(pose.position); prop.group.quaternion.copy(pose.quaternion); }
      } else if (!prop.active) prop.group.visible = state.lockerOpen && lockerHinge.rotation.y < -1;
    }
    root.updateMatrixWorld(true);
    for (const { mesh, body } of movingObstacles) if (body) { mesh.getWorldPosition(v); mesh.getWorldQuaternion(q); body.setNextKinematicTranslation(v); body.setNextKinematicRotation(q); }
    for (const prop of props.values()) {
      if (!prop.active || prop.equipped) continue;
      if (prop.body) { prop.group.position.copy(prop.body.translation()); prop.group.quaternion.copy(prop.body.rotation()); }
      if (prop.group.position.y < -.5 || Math.abs(prop.group.position.x) > 80 || Math.abs(prop.group.position.z) > 90) { setPropPose(prop, prop.home, new THREE.Quaternion()); saveProp(prop); }
    }
    if (equippedCutters) {
      const hand = hands.get(equippedCutters);
      if (hand && carriedRelocationPending) relocateCarriedTool(hand);
      if (hand && !carriedRelocationPending) {
        v.set(0, -.07, -.28).applyQuaternion(hand.quaternion).add(hand.position); v.y = Math.max(.10, v.y);
        if (cutters.body) driveGrabbedBody(world, cutters.body, v, hand.quaternion, dt, { maxSpeed: 3, acceleration: 24 }); else { cutters.group.position.lerp(v, blend); cutters.group.quaternion.slerp(hand.quaternion, blend); }
      }
    }
    if (held) {
      held.goal.y = Math.max(held.prop.size[1] / 2 + .015, held.goal.y);
      const handRotation = hands.get(held.handId)?.quaternion || null;
      if (held.prop.body) { driveGrabbedBody(world, held.prop.body, held.goal, handRotation, dt, { maxSpeed: 2.5, acceleration: 18 }); held.speed = new THREE.Vector3().copy(held.prop.body.linvel()).length(); }
      else { held.speed = held.prop.group.position.distanceTo(held.goal) * 8; held.prop.group.position.lerp(held.goal, blend); }
    }
    if (!briefcaseAsset) redrawWheels();
    briefcaseAsset?.update({ lidAngle: lid.rotation.x, digits: state.wheels, open: state.caseOpen, dt });
    root.updateMatrixWorld(true);
  }
  function getGrabState() {
    if (!held) return { active: false, handId: null, objectId: null, heldMesh: null, anchor: null, radius: 0, speed: 0, goal: null, canDock: false };
    return { active: true, handId: held.handId, objectId: held.prop.id, heldMesh: held.prop.proxy, anchor: held.prop.group.position.toArray(), radius: 0,
      speed: held.speed, goal: held.goal.toArray(), canDock: false, assembled: 1, total: 1, complete: true, whole: true, kind: 'opening-puzzle', soundId: 'tablet' };
  }
  restoreProps();
  drawer.position.z = state.drawerOpen ? 8.94 : 8.48;
  lockerHinge.rotation.y = state.lockerOpen ? -2 : 0;
  lid.rotation.x = state.caseOpen ? -1.75 : 0;
  doors.forEach(({ hinge, sign }) => { hinge.rotation.y = state.containerOpen ? sign * 1.80 : 0; });
  step(0);
  return {
    root, progression,
    async loadBriefcase(url = BRIEFCASE_ASSET_URL) {
      if (typeof document === 'undefined' || disposed) return false;
      if (briefcaseAsset) return true;
      if (briefcaseLoading) return briefcaseLoading;
      briefcaseLoading = (async () => {
        try {
          const asset = await loadBriefcaseAsset({ url });
          if (disposed) { asset.dispose(); return false; }
          // Render the Blender meshes while preserving the exact ray and contact
          // proxies. Material visibility does not disable Three.js raycasting.
          const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false }); materials.add(proxyMaterial);
          const digits = new Set(wheels.map(({ digit }) => digit));
          for (const mesh of caseFallbackMeshes) {
            if (digits.has(mesh)) mesh.visible = false;
            else mesh.material = proxyMaterial;
          }
          briefcaseAsset = asset; briefcaseState = { ...asset.state };
          caseRoot.add(asset.root);
          asset.update({ lidAngle: lid.rotation.x, digits: state.wheels, open: state.caseOpen, immediate: true });
          root.updateMatrixWorld(true);
          return true;
        } catch (error) {
          briefcaseState = { ...briefcaseState, url, error: error.message };
          console.warn('The authored briefcase could not load. The interactive fallback remains available.', error);
          return false;
        } finally { briefcaseLoading = null; }
      })();
      return briefcaseLoading;
    },
    async loadPhotos(url = `${import.meta.env?.BASE_URL || '/'}textures/opening/archive-photos.png`) {
      if (typeof document === 'undefined' || disposed) return false;
      const atlas = await new THREE.TextureLoader().loadAsync(url);
      if (disposed) { atlas.dispose(); return false; }
      photoSurfaces.forEach((mesh, index) => {
        const map = atlas.clone(); map.colorSpace = THREE.SRGBColorSpace; map.repeat.set(1 / 3, 1); map.offset.set(index / 3, 0); map.needsUpdate = true;
        const old = mesh.material.map; mesh.material.map = map; mesh.material.needsUpdate = true;
        maps.add(map); old?.dispose(); maps.delete(old);
      });
      atlas.dispose(); return true;
    },
    get targets() { return targetList.filter(visible).map(entry => entry.mesh); },
    get grabTargets() { return targetList.filter(entry => entry.grab && visible(entry)).map(entry => entry.mesh); },
    get occluders() { return obstacleMeshes; },
    get doorOpen() { return state.containerOpen && Math.abs(doors[0].hinge.rotation.y) > 1.35; },
    owns: mesh => !!entryOf(mesh), tap, beginGrab, moveGrab, endGrab, getGrabState, updateHands, releaseTool, step,
    canPower: handedness => state.gloves[handedness] === true,
    getObstacles: () => { root.updateMatrixWorld(true); return obstacleMeshes.map(mesh => new THREE.Box3().setFromObject(mesh)); },
    getState() {
      return { ...progression.getState(), briefcase: { ...briefcaseState }, equippedCutters, carriedRelocationPending, containerDoorAngle: Math.abs(doors[0].hinge.rotation.y), containerLightIntensity: interiorLight.intensity,
        targets: targetList.filter(visible).map(({ id, mesh, grab }) => ({ id, grab, position: mesh.getWorldPosition(new THREE.Vector3()).toArray() })),
        props: [...props.values()].map(prop => ({ id: prop.id, active: prop.active, visible: prop.group.visible, position: prop.group.position.toArray() })),
        physics: { bodies: bodies.length, colliders: colliders.length, activeProps: [...props.values()].filter(prop => prop.active).length } };
    },
    reset(options = {}) {
      if (held) endGrab(held.handId, { cancelled: true });
      if (cutters.body) releaseGrabbedBody(cutters.body);
      equippedCutters = null; carriedRelocationPending = false; state = progression.reset(options); restoreProps();
      for (const side of ['left', 'right']) gauntlets[side].equipped = state.gloves[side];
      link.position.y = 1.3; link.rotation.z = 0; cutTime = 0; step(0);
    },
    dispose() {
      if (disposed) return;
      if (held) endGrab(held.handId, { cancelled: true });
      if (cutters.body) releaseGrabbedBody(cutters.body);
      for (const body of bodies) world?.removeRigidBody(body);
      briefcaseAsset?.dispose();
      root.removeFromParent(); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); for (const map of maps) map.dispose(); disposed = true;
    },
  };
}
