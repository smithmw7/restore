import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDestructionLab } from '../src/destruction.js';
import { ARTIFACT_CATALOG, createArtifactGeometry } from '../src/artifact-forms.js';

const scene = new THREE.Scene(), events = [], checks = [];
const source = new THREE.MeshStandardMaterial({ color: '#ad9471', roughness: .55, metalness: .6 });
const entry = ARTIFACT_CATALOG.find((item) => item.form === 'ion-thruster');
const lab = await createDestructionLab({ scene, pedestals: false, wholeObjects: true,
  specs: ['subject', 'control'].map((id, index) => ({ ...entry, id, x: index * 3, y: 1.2, z: 0,
    color: '#ad9471', fractureKey: entry.form, fractureScale: 1 })),
  geometryForSpec: (spec) => createArtifactGeometry(spec.form),
  fractureGeometryForSpec: (spec) => createArtifactGeometry(spec.form),
  materialForSpec: () => ({ outside: source, inside: source }),
  onEvent: (event) => events.push(event),
});
const state = (id = 'subject') => lab.getState().objects.find((object) => object.id === id);
const mesh = (id = 'subject') => scene.children.find((object) => object.userData.labObject === id && object.userData.kind !== 'fragment');
const fragments = (id = 'subject') => scene.children.filter((object) => object.userData.labObject === id && object.userData.kind === 'fragment');
const step = (seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) lab.step(1 / 60); };
const completions = () => events.filter((event) => event.type === 'complete' && event.objectId === 'subject').length;
const check = (name, test) => { test(); checks.push(name); };

function repairFully() {
  const original = mesh(), pieces = fragments();
  const homes = new Map(pieces.map((piece) => [piece, piece.position.clone()]));
  const rotations = new Map(pieces.map((piece) => [piece, piece.quaternion.clone()]));
  const previousTriggers = state().completion.triggerCount, previousEvents = completions();
  assert.ok(lab.hit(original, original.position.clone(), new THREE.Vector3(0, 0, -1)));
  assert.equal(state().completion.active, false, 'breaking cancels any previous completion effect');
  step(4);
  const first = pieces.at(-1);
  assert.ok(lab.beginGrab(first, first.position.clone()));
  let partialJoins = false;
  for (let frame = 0; frame < 60 * 45 && !lab.getGrabState().complete; frame++) {
    const grab = lab.getGrabState(), anchor = new THREE.Vector3().fromArray(grab.anchor);
    const rotation = first.quaternion.clone().multiply(rotations.get(first).clone().invert());
    const candidates = pieces.map((piece) => ({ piece, offset: homes.get(piece).clone().sub(homes.get(first)).applyQuaternion(rotation) }))
      .filter(({ piece, offset }) => piece.position.distanceTo(anchor.clone().add(offset)) > .025)
      .sort((a, b) => a.piece.position.distanceTo(anchor) - b.piece.position.distanceTo(anchor));
    if (candidates.length) lab.moveGrab(candidates[0].piece.position.clone().sub(candidates[0].offset));
    lab.step(1 / 60);
    const current = state();
    if (!lab.getGrabState().complete) {
      partialJoins ||= lab.getGrabState().assembled > 1;
      assert.equal(current.completion.active, false, 'a partial repair must not glow');
      assert.equal(current.completion.triggerCount, previousTriggers);
      assert.equal(completions(), previousEvents);
    }
    assert.equal(state('control').completion.active, false, 'unrelated object completion state leaked');
    assert.equal(state('control').completion.triggerCount, 0);
  }
  assert.equal(lab.getGrabState().complete, true, `repair stalled at ${lab.getGrabState().assembled}/${pieces.length}`);
  assert.ok(partialJoins, 'fixture must exercise partial repair before final assembly');
  assert.equal(state().completion.active, true);
  assert.equal(state().completion.triggerCount, previousTriggers + 1);
  assert.equal(completions(), previousEvents + 1);
  return state().completion.triggerCount;
}

try {
  check('intact objects and shared source finishes start without completion effects', () => {
    for (const id of ['subject', 'control']) {
      assert.equal(state(id).completion.active, false);
      assert.equal(state(id).completion.triggerCount, 0);
    }
    assert.notEqual(mesh().material, mesh('control').material);
    assert.notEqual(mesh().material, source);
    assert.equal(source.emissiveIntensity, 1);
  });

  const firstCount = repairFully();
  checks.push('actual fracture and magnetic gathering trigger exactly one effect and complete event on the final joined piece only');
  check('completion progresses and fades after 1.25 seconds while the unaffected object stays idle', () => {
    const onset = state().completion.progress;
    step(.5);
    assert.equal(state().completion.active, true);
    assert.ok(state().completion.progress > onset);
    assert.ok(state().completion.progress < 1);
    assert.equal(state('control').completion.active, false);
    step(.8);
    assert.equal(state().completion.active, false);
    assert.equal(state().completion.triggerCount, firstCount);
    assert.equal(completions(), firstCount);
  });

  check('release and pickup of a repaired object do not replay the completion effect', () => {
    lab.endGrab('primary', { cancelled: true });
    assert.ok(lab.beginGrab(mesh(), mesh().position.clone()));
    step(.1);
    assert.equal(state().completion.active, false);
    assert.equal(state().completion.triggerCount, firstCount);
    assert.equal(completions(), firstCount);
    lab.endGrab('primary', { cancelled: true });
  });

  const secondCount = repairFully();
  assert.equal(secondCount, firstCount + 1);
  checks.push('breaking and repairing the same object again produce a new single completion');
  check('breaking during the effect cancels it immediately without triggering another onset', () => {
    lab.endGrab('primary', { cancelled: true });
    assert.ok(lab.hit(mesh(), mesh().position.clone(), new THREE.Vector3(0, 0, -1)));
    assert.equal(state().completion.active, false);
    assert.equal(state().completion.triggerCount, secondCount);
  });

  lab.resetImmediately();
  assert.equal(state().completion.triggerCount, 0);
  repairFully();
  check('a reset cancels an active effect and restores all intact meshes', () => {
    assert.equal(state().completion.active, true);
    lab.resetImmediately();
    assert.equal(state().completion.active, false);
    assert.equal(state().completion.triggerCount, 0);
    assert.equal(state().state, 'intact');
    assert.equal(state('control').completion.active, false);
    assert.ok(mesh().visible && fragments().every((piece) => !piece.visible));
  });
  console.log(JSON.stringify({ passed: true, checks, completeEvents: completions() }, null, 2));
} finally { lab.dispose(); source.dispose(); }
