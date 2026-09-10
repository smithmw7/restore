import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// A silent, isolated browser decodes the actual WAVs and runs real WebAudio
// clocks. No app objects or user headset state are changed by this harness.
const origin = process.env.RESTORE_TEST_URL || 'http://127.0.0.1:5209';
const assetSource = process.env.RESTORE_TEST_AUDIO_SOURCE || 'public';
const out = 'output/action-audio';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/action-audio-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Silent action audio check</title>' }));
  if (assetSource === 'public') await page.route('**/audio/**/*.wav', async route => {
    const body = await readFile(new URL(`../public${new URL(route.request().url()).pathname}`, import.meta.url));
    await route.fulfill({ contentType: 'audio/wav', body });
  });
  const audioSource = await readFile(new URL('../src/audio.js', import.meta.url), 'utf8');
  await page.route('**/action-audio-module.js', route => route.fulfill({ contentType: 'text/javascript', body: audioSource }));
  await page.goto(`${origin}/action-audio-harness`);
  const result = await page.evaluate(async () => {
    const NativeContext = window.AudioContext;
    let realContext;
    const panners = [], sampleStarts = [];
    window.AudioContext = class extends NativeContext {
      constructor(options) { super(options); realContext = this; }
      createPanner() { const panner = super.createPanner(); panners.push(panner); return panner; }
      createBufferSource() {
        const source = super.createBufferSource(), nativeStart = source.start;
        source.start = function (...args) {
          const data = this.buffer?.getChannelData(0);
          let energy = 0;
          for (const value of data || []) energy += value * value;
          sampleStarts.push({ loop: this.loop, duration: this.buffer?.duration, rms: Math.sqrt(energy / (data?.length || 1)) });
          return nativeStart.apply(this, args);
        };
        return source;
      }
    };
    const { createRestoreAudio } = await import('/action-audio-module.js');
    const audio = createRestoreAudio(), checkpoints = {}, p = { x: 0, y: 1, z: -1 };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const save = name => { checkpoints[name] = audio.getState(); };
    const update = args => audio.updateDrag({ position: p, speed: 1, ...args });
    try {
      await audio.load(); audio.unlock(); await wait(40); save('decoded');
      audio.playBreak('cube', p, true); save('timber1');
      audio.playBreak('cube', p, true); save('timber2');
      audio.playBreak('tablet', p, true); save('metalBreak');
      audio.playPickup('cube', p, true); save('pickup');
      audio.startDrag('cube', p, true, { kind: 'crate' });
      update({ kind: 'crate', speed: 3, surface: null, scrapeSpeed: 0 }); await wait(160); save('airborne');
      update({ surface: 'concrete', scrapeSpeed: .7 }); await wait(180); save('concrete');
      const loopPanner = panners.at(-1);
      audio.updateDrag({ position: { x: 3, y: 2, z: -5 }, speed: 1, surface: 'concrete', scrapeSpeed: .7 });
      checkpoints.spatialPosition = [loopPanner.positionX.value, loopPanner.positionY.value, loopPanner.positionZ.value];
      update({ surface: 'concrete', scrapeSpeed: 0, speed: 2 }); await wait(190); save('stationaryContact');
      update({ surface: null, scrapeSpeed: 2, speed: 2, load: 1 }); await wait(140); save('airborneWithStaleSpeed');
      update({ surface: 'concrete', scrapeSpeed: .7 }); await wait(160);
      save('beforeContactChatter');
      for (let i = 0; i < 4; i++) {
        update({ surface: 'wood', scrapeSpeed: .7 }); await wait(25);
        update({ surface: 'concrete', scrapeSpeed: .7 }); await wait(25);
      }
      save('contactChatter');
      update({ surface: 'wood', scrapeSpeed: .7 }); await wait(135);
      update({ surface: 'wood', scrapeSpeed: .7 }); save('woodCrossfade');
      await wait(180); save('wood');
      update({ surface: 'wood', scrapeSpeed: 0, speed: 0, load: .9 }); save('firstStrain');
      for (let i = 0; i < 4; i++) { await wait(400); update({ surface: 'wood', scrapeSpeed: 0, speed: 0, load: .9 }); }
      save('sustainedStrain');
      update({ surface: 'wood', scrapeSpeed: 0, speed: 0, load: 0 });
      update({ surface: 'wood', scrapeSpeed: 0, speed: 0, load: .9 }); save('newStrain');
      audio.playDrop('cube', p, true); save('drop'); await wait(140); save('dropCleanup');

      audio.startDrag('tablet', p, true, { kind: 'hanging-light' });
      update({ kind: 'hanging-light', speed: 0 }); await wait(140); save('lampStill');
      update({ kind: 'hanging-light', speed: .8 }); await wait(160); save('lampMoving');
      update({ kind: 'hanging-light', speed: 0 }); await wait(190); save('lampStillAgain');
      update({ kind: 'hanging-light', speed: .8 }); await wait(80);
      audio.stopDrag({ immediate: true }); save('lampReleased'); await wait(40); save('lampReleaseCleanup');
      audio.startDrag('gem', p, true); update({ speed: 1, strength: 1 }); await wait(180); save('artifactStone');
      audio.playComplete('gem', p, true); await wait(40); save('complete');

      audio.startDrag('cube', p, true, { kind: 'crate-piece' });
      update({ kind: 'crate-piece', surface: 'concrete', scrapeSpeed: 1 }); await wait(150);
      update({ surface: 'wood', scrapeSpeed: 1 }); await wait(135); update({ surface: 'wood', scrapeSpeed: 1 }); save('beforeMute');
      audio.setMuted(true); await wait(40); save('muted');
      audio.startDrag('tablet', p, true, { kind: 'hanging-light' });
      update({ kind: 'hanging-light', speed: 2 }); save('mutedAttempt');
      audio.setMuted(false);
      for (let i = 0; i < 30; i++) {
        audio.startDrag('cube', p, true, { kind: 'crate' });
        update({ kind: 'crate', surface: i % 2 ? 'wood' : 'concrete', scrapeSpeed: 1 });
        audio.playBreak('cube', p, true);
      }
      save('burst'); audio.playRestore(); await wait(40); save('reset');
      return { checkpoints, sampleStarts, contextSampleRate: realContext.sampleRate, contextState: realContext.state };
    } finally { audio.stopDrag({ immediate: true }); await realContext.close(); window.AudioContext = NativeContext; }
  });
  const c = result.checkpoints;
  assert.equal(c.decoded.loaded, 40); assert.equal(c.decoded.expected, 40);
  assert.equal(result.contextState, 'running');
  assert.match(c.timber1.lastClip, /actions\/timber-break-/);
  assert.match(c.timber2.lastClip, /actions\/timber-break-/);
  assert.notEqual(c.timber1.lastClip, c.timber2.lastClip);
  assert.match(c.metalBreak.lastClip, /breaks\/metal-heavy-/);
  assert.match(c.pickup.lastClip, /repair\/pickup-/);
  assert.equal(c.airborne.loopFamily, null); assert.equal(c.airborne.loopVoices, 0); assert.equal(c.airborne.loopTargetGain, 0);
  assert.equal(c.concrete.loopFamily, 'scrape-wood-concrete'); assert.equal(c.concrete.loopSurface, 'concrete');
  assert.ok(c.concrete.loopGain > .07 && c.concrete.loopGain <= .12);
  assert.deepEqual(c.spatialPosition, [3, 2, -5]);
  for (const state of [c.stationaryContact, c.airborneWithStaleSpeed]) { assert.equal(state.loopTargetGain, 0); assert.ok(state.loopGain < .001); }
  assert.equal(c.airborneWithStaleSpeed.eventCounts.strain || 0, 0, 'airborne wood produced a contact creak');
  assert.equal(c.contactChatter.eventCounts.dragStart, c.beforeContactChatter.eventCounts.dragStart);
  assert.equal(c.woodCrossfade.loopFamily, 'scrape-wood-wood'); assert.equal(c.woodCrossfade.loopVoices, 2);
  assert.equal(c.wood.loopSurface, 'wood'); assert.equal(c.wood.fadingLoops, 0);
  assert.ok(c.wood.loopGain > .07 && c.wood.loopGain <= .12);
  assert.equal(c.firstStrain.eventCounts.strain, 1); assert.equal(c.sustainedStrain.eventCounts.strain, 1); assert.equal(c.newStrain.eventCounts.strain, 2);
  assert.match(c.firstStrain.lastEvents.findLast(event => event.type === 'strain')?.clip || '', /actions\/wood-creak-/);
  assert.match(c.drop.lastClip, /repair\/drop-/); assert.equal(c.dropCleanup.loopVoices, 0);
  assert.equal(c.lampStill.loopFamily, 'metal-creak'); assert.equal(c.lampStill.loopGain, 0);
  assert.equal(c.lampMoving.loopFamily, 'metal-creak'); assert.ok(c.lampMoving.loopGain > .14 && c.lampMoving.loopGain <= .22);
  assert.ok(c.lampStillAgain.loopGain < .001); assert.equal(c.lampStillAgain.loopTargetGain, 0);
  assert.equal(c.lampReleased.loopActive, false); assert.equal(c.lampReleaseCleanup.loopVoices, 0);
  assert.equal(c.lampReleaseCleanup.eventCounts.drop, c.drop.eventCounts.drop);
  assert.equal(c.artifactStone.loopFamily, 'stone-drag'); assert.match(c.artifactStone.lastClip, /repair\/drag-/);
  assert.ok(c.artifactStone.loopGain > .09 && c.artifactStone.loopGain <= .12);
  for (const name of ['complete', 'muted', 'mutedAttempt', 'reset']) {
    assert.equal(c[name].loopActive, false, `${name} left an active drag session`);
    assert.equal(c[name].loopVoices, 0, `${name} leaked a loop source`);
  }
  assert.equal(c.beforeMute.loopVoices, 2);
  assert.ok(c.burst.activeVoices <= 12); assert.ok(c.burst.loopVoices <= 2);
  for (const checkpoint of Object.values(c)) if (!Array.isArray(checkpoint)) {
    assert.ok(checkpoint.activeVoices <= 12); assert.ok(checkpoint.loopVoices <= checkpoint.maxLoopVoices);
    assert.ok(checkpoint.loopGain <= checkpoint.loopMaxGain + .0001);
  }
  assert.ok(result.sampleStarts.length > 20);
  assert.ok(result.sampleStarts.every(sample => sample.duration > .01 && sample.rms > .0001));
  assert.deepEqual(errors, []);
  const checks = ['40 real WAVs decode and timber breaks alternate, with original nonwood breaks/pickups/drops intact',
    'wood texture requires actual sliding contact, follows spatial position, and fades when still or airborne',
    'contact chatter is debounced and stable wood/concrete changes crossfade within a two-loop budget',
    'wood strain uses hysteresis and cooldown; lamp metal creaks require actual held motion',
    'artifact stone loops stay quiet and completion/release/mute/reset clean up every loop',
    'rapid action bursts stay within 12 one-shot voices and two loops with no browser errors'];
  const report = { passed: true, checks, errors, assetSource, url: origin,
    scope: 'Silent real-WebAudio decoding and routing verification, not a listening judgment or physical headset test.', ...result };
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks, decoded: c.decoded.loaded, sampleRate: result.contextSampleRate, errors }, null, 2));
} finally { await browser.close(); }
