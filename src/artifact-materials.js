import * as THREE from 'three';

// Shared nonverbal circuit markings. They follow the mesh UVs through fracture,
// so the luminous inlays stay attached to each recovered piece.
export function createAlienMaterials(materials) {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const band = (y >= 29 && y <= 31 || y >= 95 && y <= 97) && x % 32 < 23;
    const trace = x % 32 >= 11 && x % 32 <= 12 && y > 30 && y < 64;
    const node = x % 32 >= 9 && x % 32 <= 14 && y >= 61 && y <= 65;
    const index = (y * size + x) * 4, value = band || trace || node ? 255 : 0;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }
  const inlays = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  inlays.name = 'Alien circuit inlays';
  inlays.colorSpace = THREE.SRGBColorSpace;
  inlays.wrapS = inlays.wrapT = THREE.RepeatWrapping;
  inlays.magFilter = THREE.LinearFilter; inlays.minFilter = THREE.LinearMipmapLinearFilter;
  inlays.generateMipmaps = true; inlays.needsUpdate = true;
  const cache = new Map();
  return {
    get(spec) {
      if (spec.category !== 'alien') return materials[spec.materialKey];
      const key = `${spec.materialKey}:${spec.accent || '#72e8d5'}`;
      if (!cache.has(key)) {
        const material = materials[spec.materialKey]?.clone() || new THREE.MeshStandardMaterial({ color: '#7f9299', metalness: .82, roughness: .56 });
        material.name = `Alien ${key}`;
        material.emissive.set(spec.accent || '#72e8d5');
        material.emissiveMap = inlays; material.emissiveIntensity = 1.25;
        material.envMapIntensity = 1.25;
        cache.set(key, material);
      }
      return cache.get(key);
    },
    dispose() { for (const material of cache.values()) material.dispose(); inlays.dispose(); },
  };
}
