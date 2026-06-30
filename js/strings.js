// 6 strings: layout + animation state. Renders are done in canvas.js;
// this module tracks per-string amplitude/phase/decay and responds to
// crossings via the audio module.

let audioRef = null;
let vp = { w: 0, h: 0 };

// 12 strings: 0-5 left (bass), 6-11 right (treble).
// Both sides share the same 6 Y positions; rendered as left/right halves.
// Left (bass, 0-5): slower decay — more sustain and body
// Right (treble, 6-11): faster decay — snappier, more percussive
const states = Array.from({ length: 12 }, (_, i) => ({
  amplitude: 0,
  frequency: 220,
  lastTriggered: 0,
  decayRate: i < 6 ? 0.0016 : 0.0038,
}));

let stringYs = [];

function init(audio) {
  audioRef = audio;
}

function resize(viewport) {
  vp = viewport;
  // Strings band matches canvas LAYOUT: y 20% — 48%.
  const top = vp.h * 0.20;
  const bottom = vp.h * 0.48;
  stringYs = Array.from({ length: 6 }, (_, i) =>
    top + (bottom - top) * (i / 5)
  );
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function update(gs) {
  if (!gs) return;
  if (gs.stringsCrossed && gs.stringsCrossed.length) {
    const velNorm = Math.min(1, (gs.handSpeed || 0) / 1200);
    gs.stringsCrossed.forEach((i) => trigger(i, velNorm));
  }
}

function trigger(i, velNorm) {
  if (i < 0 || i >= states.length) return;
  const s = states[i];
  s.amplitude = 8 + velNorm * 10;
  s.frequency = audioRef && audioRef.getStringNote
    ? midiToFreq(audioRef.getStringNote(i))
    : 220;
  s.lastTriggered = performance.now();
}

function getYs() { return stringYs; }
function getSide(i) { return i < 6 ? 'L' : 'R'; }
function getRowIndex(i) { return i % 6; }

function getStates() {
  return {
    states,
    ys: stringYs,
  };
}

export default { init, resize, update, trigger, getStates };
