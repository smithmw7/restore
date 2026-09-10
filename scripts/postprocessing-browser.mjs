import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// This deliberately supplies an external, side-by-side framebuffer, like the
// XRWebGLLayer path, rather than treating a desktop canvas as headset validation.
const out = 'output/postprocessing';
await mkdir(out, { recursive: true });
await writeFile(`${out}/harness.html`, '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#222}canvas{display:block;width:1024px;height:512px;image-rendering:pixelated}</style><script type="module" src="./harness.js"></script>');
await writeFile(`${out}/harness.js`, `
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createRestorePostprocessing } from '/src/postprocessing.js';
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1.5); renderer.setSize(512, 256);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 0, 0);
for (const [layer, color] of [[1, new THREE.Color(7, 0, 0)], [2, new THREE.Color(0, 0, 20)]]) {
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(.32, .32), new THREE.MeshBasicMaterial({ color }));
  panel.position.set(4, .15, -3); panel.layers.set(layer); scene.add(panel);
}
const shared = new THREE.Mesh(new THREE.PlaneGeometry(.4, .2), new THREE.MeshBasicMaterial({ color: new THREE.Color(.15, .15, .15) }));
shared.position.set(4, -.35, -3); scene.add(shared);
const reflection = new Reflector(new THREE.PlaneGeometry(5, 5), { textureWidth: 64, textureHeight: 64, multisample: 0 });
reflection.rotation.x = -Math.PI / 2; reflection.position.set(4, -.7, -3); scene.add(reflection);
const userCamera = new THREE.PerspectiveCamera(60, 1, .05, 20);
const eyes = [-.032, .032].map((x, index) => {
  const eye = new THREE.PerspectiveCamera(60, 1, .05, 20);
  eye.position.set(x, 0, 0); eye.updateMatrix();
  eye.matrixWorld.makeTranslation(4 + x, 0, 0); eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
  eye.viewport = new THREE.Vector4(index * 256, 0, 256, 256);
  eye.layers.enable(index + 1); return eye;
});
const arrayCamera = new THREE.ArrayCamera(eyes);
renderer.xr.getCamera = () => arrayCamera; renderer.xr.isPresenting = true; renderer.xr.enabled = true;

const gl = renderer.getContext();
const color = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, color);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
const depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 512, 256);
const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
renderer.resetState();
const destination = new THREE.WebGLRenderTarget(512, 256, { colorSpace: THREE.SRGBColorSpace });
destination.isXRRenderTarget = true;
renderer.setRenderTargetFramebuffer(destination, framebuffer); renderer.setRenderTarget(destination);
const post = createRestorePostprocessing(renderer);
const viewportBefore = renderer.getViewport(new THREE.Vector4()).toArray();
const currentBefore = renderer.getCurrentViewport(new THREE.Vector4()).toArray();
const eyeMatricesBefore = eyes.map(eye => eye.matrixWorld.toArray());
post.render(scene, userCamera);
const pixels = new Uint8Array(512 * 256 * 4); gl.readPixels(0, 0, 512, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
const sample = (x, y) => Array.from(pixels.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 4));
const result = {
  state: post.getState(), center: [sample(130, 139), sample(382, 139)],
  halo: [sample(149, 139), sample(362, 139)],
  seam: [sample(255, 180), sample(256, 180)],
  rendererRestored: renderer.xr.enabled && renderer.getRenderTarget() === destination && renderer.toneMapping === THREE.ACESFilmicToneMapping && renderer.autoClear && renderer.shadowMap.autoUpdate,
  viewportBefore, viewportAfter: renderer.getViewport(new THREE.Vector4()).toArray(),
  currentBefore, currentAfter: renderer.getCurrentViewport(new THREE.Vector4()).toArray(),
  eyeMatricesBefore, eyeMatricesAfter: eyes.map(eye => eye.matrixWorld.toArray()),
  eyeViewports: eyes.map(eye => eye.viewport.toArray()),
  glError: gl.getError(),
};

// A gray quad behind the red/blue panels must fail depth testing where a panel
// was drawn. This catches final compositions which discard scene depth.
renderer.xr.enabled = false; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
const depthProbe = new THREE.Scene();
const occluded = new THREE.Mesh(new THREE.PlaneGeometry(.28, .28), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
occluded.position.set(4, .16, -3.1); depthProbe.add(occluded);
const probeCamera = eyes[0].clone(); probeCamera.matrixWorldAutoUpdate = false; probeCamera.matrixAutoUpdate = false;
renderer.state.viewport(eyes[0].viewport); renderer.render(depthProbe, probeCamera);
gl.readPixels(0, 0, 512, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels); result.afterDepthProbe = sample(130, 139);

// Display the actual two-eye framebuffer as an ordinary image for inspection.
const capture = document.createElement('canvas'); capture.width = 512; capture.height = 256;
const context = capture.getContext('2d'), image = context.createImageData(512, 256);
for(let y=0;y<256;y++) image.data.set(pixels.subarray(y*512*4,(y+1)*512*4),(255-y)*512*4);
context.putImageData(image,0,0); window.stereoImage = capture.toDataURL('image/png');

// Match WebXRManager's modern XRProjectionLayer path, including its external
// textures, multisample resolve and a different swapchain image next frame.
function layerTextures() {
  const colorTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, colorTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const depthTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, depthTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 512, 256, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const readable = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, readable);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);
  renderer.resetState();
  return { colorTexture, depthTexture, readable };
}
const layer = new THREE.WebGLRenderTarget(512, 256, {
  colorSpace: THREE.SRGBColorSpace, samples: 4,
  depthTexture: new THREE.DepthTexture(512, 256, THREE.UnsignedIntType), resolveDepthBuffer: true,
});
layer.isXRRenderTarget = true;
result.projectionLayers = [];
for (let swap = 0; swap < 2; swap++) {
  const textures = layerTextures();
  renderer.setRenderTargetTextures(layer, textures.colorTexture, textures.depthTexture);
  renderer.setRenderTarget(layer);
  renderer.xr.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.autoClear = true;
  post.render(scene, userCamera);
  const restored = renderer.getRenderTarget() === layer && renderer.xr.enabled && renderer.toneMapping === THREE.ACESFilmicToneMapping;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, textures.readable);
  gl.readPixels(0, 0, 512, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const centers = [sample(130, 139), sample(382, 139)];
  const halos = [sample(149, 139), sample(362, 139)];
  // Probe the resolved, externally owned depth texture itself. The layer's
  // intermediate multisample buffer is invalidated after its resolve.
  renderer.resetState();
  const resolvedProbe = new THREE.WebGLRenderTarget(512, 256, { colorSpace: THREE.SRGBColorSpace });
  resolvedProbe.isXRRenderTarget = true;
  renderer.setRenderTargetFramebuffer(resolvedProbe, textures.readable); renderer.setRenderTarget(resolvedProbe);
  renderer.xr.enabled = false; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
  renderer.state.viewport(eyes[0].viewport); renderer.state.scissor(eyes[0].viewport); renderer.state.setScissorTest(true);
  renderer.render(depthProbe, probeCamera);
  gl.readPixels(0, 0, 512, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const afterDepthProbe = sample(130, 139);
  occluded.position.z = -2.9; renderer.render(depthProbe, probeCamera);
  gl.readPixels(0, 0, 512, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const afterFrontProbe = sample(130, 139); occluded.position.z = -3.1;
  result.projectionLayers.push({ swap, samples: layer.samples, centers, halos, afterDepthProbe, afterFrontProbe, restored, glError: gl.getError() });
  renderer.resetState();
}

renderer.setRenderTarget(null); renderer.xr.isPresenting = false; renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.autoClear = true;
userCamera.position.set(4, 0, 0); userCamera.layers.enable(1); userCamera.updateMatrixWorld();
post.render(scene, userCamera); result.desktop = post.getState(); result.desktopGlError = gl.getError();
renderer.setSize(400, 200); post.resize(); post.render(scene, userCamera); result.resized = post.getState();

// The byte-buffer fallback still provides bounded bloom and valid output.
const hasExtension = renderer.extensions.has.bind(renderer.extensions);
renderer.extensions.has = name => name === 'EXT_color_buffer_float' ? false : hasExtension(name);
const fallback = createRestorePostprocessing(renderer); fallback.render(scene, userCamera);
result.fallback = fallback.getState(); result.fallbackGlError = gl.getError();
fallback.dispose(); post.dispose(); window.result = result;
`);

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 512 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.RESTORE_URL || 'http://127.0.0.1:5208'}/${out}/harness.html`);
  await page.waitForFunction(() => window.result, null, { timeout: 60000 });
  const result = await page.evaluate(() => window.result);
  const image = await page.evaluate(() => window.stereoImage);
  await writeFile(`${out}/stereo.png`, Buffer.from(image.split(',')[1], 'base64'));
  await writeFile(`${out}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(result.state.mode, 'xr'); assert.equal(result.state.views, 2);
  assert.deepEqual(result.state.resolution, [256, 256]); assert.deepEqual(result.state.bloomResolution, [64, 64]);
  assert.equal(result.state.scenePasses, 2); assert.equal(result.state.postPasses, 8);
  assert.ok(result.center[0][0] > 150 && result.center[0][0] > result.center[0][2] + 20, 'left-eye red remains in the left eye');
  assert.ok(result.center[1][2] > 150 && result.center[1][2] > result.center[1][0] + 5 && result.center[1][2] > result.center[1][1] + 50, 'right-eye blue remains in the right eye after ACES desaturates its very bright center');
  assert.ok(result.halo[0][0] > 3 && result.halo[1][2] > 3, 'bloom spreads outside the emissive panel in both eyes');
  assert.ok(result.seam.flatMap(pixel => pixel.slice(0, 3)).every(channel => channel < 3), 'bloom does not leak across the stereo seam');
  assert.deepEqual(result.afterDepthProbe, result.center[0], 'scene depth reaches the external headset framebuffer');
  for (const projection of result.projectionLayers) {
    assert.equal(projection.samples, 4); assert.ok(projection.restored); assert.equal(projection.glError, 0);
    assert.deepEqual(projection.centers, result.center, 'XRProjectionLayer multisample resolve preserves both eye colors after each swapchain change');
    assert.deepEqual(projection.halos, result.halo, 'XRProjectionLayer bloom matches the external framebuffer path');
    assert.deepEqual(projection.afterDepthProbe, result.center[0], 'XRProjectionLayer receives the scene depth');
    assert.deepEqual(projection.afterFrontProbe, [0, 255, 0, 255], 'XRProjectionLayer resolved depth correctly allows a closer object');
  }
  assert.ok(result.rendererRestored); assert.deepEqual(result.viewportBefore, result.viewportAfter);
  assert.deepEqual(result.currentBefore, result.currentAfter);
  assert.deepEqual(result.eyeMatricesBefore, result.eyeMatricesAfter);
  assert.deepEqual(result.eyeViewports, [[0, 0, 256, 256], [256, 0, 256, 256]]);
  assert.equal(result.glError, 0); assert.equal(result.desktopGlError, 0); assert.equal(result.fallbackGlError, 0);
  assert.equal(result.desktop.mode, 'desktop'); assert.equal(result.desktop.views, 1);
  assert.deepEqual(result.resized.resolution, [600, 300]); assert.equal(result.fallback.hdr, false);
  console.log(JSON.stringify({ passed: true, checks: ['isolated stereo HDR bloom', 'external XR framebuffer and scene depth', 'multisampled XRProjectionLayer external textures and swapchain', 'Reflector and locomotion eye transforms', 'renderer and viewport restoration', 'desktop resize and byte-buffer fallback'], result }, null, 2));
} finally {
  await browser.close();
}
