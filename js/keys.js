// Piano keyboard: 2 octaves (C3–B4), 14 white keys, black keys on top.
// Owns hit testing + press state; canvas.js draws.

import gesture from './gesture.js';

let audioRef = null;
let vp = { w: 0, h: 0 };

// White key MIDI notes C3..B4
const WHITE_NOTES = [48,50,52,53,55,57,59,60,62,64,65,67,69,71];
const NOTE_NAMES = {
  48:'C3',50:'D3',52:'E3',53:'F3',55:'G3',57:'A3',59:'B3',
  60:'C4',62:'D4',64:'E4',65:'F4',67:'G4',69:'A4',71:'B4',
  49:'C#3',51:'D#3',54:'F#3',56:'G#3',58:'A#3',
  61:'C#4',63:'D#4',66:'F#4',68:'G#4',70:'A#4',
};
// Black keys between whites. Index = position between two white keys (i and i+1).
const BLACK_BETWEEN = [
  // (indexOfLowerWhiteKey, blackMidi)
  [0, 49],[1, 51],
  [3, 54],[4, 56],[5, 58],
  [7, 61],[8, 63],
  [10, 66],[11, 68],[12, 70],
];

const state = {
  layout: null,
  hoveredIndex: null,
  activeNotes: new Map(), // midi -> { triggeredAt }
  scaleNotes: null,
};

function init(audio) {
  audioRef = audio;
}

function computeLayout(viewport) {
  const vw = viewport.w;
  const vh = viewport.h;
  const xStart = vw * 0.10;
  const xEnd = vw * 0.90;
  const playableW = xEnd - xStart;
  const keyWidth = playableW / 14;
  const whiteH = vh * 0.22;
  const blackW = keyWidth * 0.6;
  const blackH = vh * 0.13;
  const bandTop = vh * 0.60;
  const whites = WHITE_NOTES.map((midi, i) => ({
    midi,
    x: xStart + i * keyWidth,
    y: bandTop,
    w: keyWidth,
    h: whiteH,
    name: NOTE_NAMES[midi],
  }));
  const blacks = BLACK_BETWEEN.map(([i, midi]) => ({
    midi,
    x: xStart + (i + 1) * keyWidth - blackW / 2,
    y: bandTop,
    w: blackW,
    h: blackH,
    name: NOTE_NAMES[midi],
  }));
  return {
    whites,
    blacks,
    bandTop,
    bandBottom: bandTop + whiteH,
    hitTest(px, py) {
      // Black keys first (they overlap white keys)
      if (py >= bandTop && py <= bandTop + blackH) {
        for (const b of blacks) {
          if (px >= b.x && px <= b.x + b.w) return { kind: 'black', midi: b.midi };
        }
      }
      if (py >= bandTop && py <= bandTop + whiteH) {
        for (const w of whites) {
          if (px >= w.x && px <= w.x + w.w) return { kind: 'white', midi: w.midi };
        }
      }
      return null;
    },
  };
}

function resize(viewport) {
  vp = viewport;
  state.layout = computeLayout(viewport);
  // Publish layout into gesture module so hover detection works downstream.
  gesture.setLayout({
    keyBand: { top: state.layout.bandTop, bottom: state.layout.bandBottom },
    keyLayout: { hitTest: (x, y) => {
      const r = state.layout.hitTest(x, y);
      return r ? r.midi : null;
    } },
    stringYs: undefined,
  });
}

function update(gs) {
  if (!gs || !state.layout) return;
  state.hoveredIndex = gs.hoveredKeyIndex ?? null;

  // Press each key newly grabbed this frame (one per pinching hand)
  if (gs.keyPresses && gs.keyPresses.length) {
    for (const midi of gs.keyPresses) triggerPress(midi);
  }

  // Release each key whose pinch just opened
  if (gs.keyReleases && gs.keyReleases.length) {
    for (const midi of gs.keyReleases) triggerRelease(midi);
  }

  // Safety: long-held notes release after 6s
  const now = performance.now();
  for (const [midi, info] of state.activeNotes) {
    if (now - info.triggeredAt > 6000) triggerRelease(midi);
  }

  state.scaleNotes = computeScaleNotes(audioRef);
}

function triggerPress(midi) {
  if (audioRef) audioRef.keyOn(midi, 0.85);
  state.activeNotes.set(midi, { triggeredAt: performance.now() });
}

function triggerRelease(midi) {
  if (audioRef) audioRef.keyOff(midi);
  state.activeNotes.delete(midi);
}

function computeScaleNotes(audio) {
  if (!audio || !audio.SCALES) return null;
  const scale = audio.SCALES[audio.getActiveScale()];
  const root = audio.ROOT_MIDI;
  const set = new Set();
  for (let oct = -2; oct <= 2; oct++) {
    scale.forEach((iv) => set.add(root + oct * 12 + iv));
  }
  return set;
}

function getStates() {
  return {
    layout: state.layout,
    hoveredIndex: state.hoveredIndex,
    activeNotes: state.activeNotes,
    scaleNotes: state.scaleNotes,
    noteNames: NOTE_NAMES,
  };
}

export default { init, resize, update, getStates };
