import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { mkdir, writeFile } from 'node:fs/promises';

const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];
await mkdir('output/repair',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const diag=()=>page.evaluate(()=>window.__restoreDiagnostics());
  await page.goto(process.env.RESTORE_URL||'http://127.0.0.1:5207');
  await page.waitForFunction(()=>window.__restoreDiagnostics?.().state.ready);
  const start=await diag();assert.equal(start.audio.loaded,30);
  const cube=start.state.objects.find(x=>x.id==='cube');
  await page.mouse.click(cube.screen.x,cube.screen.y);
  await page.waitForTimeout(3200);
  const broken=await diag();
  const available=broken.state.pieces.filter(x=>x.id==='cube'&&x.screen.x>450&&x.screen.x<1150&&x.screen.y>120&&x.screen.y<610).sort((a,b)=>b.screen.x-a.screen.x);
  assert(available.length,'Must have reachable cube shards');
  // Use actual pointer targeting. Some shard centers are hidden by nearer shards.
  let picked=false;
  for(const piece of available) {
    await page.mouse.move(piece.screen.x,piece.screen.y);await page.mouse.down();
    if((await diag()).state.grab.active){picked=true;break;}
    await page.mouse.move(piece.screen.x+12,piece.screen.y);await page.mouse.up();
  }
  if(!picked){await page.screenshot({path:'output/repair/grab-failure.png'});console.log(JSON.stringify({available,diagnostics:await diag(),errors},null,2));}
  assert(picked,'Pointer down grabs a visible broken piece');
  const pickedState=await diag();
  assert.equal(pickedState.audio.eventCounts.pickup,1);
  assert.equal(pickedState.audio.loopActive,true);
  assert.equal(pickedState.state.grab.objectId,'cube');
  const camera=new THREE.PerspectiveCamera(start.input.camera.fov,start.input.camera.aspect,.05,50);
  camera.position.fromArray(start.input.camera.position);camera.quaternion.fromArray(start.input.camera.quaternion);camera.updateMatrixWorld();
  async function moveAnchorTo(target) {
    let d=await diag();
    const input=d.input.desktopGrab;
    assert(input,'Still held by real pointer');
    const offset=new THREE.Vector3().fromArray(d.state.grab.goal).sub(new THREE.Vector3().fromArray(input.point));
    const point=new THREE.Vector3().fromArray(target).sub(offset);
    const normal=new THREE.Vector3().fromArray(input.normal);
    let depth=normal.dot(point.clone().sub(new THREE.Vector3().fromArray(input.point)));
    while(Math.abs(depth)>.001) {
      const step=Math.max(-.15,Math.min(.15,depth));
      await page.mouse.wheel(0,step/.0015);await page.waitForTimeout(20);depth-=step;
    }
    const projected=point.clone().project(camera),x=(projected.x*.5+.5)*1280,y=(-projected.y*.5+.5)*720;
    assert(x>0&&x<1280&&y>0&&y<720,`Target stays in viewport (${x},${y})`);
    await page.mouse.move(x,y,{steps:5});
  }
  let d=await diag();
  const firstAnchor=d.state.grab.anchor;
  await moveAnchorTo([firstAnchor[0]+.4,firstAnchor[1]+.25,firstAnchor[2]]);
  await page.waitForTimeout(160);
  d=await diag();assert(d.audio.loopTargetGain<=.12);assert(d.audio.loopTargetGain>0);
  await page.screenshot({path:'output/repair/holding.png'});
  await page.mouse.up();await page.waitForTimeout(160);
  d=await diag();assert.equal(d.state.grab.active,false);assert.equal(d.audio.loopActive,false);assert.equal(d.audio.fadingLoops,0);assert.equal(d.audio.eventCounts.drop,1);
  // Regrab a shard, then sweep its magnetic field through the remaining pieces.
  for(const piece of d.state.pieces.filter(x=>x.id==='cube')) {
    await page.mouse.move(piece.screen.x,piece.screen.y);await page.mouse.down();
    if((await diag()).state.grab.active)break;
    await page.mouse.move(piece.screen.x+12,piece.screen.y);await page.mouse.up();
  }
  assert((await diag()).state.grab.active);
  for(let pass=0;pass<35;pass++) {
    d=await diag();if(d.state.grab.complete)break;
    const anchor=new THREE.Vector3().fromArray(d.state.grab.anchor);
    const candidates=d.state.pieces.filter(x=>x.id==='cube').map(x=>({...x,distance:anchor.distanceTo(new THREE.Vector3().fromArray(x.position))})).sort((a,b)=>b.distance-a.distance);
    if(candidates[0].distance>.7) {
      const point=[...candidates[0].position];point[1]=Math.max(.15,point[1]+.08);await moveAnchorTo(point);
    }
    await page.waitForTimeout(450);
  }
  d=await diag();assert.equal(d.state.grab.complete,true,'Real pointer sweep assembles the object');
  assert.equal(d.audio.loopActive,false,'Stone texture stops at completion');
  assert(d.audio.eventCounts.snap>0);assert.equal(d.audio.eventCounts.complete,1);
  await page.screenshot({path:'output/repair/assembled.png'});
  const assembled=d.state.pieces.find(x=>x.id==='cube');
  const anchorOffset=new THREE.Vector3().fromArray(d.state.grab.anchor).sub(new THREE.Vector3().fromArray(assembled.position));
  const home=new THREE.Vector3().fromArray(cube.position).add(anchorOffset);
  await moveAnchorTo(home.toArray());await page.waitForTimeout(650);
  d=await diag();assert(d.state.grab.canDock,'Placement cue activates near home');
  await page.screenshot({path:'output/repair/dock-ready.png'});
  await page.mouse.up();await page.waitForTimeout(650);
  d=await diag();assert.equal(d.state.intact,8);assert.equal(d.audio.eventCounts.dock,1);assert.equal(d.audio.loopActive,false);
  await page.screenshot({path:'output/repair/docked.png'});
  assert.deepEqual(errors,[]);
  const result={passed:true,checks:['30 decoded sounds','real pointer grab','quiet moving drag loop','drop sound and fade cleanup','regrab','magnetic assembly via pointer sweep','completion stops drag','release near home docks'],audio:d.audio,errors};
  await writeFile('output/repair/browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
