import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {createFieldBlueprint,createOpeningAssembly} from '../src/opening-assembly.js';
import {createOpeningEnvironment} from '../src/opening-environment.js';
import {createOpeningPuzzles,OPENING_SAVE_KEY} from '../src/opening-puzzles.js';
await RAPIER.init();
const blueprint=createFieldBlueprint();
assert.equal(blueprint.length,24);assert.equal(new Set(blueprint.map(p=>p.id)).size,24);
const seen=new Set();
function visit(p,stack=new Set()){
  assert.ok(!stack.has(p.id),'cyclic assembly prerequisite');if(seen.has(p.id))return;
  for(const id of p.requires){const next=blueprint.find(p=>p.id===id);assert.ok(next);visit(next,new Set([...stack,p.id]));}seen.add(p.id);
}
for(const p of blueprint){visit(p);assert.ok(p.goal.toArray().every(Number.isFinite));assert.ok(p.geometry.attributes.position.array.every(Number.isFinite));}
const checks=['24 finite canonical parts with unique IDs and an acyclic connection graph'];
const scene=new THREE.Scene(),world=new RAPIER.World({x:0,y:-9.81,z:0}),data=new Map(),events=[];
world.createCollider(RAPIER.ColliderDesc.cuboid(30,.05,30).setTranslation(0,-.05,0));
const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
let opened=false;
let assembly=createOpeningAssembly({scene,world,storage,containerOpen:()=>opened,onEvent:e=>events.push(e)});
assert.equal(assembly.targets.length,18);
assert.equal(assembly.getState().parts.filter(p=>p.visible).length,17);
opened=true;assembly.step(1/72);assert.equal(assembly.targets.length,25);
assert.equal(blueprint.filter(p=>p.packed).length,7);
checks.push('17 components and the specimen are accessible initially; opening the container reveals the seven remaining packed frames');
const first=assembly.targets.find(m=>m.name==='frame-0-0');
assert.ok(assembly.beginGrab(first,first.position.clone(),'left'));
assert.equal(assembly.beginGrab(assembly.targets[1],assembly.targets[1].position.clone(),'right'),false);
assert.equal(assembly.moveGrab(new THREE.Vector3(),'right'),false);
assert.equal(assembly.endGrab('right'),false);
const target=blueprint.find(p=>p.id==='frame-0-0').goal;
assembly.moveGrab(target,'left');
for(let i=0;i<1200&&assembly.getGrabState().active;i++){world.timestep=1/72;world.step();assembly.step(1/72);}
assert.equal(assembly.getState().parts.find(p=>p.id==='frame-0-0').installed,true);
assert.equal(events.filter(e=>e.action==='install').length,1);
checks.push('a physical held frame follows through space, seats once and releases shared hand ownership');
assembly.reset();assert.equal(assembly.getState().installed,1);assembly.dispose();
assembly=createOpeningAssembly({scene,world,storage,containerOpen:()=>true});
assert.equal(assembly.getState().installed,1);assert.equal(assembly.getState().revealed,true);
assembly.dispose();
checks.push('ordinary reset and reload retain installed parts and revealed access');
data.set('restore.opening.mechanism.v1',JSON.stringify({version:1,revealed:true,completed:false,parts:blueprint.map(p=>({id:p.id,installed:p.id!=='field-lens',position:p.id==='field-lens'?[-5,2.9,8.7]:p.goal.toArray()}))}));
assembly=createOpeningAssembly({scene,world,storage,onEvent:e=>events.push(e),containerOpen:()=>true});
const core=assembly.targets.find(p=>p.name==='field-lens');assert.ok(core);
assert.ok(assembly.beginGrab(core,core.position.clone(),'left'));assembly.moveGrab(blueprint.find(p=>p.id==='field-lens').goal,'left');
for(let i=0;i<800&&assembly.getGrabState().active;i++){world.timestep=1/72;world.step();assembly.step(1/72);}
assert.equal(assembly.getState().completed,true);assert.equal(assembly.getState().installed,24);
assert.equal(events.filter(e=>e.type==='complete').length,1);
assembly.reset();assert.equal(assembly.getState().completed,true);assembly.dispose();world.free();
for(const p of blueprint)p.geometry.dispose();
checks.push('the lens can close the core only after insertion, completes once and survives ordinary reset');

// Prove the whole mechanism can be assembled in its actual room. The fixture
// only unlocks the container; every component keeps its real packing pose,
// collider and dynamics and travels through ordinary player grab operations.
const roomScene=new THREE.Scene(),roomWorld=new RAPIER.World({x:0,y:-9.81,z:0});
roomWorld.createCollider(RAPIER.ColliderDesc.cuboid(50,.05,180).setTranslation(0,-.05,-70));
const environment=createOpeningEnvironment({scene:roomScene});
for(const bounds of environment.obstacles){
  const size=bounds.getSize(new THREE.Vector3()),position=bounds.getCenter(new THREE.Vector3());
  roomWorld.createCollider(RAPIER.ColliderDesc.cuboid(size.x/2,size.y/2,size.z/2).setTranslation(position.x,position.y,position.z));
}
const roomData=new Map([[OPENING_SAVE_KEY,JSON.stringify({version:1,containerCut:true,containerOpen:true,gloves:{left:true,right:true}})]]);
const roomStorage={getItem:key=>roomData.get(key),setItem:(key,value)=>roomData.set(key,value)};
const puzzles=createOpeningPuzzles({scene:roomScene,world:roomWorld,storage:roomStorage});
const roomEvents=[];
let roomAssembly=createOpeningAssembly({scene:roomScene,world:roomWorld,storage:roomStorage,containerOpen:()=>puzzles.doorOpen,onEvent:event=>roomEvents.push(event)});
function stepRoom(frames){
  for(let i=0;i<frames;i++){
    roomWorld.timestep=1/72;roomWorld.step();puzzles.step(1/72);roomAssembly.step(1/72);
  }
}
stepRoom(1);
for(let index=0;index<24;index++){
  const spec=roomAssembly.getState().parts.find(part=>!part.installed&&part.available);
  assert.ok(spec,`assembly has an available next part after ${index} installations`);
  const mesh=roomAssembly.targets.find(target=>target.name===spec.id);
  assert.ok(roomAssembly.beginGrab(mesh,mesh.position.clone(),'room-left'),`grab ${spec.id} at its physical location`);
  const start=mesh.position.clone();
  const route=spec.id.startsWith('frame-')&&spec.id!=='frame-0-0'?[
    [start.x,1.65,start.z],[start.x,1.65,6.55],[-7,1.65,6.55],
    [-7,1.65,8.7],[-7,2.7,8.7],[spec.goal[0],2.7,spec.goal[2]],spec.goal,
  ]:[
    [start.x,2.7,start.z],[spec.goal[0],2.7,spec.goal[2]],spec.goal,
  ];
  for(const waypoint of route){
    roomAssembly.moveGrab(new THREE.Vector3(...waypoint),'room-left');
    stepRoom(1000);
  }
  const result=roomAssembly.getState().parts.find(part=>part.id===spec.id);
  if(!result.installed){
    const diagnostic=[];
    roomWorld.forEachRigidBody(body=>{
      if(new THREE.Vector3().copy(body.translation()).distanceTo(new THREE.Vector3(...result.position))>.01)return;
      const contacts=[];
      for(let ci=0;ci<body.numColliders();ci++)roomWorld.contactPairsWith(body.collider(ci),other=>{
        roomWorld.contactPair(body.collider(ci),other,(m,flipped)=>contacts.push({otherPosition:other.translation(),otherType:other.parent()?.bodyType(),shape:other.shape.constructor.name,normal:m.normal(),flipped,solverDistances:Array.from({length:m.numSolverContacts()},(_,i)=>m.solverContactDist(i))}));
      });
      diagnostic.push({mass:body.mass(),sleeping:body.isSleeping(),gravity:body.gravityScale(),velocity:body.linvel(),contacts});
    });
    console.error(JSON.stringify({stuckPart:spec.id,diagnostic},null,2));
  }
  assert.equal(result.installed,true,`${spec.id} seats after a collision-respecting route through the actual room: ${JSON.stringify({part:result,resonance:roomAssembly.getResonanceState(),grab:roomAssembly.getGrabState().goal})}`);
  assert.equal(roomAssembly.getGrabState().active,false,`${spec.id} releases the shared hand on installation`);
}
assert.equal(roomAssembly.getState().completed,true);
assert.equal(roomAssembly.getState().installed,24);
assert.equal(roomEvents.filter(event=>event.action==='install').length,24);
assert.equal(roomEvents.filter(event=>event.type==='complete').length,1);
stepRoom(144);
assert.equal(roomEvents.filter(event=>event.type==='complete').length,1);
roomAssembly.dispose();
roomAssembly=createOpeningAssembly({scene:roomScene,world:roomWorld,storage:roomStorage,containerOpen:()=>puzzles.doorOpen});
assert.equal(roomAssembly.getState().completed,true);
assert.equal(roomAssembly.getState().installed,24);
roomAssembly.dispose();puzzles.dispose();environment.dispose();roomWorld.free();
checks.push('all 24 parts travel from their real packing positions through the container and workshop, install through physics, complete once and reload intact');
console.log(JSON.stringify({passed:true,checks},null,2));
