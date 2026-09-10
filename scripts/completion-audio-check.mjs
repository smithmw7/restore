import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin = process.env.RESTORE_TEST_URL || 'http://127.0.0.1:5208';
const out = 'output/completion-audio';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/completion-audio-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Silent completion audio check</title>' }));
  await page.route('**/audio/**/*.wav', async route => route.fulfill({ contentType: 'audio/wav',
    body: await readFile(new URL(`../public${new URL(route.request().url()).pathname}`, import.meta.url)) }));
  const source = await readFile(new URL('../src/audio.js', import.meta.url), 'utf8');
  await page.route('**/completion-audio-module.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
  await page.goto(`${origin}/completion-audio-harness`);
  const result = await page.evaluate(async () => {
    const NativeContext = window.AudioContext;
    const starts = [], panners = [];
    let realContext, requestedSampleRate = 44100;
    window.AudioContext = class extends NativeContext {
      constructor(options) { super({ ...options, sampleRate: requestedSampleRate }); realContext = this; }
      createPanner() { const panner = super.createPanner(); panners.push(panner); return panner; }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start, stop = node.stop;
        const metadata = { node, startTime: null, stopTime: null, ended: false };
        node.start = function (when = 0, ...args) {
          metadata.startTime = when || realContext.currentTime; metadata.buffer = this.buffer;
          starts.push(metadata); return start.call(this, when, ...args);
        };
        node.stop = function (when = 0) { metadata.stopTime = when || realContext.currentTime; return stop.call(this, when); };
        node.addEventListener('ended', () => { metadata.ended = true; });
        return node;
      }
    };
    const { createRestoreAudio } = await import('/completion-audio-module.js');
    const audio = createRestoreAudio(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const p = { x: 2, y: 1.6, z: -3 }, checkpoints = {};
    const save = name => { checkpoints[name] = audio.getState(); };
    function describe(buffer) {
      const data = buffer.getChannelData(0);
      let peak = 0, energy = 0;
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
      const frequencies = [523.25, 659.25, 783.99, 1046.5];
      const noteWindows = [.035, .155, .275, .415].map(start => {
        const first = Math.round(start * buffer.sampleRate), count = Math.round(.04 * buffer.sampleRate);
        const magnitudes = frequencies.map(frequency => {
          let sine = 0, cosine = 0;
          for (let index = 0; index < count; index++) {
            const weight = .5 - .5 * Math.cos(2 * Math.PI * index / (count - 1));
            const phase = 2 * Math.PI * frequency * (first + index) / buffer.sampleRate;
            sine += data[first + index] * weight * Math.sin(phase);
            cosine += data[first + index] * weight * Math.cos(phase);
          }
          return Math.hypot(sine, cosine) / count;
        });
        return { time: start, magnitudes, dominant: magnitudes.indexOf(Math.max(...magnitudes)) };
      });
      return { channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, duration: buffer.duration,
        peak, rms: Math.sqrt(energy / data.length), first: data[0], last: data.at(-1), noteWindows };
    }
    function encodePcm(buffer) {
      const data = buffer.getChannelData(0), bytes = new Uint8Array(data.length * 2), view = new DataView(bytes.buffer);
      for (let index = 0; index < data.length; index++) view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, data[index])) * 32767), true);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      return btoa(binary);
    }
    try {
      await audio.load(); audio.unlock(); await wait(50);
      audio.playPickup('vase', p, true);
      audio.startDrag('vase', p, true); audio.updateDrag({ position: p, speed: 1 }); await wait(140);
      save('beforeComplete'); const beforeSources = starts.length;
      const accepted = audio.playComplete('artifact-01', p, true); save('complete');
      const first = starts.at(-1), metrics = describe(first.buffer), pcm = encodePcm(first.buffer);
      const completionSources = starts.length - beforeSources;
      const position = panners.at(-1);
      const spatialPosition = [position.positionX.value, position.positionY.value, position.positionZ.value];
      await wait(50); save('dragStopped');
      await wait(1200); save('naturalEnd');
      audio.playPickup('vase', p, true); audio.playDock('vase', p, true); save('pickupAndDock');
      audio.playComplete('artifact-02', p, true);
      const mutedReveal = starts.at(-1), cached = mutedReveal.buffer === first.buffer;
      await wait(45); audio.setMuted(true); await wait(50); save('muted');
      const mutedAccepted = audio.playComplete('artifact-03', p, true); save('mutedAttempt');
      audio.setMuted(false); await wait(150); save('unmuted');
      audio.playComplete('artifact-04', p, true); const resetReveal = starts.at(-1);
      await wait(45); audio.playRestore(); await wait(50); save('reset');
      await wait(500);
      for (let index = 0; index < 30; index++) audio.playComplete(`artifact-${index + 10}`, p, true);
      save('burst'); audio.setMuted(true); await wait(50); save('burstCleanup');
      const cancelled = { mute: { ended: mutedReveal.ended, stopDelay: mutedReveal.stopTime - mutedReveal.startTime },
        reset: { ended: resetReveal.ended, stopDelay: resetReveal.stopTime - resetReveal.startTime } };
      await realContext.close();
      requestedSampleRate = 48000;
      const alternate = createRestoreAudio(); alternate.playComplete('artifact-48khz', p, false);
      const alternateRate = describe(starts.at(-1).buffer);
      alternate.setMuted(true); await wait(50); await realContext.close();
      return { checkpoints, accepted, mutedAccepted, completionSources, spatialPosition, cached, metrics, alternateRate, cancelled, pcm };
    } finally {
      if (realContext.state !== 'closed') { audio.setMuted(true); await realContext.close(); }
      window.AudioContext = NativeContext;
    }
  });
  const c = result.checkpoints;
  assert.equal(result.accepted, true); assert.equal(result.completionSources, 1);
  assert.equal(c.complete.lastClip, 'synth:artifact-reveal'); assert.equal(c.complete.eventCounts.complete, 1);
  assert.equal(c.complete.lastEvents.at(-1).objectId, 'artifact-01');
  assert.equal(c.complete.eventCounts.pickup, c.beforeComplete.eventCounts.pickup);
  assert.equal(c.complete.loopActive, false); assert.equal(c.dragStopped.loopVoices, 0);
  assert.ok(result.spatialPosition.every((value, index) => Math.abs(value - [2, 1.6, -3][index]) < 1e-6)); assert.equal(result.cached, true);
  for (const metrics of [result.metrics, result.alternateRate]) {
    assert.equal(metrics.channels, 1); assert.ok(Math.abs(metrics.duration - 1.16) < 1 / metrics.sampleRate);
    assert.ok(metrics.peak > .4 && metrics.peak <= .520001); assert.ok(metrics.rms > .05 && metrics.rms <= .135001);
    assert.ok(Math.abs(metrics.first) < .00001 && Math.abs(metrics.last) < .00001);
    assert.deepEqual(metrics.noteWindows.map(window => window.dominant), [0, 1, 2, 3], 'PCM does not contain the distinct ascending major phrase');
  }
  assert.equal(result.metrics.sampleRate, 44100); assert.equal(result.alternateRate.sampleRate, 48000);
  assert.ok(result.metrics.peak * c.complete.lastEvents.at(-1).gain < .35, 'reveal exceeds the planned mix headroom');
  assert.equal(c.naturalEnd.activeReveals, 0); assert.equal(c.naturalEnd.eventCounts.complete, 1);
  assert.equal(c.pickupAndDock.eventCounts.complete, 1); assert.match(c.pickupAndDock.lastClip, /repair\/pickup-/);
  assert.equal(result.mutedAccepted, false); assert.equal(c.mutedAttempt.eventCounts.complete, c.muted.eventCounts.complete);
  for (const name of ['muted', 'mutedAttempt', 'unmuted', 'reset', 'burstCleanup']) assert.equal(c[name].activeReveals, 0, `${name} left future reveal notes active`);
  for (const cancellation of Object.values(result.cancelled)) { assert.equal(cancellation.ended, true); assert.ok(cancellation.stopDelay < .15); }
  assert.equal(c.reset.eventCounts.restore, 1); assert.equal(c.burst.activeReveals, 12); assert.ok(c.burst.activeVoices <= 12);
  assert.deepEqual(errors, []);
  const checks = ['one final-join event produces one distinctive reveal source and complete record, without an Armor replay',
    'cached mono PCM resolves C5, E5, G5, C6 over 1.16 seconds at 44.1/48kHz with bounded peak/RMS and click-free ends',
    'completion stops dragging immediately and places the reveal at the artifact',
    'natural completion, re-pickup and docking do not repeat the reveal',
    'mute and reset cancel pending notes; repeated reveals stay within the shared 12-voice budget'];
  const pcm = Buffer.from(result.pcm, 'base64'), wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(result.metrics.sampleRate, 24);
  wav.writeUInt32LE(result.metrics.sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  await writeFile(`${out}/reveal-preview.wav`, wav);
  delete result.pcm;
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: true, checks, errors,
    scope: 'Silent real-WebAudio and synthesized waveform verification, not physical headset listening.', ...result }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, metrics: result.metrics, errors }, null, 2));
} finally { await browser.close(); }
