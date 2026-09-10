import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createStorageCrateSpecs } from './storage-crates.js';
import { createHangingLights } from './hanging-lights.js';

export const ARCHIVE_DIMENSIONS = Object.freeze({ width: 96, depth: 180, height: 28, centerZ: -76 });
export const WAREHOUSE_BOUNDS = Object.freeze({ minX: -48, maxX: 48, minZ: -166, maxZ: 14 });
const COLUMN_X = [-47.35, -33.5, -17.5, 17.5, 33.5, 47.35];
const COLUMN_Z = Array.from({ length: 15 }, (_, index) => 8 - index * 12);

// Share the actual column clearance with layout/navigation checks without
// requiring a WebGL renderer to construct the full hall and its reflection.
export function getArchiveColumnObstacles() {
  return COLUMN_Z.flatMap((z) => COLUMN_X.map((x) => new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(x, 13.85, z), new THREE.Vector3(.8, 27.7, .85),
  )));
}

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
      vFloorUv = (position.xy / vec2(96.0, 180.0) + 0.5) * vec2(48.0, 90.0);
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

export function createWarehouse({ scene, renderer, materials, onEvent }) {
  const root = new THREE.Group();
  root.name = 'The grand archive';
  scene.add(root);
  scene.background = new THREE.Color('#2b2c29');
  scene.fog = new THREE.FogExp2('#2b2c29', .0118);
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
  const wallMat = copyMat(materials.concrete, '#514f45', [16, 7]);
  wallMat.normalScale.setScalar(.28);
  const floorMat = copyMat(materials.concrete, '#7b8476', [48, 90]);
  floorMat.roughness = 1;
  floorMat.normalScale.setScalar(.65);
  const beamMat = copyMat(materials.metal, '#514f45');
  beamMat.roughness = .72;
  const ceilingMat = localMat({ color: '#25312f', roughness: .94, metalness: .22 });
  const seamMat = localMat({ color: '#323e39', roughness: .98 });
  const vaultMat = localMat({ color: '#253c3d', roughness: .62, metalness: .52 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc17c').multiplyScalar(2.2), toneMapped: false });
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#babba8').multiplyScalar(1.05), toneMapped: false });
  const farLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dcb181').multiplyScalar(1.15), toneMapped: false });
  ownedMaterials.add(lampMat); ownedMaterials.add(windowMat); ownedMaterials.add(farLampMat);

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

  // A sealed hall with real metric dimensions. The original collection remains
  // near the entrance; the roof and repeated portal frames carry its scale.
  const { width, depth, height, centerZ } = ARCHIVE_DIMENSIONS;
  addBox(floorMat, [0, -.08, centerZ], [width, .12, depth]);
  addBox(wallMat, [-48.2, 14, centerZ], [.4, height, depth]);
  addBox(wallMat, [48.2, 14, centerZ], [.4, height, depth]);
  addBox(wallMat, [0, 14, -166.2], [width, height, .4]);
  addBox(wallMat, [0, 14, 14.2], [width, height, .4]);
  addBox(ceilingMat, [0, 28.15, centerZ], [96.8, .3, 180.8]);
  for (const x of [-48.05, 48.05]) obstacle([x, 14, centerZ], [.3, height, depth + .2]);
  for (const z of [-166.05, 14.05]) obstacle([0, 14, z], [width + .2, height, .3]);

  // Four-meter concrete pours and wider expansion joints stay at human scale.
  for (let z = -162; z <= 10; z += 4) addBox(seamMat, [0, -.014, z], [95.9, .008, .012]);
  for (let x = -44; x <= 44; x += 4) addBox(seamMat, [x, -.014, centerZ], [.012, .008, 179.9]);

  // Open middle aisles, with tall portal columns between the storage lanes.
  // All columns have actual locomotion and rigid-body obstacles.
  obstacles.push(...getArchiveColumnObstacles().map(box => Object.assign(box, { audioSurface: 'metal' })));
  for (const z of COLUMN_Z) {
    for (const x of COLUMN_X) {
      addBox(beamMat, [x, 13.8, z], [.4, 27.6, .52]);
      addBox(beamMat, [x, .2, z], [.8, .4, .85]);
      addBox(beamMat, [x, 26.55, z], [.84, .42, .85]);
      for (const sign of [-1, 1]) {
        if (Math.abs(x + sign * 2.8) < 47.5) beam([x, 22.7, z], [x + sign * 2.8, 26.35, z], .18);
      }
    }
    addBox(beamMat, [0, 27.15, z], [95.2, .34, .3]);
    addBox(beamMat, [0, 24.9, z], [94.9, .2, .22]);
    for (let x = -47; x < 47; x += 4) {
      beam([x, 24.9, z], [x + 2, 27.15, z], .105);
      beam([x + 2, 27.15, z], [Math.min(x + 4, 47), 24.9, z], .105);
    }
    // Muted clerestory glass makes both distant side walls feel enclosed.
    for (const sign of [-1, 1]) {
      const wx = sign * 47.96;
      addBox(windowMat, [wx, 22.5, z - 4.4], [.025, 2.35, 7.5]);
      addBox(beamMat, [sign * 47.9, 21.2, z - 4.4], [.22, .2, 8]);
      addBox(beamMat, [sign * 47.9, 23.8, z - 4.4], [.22, .2, 8]);
      for (const offset of [-3.7, -1.85, 0, 1.85, 3.7]) {
        addBox(beamMat, [sign * 47.88, 22.5, z - 4.4 + offset], [.18, 2.5, .1]);
      }
      // Low wall plinths and slender vertical ribs break up the concrete shell.
      addBox(vaultMat, [sign * 47.96, 2.1, z - 4], [.12, 4.2, 7.4]);
    }
  }
  for (let x = -42; x <= 42; x += 7) addBox(beamMat, [x, 27.62, centerZ], [.18, .2, depth]);

  // A distant solid archive door gives the long central perspective an endpoint.
  addBox(vaultMat, [0, 7.5, -165.78], [13, 15, .24]);
  for (const x of [-6.8, 6.8]) addBox(beamMat, [x, 8, -165.55], [.6, 16, .55]);
  addBox(beamMat, [0, 15.8, -165.55], [14.2, .6, .55]);
  for (let x = -5.8; x <= 5.8; x += .65) addBox(ceilingMat, [x, 7.45, -165.6], [.12, 14.9, .14]);
  for (const z of [13.75, -165.4]) {
    addBox(windowMat, [0, 19.7, z], [15, .7, .06]);
    for (const x of [-6, -3, 0, 3, 6]) addBox(beamMat, [x, 19.7, z + (z > 0 ? -.05 : .05)], [.1, 1, .12]);
  }

  // Gameplay retains the original wood collection and owns its colliders.
  const storageCrates = createStorageCrateSpecs();
  const atmosphereLights = [];
  const addAtmosphereLight = (source, target, startRadius, endRadius, color, density) => {
    atmosphereLights.push({ source: new THREE.Vector3(...source), target: new THREE.Vector3(...target), startRadius, endRadius, color, density });
  };
  const fixtures = [];
  const pendant = (x, z, lit = false) => fixtures.push({
    id: `hanging-light-${String(fixtures.length + 1).padStart(2, '0')}`,
    x, z, y: 10.4, anchorY: 27.6, lit,
  });
  for (const z of [-2, -13, -26]) pendant(0, z, true);
  for (let z = -38; z >= -158; z -= 12) {
    for (const x of [-24, 0, 24]) pendant(x, z);
  }
  const hangingLights = createHangingLights({
    parent: root, fixtures, housingMaterial: beamMat,
    diffuserMaterial: lampMat, farDiffuserMaterial: farLampMat, onEvent,
  });
  atmosphereLights.push(...hangingLights.atmosphereLights);
  for (const x of [-24, 24]) {
    for (const z of [-14, -50, -86, -122]) {
      addBox(windowMat, [x, 27.78, z], [2.4, .045, 8]);
      for (const offset of [-4, -2, 0, 2, 4]) addBox(beamMat, [x, 27.71, z + offset], [2.6, .12, .12]);
      addAtmosphereLight([x, 27.72, z], [x * .64, .2, z + 7], 1.15, 4, '#b6baa5', .025);
    }
  }
  for (const z of [-43, -79, -115, -151]) {
    addBox(windowMat, [0, 27.78, z], [3, .045, 10]);
    for (const offset of [-5, -2.5, 0, 2.5, 5]) addBox(beamMat, [0, 27.71, z + offset], [3.2, .12, .12]);
    addAtmosphereLight([0, 27.72, z], [4, .2, z + 8], 1.3, 3.8, '#bdb9a3', .022);
  }

  const ambient = new THREE.HemisphereLight('#c2bba7', '#594331', .4);
  const cold = new THREE.DirectionalLight('#b9c2b5', .68);
  cold.position.set(28, 27, -35);
  cold.target.position.set(-5, 0, -15);
  const warm = new THREE.DirectionalLight('#ffc184', 1.5);
  warm.position.set(-9, 18, 9);
  warm.target.position.set(0, 0, -10);
  warm.castShadow = true;
  warm.shadow.mapSize.set(1024, 1024);
  // Keep the only shadow map concentrated on the reachable first collection.
  Object.assign(warm.shadow.camera, { left: -17, right: 17, top: 22, bottom: -14, near: .5, far: 65 });
  warm.shadow.normalBias = .055;
  warm.shadow.bias = -.00015;
  root.add(ambient, cold, cold.target, warm, warm.target);

  for (const [material, instances] of batches) {
    const batch = new THREE.InstancedMesh(box, material, instances.length);
    batch.name = `Warehouse instances / ${material.name || material.type}`;
    batch.castShadow = ![floorMat, lampMat, farLampMat, windowMat, seamMat].includes(material);
    batch.receiveShadow = ![lampMat, farLampMat, windowMat].includes(material);
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
  const reflectorGeometry = new THREE.PlaneGeometry(95.98, 179.98);
  geometries.add(reflectorGeometry);
  const reflection = new Reflector(reflectorGeometry, {
    textureWidth: 256, textureHeight: 256, clipBias: .003, multisample: 0,
    color: '#adb9b4', shader: floorShader,
  });
  reflection.name = 'Warehouse planar floor reflection';
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.set(0, -.018, centerZ);
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
  environmentScene.background = new THREE.Color('#69675b');
  const environmentGeometry = new THREE.BoxGeometry(1, 1, 1);
  const environmentMaterials = [];
  for (const [position, scale, color, intensity] of [
    [[0, 5, -4], [2, .1, 6], '#ffcc93', 4.3],
    [[-6, 3, 0], [.1, 3, 6], '#b8c2b4', 2.3],
    [[6, 3, -3], [.1, 3, 6], '#b8c2b4', 2.3],
    [[0, -4, 0], [20, .1, 20], '#3c342c', 1],
  ]) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
    environmentMaterials.push(material);
    const panel = new THREE.Mesh(environmentGeometry, material); panel.position.set(...position); panel.scale.set(...scale); environmentScene.add(panel);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(environmentScene, .07, .1, 40);
  scene.environment = environment.texture;
  scene.environmentIntensity = .26;
  generator.dispose(); environmentGeometry.dispose(); environmentMaterials.forEach((material) => material.dispose());

  const stats = { dimensions: { ...ARCHIVE_DIMENSIONS }, volumeCubicMeters: width * depth * height, atmosphereLights: atmosphereLights.length, hangingLights: fixtures.length, realSpotlights: 3, shadowMaps: 1, staticCrates: 0, storageCrates: storageCrates.length, instancedBatches: batches.size, staticInstances: [...batches.values()].reduce((sum, values) => sum + values.length, 0), reflectionResolution: 256, obstacleCount: obstacles.length };
  return {
    root, bounds, obstacles, storageCrates, atmosphereLights, hangingLights, stats,
    update(dt) { hangingLights.step(dt); },
    dispose() {
      hangingLights.dispose();
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
