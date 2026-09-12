import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadOfficeAssets, OFFICE_ASSET_NAMES } from './office-assets.js';

const canvas = document.querySelector('#study'), picker = document.querySelector('#model'), poseButton = document.querySelector('#pose');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#242826');
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture; scene.environmentIntensity = .42;
room.dispose(); pmrem.dispose();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .001, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI;
const display = new THREE.Group(); scene.add(display);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#202520', roughness: .96 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const key = new THREE.DirectionalLight('#ffe0b9', 3.2); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 3; scene.add(key, key.target);
const rim = new THREE.DirectionalLight('#bccbce', 1.55), fill = new THREE.DirectionalLight('#e1d7b9', .7);
scene.add(rim, rim.target, fill, fill.target);
const titles = { Desk: 'The archive desk', Drawer: 'Desk drawer', Notebook: 'The clue notebook', LockerShell: 'Staff locker', LockerDoor: 'Locker door', Chair: 'Office chair', Pen: 'Fountain pen', Pencil: 'Workshop pencil', Logbook: 'Bound logbook' };
const directions = { front: [1.15, .58, 1.5], rear: [-1.15, .58, -1.5], above: [.06, 1.8, .24], under: [1.15, -.7, 1.5] };
const cache = new Map();
// Match the office installation: front-face origin, supported 32 cm travel.
const DRAWER_CLOSED_Z = .44, DRAWER_TRAVEL = .32;
let assets, selected = 'Desk', activeAngle = 'front', openTarget = 0, openAmount = 0;
let model, articulated, size = 1, center = new THREE.Vector3(), error = null;

function instance(name) {
  if (!cache.has(name)) cache.set(name, assets.create(name));
  const result = cache.get(name); result.position.set(0, 0, 0); result.rotation.set(0, 0, 0); result.scale.set(1, 1, 1);
  return result;
}

function angle(name) {
  if (!directions[name] || !assets) return;
  activeAngle = name;
  const factor = Math.max(1, 1 / camera.aspect);
  const direction = new THREE.Vector3(...directions[name]);
  if (selected === 'Chair' && (name === 'front' || name === 'rear')) direction.z *= -1;
  camera.position.copy(center).add(direction.normalize().multiplyScalar(size * 1.9 * factor));
  controls.target.copy(center);
  controls.update();
  ground.visible = name !== 'under';
  document.querySelectorAll('[data-angle]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.angle === name)));
}

function fit() {
  display.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(display);
  center = bounds.getCenter(new THREE.Vector3());
  size = Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  scene.fog = new THREE.Fog(scene.background, size * 3.5, size * 8);
  ground.position.y = bounds.min.y - size * .003;
  camera.near = Math.max(.0001, size * .002); camera.far = Math.max(10, size * 40); camera.updateProjectionMatrix();
  controls.minDistance = size * .22; controls.maxDistance = size * 8;
  key.position.copy(center).add(new THREE.Vector3(-2, 4, 3).multiplyScalar(size)); key.target.position.copy(center);
  rim.position.copy(center).add(new THREE.Vector3(2, 2, -2).multiplyScalar(size)); rim.target.position.copy(center);
  fill.position.copy(center).add(new THREE.Vector3(0, .1, 4).multiplyScalar(size)); fill.target.position.copy(center);
  Object.assign(key.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: size * .05, far: size * 12 });
  key.shadow.camera.updateProjectionMatrix(); key.shadow.normalBias = size * .0012; key.shadow.bias = -.00005;
  angle(activeAngle);
}

function applyPose(amount) {
  if (!articulated) return;
  if (selected === 'Notebook') articulated.rotation.z = Math.PI * .91 * amount;
  else if (selected === 'LockerShell' || selected === 'LockerDoor') articulated.rotation.y = -1.75 * amount;
  else articulated.position.z = (selected === 'Desk' ? DRAWER_CLOSED_Z : 0) + DRAWER_TRAVEL * amount;
}

function select(name) {
  if (!OFFICE_ASSET_NAMES.includes(name) || !assets) return;
  display.clear(); selected = name; openTarget = 0; openAmount = 0;
  model = instance(name); display.add(model); articulated = null;
  if (name === 'Notebook') {
    articulated = model.getObjectByName('NotebookCover'); articulated.rotation.z = 0;
  } else if (name === 'LockerShell') {
    articulated = instance('LockerDoor'); articulated.position.set(-.65, 0, .345); display.add(articulated);
  } else if (name === 'LockerDoor') articulated = model;
  else if (name === 'Desk') {
    articulated = instance('Drawer'); articulated.position.set(0, .7, DRAWER_CLOSED_Z); display.add(articulated);
  } else if (name === 'Drawer') articulated = model;
  picker.value = name; document.querySelector('#model-title').textContent = titles[name];
  let visibleTriangles = 0;
  display.traverse(object => { if (object.isMesh) visibleTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; });
  document.querySelector('#status').textContent = `${visibleTriangles.toLocaleString()} triangles · ${assets.state.textures} shared maps`;
  poseButton.disabled = !articulated; poseButton.setAttribute('aria-pressed', 'false'); poseButton.textContent = 'Open';
  fit();
}

function pose() {
  if (!articulated) return;
  openTarget = 1 - openTarget;
  poseButton.setAttribute('aria-pressed', String(Boolean(openTarget)));
  poseButton.textContent = openTarget ? 'Close' : 'Open';
  // Frame the destination pose so a swung-open cover or door stays visible.
  applyPose(openTarget); fit(); applyPose(openAmount);
}

function update(dt) {
  openAmount += (openTarget - openAmount) * (1 - Math.exp(-10 * dt));
  if (Math.abs(openTarget - openAmount) < .0001) openAmount = openTarget;
  applyPose(openAmount);
  controls.update(); renderer.render(scene, camera);
}

const state = () => ({
  ready: Boolean(assets), error, selected, angle: activeAngle, open: openTarget === 1, openAmount,
  articulation: articulated ? { name: articulated.name, position: articulated.position.toArray(), rotation: articulated.rotation.toArray().slice(0, 3) } : null,
  model: assets?.state.parts[selected] || null, asset: assets?.state || null,
  camera: { position: camera.position.toArray(), target: controls.target.toArray() },
});
window.render_game_to_text = () => JSON.stringify(state());
window.__restoreOfficeReview = { state, select, angle };
window.advanceTime = milliseconds => {
  const steps = Math.max(1, Math.ceil(milliseconds / (1000 / 72)));
  for (let i = 0; i < steps; i++) update(milliseconds / steps / 1000);
};
picker.addEventListener('change', () => select(picker.value));
poseButton.addEventListener('click', pose);
document.querySelectorAll('[data-angle]').forEach(button => button.addEventListener('click', () => angle(button.dataset.angle)));
window.addEventListener('keydown', event => {
  if (event.code !== 'KeyO' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable) return;
  location.href = import.meta.env.BASE_URL;
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null); controls.dispose(); assets?.dispose();
  ground.geometry.dispose(); ground.material.dispose(); environment.dispose(); renderer.dispose();
}, { once: true });
let last = performance.now();
renderer.setAnimationLoop(now => { const dt = Math.min((now - last) / 1000, .05); last = now; update(dt); });

try {
  assets = await loadOfficeAssets();
  for (const name of OFFICE_ASSET_NAMES) { const option = document.createElement('option'); option.value = name; option.textContent = titles[name]; picker.append(option); }
  picker.disabled = false;
  const requested = new URLSearchParams(location.search).get('model');
  select(OFFICE_ASSET_NAMES.includes(requested) ? requested : 'Desk');
} catch (failure) {
  error = failure.message;
  document.querySelector('#status').textContent = 'Collection unavailable';
  document.querySelector('#error').textContent = `The office models could not load. ${error}`;
  console.error(failure);
}
