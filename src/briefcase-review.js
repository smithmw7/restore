import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#study'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color('#20262a');scene.fog=new THREE.Fog('#20262a',3,12);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();const env=pmrem.fromScene(room,.025);scene.environment=env.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.005,30);camera.position.set(1.30,.92,1.65);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.1,0);controls.enableDamping=true;controls.minDistance=.24;controls.maxDistance=5;controls.maxPolarAngle=Math.PI;controls.update();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:'#252c2d',roughness:.94}));ground.rotation.x=-Math.PI/2;ground.position.y=-.111;ground.receiveShadow=true;scene.add(ground);
const key=new THREE.DirectionalLight('#ffe0b3',3.5);key.position.set(-2,4,3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-2,right:2,top:2,bottom:-2,near:.1,far:12});key.shadow.normalBias=.004;key.shadow.radius=4;scene.add(key);
const rim=new THREE.DirectionalLight('#a7c7dc',2);rim.position.set(2,2,-2);scene.add(rim);
let asset,lid,targetOpen=0,targetExplode=0,explode=0,lidAmount=0;
const explodeParts=[];
const positions={front:[1.3,.92,1.65],rear:[-1.30,.72,-1.65],top:[.1,2.2,.35],under:[1.25,-.65,1.55],detail:[.40,.15,.93]};
function angle(name){const p=positions[name];if(!p)return;camera.position.fromArray(p);controls.target.set(0,name==='detail'?.035:.1,name==='detail'?.32:0);ground.visible=name!=='under';controls.update();}
document.querySelectorAll('[data-angle]').forEach(b=>b.addEventListener('click',()=>angle(b.dataset.angle)));
document.querySelectorAll('[data-lid]').forEach(b=>b.addEventListener('click',()=>{targetOpen=Number(b.dataset.lid);document.querySelectorAll('[data-lid]').forEach(node=>node.setAttribute('aria-pressed',String(node===b)));}));
document.querySelector('#explode').addEventListener('input',event=>{targetExplode=Number(event.target.value);if(targetExplode>.02){camera.position.set(1.7,1.3,2.2);controls.target.set(-.12,.43,.08);ground.visible=true;controls.update();}});
try{
 const gltf=await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/briefcase/briefcase.glb`);asset=gltf.scene;scene.add(asset);
 const meshList=[];asset.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;meshList.push(node);}});
 lid=asset.getObjectByName('LidPivot');
 const choices=[['LidPivot',[0,.46,-.10]],['HandlePivot',[0,-.035,.25]],['LatchPivot_L',[-.11,.07,.16]],['LatchPivot_R',[.11,.07,.16]],...Array.from({length:4},(_,i)=>[`Wheel_${i}`,[(i-1.5)*.035,.04,.20]])];
 for(const [name,offset] of choices){const node=asset.getObjectByName(name);if(node)explodeParts.push({node,home:node.position.clone(),offset:new THREE.Vector3(...offset)});}
 const triangles=meshList.reduce((n,mesh)=>n+(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3,0);
 document.querySelector('#status').innerHTML=`Blender source · PBR textures<br>${Math.round(triangles).toLocaleString()} triangles`;
 window.__briefcaseReview={ready:true,asset,camera,controls,angle,setOpen(value){targetOpen=value;},setExplode(value){targetExplode=value;},stats:{triangles,meshes:meshList.length},getState:()=>({open:lidAmount,explode,loaded:true})};
}catch(error){console.error(error);document.querySelector('#status').textContent='Model could not load';window.__briefcaseReview={ready:false,error:String(error)};}
const clock=new THREE.Clock();
renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05),blend=1-Math.exp(-10*dt);lidAmount=THREE.MathUtils.lerp(lidAmount,targetOpen,blend);explode=THREE.MathUtils.lerp(explode,targetExplode,blend);if(lid)lid.rotation.x=-1.75*lidAmount;for(const part of explodeParts)part.node.position.copy(part.home).addScaledVector(part.offset,explode);for(const name of ['LatchPivot_L','LatchPivot_R']){const node=asset?.getObjectByName(name);if(node)node.rotation.x=-.75*lidAmount;}controls.update();renderer.render(scene,camera);});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
