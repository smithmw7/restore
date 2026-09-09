import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { createDestructionLab, OBJECT_SPECS, MAGNET_RADIUS } from './destruction.js';
import { createRestoreAudio } from './audio.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f2eee5');
scene.fog = new THREE.Fog('#f2eee5', 8, 23);
const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, .05, 50);
const desktopPosition = new THREE.Vector3(4.1, 3.4, 5.6);
const desktopTarget = new THREE.Vector3(-.55, .8, -1.45);
camera.position.copy(desktopPosition);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(.85);
renderer.xr.setFoveation(.65);
const orbit = new OrbitControls(camera, canvas);
orbit.target.copy(desktopTarget);
orbit.enableDamping = true;
orbit.enablePan = false;
orbit.minDistance = 3.1;
orbit.maxDistance = 11;
orbit.minPolarAngle = .25;
orbit.maxPolarAngle = Math.PI / 2.08;
orbit.update();

const material = (color, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness });
const stone = material('#dedacb');
const platformMat = material('#e8e3d5');
const sage = material('#687a60');
const terracotta = material('#d7795b');
scene.add(new THREE.HemisphereLight('#fff8e8', '#b6b29a', 2.6));
const sun = new THREE.DirectionalLight('#fff0d6', 3.3);
sun.position.set(-3, 7, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .5, far: 18 });
sun.shadow.normalBias = .04;
sun.shadow.bias = -.0002;
scene.add(sun);
const fill = new THREE.DirectionalLight('#e9f2ff', 1.1);
fill.position.set(4, 4, -4);
scene.add(fill);

function mesh(geometry, mat, position, rotation) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(...position);
  if (rotation) m.rotation.set(...rotation);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
mesh(new THREE.PlaneGeometry(100, 100), material('#e7e3d7'), [0, -.025, 0], [-Math.PI / 2, 0, 0]);
mesh(new THREE.CylinderGeometry(3.55, 3.62, .07, 80), platformMat, [0, -.05, -1.35]);
const floorLine = mesh(new THREE.RingGeometry(3.36, 3.37, 80), material('#c1c7b4'), [0, -.008, -1.35], [-Math.PI / 2, 0, 0]);
floorLine.receiveShadow = false;

function textPanel(text, {width = 2, height = .3, color = '#485c46', size = 64, background, serif = false} = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * height / width);
  const ctx = c.getContext('2d');
  function paint(value, ink = color) {
    ctx.clearRect(0, 0, c.width, c.height);
    if(background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.fillStyle = ink; ctx.font = `${serif ? '' : '500 '}${size}px ${serif ? 'Georgia' : 'Arial'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(value, c.width / 2, c.height / 2);
  }
  paint(text);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({map:texture, transparent:true, depthWrite:false, side:THREE.DoubleSide, toneMapped:false}));
  m.userData.paint = (value, ink) => {paint(value, ink); texture.needsUpdate = true;};
  return m;
}

// A quiet, stationary room. There is no forced locomotion or camera shake.
mesh(new THREE.BoxGeometry(7.9, 3.6, .16), material('#e5e3d7'), [0, 1.7, -4.55]);
mesh(new THREE.BoxGeometry(7.9, .12, .23), stone, [0, .02, -4.4]);
for(let x = -3.4; x <= 3.5; x += .43) mesh(new THREE.BoxGeometry(.032, 3.2, .035), material('#d2d5c7'), [x, 1.8, -4.445]);
const plaque = mesh(new THREE.BoxGeometry(2.65, 1.18, .06), platformMat, [0, 2.12, -4.39]);
plaque.castShadow = true;
const title = textPanel('restore.', {width:2.3, height:.55, size:170, serif:true}); title.position.set(0, 2.28, -4.35); scene.add(title);
const subtitle = textPanel('A LITTLE ROOM TO BEGIN AGAIN', {width:2.1, height:.15, size:28}); subtitle.position.set(0, 1.94, -4.345); scene.add(subtitle);
const instruction = textPanel('TAP TO BREAK  /  HOLD A PIECE TO REBUILD', {width:2.7, height:.18, size:30}); instruction.position.set(0, 1.61, -4.35); scene.add(instruction);

for(const [i, spec] of OBJECT_SPECS.entries()) {
  const pedestal = mesh(new THREE.CylinderGeometry(.32, .34, spec.pedestalHeight, 36), i % 2 ? platformMat : stone, [spec.x, spec.pedestalHeight / 2, spec.z]);
  pedestal.castShadow = true;
  mesh(new THREE.CylinderGeometry(.326, .326, .022, 36), material('#f2eddf'), [spec.x, spec.pedestalHeight + .002, spec.z]);
  const label = textPanel(`${String(i+1).padStart(2,'0')}   ${spec.label.toUpperCase()}`, {width:.54,height:.08,size:55,color:'#55634f'});
  label.position.set(spec.x, spec.pedestalHeight - .2, spec.z + .324); scene.add(label);
}

// Decorative sculptural trees stay beyond the play area.
for(const [x,z,s] of [[-3.1,-3.8,1],[3.15,-3.7,.85]]) {
  mesh(new THREE.CylinderGeometry(.3,.24,.48,16), terracotta, [x,.24,z]);
  mesh(new THREE.CylinderGeometry(.045,.06,1.45,8), material('#8a775d'), [x,1.1,z]);
  for(let i=0;i<4;i++) {
    const leaf = mesh(new THREE.IcosahedronGeometry(.45*s,1), sage, [x+Math.sin(i*2)*.27,1.6+i*.23,z+Math.cos(i*2)*.14]);
    leaf.scale.set(.8,1.1,.7); leaf.castShadow=true;
  }
}

const resetRoot = new THREE.Group(); resetRoot.position.set(0,.73,-.48); resetRoot.rotation.x = -Math.PI / 4; scene.add(resetRoot);
const resetButton = new THREE.Mesh(new THREE.BoxGeometry(.48,.15,.038), material('#334b3e',.6)); resetRoot.add(resetButton);
resetButton.userData.restoreButton = true;
const resetText = textPanel('RESTORE ALL', {width:.425,height:.08,size:100,color:'#f2eee5'}); resetText.position.z=.021; resetRoot.add(resetText);
mesh(new THREE.CylinderGeometry(.045,.09,.64,12), sage, [0,.32,-.48]);
const worldCount = textPanel('0 / 8 BROKEN', {width:1.4,height:.13,size:52}); worldCount.position.set(0,1.37,-4.34); scene.add(worldCount);

let lab, ready = false, xrSupported = false, hovered = null, muted = false;
const gameAudio = createRestoreAudio();
const listenerPosition = new THREE.Vector3(), listenerForward = new THREE.Vector3(), listenerUp = new THREE.Vector3();
let xrFrames = 0, selectCount = 0, contactCount = 0, lastInput = 'none', lastFrame = 0, frameDelta = 0;
let sessionStartedAt = null, sessionVisibility = null, sessionError = null;
const raycaster = new THREE.Raycaster();
const tmpMatrix = new THREE.Matrix4(), tmpDirection = new THREE.Vector3(), tmpPoint = new THREE.Vector3();
const contactBounds = new THREE.Box3();
const contactTriangle = new THREE.Triangle();
const localContact = new THREE.Vector3(), closestContact = new THREE.Vector3();
const inverseContact = new THREE.Matrix4();
const inputs = [];
const handFactory = new XRHandModelFactory();
let desktopGrab = null;
const dragPlane = new THREE.Plane();
const magnetRoot = new THREE.Group(); scene.add(magnetRoot); magnetRoot.visible=false;
const magnetMaterial = new THREE.LineBasicMaterial({color:'#5e9a82',transparent:true,opacity:.27,depthWrite:false});
for(let axis=0;axis<3;axis++) {
  const points=Array.from({length:81},(_,i)=>new THREE.Vector3(Math.cos(i/80*Math.PI*2),Math.sin(i/80*Math.PI*2),0));
  const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),magnetMaterial);
  if(axis===1) ring.rotation.x=Math.PI/2;
  if(axis===2) ring.rotation.y=Math.PI/2;
  ring.scale.setScalar(MAGNET_RADIUS); magnetRoot.add(ring);
}
const repairLabel=textPanel('',{width:.7,height:.11,size:62,color:'#365947'}); scene.add(repairLabel); repairLabel.visible=false;
const homeMarker=new THREE.Mesh(new THREE.TorusGeometry(.32,.008,6,48),new THREE.MeshBasicMaterial({color:'#6ba18a',transparent:true,opacity:.6,depthWrite:false}));
homeMarker.rotation.x=Math.PI/2; scene.add(homeMarker); homeMarker.visible=false;
const homeLabel=textPanel('',{width:.7,height:.1,size:60,color:'#365947'}); scene.add(homeLabel); homeLabel.visible=false;
let lastRepairLabel='',lastHomeLabel='',showingRepairHint=false;

function handleLabEvent(event) {
  const {type,objectId,position,strength=1}=event, spatial=renderer.xr.isPresenting;
  if(type==='pickup') {gameAudio.unlock();gameAudio.playPickup(objectId,position,spatial);if(!event.complete)gameAudio.startDrag(objectId,position,spatial);}
  if(type==='enddrag') gameAudio.stopDrag({immediate:event.reason!=='release'});
  if(type==='drop') gameAudio.playDrop(objectId,position,spatial);
  if(type==='collision') gameAudio.playCollision(objectId,position,strength,spatial);
  if(type==='snap') gameAudio.playSnap(objectId,position,strength,spatial);
  if(type==='complete') {gameAudio.stopDrag({immediate:true});gameAudio.playComplete(objectId,position,spatial);}
  if(type==='dock') {gameAudio.playDock(objectId,position,spatial);for(const input of inputs) input.awaitClearAfterRestore=true;}
  if(type==='snap'||type==='complete'||type==='dock') {
    for(const input of inputs) if(input.grabbing) input.source?.gamepad?.hapticActuators?.[0]?.pulse(type==='snap'?.1:.3,type==='snap'?18:55)?.catch(()=>{});
  }
}
function cancelInteractions() {
  for(const input of inputs) {if(input.grabbing) lab?.endGrab(input.id,{cancelled:true});input.grabbing=false;input.contactId=null;input.awaitClearAfterRestore=true;}
  if(desktopGrab) lab?.endGrab('pointer',{cancelled:true});
  desktopGrab=null;pointerStart=null;gameAudio.stopDrag({immediate:true});
  orbit.enabled=!renderer.xr.isPresenting;
  clearHover();
}
function updateRepairVisuals(time) {
  const grab=lab?.getGrabState();
  magnetRoot.visible=!!grab?.active&&!grab.complete;
  repairLabel.visible=homeMarker.visible=homeLabel.visible=!!grab?.active;
  if(!grab?.active) {if(showingRepairHint){$('#hover-label').hidden=true;showingRepairHint=false;}return;}
  repairLabel.visible=!grab.canDock;
  magnetRoot.position.fromArray(grab.anchor);
  repairLabel.position.fromArray(grab.anchor).add(new THREE.Vector3(0,.22,0));
  const viewer=renderer.xr.isPresenting?renderer.xr.getCamera():camera;
  viewer.getWorldPosition(tmpPoint);repairLabel.lookAt(tmpPoint);
  const label=grab.complete?'Whole again':`${grab.assembled} / ${grab.total} pieces`;
  if(label!==lastRepairLabel) {repairLabel.userData.paint(label);lastRepairLabel=label;}
  const spec=OBJECT_SPECS.find(spec=>spec.id===grab.objectId);
  homeMarker.position.set(spec.x,spec.pedestalHeight+.025,spec.z);
  homeMarker.scale.setScalar(grab.canDock?1.06+Math.sin(time*.008)*.025:1);
  homeMarker.material.opacity=grab.canDock?.95:.35;
  homeLabel.position.set(spec.x,spec.pedestalHeight+.62,spec.z);homeLabel.lookAt(tmpPoint);
  const homeText=grab.complete?(grab.canDock?'Release to place':'Bring it home'):'';
  if(homeText!==lastHomeLabel) {homeLabel.userData.paint(homeText);lastHomeLabel=homeText;}
  $('#hover-label').textContent=grab.complete?(grab.canDock?'Release to place':`${spec.label} · bring it to the glowing stand`):`${spec.label} · ${grab.assembled} / ${grab.total} pieces · move near the others`;
  $('#hover-label').hidden=renderer.xr.isPresenting;showingRepairHint=true;
  gameAudio.updateDrag({position:magnetRoot.position,speed:grab.speed});
}


function touchesSurface(target, point, radius) {
  target.updateWorldMatrix(true, false);
  contactBounds.setFromObject(target).expandByScalar(radius);
  if(!contactBounds.containsPoint(point)) return false;
  inverseContact.copy(target.matrixWorld).invert();
  localContact.copy(point).applyMatrix4(inverseContact);
  const localRadius = radius * inverseContact.getMaxScaleOnAxis();
  const position=target.geometry.attributes.position,index=target.geometry.index;
  const count=index ? index.count : position.count;
  for(let i=0;i<count;i+=3) {
    contactTriangle.a.fromBufferAttribute(position,index ? index.getX(i) : i);
    contactTriangle.b.fromBufferAttribute(position,index ? index.getX(i+1) : i+1);
    contactTriangle.c.fromBufferAttribute(position,index ? index.getX(i+2) : i+2);
    contactTriangle.closestPointToPoint(localContact,closestContact);
    if(closestContact.distanceToSquared(localContact) <= localRadius*localRadius) return true;
  }
  return false;
}

function restoreAll() { if(!ready || lab.getState().restoring || !lab.getState().broken) return; cancelInteractions(); lab.restore(); gameAudio.playRestore(); }
function updateUI() {
  if(!lab) return;
  const state = lab.getState();
  $('#broken-count').textContent = String(state.broken).padStart(2,'0');
  $('#collection-status').textContent = state.restoring ? 'COMING BACK TOGETHER' : state.broken === 8 ? 'A FRESH START AWAITS' : 'OBJECTS BROKEN';
  $('#restore').disabled = !state.broken || state.restoring;
  worldCount.userData.paint(state.restoring ? 'BEGIN AGAIN…' : `${state.broken} / 8 BROKEN`);
}
function clearHover() {
  if(hovered && !hovered.userData.restoreButton) {
    const materials=Array.isArray(hovered.material)?hovered.material:[hovered.material];
    for(const m of materials) if(m.emissive) m.emissive.setHex(0);
  }
  hovered=null; $('#hover-label').hidden=true; canvas.style.cursor='grab';
}
function setHover(hit) {
  if(hovered === hit?.object) return;
  clearHover();
  if(!hit) return;
  hovered=hit.object;
  if(!hovered.userData.restoreButton) {
    const mats=Array.isArray(hovered.material)?hovered.material:[hovered.material];
    for(const m of mats) if(m.emissive) m.emissive.setHex(0x182012);
  }
  const spec=OBJECT_SPECS.find(x=>x.id===hovered.userData.labObject);
  $('#hover-label').textContent=hovered.userData.restoreButton?'Restore everything':`${spec?.label ?? 'Object'} · ${lab.grabTargets.includes(hovered)?'hold to gather pieces':'tap to break'}`;
  $('#hover-label').hidden=renderer.xr.isPresenting;
  canvas.style.cursor='pointer';
}
function intersect() {
  if(!ready) return null;
  const list=[...lab.targets,...lab.grabTargets].filter(x=>x.visible);
  list.push(resetButton);
  return raycaster.intersectObjects(list,false)[0] ?? null;
}
function activate(hit, direction, input) {
  if(!hit || !ready) return false;
  if(hit.object.userData.restoreButton) {restoreAll();return true;}
  if(lab.getGrabState().active || !lab.targets.includes(hit.object)) return false;
  clearHover();
  const before=lab.getState().broken;
  lab.hit(hit.object,hit.point,direction);
  if(lab.getState().broken > before) {
    gameAudio.playBreak(hit.object.userData.labObject,hit.point,renderer.xr.isPresenting);lastInput=input?.kind ?? 'pointer';
    input?.source?.gamepad?.hapticActuators?.[0]?.pulse(.45,45)?.catch(()=>{});
    updateUI();return true;
  }
  return false;
}

for(let i=0;i<2;i++) {
  const controller=renderer.xr.getController(i),grip=renderer.xr.getControllerGrip(i),hand=renderer.xr.getHand(i);
  scene.add(controller,grip,hand);
  hand.add(handFactory.createHandModel(hand,'spheres'));
  const beam=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0x58765e,transparent:true,opacity:.5}));
  beam.scale.z=3;controller.add(beam);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.009,8,8),new THREE.MeshBasicMaterial({color:0xd97151}));scene.add(dot);dot.visible=false;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.017,.023,.11,12),material(i?'#718eae':'#c78064'));
  handle.rotation.x=Math.PI/2;grip.add(handle);
  const tip=new THREE.Mesh(new THREE.SphereGeometry(.027,12,8),material('#f4dfbb'));tip.position.z=-.095;grip.add(tip);
  const input={controller,grip,hand,beam,dot,handle,tip,source:null,kind:'controller',id:`xr-${i}`,grabbing:false,grabDistance:0,grabNear:false,contactPoint:new THREE.Vector3(),contactValid:false,lastContact:0,contactId:null};inputs.push(input);
  controller.addEventListener('connected',(e)=>{input.source=e.data;input.kind=e.data.hand?'hand':'controller';handle.visible=tip.visible=!e.data.hand;});
  controller.addEventListener('disconnected',()=>{if(input.grabbing) lab?.endGrab(input.id,{cancelled:true});input.grabbing=false;input.source=null;dot.visible=false;input.contactId=null;});
  controller.addEventListener('selectstart',()=>{
    selectCount++;
    controller.updateWorldMatrix(true,false);tmpMatrix.extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0,0,-1).applyMatrix4(tmpMatrix);
    if(!ready) return;
    let hit=null;
    // Prefer a piece actually between the fingers over something behind it.
    if(input.contactValid) {
      const near=lab.grabTargets.find(target=>target.visible&&touchesSurface(target,input.contactPoint,.045));
      if(near) hit={object:near,point:input.contactPoint.clone(),distance:0,near:true};
    }
    hit??=intersect();
    if(hit&&lab.grabTargets.includes(hit.object)) {
      clearHover();
      if(lab.beginGrab(hit.object,hit.point,input.id)) {
        input.grabbing=true;input.grabNear=!!hit.near;input.grabDistance=Math.max(.12,hit.distance);
        input.initialGrabDistance=input.grabDistance;
        input.handDepthAtGrab=input.contactValid?input.contactPoint.distanceTo(renderer.xr.getCamera().getWorldPosition(new THREE.Vector3())):null;
        input.lastContact=performance.now();lastInput=`${input.kind}-grab`;
      }
    } else activate(hit,raycaster.ray.direction,input);
  });
  controller.addEventListener('selectend',()=>{
    if(input.grabbing) {lab?.endGrab(input.id);input.grabbing=false;input.awaitClearAfterRestore=true;input.lastContact=performance.now();}
  });
  controller.addEventListener('squeezestart',()=>{if(!lab?.getGrabState().active)restoreAll();});
}

function updateXRInputs(time,frame) {
  for(const input of inputs) {
    const {controller,source,beam,dot,grip}=input;
    if(!source || !controller.visible) {dot.visible=false;input.contactValid=false;if(input.grabbing){lab?.endGrab(input.id,{cancelled:true});input.grabbing=false;}continue;}
    controller.updateWorldMatrix(true,false);tmpMatrix.extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);raycaster.ray.direction.set(0,0,-1).applyMatrix4(tmpMatrix);
    const hit=intersect();beam.scale.z=input.grabbing?input.grabDistance:(hit?.distance ?? 2.8);dot.visible=!!hit&&!input.grabbing;beam.visible=!input.grabNear||!input.grabbing;
    if(hit) dot.position.copy(hit.point);
    let contactValid=false;
    if(source.hand && frame) {
      const joint=source.hand.get('index-finger-tip');
      const pose=joint && frame.getJointPose(joint,renderer.xr.getReferenceSpace());
      if(pose) {
        tmpPoint.copy(pose.transform.position);contactValid=true;
        input.contactPoint.copy(tmpPoint);
        {
          const thumb=source.hand.get('thumb-tip'),thumbPose=thumb&&frame.getJointPose(thumb,renderer.xr.getReferenceSpace());
          if(thumbPose) input.contactPoint.lerp(new THREE.Vector3().copy(thumbPose.transform.position),.5);
        }
      }
    } else if(grip.visible) {input.tip.getWorldPosition(tmpPoint);contactValid=true;}
    input.contactValid=contactValid;
    if(contactValid&&!source.hand) input.contactPoint.copy(tmpPoint);
    if(input.grabbing) {
      if(input.grabNear) {
        if(contactValid) lab.moveGrab(input.contactPoint,input.id);
        else {lab.endGrab(input.id,{cancelled:true});input.grabbing=false;}
      } else {
        // The thumbstick adjusts ray depth; natural hand movement always carries the piece.
        if(source.hand&&contactValid&&input.handDepthAtGrab!==null) {
          const handDepth=input.contactPoint.distanceTo(listenerPosition);
          input.grabDistance=THREE.MathUtils.clamp(input.initialGrabDistance+(handDepth-input.handDepthAtGrab)*3,.16,5);
        }
        const axes=source.gamepad?.axes;
        const depthAxis=axes?.length>=4?axes[3]:0;
        if(Math.abs(depthAxis)>.18) input.grabDistance=THREE.MathUtils.clamp(input.grabDistance+depthAxis*frameDelta*1.6,.16,5);
        raycaster.ray.at(input.grabDistance,tmpPoint);lab.moveGrab(tmpPoint,input.id);
      }
      continue;
    }
    if(!contactValid || !ready || lab.getGrabState().active) continue;
    let contact=null;
    if(lab.getState().restoring) continue;
    if(input.awaitClearAfterRestore) {
      const stillInside=[...lab.targets,resetButton].some(target=>target.visible && contactBounds.setFromObject(target).expandByScalar(source.hand ? .015 : .03).containsPoint(tmpPoint));
      if(!stillInside) {input.awaitClearAfterRestore=false;input.contactId=null;}
      continue;
    }
    for(const target of [...lab.targets,resetButton]) {
      if(!target.visible) continue;
      if(touchesSurface(target,tmpPoint,source.hand ? .015 : .03)) {contact=target;break;}
    }
    const contactId=contact?.userData.labObject ?? (contact?.userData.restoreButton?'restore':null);
    if(contact && contactId !== input.contactId && time-input.lastContact>350) {
      tmpDirection.copy(raycaster.ray.direction);
      if(activate({object:contact,point:tmpPoint.clone()},tmpDirection,input)) {input.lastContact=time;input.contactId=contactId;contactCount++;}
    }
    if(!contact) input.contactId=null;
  }
}

let pointerStart=null;
function pointerRay(e) {const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);}
// Capture before OrbitControls so the same press cannot both grab and orbit.
canvas.addEventListener('pointerdown',(e)=>{
  if(renderer.xr.isPresenting||e.button!==0) return;
  pointerStart={x:e.clientX,y:e.clientY};pointerRay(e);
  const hit=intersect();
  if(hit&&lab.grabTargets.includes(hit.object)&&lab.beginGrab(hit.object,hit.point,'pointer')) {
    desktopGrab={pointerId:e.pointerId,point:hit.point.clone()};
    camera.getWorldDirection(tmpDirection);dragPlane.setFromNormalAndCoplanarPoint(tmpDirection,hit.point);
    orbit.enabled=false;clearHover();canvas.style.cursor='grabbing';canvas.setPointerCapture(e.pointerId);e.stopImmediatePropagation();e.preventDefault();
  }
},{capture:true});
canvas.addEventListener('pointermove',(e)=>{
  if(renderer.xr.isPresenting)return;
  pointerRay(e);
  if(desktopGrab) {
    if(raycaster.ray.intersectPlane(dragPlane,tmpPoint)) {desktopGrab.point.copy(tmpPoint);lab.moveGrab(tmpPoint,'pointer');}
    return;
  }
  if(!e.buttons)setHover(intersect());
});
canvas.addEventListener('pointerup',(e)=>{
  if(renderer.xr.isPresenting || !pointerStart) return;
  if(desktopGrab) {
    lab.endGrab('pointer');desktopGrab=null;orbit.enabled=true;
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    clearHover();e.stopImmediatePropagation();
  } else if(Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<7) {pointerRay(e);activate(intersect(),raycaster.ray.direction);}
  pointerStart=null;
},{capture:true});
canvas.addEventListener('wheel',(e)=>{
  if(!desktopGrab)return;
  e.preventDefault();e.stopImmediatePropagation();
  camera.getWorldDirection(tmpDirection);
  desktopGrab.point.addScaledVector(tmpDirection,THREE.MathUtils.clamp(e.deltaY*.0015,-.15,.15));
  dragPlane.setFromNormalAndCoplanarPoint(tmpDirection,desktopGrab.point);lab.moveGrab(desktopGrab.point,'pointer');
},{capture:true,passive:false});
canvas.addEventListener('pointercancel',cancelInteractions);
canvas.addEventListener('lostpointercapture',()=>{if(desktopGrab)cancelInteractions();});
canvas.addEventListener('pointerleave',()=>{if(!desktopGrab)clearHover();});
addEventListener('blur',()=>{if(!renderer.xr.isPresenting)cancelInteractions();});
$('#restore').addEventListener('click',restoreAll);
$('#sound').addEventListener('click',()=>{muted=!muted;gameAudio.setMuted(muted);$('#sound').textContent=muted?'SOUND OFF':'SOUND ON';$('#sound').setAttribute('aria-pressed',String(!muted));});
addEventListener('keydown',(e)=>{
  if(e.code==='Space'||e.code==='KeyR'){e.preventDefault();restoreAll();}
  if(e.code==='KeyF'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>{});}
});
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
addEventListener('resize',resize);

function updateVRButton() {
  $('#enter-vr').disabled=!ready||!xrSupported;
  const onQuest = /OculusBrowser/i.test(navigator.userAgent);
  $('#enter-vr').textContent=!ready?'Preparing the room…':xrSupported?'Enter VR ↗':onQuest?'Waiting for headset…':'Desktop preview';
  if(ready) $('#xr-status').textContent=xrSupported?'Put on your headset, then enter the room.':onQuest?'Wake your headset and open this tab. Checking VR availability…':'Click an object to try it. Open on your Quest to enter VR.';
}
let checkingXR=false;
async function refreshXRAvailability() {
  if(checkingXR || !navigator.xr || !isSecureContext || renderer.xr.isPresenting) return;
  checkingXR=true;
  try {
    const supported=await navigator.xr.isSessionSupported('immersive-vr');
    if(supported!==xrSupported) {
      xrSupported=supported;updateVRButton();
      if(supported) $('#control-hint').textContent='TAP TO BREAK / HOLD A PIECE TO GATHER / RELEASE NEAR ITS STAND';
      if(ready && supported) $('#mode-label').textContent='READY FOR YOUR QUEST';
    }
  } catch(error) { console.warn('Could not check VR availability',error.message); }
  finally { checkingXR=false; }
}
navigator.xr?.addEventListener('devicechange',refreshXRAvailability);
addEventListener('focus',refreshXRAvailability);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshXRAvailability();});
// A USB-launched tab may load while Quest is asleep. Detect VR when it wakes.
if(/OculusBrowser/i.test(navigator.userAgent)) setInterval(()=>{if(!xrSupported && ready)refreshXRAvailability();},1500);
$('#enter-vr').addEventListener('click',async()=>{
  if(!ready) return;
  $('#enter-vr').disabled=true;sessionError=null;
  try {
    gameAudio.unlock();
    // Request directly in the click gesture, before any asynchronous work.
    const session = await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor'],optionalFeatures:['hand-tracking','bounded-floor']});
    orbit.enabled=false;camera.position.set(0,0,0);camera.quaternion.identity();
    session.addEventListener('visibilitychange',()=>{sessionVisibility=session.visibilityState;if(sessionVisibility!=='visible')cancelInteractions();});
    sessionVisibility=session.visibilityState;sessionStartedAt=new Date().toISOString();
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(.65);
  } catch(error) {
    sessionError=error.message;$('#xr-status').textContent=`VR could not start: ${error.message}. Tap Enter VR to retry.`;
    $('#enter-vr').disabled=false;orbit.enabled=true;camera.position.copy(desktopPosition);orbit.target.copy(desktopTarget);orbit.update();
  }
});
renderer.xr.addEventListener('sessionstart',()=>{document.body.classList.add('in-vr');clearHover();});
renderer.xr.addEventListener('sessionend',()=>{
  cancelInteractions();
  document.body.classList.remove('in-vr');orbit.enabled=true;camera.position.copy(desktopPosition);orbit.target.copy(desktopTarget);orbit.update();
  sessionVisibility=null;updateVRButton();for(const i of inputs)i.dot.visible=false;
});

function update(dt,time,frame) {
  lab?.step(dt);
  if(renderer.xr.isPresenting) {
    const viewer = renderer.xr.getCamera();
    viewer.getWorldPosition(listenerPosition);
    listenerForward.set(0,0,-1).transformDirection(viewer.matrixWorld);
    listenerUp.set(0,1,0).transformDirection(viewer.matrixWorld);
    gameAudio.updateListener(listenerPosition,listenerForward,listenerUp);
    xrFrames++;updateXRInputs(time,frame);
  } else orbit.update();
  updateRepairVisuals(time);
}
renderer.setAnimationLoop((time,frame)=>{
  const dt=lastFrame?Math.min((time-lastFrame)/1000,.05):1/72;lastFrame=time;frameDelta=dt;
  update(dt,time,frame);renderer.render(scene,camera);
});
window.advanceTime=(ms)=>{const steps=Math.max(1,Math.round(ms/(1000/72)));for(let i=0;i<steps;i++)lab?.step(1/72);renderer.render(scene,camera);};
window.render_game_to_text=()=>{
  const projectMesh=x=>{
    const p=x.getWorldPosition(new THREE.Vector3()),screen=p.clone().project(camera);
    return {id:x.userData.labObject,uuid:x.uuid,position:p.toArray().map(n=>+n.toFixed(3)),screen:{x:Math.round((screen.x*.5+.5)*innerWidth),y:Math.round((-screen.y*.5+.5)*innerHeight)}};
  };
  const objects=(lab?.targets ?? []).filter(x=>x.visible).map(projectMesh);
  const pieces=(lab?.grabTargets ?? []).filter(x=>x.visible).map(projectMesh);
  return JSON.stringify({app:'Restore',coordinateSystem:'Meters. Origin is starting floor position; +Y up, -Z forward, +X right.',mode:renderer.xr.isPresenting?'immersive-vr':'desktop',ready,...lab?.getState(),objectStates:lab?.getState().objects,objects,pieces,controls:'Tap to break. Hold trigger or pinch on any piece and move to gather matching pieces. Release the complete object near its original pedestal to place it. Pull or push a pinched hand to adjust reach; thumbstick adjusts controller reach. Desktop: hold and drag pieces, scroll for depth. Space resets all.',xr:{supported:xrSupported,presenting:renderer.xr.isPresenting,frames:xrFrames,selectCount,contactCount,lastInput,visibility:sessionVisibility,startedAt:sessionStartedAt,error:sessionError,frameMs:Math.round(frameDelta*1000),sources:inputs.filter(x=>x.source).map(x=>({kind:x.kind,handedness:x.source.handedness,tracked:x.controller.visible}))}});
};
window.__restoreDiagnostics=()=>({secureContext:isSecureContext,webxr:!!navigator.xr,state:JSON.parse(window.render_game_to_text()),audio:gameAudio.getState(),input:{desktopGrab:desktopGrab?{point:desktopGrab.point.toArray(),normal:dragPlane.normal.toArray(),constant:dragPlane.constant}:null,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,aspect:camera.aspect}},drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries});

try {
  await refreshXRAvailability();
  if(xrSupported){$('#mode-label').textContent='YOUR ROOM IS ALMOST READY';$('#control-hint').textContent='TAP TO BREAK / HOLD A PIECE TO GATHER / RELEASE NEAR ITS STAND';}
  [lab]=await Promise.all([
    createDestructionLab({scene,onProgress:(n,total)=>{$('#xr-status').textContent=`Preparing object ${n} of ${total}…`;},onChange:()=>updateUI(),onEvent:handleLabEvent}),
    gameAudio.load().catch(error=>{console.warn('Recorded sounds could not load',error.message);}),
  ]);
  ready=true;updateUI();updateVRButton();
  if(xrSupported)$('#mode-label').textContent='READY FOR YOUR QUEST';
}catch(error){console.error(error);$('#xr-status').textContent=`The room could not load: ${error.message}. Reload to retry.`;$('#enter-vr').textContent='Room unavailable';}
