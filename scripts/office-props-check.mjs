import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createOpeningPuzzles, createOpeningProgression, OPENING_SAVE_KEY } from '../src/opening-puzzles.js';
await RAPIER.init();
const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
const world = new RAPIER.World({x:0,y:-9.81,z:0});
world.createCollider(RAPIER.ColliderDesc.cuboid(90,.1,90).setTranslation(0,-.1,0));
const scene = new THREE.Scene(), events = [];
const puzzles = createOpeningPuzzles({scene,world,storage,onEvent:event=>events.push(event)});
const target = id => puzzles.targets.find(mesh=>mesh.userData.openingId===id);
const pos = id => target(id).getWorldPosition(new THREE.Vector3());
const state = id => puzzles.getState().props.find(prop=>prop.id===id);
const advance = seconds => { for(let i=0;i<seconds*72;i++){puzzles.step(1/72);world.timestep=1/72;world.step();} puzzles.step(0); };
const tap = id => puzzles.tap(target(id),pos(id));
const checks=[];
function check(name, fn){try{fn();checks.push(name);}catch(e){e.message=`${name}: ${e.message}`;throw e;}}
try {
  advance(3);
  check('all locker doors open independently with clear hollow storage and persistent state',()=>{
    for(const id of ['locker-left','locker','locker-right']) { assert.ok(target(id)); tap(id); advance(1); }
    assert.deepEqual(puzzles.getState().lockers,{left:true,center:true,right:true});
    assert.ok(target('locker-logbook')); assert.ok(target('locker-pencil')); assert.ok(target('glove-left'));
    const open = puzzles.getObstacles();
    for(const x of [9.28,10.6,11.65]) assert.ok(!open.some(box=>box.containsPoint(new THREE.Vector3(x,1.5,10.94))),'locker interior has a solid blocker');
    tap('locker-left'); advance(1); assert.equal(puzzles.getState().lockers.left,false); assert.equal(puzzles.getState().lockers.right,true);
    assert.equal(createOpeningProgression(storage).getState().lockers.right,true);
  });
  check('both modeled locker shelves and the coat rail have real contact surfaces',()=>{
    const boxes=puzzles.getObstacles();
    for(const x of [9.28,10.6,11.65]) {
      for(const y of [1.12,1.86]) assert.ok(boxes.some(box=>box.containsPoint(new THREE.Vector3(x,y,10.9))));
      assert.ok(boxes.some(box=>box.containsPoint(new THREE.Vector3(x,1.72,10.79))));
    }
  });
  check('fixed desk cannot be grabbed while pens, chair and books can',()=>{
    assert.equal(target('desk'),undefined);
    for(const id of ['pen-brass','pen-ink','pencil','chair','logbook-0','logbook-1']) {
      assert.ok(puzzles.grabTargets.includes(target(id)),id);
      assert.equal(puzzles.beginGrab(target(id),pos(id),'test'),true,id);
      assert.equal(puzzles.endGrab('wrong'),false);
      assert.equal(puzzles.endGrab('test'),true);
    }
    assert.ok(state('chair').mass>state('pen-brass').mass*100);
  });
  check('a lifted chair drops to the floor, sleeps and saves its resting pose',()=>{
    const start=pos('chair'); assert.ok(puzzles.beginGrab(target('chair'),start,'test'));
    puzzles.moveGrab(new THREE.Vector3(8.9,1.8,9.6),'test'); advance(3);
    assert.ok(state('chair').position[1]>1.4);
    puzzles.endGrab('test'); advance(10);
    const chair=state('chair'); assert.ok(chair.position[1]>.54&&chair.position[1]<.68,JSON.stringify(chair));
    assert.equal(chair.sleeping,true); assert.ok(Math.hypot(...chair.velocity)<.01);
    assert.deepEqual(createOpeningProgression(storage).getState().propPoses.chair.position,chair.position);
  });
  check('a tiny pen cannot be pulled through the desk and rests on its surface',()=>{
    const start=pos('pen-brass'); assert.ok(puzzles.beginGrab(target('pen-brass'),start,'test'));
    puzzles.moveGrab(new THREE.Vector3(7.65,.45,8.30),'test'); advance(2);
    assert.ok(state('pen-brass').position[1]>.955,'pen passed through tabletop');
    puzzles.endGrab('test'); advance(8);
    assert.ok(state('pen-brass').position[1]>.96); assert.equal(state('pen-brass').sleeping,true);
  });
  check('a released notebook rests in its tray through long idle and drawer movement without sinking',()=>{
    tap('drawer'); advance(1);
    assert.ok(puzzles.beginGrab(target('notebook'),pos('notebook'),'test'));
    puzzles.endGrab('test'); advance(8);
    const open=state('notebook');
    assert.equal(open.sleeping,true);
    assert.ok(open.position[1]>.648&&open.position[1]<.656,'book rests on the tray floor rather than inside it');
    advance(30);
    assert.deepEqual(state('notebook').position,open.position,'stationary tray contact does not drift while idle');
    tap('drawer'); advance(8);
    const closed=state('notebook');
    assert.ok(open.position[2]-closed.position[2]>.20,'closing tray physically carries the loose book inward');
    assert.ok(Math.abs(closed.position[1]-open.position[1])<.002,'drawer motion preserves support height');
    assert.equal(closed.sleeping,true);
    advance(30);
    assert.deepEqual(state('notebook').position,closed.position,'closed tray remains stable through long idle');
    assert.deepEqual(createOpeningProgression(storage).getState().propPoses.notebook.position,closed.position,'resting pose is saved after the moving tray settles');
  });
  check('drawer notebook can be lifted, opened in free space and keeps the 1942 clue',()=>{
    tap('drawer');advance(1); const start=pos('notebook');
    assert.ok(puzzles.beginGrab(target('notebook'),start,'test'));
    puzzles.moveGrab(new THREE.Vector3(7,1.4,9.6),'test');advance(3); puzzles.endGrab('test');
    tap('drawer'); advance(1); tap('notebook');
    assert.equal(puzzles.getState().notebookOpen,true); assert.equal(puzzles.getState().code,'1942');
    advance(8); assert.ok(state('notebook').sleeping);
  });
  check('old unlocked saves migrate to 1942 without losing discoveries',()=>{
    const old={version:1,code:'4172',wheels:[4,1,7,2],caseUnlocked:true,caseOpen:true,noteSeen:true,gloves:{left:true},lockerOpen:true};
    const migrated=createOpeningProgression({getItem:()=>JSON.stringify(old),setItem(){}}).getState();
    assert.deepEqual(migrated.wheels,[1,9,4,2]); assert.equal(migrated.caseOpen,true);assert.equal(migrated.gloves.left,true);assert.equal(migrated.lockers.center,true);
  });
  check('reloading an open notebook preserves the separately closed drawer and its clue',()=>{
    const saved=new Map(), isolated={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
    const progress=createOpeningProgression(isolated);
    progress.dispatch('drawer'); progress.dispatch('notebook'); progress.dispatch('drawer');
    assert.equal(progress.getState().drawerOpen,false);
    const reloaded=createOpeningProgression(isolated).getState();
    assert.equal(reloaded.drawerOpen,false,'notebook cover cannot override the saved drawer pose');
    assert.equal(reloaded.notebookOpen,true); assert.equal(reloaded.noteSeen,true);
    assert.equal(reloaded.code,'1942');
  });
  check('ordinary recovery returns props home and retains opened locks',()=>{
    puzzles.reset();advance(3);
    assert.equal(puzzles.getState().lockers.right,true);assert.ok(Math.abs(state('chair').position[0]-9.02)<.02);
    assert.ok(events.some(event=>event.action==='chair-pickup'));assert.ok(events.some(event=>event.type==='collision'));
  });
} finally { puzzles.dispose();world.free(); }
console.log(JSON.stringify({passed:checks.length,checks},null,2));
