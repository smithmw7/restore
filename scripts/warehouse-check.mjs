import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarehouseGameplay, createCrateSpecs, WAREHOUSE_BOUNDS } from '../src/warehouse-gameplay.js';

const scene = new THREE.Scene();
const events = [];
const checks = [];
const game = await createWarehouseGameplay({ scene, onEvent: (event) => events.push(event) });
const initialMeshCount = scene.children.length;
const initialPhysics = { ...game.getState().physics };
const vector = (array) => new THREE.Vector3().fromArray(array);
const advance = (seconds) => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) game.step(1 / 60); };
const check = (name, fn) => { try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } checks.push(name); };
const findObject = (id) => scene.children.find((mesh) => mesh.userData.labObject === id && mesh.userData.kind === 'artifact');
const piecesOf = (id) => scene.children.filter((mesh) => mesh.userData.labObject === id && mesh.userData.kind === 'fragment');
const stateOf = (id) => game.getState().objects.find((object) => object.id === id);

try {
  check('24 seeded crates vary in size, include stacks, and fully hide their artifacts', () => {
    const specs = createCrateSpecs();
    assert.deepEqual(specs, createCrateSpecs());
    assert.notDeepEqual(specs, createCrateSpecs(24, 701));
    assert.equal(game.getState().closedCrates, 24);
    assert.equal(game.targets.length, 24);
    assert.equal(game.grabTargets.length, 24);
    assert.equal(new Set(specs.map((spec) => spec.width)).size, 4);
    assert.ok(specs.some((spec) => spec.y > 1.5));
    assert.ok(game.targets.every((mesh) => mesh.userData.kind === 'crate'));
    assert.ok(game.getState().objects.every((object) => object.state === 'hidden'));
    assert.ok(scene.children.filter((mesh) => mesh.userData.kind === 'artifact').every((mesh) => !mesh.visible));
  });

  const crate = game.targets.find((mesh) => mesh.userData.labObject === 'crate-02');
  const crateStart = crate.position.clone();
  const grabPoint = crateStart.clone().add(new THREE.Vector3(0.05, 0.1, 0.15));
  const destination = new THREE.Vector3(0, 1.6, -10);
  check('a whole crate can be grabbed with easing and single-hand ownership', () => {
    assert.equal(game.beginGrab(crate, grabPoint, 'left'), true);
    assert.equal(game.beginGrab(game.targets[0], game.targets[0].position.clone(), 'right'), false);
    assert.equal(game.moveGrab(destination, 'right'), false);
    assert.equal(game.endGrab('right'), false);
    assert.equal(game.hit(crate, crate.position, new THREE.Vector3(0, 0, -1)), false);
    assert.equal(game.moveGrab(destination.clone().add(grabPoint.clone().sub(crateStart)), 'left'), true);
    assert.ok(crate.position.distanceTo(crateStart) < 1e-6);
    game.step(1 / 60);
    assert.ok(crate.position.distanceTo(crateStart) > 0);
    assert.ok(crate.position.distanceTo(destination) > 1);
    advance(2);
    assert.ok(crate.position.distanceTo(destination) < 0.01);
    assert.equal(game.getGrabState().kind, 'crate');
    assert.equal(game.getGrabState().whole, true);
    assert.equal(game.getGrabState().heldMesh, crate);
    assert.equal(game.getGrabState().radius, 0);
    assert.equal(game.getState().revealedArtifacts, 0);
  });

  check('release plays one wood drop and breaking reveals a physically contained artifact at its moved position', () => {
    const eventStart = events.length;
    assert.equal(game.endGrab('left'), true);
    assert.equal(events.slice(eventStart).filter((event) => event.type === 'drop').length, 1);
    assert.equal(game.hit(crate, crate.position.clone(), new THREE.Vector3(0, 0, -1)), true);
    assert.equal(crate.visible, false);
    assert.equal(game.getState().openedCrates, 1);
    const artifact = findObject('artifact-02');
    assert.ok(artifact.visible);
    assert.ok(artifact.position.distanceTo(destination) < 0.5);
    assert.ok(game.targets.includes(artifact));
    assert.ok(game.grabTargets.includes(artifact));
    assert.equal(scene.children.filter((mesh) => mesh.userData.labObject === 'crate-02' && mesh.userData.panelIndex !== undefined && mesh.visible).length, 6);
    assert.ok(events.slice(eventStart).some((event) => event.type === 'break' && event.soundId === 'cube'));
    assert.ok(!game.occluders.includes(crate));
  });

  const artifact = findObject('artifact-02');
  const artifactHomes = new Map(piecesOf('artifact-02').map((piece) => [piece, piece.position.clone()]));
  const homeRotations = new Map(piecesOf('artifact-02').map((piece) => [piece, piece.quaternion.clone()]));
  artifactHomes.set(artifact, artifact.position.clone());
  homeRotations.set(artifact, artifact.quaternion.clone());
  const breakLocation = new THREE.Vector3(0, 1.1, -17);
  check('revealed whole artifacts can be moved deep into the warehouse and broken at their current pose', () => {
    assert.equal(game.beginGrab(artifact, artifact.position.clone(), 'right'), true);
    game.moveGrab(breakLocation, 'right');
    advance(2);
    assert.ok(artifact.position.distanceTo(breakLocation) < 0.01);
    assert.equal(game.getGrabState().whole, true);
    assert.equal(game.getState().broken, 0, 'moving whole artifacts must not count as destruction');
    assert.equal(game.endGrab('right'), true);
    assert.equal(game.hit(artifact, artifact.position.clone(), new THREE.Vector3(0, 0, -1)), true);
    assert.equal(artifact.visible, false);
    assert.equal(game.getState().broken, 1);
    const fragments = piecesOf('artifact-02');
    assert.ok(fragments.length > 5 && fragments.every((piece) => piece.visible));
    assert.ok(fragments.every((piece) => piece.position.distanceTo(breakLocation) < 0.7), 'fracture jumped back to the packed crate');
    assert.ok(fragments.every((piece) => piece.userData.soundId === 'gem'));
    assert.ok(events.some((event) => event.type === 'break' && event.objectId === 'artifact-02'));
  });

  check('artifact shards retain magnetic reconstruction after being moved and released', () => {
    advance(8);
    const fragments = piecesOf('artifact-02');
    const first = fragments.at(-1);
    assert.equal(game.beginGrab(first, first.position.clone(), 'left'), true);
    let seconds = 0;
    while (!game.getGrabState().complete && seconds < 45) {
      const grab = game.getGrabState();
      const anchor = vector(grab.anchor);
      const rotation = grab.heldMesh.quaternion.clone().multiply(homeRotations.get(grab.heldMesh).clone().invert());
      const candidates = fragments.filter((piece) => piece.visible && piece !== grab.heldMesh)
        .map((piece) => ({ piece, offset: artifactHomes.get(piece).clone().sub(artifactHomes.get(grab.heldMesh)).applyQuaternion(rotation) }))
        .filter(({ piece, offset }) => piece.position.distanceTo(anchor.clone().add(offset)) > 0.045)
        .sort((a, b) => a.piece.position.distanceTo(anchor) - b.piece.position.distanceTo(anchor));
      assert.ok(candidates.length, 'no loose candidate remained before completion');
      const candidate = candidates[0];
      const before = grab.assembled;
      for (let frame = 0; frame < 240; frame++) {
        game.moveGrab(candidate.piece.position.clone().sub(candidate.offset), 'left');
        game.step(1 / 60); seconds += 1 / 60;
        if (game.getGrabState().complete || game.getGrabState().assembled > before) break;
      }
    }
    assert.equal(game.getGrabState().complete, true, `assembly stalled at ${JSON.stringify(stateOf('artifact-02'))}`);
    assert.equal(game.getGrabState().whole, false, 'a repaired artifact must end its drag texture');
    assert.equal(game.getGrabState().heldMesh, artifact);
    assert.ok(artifact.visible);
    assert.ok(events.some((event) => event.type === 'complete' && event.objectId === 'artifact-02'));
    assert.equal(game.endGrab('left'), true);
    assert.ok(game.grabTargets.includes(artifact));
  });

  check('loose crate boards remain movable and cancellation produces no drop', () => {
    const board = scene.children.find((mesh) => mesh.userData.labObject === 'crate-02' && mesh.userData.panelIndex === 0);
    assert.ok(game.grabTargets.includes(board));
    assert.equal(game.beginGrab(board, board.position.clone(), 'right'), true);
    game.moveGrab(new THREE.Vector3(1, 1, -15), 'right');
    advance(1.5);
    const count = events.filter((event) => event.type === 'drop').length;
    assert.equal(game.cancelGrabs(), true);
    assert.equal(game.getGrabState().active, false);
    assert.equal(events.filter((event) => event.type === 'drop').length, count);
    assert.equal(events.at(-1).reason, 'cancelled');
  });

  check('navigation excludes opened crates and includes closed stacks at their current positions', () => {
    const boxes = game.getObstacles();
    assert.equal(boxes.length, 23);
    assert.ok(boxes.every((box) => box.isBox3 && !box.isEmpty()));
    assert.ok(boxes.some((box) => box.min.y > 0.8), 'upper stack missing its navigation obstacle');
    assert.ok(!boxes.some((box) => box.containsPoint(destination)), 'opened crate still blocks teleporting');
    assert.ok(game.getState().objects.every((object) => object.position.every(Number.isFinite)));
    assert.ok(WAREHOUSE_BOUNDS.minZ < -25);
  });

  check('reset and repeated crate cycles reuse every mesh and restore the original physics budget', () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(game.restore(), true);
      assert.equal(game.getState().openedCrates, 0);
      assert.equal(game.getState().broken, 0);
      assert.equal(game.getGrabState().active, false);
      assert.equal(game.targets.length, 24);
      assert.equal(new Set(game.targets).size, 24);
      assert.equal(new Set(game.grabTargets).size, 24);
      assert.equal(scene.children.length, initialMeshCount);
      assert.deepEqual(game.getState().physics, initialPhysics);
      assert.ok(game.getState().objects.every((object) => object.state === 'hidden'));
      assert.equal(game.hit(crate, crate.position.clone(), new THREE.Vector3(0, 0, -1)), true);
      advance(0.6);
    }
    game.restore();
  });

  check('crate and artifact collisions produce bounded material-specific audio callbacks', () => {
    const collisions = events.filter((event) => event.type === 'collision');
    assert.ok(collisions.length > 0);
    assert.ok(collisions.some((event) => event.objectId.startsWith('crate-') && event.soundId === 'cube'));
    for (const event of events) {
      assert.ok(event.position?.isVector3 && event.position.toArray().every(Number.isFinite));
      assert.ok(event.soundId);
      if ('strength' in event) assert.ok(event.strength > 0 && event.strength <= 1);
    }
  });

  check('aged crates fall after a stationary release, a long hold, or cancelled tracking', () => {
    for (const { holdSeconds, cancelled } of [
      { holdSeconds: 2, cancelled: false },
      { holdSeconds: 20, cancelled: false },
      { holdSeconds: 2, cancelled: true },
    ]) {
      game.restore();
      advance(20);
      assert.equal(game.beginGrab(crate, crate.position.clone(), 'left'), true);
      game.moveGrab(new THREE.Vector3(0, 3, -10), 'left');
      advance(holdSeconds);
      const releaseY = crate.position.y;
      assert.ok(releaseY > 2.95);
      assert.ok(game.getGrabState().speed < 0.01, 'release from a still hand');
      const dropCount = events.filter((event) => event.type === 'drop').length;
      assert.equal(game.endGrab('left', { cancelled }), true);
      assert.equal(game.getGrabState().active, false);
      assert.equal(events.filter((event) => event.type === 'drop').length, dropCount + (cancelled ? 0 : 1));
      advance(0.4);
      assert.ok(crate.position.y < releaseY - 0.4, `released crate stayed suspended at ${crate.position.y}`);
      advance(3);
      const halfHeight = game.getState().crates.find((item) => item.id === 'crate-02').dimensions[1] / 2;
      assert.ok(Math.abs(crate.position.y - halfHeight) < 0.08, 'crate lands on the floor');
    }
  });

  check('aged loose boards fall again after being picked up and released', () => {
    game.restore();
    game.hit(crate, crate.position.clone(), new THREE.Vector3(0, 0, -1));
    advance(20);
    const board = scene.children.find((mesh) => mesh.userData.labObject === 'crate-02' && mesh.userData.panelIndex === 0);
    assert.equal(game.beginGrab(board, board.position.clone(), 'right'), true);
    game.moveGrab(new THREE.Vector3(0, 3, -10), 'right');
    advance(2);
    const releaseY = board.position.y;
    assert.ok(releaseY > 2.95);
    assert.equal(game.endGrab('right'), true);
    advance(0.4);
    assert.ok(board.position.y < releaseY - 0.4, 'released board stayed suspended');
    game.restore();
  });

  check('alien thruster, reactor, hull and coupler shards independently reconstruct', () => {
    for (const id of ['artifact-01', 'artifact-03', 'artifact-04', 'artifact-05']) {
      game.restore();
      const container = game.targets.find((mesh) => mesh.userData.labObject === id.replace('artifact', 'crate'));
      assert.equal(game.hit(container, container.position.clone(), new THREE.Vector3(0, 0, -1)), true);
      const artifact = findObject(id), fragments = piecesOf(id);
      const homes = new Map(fragments.map((piece) => [piece, piece.position.clone()]));
      const rotations = new Map(fragments.map((piece) => [piece, piece.quaternion.clone()]));
      assert.equal(game.beginGrab(artifact, artifact.position.clone(), 'left'), true);
      game.moveGrab(new THREE.Vector3(0, 1.8, -18), 'left');
      advance(2); game.endGrab('left');
      assert.equal(game.hit(artifact, artifact.position.clone(), new THREE.Vector3(0, 0, -1)), true);
      advance(4);
      const anchorPiece = fragments.at(-1);
      assert.equal(game.beginGrab(anchorPiece, anchorPiece.position.clone(), 'left'), true);
      for (let frame = 0; frame < 60 * 45 && !game.getGrabState().complete; frame++) {
        const grab = game.getGrabState(), anchor = vector(grab.anchor);
        const rotation = anchorPiece.quaternion.clone().multiply(rotations.get(anchorPiece).clone().invert());
        const candidates = fragments.map((piece) => ({ piece, offset: homes.get(piece).clone().sub(homes.get(anchorPiece)).applyQuaternion(rotation) }))
          .filter(({ piece, offset }) => piece.position.distanceTo(anchor.clone().add(offset)) > 0.045)
          .sort((a, b) => a.piece.position.distanceTo(anchor) - b.piece.position.distanceTo(anchor));
        // Thin mechanical fragments can already be within the positional
        // threshold while their rotation is still easing into its snap.
        if (candidates.length) game.moveGrab(candidates[0].piece.position.clone().sub(candidates[0].offset), 'left');
        game.step(1 / 60);
      }
      assert.equal(game.getGrabState().complete, true, `${id} did not reconstruct`);
      assert.equal(game.getGrabState().heldMesh, artifact);
      assert.ok(events.some((event) => event.type === 'complete' && event.objectId === id));
      game.endGrab('left');
    }
    game.restore();
  });
  console.log(JSON.stringify({ passed: true, checks, meshCount: initialMeshCount, physics: game.getState().physics, events: events.length }, null, 2));
} finally {
  game.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(game.targets.length, 0);
  assert.equal(game.grabTargets.length, 0);
}
