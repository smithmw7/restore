import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cosmetic geometry stays inside, or within a few millimetres of, each
// canonical component. No downloaded textures, extra collision bodies or
// shadow maps are needed for the restoration mechanism.
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const palette = { bronze: '#a58c66', copper: '#bd8564', dark: '#292f2d', ceramic: '#ded8bd', nickel: '#aeb6a9' };
const clamp = (n, lo = 0, hi = 1) => THREE.MathUtils.clamp(Number.isFinite(n) ? n : lo, lo, hi);

export function createFieldPresentation({ root, parts, origin, seat }) {
  const resourceGeometry = new Set(), resourceMaterial = new Set(), details = [];
  const partById = new Map(parts.map(p => [p.id, p]));
  const effectRoot = new THREE.Group();
  effectRoot.name = 'Local restoration field';
  root.add(effectRoot);
  const geometry = g => (resourceGeometry.add(g), g);
  const material = m => (resourceMaterial.add(m), m);
  const detailMaterial = material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .48, metalness: .67 }));
  let decorativeTriangles = 0;

  function addDetail(p) {
    const chunks = [];
    function piece(g, color, position = [0, 0, 0], rotation = [0, 0, 0]) {
      g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]); g.translate(...position);
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      flat.deleteAttribute('uv');
      const rgb = new THREE.Color(color), count = flat.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) rgb.toArray(colors, i * 3);
      flat.setAttribute('color', new THREE.BufferAttribute(colors, 3)); chunks.push(flat);
    }
    function box(size, position, color = palette.bronze, rotation) { piece(new THREE.BoxGeometry(...size), color, position, rotation); }
    function band(radius, height, position, color = palette.bronze, rotation) {
      piece(new THREE.CylinderGeometry(radius, radius, height, 12, 1), color, position, rotation);
    }
    if (p.id.startsWith('frame-')) {
      const [, layerValue, indexValue] = p.id.split('-');
      const layer = Number(layerValue), index = Number(indexValue), turn = index * Math.PI / 2 + .05;
      const localOrigin = origin.clone().sub(p.goal);
      const point = a => new THREE.Vector3(Math.cos(a) * .74, layer * .95, Math.sin(a) * .74)
        .applyAxisAngle(UP, turn).add(localOrigin);
      // Exact canonical torus basis: the source arc rotates onto XZ, then
      // around Y. Four clamped collars read as separate machined joints.
      for (const t of [.045, .28, .68, .945]) {
        const a = t * (Math.PI / 2 - .1), position = point(a);
        const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).applyAxisAngle(UP, turn);
        const collar = new THREE.CylinderGeometry(.068, .068, t < .1 || t > .9 ? .032 : .018, 12);
        collar.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, tangent));
        piece(collar, t < .1 || t > .9 ? palette.nickel : palette.bronze, position.toArray());
        const screw = position.clone().add(new THREE.Vector3(0, .065, 0));
        band(.010, .006, screw.toArray(), palette.dark);
      }
      const rail = new THREE.TorusGeometry(.74, .009, 4, 20, Math.PI / 2 - .29);
      rail.rotateX(Math.PI / 2); rail.rotateY(turn + .095);
      piece(rail, palette.dark, [localOrigin.x, localOrigin.y + layer * .95 + .056, localOrigin.z]);
      for (const t of [.19, .47, .77]) {
        const position = point(t * (Math.PI / 2 - .1)); position.y += .057;
        box([.030, .012, .048], position.toArray(), palette.ceramic, [0, turn - t * (Math.PI / 2 - .1), 0]);
      }
    } else if (p.id.startsWith('strut-')) {
      for (const y of [-.356, -.29, .27, .352]) band(.080 - y * .025, .023, [0, y, 0], y > .3 || y < -.3 ? palette.nickel : palette.bronze);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        box([.025, .43, .010], [Math.sin(a) * .070, -.018, Math.cos(a) * .070], palette.dark, [0, a, 0]);
        box([.010, .30, .013], [Math.sin(a) * .072, -.012, Math.cos(a) * .072], palette.ceramic, [0, a, 0]);
      }
      band(.069, .035, [0, .393, 0], palette.dark);
    } else if (p.id.startsWith('shield-')) {
      const index = Number(p.id.split('-')[1]), a = -index * Math.PI / 2 + Math.PI / 4;
      const rotate = point => new THREE.Vector3(...point).applyAxisAngle(UP, -a).toArray();
      for (const face of [-1, 1]) {
        for (const x of [-.104, .104]) box([.018, .39, .008], rotate([x, 0, face * .049]), palette.bronze, [0, -a, 0]);
        for (const y of [-.19, .19]) box([.218, .022, .008], rotate([0, y, face * .049]), palette.bronze, [0, -a, 0]);
        for (const x of [-.099, .099]) for (const y of [-.181, .181]) {
          const screw = new THREE.CylinderGeometry(.009, .009, .008, 8); screw.rotateX(Math.PI / 2); screw.rotateY(-a);
          piece(screw, palette.dark, rotate([x, y, face * .055]));
        }
        for (const x of [-.055, 0, .055]) box([.005, .235, .004], rotate([x, .007, face * .052]), palette.dark, [0, -a, 0]);
        box([.068, .037, .007], rotate([0, -.142, face * .052]), palette.nickel, [0, -a, 0]);
      }
    } else if (p.id.startsWith('emitter-')) {
      for (let i = 0; i < 7; i++) {
        const y = -.077 + i * .024, radius = .085 - y * .125;
        const coil = new THREE.TorusGeometry(radius, .006, 4, 16); coil.rotateX(Math.PI / 2);
        piece(coil, palette.copper, [0, y, 0]);
      }
      band(.104, .025, [0, -.108, 0], palette.dark);
      band(.077, .025, [0, .108, 0], palette.nickel);
      band(.050, .007, [0, .124, 0], palette.ceramic);
      for (const x of [-.026, .026]) box([.007, .010, .029], [x, .128, 0], palette.dark);
    } else if (p.id === 'field-lens') {
      for (const y of [-.032, .032]) {
        const rim = new THREE.TorusGeometry(.219, .012, 4, 24); rim.rotateX(Math.PI / 2);
        piece(rim, palette.bronze, [0, y, 0]);
      }
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8;
        box([.026, .072, .029], [Math.sin(a) * .213, 0, Math.cos(a) * .213], palette.nickel, [0, a, 0]);
      }
      const inner = new THREE.TorusGeometry(.125, .003, 3, 24); inner.rotateX(Math.PI / 2);
      piece(inner, palette.ceramic, [0, .037, 0]);
    } else if (p.id === 'core') {
      // Etched edges follow the original icosahedron instead of inflating its
      // collision envelope with an orbiting decoration.
      const wire = new THREE.EdgesGeometry(p.geometry, 16), pos = wire.getAttribute('position');
      for (let i = 0; i < pos.count; i += 2) {
        const from = new THREE.Vector3().fromBufferAttribute(pos, i).multiplyScalar(1.006);
        const to = new THREE.Vector3().fromBufferAttribute(pos, i + 1).multiplyScalar(1.006);
        const edge = new THREE.CylinderGeometry(.0018, .0018, from.distanceTo(to), 3);
        edge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize()));
        piece(edge, palette.nickel, from.add(to).multiplyScalar(.5).toArray());
      }
      wire.dispose();
    }
    if (!chunks.length) return;
    const merged = geometry(mergeGeometries(chunks)); chunks.forEach(g => g.dispose());
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    decorativeTriangles += merged.getAttribute('position').count / 3;
    const mesh = new THREE.Mesh(merged, detailMaterial);
    mesh.name = `${p.id} / machined fittings`; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.raycast = () => {};
    p.mesh.add(mesh); details.push(mesh);
  }
  parts.forEach(addDetail);

  function glowMaterial(color, intensity = 1) {
    return material(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: intensity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false }));
  }
  const connectorGeometry = geometry(new THREE.TorusGeometry(.025, .0028, 4, 20, TAU * .82));
  const connectorMaterial = glowMaterial('#8ad8b8', 0);
  const connector = new THREE.InstancedMesh(connectorGeometry, connectorMaterial, 2);
  connector.name = 'Matching local key inlays'; connector.frustumCulled = false; connector.raycast = () => {}; connector.visible = false;
  effectRoot.add(connector);

  const conduitGeometry = geometry(new THREE.TorusGeometry(.740, .003, 4, 20, Math.PI / 2 - .17));
  conduitGeometry.rotateX(Math.PI / 2);
  const conduitMaterial = glowMaterial('#8ec4a1', 0);
  const conduits = new THREE.InstancedMesh(conduitGeometry, conduitMaterial, 8);
  conduits.name = 'Installed frame conduits'; conduits.frustumCulled = false; conduits.raycast = () => {};
  effectRoot.add(conduits);

  // Soft volumetric-looking light in a confined cage. The shader is a cheap
  // surface field, not a fullscreen pass; normal depth testing hides it behind
  // the workshop, shipping container, and solid pieces.
  const fieldMaterial = material(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { time: { value: 0 }, strength: { value: 0 }, surge: { value: 0 } },
    vertexShader: `varying vec3 vLocal; varying vec3 vNormal; varying vec3 vView;
      void main(){vLocal=position; vec4 mv=modelViewMatrix*vec4(position,1.0);vView=normalize(-mv.xyz);vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform float time; uniform float strength; uniform float surge;
      varying vec3 vLocal; varying vec3 vNormal; varying vec3 vView;
      void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),2.4);
        float veil=.44+.27*sin(vLocal.y*19.0-time*.6)+.16*sin(vLocal.x*26.0+vLocal.z*21.0+time*.35);
        float equator=exp(-abs(vLocal.y)*16.0);float latitude=pow(.5+.5*cos(vLocal.y*47.0-time*.4),12.0);
        float alpha=strength*(rim*.24*veil+equator*.055+latitude*.023)*(1.0+surge*.7);
        gl_FragColor=vec4(mix(vec3(.25,.55,.43),vec3(.67,.87,.66),surge*.6),alpha);}`
  }));
  const field = new THREE.Mesh(geometry(new THREE.SphereGeometry(.43, 24, 14)), fieldMaterial);
  field.name = 'Contained suspended field'; field.position.copy(origin).add(new THREE.Vector3(0, .48, 0)); field.scale.y = .74;
  field.raycast = () => {}; field.visible = false; effectRoot.add(field);
  const haloMaterial = glowMaterial('#a6d5b4', 0);
  const halo = new THREE.Mesh(geometry(new THREE.TorusGeometry(.35, .0028, 4, 48)), haloMaterial);
  halo.name = 'Confined field horizon'; halo.rotation.x = Math.PI / 2; halo.position.copy(field.position); halo.raycast = () => {}; effectRoot.add(halo);

  const dustCount = 96, dustPositions = new Float32Array(dustCount * 3), dustSeeds = [];
  let randomSeed = 0x17c42;
  const random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 0x100000000; };
  for (let i = 0; i < dustCount; i++) dustSeeds.push({ phase: random() * TAU, radius: .18 + random() * .39, y: random() * .83, speed: .10 + random() * .18 });
  const dustGeometry = geometry(new THREE.BufferGeometry()); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const dustMaterial = material(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { strength: { value: 0 } },
    vertexShader: `uniform float strength; varying float opacity; void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);opacity=strength;gl_PointSize=clamp(10.0/max(1.0,-mv.z),1.0,3.3);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying float opacity;void main(){float r=length(gl_PointCoord-.5)*2.0;float a=pow(max(0.0,1.0-r),2.0);gl_FragColor=vec4(.67,.81,.62,a*opacity);}`
  }));
  const dust = new THREE.Points(dustGeometry, dustMaterial); dust.name = 'Field motes'; dust.position.copy(origin); dust.frustumCulled = false; dust.raycast = () => {}; effectRoot.add(dust);
  const fieldLight = new THREE.PointLight('#98cdb0', 0, 2.4, 2); fieldLight.position.copy(field.position); fieldLight.castShadow = false; effectRoot.add(fieldLight);

  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Quaternion();
  const localConnector = new THREE.Vector3(), targetConnector = new THREE.Vector3(), heldConnector = new THREE.Vector3(), connectorNormal = new THREE.Vector3();
  const temp = new THREE.Object3D(), connectorCache = new Map();
  function connectionFor(p) {
    const support = p.requires.map(id => partById.get(id)).find(part => part?.installed);
    const key = `${p.id}:${support?.id || 'foundation'}`;
    if (connectorCache.has(key)) return connectorCache.get(key);
    p.geometry.computeBoundingBox();
    const normal = support ? support.goal.clone().sub(p.goal).normalize() : UP.clone();
    const desired = normal.clone().multiplyScalar(8).clamp(p.geometry.boundingBox.min, p.geometry.boundingBox.max);
    const vertices = p.geometry.getAttribute('position'), normals = p.geometry.getAttribute('normal');
    const candidate = new THREE.Vector3(), point = new THREE.Vector3(), faceNormal = normal.clone();
    let nearest = Infinity;
    for (let i = 0; i < vertices.count; i++) {
      candidate.fromBufferAttribute(vertices, i);
      const distance = candidate.distanceToSquared(desired);
      if (distance < nearest) { nearest = distance; point.copy(candidate); if (normals) faceNormal.fromBufferAttribute(normals, i); }
    }
    // On curved or hollow components an AABB face can lie in empty space.
    // Choose a real surface vertex and its normal, cached once per socket.
    faceNormal.normalize(); point.addScaledVector(faceNormal, .0035);
    const value = { point, normal: faceNormal }; connectorCache.set(key, value); return value;
  }
  let disposed = false, easedSignal = 0, energy = 0, invitationOpacity = 0;
  const firstFrame = partById.get('frame-0-0');
  // An upright mark on the outer rim is readable from the player's approach.
  // A horizontal mark on this thin torus would be only a subpixel at eye level.
  const firstRadial = firstFrame ? firstFrame.goal.clone().sub(origin).setY(0).normalize() : new THREE.Vector3(1, 0, 0);
  const invitationNormal = firstRadial.clone();
  let invitationPoint = null, invitationFace = null;
  if (firstFrame) {
    const desired = firstRadial.clone().multiplyScalar(.805).add(origin).sub(firstFrame.goal);
    const vertices = firstFrame.geometry.getAttribute('position'), normals = firstFrame.geometry.getAttribute('normal');
    const candidate = new THREE.Vector3(); let nearest = Infinity;
    invitationPoint = new THREE.Vector3(); invitationFace = invitationNormal.clone();
    for (let i = 0; i < vertices.count; i++) {
      candidate.fromBufferAttribute(vertices, i);
      const distance = candidate.distanceToSquared(desired);
      if (distance < nearest) { nearest = distance; invitationPoint.copy(candidate); if (normals) invitationFace.fromBufferAttribute(normals, i); }
    }
    invitationFace.normalize(); invitationPoint.addScaledVector(invitationFace, .004);
  }
  const state = { stage: 0, energy: 0, connectorVisible: false, connectorInvitation: false, invitationOpacity: 0, connectorDistance: null, connectorTarget: null, connectorHeld: null, decorativeTriangles, decorativeMeshes: details.length, pooledParticles: dustCount, shadowMaps: 0, downloadedAssets: 0 };

  function update({ dt = 1 / 60, elapsed = 0, heldId = null, eligible = false, separation = Infinity, alignment = 0, signal = 0, stage = 0, stageAge = 0, completed = false, activationAge = 0, viewerPosition, gauntletEquipped = false } = {}) {
    if (disposed) return;
    dt = clamp(dt, 0, .1); elapsed = Number.isFinite(elapsed) ? elapsed : 0;
    stage = clamp(stage, 0, 4); stageAge = Math.max(0, Number.isFinite(stageAge) ? stageAge : 0); activationAge = Math.max(0, Number.isFinite(activationAge) ? activationAge : 0);
    const heldPart = partById.get(heldId?.replace?.(/^mechanism-/, ''));
    const alignmentAmount = typeof alignment === 'boolean' ? Number(alignment) : clamp(alignment);
    const sensed = eligible && heldPart ? clamp(typeof signal === 'number' ? signal : 1 - separation / 1.3) : 0;
    easedSignal += (sensed - easedSignal) * (1 - Math.exp(-dt * 10));
    const alignmentVisible = Boolean(heldPart && eligible && sensed > .015);
    const compatibleHold = !heldPart || heldPart.id === firstFrame?.id;
    const invitationAllowed = !!(firstFrame?.prepared && !firstFrame.installed && gauntletEquipped
      && viewerPosition?.isVector3 && viewerPosition.distanceTo(origin) < 3 && compatibleHold && !alignmentVisible);
    // The first experiment answers a nearby equipped hand very softly. Both
    // marks belong to real surfaces; there is no remote destination ghost.
    invitationOpacity += ((invitationAllowed ? .42 : 0) - invitationOpacity) * (1 - Math.exp(-dt * (invitationAllowed ? 2.5 : 5)));
    state.connectorInvitation = invitationOpacity > .003 && compatibleHold && !alignmentVisible && !firstFrame?.installed;
    state.invitationOpacity = invitationOpacity;
    state.connectorVisible = alignmentVisible || state.connectorInvitation;
    connector.visible = state.connectorVisible;
    state.connectorDistance = null; state.connectorTarget = null; state.connectorHeld = null;
    if (alignmentVisible) {
      const connection = connectionFor(heldPart);
      localConnector.copy(connection.point); connectorNormal.copy(connection.normal);
      targetConnector.copy(heldPart.goal).add(localConnector);
      heldPart.mesh.updateWorldMatrix(true, false); heldConnector.copy(localConnector).applyMatrix4(heldPart.mesh.matrixWorld);
      rotation.setFromUnitVectors(Z, connectorNormal);
      const baseScale = .88 + alignmentAmount * .17;
      scale.setScalar(baseScale); matrix.compose(targetConnector, rotation, scale); connector.setMatrixAt(0, matrix);
      const heldRotation = heldPart.mesh.getWorldQuaternion(temp.quaternion).multiply(rotation);
      matrix.compose(heldConnector, heldRotation, scale); connector.setMatrixAt(1, matrix); connector.instanceMatrix.needsUpdate = true;
      connectorMaterial.opacity = easedSignal * (.24 + alignmentAmount * .6) * (.88 + Math.sin(elapsed * 4.2) * .12);
      connectorMaterial.color.set(eligible && alignmentAmount > .65 ? '#b1dec0' : '#c7af74');
      state.connectorDistance = heldConnector.distanceTo(targetConnector); state.connectorTarget = targetConnector.toArray(); state.connectorHeld = heldConnector.toArray();
    } else if (state.connectorInvitation) {
      firstFrame.mesh.updateWorldMatrix(true, false);
      heldConnector.copy(invitationPoint).applyMatrix4(firstFrame.mesh.matrixWorld);
      // The cradle inlay is 5 mm above its outer skin. Flattening its local Y
      // keeps the whole mark within the narrow tube's visible cross-section.
      targetConnector.copy(firstRadial).multiplyScalar(.74 + .018 + .005).add(origin);
      rotation.setFromUnitVectors(Z, invitationNormal); scale.set(.6, .42, 1);
      matrix.compose(targetConnector, rotation, scale); connector.setMatrixAt(0, matrix);
      rotation.setFromUnitVectors(Z, invitationFace);
      const partRotation = firstFrame.mesh.getWorldQuaternion(temp.quaternion).multiply(rotation);
      matrix.compose(heldConnector, partRotation, scale); connector.setMatrixAt(1, matrix); connector.instanceMatrix.needsUpdate = true;
      connectorMaterial.color.set('#acd7b0'); connectorMaterial.opacity = invitationOpacity;
      state.connectorDistance = heldConnector.distanceTo(targetConnector); state.connectorTarget = targetConnector.toArray(); state.connectorHeld = heldConnector.toArray();
    }
    const agePulse = stage > 0 ? Math.exp(-stageAge * 1.85) : 0;
    const build = completed ? Math.sin(clamp(activationAge / 4) * Math.PI) : 0;
    const targetEnergy = stage >= 4 ? .28 + build * .72 : stage === 3 ? .18 : stage === 2 ? .055 : 0;
    energy += (targetEnergy - energy) * (1 - Math.exp(-dt * 3));
    state.stage = stage; state.energy = energy;
    let conduitIndex = 0;
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 4; i++) {
      const p = partById.get(`frame-${layer}-${i}`);
      position.copy(origin); position.y += layer * .95 + .059;
      rotation.setFromAxisAngle(UP, i * Math.PI / 2 + .085);
      scale.setScalar(p?.installed && (stage >= 1 || easedSignal > .02) ? 1 : 0);
      matrix.compose(position, rotation, scale); conduits.setMatrixAt(conduitIndex++, matrix);
    }
    conduits.instanceMatrix.needsUpdate = true;
    conduitMaterial.opacity = stage >= 2 ? .17 + energy * .45 + agePulse * .25 : agePulse * .46 + easedSignal * .08;
    field.visible = stage >= 3 && energy > .002; fieldMaterial.uniforms.time.value = elapsed; fieldMaterial.uniforms.strength.value = energy; fieldMaterial.uniforms.surge.value = build;
    field.rotation.y = elapsed * .028; field.rotation.z = Math.sin(elapsed * .21) * .015;
    halo.visible = field.visible; haloMaterial.opacity = energy * (.27 + build * .25);
    halo.position.y = origin.y + .48 + Math.sin(elapsed * .35) * .026;
    halo.scale.setScalar(.86 + energy * .28); halo.rotation.z = elapsed * .08;
    dust.visible = stage >= 3; dustMaterial.uniforms.strength.value = energy * (.32 + build * .5);
    for (let i = 0; i < dustCount; i++) {
      const s = dustSeeds[i], a = s.phase + elapsed * s.speed * (.4 + build), r = s.radius * (1 - build * .16);
      dustPositions[i * 3] = Math.cos(a) * r; dustPositions[i * 3 + 1] = .06 + (s.y + elapsed * .022 + build * .09) % .85; dustPositions[i * 3 + 2] = Math.sin(a) * r;
    }
    dustGeometry.attributes.position.needsUpdate = true;
    fieldLight.intensity = energy * 1.15 + agePulse * (stage ? .18 : 0);
    const core = partById.get('core');
    if (core?.installed) {
      core.mesh.material.emissive.set('#77bda2'); core.mesh.material.emissiveIntensity = .15 + energy * 1.5 + Math.sin(elapsed * .8) * energy * .08;
      // A contained shimmer gives the installed core life while its actual
      // visible boundary and physical collider remain at the same position.
      const lens = partById.get('field-lens');
      if (lens?.installed) { lens.mesh.material.emissive.set('#86c4ac'); lens.mesh.material.emissiveIntensity = .06 + energy * .45; }
    }
    if (seat?.material?.emissive) {
      seat.material.emissive.set('#719f80');
      // A soft response in the real metal makes the tiny matching inlay
      // discoverable at eye height. It stays local to a nearby powered player,
      // yields to the physical fit, and never becomes a floating outline.
      const invitationEnergy = compatibleHold && !firstFrame?.installed
        ? invitationOpacity * .7 + (heldPart?.id === firstFrame?.id ? easedSignal * .18 : 0) : 0;
      seat.material.emissiveIntensity = stage >= 2 ? energy * .12 : invitationEnergy;
    }
  }

  update();
  return {
    update,
    getState: () => ({ ...state, disposed }),
    dispose() {
      if (disposed) return; disposed = true;
      details.forEach(mesh => mesh.removeFromParent()); effectRoot.removeFromParent();
      resourceGeometry.forEach(g => g.dispose()); resourceMaterial.forEach(m => m.dispose());
    },
  };
}
