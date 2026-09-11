import * as THREE from 'three';

// The opening fits inside the existing archive. All coordinates are world metres;
// its two rooms deliberately leave the main x=-2..2 entrance aisle unobstructed.
export function createOpeningEnvironment({ scene, materials = {} }) {
  const root = new THREE.Group();
  root.name = 'Restore / front office and restoration workshop';
  scene.add(root);
  const obstacles = [];
  const ownedMaterials = new Set();
  const ownedTextures = new Set();
  const geometries = new Set();
  const batches = new Map();
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const lampShade = new THREE.CylinderGeometry(.64, 1, 1, 16, 1, true);
  geometries.add(unitBox); geometries.add(unitCylinder); geometries.add(lampShade);

  function ownMaterial(parameters, source) {
    const material = source?.clone() || new THREE.MeshStandardMaterial();
    material.setValues(parameters);
    ownedMaterials.add(material);
    return material;
  }
  // One small generated paint surface, no new asset request and no DOM dependency.
  const paintPixels = new Uint8Array(128 * 128 * 4);
  let randomState = 0x61ac2f3;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const grain = random();
      const stain = Math.sin(x * .061 + Math.sin(y * .097)) * Math.cos(y * .045);
      const shade = Math.round(228 + grain * 17 + stain * 8 - (grain < .025 ? 35 : 0));
      const offset = (y * 128 + x) * 4;
      paintPixels[offset] = shade;
      paintPixels[offset + 1] = shade;
      paintPixels[offset + 2] = shade;
      paintPixels[offset + 3] = 255;
    }
  }
  const paintTexture = new THREE.DataTexture(paintPixels, 128, 128);
  paintTexture.colorSpace = THREE.SRGBColorSpace;
  paintTexture.wrapS = paintTexture.wrapT = THREE.RepeatWrapping;
  paintTexture.magFilter = THREE.LinearFilter;
  paintTexture.minFilter = THREE.LinearMipmapLinearFilter;
  paintTexture.generateMipmaps = true;
  paintTexture.needsUpdate = true;
  ownedTextures.add(paintTexture);

  const plaster = ownMaterial({ name: 'Opening / aged plaster', color: '#b4ad8c', map: paintTexture, roughness: .97 });
  const greenPaint = ownMaterial({ name: 'Opening / worn enamel', color: '#4d6257', map: paintTexture, roughness: .88 });
  const workshopPaint = ownMaterial({ name: 'Opening / workshop enamel', color: '#5f6860', map: paintTexture, roughness: .92 });
  const ceiling = ownMaterial({ name: 'Opening / roof underside', color: '#62625a', roughness: .95 });
  const iron = ownMaterial({ name: 'Opening / blackened steel', color: '#343a36', metalness: .64, roughness: .69 });
  const wornSteel = ownMaterial({ name: 'Opening / aged steel', color: '#7b8076', metalness: .65, roughness: .62 });
  const brass = ownMaterial({ name: 'Opening / hardware', color: '#9c8358', metalness: .7, roughness: .48 });
  const wood = ownMaterial({ name: 'Opening / oak furniture', color: '#bd9866', roughness: .86, metalness: 0 }, materials.wood);
  const darkWood = ownMaterial({ name: 'Opening / end grain', color: '#6a4b31', roughness: .95, metalness: 0 }, materials.wood);
  const paper = ownMaterial({ name: 'Opening / paper edges', color: '#baad86', roughness: 1 });
  const bookMaterials = ['#634c36', '#43534a', '#535961', '#6c4a3f'].map((color, index) => ownMaterial({ name: `Opening / notebook cover ${index}`, color, roughness: .96 }));
  const leather = ownMaterial({ name: 'Opening / worn seat', color: '#453e2c', roughness: .96 });
  const glass = ownMaterial({ name: 'Opening / wired glass', color: '#9ba89c', roughness: .28, metalness: .04, transparent: true, opacity: .13, depthWrite: false });
  const lampGreen = ownMaterial({ name: 'Opening / green task shade', color: '#3e6759', roughness: .38, metalness: .32, side: THREE.DoubleSide });
  const luminous = new THREE.MeshBasicMaterial({ name: 'Opening / warm bulbs', color: new THREE.Color('#ffd6a0').multiplyScalar(1.8), toneMapped: false });
  ownedMaterials.add(luminous);

  function instance(geometry, material, position, size, rotation = [0, 0, 0]) {
    const key = `${geometry.uuid}:${material.uuid}`;
    if (!batches.has(key)) batches.set(key, { geometry, material, values: [] });
    batches.get(key).values.push({ position, size, rotation });
  }
  const box = (material, position, size, rotation) => instance(unitBox, material, position, size, rotation);
  function collider(position, size, surface = 'metal', rotation = [0, 0, 0]) {
    // The physical and navigation systems use world-aligned boxes. Rotated small
    // details stay decorative; major furniture and every wall remain axis aligned.
    const bounds = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...position), new THREE.Vector3(...size));
    if (rotation.some(value => value !== 0)) {
      dummy.position.set(...position); dummy.scale.set(1, 1, 1); dummy.rotation.set(...rotation); dummy.updateMatrix();
      bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(...size)).applyMatrix4(dummy.matrix);
    }
    bounds.audioSurface = surface;
    obstacles.push(bounds);
    return bounds;
  }
  function solid(material, position, size, surface = 'metal') {
    box(material, position, size);
    collider(position, size, surface);
  }
  function rod(material, start, end, radius) {
    const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end);
    const middle = from.clone().add(to).multiplyScalar(.5);
    const length = from.distanceTo(to);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
    const rotation = new THREE.Euler().setFromQuaternion(quaternion);
    instance(unitCylinder, material, middle.toArray(), [radius, length, radius], [rotation.x, rotation.y, rotation.z]);
  }
  function disc(material, position, radius, height, rotation) {
    instance(unitCylinder, material, position, [radius, height, radius], rotation);
  }

  // A segment may run along X or Z. Full-height collision includes the glazing,
  // while actual doorway gaps receive only a high transom and separate jambs.
  function partition({ axis, at, start, end, window = false, paint = greenPaint }) {
    const length = end - start, middle = (start + end) / 2;
    const position = y => axis === 'x' ? [middle, y, at] : [at, y, middle];
    const size = (height, thickness = .12) => axis === 'x' ? [length, height, thickness] : [thickness, height, length];
    solid(paint, position(.56), size(1.12), 'concrete');
    if (window) {
      box(glass, position(1.9), size(1.49, .018));
      collider(position(1.9), size(1.56, .07), 'glass');
      box(iron, position(1.12), size(.065, .16));
      box(iron, position(2.68), size(.065, .16));
      const panes = Math.ceil(length / 1.18);
      for (let i = 0; i <= panes; i++) {
        const along = start + (i / panes) * length;
        box(iron, axis === 'x' ? [along, 1.91, at] : [at, 1.91, along], axis === 'x' ? [.045, 1.57, .15] : [.15, 1.57, .045]);
      }
      solid(plaster, position(2.98), size(.59), 'concrete');
    } else {
      solid(plaster, position(2.19), size(2.14), 'concrete');
    }
    box(iron, position(.065), size(.13, .15));
    box(iron, position(3.255), size(.09, .17));
    box(paint, position(1.115), size(.025, .145));
  }
  function doorway(axis, at, start, end) {
    const center = (start + end) / 2, width = end - start;
    for (const along of [start, end]) {
      const p = axis === 'x' ? [along, 1.24, at] : [at, 1.24, along];
      const s = axis === 'x' ? [.075, 2.48, .2] : [.2, 2.48, .075];
      solid(iron, p, s);
    }
    solid(iron, axis === 'x' ? [center, 2.47, at] : [at, 2.47, center], axis === 'x' ? [width, .09, .2] : [.2, .09, width]);
    box(glass, axis === 'x' ? [center, 2.865, at] : [at, 2.865, center], axis === 'x' ? [width, .66, .025] : [.025, .66, width]);
    collider(axis === 'x' ? [center, 2.92, at] : [at, 2.92, center], axis === 'x' ? [width, .78, .12] : [.12, .78, width], 'glass');
    box(iron, axis === 'x' ? [center, 3.255, at] : [at, 3.255, center], axis === 'x' ? [width, .09, .18] : [.18, .09, width]);
  }

  partition({ axis: 'x', at: 6, start: 2, end: 5, window: true });
  doorway('x', 6, 5, 7);
  partition({ axis: 'x', at: 6, start: 7, end: 12, window: true });
  partition({ axis: 'z', at: 2, start: 6, end: 9, window: true });
  doorway('z', 2, 9, 11);
  partition({ axis: 'z', at: 2, start: 11, end: 13.4 });
  partition({ axis: 'z', at: 12, start: 6, end: 13.4 });
  partition({ axis: 'x', at: 13.4, start: 2, end: 12 });
  partition({ axis: 'x', at: 7, start: -12, end: -8, window: true, paint: workshopPaint });
  doorway('x', 7, -8, -6);
  partition({ axis: 'x', at: 7, start: -6, end: -2, window: true, paint: workshopPaint });
  partition({ axis: 'z', at: -2, start: 7, end: 9, window: true, paint: workshopPaint });
  doorway('z', -2, 9, 11);
  partition({ axis: 'z', at: -2, start: 11, end: 13.4, paint: workshopPaint });
  partition({ axis: 'z', at: -12, start: 7, end: 13.4, paint: workshopPaint });
  partition({ axis: 'x', at: 13.4, start: -12, end: -2, paint: workshopPaint });

  for (const [x, z, depth] of [[7, 9.7, 7.4], [-7, 10.2, 6.4]]) {
    solid(ceiling, [x, 3.34, z], [10.12, .08, depth + .12], 'concrete');
    for (let offset = -4; offset <= 4; offset += 2) box(iron, [x + offset, 3.26, z], [.06, .1, depth]);
    for (const offset of [-1.9, 1.9]) {
      box(iron, [x + offset, 3.16, z], [1.34, .08, .34]);
      box(luminous, [x + offset, 3.109, z], [1.12, .015, .23]);
      for (let i = -4; i <= 4; i++) box(iron, [x + offset + i * .12, 3.089, z], [.018, .035, .28]);
    }
    // Exposed conduit follows the room perimeter; it never crosses a doorway.
    rod(wornSteel, [x - 4.8, 3.08, z - depth / 2 + .18], [x + 4.8, 3.08, z - depth / 2 + .18], .025);
  }

  // Desk puzzle mounts are deliberately clear: notebook at (7,.99,8.1),
  // briefcase at (6.15,1,8.15), and the movable drawer at (7,.7,8.62).
  solid(wood, [7, .9, 8.1], [2.6, .12, .95], 'wood');
  box(darkWood, [7, .84, 8.1], [2.65, .025, .98]);
  for (const x of [5.84, 8.16]) for (const z of [7.75, 8.45]) {
    solid(darkWood, [x, .415, z], [.13, .83, .13], 'wood');
    box(brass, [x, .095, z], [.14, .14, .14]);
  }
  solid(wood, [7, .69, 7.74], [2.36, .27, .08], 'wood');
  for (const x of [5.94, 8.06]) solid(wood, [x, .71, 8.1], [.07, .25, .72], 'wood');
  // The drawer is owned by the puzzle module. No decorative drawer face or
  // invisible full-desk collider can occlude its open/closed movement.
  box(leather, [7.37, .965, 7.95], [.6, .009, .34]);

  function book(x, y, z, width, height, depth, index, rotation = 0) {
    const cover = bookMaterials[index % bookMaterials.length];
    box(paper, [x, y + height / 2, z], [width - .018, height - .012, depth - .02], [0, rotation, 0]);
    for (const offset of [.006, height - .006]) box(cover, [x, y + offset, z], [width, .012, depth], [0, rotation, 0]);
    const spineX = x - Math.cos(rotation) * (width / 2 - .007);
    const spineZ = z + Math.sin(rotation) * (width / 2 - .007);
    box(cover, [spineX, y + height / 2, spineZ], [.015, height, depth], [0, rotation, 0]);
    for (let i = 1; i < 4; i++) box(paper, [x, y + height * (i / 4), z + depth * .497], [width * .91, .002, .002], [0, rotation, 0]);
  }
  function stack(x, y, z, count, seed = 0, scale = 1) {
    let elevation = y;
    for (let i = 0; i < count; i++) {
      const height = (.035 + ((seed + i * 3) % 4) * .014) * scale;
      book(x + Math.sin(seed + i) * .018, elevation, z + Math.cos(i) * .012, .29 * scale, height, .39 * scale, i + seed, Math.sin(seed + i * 2) * .11);
      elevation += height;
    }
  }
  stack(8.02, .963, 8.23, 3, 2);

  // Shelving reads as records, with no readable print or solution photographs.
  function bookshelf(x, z, width, count = 4) {
    for (const side of [-1, 1]) solid(wood, [x + side * (width / 2 - .045), 1.18, z], [.09, 2.36, .43], 'wood');
    solid(darkWood, [x, 1.18, z + .205], [width, 2.36, .045], 'wood');
    for (let level = 0; level <= count; level++) {
      const y = .14 + level * .52;
      solid(wood, [x, y, z], [width, .065, .44], 'wood');
      if (level === count) continue;
      for (let column = 0; column < 4; column++) stack(x - width * .35 + column * width * .23, y + .033, z - .015, 3 + (level + column) % 3, level + column, .84);
    }
    box(iron, [x, .06, z], [width, .12, .4]);
  }
  bookshelf(4.14, 12.96, 2.63);
  // A low map cabinet and unmarked bundled folios on the back wall.
  solid(greenPaint, [7.2, .62, 12.98], [2.25, 1.24, .6]);
  for (let row = 0; row < 6; row++) {
    const y = .17 + row * .18;
    box(iron, [7.2, y - .077, 12.669], [2.08, .011, .018]);
    for (const x of [6.63, 7.77]) {
      rod(brass, [x - .09, y, 12.634], [x + .09, y, 12.634], .012);
      box(wornSteel, [x, y + .025, 12.663], [.14, .05, .012]);
    }
  }
  for (let i = 0; i < 3; i++) stack(6.5 + i * .65, 1.24, 12.9, 3 + i, i + 2, 1.15);

  // Closed companion lockers frame the interactive gauntlet locker. Its exact
  // reserved volume x=9.95..11.25,z=10.575..11.225 contains no static geometry.
  function closedLocker(x, width) {
    solid(greenPaint, [x, 1.1, 10.9], [width, 2.2, .65]);
    box(iron, [x, 1.08, 11.237], [width - .05, 2.1, .018]);
    box(workshopPaint, [x, 1.09, 11.252], [width - .075, 2.06, .018]);
    for (let row = 0; row < 5; row++) {
      box(iron, [x, 1.87 - row * .047, 11.265], [width * .48, .013, .007]);
      box(iron, [x, .3 + row * .047, 11.265], [width * .48, .013, .007]);
    }
    rod(brass, [x - width * .29, .98, 11.298], [x - width * .29, 1.15, 11.298], .016);
    for (const y of [.4, 1.73]) box(wornSteel, [x + width * .44, y, 11.27], [.04, .11, .03]);
    box(iron, [x, .04, 10.9], [width - .05, .08, .62]);
  }
  closedLocker(9.28, .76);
  closedLocker(11.65, .61);

  // An empty chair off the player's approach line, with recognisable metal legs.
  solid(leather, [9.02, .49, 8.63], [.53, .11, .49], 'wood');
  solid(leather, [9.02, .88, 8.83], [.53, .59, .08], 'wood');
  for (const x of [8.81, 9.23]) for (const z of [8.44, 8.82]) rod(wornSteel, [x, .04, z], [x, .47, z], .022);
  rod(wornSteel, [8.82, .25, 8.45], [9.22, .25, 8.45], .016);
  rod(wornSteel, [8.82, .25, 8.8], [9.22, .25, 8.8], .016);

  // A banker-style practical points into the usable right-hand desk corner.
  disc(brass, [8.02, .982, 7.89], .12, .032);
  rod(brass, [8.02, .99, 7.89], [8.02, 1.39, 7.89], .019);
  rod(brass, [8.02, 1.39, 7.89], [7.94, 1.45, 8.02], .019);
  instance(lampShade, lampGreen, [7.94, 1.43, 8.045], [.18, .13, .13]);
  disc(luminous, [7.94, 1.363, 8.045], .095, .009);

  // The workshop bench leaves the cutters' central pickup footprint clear.
  solid(wood, [-7, .93, 10.5], [3, .14, 1], 'wood');
  box(darkWood, [-7, .854, 10.5], [3.02, .014, 1.02]);
  for (const x of [-8.32, -5.68]) for (const z of [10.13, 10.87]) solid(iron, [x, .43, z], [.095, .86, .095]);
  solid(wood, [-7, .21, 10.5], [2.65, .06, .8], 'wood');
  for (const x of [-7.95, -7.15, -6.28]) {
    solid(darkWood, [x, .39, 10.52], [.58, .3, .56], 'wood');
    box(brass, [x, .4, 10.226], [.13, .045, .016]);
  }
  box(leather, [-6.7, 1.004, 10.5], [1.12, .009, .57]);
  // A small bench vice at the far end is visibly fixed, with a open work gap.
  solid(iron, [-8.17, 1.08, 10.19], [.32, .16, .28]);
  box(wornSteel, [-8.17, 1.21, 10.11], [.3, .16, .075]);
  box(wornSteel, [-8.17, 1.21, 10.3], [.3, .16, .075]);
  rod(brass, [-8.17, 1.1, 9.99], [-8.17, 1.1, 10.38], .032);
  rod(wornSteel, [-8.33, 1.1, 9.98], [-8.02, 1.1, 9.98], .013);

  // Modular pegboard and empty hooks suggest a working restoration room without
  // putting fake pickup tools beside the one usable pair of bolt cutters.
  solid(darkWood, [-7.2, 1.96, 13.29], [3.4, 1.31, .085], 'wood');
  for (let row = 0; row < 7; row++) for (let col = 0; col < 18; col++) box(iron, [-8.75 + col * .181, 1.44 + row * .173, 13.24], [.018, .018, .006]);
  for (const x of [-8.4, -7.7, -6.8, -5.95]) {
    rod(wornSteel, [x, 2.3, 13.23], [x, 2.3, 13.13], .01);
    rod(wornSteel, [x, 2.3, 13.13], [x, 2.34, 13.13], .01);
  }
  // Fixed side shelving and shallow specimen trays; no vessel or ship silhouette.
  bookshelf(-10.18, 12.94, 2.5, 3);
  for (let i = 0; i < 3; i++) {
    const x = -8.25 + i * .82;
    box(wornSteel, [x, 1.038, 10.8], [.57, .04, .23]);
    for (const z of [10.69, 10.91]) box(iron, [x, 1.075, z], [.57, .055, .016]);
  }
  // Stand for a neutral reconstruction surface. The puzzle module owns the
  // actual cradle and pieces at (-5,1.05,8.7), not this supporting plinth.
  solid(iron, [-5, .11, 8.7], [.76, .22, .76]);
  solid(wornSteel, [-5, .51, 8.7], [.21, .8, .21]);
  solid(wood, [-5, .955, 8.7], [1.08, .09, .88], 'wood');
  box(leather, [-5, 1.003, 8.7], [1.015, .008, .81]);
  for (const x of [-5.46, -4.54]) for (const z of [8.34, 9.06]) disc(brass, [x, 1.012, z], .02, .009);

  // Empty round stool tucked at the far bench end, outside circulation routes.
  disc(leather, [-9.14, .58, 10.43], .25, .07);
  collider([-9.14, .58, 10.43], [.5, .07, .5], 'wood');
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    rod(iron, [-9.14 + Math.cos(angle) * .19, .05, 10.43 + Math.sin(angle) * .19], [-9.14 + Math.cos(angle) * .1, .55, 10.43 + Math.sin(angle) * .1], .021);
  }

  const officeFill = new THREE.PointLight('#ffcf91', 14, 8.5, 2);
  officeFill.position.set(7, 2.95, 10.1);
  const workshopFill = new THREE.PointLight('#f5d6a2', 13, 8.5, 2);
  workshopFill.position.set(-7, 2.93, 10.1);
  const taskLight = new THREE.PointLight('#ffd098', 1.8, 2.3, 2);
  taskLight.position.set(7.94, 1.345, 8.045);
  // A restrained low bounce catches the selected, front-facing lock
  // facets. The overhead practical otherwise lights only the neighboring digits.
  const lockBounce = new THREE.PointLight('#ffd6a4', 1.5, 1.7, 2);
  lockBounce.name = 'Opening / lock reading bounce';
  lockBounce.position.set(6.15, .8, 9.3);
  root.add(officeFill, workshopFill, taskLight, lockBounce);

  let staticInstances = 0;
  for (const { geometry, material, values } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, values.length);
    mesh.name = material.name;
    mesh.receiveShadow = !material.transparent && material !== luminous;
    mesh.castShadow = !material.transparent && material !== luminous;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      dummy.position.set(...value.position); dummy.rotation.set(...value.rotation); dummy.scale.set(...value.size); dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    root.add(mesh);
    staticInstances += values.length;
  }
  const landmarks = {
    office: new THREE.Vector3(7, 0, 9.7),
    workshop: new THREE.Vector3(-7, 0, 10.2),
    desk: new THREE.Vector3(7, .96, 8.1),
    drawer: new THREE.Vector3(7, .7, 8.62),
    notebook: new THREE.Vector3(7, .99, 8.1),
    briefcase: new THREE.Vector3(6.15, 1, 8.15),
    gauntletLocker: new THREE.Vector3(10.6, 1.1, 10.9),
    cutters: new THREE.Vector3(-6.7, 1.05, 10.5),
    assemblyCradle: new THREE.Vector3(-5, 1.05, 8.7),
    officeFrontDoor: new THREE.Vector3(6, 0, 6),
    officeAisleDoor: new THREE.Vector3(2, 0, 10),
    workshopFrontDoor: new THREE.Vector3(-7, 0, 7),
    workshopAisleDoor: new THREE.Vector3(-2, 0, 10),
  };
  const stats = {
    rooms: 2,
    roomHeight: 3.3,
    officeBounds: { minX: 2, maxX: 12, minZ: 6, maxZ: 13.4 },
    workshopBounds: { minX: -12, maxX: -2, minZ: 7, maxZ: 13.4 },
    staticInstances,
    instancedBatches: batches.size,
    obstacleCount: obstacles.length,
    pointLights: 4,
    addedShadowMaps: 0,
    generatedTextures: 1,
    generatedTextureResolution: 128,
    downloadedAssets: 0,
  };
  root.userData.scene_stats = stats;
  let disposed = false;
  return {
    root, obstacles, landmarks, stats,
    spawn: { position: new THREE.Vector3(7, 0, 11.4), lookAt: new THREE.Vector3(7, 1.1, 8.15) },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
      geometries.forEach(geometry => geometry.dispose());
      ownedMaterials.forEach(material => material.dispose());
      ownedTextures.forEach(texture => texture.dispose());
    },
  };
}
