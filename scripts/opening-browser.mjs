import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = 'output/opening';
const url = process.env.RESTORE_URL || 'http://127.0.0.1:5211/';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const read = () => page.evaluate(() => window.__restoreDiagnostics());
const pause = milliseconds => page.waitForTimeout(milliseconds);
async function view(position, target) {
  // This development helper goes through normal locomotion clearance. Puzzle
  // state changes below use actual pointer input, never progression dispatch.
  assert.equal(await page.evaluate(({ position, target }) => window.__restoreOpening.view(position, target), { position, target }), true, `navigation position blocked: ${position}`);
  await pause(250);
}
async function tap(id) {
  const item = (await read()).state.objects.find(object => object.id === id);
  assert.ok(item, `target ${id} is available`);
  assert.ok(item.screen.x > 0 && item.screen.x < 1440 && item.screen.y > 0 && item.screen.y < 1000, `target ${id} is on screen: ${JSON.stringify(item.screen)}`);
  await page.mouse.click(item.screen.x, item.screen.y, { delay: 30 });
  await pause(150);
}
function check(label) { checks.push(label); console.log(`PASS: ${label}`); }

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  assert.ok(await page.evaluate(() => !!window.__restoreOpening), 'opening QA uses a development server');
  const initial = await read();
  assert.equal(initial.state.opening.noteSeen, false);
  assert.equal(initial.state.opening.caseUnlocked, false);
  assert.deepEqual(initial.state.opening.gloves, { left: false, right: false });
  await page.screenshot({ path: `${out}/01-office-arrival.png` });

  await view([6.7, 0, 9.65], [6.75, 1, 8.3]);
  await tap('case-latch');
  assert.equal((await read()).state.opening.caseUnlocked, false);
  check('briefcase remains locked before the actual wheel combination');
  await tap('drawer');
  assert.equal((await read()).state.opening.drawerOpen, true);
  await pause(650);
  await tap('notebook');
  await pause(650);
  assert.equal((await read()).state.opening.noteSeen, true);
  assert.equal((await read()).state.opening.notebookOpen, true);
  await page.screenshot({ path: `${out}/02-notebook-combination.png` });
  check('drawer and notebook open through pointer taps and reveal the combination');

  await view([6.15, 0, 9.55], [6.15, 1.05, 8.45]);
  for (const [index, count] of [4, 1, 7, 2].entries()) {
    for (let tick = 0; tick < count; tick++) await tap(`wheel-${index}`);
    assert.equal((await read()).state.opening.wheels[index], count, `wheel ${index} advanced once per tap`);
  }
  await page.screenshot({ path: `${out}/03-combination-set.png` });
  await tap('case-latch');
  await pause(700);
  const unlocked = (await read()).state.opening;
  assert.equal(unlocked.caseUnlocked, true);
  assert.equal(unlocked.caseOpen, true);
  assert.equal(unlocked.gloves.left || unlocked.gloves.right, false);
  await page.screenshot({ path: `${out}/04-photographs-unlocked.png` });
  check('4172 opens the briefcase before any glove is equipped');
  for (const id of ['photo-2', 'photo-1', 'photo-0']) await tap(id);
  assert.equal((await read()).state.opening.photosViewed.length, 3);
  check('three grainy photograph clues can be inspected');

  await view([10.6, 0, 12.25], [10.6, 1.22, 10.95]);
  await tap('locker');
  await pause(800);
  assert.equal((await read()).state.opening.lockerOpen, true);
  await page.screenshot({ path: `${out}/05-gauntlet-locker.png` });
  await tap('glove-right');
  assert.equal((await read()).state.opening.gloves.right, true);
  await tap('glove-left');
  assert.equal((await read()).state.opening.gloves.left, true);
  check('locker opens and either glove can equip from its physical shelf');

  await view([-6.7, 0, 9.1], [-6.7, 1.13, 10.5]);
  await tap('cutters');
  await pause(800);
  assert.equal((await read()).state.opening.cuttersFound, true);
  assert.equal((await read()).state.opening.equippedCutters, 'pointer');
  await page.screenshot({ path: `${out}/06-cutters-equipped.png` });
  check('bolt cutters equip through their actual pickup target');

  await view([-7, 0, 6.65], [-7, 1.3, 5.9]);
  await pause(1000);
  await tap('container-fastener');
  assert.equal((await read()).state.opening.containerCut, true);
  await pause(450);
  await tap('container-door-1');
  await pause(1100);
  assert.equal((await read()).state.opening.containerOpen, true);
  await page.screenshot({ path: `${out}/07-container-open.png` });
  check('carried cutters cut the keeper and the shipping container opens');

  assert.ok((await read()).state.opening.containerLightIntensity>25,'open container has a readable warm practical');
  assert.equal((await read()).state.mechanism.revealed,true);
  await view([-7,0,6.45],[-7.45,.5,4.4]);
  const pixels=await page.evaluate(()=>{
    const {assembly,camera}=window.__restoreOpening;
    const mesh=assembly.targets.find(m=>m.name==='frame-0-0');mesh.updateWorldMatrix(true,false);
    const positions=mesh.geometry.attributes.position,index=mesh.geometry.index,points=[];
    for(let i=0;i<(index?index.count:positions.count);i+=21){
      const p=mesh.position.clone().set(0,0,0);
      for(let j=0;j<3;j++)p.add(mesh.position.clone().fromBufferAttribute(positions,index?index.getX(i+j):i+j));
      p.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld).project(camera);
      const x=(p.x*.5+.5)*innerWidth,y=(-p.y*.5+.5)*innerHeight;
      if(x>50&&x<innerWidth-50&&y>50&&y<innerHeight-50)points.push({x,y});
    }return points;
  });
  let grabbed=false;
  for(const pixel of pixels){
    await page.mouse.move(pixel.x,pixel.y);await page.mouse.down();await pause(60);
    const current=await read();
    if(current.state.grab.objectId==='mechanism-frame-0-0'){grabbed=true;break;}
    await page.mouse.up();
  }
  assert.ok(grabbed,'a real pointer selects a visible frame surface');
  await page.mouse.move(720,350,{steps:12});await pause(600);
  assert.equal((await read()).state.grab.objectId,'mechanism-frame-0-0');
  await page.screenshot({path:`${out}/08-frame-held.png`});
  const dropsBefore=(await read()).audio.eventCounts.drop||0;
  await page.mouse.up();await pause(500);
  const released=await read();assert.equal(released.state.grab.active,false);
  assert.equal(released.audio.loopActive,false);assert.equal(released.audio.eventCounts.drop,dropsBefore+1);
  check('a revealed frame can be physically lifted and dropped, with pickup/drag/drop audio and released ownership');

  const beforeReload = (await read()).state.opening;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__restoreDiagnostics?.().state.ready, null, { timeout: 90000 });
  const restored = (await read()).state.opening;
  for (const field of ['noteSeen', 'caseUnlocked', 'caseOpen', 'cuttersFound', 'containerCut', 'containerOpen']) assert.equal(restored[field], beforeReload[field], `${field} persists across reload`);
  assert.deepEqual(restored.gloves, beforeReload.gloves);
  assert.deepEqual(restored.photosViewed, beforeReload.photosViewed);
  assert.deepEqual(restored.wheels, [4, 1, 7, 2]);
  check('equipment, knowledge, photographs and unlocked container survive reload');
  assert.deepEqual(errors, []);
  check('no browser or console errors');
  await writeFile(`${out}/browser-report.json`, JSON.stringify({ url, checks, errors, state: restored }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  const diagnostics = await read().catch(() => null);
  await writeFile(`${out}/browser-failure.json`, JSON.stringify({ error: error.stack, checks, errors, diagnostics }, null, 2));
  throw error;
} finally {
  await browser.close();
}
