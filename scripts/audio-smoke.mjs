import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], played = [];
await mkdir('output/audio', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Observe actual decoded PCM buffers reaching AudioBufferSourceNode.start().
  await page.addInitScript(() => {
    window.__sampleStarts = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      const samples = this.buffer?.getChannelData(0);
      let energy = 0;
      for (const sample of samples || []) energy += sample * sample;
      window.__sampleStarts.push({ duration: this.buffer?.duration, rms: Math.sqrt(energy / (samples?.length || 1)), sampleRate: this.buffer?.sampleRate });
      return original.apply(this, args);
    };
  });
  await page.goto(process.env.RESTORE_URL || 'http://127.0.0.1:5207');
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready);
  assert.equal(await page.evaluate(() => window.__restoreDiagnostics().audio.loaded), 30);
  const families = { vase: 'concrete', cube: 'wood', orb: 'metal-light', gem: 'rock', bottle: 'glass', column: 'concrete', ring: 'metal-light', tablet: 'metal-heavy' };
  for (const [id, family] of Object.entries(families)) {
    const target = await page.evaluate(id => JSON.parse(window.render_game_to_text()).objects.find(object => object.id === id), id);
    await page.mouse.click(target.screen.x, target.screen.y - (id === 'ring' ? 20 : 0));
    await page.waitForFunction(count => window.__restoreDiagnostics().audio.eventCounts.break === count, played.length + 1);
    const state = await page.evaluate(() => window.__restoreDiagnostics().audio);
    const breakClip=state.lastEvents.findLast(event=>event.type==='break').clip;
    assert.match(breakClip, new RegExp(`/audio/breaks/${family}-0[12]\\.wav$`));
    played.push({ id, clip: breakClip });
  }
  await page.waitForFunction(() => window.__restoreDiagnostics().audio.contextState === 'running');
  await page.screenshot({ path: 'output/audio/broken.png' });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).intact === 8);
  await page.locator('#sound').click();
  assert.equal(await page.evaluate(() => window.__restoreDiagnostics().audio.muted), true);
  const target = await page.evaluate(() => JSON.parse(window.render_game_to_text()).objects.find(object => object.id === 'bottle'));
  await page.mouse.click(target.screen.x, target.screen.y);
  assert.equal(await page.evaluate(() => window.__restoreDiagnostics().audio.eventCounts.break), 8);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).intact === 8);
  await page.locator('#sound').click();
  await page.mouse.click(target.screen.x, target.screen.y);
  await page.waitForFunction(() => window.__restoreDiagnostics().audio.eventCounts.break === 9);
  const nextGlass = await page.evaluate(() => window.__restoreDiagnostics().audio.lastEvents.findLast(event=>event.type==='break').clip);
  assert.notEqual(nextGlass, played.find(item => item.id === 'bottle').clip, 'Glass variation should change');
  await page.waitForFunction(() => window.__restoreDiagnostics().audio.activeVoices === 0, undefined, { timeout: 5000 });
  const starts = await page.evaluate(() => window.__sampleStarts);
  assert(starts.length >= 9);
  assert(starts.every(start => start.duration > 0.01 && start.rms > 0.0001));
  assert.deepEqual(errors, []);
  const result = { passed: true, loaded: 30, materialRouting: played, mute: 'passed', alternateVariation: 'passed', decodedSamplesStarted: starts.length, errors };
  await writeFile('output/audio/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
