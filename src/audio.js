const ASSET_BASE = import.meta.env?.BASE_URL || '/';
const FAMILIES = ['glass', 'concrete', 'rock', 'wood', 'metal-light', 'metal-heavy'];
const OBJECT_SOUNDS = Object.freeze({
  vase: 'concrete', cube: 'wood', orb: 'metal-light', gem: 'rock',
  bottle: 'glass', column: 'concrete', ring: 'metal-light', tablet: 'metal-heavy',
});
const REPAIR_FAMILIES = ['pickup', 'drop', 'drag', ...FAMILIES.map(family => `hit-${family}`)];
const ACTION_FAMILIES = ['timber-break', 'wood-creak', 'scrape-wood-concrete', 'scrape-wood-wood', 'metal-creak'];
const OPENING_FAMILIES = ['drawer', 'paper', 'dial', 'latch', 'locker', 'tool', 'cut', 'hinge'];
// Quiet physical Foley. A mechanical fit differs from playComplete's reveal,
// which the game reserves for real milestones.
const PUZZLE_SOUNDS = Object.freeze({
  drawer: { family: 'drawer', gain: .72 },
  notebook: { family: 'paper', gain: .66 },
  dial: { family: 'dial', gain: .7, cooldown: .04 },
  'case-open': { family: 'latch', gain: .72 },
  locker: { family: 'locker', gain: .65 },
  equip: { folder: 'repair', family: 'pickup', gain: .58, variants: 2, priority: 3 },
  'cutter-pickup': { family: 'tool', gain: .65 },
  cut: { family: 'cut', gain: .8, priority: 3 },
  'container-door': { family: 'hinge', gain: .78 },
  photo: { family: 'paper', gain: .42 },
  align: { folder: 'repair', family: 'hit-metal-light', gain: .16, variants: 2, cooldown: .28 },
  install: { family: 'latch', gain: .88, priority: 3 },
});
const ALL_CLIPS = [
  ...FAMILIES.flatMap(family => [1, 2].map(variant => clipUrl('breaks', family, variant))),
  ...REPAIR_FAMILIES.flatMap(family => [1, 2].map(variant => clipUrl('repair', family, variant))),
  ...ACTION_FAMILIES.flatMap(family => [1, 2].map(variant => clipUrl('actions', family, variant))),
  ...OPENING_FAMILIES.map(family => clipUrl('opening', family, 1)),
];
const MAX_VOICES = 12;
const MAX_DRAG_GAIN = 0.12;
const MAX_LOOP_VOICES = 2;
const REVEAL_DURATION = 1.16;
const REVEAL_GAIN = .66;
const DRAG_FAMILIES = Object.freeze({
  'stone-drag': { folder: 'repair', family: 'drag', gain: MAX_DRAG_GAIN },
  'scrape-wood-concrete': { folder: 'actions', family: 'scrape-wood-concrete', gain: MAX_DRAG_GAIN },
  'scrape-wood-wood': { folder: 'actions', family: 'scrape-wood-wood', gain: MAX_DRAG_GAIN },
  // The fixed ceiling tether keeps a lamp much farther from the listener than
  // a held prop; retain an audible creak after positional attenuation.
  'metal-creak': { folder: 'actions', family: 'metal-creak', gain: .22 },
});
const isWoodProp = kind => kind === 'crate' || kind === 'crate-piece';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function clipUrl(folder, family, variant) {
  return `${ASSET_BASE}audio/${folder}/${family}-${String(variant).padStart(2, '0')}.wav`;
}

/** Predecoded, loudness-matched recordings. Playback preserves their original pitch. */
export function createRestoreAudio() {
  let context, master, limiter, muted = false, loaded = 0, playCount = 0, lastClip = null;
  let loadPromise, drag = null, revealBuffer = null, quietContactsUntil = 0, lastContact = -Infinity;
  const buffers = new Map(), previousVariants = new Map(), voices = new Set();
  const revealVoices = new Set();
  const eventCounts = {}, lastEvents = [], lastObjectContact = new Map(), retiringDrags = new Set();
  const lastPuzzle = new Map();

  function getContext() {
    if (context) return context;
    context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.75;
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 3;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    limiter.connect(master).connect(context.destination);
    return context;
  }

  function unlock() {
    const ctx = getContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(error => console.warn('Audio could not resume', error.message));
  }

  function load() {
    loadPromise ??= (async () => {
      const ctx = getContext();
      // Build this once during loading, keeping synthesis off the first
      // completed-repair frame in VR. playComplete still supports lazy use.
      getRevealBuffer();
      await Promise.all(ALL_CLIPS.map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
        buffers.set(url, await ctx.decodeAudioData(await response.arrayBuffer()));
        loaded++;
      }));
    })();
    return loadPromise;
  }

  function movePanner(panner, position) {
    if (!panner || !position) return;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else panner.setPosition(position.x, position.y, position.z);
  }

  function createPanner(position, spatial) {
    if (!spatial || !position) return null;
    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.maxDistance = 12;
    panner.rolloffFactor = 0.35;
    movePanner(panner, position);
    return panner;
  }

  function record(type, objectId, url, gain) {
    playCount++;
    lastClip = url;
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    lastEvents.push({ type, objectId: objectId ?? null, clip: url, gain, time: Number(context.currentTime.toFixed(3)) });
    if (lastEvents.length > 20) lastEvents.shift();
  }

  function choose(folder, family, variants = 2) {
    if (variants === 1) return clipUrl(folder, family, 1);
    const key = `${folder}/${family}`;
    const last = previousVariants.get(key);
    const variant = last ? 3 - last : 1 + Math.floor(Math.random() * 2);
    previousVariants.set(key, variant);
    return clipUrl(folder, family, variant);
  }

  function reserveVoice(priority) {
    if (voices.size < MAX_VOICES) return true;
    const candidate = [...voices].sort((a, b) => a.priority - b.priority)[0];
    if (candidate.priority > priority) return false;
    candidate.source.stop();
    voices.delete(candidate);
    revealVoices.delete(candidate);
    return true;
  }

  function playClip(type, objectId, folder, family, position, spatial, volume, priority = 1, variants = 2) {
    if (muted) return false;
    const url = choose(folder, family, variants), buffer = buffers.get(url);
    if (!buffer || !reserveVoice(priority)) return false;
    unlock();
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    const panner = createPanner(position, spatial);
    source.connect(gain);
    if (panner) gain.connect(panner).connect(limiter);
    else gain.connect(limiter);
    const voice = { source, priority };
    voices.add(voice);
    source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); panner?.disconnect(); };
    source.start();
    record(type, objectId, url, volume);
    return true;
  }

  function playBreak(objectId, position, spatial = false) {
    const family = OBJECT_SOUNDS[objectId] || 'concrete';
    return playClip('break', objectId, family === 'wood' ? 'actions' : 'breaks', family === 'wood' ? 'timber-break' : family, position, spatial, 1, 3);
  }

  /** One-shot opening interaction at the touched object rather than the UI. */
  function playPuzzle(action, position, spatial = false) {
    if (!Object.hasOwn(PUZZLE_SOUNDS, action) || muted || !context) return false;
    const sound = PUZZLE_SOUNDS[action], now = context.currentTime;
    // Alignment may be sampled by a held piece. Dial notches can be rapid,
    // but neither should allocate a new source every render frame.
    if (now - (lastPuzzle.get(action) ?? -Infinity) < (sound.cooldown ?? .09)) return false;
    const played = playClip(`puzzle:${action}`, action, sound.folder ?? 'opening', sound.family,
      position, spatial, sound.gain, sound.priority ?? 2, sound.variants ?? 1);
    if (played) lastPuzzle.set(action, now);
    return played;
  }

  function chime(frequencies, volume = 0.03, position, spatial = false) {
    if (muted) return;
    unlock();
    const now = context.currentTime;
    for (const [index, frequency] of frequencies.entries()) {
      if (!reserveVoice(3)) break;
      const source = context.createOscillator(), gain = context.createGain();
      source.frequency.value = frequency;
      const start = now + index * 0.055;
      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      const panner = createPanner(position, spatial);
      source.connect(gain);
      if (panner) gain.connect(panner).connect(limiter);
      else gain.connect(limiter);
      const voice = { source, priority: 3 };
      voices.add(voice);
      source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); panner?.disconnect(); };
      source.start(start);
      source.stop(start + 0.35);
    }
  }

  function playRestore() {
    stopDrag({ immediate: true });
    cancelReveals();
    lastPuzzle.clear();
    if (muted) return;
    chime([392, 494, 587, 784], 0.06);
    quietContactsUntil = context.currentTime + 0.3;
    record('restore', null, 'synth:restore', 0.06);
  }

  function playPickup(objectId, position, spatial = false) {
    const played = playClip('pickup', objectId, 'repair', 'pickup', position, spatial, 0.58, 3);
    if (context) quietContactsUntil = context.currentTime + 0.12;
    return played;
  }

  function createDragLoop(session, family) {
    const descriptor = DRAG_FAMILIES[family];
    const url = choose(descriptor.folder, descriptor.family), buffer = buffers.get(url);
    if (!buffer) return false;
    // At most the incoming loop and one outgoing crossfade can coexist.
    for (const retiring of retiringDrags) {
      retiring.source.stop();
      retiringDrags.delete(retiring);
    }
    const source = context.createBufferSource(), gain = context.createGain();
    const panner = createPanner(session.position, session.spatial);
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    gain.gain.value = 0;
    source.connect(gain);
    if (panner) gain.connect(panner).connect(limiter);
    else gain.connect(limiter);
    const loop = { source, gain, panner, family, url, maxGain: descriptor.gain, targetGain: 0, stopAt: null };
    source.onended = () => {
      retiringDrags.delete(loop);
      source.disconnect(); gain.disconnect(); panner?.disconnect();
    };
    source.start();
    record('dragStart', session.objectId, url, 0);
    return loop;
  }

  function startDrag(objectId, position, spatial = false, { kind = 'artifact' } = {}) {
    stopDrag({ immediate: true });
    if (muted) return false;
    unlock();
    const session = {
      objectId, kind, spatial, position: position ? { ...position } : null,
      surface: null, loop: null, pendingFamily: null, pendingSince: 0,
      strainArmed: true, lastStrainAt: -Infinity,
    };
    drag = session;
    const family = isWoodProp(kind) ? null : kind === 'hanging-light' ? 'metal-creak' : 'stone-drag';
    if (family) session.loop = createDragLoop(session, family) || null;
    return true;
  }

  function fadeLoop(loop, immediate = false) {
    if (!loop || !context) return;
    const now = context.currentTime;
    loop.targetGain = 0;
    const duration = immediate ? 0.015 : 0.1;
    if (loop.gain.gain.cancelAndHoldAtTime) loop.gain.gain.cancelAndHoldAtTime(now);
    else {
      const value = loop.gain.gain.value;
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(value, now);
    }
    loop.gain.gain.linearRampToValueAtTime(0, now + duration);
    loop.stopAt = now + duration;
    retiringDrags.add(loop);
    loop.source.stop(loop.stopAt + 0.001);
  }

  function updateDrag({ position, speed = 0, strength = 0, kind, surface = null, scrapeSpeed = 0, load = 0 } = {}) {
    if (!drag || !context || muted) return;
    if (kind) drag.kind = kind;
    if (position) drag.position = { x: position.x, y: position.y, z: position.z };
    drag.surface = isWoodProp(drag.kind) && ['concrete', 'wood'].includes(surface) ? surface : null;
    const wood = isWoodProp(drag.kind), lamp = drag.kind === 'hanging-light';
    const family = wood ? drag.surface && `scrape-wood-${drag.surface}` : lamp ? 'metal-creak' : 'stone-drag';
    // Wooden props use actual tangential contact speed. Travel through the air
    // or pressure against an immovable surface cannot produce a sliding loop.
    const actualSpeed = Math.abs(Number(wood ? scrapeSpeed : speed) || 0);
    const movement = clamp((actualSpeed - .012) / (lamp ? .55 : .7), 0, 1);
    const now = context.currentTime;
    if (family && movement > 0 && drag.loop?.family !== family) {
      if (!drag.loop || !wood) {
        const next = createDragLoop(drag, family);
        if (next) { fadeLoop(drag.loop); drag.loop = next; }
      } else if (drag.pendingFamily !== family) {
        drag.pendingFamily = family;
        drag.pendingSince = now;
      } else if (now - drag.pendingSince >= .12) {
        const next = createDragLoop(drag, family);
        if (next) { fadeLoop(drag.loop); drag.loop = next; }
        drag.pendingFamily = null;
      }
    } else drag.pendingFamily = null;
    const loop = drag.loop;
    if (loop) {
      movePanner(loop.panner, position);
      const matching = family === loop.family;
      // Every texture is normalized to -35 LUFS before this additional quiet
      // gain cap. Shared easing keeps changes in contact material unobtrusive.
      const target = matching ? loop.maxGain * Math.sqrt(movement) * (.78 + .22 * clamp(strength, 0, 1)) : 0;
      loop.targetGain = target;
      loop.gain.gain.setTargetAtTime(target, now, target > loop.gain.gain.value ? .05 : .025);
    }
    for (const retiring of retiringDrags) movePanner(retiring.panner, position);
    const strain = clamp(Number(load) || 0, 0, 1);
    if (strain < .15) drag.strainArmed = true;
    if (wood && surface && drag.strainArmed && strain > .35 && now - drag.lastStrainAt > 1.4 && now >= quietContactsUntil) {
      if (playClip('strain', drag.objectId, 'actions', 'wood-creak', drag.position, drag.spatial, .1 + .12 * strain, 1)) {
        drag.strainArmed = false;
        drag.lastStrainAt = now;
      }
    }
  }

  function stopDrag({ immediate = false } = {}) {
    if (!context) return;
    if (immediate) for (const loop of retiringDrags) fadeLoop(loop, true);
    if (!drag) return;
    fadeLoop(drag.loop, immediate);
    drag = null;
    eventCounts.dragStop = (eventCounts.dragStop || 0) + 1;
  }

  function playDrop(objectId, position, spatial = false) {
    stopDrag();
    return playClip('drop', objectId, 'repair', 'drop', position, spatial, 0.8, 3);
  }

  function contact(type, objectId, position, strength = 0.5, spatial = false) {
    if (muted || !context) return false;
    const now = context.currentTime, snap = type === 'snap', nudge = type === 'nudge';
    // Burst collisions share a small budget so a whole fracture cannot make a
    // wall of footsteps. The snap is allowed to cut through softer contacts.
    if (now - lastContact < (snap ? 0.032 : 0.065)) return false;
    if (now - (lastObjectContact.get(objectId) ?? -Infinity) < (snap ? 0.04 : 0.095)) return false;
    if (!snap && now < quietContactsUntil) return false;
    const force = clamp(Number(strength) || 0, 0, 1);
    if (!snap && force < (nudge ? 0.0001 : 0.04)) return false;
    const volume = nudge ? 0.25 * Math.sqrt(force) : snap ? 0.3 + force * 0.25 : 0.13 + force * 0.24;
    const played = playClip(type, objectId, 'repair', `hit-${OBJECT_SOUNDS[objectId] || 'concrete'}`, position, spatial, volume, snap ? 2 : 0);
    if (played) { lastContact = now; lastObjectContact.set(objectId, now); }
    return played;
  }

  function playCollision(objectId, position, strength = 0.5, spatial = false) {
    return contact('collision', objectId, position, strength, spatial);
  }

  function playNudge(objectId, position, strength = 0.5, spatial = false) {
    return contact('nudge', objectId, position, strength, spatial);
  }

  function playSnap(objectId, position, strength = 0.5, spatial = false) {
    return contact('snap', objectId, position, strength, spatial);
  }

  function playComplete(objectId, position, spatial = false) {
    stopDrag({ immediate: true });
    if (muted) return false;
    unlock();
    if (!reserveVoice(3)) return false;
    // One cached mono source contains the complete ascending phrase. Future
    // notes share its voice budget and are canceled together on mute/reset.
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = getRevealBuffer();
    gain.gain.value = REVEAL_GAIN;
    const panner = createPanner(position, spatial);
    source.connect(gain);
    if (panner) gain.connect(panner).connect(limiter);
    else gain.connect(limiter);
    const voice = { source, gain, priority: 3, cancelled: false };
    voices.add(voice); revealVoices.add(voice);
    source.onended = () => {
      voices.delete(voice); revealVoices.delete(voice);
      source.disconnect(); gain.disconnect(); panner?.disconnect();
    };
    source.start();
    quietContactsUntil = context.currentTime + .28;
    record('complete', objectId, 'synth:artifact-reveal', REVEAL_GAIN);
    return true;
  }

  function getRevealBuffer() {
    if (revealBuffer) return revealBuffer;
    revealBuffer = context.createBuffer(1, Math.ceil(REVEAL_DURATION * context.sampleRate), context.sampleRate);
    const data = revealBuffer.getChannelData(0);
    // A major arpeggio resolves into a round upper tonic with a quieter chord
    // underneath. The short bell partials stay below 2.1kHz.
    const notes = [
      [523.25, 0, .58, .58], [659.25, .12, .58, .62],
      [783.99, .24, .59, .65], [1046.5, .38, .78, .88],
      [261.625, .38, .76, .18], [523.25, .38, .78, .18],
      [659.25, .38, .75, .14], [783.99, .38, .74, .14],
    ];
    for (const [frequency, start, duration, amplitude] of notes) {
      const first = Math.ceil(start * context.sampleRate);
      const last = Math.min(data.length, Math.ceil((start + duration) * context.sampleRate));
      for (let index = first; index < last; index++) {
        const time = index / context.sampleRate - start;
        const attack = Math.sin(Math.PI * .5 * clamp(time / .009, 0, 1)) ** 2;
        const tail = Math.sin(Math.PI * .5 * clamp((duration - time) / .055, 0, 1)) ** 2;
        const envelope = amplitude * attack * tail * Math.exp(-4.6 * time / duration);
        const fundamental = Math.sin(2 * Math.PI * frequency * time);
        const bell = .12 * Math.exp(-14 * time) * Math.sin(2 * Math.PI * frequency * 2.002 * time);
        data[index] += envelope * (fundamental + bell);
      }
    }
    let peak = 0, energy = 0;
    for (const value of data) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    // Fixed synthesis normalization leaves ample space for the last fragment
    // click and the shared limiter. This is independent of the device rate.
    const scale = Math.min(.52 / Math.max(peak, .0001), .135 / Math.max(Math.sqrt(energy / data.length), .0001));
    for (let index = 0; index < data.length; index++) data[index] *= scale;
    return revealBuffer;
  }

  function cancelReveals() {
    if (!context) return;
    const now = context.currentTime;
    for (const voice of revealVoices) {
      if (voice.cancelled) continue;
      voice.cancelled = true;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + .012);
      voice.source.stop(now + .013);
    }
  }

  function playDock(objectId, position, spatial = false) {
    stopDrag({ immediate: true });
    const played = playClip('dock', objectId, 'repair', 'pickup', position, spatial, 0.5, 3);
    if (played) { chime([659.25, 783.99, 1046.5], 0.033, position, spatial); quietContactsUntil = context.currentTime + 0.3; }
    return played;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) { stopDrag({ immediate: true }); cancelReveals(); }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.75, context.currentTime, 0.008);
    if (!muted) unlock();
  }

  function updateListener(position, forward, up) {
    if (!context) return;
    const listener = context.listener;
    if (listener.positionX) {
      for (const [prefix, vector] of [['position', position], ['forward', forward], ['up', up]]) {
        for (const axis of ['x', 'y', 'z']) listener[prefix + axis.toUpperCase()].value = vector[axis];
      }
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  function getState() {
    return {
      loaded, expected: ALL_CLIPS.length, muted, playCount, lastClip, activeVoices: voices.size,
      activeReveals: revealVoices.size,
      contextState: context?.state ?? 'uninitialized', loopActive: Boolean(drag),
      loopGain: Number((drag?.loop?.gain.gain.value ?? 0).toFixed(5)),
      loopTargetGain: Number((drag?.loop?.targetGain ?? 0).toFixed(5)), loopMaxGain: drag?.loop?.maxGain ?? MAX_DRAG_GAIN,
      loopFamily: drag?.loop?.family ?? null, loopSurface: drag?.surface ?? null,
      loopVoices: Number(Boolean(drag?.loop)) + retiringDrags.size, maxLoopVoices: MAX_LOOP_VOICES,
      loopObjectId: drag?.objectId ?? null, fadingLoops: retiringDrags.size,
      eventCounts: { ...eventCounts }, lastEvents: lastEvents.map(event => ({ ...event })),
    };
  }

  return {
    load, unlock, playBreak, playPuzzle, playRestore, setMuted, updateListener, getState,
    playPickup, startDrag, updateDrag, stopDrag, playDrop, playCollision, playNudge, playSnap, playComplete, playDock,
  };
}
