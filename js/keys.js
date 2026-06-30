// Scale-degree pads — replaces piano keyboard.
// 7 large pads spanning the lower area of the screen.
// Any fingertip (all hands, all 5 fingers) entering a pad triggers
// that scale degree note. Multiple fingers = chord voicing.
// No pinch required — just reach into a pad.

const DEGREE_LABELS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

const PAD_TOP    = 0.60;
const PAD_BOTTOM = 0.90;
const PAD_X0     = 0.04;
const PAD_X1     = 0.96;
const N_PADS     = 7;

let audioRef = null;
let vp = { w: 0, h: 0 };
let layout = null;

// fingerKey (`${handIdx}-${tipIdx}`) -> midiNote currently held
const fingerNotes = new Map();

function init(audio) {
  audioRef = audio;
}

function computeLayout() {
  const vw = vp.w, vh = vp.h;
  const totalW = (PAD_X1 - PAD_X0) * vw;
  const gapPx  = vw * 0.007;
  const padW   = (totalW - gapPx * (N_PADS - 1)) / N_PADS;
  const padH   = (PAD_BOTTOM - PAD_TOP) * vh;
  const padY   = PAD_TOP * vh;
  return {
    pads: Array.from({ length: N_PADS }, (_, i) => ({
      index: i,
      x: PAD_X0 * vw + i * (padW + gapPx),
      y: padY,
      w: padW,
      h: padH,
      label: DEGREE_LABELS[i],
    })),
  };
}

function resize(viewport) {
  vp = viewport;
  layout = computeLayout();
}

function midiForPad(padIdx) {
  const notes = audioRef?.getKeyNotes?.();
  return notes?.[padIdx] ?? (60 + padIdx);
}

function update(gs, allHands) {
  if (!layout || !allHands) return;

  const activeTips = new Map(); // fingerKey -> padIdx

  for (let h = 0; h < Math.min(allHands.length, 2); h++) {
    const hand = allHands[h];
    if (!hand) continue;
    for (const tipIdx of FINGERTIP_INDICES) {
      const tip = hand[tipIdx];
      if (!tip) continue;
      const px = tip.x * vp.w;
      const py = tip.y * vp.h;
      for (const pad of layout.pads) {
        if (px >= pad.x && px < pad.x + pad.w && py >= pad.y && py < pad.y + pad.h) {
          activeTips.set(`${h}-${tipIdx}`, pad.index);
          break;
        }
      }
    }
  }

  // Note ons for newly entered pads
  for (const [key, padIdx] of activeTips) {
    const midi = midiForPad(padIdx);
    const prev = fingerNotes.get(key);
    if (prev !== midi) {
      if (prev != null) { try { audioRef.keyOff(prev); } catch (_) {} }
      try { audioRef.keyOn(midi, 0.72); } catch (_) {}
      fingerNotes.set(key, midi);
    }
  }

  // Note offs for fingertips that left pads
  for (const [key, midi] of fingerNotes) {
    if (!activeTips.has(key)) {
      try { audioRef.keyOff(midi); } catch (_) {}
      fingerNotes.delete(key);
    }
  }
}

function getStates() {
  if (!layout) return null;
  const keyNotes = audioRef?.getKeyNotes?.() || [];
  const activePadIndices = new Set();
  for (const midi of fingerNotes.values()) {
    const idx = keyNotes.indexOf(midi);
    if (idx >= 0) activePadIndices.add(idx);
  }
  return { layout, activePadIndices, keyNotes };
}

export default { init, resize, update, getStates };
