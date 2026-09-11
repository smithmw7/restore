import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadBriefcaseAsset } from './briefcase-asset.js';
import { createBriefcaseReviewAudio } from './briefcase-review-audio.js';

const canvas = document.querySelector('#study');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#20262a'); scene.fog = new THREE.Fog('#20262a', 3, 12);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const env = pmrem.fromScene(room, .025); scene.environment = env.texture; scene.environmentIntensity = .65;
room.dispose(); pmrem.dispose();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .005, 30); camera.position.set(1.30, .92, 1.65);
const controls = new OrbitControls(camera, canvas); controls.target.set(0, .1, 0);
controls.enableDamping = true; controls.minDistance = .24; controls.maxDistance = 5; controls.maxPolarAngle = Math.PI; controls.update();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#252c2d', roughness: .94 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.111; ground.receiveShadow = true; scene.add(ground);
const key = new THREE.DirectionalLight('#ffe0b3', 3.5); key.position.set(-2, 4, 3); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .1, far: 12 });
key.shadow.normalBias = .004; key.shadow.radius = 4; scene.add(key);
const rim = new THREE.DirectionalLight('#a7c7dc', 2); rim.position.set(2, 2, -2); scene.add(rim);
const frontFill = new THREE.DirectionalLight('#ffe6c3', 1.2); frontFill.position.set(0, .05, 4); scene.add(frontFill);
const audio = createBriefcaseReviewAudio();
const STEP = Math.PI * 2 / 10, COMBINATION = '1942';
const wheelPositions = [0, 0, 0, 0], wheelTargets = [0, 0, 0, 0];
const explodeParts = [], wheels = [], latches = [];
let asset, rig, unlocked = false, targetOpen = 0, targetExplode = 0, explode = 0, lidAmount = 0;
let drag = null, latchPress = null, rattleTime = 0, unlockCount = 0, muted = false;
const digit = value => ((Math.round(value) % 10) + 10) % 10;
const readDigits = () => wheelPositions.map(digit);
const settled = () => wheelPositions.every((value, index) => Math.abs(value - wheelTargets[index]) < .002);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const positions = { front: [1.3, .92, 1.65], rear: [-1.30, .72, -1.65], top: [.1, 2.2, .35], under: [1.25, -.65, 1.55], detail: [.40, .15, .93] };

function updateUI() {
  document.querySelector('#lock-state').textContent = unlocked ? 'Unlocked' : 'Locked';
  document.querySelector('#lock-state').dataset.unlocked = String(unlocked);
  document.querySelector('[data-lid="1"]').textContent = unlocked ? 'Open case' : 'Try latch';
  document.querySelectorAll('[data-lid]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.lid) === targetOpen)));
}
function angle(name) {
  const position = positions[name]; if (!position) return;
  endInteraction(true);
  camera.position.fromArray(position); controls.target.set(0, name === 'detail' ? .035 : .1, name === 'detail' ? .32 : 0);
  ground.visible = name !== 'under'; controls.update();
}
function requestOpen(value) {
  if (drag || targetExplode > .02 || explode > .02) return false;
  if (value && !unlocked) { rattleTime = .34; audio.play('locked'); return false; }
  const next = Number(Boolean(value));
  if (next !== targetOpen) audio.play(next ? 'open' : 'close');
  targetOpen = next; updateUI(); return true;
}
function resetLock() {
  endInteraction(true); unlocked = false; targetOpen = 0; rattleTime = 0;
  // Return each drum to its nearest zero, even after many full revolutions.
  wheelTargets.forEach((_, index) => { wheelTargets[index] = Math.round(wheelPositions[index] / 10) * 10; });
  audio.play('close'); updateUI();
}
function setExplode(value) {
  endInteraction(true); targetExplode = Number(value);
  if (targetExplode > .02) { camera.position.set(1.7, 1.3, 2.2); controls.target.set(-.12, .43, .08); ground.visible = true; controls.update(); }
}
function screenPoint(world) {
  const rect = canvas.getBoundingClientRect(), projected = world.clone().project(camera);
  return new THREE.Vector2(rect.left + (projected.x + 1) * rect.width / 2, rect.top + (1 - projected.y) * rect.height / 2);
}
function hitControl(event) {
  if (!asset || targetExplode > .02 || explode > .02) return null;
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  raycaster.setFromCamera(pointer, camera);
  // Only the nearest visible surface counts, so the lid/body cannot be touched through.
  const hit = raycaster.intersectObject(asset, true)[0];
  for (let node = hit?.object; node && node !== asset; node = node.parent) {
    const match = /^Wheel_(\d)$/.exec(node.name);
    if (match) return { kind: 'wheel', index: Number(match[1]) };
    if (/^LatchPivot_[LR]$/.test(node.name)) return { kind: 'latch' };
  }
  return null;
}
function grabPointer(event) {
  // This capture listener runs before OrbitControls, so one gesture has one owner.
  event.preventDefault(); event.stopImmediatePropagation();
  controls.enableDamping = false; controls.update(); controls.enableDamping = true; controls.enabled = false;
  canvas.setPointerCapture(event.pointerId);
}
function releasePointer(pointerId) {
  controls.enabled = true; canvas.style.cursor = 'grab';
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}
function endInteraction(cancelled = false) {
  if (drag) {
    const previous = drag; drag = null;
    wheelTargets[previous.index] = Math.round(wheelPositions[previous.index]) + (!cancelled && !previous.moved ? 1 : 0);
    if (!previous.moved && !cancelled) audio.play('detent');
    releasePointer(previous.pointerId);
  }
  if (latchPress) {
    const previous = latchPress; latchPress = null; releasePointer(previous.pointerId);
    if (!cancelled && !previous.moved) requestOpen(!targetOpen);
  }
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || drag || latchPress) return;
  audio.resume();
  const hit = hitControl(event); if (!hit) return;
  grabPointer(event);
  if (hit.kind === 'wheel') {
    const center = wheels[hit.index].getWorldPosition(new THREE.Vector3()); center.z += .045;
    const axis = screenPoint(center.clone().add(new THREE.Vector3(0, .0475 * STEP, 0))).sub(screenPoint(center));
    const pixelsPerDetent = THREE.MathUtils.clamp(axis.length(), 14, 72);
    if (axis.lengthSq() < .01) axis.set(0, -1); else axis.normalize();
    drag = { index: hit.index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startValue: wheelPositions[hit.index], pixelsPerDetent, axis, moved: false, lastDetent: Math.round(wheelPositions[hit.index]) };
    canvas.style.cursor = 'grabbing';
  } else latchPress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
}, { capture: true });
canvas.addEventListener('pointermove', event => {
  if (drag?.pointerId === event.pointerId) {
    event.preventDefault(); event.stopImmediatePropagation();
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 3;
    wheelPositions[drag.index] = drag.startValue + (dx * drag.axis.x + dy * drag.axis.y) / drag.pixelsPerDetent;
    const next = Math.round(wheelPositions[drag.index]);
    if (next !== drag.lastDetent) { drag.lastDetent = next; audio.play('detent'); }
  } else if (latchPress?.pointerId === event.pointerId) {
    event.preventDefault(); event.stopImmediatePropagation();
    latchPress.moved ||= Math.hypot(event.clientX - latchPress.x, event.clientY - latchPress.y) > 5;
  } else if (!drag && !latchPress && event.buttons === 0) {
    const hit = hitControl(event); canvas.style.cursor = hit?.kind === 'wheel' ? 'ns-resize' : hit ? 'pointer' : 'grab';
  }
}, { capture: true });
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, event => {
  if (event.pointerId !== drag?.pointerId && event.pointerId !== latchPress?.pointerId) return;
  event.preventDefault(); event.stopImmediatePropagation(); endInteraction(type === 'pointercancel');
}, { capture: true });
canvas.addEventListener('lostpointercapture', event => {
  if (event.pointerId === drag?.pointerId || event.pointerId === latchPress?.pointerId) endInteraction(true);
});
addEventListener('blur', () => endInteraction(true));
addEventListener('keydown', event => { if (event.key === 'Escape') endInteraction(true); });
document.querySelectorAll('[data-angle]').forEach(button => button.addEventListener('click', () => angle(button.dataset.angle)));
document.querySelectorAll('[data-lid]').forEach(button => button.addEventListener('click', () => { audio.resume(); requestOpen(Number(button.dataset.lid)); }));
document.querySelector('#reset-lock').addEventListener('click', () => { audio.resume(); resetLock(); });
document.querySelector('#explode').addEventListener('input', event => setExplode(event.target.value));
document.querySelector('#sound').addEventListener('click', event => {
  muted = !muted; audio.setMuted(muted); if (!muted) audio.resume();
  event.currentTarget.setAttribute('aria-pressed', String(!muted)); event.currentTarget.textContent = muted ? 'Sound off' : 'Sound on';
});

try {
  rig = await loadBriefcaseAsset(); asset = rig.root; scene.add(asset);
  wheels.push(...Array.from({ length: 4 }, (_, index) => asset.getObjectByName(`Wheel_${index}`)));
  latches.push(...['L', 'R'].map(side => asset.getObjectByName(`LatchPivot_${side}`)));
  const choices = [['LidPivot', [0, .46, -.10]], ['LatchPivot_L', [-.11, .07, .16]], ['LatchPivot_R', [.11, .07, .16]],
    ...Array.from({ length: 4 }, (_, index) => [`Wheel_${index}`, [(index - 1.5) * .035, .04, .20]])];
  for (const [name, offset] of choices) { const node = asset.getObjectByName(name); explodeParts.push({ node, home: node.position.clone(), offset: new THREE.Vector3(...offset) }); }
  document.querySelector('#status').innerHTML = `Engraved 3D numerals · PBR textures<br>${rig.state.triangles.toLocaleString()} triangles`;
  window.__briefcaseReview = { ready: true, asset, camera, controls, angle, setOpen: requestOpen, setExplode, stats: rig.state, getState };
  updateUI();
} catch (error) {
  console.error(error); document.querySelector('#status').textContent = 'Model could not load';
  window.__briefcaseReview = { ready: false, error: String(error) };
}
function getState() {
  return { loaded: Boolean(asset), open: lidAmount, explode, digits: readDigits(), unlocked, locked: !unlocked, unlockCount,
    wheelPositions: [...wheelPositions], wheelTargets: [...wheelTargets], wheelAngles: wheels.map(wheel => wheel.rotation.x),
    dragging: drag ? { index: drag.index, pointerId: drag.pointerId, pixelsPerDetent: drag.pixelsPerDetent, axis: { x: drag.axis.x, y: drag.axis.y } } : null };
}
function step(dt) {
  const blend = 1 - Math.exp(-18 * dt);
  wheelPositions.forEach((value, index) => {
    if (drag?.index === index) return;
    wheelPositions[index] += (wheelTargets[index] - value) * blend;
    if (Math.abs(wheelPositions[index] - wheelTargets[index]) < .0001) wheelPositions[index] = wheelTargets[index];
  });
  if (!unlocked && !drag && settled() && readDigits().join('') === COMBINATION) {
    unlocked = true; unlockCount++; audio.play('unlock'); updateUI();
  }
  lidAmount = THREE.MathUtils.lerp(lidAmount, targetOpen, 1 - Math.exp(-10 * dt));
  explode = THREE.MathUtils.lerp(explode, targetExplode, 1 - Math.exp(-10 * dt));
  rig?.update({ lidAngle: -1.75 * lidAmount, wheelPositions, open: unlocked || lidAmount > .02, dt });
  for (const part of explodeParts) part.node.position.copy(part.home).addScaledVector(part.offset, explode);
  if (rattleTime > 0) {
    rattleTime = Math.max(0, rattleTime - dt);
    for (const latch of latches) latch.rotation.x += Math.sin(rattleTime * 95) * .055 * (rattleTime / .34);
  }
  if (controls.enabled) controls.update();
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => { step(Math.min(clock.getDelta(), .05)); renderer.render(scene, camera); });
window.render_game_to_text = () => JSON.stringify(getState());
window.advanceTime = milliseconds => {
  for (let remaining = Math.min(milliseconds, 2000) / 1000; remaining > 0; remaining -= 1 / 60) step(Math.min(remaining, 1 / 60));
  renderer.render(scene, camera);
};
addEventListener('resize', () => { endInteraction(true); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
