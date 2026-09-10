import './style.css';
import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { createRestoreAudio } from './audio.js';
import { loadWarehouseMaterials } from './materials.js';
import { createWarehouse } from './warehouse.js';
import { createWarehouseGameplay } from './warehouse-gameplay.js';
import { createLocomotion } from './locomotion.js';

const canvas=document.querySelector('#scene');
const scene=new THREE.Scene();
scene.background=new THREE.Color('#141b20');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
renderer.info.autoReset=false;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor(.8);renderer.xr.setFoveation(.65);
const rig=new THREE.Group();rig.name='Player origin';rig.position.set(0,0,3.5);scene.add(rig);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.05,80);rig.add(camera);
function resetDesktopCamera(){camera.position.set(0,1.65,0);camera.rotation.set(-.07,0,0,'YXZ');}
resetDesktopCamera();
const audio=createRestoreAudio();
let lab,warehouse,locomotion,ready=false,xrSupported=false,muted=false,lastTime=0,frameDelta=0;
let xrFrames=0,selectCount=0,contactCount=0,lastInput='none',sessionError=null,sessionVisibility=null;
const raycaster=new THREE.Raycaster(),rotation=new THREE.Matrix4(),point=new THREE.Vector3(),direction=new THREE.Vector3();
const viewerPosition=new THREE.Vector3(),viewerForward=new THREE.Vector3(),viewerUp=new THREE.Vector3();
const touchBox=new THREE.Box3(),triangle=new THREE.Triangle(),localContact=new THREE.Vector3(),closest=new THREE.Vector3(),inverse=new THREE.Matrix4();
const inputs=[],keys=new Set(),handFactory=new XRHandModelFactory();
let desktopGrab=null,pointerState=null,hovered=null;
const dragPlane=new THREE.Plane();
const ui={vr:document.querySelector('#enter-vr'),sound:document.querySelector('#sound'),reset:document.querySelector('#restore'),loader:document.querySelector('#loading')};

function objectAudio(mesh){return mesh?.userData.soundId||mesh?.userData.labObject||'cube';}
function handleEvent(event){
  const {type,position,strength=1}=event,id=event.soundId||event.objectId,spatial=renderer.xr.isPresenting;
  if(type==='pickup'){audio.unlock();audio.playPickup(id,position,spatial);if(!event.complete||event.whole)audio.startDrag(id,position,spatial);}
  if(type==='break')audio.playBreak(id,position,spatial);
  if(type==='enddrag')audio.stopDrag({immediate:event.reason!=='release'});
  if(type==='drop')audio.playDrop(id,position,spatial);
  if(type==='collision')audio.playCollision(id,position,strength,spatial);
  if(type==='snap')audio.playSnap(id,position,strength,spatial);
  if(type==='complete')audio.playComplete(id,position,spatial);
  if(type==='dock'){audio.playDock(id,position,spatial);for(const input of inputs)input.clearContact=true;}
  if(type==='snap'||type==='complete'||type==='break')for(const input of inputs)if(input.grabbing)input.source?.gamepad?.hapticActuators?.[0]?.pulse(type==='snap'?.12:.35,type==='snap'?16:45)?.catch(()=>{});
}
function cancelInteractions(){
  for(const input of inputs){input.pending=null;if(input.grabbing)lab?.endGrab(input.id,{cancelled:true});input.grabbing=false;input.clearContact=true;input.contactId=null;input.hadContact=false;locomotion?.endAim(input,false);}
  if(desktopGrab)lab?.endGrab('pointer',{cancelled:true});
  desktopGrab=null;pointerState=null;audio.stopDrag({immediate:true});clearHover();
}
function restoreAll(){if(!ready)return;cancelInteractions();lab.restore();audio.playRestore();}
function clearHover(){
  hovered=null;canvas.style.cursor='default';
}
function setHover(hit){
  if(hovered===hit?.object)return;clearHover();if(!hit)return;
  hovered=hit.object;canvas.style.cursor='grab';
}
function targets(){return ready?[...new Set([...lab.targets,...lab.grabTargets])].filter(mesh=>mesh.visible):[];}
function intersect(){
  if(!ready)return null;
  const hit=raycaster.intersectObjects(targets(),false)[0];
  if(!hit)return null;
  // Structural walls and beams also stop selection rays.
  for(const box of warehouse.obstacles){const blocked=raycaster.ray.intersectBox(box,point);if(blocked&&blocked.distanceTo(raycaster.ray.origin)<hit.distance-.025)return null;}
  return hit;
}
function surfaceTouch(mesh,p,radius){
  mesh.updateWorldMatrix(true,false);touchBox.setFromObject(mesh).expandByScalar(radius);
  if(!touchBox.containsPoint(p))return false;
  inverse.copy(mesh.matrixWorld).invert();localContact.copy(p).applyMatrix4(inverse);
  const r=radius*inverse.getMaxScaleOnAxis(),positions=mesh.geometry.attributes.position,index=mesh.geometry.index,count=index?index.count:positions.count;
  for(let i=0;i<count;i+=3){triangle.a.fromBufferAttribute(positions,index?index.getX(i):i);triangle.b.fromBufferAttribute(positions,index?index.getX(i+1):i+1);triangle.c.fromBufferAttribute(positions,index?index.getX(i+2):i+2);triangle.closestPointToPoint(localContact,closest);if(closest.distanceToSquared(localContact)<=r*r)return true;}
  return false;
}
function breakHit(hit,input){
  if(!hit||!ready||!lab.targets.includes(hit.object))return false;
  clearHover();
  const success=lab.hit(hit.object,hit.point,raycaster.ray.direction);
  if(success){lastInput=input?.kind||'pointer';input?.source?.gamepad?.hapticActuators?.[0]?.pulse(.4,40)?.catch(()=>{});}
  return success;
}
function inputRay(input){input.controller.updateWorldMatrix(true,false);rotation.extractRotation(input.controller.matrixWorld);raycaster.ray.origin.setFromMatrixPosition(input.controller.matrixWorld);raycaster.ray.direction.set(0,0,-1).applyMatrix4(rotation);}
function chooseHit(input){
  if(input.contactValid){const mesh=targets().find(mesh=>surfaceTouch(mesh,input.contactPoint,.045));if(mesh)return {object:mesh,point:input.contactPoint.clone(),distance:0,near:true};}
  return intersect();
}
function startGrab(input,hit,button='select'){
  if(!hit||!lab.beginGrab(hit.object,hit.point,input.id))return false;
  clearHover();input.grabbing=true;input.grabButton=button;input.near=!!hit.near;input.grabDistance=Math.max(.15,hit.distance);input.initialDistance=input.grabDistance;
  input.initialHandDepth=input.contactValid?input.contactPoint.distanceTo(viewerPosition):null;input.pending=null;lastInput=`${input.kind}-grab`;return true;
}
function endInputGrab(input,button){if(input.grabbing&&(!button||button===input.grabButton)){lab.endGrab(input.id);input.grabbing=false;input.clearContact=true;input.lastContact=performance.now();}}

// Small chevrons on the palm provide hand-only snap turns without written UI.
const palmTurns=new THREE.Group();scene.add(palmTurns);palmTurns.visible=false;
const turnButtons=[];
for(const sign of [-1,1]){
  const button=new THREE.Mesh(new THREE.CircleGeometry(.035,20),new THREE.MeshBasicMaterial({color:'#23383c',side:THREE.DoubleSide,transparent:true,opacity:.9,depthTest:false}));
  button.position.x=sign*.05;button.userData.turn=sign;button.renderOrder=20;palmTurns.add(button);turnButtons.push(button);
  const shape=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-sign*.007,.012,.002),new THREE.Vector3(sign*.006,0,.002),new THREE.Vector3(-sign*.007,-.012,.002)]);
  const chevron=new THREE.Line(shape,new THREE.LineBasicMaterial({color:'#b6d9cf',depthTest:false}));chevron.renderOrder=21;button.add(chevron);
}
for(let i=0;i<2;i++){
  const controller=renderer.xr.getController(i),grip=renderer.xr.getControllerGrip(i),hand=renderer.xr.getHand(i);rig.add(controller,grip,hand);
  hand.add(handFactory.createHandModel(hand,'spheres'));
  const beam=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:'#add7ce',transparent:true,opacity:.35}));controller.add(beam);beam.scale.z=3;
  const tip=new THREE.Mesh(new THREE.SphereGeometry(.017,8,6),new THREE.MeshStandardMaterial({color:'#96b9af',roughness:.4}));tip.position.z=-.1;grip.add(tip);
  const input={id:`xr-${i}`,controller,grip,hand,beam,tip,source:null,kind:'controller',grabbing:false,pending:null,contactValid:false,contactPoint:new THREE.Vector3(),touchPoint:new THREE.Vector3(),previousTouch:new THREE.Vector3(),hadContact:false,touchSpeed:0,lastContact:0,contactId:null,clearContact:false};inputs.push(input);
  controller.addEventListener('connected',event=>{input.source=event.data;input.kind=event.data.hand?'hand':'controller';tip.visible=!event.data.hand;});
  controller.addEventListener('disconnected',()=>{if(input.grabbing)lab?.endGrab(input.id,{cancelled:true});locomotion?.endAim(input,false);input.grabbing=false;input.pending=null;input.source=null;});
  controller.addEventListener('selectstart',()=>{
    if(!ready)return;audio.unlock();selectCount++;inputRay(input);
    if(palmTurns.visible){const turn=raycaster.intersectObjects(turnButtons,false)[0];if(turn){locomotion.turn(turn.object.userData.turn);return;}}
    if(input.grabbing){if(input.grabButton==='grip'){const held=lab.getGrabState().heldMesh;endInputGrab(input);if(held)breakHit({object:held,point:held.getWorldPosition(new THREE.Vector3())},input);}return;}
    if(locomotion.isAiming(input))return;
    const hit=chooseHit(input);
    if(hit){
      if(['fragment','crate-piece'].includes(hit.object.userData.kind)||Number.isInteger(hit.object.userData.fragmentIndex))startGrab(input,hit);
      else input.pending={hit,time:performance.now()};
    }else if(input.source?.hand)locomotion.beginAim(input);
  });
  controller.addEventListener('selectend',()=>{
    if(!ready)return;
    if(input.pending){inputRay(input);breakHit(input.pending.hit,input);input.pending=null;input.clearContact=true;}
    endInputGrab(input,'select');if(locomotion.isAiming(input))locomotion.endAim(input,true);
  });
  controller.addEventListener('squeezestart',()=>{if(!ready||input.grabbing)return;inputRay(input);input.pending=null;startGrab(input,chooseHit(input),'grip');});
  controller.addEventListener('squeezeend',()=>endInputGrab(input,'grip'));
}
function updateXRInputs(time,frame){
  palmTurns.visible=false;
  rig.updateWorldMatrix(true,true);
  for(const input of inputs){
    const {source,controller,grip,beam}=input;
    if(!source||!controller.visible){beam.visible=false;input.contactValid=false;if(input.grabbing){lab.endGrab(input.id,{cancelled:true});input.grabbing=false;}input.pending=null;locomotion.endAim(input,false);continue;}
    inputRay(input);input.contactValid=false;
    if(source.hand&&frame){
      const pose=frame.getJointPose(source.hand.get('index-finger-tip'),renderer.xr.getReferenceSpace());
      if(pose){input.touchPoint.copy(pose.transform.position).applyMatrix4(rig.matrixWorld);input.contactPoint.copy(input.touchPoint);input.contactValid=true;
        const thumb=frame.getJointPose(source.hand.get('thumb-tip'),renderer.xr.getReferenceSpace());if(thumb)input.contactPoint.lerp(point.copy(thumb.transform.position).applyMatrix4(rig.matrixWorld),.5);
      }
      if(source.handedness==='left'&&!input.grabbing&&!input.pending&&!lab.getGrabState().active){
        const wrist=frame.getJointPose(source.hand.get('wrist'),renderer.xr.getReferenceSpace());
        if(wrist){
          const q=new THREE.Quaternion().copy(wrist.transform.orientation);const up=new THREE.Vector3(0,-1,0).applyQuaternion(q).transformDirection(rig.matrixWorld);
          if(up.y>.45){palmTurns.visible=true;palmTurns.position.copy(wrist.transform.position).applyMatrix4(rig.matrixWorld).add(new THREE.Vector3(0,.065,0));palmTurns.lookAt(viewerPosition);}
        }
      }
    }else if(grip.visible){input.tip.getWorldPosition(input.touchPoint);input.contactPoint.copy(input.touchPoint);input.contactValid=true;}
    input.touchSpeed=input.contactValid&&input.hadContact?input.touchPoint.distanceTo(input.previousTouch)/Math.max(frameDelta,.008):0;
    if(input.contactValid)input.previousTouch.copy(input.touchPoint);input.hadContact=input.contactValid;
    if(input.pending&&time-input.pending.time>190)startGrab(input,input.pending.hit);
    if(input.grabbing){
      beam.visible=false;
      if(input.near){if(input.contactValid)lab.moveGrab(input.contactPoint,input.id);else{lab.endGrab(input.id,{cancelled:true});input.grabbing=false;}}
      else{
        if(source.hand&&input.contactValid&&input.initialHandDepth!==null)input.grabDistance=THREE.MathUtils.clamp(input.initialDistance+(input.contactPoint.distanceTo(viewerPosition)-input.initialHandDepth)*3,.2,9);
        const axes=source.gamepad?.axes,axis=axes?.length>=4?axes[3]:0;if(Math.abs(axis)>.18)input.grabDistance=THREE.MathUtils.clamp(input.grabDistance+axis*frameDelta*2,.2,9);
        raycaster.ray.at(input.grabDistance,point);lab.moveGrab(point,input.id);
      }
      continue;
    }
    const hit=intersect();beam.visible=!locomotion.isAiming(input);beam.scale.z=hit?.distance??3;
    if(input.pending||!input.contactValid||lab.getGrabState().active||locomotion.isAiming(input))continue;
    if(input.clearContact){if(!targets().some(mesh=>touchBox.setFromObject(mesh).expandByScalar(.08).containsPoint(input.touchPoint))){input.clearContact=false;input.contactId=null;}continue;}
    // Touch breaks only with an intentional moving fingertip, leaving pinch pickup time.
    const contact=lab.targets.find(mesh=>mesh.visible&&surfaceTouch(mesh,input.touchPoint,source.hand ? .012 : .025));
    const id=contact?.uuid;
    if(contact&&id!==input.contactId&&time-input.lastContact>500&&input.touchSpeed>.65){
      if(breakHit({object:contact,point:input.touchPoint.clone()},input)){contactCount++;input.lastContact=time;input.contactId=id;input.clearContact=true;}
    }
    if(!contact)input.contactId=null;
  }
}

function pointerRay(event){const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);}
function beginDesktopGrab(hit,event){
  if(!lab.beginGrab(hit.object,hit.point,'pointer'))return false;
  desktopGrab={point:hit.point.clone(),id:event.pointerId};camera.getWorldDirection(direction);dragPlane.setFromNormalAndCoplanarPoint(direction,hit.point);clearHover();canvas.style.cursor='grabbing';return true;
}
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{
  if(!ready||renderer.xr.isPresenting)return;audio.unlock();pointerRay(event);const hit=intersect();
  pointerState={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,button:event.button,time:performance.now(),hit,pointerId:event.pointerId};canvas.setPointerCapture(event.pointerId);
  if(event.button===0&&hit&&(['fragment','crate-piece'].includes(hit.object.userData.kind)||Number.isInteger(hit.object.userData.fragmentIndex)))beginDesktopGrab(hit,event);
  if(event.button===0&&event.shiftKey){const ground=new THREE.Plane(new THREE.Vector3(0,1,0),0);if(raycaster.ray.intersectPlane(ground,point))locomotion.teleportTo(point);pointerState=null;}
});
canvas.addEventListener('pointermove',event=>{
  if(renderer.xr.isPresenting||!ready)return;
  pointerRay(event);
  if(desktopGrab){if(raycaster.ray.intersectPlane(dragPlane,point)){desktopGrab.point.copy(point);lab.moveGrab(point,'pointer');}return;}
  if(pointerState){
    const distance=Math.hypot(event.clientX-pointerState.x,event.clientY-pointerState.y);
    if(pointerState.button===0&&pointerState.hit&&(distance>6||performance.now()-pointerState.time>190)){beginDesktopGrab(pointerState.hit,pointerState);return;}
    if(pointerState.button===2||pointerState.button===0&&!pointerState.hit){camera.rotation.y-=(event.clientX-pointerState.lastX)*.003;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-(event.clientY-pointerState.lastY)*.003,-1.3,1.3);}
    pointerState.lastX=event.clientX;pointerState.lastY=event.clientY;return;
  }
  setHover(intersect());
});
canvas.addEventListener('pointerup',event=>{
  if(renderer.xr.isPresenting)return;
  if(desktopGrab){lab.endGrab('pointer');desktopGrab=null;clearHover();}
  else if(pointerState?.button===0&&pointerState.hit){pointerRay(event);breakHit(pointerState.hit);}
  pointerState=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('wheel',event=>{
  if(!desktopGrab)return;event.preventDefault();camera.getWorldDirection(direction);desktopGrab.point.addScaledVector(direction,THREE.MathUtils.clamp(event.deltaY*.002,-.2,.2));dragPlane.setFromNormalAndCoplanarPoint(direction,desktopGrab.point);lab.moveGrab(desktopGrab.point,'pointer');
},{passive:false});
canvas.addEventListener('pointercancel',cancelInteractions);canvas.addEventListener('lostpointercapture',()=>{if(desktopGrab)cancelInteractions();});canvas.addEventListener('pointerleave',()=>{if(!desktopGrab)clearHover();});
addEventListener('keydown',event=>{
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();keys.add(event.code);
  if(event.repeat)return;if(event.code==='KeyR')restoreAll();if(event.code==='KeyQ'||event.code==='ArrowLeft')locomotion?.turn(-1);if(event.code==='KeyE'||event.code==='ArrowRight')locomotion?.turn(1);
  if(event.code==='KeyF'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>{});}
});
addEventListener('keyup',event=>keys.delete(event.code));addEventListener('blur',()=>{keys.clear();cancelInteractions();locomotion?.reset();});
function updateDesktop(dt,time){
  if(pointerState?.button===0&&pointerState.hit&&!desktopGrab&&time-pointerState.time>190)beginDesktopGrab(pointerState.hit,pointerState);
  const forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
  const right=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  if(!forward&&!right)return;
  camera.getWorldDirection(direction);direction.y=0;direction.normalize();const step=direction.clone().multiplyScalar(forward).add(new THREE.Vector3(-direction.z,0,direction.x).multiplyScalar(right)).normalize().multiplyScalar(dt*2.2);
  camera.getWorldPosition(point);point.add(step);point.y=0;if(locomotion.isValidPosition(point)){rig.position.add(step);if(desktopGrab){desktopGrab.point.add(step);dragPlane.setFromNormalAndCoplanarPoint(dragPlane.normal,desktopGrab.point);lab.moveGrab(desktopGrab.point,'pointer');}}
}
ui.sound.addEventListener('click',()=>{muted=!muted;audio.setMuted(muted);ui.sound.classList.toggle('muted',muted);ui.sound.setAttribute('aria-pressed',String(!muted));});
ui.reset.addEventListener('click',restoreAll);
function updateVRButton(){ui.vr.disabled=!ready||!xrSupported;ui.vr.hidden=ready&&!xrSupported;ui.vr.classList.toggle('available',ready&&xrSupported);}
async function refreshXR(){if(!navigator.xr||!isSecureContext||renderer.xr.isPresenting)return;try{xrSupported=await navigator.xr.isSessionSupported('immersive-vr');updateVRButton();}catch(error){console.warn('XR availability',error.message);}}
navigator.xr?.addEventListener('devicechange',refreshXR);addEventListener('focus',refreshXR);document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelInteractions();locomotion?.reset();}else refreshXR();});
if(/OculusBrowser/i.test(navigator.userAgent))setInterval(()=>{if(ready&&!xrSupported)refreshXR();},1500);
ui.vr.addEventListener('click',async()=>{
  if(!ready)return;ui.vr.disabled=true;sessionError=null;audio.unlock();
  try{
    const session=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor'],optionalFeatures:['hand-tracking','bounded-floor']});
    cancelInteractions();locomotion.reset();camera.position.set(0,0,0);camera.quaternion.identity();
    session.addEventListener('visibilitychange',()=>{sessionVisibility=session.visibilityState;if(sessionVisibility!=='visible'){cancelInteractions();locomotion.reset();}});sessionVisibility=session.visibilityState;
    await renderer.xr.setSession(session);renderer.xr.setFoveation(.65);
  }catch(error){sessionError=error.message;console.error('VR could not start',error);ui.vr.classList.add('error');ui.vr.setAttribute('aria-label',`VR could not start: ${error.message}. Retry`);resetDesktopCamera();updateVRButton();}
});
renderer.xr.addEventListener('sessionstart',()=>{document.body.classList.add('in-vr');clearHover();});
renderer.xr.addEventListener('sessionend',()=>{cancelInteractions();locomotion.reset();resetDesktopCamera();document.body.classList.remove('in-vr');sessionVisibility=null;updateVRButton();});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function update(dt,time,frame){
  if(!ready)return;
  if(renderer.xr.isPresenting){
    rig.updateWorldMatrix(true,true);renderer.xr.updateCamera(camera);
    const viewer=renderer.xr.getCamera();viewer.getWorldPosition(viewerPosition);viewerForward.set(0,0,-1).transformDirection(viewer.matrixWorld);viewerUp.set(0,1,0).transformDirection(viewer.matrixWorld);audio.updateListener(viewerPosition,viewerForward,viewerUp);
    xrFrames++;
    if(sessionVisibility==='visible'){updateXRInputs(time,frame);locomotion.update(dt,inputs);}else palmTurns.visible=false;
  }else updateDesktop(dt,time);
  lab.step(dt);warehouse.update(dt,time/1000);
  const grab=lab.getGrabState();if(grab.active)audio.updateDrag({position:point.fromArray(grab.anchor),speed:grab.speed});
}
renderer.setAnimationLoop((time,frame)=>{frameDelta=lastTime?Math.min((time-lastTime)/1000,.05):1/72;lastTime=time;update(frameDelta,time,frame);renderer.info.reset();renderer.render(scene,camera);});
window.advanceTime=ms=>{for(let i=0;i<Math.max(1,Math.round(ms/(1000/72)));i++)update(1/72,performance.now());renderer.info.reset();renderer.render(scene,camera);};
function project(mesh){const p=mesh.getWorldPosition(new THREE.Vector3()),screen=p.clone().project(camera);return {id:mesh.userData.labObject,uuid:mesh.uuid,kind:mesh.userData.kind,position:p.toArray(),screen:{x:Math.round((screen.x*.5+.5)*innerWidth),y:Math.round((-screen.y*.5+.5)*innerHeight)}};}
window.render_game_to_text=()=>JSON.stringify({app:'Restore',version:'warehouse',ready,coordinateSystem:'Meters, +Y up, -Z forward.',mode:renderer.xr.isPresenting?'immersive-vr':'desktop',...lab?.getState(),objectStates:lab?.getState().objects,objects:(lab?.targets||[]).filter(x=>x.visible).map(project),pieces:(lab?.grabTargets||[]).filter(x=>x.visible).map(project),locomotion:locomotion?.getState(),warehouse:warehouse?.stats,mode:renderer.xr.isPresenting?'immersive-vr':'desktop',xr:{supported:xrSupported,presenting:renderer.xr.isPresenting,frames:xrFrames,selectCount,contactCount,lastInput,visibility:sessionVisibility,error:sessionError,frameMs:Math.round(frameDelta*1000),sources:inputs.filter(x=>x.source).map(x=>({kind:x.kind,handedness:x.source.handedness,tracked:x.controller.visible}))}});
window.__restoreDiagnostics=()=>({secureContext:isSecureContext,webxr:!!navigator.xr,state:JSON.parse(window.render_game_to_text()),audio:audio.getState(),input:{desktopGrab:desktopGrab?{point:desktopGrab.point.toArray(),normal:dragPlane.normal.toArray(),constant:dragPlane.constant}:null,camera:{position:camera.getWorldPosition(new THREE.Vector3()).toArray(),quaternion:camera.getWorldQuaternion(new THREE.Quaternion()).toArray(),fov:camera.fov,aspect:camera.aspect}},drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries});
try{
  await refreshXR();
  const [materials]=await Promise.all([loadWarehouseMaterials(),audio.load()]);
  warehouse=createWarehouse({scene,renderer,materials});
  lab=await createWarehouseGameplay({scene,materials,bounds:warehouse.bounds,obstacles:warehouse.obstacles,additionalCrates:warehouse.storageCrates,onEvent:handleEvent});
  locomotion=createLocomotion({scene,rig,camera,renderer,bounds:warehouse.bounds,getObstacles:()=>lab.getObstacles?.()||warehouse.obstacles,onBeforeMove:cancelInteractions});
  ready=true;document.body.classList.add('ready');ui.loader.hidden=true;ui.reset.disabled=false;updateVRButton();
}catch(error){console.error(error);sessionError=error.message;ui.loader.classList.add('error');ui.loader.setAttribute('aria-label',`Loading failed: ${error.message}`);}
