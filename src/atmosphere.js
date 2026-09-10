import * as THREE from 'three';

// These are bounded world-space volumes. Each eye (and the floor reflection)
// integrates its own ray using Three's cameraPosition, without a scene copy.
const volumeVertex = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const shaftFragment = `
  varying vec3 vWorldPosition;
  uniform vec3 uSource;
  uniform vec3 uAxis;
  uniform vec3 uColor;
  uniform float uLength;
  uniform float uStartRadius;
  uniform float uEndRadius;
  uniform float uDensity;
  uniform float uTime;

  void main() {
    vec3 ray = normalize(vWorldPosition - cameraPosition);
    vec3 origin = cameraPosition - uSource;
    float oy = dot(origin, uAxis);
    float dy = dot(ray, uAxis);
    vec3 radialOrigin = origin - uAxis * oy;
    vec3 radialRay = ray - uAxis * dy;
    float boundRadius = max(uStartRadius, uEndRadius);
    float a = dot(radialRay, radialRay);
    float b = dot(radialOrigin, radialRay);
    float c = dot(radialOrigin, radialOrigin) - boundRadius * boundRadius;
    float nearT = 0.0;
    float farT = length(vWorldPosition - cameraPosition);

    // Clip the view ray to the finite cylinder enclosing the light frustum.
    // The final sample density clips it to the softly edged frustum itself.
    if (a > .000001) {
      float discriminant = b * b - a * c;
      if (discriminant <= 0.0) discard;
      float root = sqrt(discriminant);
      nearT = max(nearT, (-b - root) / a);
      farT = min(farT, (-b + root) / a);
    } else if (c > 0.0) discard;
    if (abs(dy) > .000001) {
      float capA = -oy / dy;
      float capB = (uLength - oy) / dy;
      nearT = max(nearT, min(capA, capB));
      farT = min(farT, max(capA, capB));
    } else if (oy < 0.0 || oy > uLength) discard;
    if (farT <= nearT) discard;

    float stepLength = (farT - nearT) / 10.0;
    float opticalDepth = 0.0;
    for (int i = 0; i < 10; i++) {
      vec3 p = origin + ray * (nearT + (float(i) + .5) * stepLength);
      float height = dot(p, uAxis);
      float along = clamp(height / uLength, 0.0, 1.0);
      float radius = mix(uStartRadius, uEndRadius, along);
      float radial = length(p - uAxis * height) / max(radius, .01);
      float feather = 1.0 - smoothstep(.42, 1.0, radial);
      float caps = smoothstep(0.0, .035, along) * (1.0 - smoothstep(.83, 1.0, along));
      vec3 worldPoint = p + uSource;
      float eddies = .89 + .11 * sin(worldPoint.x * .49 + uTime * .045)
        * sin(worldPoint.z * .37 - uTime * .028 + worldPoint.y * .23);
      opticalDepth += feather * caps * eddies * stepLength;
    }
    float distanceFade = 1.0 - smoothstep(48.0, 92.0, nearT);
    float alpha = (1.0 - exp(-uDensity * opticalDepth)) * distanceFade;
    if (alpha < .001) discard;
    gl_FragColor = vec4(uColor, min(alpha, .30));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const mistFragment = `
  varying vec3 vWorldPosition;
  uniform vec3 uCenter;
  uniform vec3 uRadii;
  uniform vec3 uColor;
  uniform float uTime;
  void main() {
    vec3 ray = normalize(vWorldPosition - cameraPosition);
    vec3 origin = (cameraPosition - uCenter) / uRadii;
    vec3 direction = ray / uRadii;
    float a = dot(direction, direction);
    float b = dot(origin, direction);
    float c = dot(origin, origin) - 1.0;
    float discriminant = b * b - a * c;
    if (discriminant <= 0.0) discard;
    float root = sqrt(discriminant);
    float nearT = max(0.0, (-b - root) / a);
    float farT = min(length(vWorldPosition - cameraPosition), (-b + root) / a);
    float stepLength = max(0.0, farT - nearT) / 6.0;
    float opticalDepth = 0.0;
    for (int i = 0; i < 6; i++) {
      float t = nearT + (float(i) + .5) * stepLength;
      vec3 p = origin + direction * t;
      vec3 worldPoint = cameraPosition + ray * t;
      float edge = 1.0 - smoothstep(.12, 1.0, dot(p, p));
      float eddies = .65 + .35 * sin(worldPoint.x * .51 + uTime * .027)
        * sin(worldPoint.z * .33 - uTime * .021);
      opticalDepth += edge * eddies * stepLength;
    }
    float alpha = (1.0 - exp(-opticalDepth * .03))
      * (1.0 - smoothstep(34.0, 66.0, nearT));
    if (alpha < .001) discard;
    gl_FragColor = vec4(uColor, min(alpha, .105));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const dustVertex = `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform vec3 uViewer;
  uniform float uPixelScale;
  uniform vec4 uBounds;
  varying float vOpacity;
  varying float vWarmth;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * .052 + aPhase) * .24;
    p.y += sin(uTime * .073 + aPhase * 1.7) * .19;
    p.z += cos(uTime * .048 + aPhase * 2.3) * .28;
    // Particles stay still in world space until they wrap beyond the invisible
    // edge of this 48m region, keeping a useful density in a very large hall.
    p.xz = mod(p.xz - uViewer.xz + 24.0, 48.0) - 24.0 + uViewer.xz;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    float distanceToEye = distance(p, cameraPosition);
    float nearFade = smoothstep(.65, 2.1, distanceToEye);
    float farFade = 1.0 - smoothstep(12.0, 22.0, distanceToEye);
    float inside = step(uBounds.x + .2, p.x) * step(p.x, uBounds.y - .2)
      * step(uBounds.z + .2, p.z) * step(p.z, uBounds.w - .2);
    vOpacity = (.13 + .19 * aSize) * nearFade * farFade * inside;
    vWarmth = exp(-abs(p.x) * .22) * (1.0 - smoothstep(28.0, 45.0, -p.z));
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(aSize * .017 * uPixelScale / max(.5, -mvPosition.z), 1.0, 3.2);
  }
`;

const dustFragment = `
  varying float vOpacity;
  varying float vWarmth;
  void main() {
    float radius = length(gl_PointCoord - .5);
    float alpha = (1.0 - smoothstep(.06, .5, radius)) * vOpacity;
    if (alpha < .004) discard;
    vec3 color = mix(vec3(.57, .56, .48), vec3(.90, .67, .39), vWarmth);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const asVector = value => value?.isVector3 ? value.clone() : new THREE.Vector3(...value);
const _down = new THREE.Vector3(0, -1, 0);

export function createArchiveAtmosphere({ scene, renderer, bounds, lights = [] }) {
  const root = new THREE.Group();
  root.name = 'Archive atmosphere';
  scene.add(root);
  const materials = new Set();
  const geometries = new Set();
  const shafts = [];
  const movingShafts = [];
  const banks = [];
  const timeUniform = { value: 0 };
  const viewerUniform = { value: new THREE.Vector3(0, 1.65, 3.5) };
  const viewport = new THREE.Vector4();
  const volumeMaterial = fragmentShader => {
    const material = new THREE.ShaderMaterial({
      vertexShader: volumeVertex, fragmentShader,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.BackSide, fog: false,
    });
    materials.add(material);
    return material;
  };

  for (const [index, light] of lights.entries()) {
    const source = asVector(light.source);
    const target = asVector(light.target);
    const axis = target.clone().sub(source);
    const length = axis.length();
    if (length < .1) continue;
    axis.divideScalar(length);
    const startRadius = light.startRadius ?? light.topRadius ?? .7;
    const endRadius = light.endRadius ?? light.radius ?? 3;
    // A moving pendant scales a unit-height frustum. This updates its bounds
    // and light ray together without rebuilding geometry as the wire swings.
    const geometry = new THREE.CylinderGeometry(startRadius, endRadius, light.moving ? 1 : length, 20, 1, false);
    geometries.add(geometry);
    const material = volumeMaterial(shaftFragment);
    material.uniforms = {
      uSource: { value: source }, uAxis: { value: axis }, uLength: { value: length },
      uStartRadius: { value: startRadius }, uEndRadius: { value: endRadius },
      uColor: { value: new THREE.Color(light.color ?? '#bcb8a3').multiplyScalar(1.2) },
      uDensity: { value: light.density ?? .018 }, uTime: timeUniform,
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Archive light volume ${index + 1}`;
    mesh.position.copy(source).add(target).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis);
    if (light.moving) {
      mesh.scale.y = length;
      movingShafts.push({ light, mesh, source, target, axis });
    }
    mesh.renderOrder = 3;
    mesh.userData.atmosphere = 'shaft';
    root.add(mesh);
    shafts.push(mesh);
  }

  const sphere = new THREE.SphereGeometry(1, 20, 10);
  geometries.add(sphere);
  const depth = bounds.maxZ - bounds.minZ;
  const width = bounds.maxX - bounds.minX;
  const centerX = (bounds.minX + bounds.maxX) * .5;
  // Deeper haze sits in the unlit storage bays, leaving the bright central
  // aisle and nearby object silhouettes clear. All banks stop above the floor.
  const bankCount = 12;
  for (let i = 0; i < bankCount; i++) {
    const row = Math.floor(i / 2);
    const nearCollection = row === 0;
    const center = new THREE.Vector3(
      centerX + (i % 2 ? 1 : -1) * Math.min(nearCollection ? 11 : 28, width * (nearCollection ? .115 : .3)),
      nearCollection ? .48 : .64,
      bounds.maxZ - 22 - row * (depth - 40) / 5,
    );
    const radii = new THREE.Vector3(
      Math.min(nearCollection ? 7 : 14, width * (nearCollection ? .075 : .15)),
      nearCollection ? .42 : .58,
      nearCollection ? 11 : 14,
    );
    const material = volumeMaterial(mistFragment);
    material.uniforms = {
      uCenter: { value: center }, uRadii: { value: radii },
      uColor: { value: new THREE.Color('#827f71') }, uTime: timeUniform,
    };
    const mesh = new THREE.Mesh(sphere, material);
    mesh.name = `Low archive mist ${i + 1}`;
    mesh.position.copy(center);
    mesh.scale.copy(radii);
    mesh.renderOrder = 2;
    mesh.userData.atmosphere = 'mist';
    root.add(mesh);
    banks.push(mesh);
  }

  let seed = 0x71a79;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const particleCount = 900;
  const positions = new Float32Array(particleCount * 3);
  const phases = new Float32Array(particleCount);
  const sizes = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    positions.set([(random() - .5) * 48, .4 + random() * 12, (random() - .5) * 48], i * 3);
    phases[i] = random() * Math.PI * 2;
    sizes[i] = .7 + random() * .6;
  }
  const dustGeometry = new THREE.BufferGeometry();
  geometries.add(dustGeometry);
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dustGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const dustMaterial = new THREE.ShaderMaterial({
    vertexShader: dustVertex, fragmentShader: dustFragment,
    uniforms: {
      uTime: timeUniform, uViewer: viewerUniform, uPixelScale: { value: 800 },
      uBounds: { value: new THREE.Vector4(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ) },
    },
    transparent: true, depthTest: true, depthWrite: false, fog: false,
  });
  materials.add(dustMaterial);
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.name = 'Archive dust motes';
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  dust.onBeforeRender = (_renderer, _scene, camera) => {
    _renderer.getCurrentViewport(viewport);
    dustMaterial.uniforms.uPixelScale.value = viewport.w * camera.projectionMatrix.elements[5] * .5;
  };
  root.add(dust);

  const stats = {
    lightVolumes: shafts.length, shaftSamples: 10,
    movingLightVolumes: movingShafts.length,
    mistBanks: banks.length, mistSamples: 6, dustParticles: particleCount,
    extraScenePasses: 0,
  };
  return {
    root, stats,
    update(dt, time, viewerPosition) {
      timeUniform.value = Number.isFinite(time) ? time : timeUniform.value + Math.min(dt, .1);
      if (viewerPosition) viewerUniform.value.copy(viewerPosition);
      for (const { light, mesh, source, target, axis } of movingShafts) {
        source.copy(light.source);
        target.copy(light.target);
        axis.subVectors(target, source);
        const length = axis.length();
        mesh.visible = length >= .1;
        if (!mesh.visible) continue;
        axis.divideScalar(length);
        mesh.material.uniforms.uLength.value = length;
        mesh.position.copy(source).add(target).multiplyScalar(.5);
        mesh.quaternion.setFromUnitVectors(_down, axis);
        mesh.scale.y = length;
      }
    },
    dispose() {
      root.removeFromParent();
      root.clear();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
}
