// Tone.js audio graph: 6 PluckSynth strings + PolySynth keys + mic.

const SCALES = {
  CHROMATIC: [0,1,2,3,4,5,6,7,8,9,10,11],
  MAJOR:     [0,2,4,5,7,9,11],
  MINOR:     [0,2,3,5,7,8,10],
  PENTATONIC:[0,2,4,7,9],
  BLUES:     [0,3,5,6,7,10],
};
const SCALE_ORDER = ['CHROMATIC','MAJOR','MINOR','PENTATONIC','BLUES'];

const ROOT_MIDI = 62; // D4

// 12 strings: 0–5 = LEFT (bass), 6–11 = RIGHT (treble)
const BASE_LEFT  = [62, 57, 53, 50, 45, 38]; // D4 A3 F3 D3 A2 D2
const BASE_RIGHT = [74, 69, 65, 62, 57, 50]; // D5 A4 F4 D4 A3 D3
const BASE_STRING_NOTES = [...BASE_LEFT, ...BASE_RIGHT];

const state = {
  ready: false,
  activeScale: 'MINOR',
  strings: [],
  stringNotes: BASE_STRING_NOTES.slice(),
  bassFilter: null, bassReverb: null, bassDelay: null, bassPanner: null,
  trebleChorus: null, trebleDelay: null, treblePanner: null,
  keys: null,
  keyChorus: null,
  keyReverb: null,
  mic: null,
  micPitch: null,
  micOn: false,
  master: null,
  compressor: null,
  limiter: null,
  destStream: null,
  faders: { cutoff: 0.6, resonance: 0.3, reverbWet: 0.25, delayFeedback: 0.3 },
  activeKeyVoices: new Map(),
};

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function init() {
  if (state.ready) return;

  state.limiter = new Tone.Limiter(-3).toDestination();
  state.compressor = new Tone.Compressor({ threshold: -18, ratio: 4 }).connect(state.limiter);
  state.master = new Tone.Gain(0.9).connect(state.compressor);

  state.destStream = Tone.context.createMediaStreamDestination();
  Tone.Destination.connect(state.destStream);

  // Bass chain (left strings 0-5): warm, sustained, filtered low, panned left
  state.bassFilter = new Tone.Filter({ frequency: 2200, Q: 1.5, type: 'lowpass' });
  state.bassReverb = new Tone.Reverb({ decay: 4.8, wet: 0.38 });
  state.bassDelay  = new Tone.FeedbackDelay({ delayTime: '4n', feedback: 0.18, wet: 0.14 });
  state.bassPanner = new Tone.Panner(-0.3);
  state.bassFilter.chain(state.bassReverb, state.bassDelay, state.bassPanner, state.master);

  // Treble chain (right strings 6-11): bright, snappy, chorus shimmer, panned right
  state.trebleChorus = new Tone.Chorus({ frequency: 1.8, delayTime: 3.5, depth: 0.45, wet: 0.35 }).start();
  state.trebleDelay  = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.32, wet: 0.26 });
  state.treblePanner = new Tone.Panner(0.3);
  state.trebleChorus.chain(state.trebleDelay, state.treblePanner, state.master);

  state.strings = BASE_STRING_NOTES.map((_, i) => {
    const isLeft = i < 6;
    const p = new Tone.PluckSynth({
      attackNoise: isLeft ? 0.5 : 1.6,
      dampening:   isLeft ? 2600 : 7200,
      resonance:   isLeft ? 0.99 : 0.96,
    });
    p.connect(isLeft ? state.bassFilter : state.trebleChorus);
    return p;
  });

  // Keys chain — lush analog-style pad
  state.keyReverb = new Tone.Reverb({ decay: 5.5, wet: 0.5 });
  state.keyChorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.7, wet: 0.5 }).start();
  state.keyChorus.chain(state.keyReverb, state.master);
  state.keys = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
    envelope: { attack: 0.12, decay: 0.6, sustain: 0.7, release: 3.5 },
    maxPolyphony: 8,
  }).connect(state.keyChorus);
  state.keys.volume.value = -10;

  // Mic chain
  state.micPitch = new Tone.PitchShift({ pitch: 0, wet: 1 });
  state.mic = new Tone.UserMedia();
  state.mic.chain(state.micPitch, state.master);

  state.ready = true;
  applyScale(state.activeScale);
}

function applyScale(name) {
  if (!SCALES[name]) return;
  state.activeScale = name;
  const intervals = SCALES[name];
  state.stringNotes = BASE_STRING_NOTES.map((n) => {
    const delta = n - ROOT_MIDI;
    // Snap to nearest in-scale degree by semitone distance (keep octave)
    const octaveBase = Math.floor(delta / 12) * 12;
    const rem = ((delta % 12) + 12) % 12;
    let nearest = intervals[0];
    let best = Infinity;
    for (const iv of intervals) {
      const d = Math.min(Math.abs(iv - rem), 12 - Math.abs(iv - rem));
      if (d < best) { best = d; nearest = iv; }
    }
    return ROOT_MIDI + octaveBase + nearest;
  });
}

function triggerString(index, velocity = 1) {
  if (!state.ready || index < 0 || index >= state.strings.length) return;
  const note = state.stringNotes[index];
  const freq = midiToFreq(note);
  const p = state.strings[index];
  p.volume.value = -12 + velocity * 12; // quieter picks
  try { p.triggerAttack(freq); } catch (e) {}
}

function strum(indices, handSpeed) {
  indices.forEach((i) => {
    const vel = Math.min(1, 0.4 + handSpeed / 1200);
    const jitter = Math.random() * 30;
    setTimeout(() => triggerString(i, vel), jitter);
  });
}

function pick(index, handSpeed) {
  const vel = Math.min(1, 0.3 + handSpeed / 800);
  triggerString(index, vel);
}

function keyOn(noteMidi, velocity = 0.8) {
  if (!state.ready) return;
  if (state.activeKeyVoices.has(noteMidi)) return;
  const freq = midiToFreq(noteMidi);
  state.keys.triggerAttack(freq, undefined, velocity);
  state.activeKeyVoices.set(noteMidi, Tone.now());
}

function keyOff(noteMidi) {
  if (!state.ready) return;
  if (!state.activeKeyVoices.has(noteMidi)) return;
  state.keys.triggerRelease(midiToFreq(noteMidi));
  state.activeKeyVoices.delete(noteMidi);
}

function setFader(which, value) {
  value = Math.max(0, Math.min(1, value));
  state.faders[which] = value;
  if (!state.ready) return;
  if (which === 'cutoff') {
    state.bassFilter.frequency.rampTo(200 + value * 4000, 0.03);
  } else if (which === 'resonance') {
    state.bassFilter.Q.rampTo(0.5 + value * 14, 0.03);
  } else if (which === 'reverbWet') {
    state.bassReverb.wet.rampTo(value * 0.6, 0.05);
    state.keyReverb.wet.rampTo(0.15 + value * 0.6, 0.05);
  } else if (which === 'delayFeedback') {
    state.bassDelay.feedback.rampTo(0.05 + value * 0.4, 0.05);
    state.trebleDelay.feedback.rampTo(0.1 + value * 0.55, 0.05);
  }
}

async function toggleMic() {
  if (!state.ready) return false;
  if (state.micOn) {
    try { state.mic.close(); } catch (e) {}
    state.micOn = false;
    return false;
  }
  try {
    await state.mic.open();
    state.micOn = true;
    return true;
  } catch (e) {
    return false;
  }
}

function update(gs) {
  if (!state.ready || !gs) return;

  // Top-band hit point (scale selector) — tap while hand in hit zone
  if (gs.tapFired && gs.activeZone === 'hit' && gs.fingertips && gs.fingertips[1]) {
    const x = gs.fingertips[1].x;
    // 5 hit points at normalized x = (i+1)/6
    let nearest = 0, bestD = Infinity;
    for (let i = 0; i < SCALE_ORDER.length; i++) {
      const hx = (i + 1) / (SCALE_ORDER.length + 1);
      const d = Math.abs(x - hx);
      if (d < bestD) { bestD = d; nearest = i; }
    }
    if (bestD < 0.08) applyScale(SCALE_ORDER[nearest]);
  }

  // String crossings -> pluck/strum
  if (gs.stringsCrossed && gs.stringsCrossed.length) {
    if (gs.handSpeed > 400 && gs.stringsCrossed.length > 1) {
      strum(gs.stringsCrossed, gs.handSpeed);
    } else {
      gs.stringsCrossed.forEach((i) => pick(i, gs.handSpeed));
    }
  }

  // Free-zone: Y -> reverb wet, X -> delay feedback
  if (gs.activeZone === 'space') {
    setFader('reverbWet', gs.spaceY);
    setFader('delayFeedback', gs.spaceX);
  }

  // Faders: any fingertip in the left strip drives fader value from Y position.
  // No pinch required — just hold your hand in the zone.
  const tip = gs.fingertips && gs.fingertips[1];
  if (tip && tip.x < 0.16) {
    const y = tip.y;
    if (y >= 0.20 && y < 0.34) {
      const v = 1 - (y - 0.20) / 0.14;
      setFader('cutoff', Math.max(0, Math.min(1, v)));
    } else if (y >= 0.34 && y <= 0.48) {
      const v = 1 - (y - 0.34) / 0.14;
      setFader('resonance', Math.max(0, Math.min(1, v)));
    }
  }

  // Mic pitch: pinch-drag Y while in space zone
  if (state.micOn && gs.pinchDragActive && gs.activeZone === 'space') {
    const semis = Math.max(-12, Math.min(12, -gs.pinchDragY / 20));
    state.micPitch.pitch = semis;
  }
}

function getKeyNotes() {
  // 7 MIDI notes for the scale-degree pads, wrapping to next octave if needed
  const intervals = SCALES[state.activeScale] || SCALES.MAJOR;
  return Array.from({ length: 7 }, (_, i) => {
    if (i < intervals.length) return ROOT_MIDI + intervals[i];
    return ROOT_MIDI + 12 + intervals[i % intervals.length];
  });
}

function getActiveScale() { return state.activeScale; }
function getFaders() { return { ...state.faders }; }
function getStringNote(i) { return state.stringNotes[i]; }
function getDestinationStream() { return state.destStream && state.destStream.stream; }
function isReady() { return state.ready; }

function cycleScale() {
  const i = SCALE_ORDER.indexOf(state.activeScale);
  applyScale(SCALE_ORDER[(i + 1) % SCALE_ORDER.length]);
}

export default {
  init,
  update,
  triggerString,
  keyOn,
  keyOff,
  setFader,
  toggleMic,
  applyScale,
  cycleScale,
  getActiveScale,
  getFaders,
  getStringNote,
  getKeyNotes,
  getDestinationStream,
  isReady,
  SCALE_ORDER,
  SCALES,
  ROOT_MIDI,
};
