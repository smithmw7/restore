import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { driveGrabbedBody, releaseGrabbedBody } from './physical-drag.js';

const SAVE_KEY='restore.opening.mechanism.v1';
const ORIGIN=new THREE.Vector3(-5,1.13,8.7), IDENTITY=new THREE.Quaternion();
const empty=()=>({active:false,heldMesh:null,objectId:null,anchor:null,speed:0});

// Canonical geometry comes first. Packing never rescales a component.
export function createFieldBlueprint(){
  const parts=[];
  const add=(id,geometry,material,requires=[],packed=false)=>{
    geometry.computeBoundingBox();const center=geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x,-center.y,-center.z);
    parts.push({id,geometry,material,requires,packed,goal:center.add(ORIGIN)});
  };
  for(let layer=0;layer<2;layer++)for(let i=0;i<4;i++){
    const g=new THREE.TorusGeometry(.74,.065,6,14,Math.PI/2-.1);g.rotateX(Math.PI/2);g.rotateY(i*Math.PI/2+.05);g.translate(0,layer*.95,0);
    add(`frame-${layer}-${i}`,g,'bronze',layer?[`strut-${i}`]:[],true);
  }
  for(let i=0;i<4;i++){
    const a=-i*Math.PI/2+Math.PI/4;
    const g=new THREE.CylinderGeometry(.065,.085,.8,8).translate(Math.cos(a)*.74,.475,Math.sin(a)*.74);
    add(`strut-${i}`,g,'bronze',[`frame-0-${i}`]);
    const plate=new THREE.BoxGeometry(.24,.43,.1);plate.rotateY(-a);plate.translate(Math.cos(a)*.96,.48,Math.sin(a)*.96);
    add(`shield-${i}`,plate,'ceramic',[`strut-${i}`]);
  }
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    const g=new THREE.CylinderGeometry(.07,.1,.24,10).translate(Math.cos(a)*.34,.48,Math.sin(a)*.34);
    add(`emitter-${i}`,g,'copper',[`frame-0-${Math.floor(i*4/6)}`]);
  }
  add('field-lens',new THREE.CylinderGeometry(.23,.23,.07,24).translate(0,.95,0),'lens',['frame-1-0','frame-1-1','frame-1-2','frame-1-3','core']);
  add('core',new THREE.IcosahedronGeometry(.15,1).translate(0,.48,0),'core',Array.from({length:6},(_,i)=>`emitter-${i}`));
  return parts;
}

export function createOpeningAssembly({scene,world,materials={},onEvent=()=>{},storage,containerOpen=()=>false}){
  let saved;try{saved=JSON.parse(storage?.getItem(SAVE_KEY)||'null');}catch{}
  if(saved?.version!==1)saved=null;
  const blueprint=createFieldBlueprint(),savedParts=new Map();
  for(const entry of Array.isArray(saved?.parts)?saved.parts:[]){
    if(entry&&typeof entry.id==='string'&&blueprint.some(p=>p.id===entry.id)&&!savedParts.has(entry.id))savedParts.set(entry.id,entry);
  }
  const restoredInstalled=new Set(blueprint.filter(p=>savedParts.get(p.id)?.installed===true).map(p=>p.id));
  // An interrupted or edited save cannot install a component whose supports
  // are absent. Repeat because a missing dependency can invalidate a chain.
  for(let changed=true;changed;){changed=false;for(const p of blueprint)if(restoredInstalled.has(p.id)&&p.requires.some(id=>!restoredInstalled.has(id))){restoredInstalled.delete(p.id);changed=true;}}
  const validPosition=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&Math.abs(p[0])<46&&p[1]>=.04&&p[1]<32&&p[2]>-165&&p[2]<13.5;
  const root=new THREE.Group();root.name='Restoration field mechanism';scene.add(root);
  const mats={bronze:(materials.bronze||new THREE.MeshStandardMaterial({color:'#7c6650',metalness:.7,roughness:.43})).clone(),copper:(materials.copper||new THREE.MeshStandardMaterial({color:'#a26b4a',metalness:.65,roughness:.4})).clone(),ceramic:(materials.ceramic||new THREE.MeshStandardMaterial({color:'#c9c2a4',roughness:.5})).clone(),lens:new THREE.MeshStandardMaterial({color:'#6bbaa9',metalness:.6,roughness:.2}),core:new THREE.MeshStandardMaterial({color:'#88dacc',emissive:'#3ac4aa',emissiveIntensity:.18,roughness:.25,metalness:.45})};
  // A separate sorting surface keeps small components clear of the workshop's
  // fixed vice, shallow decorative trays and the actual bolt-cutter pickup.
  const furniture=[],furnitureGeometry=[],furnitureMaterial=new THREE.MeshStandardMaterial({color:'#695847',roughness:.93});
  function support(size,position){
    const geometry=new THREE.BoxGeometry(...size);furnitureGeometry.push(geometry);
    const mesh=new THREE.Mesh(geometry,furnitureMaterial);mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
    const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(...size.map(v=>v/2)).setTranslation(...position).setFriction(.9));
    furniture.push({mesh,collider,bounds:new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...position),new THREE.Vector3(...size))});
  }
  support([2.2,.1,1.8],[-10.5,.94,9.35]);
  for(const x of [-11.46,-9.54])for(const z of [8.59,10.11])support([.075,.89,.075],[x,.445,z]);
  const parts=blueprint.map((spec,index)=>{
    const mesh=new THREE.Mesh(spec.geometry,mats[spec.material].clone());mesh.castShadow=true;mesh.receiveShadow=true;
    Object.assign(mesh.userData,{labObject:`mechanism-${spec.id}`,kind:'mechanism-part',openingAssembly:true,soundId:spec.material==='ceramic'?'vase':'orb'});mesh.name=spec.id;root.add(mesh);
    const packing=spec.packed?new THREE.Vector3(-7+(index%2? .7:-.7),.16,4.35-Math.floor(index/2)*1.15):new THREE.Vector3(-11.22+((index-8)%4)*.48,1.015,8.7+Math.floor((index-8)/4)*.4);
    spec.geometry.computeBoundingBox();packing.y-=spec.geometry.boundingBox.min.y;
    const previous=savedParts.get(spec.id),installed=restoredInstalled.has(spec.id);
    mesh.position.copy(installed?spec.goal:validPosition(previous?.position)?new THREE.Vector3().fromArray(previous.position):packing);
    const part={...spec,mesh,packing,installed,body:null,collider:null,prepared:installed||!spec.packed||saved?.revealed===true};
    mesh.visible=part.prepared;
    return part;
  });
  let held=null,disposed=false,revealed=saved?.revealed===true||parts.some(p=>p.packed&&p.installed),completed=parts.every(p=>p.installed),elapsed=0,saveDelay=0;
  const glow=new THREE.PointLight('#71d5c1',0,3,2);glow.position.copy(ORIGIN).add(new THREE.Vector3(0,.5,0));root.add(glow);
  const seat=new THREE.Mesh(new THREE.TorusGeometry(.74,.018,5,32),new THREE.MeshStandardMaterial({color:'#8a7558',roughness:.6}));seat.rotation.x=Math.PI/2;seat.position.copy(ORIGIN);root.add(seat);
  function createBody(p){
    if(p.body||!p.prepared)return;
    const d=p.installed?RAPIER.RigidBodyDesc.fixed():RAPIER.RigidBodyDesc.dynamic();
    p.body=world.createRigidBody(d.setTranslation(...p.mesh.position.toArray()).setLinearDamping(1.2).setAngularDamping(2).setCcdEnabled(true));
    const desc=RAPIER.ColliderDesc.convexHull(p.geometry.attributes.position.array);
    p.collider=world.createCollider(desc.setMass(p.packed?6:1.1).setFriction(.85).setRestitution(.02),p.body);
  }
  for(const p of parts)createBody(p);
  function save(){try{storage?.setItem(SAVE_KEY,JSON.stringify({version:1,revealed,completed,parts:parts.map(p=>({id:p.id,installed:p.installed,position:p.mesh.position.toArray()}))}));}catch{}}
  function emit(action,p){onEvent({type:'puzzle',action,position:p.mesh.position.clone(),objectId:p.mesh.userData.labObject});}
  const available=p=>p.requires.every(id=>parts.find(other=>other.id===id)?.installed);
  function beginGrab(mesh,point,handId){
    const p=parts.find(p=>p.mesh===mesh);
    if(held||!p||p.installed||!p.prepared||!p.body)return false;
    held={p,handId,goal:mesh.position.clone(),offset:mesh.position.clone().sub(point),speed:0,last:mesh.position.clone()};onEvent({type:'pickup',objectId:mesh.userData.labObject,soundId:mesh.userData.soundId,position:mesh.position.clone(),kind:'mechanism-part',whole:true,complete:true});return true;
  }
  function moveGrab(point,handId){if(!held||held.handId!==handId||!Number.isFinite(point.x+point.y+point.z))return false;held.goal.copy(point).add(held.offset);held.goal.y=Math.max(.05,held.goal.y);return true;}
  function endGrab(handId,{cancelled=false}={}){if(!held||held.handId!==handId)return false;const p=held.p;releaseGrabbedBody(p.body);if(cancelled){p.body.setLinvel({x:0,y:0,z:0},true);p.body.setAngvel({x:0,y:0,z:0},true);}held=null;onEvent({type:'enddrag',reason:cancelled?'cancelled':'release',position:p.mesh.position.clone()});if(!cancelled)onEvent({type:'drop',objectId:p.mesh.userData.labObject,soundId:p.mesh.userData.soundId,position:p.mesh.position.clone()});saveDelay=.8;save();return true;}
  function getGrabState(){if(!held)return empty();return {active:true,handId:held.handId,heldMesh:held.p.mesh,objectId:held.p.mesh.userData.labObject,kind:'mechanism-part',anchor:held.p.mesh.position.toArray(),goal:held.goal.toArray(),speed:held.speed,complete:true,whole:true,assembled:1,total:1};}
  function install(p){
    releaseGrabbedBody(p.body);p.body.setTranslation(p.goal,true);p.body.setRotation(IDENTITY,true);p.body.setLinvel({x:0,y:0,z:0},true);p.body.setAngvel({x:0,y:0,z:0},true);p.body.setBodyType(RAPIER.RigidBodyType.Fixed,true);p.installed=true;p.mesh.position.copy(p.goal);p.mesh.quaternion.identity();held=null;onEvent({type:'enddrag',reason:'install',position:p.mesh.position.clone()});emit('install',p);
    if(parts.every(x=>x.installed)&&!completed){completed=true;onEvent({type:'complete',objectId:'field-mechanism',soundId:'orb',position:ORIGIN.clone()});}save();
  }
  function step(dt){
    if(disposed)return;elapsed+=dt;
    if(!revealed&&containerOpen()){
      revealed=true;for(const p of parts)if(!p.prepared){p.prepared=true;p.mesh.visible=true;createBody(p);}save();
    }
    for(const p of parts){
      if(!p.body)continue;p.mesh.position.copy(p.body.translation());p.mesh.quaternion.copy(p.body.rotation());
      if(!p.installed&&(p.mesh.position.y<-.5||Math.abs(p.mesh.position.x)>46||p.mesh.position.z>13.5||p.mesh.position.z<-165)){
        p.body.setTranslation(p.packing,true);p.body.setRotation(IDENTITY,true);p.body.setLinvel({x:0,y:0,z:0},true);p.body.setAngvel({x:0,y:0,z:0},true);p.mesh.position.copy(p.packing);saveDelay=.7;
      }
      p.mesh.material.emissive.setHex(0);p.mesh.material.emissiveIntensity=0;
    }
    if(held){
      const {p}=held;const near=available(p)&&held.goal.distanceTo(p.goal)<.52;
      if(near){p.mesh.material.emissive.set('#4eb59e');p.mesh.material.emissiveIntensity=.28;seat.material.emissive.set('#4eb59e');seat.material.emissiveIntensity=.3;if(!held.aligned)emit('align',p);}
      else seat.material.emissiveIntensity=0;
      held.aligned=near;
      const target=near?p.goal:held.goal;
      driveGrabbedBody(world,p.body,target,IDENTITY,dt,{maxSpeed:2.4,positionGain:near?9:7});
      held.speed=p.mesh.position.distanceTo(held.last)/Math.max(dt,.001);held.last.copy(p.mesh.position);
      if(near&&p.mesh.position.distanceTo(p.goal)<.055&&p.mesh.quaternion.angleTo(IDENTITY)<.1){
        // Only the final few centimetres are seated, after the dynamic body
        // has travelled to the socket through the regular collision solver.
        const d=p.goal.clone().sub(p.mesh.position);
        const block=world.castShape(p.mesh.position,IDENTITY,d,p.collider.shape,0,1,true,undefined,undefined,p.collider,p.body);
        if(!block)install(p);
      }
    }else seat.material.emissiveIntensity=0;
    if(completed){glow.intensity=1.5;const core=parts.find(p=>p.id==='core');core.mesh.material.emissive.set('#62d5be');core.mesh.material.emissiveIntensity=.8+Math.sin(elapsed*.7)*.15;core.mesh.position.y=core.goal.y+Math.sin(elapsed*.7)*.025;core.mesh.rotation.y=elapsed*.25;}
    if(saveDelay>0){saveDelay-=dt;if(saveDelay<=0)save();}
  }
  function reset(){if(held)endGrab(held.handId,{cancelled:true});for(const p of parts)if(!p.installed&&p.body){p.body.setTranslation(p.packing,true);p.body.setRotation(IDENTITY,true);p.body.setLinvel({x:0,y:0,z:0},true);p.mesh.position.copy(p.packing);}save();}
  return {root,owns:mesh=>!!mesh?.userData.openingAssembly,get targets(){return parts.filter(p=>p.prepared&&!p.installed).map(p=>p.mesh);},get grabTargets(){return this.targets;},beginGrab,moveGrab,endGrab,getGrabState,step,reset,
    getState:()=>({total:parts.length,installed:parts.filter(p=>p.installed).length,revealed,completed,parts:parts.map(p=>({id:p.id,installed:p.installed,available:available(p),visible:p.prepared,position:p.mesh.position.toArray(),goal:p.goal.toArray()}))}),
    getObstacles:()=>[...furniture.map(p=>p.bounds),...parts.filter(p=>p.prepared&&held?.p!==p).map(p=>new THREE.Box3().setFromObject(p.mesh))],
    dispose(){if(disposed)return;disposed=true;for(const p of parts){releaseGrabbedBody(p.body);if(p.body)world.removeRigidBody(p.body);p.geometry.dispose();p.mesh.material.dispose();}for(const p of furniture)world.removeCollider(p.collider,true);furnitureGeometry.forEach(g=>g.dispose());furnitureMaterial.dispose();Object.values(mats).forEach(m=>m.dispose());seat.geometry.dispose();seat.material.dispose();scene.remove(root);},
  };
}
