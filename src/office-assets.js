import { Box3, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const OFFICE_ASSET_URL = `${import.meta.env?.BASE_URL || '/'}models/office/office-kit.glb`;
export const OFFICE_ASSET_NAMES = Object.freeze([
  'Desk', 'Drawer', 'Notebook', 'LockerShell', 'LockerDoor', 'Chair', 'Pen', 'Pencil', 'Logbook',
]);

/** One download supplies articulated templates; instances share GPU resources. */
export async function loadOfficeAssets({ url = OFFICE_ASSET_URL, loader = new GLTFLoader() } = {}) {
  const { scene: root } = await loader.loadAsync(url);
  const geometries = new Set(), materials = new Set(), textures = new Set(), instances = new Set();
  const templates = new Map();
  let meshes = 0, triangles = 0, disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    instances.forEach(instance => instance.removeFromParent());
    instances.clear();
    root?.removeFromParent();
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  }

  const parts = {};
  let metadata;
  try {
    if (!root?.isObject3D) throw new Error('Office asset has no scene.');
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (OFFICE_ASSET_NAMES.includes(object.name)) {
        if (templates.has(object.name)) throw new Error(`Office asset repeats template ${object.name}.`);
        templates.set(object.name, object);
      }
      if (!object.isMesh) return;
      meshes++;
      const geometry = object.geometry;
      if (geometry) geometries.add(geometry);
      const position = geometry?.attributes.position;
      if (!position || position.count < 3) throw new Error(`Office mesh ${object.name} has no surface.`);
      triangles += (geometry.index?.count ?? position.count) / 3;
      object.castShadow = true;
      object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) throw new Error(`Office mesh ${object.name} has no material.`);
        materials.add(material);
        for (const value of Object.values(material)) {
          if (!value?.isTexture) continue;
          value.anisotropy = 4;
          textures.add(value);
        }
      }
    });
    const kit = root.getObjectByName('OfficeKit');
    metadata = kit?.userData || root.userData;
    if (!kit || metadata.kitId !== 'restore-retro-office') throw new Error('Office asset is not the Restore office kit.');
    for (const name of OFFICE_ASSET_NAMES) {
      const template = templates.get(name);
      if (!template) throw new Error(`Office asset is missing ${name}.`);
      // Placement belongs to the game; exported roots carry no staging offsets.
      if (template.position.lengthSq() > 1e-10 || template.quaternion.angleTo({ x: 0, y: 0, z: 0, w: 1 }) > 1e-5 || template.scale.distanceTo(new Vector3(1, 1, 1)) > 1e-5) {
        throw new Error(`Office template ${name} has a nonidentity placement transform.`);
      }
      const inverse = new Matrix4().copy(template.matrixWorld).invert();
      const bounds = new Box3(), point = new Vector3(), relative = new Matrix4();
      let partMeshes = 0, partTriangles = 0;
      template.traverse(object => {
        if (!object.isMesh) return;
        partMeshes++;
        const geometry = object.geometry, position = geometry.attributes.position;
        partTriangles += (geometry.index?.count ?? position.count) / 3;
        relative.multiplyMatrices(inverse, object.matrixWorld);
        for (let index = 0; index < position.count; index++) {
          point.fromBufferAttribute(position, index).applyMatrix4(relative);
          if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`Office template ${name} has invalid geometry.`);
          bounds.expandByPoint(point);
        }
      });
      if (!partMeshes || bounds.isEmpty()) throw new Error(`Office template ${name} is empty.`);
      parts[name] = {
        meshes: partMeshes, triangles: partTriangles,
        bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      };
    }
    const cover = templates.get('Notebook').getObjectByName('NotebookCover');
    if (!cover || cover.position.distanceTo(new Vector3(-.215, .055, 0)) > .002) {
      throw new Error('Office notebook is missing its articulated cover hinge.');
    }
  } catch (error) {
    dispose();
    throw error;
  }

  const state = {
    loaded: true, error: null, url, version: metadata.assetVersion,
    meshes, triangles, materials: materials.size, textures: textures.size,
    materialNames: [...materials].map(material => material.name).filter(Boolean), parts,
  };
  return {
    state,
    create(name) {
      if (disposed) throw new Error('Office assets have already been disposed.');
      const template = templates.get(name);
      if (!template) throw new Error(`Unknown office asset: ${name}.`);
      const instance = template.clone(true);
      instance.visible = true;
      instance.userData.officeAsset = name;
      instances.add(instance);
      return instance;
    },
    dispose,
  };
}
