import * as THREE from 'three';

const COLLECTION = new THREE.Box3(new THREE.Vector3(-12.3, 0, -26.4), new THREE.Vector3(12.3, 29, 7.3));
const DEFAULT_BOUNDS = { minX: -48, maxX: 48, minZ: -166, maxZ: 14 };
const PALETTE = ['#6d796b', '#657582', '#6a7477', '#847666', '#8d7060', '#73796a', '#566b72'];

// Sealed archive freight is scenery. A stack has one fixed collider regardless
// of how many metal cases it contains; the nearby wooden collection remains live.
export function createMetalStorageSpecs(bounds = DEFAULT_BOUNDS) {
  let seed = 0x75b31ad;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stacks = [];
  for (const sign of [-1, 1]) {
    for (const column of [7.5, 12.75, 22, 28, 38, 43.75]) {
      for (let row = 0; row < 28; row++) {
        // A full-width cross aisle every 24 metres breaks up the long shelves.
        if (row > 0 && row % 4 === 0) continue;
        const x = sign * column, z = 2 - row * 6;
        const width = 3.35 + random() * 1.15, depth = 3.55 + random() * 1.15;
        const footprint = new THREE.Box3(
          new THREE.Vector3(x - width / 2 - .08, 0, z - depth / 2 - .08),
          new THREE.Vector3(x + width / 2 + .08, 28, z + depth / 2 + .08),
        );
        if (footprint.intersectsBox(COLLECTION)) continue;
        if (footprint.min.x < bounds.minX + 1 || footprint.max.x > bounds.maxX - 1
          || footprint.min.z < bounds.minZ + 1 || footprint.max.z > bounds.maxZ - 1) continue;
        const tierCount = random() < .18 ? 2 + Math.floor(random() * 2) : 4 + Math.floor(random() * 3);
        const stack = { id: `sealed-archive-${stacks.length + 1}`, x, z, width, depth, cases: [] };
        let y = 0;
        const tintIndex = Math.floor(random() * PALETTE.length);
        for (let tier = 0; tier < tierCount; tier++) {
          const height = 1.28 + random() * .75;
          const inset = tier * .022;
          const tint = new THREE.Color(PALETTE[(tintIndex + (random() < .23 ? 2 : 0)) % PALETTE.length]);
          tint.multiplyScalar(.86 + random() * .25);
          stack.cases.push({
            id: `${stack.id}-${tier + 1}`, x, y: y + height / 2, z,
            width: width - inset * 2, height, depth: depth - inset * 2,
            tint, tier, breakable: false, material: 'metal',
          });
          y += height + .045;
        }
        stack.height = y - .045;
        footprint.max.y = stack.height;
        stack.obstacle = footprint;
        stacks.push(stack);
      }
    }
  }
  return stacks;
}

// Small procedural surface maps provide pressed ribs and worn paint without
// loading another texture set or adding geometry for every sheet-metal groove.
function createCaseTextures() {
  const size = 128, color = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  let seed = 91317;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const height = (x) => Math.pow(.5 + .5 * Math.cos(x / size * Math.PI * 12), 5) * .09;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const groove = height(x), dust = random() * 12;
      const wear = (x < 3 || x > size - 4 || y < 2 || y > size - 3) ? 15 : 0;
      const value = Math.round(216 + groove * 180 - dust + wear);
      color[offset] = color[offset + 1] = color[offset + 2] = Math.min(255, value);
      color[offset + 3] = 255;
      const nx = -(height(x + 1) - height(x - 1)) * 15;
      const nz = 1 / Math.sqrt(1 + nx * nx);
      normal[offset] = Math.round((nx * nz * .5 + .5) * 255);
      normal[offset + 1] = 128;
      normal[offset + 2] = Math.round((nz * .5 + .5) * 255);
      normal[offset + 3] = 255;
    }
  }
  const make = (pixels, colorSpace) => {
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: make(color, THREE.SRGBColorSpace), normalMap: make(normal, THREE.NoColorSpace) };
}

export function createMetalStorage({ scene, materials, bounds = DEFAULT_BOUNDS }) {
  const root = new THREE.Group();
  root.name = 'Sealed metal archive';
  root.userData.breakable = false;
  const stacks = createMetalStorageSpecs(bounds), obstacles = stacks.map((stack) => stack.obstacle);
  const textures = createCaseTextures();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    name: 'Restore / worn enamel cargo cases', color: '#ffffff',
    map: textures.map, normalMap: textures.normalMap, normalScale: new THREE.Vector2(.65, .65),
    metalness: .55, roughness: .73, envMapIntensity: .45,
  });
  const frameMaterial = materials.metal.clone();
  frameMaterial.name = 'Restore / archive reinforced edges';
  frameMaterial.color.set('#aeb4af');
  frameMaterial.roughness = .57;
  frameMaterial.envMapIntensity = .55;
  const hardwareMaterial = materials.metal.clone();
  hardwareMaterial.name = 'Restore / archive locking hardware';
  hardwareMaterial.color.set('#b5a783');
  hardwareMaterial.roughness = .47;
  hardwareMaterial.envMapIntensity = .65;
  const materialsOwned = [bodyMaterial, frameMaterial, hardwareMaterial];
  const geometry = new THREE.BoxGeometry(1, 1, 1), transform = new THREE.Object3D();
  const batches = [[], [], []];
  const put = (batch, x, y, z, w, h, d, tint) => batches[batch].push({ x, y, z, w, h, d, tint });
  let cases = 0;
  for (const stack of stacks) {
    for (const item of stack.cases) {
      cases++;
      const { x, y, z, width: w, height: h, depth: d, tint } = item;
      const dark = tint.clone().multiplyScalar(.66);
      put(0, x, y, z, w, h, d, tint);
      // Four reinforced corner posts and upper/lower rails on both broad faces.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          put(1, x + sx * (w / 2 - .045), y, z + sz * (d / 2 - .025), .14, h + .035, .16, dark);
        }
      }
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          put(1, x, y + sy * (h / 2 - .075), z + sz * (d / 2 + .016), w + .07, .14, .09, dark);
        }
      }
      // Raised brass locking dogs make these read as sealed industrial cases.
      for (const sx of [-1, 1]) {
        put(2, x + sx * w * .28, y + h * .24, z + d / 2 + .075, .105, .22, .07, tint);
      }
    }
  }
  for (let index = 0; index < batches.length; index++) {
    const entries = batches[index];
    const mesh = new THREE.InstancedMesh(geometry, materialsOwned[index], entries.length);
    mesh.name = ['Archive / painted cases', 'Archive / steel reinforcement', 'Archive / locking dogs'][index];
    mesh.userData.kind = 'sealed-metal-storage';
    mesh.userData.breakable = false;
    // Dense distant scenery receives the existing light/shadow treatment but
    // never adds another shadow rendering pass or individual physics bodies.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let instance = 0; instance < entries.length; instance++) {
      const item = entries[instance];
      transform.position.set(item.x, item.y, item.z);
      transform.scale.set(item.w, item.h, item.d);
      transform.updateMatrix();
      mesh.setMatrixAt(instance, transform.matrix);
      mesh.setColorAt(instance, item.tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  scene.add(root);
  const stats = {
    crates: cases, metalCrates: cases, stacks: stacks.length, colliders: obstacles.length,
    batches: batches.length, instancedBatches: batches.length,
    instances: batches.reduce((sum, entries) => sum + entries.length, 0),
    breakable: false, maxHeight: Math.max(...stacks.map((stack) => stack.height), 0),
  };
  let disposed = false;
  return {
    root, obstacles, stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const batch of root.children) batch.dispose();
      geometry.dispose();
      for (const material of materialsOwned) material.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
      root.clear();
    },
  };
}
