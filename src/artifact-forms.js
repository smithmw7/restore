import * as THREE from 'three';

// Every artifact is one closed surface. Flanges, fins and hollow openings belong
// to that surface, so the fracture cutter never has to join overlapping parts.
export const ARTIFACT_CATALOG = Object.freeze([
  { form: 'ion-thruster', label: 'Ion thruster bell', materialKey: 'copper', soundId: 'orb', halfHeight: 0.285, fragmentCount: 12, seed: 1921 },
  { form: 'reactor-spindle', label: 'Ribbed reactor spindle', materialKey: 'bronze', soundId: 'orb', halfHeight: 0.30, fragmentCount: 12, seed: 1802 },
  { form: 'crescent-hull', label: 'Crescent ship hull', materialKey: 'metal', soundId: 'tablet', halfHeight: 0.27, fragmentCount: 12, seed: 1803 },
  { form: 'gyro-coupler', label: 'Gyroscopic drive coupler', materialKey: 'gold', soundId: 'ring', halfHeight: 0.265, fragmentCount: 12, seed: 1904 },
  { form: 'sensor-fin', label: 'Deep space sensor fin', materialKey: 'metal', soundId: 'tablet', halfHeight: 0.30, fragmentCount: 12, seed: 1805 },
  { form: 'navigation-prism', label: 'Navigation memory prism', materialKey: 'ceramic', soundId: 'vase', halfHeight: 0.295, fragmentCount: 12, seed: 1806 },
  { form: 'flux-key', label: 'Alien flux key', materialKey: 'copper', soundId: 'orb', halfHeight: 0.29, fragmentCount: 12, seed: 1807 },
  { form: 'fossil-sigil', label: 'Fossilized starfarer sigil', materialKey: 'stone', soundId: 'gem', halfHeight: 0.285, fragmentCount: 12, seed: 1808 },
  { form: 'amphora', label: 'Ceramic amphora', materialKey: 'ceramic', soundId: 'vase', halfHeight: 0.28, fragmentCount: 12, seed: 1907 },
  { form: 'ceremonial-chalice', label: 'Ceremonial chalice', materialKey: 'bronze', soundId: 'orb', halfHeight: 0.27, fragmentCount: 12, seed: 1901 },
  { form: 'obelisk', label: 'Marble obelisk', materialKey: 'marble', soundId: 'gem', halfHeight: 0.27, fragmentCount: 12, seed: 402 },
  { form: 'stepped-obelisk', label: 'Stepped obelisk', materialKey: 'marble', soundId: 'gem', halfHeight: 0.29, fragmentCount: 12, seed: 1812 },
  { form: 'arched-stela', label: 'Arched stela', materialKey: 'stone', soundId: 'gem', halfHeight: 0.28, fragmentCount: 12, seed: 1813 },
  { form: 'reliquary-urn', label: 'Fluted reliquary urn', materialKey: 'gold', soundId: 'ring', halfHeight: 0.275, fragmentCount: 12, seed: 1904 },
  { form: 'meteor-shard', label: 'Crystalline meteor shard', materialKey: 'marble', soundId: 'gem', halfHeight: 0.28, fragmentCount: 12, seed: 1815 },
].map((entry, index) => Object.freeze({ ...entry, category: index < 8 ? 'alien' : 'relic' })));

const catalogByForm = new Map(ARTIFACT_CATALOG.map((entry) => [entry.form, entry]));

function removeDegenerateFaces(geometry) {
  const position = geometry.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const source = geometry.index;
  const count = source?.count ?? position.count;
  const index = [];
  for (let i = 0; i < count; i += 3) {
    const ia = source ? source.getX(i) : i;
    const ib = source ? source.getX(i + 1) : i + 1;
    const ic = source ? source.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib).sub(a);
    c.fromBufferAttribute(position, ic).sub(a);
    if (b.cross(c).lengthSq() > 1e-16) index.push(ia, ib, ic);
  }
  geometry.setIndex(index);
  return geometry;
}

function lathe(profile, segments = 24, sculpt = null) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  if (sculpt) {
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index); const y = position.getY(index); const z = position.getZ(index);
      const radius = Math.hypot(x, z);
      if (radius < 1e-8) continue;
      const angle = Math.atan2(x, z);
      const { factor = 1, twist = 0 } = sculpt(angle, y, radius);
      position.setXYZ(index, Math.sin(angle + twist) * radius * factor, y, Math.cos(angle + twist) * radius * factor);
    }
    geometry.computeVertexNormals();
  }
  return removeDegenerateFaces(geometry);
}

function outline(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y));
  return shape.closePath();
}

function addEllipseHole(shape, x, y, rx, ry, rotation = 0) {
  const hole = new THREE.Path();
  hole.absellipse(x, y, rx, ry, 0, Math.PI * 2, true, rotation);
  shape.holes.push(hole);
  return shape;
}

function extrude(shape, depth = 0.085, bevel = 0.008) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 10, steps: 1,
  }).translate(0, 0, -depth / 2);
  // One outer material, including the bevels. The cutter assigns the interior.
  geometry.clearGroups();
  return removeDegenerateFaces(geometry);
}

function ionThruster() {
  // The nozzle lip turns into an actual inner bell wall and ends in a blind
  // chamber. Three narrow cooling collars rise to the capped fuel inlet.
  return lathe([
    [0, 0.285], [0.065, 0.285], [0.065, 0.245], [0.10, 0.245], [0.10, 0.21],
    [0.075, 0.21], [0.075, 0.16], [0.14, 0.16], [0.14, 0.12], [0.085, 0.12],
    [0.085, 0.08], [0.135, 0.08], [0.135, 0.045], [0.09, 0.045],
    [0.10, 0], [0.125, -0.075], [0.175, -0.16], [0.24, -0.25],
    [0.25, -0.285], [0.215, -0.285], [0.202, -0.25], [0.145, -0.165],
    [0.10, -0.08], [0.07, -0.015], [0, 0.005],
  ].reverse(), 28);
}

function reactorSpindle() {
  const profile = [[0, -0.30], [0.06, -0.30], [0.095, -0.265], [0.095, -0.23], [0.07, -0.21]];
  for (let i = 0; i < 6; i++) {
    const y = -0.195 + i * 0.063;
    const radius = 0.15 + 0.028 * Math.sin((i + 0.5) / 6 * Math.PI);
    profile.push([0.08, y], [radius, y + 0.009], [radius, y + 0.032], [0.08, y + 0.044]);
  }
  profile.push([0.07, 0.205], [0.105, 0.23], [0.105, 0.255], [0.055, 0.275], [0, 0.30]);
  return lathe(profile, 24, (angle, y) => ({
    factor: 1 + 0.08 * Math.cos(angle * 6), twist: Math.abs(y) < 0.21 ? y * 0.7 : 0,
  }));
}

function crescentHull() {
  const shape = new THREE.Shape().moveTo(0.22, 0.245)
    .bezierCurveTo(-0.035, 0.305, -0.27, 0.19, -0.285, -0.015)
    .bezierCurveTo(-0.295, -0.16, -0.17, -0.28, 0.035, -0.265)
    .lineTo(0.12, -0.23).lineTo(0.20, -0.235).lineTo(0.245, -0.16)
    .lineTo(0.145, -0.165).lineTo(0.105, -0.115).lineTo(0.055, -0.135)
    .bezierCurveTo(-0.115, -0.16, -0.18, -0.025, -0.12, 0.065)
    .bezierCurveTo(-0.075, 0.145, 0.03, 0.18, 0.155, 0.155)
    .lineTo(0.115, 0.20).lineTo(0.22, 0.245).closePath();
  const geometry = extrude(shape, 0.095, 0.007);
  // Bow the complete plate continuously, retaining its closed topology.
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i); const y = position.getY(i);
    position.setZ(i, position.getZ(i) + 0.38 * x * x + 0.15 * y * y);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function gyroCoupler() {
  // A recessed shaft socket with three broad mounting lobes. Keeping its thin
  // back wall gives the cutter a continuous cap through the central recess.
  return lathe([[0, -0.072], [0.165, -0.072], [0.18, -0.055], [0.20, -0.055],
    [0.20, 0.045], [0.18, 0.07], [0.12, 0.07], [0.105, 0.052],
    [0.105, -0.035], [0.075, -0.045], [0, -0.045]], 48,
  (angle, y, radius) => ({ factor: radius > 0.15 ? 1 + 0.25 * Math.pow((Math.cos(angle * 3) + 1) / 2, 3) : 1 }))
    .rotateX(Math.PI / 2);
}

function sensorFin() {
  return extrude(outline([
    [-0.08, -0.30], [0.08, -0.30], [0.105, -0.255], [0.09, -0.17],
    [0.23, -0.09], [0.255, 0.115], [0.18, 0.07], [0.135, -0.015],
    [0.075, 0.035], [0.06, 0.19], [0.025, 0.30], [-0.025, 0.30],
    [-0.07, 0.11], [-0.16, 0.16], [-0.19, 0.26], [-0.245, 0.11],
    [-0.18, -0.09], [-0.075, -0.16], [-0.10, -0.25],
  ]), 0.065, 0.008);
}

function navigationPrism() {
  return lathe([
    [0, -0.295], [0.105, -0.235], [0.12, -0.17], [0.12, -0.13],
    [0.18, -0.105], [0.18, -0.06], [0.13, -0.035], [0.15, 0.11],
    [0.125, 0.19], [0, 0.295],
  ], 10, (angle, y) => ({ factor: 0.87 + 0.13 * Math.cos(angle * 5), twist: y * 0.75 }));
}

function fluxKey() {
  const shape = outline([
    [-0.045, -0.29], [0.045, -0.29], [0.06, -0.255], [0.15, -0.255],
    [0.15, -0.205], [0.095, -0.205], [0.095, -0.15], [0.15, -0.15],
    [0.15, -0.10], [0.065, -0.10], [0.065, 0.005], [0.175, 0.075],
    [0.175, 0.20], [0.095, 0.29], [-0.095, 0.29], [-0.175, 0.20],
    [-0.175, 0.075], [-0.065, 0.005], [-0.065, -0.10], [-0.12, -0.10],
    [-0.12, -0.16], [-0.065, -0.16], [-0.065, -0.255],
  ]);
  const hole = outline([[-0.10, 0.11], [0.10, 0.11], [0.10, 0.175], [0.055, 0.22], [-0.055, 0.22], [-0.10, 0.175]]);
  shape.holes.push(hole);
  return extrude(shape, 0.085, 0.007);
}

function fossilSigil() {
  const shape = new THREE.Shape().moveTo(0, -0.285)
    .lineTo(0.075, -0.22).lineTo(0.075, -0.12).lineTo(0.14, -0.15)
    .lineTo(0.22, -0.075).lineTo(0.235, 0.09).lineTo(0.165, 0.05)
    .lineTo(0.195, 0.255).lineTo(0.075, 0.205).lineTo(0, 0.285)
    .lineTo(-0.075, 0.205).lineTo(-0.195, 0.255).lineTo(-0.165, 0.05)
    .lineTo(-0.235, 0.09).lineTo(-0.22, -0.075).lineTo(-0.14, -0.15)
    .lineTo(-0.075, -0.12).lineTo(-0.075, -0.22).closePath();
  addEllipseHole(shape, -0.078, 0.04, 0.047, 0.022, -0.30);
  addEllipseHole(shape, 0.078, 0.04, 0.047, 0.022, 0.30);
  const geometry = extrude(shape, 0.065, 0.008);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i); const y = position.getY(i);
    position.setZ(i, position.getZ(i) + 0.05 * Math.cos(x * 6) * Math.cos(y * 4));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function rawGeometry(form) {
  switch (form) {
    case 'ion-thruster': return ionThruster();
    case 'reactor-spindle': return reactorSpindle();
    case 'crescent-hull': return crescentHull();
    case 'gyro-coupler': return gyroCoupler();
    case 'sensor-fin': return sensorFin();
    case 'navigation-prism': return navigationPrism();
    case 'flux-key': return fluxKey();
    case 'fossil-sigil': return fossilSigil();
    case 'amphora': return lathe([[0, -0.28], [0.10, -0.28], [0.11, -0.24], [0.17, -0.19],
      [0.205, -0.06], [0.185, 0.09], [0.09, 0.18], [0.08, 0.245], [0.11, 0.25],
      [0.11, 0.28], [0.065, 0.28], [0.065, 0.235], [0.075, 0.185], [0.16, 0.08],
      [0.18, -0.065], [0.14, -0.18], [0, -0.23]]);
    case 'ceremonial-chalice': return lathe([[0, -0.27], [0.13, -0.27], [0.15, -0.245], [0.13, -0.20],
      [0.055, -0.16], [0.05, 0.015], [0.115, 0.04], [0.175, 0.13], [0.205, 0.22],
      [0.20, 0.27], [0.178, 0.27], [0.178, 0.22], [0.15, 0.14], [0.09, 0.095], [0, 0.085]]);
    case 'obelisk': return lathe([[0, -0.27], [0.17, -0.27], [0.17, -0.22], [0.14, -0.20], [0.095, 0.15], [0, 0.27]], 4).rotateY(Math.PI / 4);
    case 'stepped-obelisk': return lathe([[0, -0.29], [0.19, -0.29], [0.19, -0.255], [0.155, -0.255],
      [0.155, -0.22], [0.13, -0.22], [0.10, 0.18], [0, 0.29]], 4).rotateY(Math.PI / 4);
    case 'arched-stela': return extrude(new THREE.Shape().moveTo(-0.175, -0.28).lineTo(0.175, -0.28)
      .lineTo(0.175, 0.12).quadraticCurveTo(0.175, 0.28, 0, 0.28)
      .quadraticCurveTo(-0.175, 0.28, -0.175, 0.12).closePath(), 0.105, 0.012);
    case 'reliquary-urn': return lathe([[0, -0.275], [0.145, -0.275], [0.145, -0.24], [0.105, -0.22],
      [0.175, -0.14], [0.19, -0.015], [0.15, 0.105], [0.11, 0.145], [0.18, 0.16],
      [0.18, 0.19], [0.105, 0.21], [0.045, 0.245], [0, 0.275]], 24,
    (angle, y) => ({ factor: Math.abs(y) < 0.16 ? 1 + 0.08 * Math.cos(angle * 8) : 1 }));
    case 'meteor-shard': return lathe([[0, -0.28], [0.14, -0.17], [0.17, 0.045], [0.09, 0.17], [0, 0.28]], 7,
      (angle, y) => ({ factor: 1 + 0.16 * Math.cos(angle * 3), twist: y * 0.6 }));
    default: throw new Error(`Unknown warehouse artifact form: ${form}`);
  }
}

/** Caller owns the result. Geometry is centered, metre-scaled and has UVs. */
export function createArtifactGeometry(form) {
  const entry = catalogByForm.get(form);
  if (!entry) throw new Error(`Unknown warehouse artifact form: ${form}`);
  const geometry = rawGeometry(form);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const height = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  geometry.translate(-center.x, -center.y, -center.z);
  const scale = entry.halfHeight * 2 / height;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
