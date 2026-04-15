# Architecture: BD2_WavelengthGestures

## Overview
Browser gestural synthesizer. MediaPipe Hand Landmarker extracts 21 landmarks per frame from a webcam feed for up to 2 hands. Those landmarks are interpreted into a merged `GestureState` which drives 12 `Tone.PluckSynth` strings, a lush `Tone.PolySynth` pad, pinch-driven faders, mic pitch-shift, and a scale selector. A single Canvas 2D surface renders everything per frame: hand skeletons, animated strings, piano keyboard, hit points, faders, free-expression zone, debug HUD.

## System diagram
```
[Webcam] → [tracker.js: MediaPipe HandLandmarker (GPU)]
                             ↓ mirrored landmarks (x = 1 - x)
                     [gesture.js: per-hand state Map]
                             ↓ merged GestureState
          ┌──────────────────┼──────────────────┐
          ↓                  ↓                  ↓
      [audio.js]        [strings.js]       [keys.js]
          ↓                  ↓                  ↓
      [Tone.js] ← ─ ─ [canvas.js: single draw() per rAF tick] ← [landmarks]
          ↓
  [Tone.Destination] → MediaStreamDestination → [recorder.js] → webm download
          ↓
     browser speakers
```

## Tech stack
| Layer | Technology | Why |
|---|---|---|
| Hand tracking | `@mediapipe/tasks-vision` 0.10.14 (CDN, dynamic `import()`) | GPU-accelerated 21-landmark model, 2 hands |
| Audio | Tone.js 14.8.49 (CDN, global `Tone`) | PluckSynth + PolySynth + effects graph + MediaStreamDestination |
| Rendering | Canvas 2D | 2D wireframe; no WebGL needed |
| Recording | MediaRecorder API | Native, 0 deps, captures Tone master |
| Host | Node 18+ static server (`server.js`, 0 deps) | Railway-compatible; serves project root on `$PORT` |
| Deploy | Railway via `railway.json` (Nixpacks) | HTTPS required for `getUserMedia` + `AudioContext` |

## Project structure
```
BD2_WavelengthGestures/
├── index.html           // entry, Tone.js script, #stage canvas, controls bar, tap-to-begin
├── style.css            // DM Mono, palette vars, tooltip, pulse, PiP
├── server.js            // zero-deps static host for Railway
├── package.json         // start script (no runtime deps)
├── railway.json         // Nixpacks + start command
├── .gitignore
├── README.md
├── CLAUDE.md
├── architecture.md
├── changelog.md
└── js/
    ├── main.js       // boot, render loop, resize, arrow-key scale cycle, DEBUG
    ├── tracker.js    // MediaPipe wrapper, X-mirrored landmarks, frame timestamp guard
    ├── gesture.js    // multi-hand/multi-fingertip interpreter, per-hand state Map
    ├── audio.js      // Tone graph: 12 PluckSynths + PolySynth pad + mic, scale remap
    ├── strings.js    // 12 vibration states, 6 Y rows shared left/right
    ├── keys.js       // 14 white + 10 black keys (C3–B4), inset 10–90%
    ├── canvas.js     // LAYOUT source of truth; single draw() call per frame; HUD
    └── recorder.js   // MediaRecorder → webm download
```

## Data flow (per frame)
1. `requestAnimationFrame(loop)` fires.
2. `tracker.detect(ts)` runs `handLandmarker.detectForVideo` on the hidden `<video>`. Returns mirrored landmarks for 0–2 hands, or last-known with a 3-frame occlusion grace.
3. `gesture.update(hands, viewport, ts)` walks each hand, updating that hand's entry in a module-level `Map`. Emits a single merged `GestureState`:
   - Per-hand: fingertip positions, pinch state + edges, velocity, held key.
   - Merged: all-fingertips string crossings (12 strings), multi-hand key presses / releases, any-hand pinch flag.
   - Primary hand (index 0) drives scalar outputs: pose flags, active zone, tap BPM, pinch-drag for faders, free-zone params.
4. `audio.update(state)` routes the state to Tone: string plucks/strums (velocity from handSpeed), fader values (direct from fingertip Y when pinching in left strip), hit-point tap → `applyScale`, free-zone → reverb/delay, mic pitch shift on pinch-drag.
5. `strings.update(state)` updates per-string amplitude/frequency/lastTriggered based on new crossings.
6. `keys.update(state)` calls `audio.keyOn` for each `keyPresses`, `audio.keyOff` for each `keyReleases`. Maintains `activeNotes` map for rendering + 6s safety release.
7. `canvas.draw({...})` clears + repaints: bg, strings (sinusoidal when active / straight when idle, anchored at ends), keys (whites then blacks with scale dimming), hit points + labels, faders + labels, free-zone, all detected hands, ripples, HUD.

## Key boundaries
- `tracker.js` owns the camera + MediaPipe. Nothing else touches the video element.
- `gesture.js` is deterministic given landmarks + viewport + ts. No audio / no drawing side effects.
- `audio.js` only reads `GestureState`. Never touches the canvas or DOM.
- `canvas.js` only reads state. Never mutates it. Is the authority on LAYOUT percentages; other modules that read layout (gesture zone detection, keys, strings) duplicate the numbers.
- `recorder.js` attaches to `Tone.context.createMediaStreamDestination()`. Independent of UI state.

## Instrument layout (canvas.js `LAYOUT`)
```
hitY:          0.08               // 5 scale-selector dots
stringsTop:    0.20
stringsBottom: 0.48
stringsXStart: 0.10  stringsXEnd: 0.90   // leaves 10% strip each side
keysTop:       0.60                // keys band bottom edge computed from whiteH 0.22
fadersLeft:    0.02  fadersWidth:  0.06
fadersTop:     0.22  fadersBottom: 0.46
freeLeft:      0.92  freeRight:    0.98
freeTop:       0.22  freeBottom:   0.46
```

## Decision log
| Date | Decision | Rationale |
|---|---|---|
| 2026-04-15 | Vanilla ES modules, no build step | Spec constraint; keeps iteration fast |
| 2026-04-15 | PluckSynth per-string (×12) instead of one PolySynth | Independent triggers for strum stagger + per-string volume |
| 2026-04-15 | Left/right strings split at x=0.5 | User request — two-handed play, bass vs treble |
| 2026-04-15 | Canvas-drawn keys (not DOM) | Single render loop; scale dimming + hover labels in one pass |
| 2026-04-15 | Fader = pinch + direct Y position (not incremental drag) | Incremental drag was hard to hit; direct-Y is "grab at value" |
| 2026-04-15 | Key note = pinch-hold (no tap timer) | Enables sustained pads; release on pinch-open |
| 2026-04-15 | Labels visible by default | Brook asked — hover-only was too opaque in practice |
| 2026-04-15 | Zero-dep Node static server over Express | Avoids npm-install step on Railway; faster cold-start |

## Known constraints
- Both `getUserMedia` and `AudioContext` require a user gesture → tap-to-begin overlay on first load.
- MediaPipe wasm + model load is ~5 MB, no progress indicator yet.
- 60fps target. String wave resolution already reduced to N=30 segments per side; if FPS slips, reduce further.
- Tap detection (index fingertip Y peak-reversal) is noisy; pinch is the reliable gesture and is used for keys and faders.
