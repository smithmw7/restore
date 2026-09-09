#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = path.join(projectRoot, 'dist');
const port = 5207;
// Horizon's system launcher rejects localhost hostnames on some OS versions.
// Numeric loopback remains a secure context and uses the same USB reverse.
const origin = `http://127.0.0.1:${port}/`;
const args = new Set(process.argv.slice(2));
let ownedServer;

if (args.has('--help') || args.has('-h')) {
  console.log(`Restore USB launcher\n\nUsage: npm run quest [-- --no-build]\n\nBuilds Restore, serves it at ${origin}, forwards USB traffic, and opens\nMeta Quest Browser. Keep this terminal and the USB connection open while playing.\n\nOptions:\n  --no-build   Serve the existing dist folder without rebuilding.\n  --help       Show this help without contacting a device.\n\nSet ANDROID_SERIAL to choose a headset when more than one device is connected.\nADB is found on PATH, in ANDROID_HOME / ANDROID_SDK_ROOT, or in the usual macOS SDK.\nYou can also set ADB_PATH to the adb executable.\n\nAn existing server is reused only when its app identity and page title match Restore.`);
  process.exit(0);
}

const unknownArgs = [...args].filter((arg) => arg !== '--no-build');
if (unknownArgs.length) {
  console.error(`Unknown option: ${unknownArgs.join(', ')}. Run npm run quest -- --help.`);
  process.exit(1);
}

function run(command, commandArgs, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${path.basename(command)} failed (${signal || code}).${output.trim() ? `\n${output.trim()}` : ''}`));
    });
  });
}

async function findAdb() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    process.env.ADB_PATH,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((folder) => path.join(folder, executable)),
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', executable),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', executable),
    path.join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', executable),
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Continue to the next supported SDK location. */ }
  }
  throw new Error('ADB was not found. Install Android SDK Platform Tools or set ADB_PATH to your adb executable. Then run npm run quest again.');
}

async function chooseDevice(adb) {
  const output = await run(adb, ['devices', '-l']);
  const devices = output.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\S+)\s+(device|unauthorized|offline|recovery|sideload|bootloader)\b/);
    return match && { serial: match[1], status: match[2] };
  }).filter(Boolean);
  const requested = process.env.ANDROID_SERIAL;
  if (requested) {
    const device = devices.find(({ serial }) => serial === requested);
    if (!device) throw new Error(`ANDROID_SERIAL=${requested} is not connected. Check USB, wake the headset, and run adb devices.`);
    if (device.status !== 'device') throw new Error(deviceHelp(device));
    return device.serial;
  }
  const authorized = devices.filter(({ status }) => status === 'device');
  if (authorized.length === 1) return authorized[0].serial;
  if (authorized.length > 1) {
    throw new Error(`More than one authorized device is connected: ${authorized.map(({ serial }) => serial).join(', ')}. Run ANDROID_SERIAL=YOUR_HEADSET_SERIAL npm run quest.`);
  }
  if (devices.length) throw new Error(devices.map(deviceHelp).join('\n'));
  throw new Error('No Android device is connected. Connect the headset with a USB data cable, enable Developer Mode, put it on, and accept Allow USB debugging. Then run npm run quest again.');
}

function deviceHelp({ serial, status }) {
  if (status === 'unauthorized') return `${serial} is unauthorized. Put on the headset and accept Allow USB debugging, then run npm run quest again.`;
  return `${serial} is ${status}. Wake and reconnect the headset, wait until adb devices shows device, then run npm run quest again.`;
}

function hasRestoreTitle(html) {
  return /<title\b[^>]*>\s*Restore\s*<\/title>/i.test(html);
}

async function validateBuild() {
  try {
    const identity = JSON.parse(await readFile(path.join(distRoot, 'restore.json'), 'utf8'));
    const html = await readFile(path.join(distRoot, 'index.html'), 'utf8');
    if (identity.app !== 'restore' || !hasRestoreTitle(html)) throw new Error('App identity or page title does not match Restore.');
  } catch (error) {
    throw new Error(`The production build is missing or cannot be verified. Run npm run build.\n${error.message}`);
  }
}

async function existingServerIsRestore() {
  try {
    const [identityResponse, pageResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/restore.json`, { signal: AbortSignal.timeout(2500), redirect: 'error' }),
      fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500), redirect: 'error' }),
    ]);
    if (!identityResponse.ok || !pageResponse.ok) return false;
    const [identity, html] = await Promise.all([identityResponse.json(), pageResponse.text()]);
    return identity.app === 'restore' && hasRestoreTitle(html);
  } catch { return false; }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

async function serveBuild() {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const urlPath = decodeURIComponent(new URL(request.url, origin).pathname);
      const filePath = path.resolve(distRoot, `.${urlPath === '/' ? '/index.html' : urlPath}`);
      if (!filePath.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const file = await stat(filePath);
      if (!file.isFile()) throw new Error('Not a file');
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        'Content-Length': file.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filePath).on('error', () => response.destroy()).pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(404).end('Not found');
      else response.destroy();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    ownedServer = server;
    console.log(`Serving the production build at ${origin}`);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    if (!(await existingServerIsRestore())) {
      throw new Error(`Port ${port} is already occupied and its content is not verified as Restore. Stop that server yourself or free the port, then run npm run quest again. No existing process was stopped.`);
    }
    console.log(`Reusing the verified Restore server on port ${port}. Keep its terminal open.`);
  }
}

function stop() {
  if (ownedServer) {
    ownedServer.closeAllConnections();
    ownedServer.close();
    console.log('\nRestore server stopped. Run npm run quest to play again.');
  }
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  const adb = await findAdb();
  const serial = await chooseDevice(adb);
  console.log(`Using connected device ${serial}`);
  if (!args.has('--no-build')) {
    console.log('Building Restore...');
    if (process.env.npm_execpath) await run(process.execPath, [process.env.npm_execpath, 'run', 'build'], { inherit: true });
    else await run('npm', ['run', 'build'], { inherit: true });
  }
  await validateBuild();
  await serveBuild();
  await run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  const launchOutput = await run(adb, [
    '-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
    '-n', 'com.oculus.vrshell/.MainActivity', '-d', 'systemux://browser', '-e', 'uri', origin,
  ]);
  if (/Error:|Exception|unable to resolve Intent/i.test(launchOutput)) throw new Error(`The Browser launch was not accepted.\n${launchOutput}`);
  console.log(`\nRestore was opened in Meta Quest Browser at ${origin}.\nPut on the headset, choose Enter VR, and accept the VR / hand tracking prompt if shown.\nKeep the USB cable connected and the Restore server running.\nAfter disconnecting USB or restarting the headset, run npm run quest again.\nA Browser launch does not confirm VR is active until you choose Enter VR.`);
  if (ownedServer) console.log('Press Ctrl+C to stop this server.');
} catch (error) {
  console.error(`\nRestore could not start: ${error.message}`);
  if (ownedServer) {
    ownedServer.closeAllConnections();
    ownedServer.close();
  }
  process.exitCode = 1;
}
