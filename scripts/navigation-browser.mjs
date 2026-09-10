import {chromium} from 'playwright';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--mute-audio']});
await mkdir('output/warehouse',{recursive:true});
try{
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto(process.env.RESTORE_URL||'http://127.0.0.1:5209');await page.waitForFunction(()=>window.__restoreDiagnostics?.().state.ready);
const diag=()=>page.evaluate(()=>window.__restoreDiagnostics());
assert.equal((await page.locator('body').innerText()).trim(),'','Scene and interface have no visible text');
let d=await diag();assert.equal(d.state.crateCount,176);assert.equal(d.state.warehouse.staticCrates,0);const initial=d.state.locomotion.head;
await page.keyboard.down('KeyW');await page.evaluate(()=>window.advanceTime(500));await page.keyboard.up('KeyW');d=await diag();assert(d.state.locomotion.head[2]<initial[2]-.25,'W moves down open aisle');
const beforeTurn=d.state.locomotion.head;await page.keyboard.press('KeyE');d=await diag();assert.equal(d.state.locomotion.turnCount,1);assert(Math.hypot(d.state.locomotion.head[0]-beforeTurn[0],d.state.locomotion.head[2]-beforeTurn[2])<.001,'Snap turn preserves actual head position');
await page.keyboard.press('KeyQ');d=await diag();assert.equal(d.state.locomotion.turnCount,2);
const oldQuaternion=d.input.camera.quaternion;
await page.mouse.move(720,350);await page.mouse.down({button:'right'});await page.mouse.move(750,365,{steps:6});await page.mouse.up({button:'right'});d=await diag();assert.notDeepEqual(d.input.camera.quaternion,oldQuaternion,'Mouse look rotates view');
// Aim at an unobstructed floor point, then use the actual desktop teleport shortcut.
const camera=new THREE.PerspectiveCamera(d.input.camera.fov,d.input.camera.aspect,.05,80);camera.position.fromArray(d.input.camera.position);camera.quaternion.fromArray(d.input.camera.quaternion);camera.updateMatrixWorld();
const destination=new THREE.Vector3(0,0,-4),screen=destination.clone().project(camera);
await page.keyboard.down('Shift');await page.mouse.click((screen.x*.5+.5)*1440,(-screen.y*.5+.5)*900);await page.keyboard.up('Shift');
d=await diag();assert.equal(d.state.locomotion.teleportCount,1);assert(Math.hypot(d.state.locomotion.head[0],d.state.locomotion.head[2]+4)<.02,'Teleport places head at destination');
assert.equal(d.state.openedCrates,0,'Navigation did not accidentally break a crate');
await page.screenshot({path:'output/warehouse/navigation.png'});
await page.keyboard.press('KeyR');assert.equal((await diag()).state.closedCrates,176);
assert.deepEqual(errors,[]);const result={passed:true,checks:['No visible text','176 interactive crates and no scenery crates','WASD aisle movement','snap turns around head','mouse look','floor teleport','no accidental crate breaks','reset'],state:d.state.locomotion,errors};
await writeFile('output/warehouse/navigation-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
