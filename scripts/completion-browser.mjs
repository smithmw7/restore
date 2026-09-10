import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = 'output/completion';
await mkdir(out, { recursive: true });
await writeFile(`${out}/harness.html`, '<!doctype html><link rel="icon" href="data:,"><style>html,body{margin:0;background:#111;overflow:hidden}canvas{display:block}</style><script type="module" src="./harness.js"></script>');
await writeFile(`${out}/harness.js`, `
import * as THREE from 'three';
import { createDestructionLab } from '/src/destruction.js';
import { ARTIFACT_CATALOG, createArtifactGeometry } from '/src/artifact-forms.js';
import { loadWarehouseMaterials } from '/src/materials.js';
import { createAlienMaterials } from '/src/artifact-materials.js';
import { createWarehouse } from '/src/warehouse.js';
import { createArchiveAtmosphere } from '/src/atmosphere.js';
import { createRestorePostprocessing } from '/src/postprocessing.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1280, 800); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1280 / 800, .05, 260);
const materials = await loadWarehouseMaterials(), alien = createAlienMaterials(materials);
const warehouse = createWarehouse({ scene, renderer, materials });
const atmosphere = createArchiveAtmosphere({ scene, renderer, bounds: warehouse.bounds, lights: warehouse.atmosphereLights });
const post = createRestorePostprocessing(renderer);
let lab, original, control, pieces, homes, rotations, wholeHome, first, events, beforeImage;
const gl = renderer.getContext(), phases = new Map();
const render = () => { renderer.info.reset(); post.render(scene, camera); };
const snapshot = () => {
  const pixels = new Uint8Array(1280 * 800 * 4);
  gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
};
function frameObjects() {
  const grab = lab.getGrabState();
  const rotation = first.quaternion.clone().multiply(rotations.get(first).clone().invert());
  const center = grab.complete ? original.position.clone()
    : wholeHome.clone().sub(homes.get(first)).applyQuaternion(rotation).add(new THREE.Vector3().fromArray(grab.anchor));
  lab.placeObject('control', center.clone().add(new THREE.Vector3(1.2, 0, 0)), original.quaternion, { visible: true, rebaseHome: true });
  camera.position.copy(center).add(new THREE.Vector3(.6, .05, 2.2));
  camera.lookAt(center.clone().add(new THREE.Vector3(.6, 0, 0)));
  camera.updateMatrixWorld(true);
}
function state() {
  const all = lab.getState();
  const uniform = mesh => renderer.properties.get(mesh.material).currentProgram?.id;
  return { objects: all.objects, grab: all.grab, completeEvents: events.filter(event => event.type === 'complete').length,
    shaderPrograms: renderer.info.programs.length, subjectProgram: uniform(original), controlProgram: uniform(control),
    programKeysMatch: original.material.customProgramCacheKey() === control.material.customProgramCacheKey(),
    glError: gl.getError(), post: post.getState(), dimensions: original.geometry.boundingBox.getSize(new THREE.Vector3()).toArray() };
}
async function start(form) {
  lab?.dispose();
  phases.clear(); beforeImage = null; events = [];
  const entry = ARTIFACT_CATALOG.find(item => item.form === form);
  const source = alien.get({ ...entry, accent: '#72e8d5' });
  lab = await createDestructionLab({ scene, wholeObjects: true, pedestals: false,
    specs: ['subject', 'control'].map((id, index) => ({ ...entry, id, x: index * 3, y: 1.2, z: -2,
      color: '#ad9471', fractureKey: form, fractureScale: 1 })),
    geometryForSpec: spec => createArtifactGeometry(spec.form), fractureGeometryForSpec: spec => createArtifactGeometry(spec.form),
    materialForSpec: () => ({ outside: source, inside: materials.stone }), onEvent: event => events.push(event),
  });
  original = scene.children.find(mesh => mesh.userData.labObject === 'subject' && mesh.userData.kind !== 'fragment');
  control = scene.children.find(mesh => mesh.userData.labObject === 'control' && mesh.userData.kind !== 'fragment');
  pieces = scene.children.filter(mesh => mesh.userData.labObject === 'subject' && mesh.userData.kind === 'fragment');
  homes = new Map(pieces.map(piece => [piece, piece.position.clone()]));
  rotations = new Map(pieces.map(piece => [piece, piece.quaternion.clone()]));
  wholeHome = original.position.clone();
  lab.hit(original, original.position.clone(), new THREE.Vector3(0, 0, -1));
  for (let i = 0; i < 240; i++) lab.step(1 / 60);
  first = pieces.at(-1); lab.beginGrab(first, first.position.clone());
  return { ready: true };
}
function repair() {
  let partialJoins = false, earlyEffect = false;
  for (let frame = 0; frame < 60 * 45 && !lab.getGrabState().complete; frame++) {
    const grab = lab.getGrabState(), anchor = new THREE.Vector3().fromArray(grab.anchor);
    const rotation = first.quaternion.clone().multiply(rotations.get(first).clone().invert());
    const candidates = pieces.map(piece => ({ piece, offset: homes.get(piece).clone().sub(homes.get(first)).applyQuaternion(rotation) }))
      .filter(({ piece, offset }) => piece.position.distanceTo(anchor.clone().add(offset)) > .025)
      .sort((a, b) => a.piece.position.distanceTo(anchor) - b.piece.position.distanceTo(anchor));
    if (candidates.length) lab.moveGrab(candidates[0].piece.position.clone().sub(candidates[0].offset));
    lab.step(1 / 60);
    if (!lab.getGrabState().complete) {
      partialJoins ||= lab.getGrabState().assembled > 1;
      earlyEffect ||= lab.getState().objects[0].completion.active;
      if (lab.getGrabState().assembled >= pieces.length - 2 && !beforeImage) {
        frameObjects(); render(); beforeImage = renderer.domElement.toDataURL('image/png');
      }
    }
  }
  if (!lab.getGrabState().complete) throw new Error('Repair stalled at ' + lab.getGrabState().assembled);
  frameObjects();
  // Stop translating the repaired piece while the visual sweep is sampled.
  lab.moveGrab(new THREE.Vector3().fromArray(lab.getGrabState().anchor));
  render(); phases.set('onset', snapshot());
  return { ...state(), partialJoins, earlyEffect, beforeImage };
}
function advance(frames, key) {
  for (let i = 0; i < frames; i++) lab.step(1 / 60);
  render(); if (key) phases.set(key, snapshot());
  return state();
}
function compare(firstKey, secondKey, mesh) {
  const a = phases.get(firstKey), b = phases.get(secondKey);
  const box = new THREE.Box3().setFromObject(mesh, true), points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(camera); points.push([(p.x + 1) * 640, (p.y + 1) * 400]);
  }
  const x0 = Math.max(0, Math.floor(Math.min(...points.map(p => p[0])) - 12));
  const x1 = Math.min(1279, Math.ceil(Math.max(...points.map(p => p[0])) + 12));
  const y0 = Math.max(0, Math.floor(Math.min(...points.map(p => p[1])) - 12));
  const y1 = Math.min(799, Math.ceil(Math.max(...points.map(p => p[1])) + 12));
  let change = 0, changed = 0, count = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const offset = (y * 1280 + x) * 4;
    const delta = Math.abs(a[offset] - b[offset]) + Math.abs(a[offset + 1] - b[offset + 1]) + Math.abs(a[offset + 2] - b[offset + 2]);
    change += delta / 3; changed += delta > 15 ? 1 : 0; count++;
  }
  return { meanChannelChange: change / count, changedPixels: changed, pixels: count, bounds: [x0, y0, x1, y1] };
}
function bandHeight(key) {
  const pixels = phases.get(key), baseline = phases.get('after');
  const [x0, y0, x1, y1] = compare('onset', 'peak', original).bounds;
  let weight = 0, weightedY = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * 1280 + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const glow = r - baseline[i];
    // Isolate the warm bright band from both the jade outline and preexisting
    // metal highlights. WebGL pixel y increases upward through the object.
    if (r > 200 && g > 190 && b > 150 && r > g * .94 && glow > 30) {
      weight += glow; weightedY += y * glow;
    }
  }
  return { y: weightedY / weight, weight };
}
window.completionHarness = { ready: true, start, repair, advance, state,
  compare: (a, b) => ({ subject: compare(a, b, original), control: compare(a, b, control) }),
  bands: () => ({ low: bandHeight('low'), peak: bandHeight('peak'), high: bandHeight('high') }) };
`);

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [], checks = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const base = process.env.RESTORE_DEV_URL || 'http://127.0.0.1:5208';
  await page.goto(`${base}/${out}/harness.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.completionHarness?.ready, { timeout: 30000 });
  for (const form of ['ion-thruster', 'amphora', 'crescent-hull']) {
    await page.evaluate((form) => window.completionHarness.start(form), form);
    const onset = await page.evaluate(() => window.completionHarness.repair());
    assert.ok(onset.grab.complete && onset.partialJoins && !onset.earlyEffect);
    assert.equal(onset.completeEvents, 1);
    assert.equal(onset.objects[0].completion.triggerCount, 1);
    assert.equal(onset.objects[1].completion.active, false);
    assert.ok(onset.beforeImage, `${form} did not capture a partial repair`);
    await writeFile(`${out}/${form}-before.png`, Buffer.from(onset.beforeImage.split(',')[1], 'base64'));
    delete onset.beforeImage;
    await page.screenshot({ path: `${out}/${form}-onset.png` });
    const low = await page.evaluate(() => window.completionHarness.advance(16, 'low'));
    await page.screenshot({ path: `${out}/${form}-low.png` });
    const peak = await page.evaluate(() => window.completionHarness.advance(14, 'peak'));
    await page.screenshot({ path: `${out}/${form}-peak.png` });
    const high = await page.evaluate(() => window.completionHarness.advance(15, 'high'));
    await page.screenshot({ path: `${out}/${form}-high.png` });
    const after = await page.evaluate(() => window.completionHarness.advance(35, 'after'));
    await page.screenshot({ path: `${out}/${form}-after.png` });
    const visualChange = await page.evaluate(() => window.completionHarness.compare('onset', 'peak'));
    const fadedChange = await page.evaluate(() => window.completionHarness.compare('onset', 'after'));
    const bands = await page.evaluate(() => window.completionHarness.bands());
    assert.equal(after.objects[0].completion.active, false);
    assert.equal(after.objects[0].completion.triggerCount, 1);
    assert.ok(visualChange.subject.changedPixels > 300, `${form} produced no visible completion glow`);
    assert.ok(visualChange.control.meanChannelChange < 1, `${form} leaked completion into another object`);
    assert.ok(fadedChange.subject.meanChannelChange < 3, `${form} retained completion glow after its duration`);
    assert.ok(bands.low.weight > 0 && bands.peak.weight > 0 && bands.high.weight > 0, `${form} has no warm sweep band`);
    assert.ok(bands.low.y + 25 < bands.peak.y && bands.peak.y + 25 < bands.high.y, `${form} sweep failed to move up its surface`);
    for (const phase of [onset, low, peak, high, after]) {
      assert.equal(phase.glError, 0);
      assert.ok(phase.programKeysMatch);
      assert.equal(phase.subjectProgram, phase.controlProgram, 'same-finish objects should share a compiled shader program');
      assert.equal(phase.shaderPrograms, onset.shaderPrograms, 'animating the effect must not compile new shaders');
    }
    results.push({ form, onset, low, peak, high, after, visualChange, fadedChange, bands });
  }
  assert.deepEqual(errors, []);
  checks.push('three actual artifact forms trigger only after physical magnetic reconstruction');
  checks.push('real warehouse materials and HDR bloom render before, lower sweep, peak, upper sweep, and faded states without shader or WebGL errors');
  checks.push('matching materials share compiled programs while per-object completion uniforms leave the adjacent control unchanged');
  checks.push('effect animation creates no new shader programs and finishes after 1.25 seconds');
  checks.push('pixel measurements confirm the warm band moves upward and the original surface returns after fading');
  await writeFile(`${out}/browser-check.json`, JSON.stringify({ passed: true, checks, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, results: results.map(({ form, visualChange }) => ({ form, visualChange })), errors }, null, 2));
} catch (error) {
  await writeFile(`${out}/browser-failure.json`, JSON.stringify({ error: error.message, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
