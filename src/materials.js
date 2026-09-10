import * as THREE from 'three';

const ASSET_BASE = import.meta.env?.BASE_URL || '/';

// Local, audited Sanctus surface samples. The source pixels are preserved in
// lossless WebP; see docs/warehouse-materials.json for hashes and qualifications.
const SOURCES = ['wood', 'concrete', 'ceramic', 'bronze', 'copper', 'gold', 'marble', 'stone'];

export async function loadWarehouseMaterials() {
  const loader = new THREE.TextureLoader();
  const materials = {};
  const textures = [];
  await Promise.all(SOURCES.map(async (name) => {
    const [map, orm, normalMap] = await Promise.all(['basecolor', 'orm', 'normal'].map(async (channel) => {
      const texture = await loader.loadAsync(`${ASSET_BASE}materials/${name}/${channel}.webp`);
      texture.colorSpace = channel === 'basecolor' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      // Mirrored repetition avoids a sharp discontinuity at the edge of these
      // surface samples. It does not turn them into certified seamless assets.
      texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
      texture.anisotropy = 4;
      textures.push(texture);
      return texture;
    }));
    const material = new THREE.MeshStandardMaterial({
      name: `Restore / ${name}`, color: 0xffffff, map, normalMap,
      roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1,
      envMapIntensity: 1,
    });
    material.userData.surface = name;
    materials[name] = material;
  }));
  materials.wood.color.set('#d5b688');
  materials.wood.normalScale.setScalar(.55);
  materials.woodInside = materials.wood.clone();
  materials.woodInside.name = 'Restore / fresh wood';
  materials.woodInside.color.set('#dfc6a0');
  materials.woodInside.roughnessMap = null;
  materials.woodInside.roughness = .94;
  materials.woodInside.normalScale.setScalar(.25);
  materials.concrete.normalScale.setScalar(.25);
  materials.ceramic.color.set('#c9d8d0');
  materials.ceramic.roughness = 1.2;
  materials.bronze.color.set('#b8aa79');
  materials.bronze.envMapIntensity = 1.35;
  materials.gold.roughness = 1.8;
  materials.marble.normalScale.setScalar(.6);
  materials.metal = new THREE.MeshStandardMaterial({
    name: 'Restore / warehouse iron', color: '#2b3439', metalness: .78,
    roughness: .56, envMapIntensity: .65,
  });
  materials.dispose = () => {
    Object.values(materials).filter((value) => value?.isMaterial).forEach((value) => value.dispose());
    textures.forEach((texture) => texture.dispose());
  };
  materials.stats = { sets: SOURCES.length, textures: textures.length, resolution: 512, bytes: 5140228 };
  return materials;
}
