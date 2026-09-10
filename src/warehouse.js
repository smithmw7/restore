import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createStorageCrateSpecs } from './storage-crates.js';

export const WAREHOUSE_BOUNDS = Object.freeze({ minX: -12, maxX: 12, minZ: -27, maxZ: 7 });

// One modest target per eye. The current Three Reflector maintains an individual
// reflection camera for each XR eye; reflection rendering does not update shadows.
const floorShader = {
  name: 'Restore / rough concrete reflection',
  uniforms: {
    ...THREE.UniformsLib.fog,
    color: { value: new THREE.Color('#96aaa8') }, tDiffuse: { value: null },
    textureMatrix: { value: new THREE.Matrix4() }, roughnessMap: { value: null },
    normalMap: { value: null },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vReflection;
    varying vec2 vFloorUv;
    varying float vGrazing;
    #include <common>
    #include <fog_pars_vertex>
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vReflection = textureMatrix * vec4(position, 1.0);
      // Match the concrete slab even though the reflection plane is inset.
      vFloorUv = (position.xy / vec2(24.0, 34.0) + 0.5) * vec2(12.0, 17.0);
      vec3 viewNormal = normalize(normalMatrix * normal);
      vGrazing = 1.0 - abs(dot(normalize(-mvPosition.xyz), viewNormal));
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D roughnessMap;
    uniform sampler2D normalMap;
    uniform vec3 color;
    varying vec4 vReflection;
    varying vec2 vFloorUv;
    varying float vGrazing;
    #include <common>
    #include <fog_pars_fragment>
    void main() {
      float grain = texture2D(roughnessMap, vFloorUv).g;
      vec2 grainNormal = texture2D(normalMap, vFloorUv).xy * 2.0 - 1.0;
      vec2 projected = vReflection.xy / vReflection.w;
      projected += grainNormal * .004;
      // A small cross filter softens the image without a second blur pass.
      float blur = mix(.002, .0045, grain);
      vec3 reflection = texture2D(tDiffuse, projected).rgb * .5;
      reflection += texture2D(tDiffuse, projected + vec2(blur, 0.0)).rgb * .125;
      reflection += texture2D(tDiffuse, projected - vec2(blur, 0.0)).rgb * .125;
      reflection += texture2D(tDiffuse, projected + vec2(0.0, blur)).rgb * .125;
      reflection += texture2D(tDiffuse, projected - vec2(0.0, blur)).rgb * .125;
      float opacity = (.18 + .3 * pow(vGrazing, 2.0)) * (1.0 - grain * .28);
      gl_FragColor = vec4(reflection * color, opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

export function createWarehouse({ scene, renderer, materials }) {
  const root = new THREE.Group();
  root.name = 'Warehouse';
  scene.add(root);
  scene.background = new THREE.Color('#182328');
  scene.fog = new THREE.FogExp2('#182328', .026);
  const bounds = { ...WAREHOUSE_BOUNDS };
  const obstacles = [];
  const ownedMaterials = new Set();
  const ownedTextures = new Set();
  const geometries = new Set();
  const box = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(box);
  const dummy = new THREE.Object3D();
  const batches = new Map();
  const localMat = (parameters) => {
    const result = new THREE.MeshStandardMaterial(parameters); ownedMaterials.add(result); return result;
  };
  const copyMat = (source, tint, repeat) => {
    const result = source.clone(); ownedMaterials.add(result);
    if (tint) result.color.set(tint);
    if (repeat) {
      const copies = new Map();
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (!result[key]) continue;
        if (!copies.has(result[key])) {
          const texture = result[key].clone(); texture.repeat.set(...repeat); texture.needsUpdate = true;
          ownedTextures.add(texture); copies.set(result[key], texture);
        }
        result[key] = copies.get(result[key]);
      }
    }
    return result;
  };
  const wallMat = copyMat(materials.concrete, '#687978', [4, 2]);
  wallMat.normalScale.setScalar(.28);
  const floorMat = copyMat(materials.concrete, '#80908b', [12, 17]);
  floorMat.roughness = 1;
  floorMat.normalScale.setScalar(.65);
  const beamMat = materials.metal;
  const ceilingMat = localMat({ color: '#313b40', roughness: .88, metalness: .3 });
  const seamMat = localMat({ color: '#343f3f', roughness: .98 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd7a2').multiplyScalar(3), toneMapped: false });
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8bbace').multiplyScalar(1.6), toneMapped: false });
  ownedMaterials.add(lampMat); ownedMaterials.add(windowMat);

  function addBox(material, position, scale, rotation = [0, 0, 0], tint) {
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push({ position, scale, rotation, tint });
  }
  function obstacle(position, size) {
    obstacles.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...position), new THREE.Vector3(...size)));
  }
  function beam(a, b, thickness, material = beamMat) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    dummy.position.copy(start).add(end).multiplyScalar(.5);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    const euler = new THREE.Euler().setFromQuaternion(dummy.quaternion);
    const length = new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
    addBox(material, dummy.position.toArray(), [thickness, length, thickness], euler.toArray().slice(0, 3));
  }

  // Sealed structural shell. All foreground work happens on the same flat floor.
  addBox(floorMat, [0, -.08, -10], [24, .12, 34]);
  addBox(wallMat, [-12.16, 4.5, -10], [.32, 9, 34]);
  addBox(wallMat, [12.16, 4.5, -10], [.32, 9, 34]);
  addBox(wallMat, [0, 4.5, -27.16], [24, 9, .32]);
  addBox(wallMat, [0, 4.5, 7.16], [24, 9, .32]);
  addBox(ceilingMat, [0, 9.08, -10], [24.6, .16, 34.6]);
  for (const x of [-12.05, 12.05]) obstacle([x, 4.5, -10], [.3, 9, 34.2]);
  for (const z of [-27.05, 7.05]) obstacle([0, 4.5, z], [24.2, 9, .3]);

  // Sparse floor joints make scale legible without a repeating decorative grid.
  for (let z = -26; z <= 6; z += 4) addBox(seamMat, [0, -.014, z], [23.9, .008, .014]);
  for (const x of [-8, -4, 4, 8]) addBox(seamMat, [x, -.014, -10], [.014, .008, 33.9]);

  for (let z = 4; z >= -24; z -= 7) {
    for (const sign of [-1, 1]) {
      const x = sign * 11.57;
      addBox(beamMat, [x, 4.45, z], [.32, 8.9, .42]);
      addBox(beamMat, [x, .12, z], [.62, .24, .7]);
      obstacle([x, 4.45, z], [.65, 8.9, .7]);
      beam([x, 6.3, z], [sign * 8.8, 8.45, z], .15);
      addBox(windowMat, [sign * 11.97, 6.55, z - 2.1], [.02, 1.18, 3.2]);
      for (const offset of [-1.06, 0, 1.06]) addBox(beamMat, [sign * 11.93, 6.55, z - 2.1 + offset], [.08, 1.3, .08]);
    }
    addBox(beamMat, [0, 8.58, z], [23.4, .27, .25]);
    addBox(beamMat, [0, 7.67, z], [22.8, .15, .18]);
    for (let x = -10; x < 10; x += 2.5) {
      beam([x, 7.67, z], [x + 1.25, 8.58, z], .075);
      beam([x + 1.25, 8.58, z], [x + 2.5, 7.67, z], .075);
    }
  }
  for (const x of [-8, -4, 0, 4, 8]) addBox(beamMat, [x, 8.83, -10], [.12, .15, 34]);

  // The back loading door is solid, with no signs or implied text affordances.
  addBox(beamMat, [0, 3.6, -26.85], [7.1, 7.2, .18]);
  for (let x = -3.3; x <= 3.4; x += .3) addBox(ceilingMat, [x, 3.55, -26.72], [.2, 7.1, .09]);
  addBox(beamMat, [0, 7.25, -26.55], [7.7, .32, .48]);

  // Gameplay owns every storage crate and its collider. Keeping only structural
  // obstacles here means removing a crate also clears its former standing space.
  const storageCrates = createStorageCrateSpecs();

  const lampPositions = [[0, 7.38, -2], [0, 7.38, -11], [0, 7.38, -20]];
  for (const [x, y, z] of lampPositions) {
    addBox(beamMat, [x, 8.2, z], [.035, 1.6, .035]);
    addBox(beamMat, [x, y + .1, z], [1.25, .18, .65]);
    addBox(lampMat, [x, y, z], [1.08, .045, .5]);
    const spot = new THREE.SpotLight('#ffd3a0', 430, 17, .73, .8, 2);
    spot.position.set(x, y - .1, z);
    spot.target.position.set(x, 0, z - .7);
    root.add(spot, spot.target);
  }
  const ambient = new THREE.HemisphereLight('#b7cbd7', '#554c3e', 1.35);
  const cold = new THREE.DirectionalLight('#a8ccdd', 1.6);
  cold.position.set(9, 8, -3);
  const warm = new THREE.DirectionalLight('#ffe0b4', 1.15);
  warm.position.set(-5, 7, 5);
  warm.target.position.set(0, 0, -7);
  warm.castShadow = true;
  warm.shadow.mapSize.set(1024, 1024);
  Object.assign(warm.shadow.camera, { left: -8, right: 8, top: 14, bottom: -10, near: .5, far: 45 });
  warm.shadow.normalBias = .055;
  warm.shadow.bias = -.00015;
  root.add(ambient, cold, warm, warm.target);

  for (const [material, instances] of batches) {
    const batch = new THREE.InstancedMesh(box, material, instances.length);
    batch.name = `Warehouse instances / ${material.name || material.type}`;
    batch.castShadow = ![floorMat, lampMat, windowMat, seamMat].includes(material);
    batch.receiveShadow = ![lampMat, windowMat].includes(material);
    for (let index = 0; index < instances.length; index++) {
      const value = instances[index];
      dummy.position.set(...value.position); dummy.rotation.set(...value.rotation); dummy.scale.set(...value.scale); dummy.updateMatrix();
      batch.setMatrixAt(index, dummy.matrix);
      if (value.tint) batch.setColorAt(index, value.tint);
    }
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    batch.computeBoundingSphere(); root.add(batch);
  }

  // Subtle real planar reflection over the lit concrete base. No refraction,
  // full-screen postprocessing, or additional shadow pass is required.
  const reflectorGeometry = new THREE.PlaneGeometry(23.98, 33.98);
  geometries.add(reflectorGeometry);
  const reflection = new Reflector(reflectorGeometry, {
    textureWidth: 256, textureHeight: 256, clipBias: .003, multisample: 0,
    color: '#adb9b4', shader: floorShader,
  });
  reflection.name = 'Warehouse planar floor reflection';
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.set(0, -.018, -10);
  reflection.material.uniforms.roughnessMap.value = materials.concrete.roughnessMap;
  reflection.material.uniforms.normalMap.value = materials.concrete.normalMap;
  reflection.material.transparent = true;
  reflection.material.depthWrite = false;
  reflection.material.fog = true;
  reflection.renderOrder = 1;
  root.add(reflection);

  // A tiny local environment map gives metal artifacts readable light bands.
  // It is generated from warehouse-colored practicals, not an external HDRI.
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color('#78878a');
  const environmentGeometry = new THREE.BoxGeometry(1, 1, 1);
  const environmentMaterials = [];
  for (const [position, scale, color, intensity] of [
    [[0, 5, -4], [2, .1, 6], '#ffd8ab', 5],
    [[-6, 3, 0], [.1, 3, 6], '#9dcce6', 2.8],
    [[6, 3, -3], [.1, 3, 6], '#9dcce6', 2.8],
    [[0, -4, 0], [20, .1, 20], '#3c342c', 1],
  ]) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
    environmentMaterials.push(material);
    const panel = new THREE.Mesh(environmentGeometry, material); panel.position.set(...position); panel.scale.set(...scale); environmentScene.add(panel);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(environmentScene, .07, .1, 40);
  scene.environment = environment.texture;
  scene.environmentIntensity = .55;
  generator.dispose(); environmentGeometry.dispose(); environmentMaterials.forEach((material) => material.dispose());

  const stats = { staticCrates: 0, storageCrates: storageCrates.length, instancedBatches: batches.size, staticInstances: [...batches.values()].reduce((sum, values) => sum + values.length, 0), reflectionResolution: 256, obstacleCount: obstacles.length };
  return {
    root, bounds, obstacles, storageCrates, stats,
    update() {},
    dispose() {
      root.removeFromParent();
      root.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
        if (object.isLight) object.shadow?.dispose();
      });
      reflection.dispose(); environment.dispose();
      if (scene.environment === environment.texture) scene.environment = null;
      geometries.forEach((geometry) => geometry.dispose());
      ownedMaterials.forEach((material) => material.dispose());
      ownedTextures.forEach((texture) => texture.dispose());
    },
  };
}
