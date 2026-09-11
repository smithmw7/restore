import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BRIEFCASE_ASSET_URL = `${import.meta.env?.BASE_URL || '/'}models/briefcase/briefcase.glb`;
const STEP = Math.PI * 2 / 10;

/** All ten numerals are geometry carried by each Blender-authored wheel. */
export async function loadBriefcaseAsset({ url = BRIEFCASE_ASSET_URL, loader = new GLTFLoader() } = {}) {
  const gltf = await loader.loadAsync(url), root = gltf.scene;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  let triangles = 0, meshes = 0, disposed = false;
  root.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) { value.anisotropy = 4; textures.add(value); }
    }
    object.castShadow = true; object.receiveShadow = true;
  });
  function dispose() {
    if (disposed) return;
    root.removeFromParent();
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(map => map.dispose());
    disposed = true;
  }
  function node(name, mesh = false) {
    const value = root.getObjectByName(name);
    if (!value || mesh && !value.isMesh) throw new Error(`Briefcase asset is missing ${name}.`);
    return value;
  }
  let lid, wheels, latches, metadata;
  try {
    metadata = node('Briefcase').userData;
    node('BodyStatic'); node('LidStatic'); lid = node('LidPivot');
    wheels = Array.from({ length: 4 }, (_, index) => node(`Wheel_${index}`));
    for (let index = 0; index < 4; index++) {
      const glyphs = node(`WheelNumerals_${index}`, true);
      if (!wheels[index].getObjectById(glyphs.id)) throw new Error(`Wheel ${index} does not carry its numeral geometry.`);
    }
    if (metadata.numeralGeometry !== true || metadata.numeralsPerWheel !== 10 || metadata.wheelNumerals !== '0123456789') throw new Error('Briefcase requires ten physical numerals on each wheel.');
    latches = ['L', 'R'].map(side => node(`LatchPivot_${side}`));
  } catch (error) { dispose(); throw error; }
  const wheelAngles = wheels.map(wheel => wheel.rotation.x), latchAngles = latches.map(latch => latch.rotation.x);
  const lastDigits = [0, 0, 0, 0], wheelSteps = [0, 0, 0, 0];
  const state = {
    loaded: true, error: null, url, version: metadata.assetVersion,
    meshes, triangles, materials: materials.size, textures: textures.size,
    physicalNumerals: true, numeralsPerWheel: 10, handle: false,
    embeddedMaterialNames: [...materials].map(material => material.name).filter(Boolean),
  };
  return {
    root, state, dispose,
    update({ lidAngle = 0, digits = lastDigits, open = false, wheelPositions = null, dt = 1 / 60, immediate = false } = {}) {
      if (disposed) return;
      lid.rotation.x = lidAngle;
      const blend = immediate ? 1 : 1 - Math.exp(-18 * Math.max(0, dt));
      wheels.forEach((wheel, index) => {
        // Direct continuous detent coordinates let a physical drag own the pose.
        // Integer puzzle callers retain the existing eased, wrapped motion.
        if (wheelPositions) { wheel.rotation.x = wheelAngles[index] - wheelPositions[index] * STEP; return; }
        const digit = digits[index];
        if (digit !== lastDigits[index]) {
          let advance = (digit - lastDigits[index] + 10) % 10;
          if (advance > 5) advance -= 10;
          wheelSteps[index] += advance; lastDigits[index] = digit;
        }
        const target = wheelAngles[index] - wheelSteps[index] * STEP;
        wheel.rotation.x += (target - wheel.rotation.x) * blend;
      });
      latches.forEach((latch, index) => {
        const target = latchAngles[index] + (open ? -1.08 : 0);
        latch.rotation.x += (target - latch.rotation.x) * blend;
      });
    },
  };
}
