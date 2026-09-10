import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const out='output/warehouse';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--mute-audio']});
const errors=[];
const checks=[];
let page;
try {
  page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(process.env.RESTORE_URL||'http://127.0.0.1:5209/',{waitUntil:'domcontentloaded'});
  console.log('page loaded');
  await page.waitForFunction(()=>window.__restoreDiagnostics?.().state.ready);
  const read=()=>page.evaluate(()=>window.__restoreDiagnostics());
  console.log('warehouse ready');
  const start=await read();
  assert.equal(start.state.closedCrates,176);
  assert.equal(await page.locator('body').innerText(),'');
  checks.push('warehouse contains 176 breakable crates and no visible text');
  await page.screenshot({path:`${out}/browser-start.png`});

  const crate=start.state.objects.find(object=>object.id==='crate-02');
  // Reproduce a still-handed release after the old 18-second cleanup timeout.
  await page.evaluate(()=>window.advanceTime(20000));
  await page.mouse.move(crate.screen.x,crate.screen.y);
  await page.mouse.down();
  await page.waitForFunction(()=>window.__restoreDiagnostics().state.grab.objectId==='crate-02');
  await page.mouse.move(720,180,{steps:18});
  const holdDistance=data=>Math.hypot(...data.input.desktopGrab.point.map((value,index)=>value-data.input.camera.position[index]));
  const pickedUp=await read(),initialDistance=holdDistance(pickedUp);
  await page.evaluate(()=>window.advanceTime(3500));
  const reeled=await read();
  assert.ok(holdDistance(reeled)<initialDistance-.25,'a stationary hold gradually pulls the box toward the player');
  const beforeScroll=holdDistance(reeled);
  await page.mouse.wheel(0,150);
  const scrolled=await read();
  assert.ok(holdDistance(scrolled)>beforeScroll+.08,'manual depth still pushes a held object outward');
  await page.evaluate(()=>window.advanceTime(200));
  assert.ok(Math.abs(holdDistance(await read())-holdDistance(scrolled))<.025,'automatic pull pauses after manual depth input');
  await page.evaluate(()=>window.advanceTime(18000));
  const heldCrate=await read();
  const releaseY=heldCrate.state.objects.find(object=>object.id==='crate-02').position[1];
  assert.ok(releaseY>1.7,'crate was lifted above the floor');
  assert.ok(heldCrate.state.grab.speed<0.01,'automatic pull settles before the stationary release');
  const settledDistance=holdDistance(heldCrate);
  await page.mouse.move(722,180,{steps:2});
  assert.ok(Math.abs(holdDistance(await read())-settledDistance)<.03,'pointer movement keeps the reeled-in depth');
  checks.push('stationary holds reel objects in, settle gently, preserve manual depth and keep the updated drag plane');
  const crateDropCount=heldCrate.audio.eventCounts.drop||0;
  await page.screenshot({path:`${out}/browser-crate-held.png`});
  await page.mouse.up();
  await page.evaluate(()=>window.advanceTime(400));
  const droppedCrate=await read();
  assert.equal(droppedCrate.state.grab.active,false);
  assert.ok(droppedCrate.state.objects.find(object=>object.id==='crate-02').position[1]<releaseY-.4,'released crate falls under gravity');
  assert.equal(droppedCrate.audio.eventCounts.drop,crateDropCount+1);
  assert.equal(droppedCrate.audio.loopActive,false);
  await page.evaluate(()=>window.advanceTime(3000));
  await page.screenshot({path:`${out}/browser-crate-landed.png`});
  checks.push('an aged crate falls after a stationary pointer release, plays one drop, and stops dragging audio');
  await page.locator('#restore').click();

  // Breaking now requires proximity. Walk into reach and aim at the newly
  // projected crate instead of expecting a distant tap to open it from spawn.
  await page.keyboard.down('KeyW');
  await page.evaluate(()=>window.advanceTime(450));
  await page.keyboard.up('KeyW');
  const closeCrate=(await read()).state.objects.find(object=>object.id==='crate-02');
  await page.mouse.click(closeCrate.screen.x,closeCrate.screen.y);
  await page.waitForFunction(()=>window.__restoreDiagnostics().state.openedCrates===1);
  let current=await read();
  assert.ok(current.state.objects.some(object=>object.id==='artifact-02'));
  assert.equal(current.audio.eventCounts.break,1);
  assert.match(current.audio.lastEvents.findLast(event=>event.type==='break').clip,/breaks\/wood-/);
  checks.push('a short pointer tap breaks a crate, plays wood, and reveals its artifact');
  // Step back for a clear view of the newly dropped contents; distance does
  // not prevent the existing hold-to-grab interaction.
  await page.keyboard.down('KeyS');
  await page.evaluate(()=>window.advanceTime(450));
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(950);
  await page.screenshot({path:`${out}/browser-open.png`});

  // A ray may first touch an opened crate board in front of its contents. Move
  // an obstructing board aside using the actual grab UI before trying again.
  let artifactGrabbed=false;
  for(let attempt=0;attempt<5&&!artifactGrabbed;attempt++){
    current=await read();
    const target=current.state.objects.find(object=>object.id==='artifact-02');
    assert.ok(target&&target.screen.y<880,'artifact left the visible play area');
    await page.mouse.move(target.screen.x,target.screen.y);
    await page.mouse.down();
    await page.waitForFunction(()=>window.__restoreDiagnostics().state.grab.active,{timeout:4000});
    current=await read();
    artifactGrabbed=current.state.grab.objectId==='artifact-02';
    await page.mouse.move(artifactGrabbed?680:1100,artifactGrabbed?450:350,{steps:18});
    await page.waitForTimeout(850);
    if(!artifactGrabbed)await page.mouse.up();
  }
  assert.equal(artifactGrabbed,true,'could not pick up the artifact after clearing nearby boards');
  // Keep the eventual floor position in view after automatic pull has brought
  // the artifact closer. Each wheel event uses the normal bounded depth input.
  for(let step=0;step<20;step++){
    current=await read();
    if(holdDistance(current)>=4.8)break;
    await page.mouse.wheel(0,150);
  }
  current=await read();
  // Place the artifact over the clear aisle using the current grab plane.
  // A fixed screen point can leave its eventual landing hidden behind boards.
  const plane=current.input.desktopGrab;
  const camera=new THREE.PerspectiveCamera(current.input.camera.fov,current.input.camera.aspect,.05,220);
  camera.position.fromArray(current.input.camera.position);
  camera.quaternion.fromArray(current.input.camera.quaternion);
  camera.updateMatrixWorld(true);
  const liftPoint=new THREE.Vector3(0,2.4,-(plane.normal[1]*2.4+plane.constant)/plane.normal[2]);
  const liftScreen=liftPoint.clone().project(camera);
  const liftX=(liftScreen.x*.5+.5)*1440,liftY=(-liftScreen.y*.5+.5)*900;
  assert.ok(liftX>65&&liftX<1375&&liftY>65&&liftY<810,'clear aisle lift target is outside the view');
  await page.mouse.move(liftX,liftY,{steps:18});
  await page.evaluate(()=>window.advanceTime(1200));
  current=await read();
  assert.ok(Math.abs(current.state.objects.find(object=>object.id==='artifact-02').position[0])<.65,'artifact was not moved above the clear aisle');
  assert.equal(current.state.grab.whole,true);
  assert.equal(current.state.grab.complete,true);
  assert.ok(current.state.objects.find(object=>object.id==='artifact-02').position[1]>.8);
  assert.ok(current.audio.eventCounts.pickup>=1);
  assert.equal(current.audio.loopActive,true);
  await page.screenshot({path:`${out}/browser-artifact-held.png`});
  const dropCount=current.audio.eventCounts.drop||0;
  await page.mouse.up();
  await page.waitForFunction(count=>window.__restoreDiagnostics().audio.eventCounts.drop===count,dropCount+1);
  await page.waitForTimeout(200);
  current=await read();
  assert.equal(current.state.grab.active,false);
  assert.equal(current.audio.loopActive,false);
  assert.match(current.audio.lastEvents.findLast(event=>event.type==='drop').clip,/repair\/drop-/);
  checks.push('holding the artifact picks it up, real pointer movement lifts it, release plays one drop and stops its dragging loop');

  // Aim after landing, rather than chasing a falling centroid with coordinates
  // sampled before the next display frame. Small offsets cover a tapered face.
  await page.evaluate(()=>window.advanceTime(2200));
  current=await read();
  const landed=current.state.objects.find(object=>object.id==='artifact-02');
  const approachMs=Math.max(0,current.input.camera.position[2]-landed.position[2]-1.45)/2.2*1000;
  await page.keyboard.down('KeyW');
  await page.evaluate(ms=>window.advanceTime(ms),approachMs);
  await page.keyboard.up('KeyW');
  await page.mouse.move(720,550);await page.mouse.down({button:'right'});
  await page.mouse.move(720,700,{steps:12});await page.mouse.up({button:'right'});
  await page.screenshot({path:`${out}/browser-artifact-settled.png`});
  let artifactBroken=false;
  for(const [dx,dy] of [[0,0],[5,0],[-5,0],[0,-5],[0,5],[9,0],[-9,0],[0,-9],[0,9]]){
    current=await read();
    const target=current.state.objects.find(object=>object.id==='artifact-02');
    assert.ok(target&&target.screen.x>65&&target.screen.x<1375&&target.screen.y>65&&target.screen.y<810,'settled artifact left the visible play area');
    await page.mouse.click(target.screen.x+dx,target.screen.y+dy);
    current=await read();
    artifactBroken=current.state.objectStates.find(object=>object.id==='artifact-02').state==='broken';
    if(artifactBroken)break;
  }
  assert.ok(artifactBroken,'a real pointer tap could not strike the settled artifact');
  assert.equal(current.state.broken,1);
  current=await read();
  assert.match(current.audio.lastEvents.findLast(event=>event.type==='break').clip,/breaks\/rock-/);
  assert.ok(current.state.pieces.some(piece=>piece.id==='artifact-02'&&piece.kind==='fragment'));
  checks.push('a moved whole artifact breaks into magnetic fragments with sounds matching its marble material');
  // Let fragments settle, then target a currently visible shard. A tapered
  // obelisk has tiny chips whose moving centroids can miss a single fixed click.
  await page.waitForTimeout(1600);
  let shard=null;
  for(let attempt=0;attempt<18;attempt++) {
    current=await read();
    const candidates=current.state.pieces.filter(piece=>piece.id==='artifact-02'&&piece.kind==='fragment'&&piece.screen.x>100&&piece.screen.x<1300&&piece.screen.y>100&&piece.screen.y<820)
      .sort((a,b)=>a.screen.y-b.screen.y);
    assert.ok(candidates.length,'no visible artifact shard to grab');
    const candidate=candidates[attempt%candidates.length];
    await page.mouse.move(candidate.screen.x,candidate.screen.y);await page.mouse.down();
    current=await read();
    if(current.state.grab.active&&current.state.grab.objectId==='artifact-02'){shard=candidate;break;}
    await page.mouse.move(candidate.screen.x+10,candidate.screen.y);await page.mouse.up();
  }
  assert.ok(shard,'a visible artifact fragment can be selected through the pointer');
  assert.equal(current.state.grab.active,true);
  assert.equal(current.state.grab.objectId,'artifact-02');
  await page.mouse.move(shard.screen.x+70,shard.screen.y-90,{steps:12});await page.waitForTimeout(400);
  await page.screenshot({path:`${out}/browser-shard-held.png`});
  await page.mouse.up();
  checks.push('a real pointer selects and moves a broken artifact shard immediately');
  await page.locator('#restore').click();
  current=await read();
  assert.equal(current.state.closedCrates,176);
  assert.equal(current.state.broken,0);
  assert.equal(current.state.grab.active,false);
  assert.equal(await page.locator('body').innerText(),'');
  assert.deepEqual(errors,[]);
  checks.push('reset restores the complete collection without adding text or console errors');
  await writeFile(`${out}/browser-results.json`,JSON.stringify({passed:true,checks,errors,state:current.state,audio:current.audio},null,2));
  console.log(JSON.stringify({passed:true,checks,errors},null,2));
}catch(error){
  await writeFile(`${out}/browser-failure.json`,JSON.stringify({message:error.message,checks,errors,diagnostics:await page?.evaluate(()=>window.__restoreDiagnostics?.()).catch(()=>null)},null,2));
  await page?.screenshot({path:`${out}/browser-failure.png`}).catch(()=>{});
  throw error;
}finally{await browser.close();}
