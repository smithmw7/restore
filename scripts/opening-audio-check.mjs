import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// Every request is fulfilled from this checkout. No app server or headset is
// needed, and Chrome is muted so this functional check does not play aloud.
const origin = 'http://127.0.0.1:5298';
const report = JSON.parse(await readFile(new URL('../docs/opening-audio-normalization.json', import.meta.url)));
assert.equal(report.clips.length, 8);
assert.ok(report.total_bytes < 900_000);
for (const clip of report.clips) {
  const bytes = await readFile(new URL(`../${clip.output}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.output_sha256);
  assert.ok(clip.after_gain.true_peak_dbtp <= -4);
  assert.ok(Math.abs(clip.after_gain.integrated_lufs - clip.target_lufs) <= .15);
  assert.equal(clip.clipped_samples, 0);
  assert.equal(clip.output_format.streams[0].channels, 1);
  assert.ok(clip.output_duration_seconds <= 1.7);
}
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/opening-audio-harness', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><link rel="icon" href="data:,"><title>Silent opening Foley check</title>' }));
  await page.route('**/audio/**/*.wav', async route => route.fulfill({ contentType: 'audio/wav',
    body: await readFile(new URL(`../public${new URL(route.request().url()).pathname}`, import.meta.url)) }));
  await page.route('**/opening-audio-module.js', async route => route.fulfill({ contentType: 'text/javascript',
    body: await readFile(new URL('../src/audio.js', import.meta.url), 'utf8') }));
  await page.goto(`${origin}/opening-audio-harness`);
  const result = await page.evaluate(async () => {
    const NativeContext = window.AudioContext;
    let context, sourceCount = 0, oscillatorCount = 0;
    const panners = [], gains = [];
    window.AudioContext = class extends NativeContext {
      constructor(options) { super(options); context = this; }
      createBufferSource() { sourceCount++; return super.createBufferSource(); }
      createOscillator() { oscillatorCount++; return super.createOscillator(); }
      createPanner() { const node = super.createPanner(); panners.push(node); return node; }
      createGain() { const node = super.createGain(); gains.push(node); return node; }
    };
    const { createRestoreAudio } = await import('/opening-audio-module.js');
    const audio = createRestoreAudio(), position = { x: 2, y: 1.1, z: -4 };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      const beforeLoad = audio.playPuzzle('drawer', position, true);
      await audio.load(); audio.unlock(); await wait(50);
      const decoded = audio.getState();
      const actions = ['drawer', 'notebook', 'dial', 'case-open', 'locker', 'equip',
        'cutter-pickup', 'cut', 'container-door', 'photo', 'align', 'install', 'paper-pickup', 'small-pickup', 'chair-pickup', 'small-drop'];
      const events = [];
      for (const action of actions) {
        const accepted = audio.playPuzzle(action, position, true);
        events.push({ action, accepted, event: audio.getState().lastEvents.at(-1) });
        await wait(100);
      }
      const afterActions = audio.getState();
      const positions = panners.map(p => [p.positionX.value, p.positionY.value, p.positionZ.value]);
      const invalidBefore = sourceCount;
      const unknown = audio.playPuzzle('missing', position, true);
      const prototype = audio.playPuzzle('__proto__', position, true);
      const invalidAllocated = sourceCount - invalidBefore;
      await wait(300);
      const firstAlign = audio.playPuzzle('align', position, true);
      const repeatedAlign = Array.from({ length: 50 }, () => audio.playPuzzle('align', position, true)).filter(Boolean).length;
      await wait(300);
      const resumedAlign = audio.playPuzzle('align', position, true);
      const firstDial = audio.playPuzzle('dial', position, false);
      const repeatedDial = audio.playPuzzle('dial', position, false);
      await wait(60);
      const resumedDial = audio.playPuzzle('dial', position, false);
      const mutedBefore = sourceCount;
      audio.setMuted(true); await wait(70);
      const muted = audio.playPuzzle('cut', position, true);
      const mutedAllocated = sourceCount - mutedBefore;
      const masterGainWhileMuted = gains[0].gain.value;
      audio.setMuted(false);
      // Old fracture voices and opening events retain one common voice budget.
      for (let i = 0; i < 40; i++) audio.playBreak('gem', position, true);
      const burstAccepted = audio.playPuzzle('install', position, true);
      const burst = audio.getState();
      await wait(1900);
      const settled = audio.getState();
      return { beforeLoad, decoded, events, positions, afterActions, unknown, prototype,
        invalidAllocated, firstAlign, repeatedAlign, resumedAlign, firstDial, repeatedDial,
        resumedDial, muted, mutedAllocated, masterGainWhileMuted, burstAccepted, burst, settled,
        oscillatorCount, sampleRate: context.sampleRate };
    } finally { audio.setMuted(true); await context.close(); window.AudioContext = NativeContext; }
  });
  assert.equal(result.beforeLoad, false);
  assert.equal(result.decoded.loaded, 48); assert.equal(result.decoded.expected, 48);
  const patterns = { 'paper-pickup': /opening\/paper-01\.wav$/, 'small-pickup': /opening\/tool-01\.wav$/, 'chair-pickup': /actions\/wood-creak-0[12]\.wav$/, 'small-drop': /opening\/tool-01\.wav$/, equip: /repair\/pickup-0[12]\.wav$/, align: /repair\/hit-metal-light-0[12]\.wav$/,
    drawer: /opening\/drawer-01\.wav$/, notebook: /opening\/paper-01\.wav$/, dial: /opening\/dial-01\.wav$/,
    'case-open': /opening\/latch-01\.wav$/, locker: /opening\/locker-01\.wav$/,
    'cutter-pickup': /opening\/tool-01\.wav$/, cut: /opening\/cut-01\.wav$/,
    'container-door': /opening\/hinge-01\.wav$/, photo: /opening\/paper-01\.wav$/, install: /opening\/latch-01\.wav$/ };
  for (const { action, accepted, event } of result.events) {
    assert.equal(accepted, true, action);
    assert.equal(event.type, `puzzle:${action}`);
    assert.match(event.clip, patterns[action]);
    assert.ok(event.gain > 0 && event.gain <= .88);
  }
  assert.equal(result.positions.length, 16);
  for (const position of result.positions) assert.deepEqual(position.map(x => +x.toFixed(3)), [2, 1.1, -4]);
  assert.equal(result.unknown, false); assert.equal(result.prototype, false); assert.equal(result.invalidAllocated, 0);
  assert.equal(result.firstAlign, true); assert.equal(result.repeatedAlign, 0); assert.equal(result.resumedAlign, true);
  assert.equal(result.firstDial, true); assert.equal(result.repeatedDial, false); assert.equal(result.resumedDial, true);
  assert.equal(result.muted, false); assert.equal(result.mutedAllocated, 0); assert.ok(result.masterGainWhileMuted < .001);
  assert.equal(result.burstAccepted, true); assert.ok(result.burst.activeVoices <= 12);
  assert.equal(result.settled.activeVoices, 0); assert.equal(result.settled.loopActive, false);
  assert.equal(result.afterActions.activeReveals, 0); assert.equal(result.oscillatorCount, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, clips: 8, totalBytes: report.total_bytes,
    decoded: result.decoded.loaded, mappedActions: result.events.length,
    maxBurstVoices: result.burst.activeVoices, settledVoices: result.settled.activeVoices,
    checks: ['measured output hashes and normalization', '48 real browser WAV decodes',
      '16 action mappings and spatial positions', 'no automatic reveal or chime',
      'bounded alignment and dial events', 'mute and invalid action silence',
      'shared twelve-voice limit and natural source cleanup'],
    scope: 'Silent Chrome WebAudio verification. Physical headset listening is not established.' }, null, 2));
} finally { await browser.close(); }
