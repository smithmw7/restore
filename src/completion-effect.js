import * as THREE from 'three';

export const COMPLETION_EFFECT_DURATION = 1.25;

/** A brief surface sweep on the existing material, with no extra draw or mesh. */
export function createCompletionEffect(material, bounds) {
  const phase = { value: -1 };
  const extent = { value: new THREE.Vector2(bounds.min.y, Math.max(.001, bounds.max.y - bounds.min.y)) };
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey();
  let elapsed = COMPLETION_EFFECT_DURATION, active = false, triggerCount = 0;

  material.onBeforeCompile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.uRestoreCompletion = phase;
    shader.uniforms.uRestoreCompletionHeight = extent;
    shader.vertexShader = `varying float vRestoreCompletionY;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestoreCompletionY = transformed.y;');
    shader.fragmentShader = `
      uniform float uRestoreCompletion;
      uniform vec2 uRestoreCompletionHeight;
      varying float vRestoreCompletionY;
    ${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      if (uRestoreCompletion >= 0.0) {
        float progress = uRestoreCompletion;
        float height = clamp((vRestoreCompletionY - uRestoreCompletionHeight.x) / uRestoreCompletionHeight.y, 0.0, 1.0);
        float sweep = progress * 1.44 - .18;
        float band = 1.0 - smoothstep(.02, .17, abs(height - sweep));
        float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        float envelope = smoothstep(0.0, .045, progress) * (1.0 - smoothstep(.58, 1.0, progress));
        // Warm gold travels over a restrained jade outline. Material textures
        // remain readable beneath the glow and the normal finish returns exactly.
        vec3 outline = vec3(.24, 1.0, .72) * (.22 + rim * 1.05);
        vec3 highlight = vec3(1.0, .76, .29) * band * 3.4;
        totalEmissiveRadiance += (outline + highlight) * envelope;
      }
    `);
  };
  // Every artifact has independent uniforms but shares the same shader program.
  material.customProgramCacheKey = () => `${previousCacheKey}:restore-completion-v1`;
  material.needsUpdate = true;

  return {
    trigger() { elapsed = 0; active = true; phase.value = 0; triggerCount++; },
    update(dt) {
      if (!active || !Number.isFinite(dt) || dt <= 0) return;
      elapsed = Math.min(COMPLETION_EFFECT_DURATION, elapsed + dt);
      active = elapsed < COMPLETION_EFFECT_DURATION;
      phase.value = active ? elapsed / COMPLETION_EFFECT_DURATION : -1;
    },
    clear(resetHistory = false) {
      elapsed = COMPLETION_EFFECT_DURATION; active = false; phase.value = -1;
      if (resetHistory) triggerCount = 0;
    },
    getState: () => ({ active, progress: active ? elapsed / COMPLETION_EFFECT_DURATION : 0, triggerCount }),
  };
}
