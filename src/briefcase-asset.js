import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BRIEFCASE_ASSET_URL = `${import.meta.env?.BASE_URL || '/'}models/briefcase/briefcase.glb`;
const STEP = Math.PI * 2 / 10;

/** The Blender hierarchy is also the runtime articulation contract. */
export async function loadBriefcaseAsset({ url = BRIEFCASE_ASSET_URL, digitMaps = [], loader = new GLTFLoader() } = {}) {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
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
    object.castShadow = true;
    object.receiveShadow = true;
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
  let lid, wheels, displays, latches;
  try {
    node('Briefcase'); node('BodyStatic'); node('LidStatic');
    lid = node('LidPivot');
    wheels = Array.from({ length: 4 }, (_, index) => node(`Wheel_${index}`));
    displays = Array.from({ length: 4 }, (_, index) => node(`NumberDisplay_${index}`, true));
    latches = ['L', 'R'].map(side => node(`LatchPivot_${side}`));
  } catch (error) { dispose(); throw error; }
  const wheelAngles = wheels.map(wheel => wheel.rotation.x);
  const latchAngles = latches.map(latch => latch.rotation.x);
  const lastDigits = [0, 0, 0, 0], wheelSteps = [0, 0, 0, 0];
  const sourceMaps = [...digitMaps];
  function displayMap(source) {
    if (!source) return null;
    const map = source.clone();
    // glTF flips its UV convention on export. Keep the fallback canvas's usual
    // orientation unchanged and give the imported readout its own GPU texture.
    map.flipY = false; map.anisotropy = 4; map.needsUpdate = true; textures.add(map);
    return map;
  }
  const displayMaterials = displays.map((display, index) => {
    // The readable numeral lives on Blender's recessed readout, not an extra
    // plane floating over the finished model. Puzzle code owns these maps.
    const material = new THREE.MeshStandardMaterial({ map: displayMap(digitMaps[index]), color: '#ffffff', roughness: .67, metalness: .04 });
    display.material = material; materials.add(material); return material;
  });
  const state = {
    loaded: true, error: null, url, version: root.getObjectByName('Briefcase').userData.assetVersion || gltf.asset?.version || '1',
    meshes, triangles, materials: materials.size, textures: textures.size,
    embeddedMaterialNames: [...materials].map(material => material.name).filter(Boolean),
  };
  return {
    root, state, dispose,
    update({ lidAngle = 0, digits = lastDigits, open = false, maps = digitMaps, dt = 1 / 60, immediate = false } = {}) {
      if (disposed) return;
      lid.rotation.x = lidAngle;
      const blend = immediate ? 1 : 1 - Math.exp(-22 * Math.max(0, dt));
      wheels.forEach((wheel, index) => {
        const digit = digits[index];
        if (digit !== lastDigits[index]) {
          let advance = (digit - lastDigits[index] + 10) % 10;
          if (advance > 5) advance -= 10;
          wheelSteps[index] += advance;
          lastDigits[index] = digit;
        }
        wheel.rotation.x = THREE.MathUtils.lerp(wheel.rotation.x, wheelAngles[index] - wheelSteps[index] * STEP, blend);
        if (sourceMaps[index] !== maps[index]) {
          const old = displayMaterials[index].map;
          displayMaterials[index].map = displayMap(maps[index]); displayMaterials[index].needsUpdate = true;
          old?.dispose(); textures.delete(old); sourceMaps[index] = maps[index];
        }
      });
      latches.forEach((latch, index) => {
        latch.rotation.x = THREE.MathUtils.lerp(latch.rotation.x, latchAngles[index] + (open ? -1.08 : 0), blend);
      });
    },
  };
}
