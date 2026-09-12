import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// All requests come from this checkout; the test does not require a live app,
// downloads, speakers, or a connected headset.
const origin = 'http://127.0.0.1:5298', out = 'output/field-audio';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/field-audio-harness', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><link rel="icon" href="data:,"><title>Silent physical field audio check</title>' }));
  await page.route('**/audio/**/*.wav', async route => route.fulfill({ contentType: 'audio/wav',
    body: await readFile(new URL(`../public${new URL(route.request().url()).pathname}`, import.meta.url)) }));
  await page.route('**/field-audio-module.js', async route => route.fulfill({ contentType: 'text/javascript',
    body: await readFile(new URL('../src/audio.js', import.meta.url), 'utf8') }));
  await page.goto(`${origin}/field-audio-harness`);
  const result = await page.evaluate(async () => {
    const NativeContext = window.AudioContext;
    const starts = [], panners = [], gains = [], generated = [];
    let context, allocations = 0;
    window.AudioContext = class extends NativeContext {
      constructor(options) { super({ ...options, sampleRate: 48000 }); context = this; }
      createGain() { const node = super.createGain(); gains.push(node); return node; }
      createPanner() { const node = super.createPanner(); panners.push(node); return node; }
      createBuffer(...args) { const buffer = super.createBuffer(...args); generated.push(buffer); return buffer; }
      createBufferSource() {
        allocations++;
        const node = super.createBufferSource(), start = node.start, stop = node.stop;
        const entry = { node, startTime: null, stopTime: null, ended: false };
        node.start = function (when = 0, ...args) {
          entry.startTime = when || context.currentTime; entry.buffer = this.buffer;
          starts.push(entry); return start.call(this, when, ...args);
        };
        node.stop = function (when = 0) { entry.stopTime = when || context.currentTime; return stop.call(this, when); };
        node.addEventListener('ended', () => { entry.ended = true; });
        return node;
      }
    };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const { createRestoreAudio } = await import('/field-audio-module.js');
    const audio = createRestoreAudio(), p = { x: 1.2, y: 1.6, z: -3 }, checkpoints = {};
    const save = name => { checkpoints[name] = audio.getState(); };
    const metrics = buffer => {
      const data = buffer.getChannelData(0);
      let peak = 0, energy = 0;
      const windows = Array.from({ length: 8 }, (_, window) => {
        let energy = 0, count = 0;
        for (let i = Math.floor(window * data.length / 8); i < Math.floor((window + 1) * data.length / 8); i++) {
          energy += data[i] ** 2; count++;
        }
        return Math.sqrt(energy / count);
      });
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); energy += value ** 2; }
      return { duration: buffer.duration, sampleRate: buffer.sampleRate, peak, rms: Math.sqrt(energy / data.length),
        first: data[0], last: data.at(-1), seam: Math.abs(data[0] - data.at(-1)),
        seamSlopeError: Math.abs((data[0] - data.at(-1)) - (data[1] - data[0])), windows };
    };
    const encode = buffer => {
      const data = buffer.getChannelData(0), bytes = new Uint8Array(data.length * 2), view = new DataView(bytes.buffer);
      for (let i = 0; i < data.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), true);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    };
    try {
      const ignoredBeforeLoad = audio.updateField({ active: true, signal: 1, position: p });
      const preLoad = audio.getState();
      await audio.load(); audio.unlock(); await wait(40); save('loaded');
      const generatedDuringLoad = generated.length;
      const started = audio.updateField({ active: true, signal: .15, position: p, spatial: true, stage: 0 });
      const first = starts.at(-1), fieldMetrics = metrics(first.buffer);
      await wait(200); save('quietApproach');
      for (let i = 1; i <= 240; i++) audio.updateField({ active: true, signal: i / 240, position: p, spatial: true, stage: 1 });
      const movingPosition = { x: 1.4, y: 1.7, z: -2.5 };
      audio.updateField({ active: true, signal: 1, position: movingPosition, spatial: true, stage: 1 });
      await wait(330); save('nearFit');
      const fieldSources = starts.filter(entry => entry.node.loop).length;
      const fieldPanner = panners.at(-1), positioned = [fieldPanner.positionX.value, fieldPanner.positionY.value, fieldPanner.positionZ.value];
      const cancelAt = context.currentTime;
      audio.updateField({ active: false }); save('cancelled');
      await wait(80); save('cancelledCleanup');
      const stopDelay = first.stopTime - cancelAt;
      audio.updateField({ active: true, signal: .8, position: p, spatial: true });
      const cachedField = starts.at(-1).buffer === first.buffer;
      audio.setMuted(true); await wait(80); save('muted');
      const mutedAllocatedBefore = allocations;
      const mutedAttempt = audio.updateField({ active: true, signal: 1, position: p });
      const mutedMilestone = audio.playFieldMilestone(1, p, true);
      const mutedAllocated = allocations - mutedAllocatedBefore;
      const mutedMaster = gains[0].gain.value;
      audio.setMuted(false); await wait(100); save('unmutedIdle');
      const freshAfterMute = audio.updateField({ active: true, signal: 1, position: p });
      save('freshAfterMute'); audio.stopField(); await wait(80);
      // Very fast invalid/revalid fits are bounded even before ended callbacks.
      let maxRapidVoices = 0, maxRapidFields = 0;
      for (let i = 0; i < 100; i++) {
        audio.updateField({ active: true, signal: .8, position: p });
        maxRapidVoices = Math.max(maxRapidVoices, audio.getState().activeVoices);
        maxRapidFields = Math.max(maxRapidFields, audio.getState().fieldVoices);
        audio.stopField();
      }
      await wait(90); save('rapidCleanup');
      audio.updateField({ active: true, signal: 1, position: p });
      for (let i = 0; i < 40; i++) audio.playBreak('gem', p);
      save('budgetEvicted');
      const beforeRetry = allocations;
      for (let i = 0; i < 100; i++) audio.updateField({ active: true, signal: 1, position: p });
      const retryAllocations = allocations - beforeRetry;
      await wait(2500); save('budgetCleanup');
      const milestones = [];
      for (let stage = 1; stage <= 4; stage++) {
        const accepted = audio.playFieldMilestone(stage, p, true);
        const last = starts.at(-1), description = metrics(last.buffer), pcm = encode(last.buffer);
        const duplicateBefore = allocations;
        const duplicate = audio.playFieldMilestone(stage, p, true);
        milestones.push({ stage, accepted, duplicate, duplicateAllocated: allocations - duplicateBefore,
          description, pcm, state: audio.getState() });
        await wait(60);
      }
      save('milestoneOverlap');
      const badBefore = allocations;
      const invalid = [0, 5, NaN, 1.5, '1'].map(stage => audio.playFieldMilestone(stage, p));
      const invalidAllocated = allocations - badBefore;
      await wait(4400); save('milestonesEnded');
      audio.playRestore(); await wait(50);
      const resetReplay = audio.playFieldMilestone(4, p, true);
      const cachedMilestone = starts.at(-1).buffer === generated.find(buffer => Math.abs(buffer.duration - 4.2) < .001);
      audio.setMuted(true); await wait(80); save('milestoneMute');
      audio.setMuted(false); await wait(80); save('milestoneUnmute');
      audio.playRestore(); await wait(50);
      audio.updateField({ active: true, signal: 1, position: p });
      audio.playFieldMilestone(3, p, true); save('installTransition');
      audio.playRestore(); await wait(90); save('resetCleanup');
      const lastAllocations = allocations;
      audio.stopField(); audio.stopField(); audio.updateField({ active: false });
      const dedupShutdown = allocations === lastAllocations;
      return { checkpoints, ignoredBeforeLoad, preLoad, generatedDuringLoad, generatedAtEnd: generated.length,
        started, fieldSources, fieldMetrics, positioned, stopDelay, firstEnded: first.ended, cachedField,
        mutedAttempt, mutedMilestone, mutedAllocated, mutedMaster, freshAfterMute, maxRapidVoices, maxRapidFields,
        retryAllocations, milestones, invalid, invalidAllocated, resetReplay, cachedMilestone, dedupShutdown };
    } finally { audio.setMuted(true); await context.close(); window.AudioContext = NativeContext; }
  });
  const c = result.checkpoints;
  assert.equal(result.ignoredBeforeLoad, false); assert.equal(result.preLoad.contextState, 'uninitialized');
  assert.equal(c.loaded.loaded, 48); assert.equal(c.loaded.expected, 48);
  assert.equal(result.generatedDuringLoad, 6); assert.equal(result.generatedAtEnd, 6, 'audio was synthesized on an interaction frame');
  assert.equal(result.started, true); assert.equal(result.fieldSources, 1, 'signal updates allocated a source per frame');
  assert.equal(c.nearFit.fieldActive, true); assert.equal(c.nearFit.fieldSignal, 1);
  assert.ok(c.quietApproach.fieldTargetGain > 0 && c.quietApproach.fieldTargetGain < .02);
  assert.equal(c.nearFit.fieldTargetGain, .065); assert.ok(c.nearFit.fieldGain <= .065001);
  assert.ok(result.fieldMetrics.rms <= .150001 && result.fieldMetrics.peak <= .380001);
  assert.ok(result.fieldMetrics.seamSlopeError < .00001, 'discontinuous slope at loop seam');
  assert.ok(result.fieldMetrics.rms * c.nearFit.fieldMaxGain < .01, 'field is too loud for a continuous layer');
  assert.deepEqual(result.positioned.map(value => +value.toFixed(3)), [1.4, 1.7, -2.5]);
  assert.equal(c.cancelled.fieldActive, false); assert.equal(c.cancelled.fieldSignal, 0);
  assert.equal(c.cancelledCleanup.fieldVoices, 0); assert.equal(result.firstEnded, true);
  assert.ok(result.stopDelay >= .03 && result.stopDelay <= .032);
  assert.equal(result.cachedField, true); assert.equal(result.mutedAttempt, false); assert.equal(result.mutedMilestone, false);
  assert.equal(result.mutedAllocated, 0); assert.ok(result.mutedMaster < .001);
  assert.equal(c.muted.fieldVoices, 0); assert.equal(c.unmutedIdle.fieldActive, false);
  assert.equal(result.freshAfterMute, true); assert.equal(c.freshAfterMute.fieldActive, true);
  assert.ok(result.maxRapidVoices <= 2); assert.ok(result.maxRapidFields <= 2);
  assert.equal(c.rapidCleanup.activeVoices, 0); assert.equal(c.rapidCleanup.fieldVoices, 0);
  assert.ok(c.budgetEvicted.activeVoices <= 12); assert.equal(c.budgetEvicted.fieldActive, false);
  assert.equal(result.retryAllocations, 0); assert.equal(c.budgetCleanup.activeVoices, 0);
  for (const milestone of result.milestones) {
    assert.equal(milestone.accepted, true); assert.equal(milestone.duplicate, false); assert.equal(milestone.duplicateAllocated, 0);
    assert.equal(milestone.state.lastEvents.at(-1).type, 'fieldMilestone');
    assert.equal(milestone.state.lastEvents.at(-1).objectId, milestone.stage);
    assert.ok(milestone.description.peak <= .580001 && milestone.description.rms <= .115001);
    assert.ok(milestone.description.peak * milestone.state.lastEvents.at(-1).gain < .31);
    assert.ok(Math.abs(milestone.description.first) < .000001 && Math.abs(milestone.description.last) < .000001);
    assert.ok(milestone.state.activeFieldMilestones <= 2); assert.ok(milestone.state.activeVoices <= 12);
    const pcm = Buffer.from(milestone.pcm, 'base64'), wav = Buffer.alloc(44 + pcm.length), rate = milestone.description.sampleRate;
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
    await writeFile(`${out}/milestone-${milestone.stage}-preview.wav`, wav); delete milestone.pcm;
  }
  assert.equal(result.milestones[3].description.duration, 4.2);
  assert.ok(result.milestones[3].description.windows[6] > .001, 'awakening tail ended prematurely');
  assert.deepEqual(result.invalid, [false, false, false, false, false]); assert.equal(result.invalidAllocated, 0);
  assert.equal(c.milestonesEnded.activeFieldMilestones, 0); assert.equal(c.milestonesEnded.activeVoices, 0);
  assert.equal(result.resetReplay, true); assert.equal(result.cachedMilestone, true);
  for (const name of ['milestoneMute', 'milestoneUnmute', 'resetCleanup']) {
    assert.equal(c[name].activeFieldMilestones, 0); assert.equal(c[name].fieldActive, false); assert.equal(c[name].fieldVoices, 0);
  }
  assert.equal(c.installTransition.fieldActive, false); assert.equal(c.installTransition.activeFieldMilestones, 1);
  assert.equal(result.dedupShutdown, true); assert.deepEqual(errors, []);
  const checks = ['48 recordings unchanged; all five field buffers cached during load',
    'quiet seamless resonance follows signal and world position without per-frame source allocations',
    '30 ms release, mute, unmute, repeated cancel and reset cleanly retire the field',
    'fracture voices can evict the field; shared twelve-voice budget and retry throttle hold',
    'four distinct cached checkpoint bodies with a 4.2-second awakening, quiet normalized peaks and tails',
    'checkpoint deduplication, invalid input rejection, two-tail cap and cancellation'];
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: true, checks, errors,
    scope: 'Silent Chrome WebAudio and waveform verification. Physical headset listening is not established.', ...result }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, fieldRms: result.fieldMetrics.rms,
    milestoneDurations: result.milestones.map(entry => entry.description.duration), errors }, null, 2));
} finally { await browser.close(); }
