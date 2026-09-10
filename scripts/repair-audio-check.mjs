import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

// Dedicated silent context exercises real Chromium WebAudio clocks and WAV decodes.
// It does not click the app or play through the user's speakers or headset.
const origin = process.env.RESTORE_TEST_URL || 'http://127.0.0.1:5209';
const assetSource = process.env.RESTORE_TEST_AUDIO_SOURCE || 'public';
const browser = await chromium.launch({ headless: true, channel:'chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.route('**/repair-audio-harness', route => route.fulfill({contentType:'text/html', body:'<!doctype html><title>Silent repair audio check</title>'}));
  if (assetSource === 'public') await page.route('**/audio/**/*.wav', async route => {
    const body = await readFile(new URL(`../public${new URL(route.request().url()).pathname}`, import.meta.url));
    await route.fulfill({ contentType:'audio/wav', body });
  });
  const audioSource = await readFile(new URL('../src/audio.js', import.meta.url), 'utf8');
  await page.route('**/repair-audio-module.js', route => route.fulfill({contentType:'text/javascript',body:audioSource}));
  await page.goto(`${origin}/repair-audio-harness`);
  const result = await page.evaluate(async () => {
    const NativeContext = window.AudioContext;
    let realContext;
    window.AudioContext = class extends NativeContext { constructor(options) { super(options); realContext = this; } };
    const { createRestoreAudio } = await import('/repair-audio-module.js');
    const audio = createRestoreAudio();
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const checkpoints = {}, p = {x:0,y:1,z:-1};
    try {
      await audio.load(); audio.unlock(); await wait(50);
      checkpoints.decoded = audio.getState();
      audio.playPickup('cube',p,true); checkpoints.pickup = audio.getState();
      audio.startDrag('cube',p,true); audio.updateDrag({position:p,speed:0}); await wait(170);
      checkpoints.stationary = audio.getState();
      audio.updateDrag({position:p,speed:1,strength:1}); await wait(160);
      checkpoints.moving = audio.getState();
      audio.updateDrag({position:p,speed:0}); await wait(190);
      checkpoints.idleFade = audio.getState();
      audio.updateDrag({position:p,speed:1,strength:1}); await wait(160);
      audio.playComplete('cube',p,true); checkpoints.complete = audio.getState(); await wait(45);
      checkpoints.completedStop = audio.getState();
      await wait(320);
      for (const id of ['vase','cube','orb','gem','bottle','tablet']) {
        audio.playCollision(id,p,.8,true); await wait(110);
        audio.playSnap(id,p,.8,true); await wait(110);
      }
      checkpoints.contacts = audio.getState();
      audio.playNudge('cube',p,.8,true); await wait(110);
      audio.playNudge('cube',p,.05,true); await wait(110);
      audio.playNudge('orb',p,.005,true); await wait(110);
      checkpoints.nudges = audio.getState();
      audio.startDrag('orb',p,true); audio.updateDrag({position:p,speed:1}); await wait(160);
      audio.playDrop('orb',p,true); checkpoints.drop = audio.getState(); await wait(140);
      checkpoints.droppedStop = audio.getState();
      audio.startDrag('gem',p,true); audio.updateDrag({position:p,speed:1}); await wait(60);
      audio.setMuted(true); await wait(45); checkpoints.muted = audio.getState();
      audio.setMuted(false); audio.playDock('gem',p,true); checkpoints.dock = audio.getState();
      for (let i=0;i<40;i++) audio.playBreak('gem',p,true);
      checkpoints.burst = audio.getState();
      audio.startDrag('gem',p,true); audio.playRestore(); await wait(45);
      checkpoints.reset = audio.getState();
      return { checkpoints, contextSampleRate: realContext.sampleRate, contextState:realContext.state };
    } finally { audio.stopDrag({immediate:true}); await realContext.close(); window.AudioContext = NativeContext; }
  });
  const c = result.checkpoints;
  assert.equal(c.decoded.loaded, 40); assert.equal(c.decoded.expected,40);
  assert.equal(result.contextState,'running');
  assert.match(c.pickup.lastClip,/repair\/pickup-/);
  assert.equal(c.stationary.loopGain,0); assert.equal(c.stationary.loopTargetGain,0);
  assert.ok(c.moving.loopGain>.09 && c.moving.loopGain<=.12);
  assert.ok(c.idleFade.loopGain<.001);
  assert.equal(c.complete.loopActive,false); assert.equal(c.completedStop.fadingLoops,0);
  assert.equal(c.contacts.eventCounts.collision,6); assert.equal(c.contacts.eventCounts.snap,6);
  for (const family of ['concrete','wood','metal-light','rock','glass','metal-heavy']) {
    assert.ok(c.contacts.lastEvents.some(event => event.type==='collision' && event.clip.includes(`hit-${family}-`)));
    assert.ok(c.contacts.lastEvents.some(event => event.type==='snap' && event.clip.includes(`hit-${family}-`)));
  }
  const nudges=c.nudges.lastEvents.filter(event=>event.type==='nudge');
  assert.equal(c.nudges.eventCounts.nudge,3);
  assert.match(nudges[0].clip,/hit-wood-/); assert.match(nudges[2].clip,/hit-metal-light-/);
  assert.ok(nudges[1].gain<nudges[0].gain*.3 && nudges[2].gain<nudges[1].gain*.4,'distant nudges should become much quieter');
  assert.equal(c.nudges.eventCounts.break,c.contacts.eventCounts.break);
  assert.equal(c.nudges.eventCounts.pickup,c.contacts.eventCounts.pickup);
  assert.equal(c.nudges.eventCounts.drop,c.contacts.eventCounts.drop);
  assert.match(c.drop.lastClip,/repair\/drop-/); assert.equal(c.droppedStop.fadingLoops,0);
  assert.equal(c.muted.muted,true); assert.equal(c.muted.loopActive,false); assert.equal(c.muted.fadingLoops,0);
  assert.equal(c.dock.eventCounts.dock,1); assert.ok(c.burst.activeVoices<=12);
  assert.equal(c.reset.loopActive,false); assert.equal(c.reset.fadingLoops,0);
  const report = { passed:true, checkedAt:new Date().toISOString(), url:origin, assetSource, browser:'Headless Chromium, --mute-audio', scope:'Real WebAudio asset decoding, material event mapping, continuous gain fades, release/completion/reset/mute cleanup and polyphony. Silent functional verification; not a listening judgment or physical headset check.', ...result };
  await writeFile(new URL('../docs/repair-audio-browser-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true, decoded:c.decoded.loaded, sampleRate:result.contextSampleRate, idleGain:c.stationary.loopGain, movingGain:c.moving.loopGain, fadedIdleGain:c.idleFade.loopGain, completeFadingLoops:c.completedStop.fadingLoops, collisions:c.contacts.eventCounts.collision, snaps:c.contacts.eventCounts.snap, dropFadingLoops:c.droppedStop.fadingLoops, muteFadingLoops:c.muted.fadingLoops, maxBurstVoices:c.burst.activeVoices, resetFadingLoops:c.reset.fadingLoops},null,2));
} finally { await browser.close(); }
