// Distances are metres and time is seconds. Keep this shared by desktop and XR
// so a stationary hold has the same gradual pull at different refresh rates.
export function createHoldPull(clearance = .9) {
  return { elapsed: 0, clearance: Math.max(.4, clearance) };
}

export function stepHoldPull(state, dt, { origin, direction, distance, viewer, manual = false }) {
  if (!state || !Number.isFinite(distance) || !Number.isFinite(dt) || dt <= 0) return distance;
  if (manual) { state.elapsed = 0; return distance; }
  // Do not catch up a suspended session with a large movement on its next frame.
  dt = Math.min(dt, .1);
  const middle = state.elapsed + dt * .5;
  state.elapsed += dt;
  const ramp = Math.max(0, Math.min(1, (middle - .45) / 3));
  const speed = .6 * ramp * ramp * (3 - 2 * ramp);
  const x = origin.x - viewer.x, y = origin.y - viewer.y, z = origin.z - viewer.z;
  const along = x * direction.x + y * direction.y + z * direction.z;
  const discriminant = along * along - x * x - y * y - z * z + state.clearance * state.clearance;
  // Stop on the far side of the head-clearance sphere, also for off-center
  // controller rays. A nearby physical grab is never forced farther away.
  const stop = Math.max(.15, discriminant >= 0 ? -along + Math.sqrt(discriminant) : .15);
  const gap = distance - stop;
  if (gap <= .001) return distance;
  const travel = gap > .5 ? speed * dt : gap * (1 - Math.exp(-speed * dt / .5));
  return distance - Math.min(gap, travel);
}
