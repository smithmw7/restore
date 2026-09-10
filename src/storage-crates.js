import { Color } from 'three';

// Keep the original warehouse's seeded stack silhouettes while making every
// visible storage box an individual gameplay object. Coordinates are centers.
export function createStorageCrateSpecs() {
  const specs = [];
  let seed = 157921;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function crate(x, floorY, z, width, height, depth) {
    // These three samples are part of the layout seed: retain them even when
    // changing rendering so later stack dimensions and offsets stay identical.
    const color = new Color().setHSL(.09 + random() * .025, .14 + random() * .08, .68 + random() * .25);
    const number = String(specs.length + 1).padStart(3, '0');
    specs.push({
      id: `storage-crate-${number}`, artifactId: `storage-artifact-${number}`,
      index: 24 + specs.length, width, height, depth, x, y: floorY + height / 2, z,
      yaw: 0, tint: `#${color.getHexString()}`, kind: 'crate', soundId: 'cube',
    });
  }

  // Dense side bays preserve clear sight lines and walking space in the center.
  for (const sign of [-1, 1]) {
    for (let column = 0; column < 3; column++) {
      for (let row = 0; row < 8; row++) {
        const x = sign * (5.65 + column * 2.45);
        const z = 3.8 - row * 3.85;
        const width = 1.6 + random() * .42, depth = 2.3 + random() * .4;
        let y = 0;
        const count = 2 + Math.floor(random() * 3);
        for (let tier = 0; tier < count; tier++) {
          const height = .85 + random() * .52;
          const jitter = tier ? (random() - .5) * .13 : 0;
          crate(x + jitter, y, z + jitter, width * (1 - tier * .025), height, depth * (1 - tier * .02));
          y += height + .025;
        }
      }
    }
  }
  for (const x of [-3.55, -1.15, 1.3, 3.7]) {
    let y = 0;
    const z = -22.8 - random() * 1.6;
    for (let tier = 0; tier < 3; tier++) {
      const height = 1 + random() * .6;
      crate(x, y, z, 1.7, height, 1.9);
      y += height + .03;
    }
  }
  return specs;
}
