import * as THREE from 'three';

const VERTEX = `
  precision highp float;
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const TONE_MAPPING = {
  [THREE.LinearToneMapping]: 'LinearToneMapping',
  [THREE.ReinhardToneMapping]: 'ReinhardToneMapping',
  [THREE.CineonToneMapping]: 'CineonToneMapping',
  [THREE.ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
  [THREE.AgXToneMapping]: 'AgXToneMapping',
  [THREE.NeutralToneMapping]: 'NeutralToneMapping',
};

function fullscreenMaterial(name, fragmentShader, uniforms) {
  return new THREE.RawShaderMaterial({
    name, glslVersion: THREE.GLSL3, vertexShader: VERTEX,
    fragmentShader: `precision highp float; in vec2 vUv; out vec4 fragColor;\n${fragmentShader}`,
    uniforms, depthTest: false, depthWrite: false, toneMapped: false,
  });
}

// Keep the scene linear until the last pass. Each XR eye is processed separately
// so blur samples can never cross into the other eye's image. Reusing the buffers
// also keeps their memory cost independent of the number of views.
export function createRestorePostprocessing(renderer, { ambientOcclusion = true } = {}) {
  const hdr = renderer.extensions.has('EXT_color_buffer_float');
  const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const targetOptions = { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    ...targetOptions, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    samples: Math.min(2, renderer.capabilities.maxSamples),
  });
  const bloomA = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  const bloomB = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
  sceneTarget.texture.name = 'Restore linear scene';
  bloomA.texture.name = 'Restore quarter-resolution bloom';
  bloomB.texture.name = 'Restore bloom blur';

  const threshold = fullscreenMaterial('Restore / highlight extraction', `
    uniform sampler2D tScene;
    uniform vec2 texel;
    uniform float threshold;
    vec3 bright(vec3 color) {
      float luminance = dot(color, vec3(.2126, .7152, .0722));
      float knee = threshold * .45;
      float soft = clamp(luminance - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + .0001);
      return min(color, vec3(8.0)) * max(luminance - threshold, soft) / max(luminance, .0001);
    }
    void main() {
      vec3 color = bright(texture(tScene, vUv + texel * vec2(-1., -1.)).rgb);
      color += bright(texture(tScene, vUv + texel * vec2(1., -1.)).rgb);
      color += bright(texture(tScene, vUv + texel * vec2(-1., 1.)).rgb);
      color += bright(texture(tScene, vUv + texel * vec2(1., 1.)).rgb);
      fragColor = vec4(color * .25, 1.0);
    }
  `, { tScene: { value: sceneTarget.texture }, texel: { value: new THREE.Vector2(1, 1) }, threshold: { value: hdr ? 1 : .72 } });
  const blur = fullscreenMaterial('Restore / separable bloom blur', `
    uniform sampler2D tSource;
    uniform vec2 stepSize;
    void main() {
      vec3 color = texture(tSource, vUv).rgb * .227027;
      color += texture(tSource, vUv + stepSize * 1.384615).rgb * .316216;
      color += texture(tSource, vUv - stepSize * 1.384615).rgb * .316216;
      color += texture(tSource, vUv + stepSize * 3.230769).rgb * .070270;
      color += texture(tSource, vUv - stepSize * 3.230769).rgb * .070270;
      fragColor = vec4(color, 1.0);
    }
  `, { tSource: { value: null }, stepSize: { value: new THREE.Vector2() } });
  const composite = fullscreenMaterial('Restore / bloom and warm film finish', `
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform highp sampler2D tDepth;
    uniform float bloomStrength;
    uniform float vignette;
    uniform float aoEnabled;
    uniform vec2 depthTexel;
    uniform mat4 inverseProjection;
    uniform vec2 projectionScale;
    uniform vec2 emissiveProtection;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    vec3 viewPosition(vec2 uv, float depth) {
      vec4 p = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }
    vec3 depthPosition(vec2 uv) {
      return viewPosition(uv, texture(tDepth, uv).r);
    }
    float contactVisibility(float depth, float luminance) {
      if (aoEnabled < .5 || depth >= .999999) return 1.0;
      vec3 center = viewPosition(vUv, depth);
      float fade = 1.0 - smoothstep(8.0, 18.0, -center.z);
      if (fade <= 0.0) return 1.0;
      // Choose the continuous side of each derivative at silhouettes. A depth
      // jump across an object's edge must not become an invented tilted normal.
      vec3 left = center - depthPosition(vUv - vec2(depthTexel.x, 0.0));
      vec3 right = depthPosition(vUv + vec2(depthTexel.x, 0.0)) - center;
      vec3 down = center - depthPosition(vUv - vec2(0.0, depthTexel.y));
      vec3 up = depthPosition(vUv + vec2(0.0, depthTexel.y)) - center;
      vec3 dx = abs(left.z) < abs(right.z) ? left : right;
      vec3 dy = abs(down.z) < abs(up.z) ? down : up;
      vec3 crossNormal = cross(dx, dy);
      if (dot(crossNormal, crossNormal) < 1.e-14 || max(length(dx), length(dy)) > .11) return 1.0;
      vec3 normal = normalize(crossNormal);
      if (dot(normal, -center) < 0.0) normal = -normal;
      const float radius = .22;
      // Eight fixed directions avoid temporal grain in the headset. The radius
      // is local in metres and capped in pixels, so close silhouettes stay tight.
      vec2 screenRadius = min(projectionScale * radius / max(.05, -center.z), depthTexel * 32.0);
      const vec2 offsets[8] = vec2[8](
        vec2(.42, 0.0), vec2(-.42, 0.0), vec2(0.0, .42), vec2(0.0, -.42),
        vec2(.7071, .7071), vec2(-.7071, .7071), vec2(.7071, -.7071), vec2(-.7071, -.7071)
      );
      float occlusion = 0.0;
      for (int i = 0; i < 8; i++) {
        vec2 uv = vUv + screenRadius * offsets[i];
        if (any(lessThan(uv, depthTexel)) || any(greaterThan(uv, vec2(1.0) - depthTexel))) continue;
        float sampleDepth = texture(tDepth, uv).r;
        if (sampleDepth >= .999999) continue;
        vec3 delta = viewPosition(uv, sampleDepth) - center;
        float distance = length(delta);
        // Reject unrelated foreground/background layers, including a lifted
        // artifact whose projected silhouette overlaps a much deeper floor.
        float range = 1.0 - smoothstep(radius * .3, radius, distance);
        float facing = max(0.0, dot(normal, delta) / max(.001, distance) - .075);
        occlusion += facing * range;
      }
      float shade = min(.34, occlusion * .25) * fade;
      shade *= 1.0 - smoothstep(emissiveProtection.x, emissiveProtection.y, luminance);
      return 1.0 - shade;
    }
    void main() {
      vec4 sceneColor = texture(tScene, vUv);
      float depth = texture(tDepth, vUv).r;
      float visibility = contactVisibility(depth, dot(sceneColor.rgb, vec3(.2126, .7152, .0722)));
      // Bloom stays additive; contact shading cannot blacken lamp halos or the
      // luminous completion sweep that is already in the highlight buffer.
      vec3 color = (sceneColor.rgb * visibility + texture(tBloom, vUv).rgb * bloomStrength) * vec3(1.018, 1.0, .965);
      vec2 corner = (vUv - .5) * 1.41421356;
      color *= 1.0 - vignette * smoothstep(.2, 1.0, dot(corner, corner));
      #ifdef RESTORE_TONE_MAPPING
        color = RESTORE_TONE_MAPPING(color);
      #endif
      fragColor = vec4(color, sceneColor.a);
      #ifdef RESTORE_SRGB
        fragColor = sRGBTransferOETF(fragColor);
      #endif
      // Preserve real scene depth for XR reprojection instead of supplying the
      // fullscreen triangle's depth to the headset compositor.
      gl_FragDepth = depth;
    }
  `, {
    tScene: { value: sceneTarget.texture }, tBloom: { value: bloomA.texture }, tDepth: { value: sceneTarget.depthTexture },
    toneMappingExposure: { value: 1 }, bloomStrength: { value: .15 }, vignette: { value: .065 },
    aoEnabled: { value: ambientOcclusion ? 1 : 0 }, depthTexel: { value: new THREE.Vector2(1, 1) },
    inverseProjection: { value: new THREE.Matrix4() }, projectionScale: { value: new THREE.Vector2() },
    emissiveProtection: { value: new THREE.Vector2(hdr ? .6 : .45, hdr ? 1.5 : .92) },
  });
  composite.depthTest = true;
  composite.depthWrite = true;
  composite.depthFunc = THREE.AlwaysDepth;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const triangle = new THREE.Mesh(geometry, threshold);
  triangle.frustumCulled = false;
  const screenScene = new THREE.Scene(); screenScene.add(triangle);
  const screenCamera = new THREE.Camera();
  const eyeCameras = [];
  const size = new THREE.Vector2(), viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), currentViewport = new THREE.Vector4();
  const stats = { enabled: true, hdr, bloomStrength: .15, bloomScale: .25, eyeIsolated: true, preservesDepth: true,
    ambientOcclusion: { enabled: !!ambientOcclusion, radius: .22, samples: 8, normalSamples: 4, maximumShade: .34, extraPasses: 0 },
    mode: 'desktop', views: 0, scenePasses: 0, postPasses: 0, resolution: [1, 1], bloomResolution: [1, 1] };
  let width = 1, height = 1, outputSignature = '';

  function resize(nextWidth, nextHeight) {
    if (nextWidth === undefined || nextHeight === undefined) {
      renderer.getDrawingBufferSize(size); nextWidth = size.x; nextHeight = size.y;
    }
    nextWidth = Math.max(1, Math.round(nextWidth)); nextHeight = Math.max(1, Math.round(nextHeight));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth; height = nextHeight;
    sceneTarget.setSize(width, height);
    bloomA.setSize(Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(height / 4)));
    bloomB.setSize(bloomA.width, bloomA.height);
    threshold.uniforms.texel.value.set(1 / width, 1 / height);
    composite.uniforms.depthTexel.value.set(1 / width, 1 / height);
    stats.resolution = [width, height]; stats.bloomResolution = [bloomA.width, bloomA.height];
  }

  function drawPass(material, target) {
    renderer.setRenderTarget(target);
    triangle.material = material;
    renderer.render(screenScene, screenCamera);
  }

  function render(scene, camera) {
    const destination = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace(), mipmap = renderer.getActiveMipmapLevel();
    const xrEnabled = renderer.xr.enabled, immersive = xrEnabled && renderer.xr.isPresenting;
    const autoClear = renderer.autoClear, shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const toneMapping = renderer.toneMapping, scissorTest = renderer.getScissorTest();
    renderer.getViewport(viewport); renderer.getCurrentViewport(currentViewport); renderer.getScissor(scissor);
    const views = immersive ? renderer.xr.getCamera().cameras : [camera];
    if (!views.length) return;
    const colorSpace = destination?.isXRRenderTarget ? destination.texture.colorSpace : renderer.outputColorSpace;
    const signature = `${toneMapping}:${colorSpace}`;
    if (signature !== outputSignature) {
      composite.defines = {};
      if (TONE_MAPPING[toneMapping]) composite.defines.RESTORE_TONE_MAPPING = TONE_MAPPING[toneMapping];
      if (THREE.ColorManagement.getTransfer(colorSpace) === THREE.SRGBTransfer) composite.defines.RESTORE_SRGB = '';
      composite.needsUpdate = true; outputSignature = signature;
    }
    composite.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    composite.uniforms.vignette.value = immersive ? .025 : .065;
    if (immersive) resize(Math.max(...views.map(view => view.viewport.z)), Math.max(...views.map(view => view.viewport.w)));
    else if (destination) resize(destination.width, destination.height);
    else resize();
    stats.mode = immersive ? 'xr' : 'desktop'; stats.views = views.length;
    stats.scenePasses = views.length; stats.postPasses = views.length * 4;

    try {
      renderer.xr.enabled = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = true;
      for (let index = 0; index < views.length; index++) {
        const view = views[index];
        let renderCamera = view;
        if (immersive) {
          renderCamera = eyeCameras[index] ||= new THREE.PerspectiveCamera();
          renderCamera.copy(view, false);
          // XR eye transforms already include the locomotion rig. Automatic
          // updates would replace matrixWorld with the eye's local pose.
          renderCamera.matrixAutoUpdate = false; renderCamera.matrixWorldAutoUpdate = false;
          renderCamera.matrix.copy(view.matrixWorld); renderCamera.matrixWorld.copy(view.matrixWorld);
          renderCamera.matrixWorldInverse.copy(view.matrixWorldInverse);
          // Reflector restores camera.viewport after its nested render.
          renderCamera.viewport = undefined;
        }
        renderer.shadowMap.autoUpdate = shadowAutoUpdate && index === 0;
        renderer.setRenderTarget(sceneTarget);
        renderer.render(scene, renderCamera);
        composite.uniforms.inverseProjection.value.copy(renderCamera.projectionMatrixInverse);
        composite.uniforms.projectionScale.value.set(renderCamera.projectionMatrix.elements[0] * .5, renderCamera.projectionMatrix.elements[5] * .5);
        drawPass(threshold, bloomA);
        blur.uniforms.tSource.value = bloomA.texture; blur.uniforms.stepSize.value.set(2 / bloomA.width, 0);
        drawPass(blur, bloomB);
        blur.uniforms.tSource.value = bloomB.texture; blur.uniforms.stepSize.value.set(0, 2 / bloomA.height);
        drawPass(blur, bloomA);

        renderer.setRenderTarget(destination, cubeFace, mipmap);
        // XR targets use physical pixels. The renderer's public setViewport
        // multiplies by device pixel ratio, so use the same state API Three's
        // ArrayCamera uses for its per-eye viewport and scissor.
        const outputViewport = immersive ? view.viewport : currentViewport;
        renderer.state.viewport(outputViewport);
        renderer.state.scissor(outputViewport);
        renderer.state.setScissorTest(true);
        renderer.autoClear = false;
        triangle.material = composite;
        renderer.render(screenScene, screenCamera);
        renderer.autoClear = true;
      }
    } finally {
      renderer.xr.enabled = xrEnabled; renderer.toneMapping = toneMapping;
      renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(destination, cubeFace, mipmap);
      renderer.state.viewport(currentViewport);
    }
  }

  return {
    render, resize, stats,
    getState: () => ({ ...stats, ambientOcclusion: { ...stats.ambientOcclusion }, resolution: [...stats.resolution], bloomResolution: [...stats.bloomResolution] }),
    dispose() {
      sceneTarget.depthTexture.dispose(); sceneTarget.dispose(); bloomA.dispose(); bloomB.dispose();
      threshold.dispose(); blur.dispose(); composite.dispose(); geometry.dispose(); stats.enabled = false;
    },
  };
}
