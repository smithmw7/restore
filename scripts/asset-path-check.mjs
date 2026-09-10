import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';

// Serve real production builds on an ephemeral port, with no SPA fallback or
// route interception that could conceal an asset escaping the Pages mount.
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'restore-asset-paths-'));
const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wav': 'audio/wav',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};
const checks = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
  for (const base of ['/', '/restore/']) {
    const outDir = path.join(scratch, base === '/' ? 'local' : 'pages');
    await build({ root, base, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const requests = new Set(), failures = [], errors = [];
    const server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        requests.add(pathname);
        assert.ok(pathname.startsWith(base), `asset escaped ${base}: ${pathname}`);
        const relative = pathname.slice(base.length) || 'index.html';
        const filePath = path.resolve(outDir, relative);
        assert.ok(filePath.startsWith(`${outDir}${path.sep}`), 'invalid asset path');
        const body = await readFile(filePath);
        response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
        response.end(body);
      } catch (error) {
        failures.push({ url: request.url, message: error.message });
        response.writeHead(404); response.end('Not found');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
      await page.goto(`${origin}${base}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 120000 });
      const result = await page.evaluate(async () => {
        const diagnostics = window.__restoreDiagnostics();
        const manifestUrl = document.querySelector('link[rel="manifest"]').href;
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error(`Manifest failed: ${response.status}`);
        const manifest = await response.json();
        const startUrl = new URL(manifest.start_url, manifestUrl).href;
        const iconUrls = manifest.icons.map(icon => new URL(icon.src, manifestUrl).href);
        const iconStatuses = await Promise.all(iconUrls.map(async url => (await fetch(url)).status));
        return {
          ready: diagnostics.state.ready, closedCrates: diagnostics.state.closedCrates,
          audio: diagnostics.audio, manifestUrl, startUrl, iconUrls, iconStatuses,
          id: new URL(manifest.id, startUrl).href,
          scope: new URL(manifest.scope, manifestUrl).href,
          documentIcon: document.querySelector('link[rel="icon"]').href,
          entryUrls: [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.src || node.href),
        };
      });
      assert.equal(result.closedCrates, 176, `${base} did not initialize the actual warehouse`);
      assert.equal(result.audio.loaded, 40);
      assert.equal(result.audio.loaded, result.audio.expected, `${base} left undecoded audio`);
      assert.equal(result.manifestUrl, `${origin}${base}manifest.webmanifest`);
      for (const field of ['startUrl', 'id', 'scope']) assert.equal(result[field], `${origin}${base}`, `incorrect manifest ${field}`);
      assert.equal(result.documentIcon, `${origin}${base}icon.svg`);
      assert.deepEqual(result.iconUrls, [`${origin}${base}icon.svg`]);
      assert.deepEqual(result.iconStatuses, [200]);
      assert.ok(result.entryUrls.length >= 2, 'missing built script or stylesheet');
      for (const url of result.entryUrls) assert.ok(url.startsWith(`${origin}${base}assets/`), `incorrect bundle URL: ${url}`);
      const audioFiles = [...requests].filter(url => url.startsWith(`${base}audio/`) && url.endsWith('.wav'));
      const textures = [...requests].filter(url => url.startsWith(`${base}materials/`) && url.endsWith('.webp'));
      assert.equal(audioFiles.length, 40, `${base} did not request every sound`);
      assert.equal(textures.length, 24, `${base} did not request every material texture`);
      assert.deepEqual(failures, [], `${base} has missing or escaped files`);
      assert.deepEqual(errors, [], `${base} has browser errors`);
      checks.push({ base, crates: result.closedCrates, decodedSounds: audioFiles.length, materialTextures: textures.length, manifest: 'valid', errors });
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await browser?.close();
  await rm(scratch, { recursive: true, force: true });
}
