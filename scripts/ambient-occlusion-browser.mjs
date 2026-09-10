import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = 'output/ambient-occlusion';
await mkdir(out, { recursive: true });
await writeFile(`${out}/harness.html`, '<!doctype html><link rel="icon" href="data:,"><style>html,body{margin:0;background:#222}canvas{display:block}</style><script type="module" src="./harness.js"></script>');
await writeFile(`${out}/harness.js`, `
import * as THREE from 'three';
import { createRestorePostprocessing } from '/src/postprocessing.js';
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(960, 720); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#3b3b3b');
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: '#929292' }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#65736b' }));
cube.position.y = .5; scene.add(cube);
const camera = new THREE.PerspectiveCamera(55, 960 / 720, .05, 100);
camera.position.set(2.7, 2.1, 3.5); camera.lookAt(0, .3, 0); camera.updateMatrixWorld(true);
const on = createRestorePostprocessing(renderer), off = createRestorePostprocessing(renderer, { ambientOcclusion: false });
const gl = renderer.getContext(), captures = {}, ray = new THREE.Raycaster(), point = new THREE.Vector3();
function render(post) {
  renderer.setRenderTarget(null); renderer.info.reset(); post.render(scene, camera);
  const pixels = new Uint8Array(960 * 720 * 4); gl.readPixels(0, 0, 960, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}
const difference = (a, b, i) => (a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]) / 3;
function sampleFloor(a, b) {
  const near = [], remote = [];
  scene.updateMatrixWorld(true);
  for (let x = -1.5; x <= 1.5; x += .025) for (let z = -1.5; z <= 1.5; z += .025) {
    if (Math.abs(x) < .501 && Math.abs(z) < .501) continue;
    point.set(x, .001, z).project(camera);
    ray.setFromCamera(new THREE.Vector2(point.x, point.y), camera);
    if (ray.intersectObjects([cube, floor], false).find(hit => hit.object.visible)?.object !== floor) continue;
    const px = Math.round((point.x + 1) * 480), py = Math.round((point.y + 1) * 360);
    if (px < 1 || px > 958 || py < 1 || py > 718) continue;
    const edge = Math.max(Math.abs(x) - .5, Math.abs(z) - .5);
    const delta = difference(a, b, (py * 960 + px) * 4);
    if (edge < .08) near.push(delta);
    if (edge > .4) remote.push(delta);
  }
  const stats = values => ({ count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    max: Math.max(...values), min: Math.min(...values), darkened: values.filter(v => v > 1).length });
  return { near: stats(near), remote: stats(remote) };
}
function compareAll(a, b) {
  let total = 0, max = 0, changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.abs(difference(a, b, i)); total += delta; max = Math.max(max, delta); changed += delta > 1;
  }
  return { mean: total / (a.length / 4), max, changed };
}
const results = {};
function measure(name) {
  const a = render(off); captures[name + '-off'] = renderer.domElement.toDataURL('image/png');
  const b = render(on); captures[name + '-on'] = renderer.domElement.toDataURL('image/png');
  return { floor: sampleFloor(a, b), all: compareAll(a, b), pixels: b };
}
cube.visible = false;
results.flat = measure('flat'); delete results.flat.pixels;
cube.visible = true; cube.position.set(0, .5, 0);
results.contact = measure('contact');
const contactPixels = results.contact.pixels; delete results.contact.pixels;
results.repeat = compareAll(contactPixels, render(on));
cube.position.y = 1.15;
results.lifted = measure('lifted'); delete results.lifted.pixels;
cube.position.set(-15.6, .5, -20.2);
results.far = measure('far'); delete results.far.pixels;
cube.position.set(0, .5, 0); cube.material.color.setRGB(6, 3, 1);
const emissionOff = render(off), emissionOn = render(on);
const emitter = [];
for (let y = .2; y < .85; y += .08) for (let x = -.3; x <= .3; x += .08) {
  point.set(x, y, .501).project(camera);
  const px = Math.round((point.x + 1) * 480), py = Math.round((point.y + 1) * 360);
  emitter.push(Math.abs(difference(emissionOff, emissionOn, (py * 960 + px) * 4)));
}
results.emitter = { max: Math.max(...emitter), mean: emitter.reduce((a, b) => a + b, 0) / emitter.length };
cube.material.color.set('#65736b');
results.state = on.getState(); results.disabled = off.getState();

// Deliberately asymmetric eye projections verify that each eye supplies its own
// inverse matrix. Each stereo half must equal that eye rendered alone in XR mode.
const eyes = [-.032, .032].map((offset, index) => {
  const eye = new THREE.PerspectiveCamera(index ? 66 : 54, 1, .05, 100);
  eye.position.copy(camera.position).add(new THREE.Vector3(offset, 0, 0)); eye.quaternion.copy(camera.quaternion);
  eye.projectionMatrix.elements[8] = index ? .07 : -.04;
  eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert(); eye.updateMatrixWorld(true);
  eye.viewport = new THREE.Vector4(index * 512, 0, 512, 512); return eye;
});
const xrCamera = new THREE.ArrayCamera(eyes);
renderer.xr.getCamera = () => xrCamera; renderer.xr.isPresenting = true; renderer.xr.enabled = true;
function xrImage(views, width) {
  xrCamera.cameras = views;
  const target = new THREE.WebGLRenderTarget(width, 512, { colorSpace: THREE.SRGBColorSpace }); target.isXRRenderTarget = true;
  renderer.setRenderTarget(target); on.render(scene, camera);
  const pixels = new Uint8Array(width * 512 * 4); renderer.readRenderTargetPixels(target, 0, 0, width, 512, pixels);
  renderer.setRenderTarget(null); target.dispose(); return pixels;
}
const stereo = xrImage(eyes, 1024); results.stereo = [];
for (let eye = 0; eye < 2; eye++) {
  const half = new Uint8Array(512 * 512 * 4);
  for (let y = 0; y < 512; y++) half.set(stereo.subarray((y * 1024 + eye * 512) * 4, (y * 1024 + eye * 512 + 512) * 4), y * 512 * 4);
  eyes[eye].viewport.x = 0;
  const single = xrImage([eyes[eye]], 512); results.stereo.push(compareAll(half, single));
}
renderer.xr.isPresenting = false; renderer.xr.enabled = false;
const hasExtension = renderer.extensions.has.bind(renderer.extensions);
renderer.extensions.has = name => name === 'EXT_color_buffer_float' ? false : hasExtension(name);
const fallbackOn = createRestorePostprocessing(renderer), fallbackOff = createRestorePostprocessing(renderer, { ambientOcclusion: false });
const fallbackFloor = sampleFloor(render(fallbackOff), render(fallbackOn));
results.fallback = { state: fallbackOn.getState(), floor: fallbackFloor };
results.glError = gl.getError(); results.captures = captures;
fallbackOn.dispose(); fallbackOff.dispose(); on.dispose(); off.dispose();
window.result = results;
`);

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.RESTORE_URL || 'http://127.0.0.1:5208'}/${out}/harness.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.result, null, { timeout: 60000 });
  const result = await page.evaluate(() => window.result);
  for (const [name, data] of Object.entries(result.captures)) await writeFile(`${out}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  delete result.captures;
  await writeFile(`${out}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(result.glError, 0);
  assert.ok(result.contact.floor.near.max > 5 && result.contact.floor.near.darkened > 20, 'resting cube lacks a visible contact shadow');
  assert.ok(result.contact.floor.remote.mean < .1, 'contact AO spreads into unrelated floor');
  assert.ok(result.flat.all.mean < .05 && result.flat.all.max < 2, 'flat floor self-occludes');
  assert.ok(result.lifted.all.mean < .05 && result.lifted.floor.near.max < 2, 'lifted cube leaves a false floor halo');
  assert.ok(result.far.all.mean < .05 && result.far.all.max < 2, 'distant silhouette produces an AO halo');
  assert.equal(result.repeat.max, 0, 'fixed scene AO has temporal noise');
  assert.equal(result.emitter.max, 0, 'AO darkens luminous surfaces');
  assert.ok(result.stereo.every(eye => eye.max === 0), 'AO uses another eye projection or samples across the stereo seam');
  assert.equal(result.state.scenePasses, 1); assert.equal(result.state.postPasses, 4);
  assert.equal(result.state.ambientOcclusion.samples, 8); assert.equal(result.state.ambientOcclusion.extraPasses, 0);
  assert.equal(result.disabled.ambientOcclusion.enabled, false);
  assert.equal(result.fallback.state.hdr, false);
  assert.ok(result.fallback.floor.near.max > 4, 'contact AO is missing from byte-buffer fallback');
  console.log(JSON.stringify({ passed: true, checks: ['short-range cube/floor contact darkening', 'flat floor and lifted-object rejection',
    'distant edge rejection', 'deterministic samples without temporal noise', 'emissive protection',
    'asymmetric stereo eye isolation', 'existing pass budget and byte-buffer fallback'], result }, null, 2));
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.message, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
