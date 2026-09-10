import * as THREE from 'three';
import { createArtifactGeometry } from './artifact-forms.js';

const boundsByForm = new Map();
const BOARD_THICKNESS = 0.055;
const PACKED_FILL = 0.9;
const BOTTOM_CLEARANCE = 0.025;

/** The closed instance scales its boards; opened panels use fixed 55 mm wood. */
export function crateInterior(crate) {
  const dimensions = [crate.width, crate.height, crate.depth];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= BOARD_THICKNESS * 2)) {
    throw new Error('Crate dimensions must leave a positive interior.');
  }
  const walls = dimensions.map((value) => Math.max(BOARD_THICKNESS, value * BOARD_THICKNESS));
  return {
    dimensions: dimensions.map((value, index) => value - walls[index] * 2),
    bottom: -crate.height / 2 + walls[1],
  };
}

/** Uniform scaling preserves each artifact's silhouette, holes and proportions. */
export function fitArtifactToCrate(form, crate) {
  let size = boundsByForm.get(form);
  if (!size) {
    const geometry = createArtifactGeometry(form);
    size = geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
    geometry.dispose();
    boundsByForm.set(form, size);
  }
  const interior = crateInterior(crate);
  const scale = Math.min(...interior.dimensions.map((value, index) => value / size[index])) * PACKED_FILL;
  const dimensions = size.map((value) => value * scale);
  const halfHeight = dimensions[1] / 2;
  return {
    scale, halfHeight, dimensions,
    crateOffsetY: interior.bottom + Math.min(BOTTOM_CLEARANCE, interior.dimensions[1] * 0.05) + halfHeight,
  };
}
