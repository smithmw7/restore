const ASSET_BASE = import.meta.env?.BASE_URL || '/';
const CLIPS = ['dial', 'locker', 'latch', 'hinge'];
const EVENTS = Object.freeze({
  detent: { clip: 'dial', gain: .66, cooldown: .065, maxAge: .18, fadeIn: .001, fadeOut: .014 },
  locked: { clip: 'locker', gain: .30, cooldown: .30, maxAge: .40, duration: .34, fadeIn: .004, fadeOut: .04 },
  unlock: { clip: 'latch', gain: .68, cooldown: .45, maxAge: .50, fadeIn: .004, fadeOut: .10 },
  open: { clip: 'hinge', gain: .22, cooldown: .40, maxAge: .40, duration: .82, fadeIn: .04, fadeOut: .15 },
  close: { clip: 'locker', gain: .50, cooldown: .30, maxAge: .40, fadeIn: .004, fadeOut: .045 },
});
const ALIASES = { click: 'detent', dial: 'detent', release: 'unlock' };
const MAX_VOICES = 4;

/** Small gesture-unlocked Foley bank for the case inspection page. */
export function createBriefcaseReviewAudio() {
  let context, master, limiter, loading, disposed = false, muted = false;
  let requestId = 0, muteGeneration = 0;
  const abort = new AbortController();
  const buffers = new Map(), voices = new Set(), lastEvents = new Map(), latestRequests = new Map();
  const now = () => performance.now() / 1000;

  function load() {
    if (!loading) {
      const ctx = context;
      loading = Promise.all(CLIPS.map(async clip => {
        try {
          const response = await fetch(`${ASSET_BASE}audio/opening/${clip}-01.wav`, { signal: abort.signal });
          if (!response.ok) return;
          const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
          if (!disposed) buffers.set(clip, buffer);
        } catch {
          // A missing recording must not interrupt dragging or puzzle input.
        }
      }));
    }
    return loading;
  }

  // Invoke synchronously from a pointer/key event so browser gesture policy is
  // respected. Creation, fetching and decoding all wait for that first gesture.
  function resume() {
    if (disposed) return Promise.resolve(false);
    try {
      if (!context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return Promise.resolve(false);
        context = new AudioContextClass({ latencyHint: 'interactive' });
        master = context.createGain();
        master.gain.value = muted ? 0 : .62;
        limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 4;
        limiter.ratio.value = 8;
        limiter.attack.value = .003;
        limiter.release.value = .12;
        master.connect(limiter).connect(context.destination);
      }
      const resuming = context.state === 'suspended' ? context.resume() : Promise.resolve();
      void load();
      return Promise.resolve(resuming).then(() => !disposed && context.state === 'running', () => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  function stop(voice) {
    voices.delete(voice);
    try { voice.source.stop(); } catch { /* The voice may already have ended. */ }
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  function start(kind, spec, buffer) {
    if (disposed || muted || context?.state !== 'running') return false;
    // A dragged drum may click quickly; retain the latest tactile response
    // while giving latch/hinge sounds precedence over a crowded click bank.
    if (voices.size >= MAX_VOICES) {
      const oldestClick = [...voices].find(voice => voice.kind === 'detent');
      if (!oldestClick && kind === 'detent') return false;
      stop(oldestClick || voices.values().next().value);
    }
    const source = context.createBufferSource(), gain = context.createGain();
    const time = context.currentTime, duration = Math.min(spec.duration ?? buffer.duration, buffer.duration);
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(spec.gain, time + Math.min(spec.fadeIn, duration / 4));
    gain.gain.setValueAtTime(spec.gain, time + Math.max(spec.fadeIn, duration - spec.fadeOut));
    gain.gain.linearRampToValueAtTime(0, time + duration);
    source.connect(gain).connect(master);
    const voice = { source, gain, kind };
    voices.add(voice);
    source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start(time, 0, duration);
    return true;
  }

  function play(requestedKind) {
    const kind = ALIASES[requestedKind] || requestedKind, spec = EVENTS[kind];
    if (!spec || disposed || muted || !context) return false;
    const time = now();
    if (time - (lastEvents.get(kind) ?? -Infinity) < spec.cooldown) return false;
    lastEvents.set(kind, time);
    const id = ++requestId, generation = muteGeneration;
    latestRequests.set(kind, id);
    const buffer = buffers.get(spec.clip);
    if (buffer && context.state === 'running') return start(kind, spec, buffer);

    // Never build a queue of delayed detents during first-load latency. Only
    // the latest still-relevant gesture can produce a sound after decode.
    void load().then(() => {
      if (disposed || muted || generation !== muteGeneration || latestRequests.get(kind) !== id || now() - time > spec.maxAge) return;
      const readyBuffer = buffers.get(spec.clip);
      if (readyBuffer) start(kind, spec, readyBuffer);
    }).catch(() => {});
    return false;
  }

  function setMuted(value) {
    muted = Boolean(value);
    muteGeneration++;
    if (master && context.state !== 'closed') {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : .62, context.currentTime, .012);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    for (const voice of [...voices]) stop(voice);
    buffers.clear();
    master?.disconnect();
    limiter?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  return { resume, play, setMuted, dispose };
}
