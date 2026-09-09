const FAMILIES = ['glass', 'concrete', 'rock', 'wood', 'metal-light', 'metal-heavy'];
const OBJECT_SOUNDS = Object.freeze({
  vase: 'concrete', cube: 'wood', orb: 'metal-light', gem: 'rock',
  bottle: 'glass', column: 'concrete', ring: 'metal-light', tablet: 'metal-heavy',
});
const REPAIR_FAMILIES = ['pickup', 'drop', 'drag', ...FAMILIES.map(family => `hit-${family}`)];
const ALL_CLIPS = [
  ...FAMILIES.flatMap(family => [1, 2].map(variant => clipUrl('breaks', family, variant))),
  ...REPAIR_FAMILIES.flatMap(family => [1, 2].map(variant => clipUrl('repair', family, variant))),
];
const MAX_VOICES = 12;
const MAX_DRAG_GAIN = 0.12;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function clipUrl(folder, family, variant) {
  return `/audio/${folder}/${family}-${String(variant).padStart(2, '0')}.wav`;
}

/** Predecoded, loudness-matched recordings. Playback preserves their original pitch. */
export function createRestoreAudio() {
  let context, master, limiter, muted = false, loaded = 0, playCount = 0, lastClip = null;
  let loadPromise, drag = null, quietContactsUntil = 0, lastContact = -Infinity;
  const buffers = new Map(), previousVariants = new Map(), voices = new Set();
  const eventCounts = {}, lastEvents = [], lastObjectContact = new Map(), retiringDrags = new Set();

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

  function choose(folder, family) {
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
    return true;
  }

  function playClip(type, objectId, folder, family, position, spatial, volume, priority = 1) {
    if (muted) return false;
    const url = choose(folder, family), buffer = buffers.get(url);
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
    return playClip('break', objectId, 'breaks', OBJECT_SOUNDS[objectId] || 'concrete', position, spatial, 1, 3);
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

  function startDrag(objectId, position, spatial = false) {
    stopDrag({ immediate: true });
    if (muted) return false;
    const url = choose('repair', 'drag'), buffer = buffers.get(url);
    if (!buffer) return false;
    unlock();
    const source = context.createBufferSource(), gain = context.createGain();
    const panner = createPanner(position, spatial);
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    gain.gain.value = 0;
    source.connect(gain);
    if (panner) gain.connect(panner).connect(limiter);
    else gain.connect(limiter);
    const loop = { source, gain, panner, objectId, url, targetGain: 0, startedAt: context.currentTime, stopAt: null };
    drag = loop;
    source.onended = () => {
      if (drag === loop) drag = null;
      retiringDrags.delete(loop);
      source.disconnect(); gain.disconnect(); panner?.disconnect();
    };
    source.start();
    record('dragStart', objectId, url, 0);
    return true;
  }

  function updateDrag({ position, speed = 0, strength = 0 } = {}) {
    if (!drag || !context || muted) return;
    movePanner(drag.panner, position);
    // Asset is already -35 LUFS. Silence while held still; texture grows gently
    // with actual piece motion and remains at most 12% gain even at full speed.
    const movement = clamp((Math.abs(Number(speed) || 0) - 0.012) / 0.7, 0, 1);
    const target = MAX_DRAG_GAIN * Math.sqrt(movement) * (0.78 + 0.22 * clamp(strength, 0, 1));
    const now = context.currentTime;
    drag.targetGain = target;
    drag.gain.gain.setTargetAtTime(target, now, target > drag.gain.gain.value ? 0.05 : 0.033);
  }

  function stopDrag({ immediate = false } = {}) {
    if (!drag || !context) return;
    const loop = drag, now = context.currentTime;
    drag = null;
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
    eventCounts.dragStop = (eventCounts.dragStop || 0) + 1;
  }

  function playDrop(objectId, position, spatial = false) {
    stopDrag();
    return playClip('drop', objectId, 'repair', 'drop', position, spatial, 0.8, 3);
  }

  function contact(type, objectId, position, strength = 0.5, spatial = false) {
    if (muted || !context) return false;
    const now = context.currentTime, snap = type === 'snap';
    // Burst collisions share a small budget so a whole fracture cannot make a
    // wall of footsteps. The snap is allowed to cut through softer contacts.
    if (now - lastContact < (snap ? 0.032 : 0.065)) return false;
    if (now - (lastObjectContact.get(objectId) ?? -Infinity) < (snap ? 0.04 : 0.095)) return false;
    if (!snap && now < quietContactsUntil) return false;
    const force = clamp(Number(strength) || 0, 0, 1);
    if (!snap && force < 0.04) return false;
    const volume = snap ? 0.3 + force * 0.25 : 0.13 + force * 0.24;
    const played = playClip(type, objectId, 'repair', `hit-${OBJECT_SOUNDS[objectId] || 'concrete'}`, position, spatial, volume, snap ? 2 : 0);
    if (played) { lastContact = now; lastObjectContact.set(objectId, now); }
    return played;
  }

  function playCollision(objectId, position, strength = 0.5, spatial = false) {
    return contact('collision', objectId, position, strength, spatial);
  }

  function playSnap(objectId, position, strength = 0.5, spatial = false) {
    return contact('snap', objectId, position, strength, spatial);
  }

  function playComplete(objectId, position, spatial = false) {
    stopDrag({ immediate: true });
    const played = playClip('complete', objectId, 'repair', 'pickup', position, spatial, 0.42, 3);
    if (played) { chime([523.25, 659.25, 783.99], 0.025, position, spatial); quietContactsUntil = context.currentTime + 0.28; }
    return played;
  }

  function playDock(objectId, position, spatial = false) {
    stopDrag({ immediate: true });
    const played = playClip('dock', objectId, 'repair', 'pickup', position, spatial, 0.5, 3);
    if (played) { chime([659.25, 783.99, 1046.5], 0.033, position, spatial); quietContactsUntil = context.currentTime + 0.3; }
    return played;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) stopDrag({ immediate: true });
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
      contextState: context?.state ?? 'uninitialized', loopActive: Boolean(drag),
      loopGain: Number((drag?.gain.gain.value ?? 0).toFixed(5)),
      loopTargetGain: Number((drag?.targetGain ?? 0).toFixed(5)), loopMaxGain: MAX_DRAG_GAIN,
      loopObjectId: drag?.objectId ?? null, fadingLoops: retiringDrags.size,
      eventCounts: { ...eventCounts }, lastEvents: lastEvents.map(event => ({ ...event })),
    };
  }

  return {
    load, unlock, playBreak, playRestore, setMuted, updateListener, getState,
    playPickup, startDrag, updateDrag, stopDrag, playDrop, playCollision, playSnap, playComplete, playDock,
  };
}
