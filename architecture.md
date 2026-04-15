# Architecture: BD2_WavelengthGestures

## Overview
Browser-based gestural synthesizer. MediaPipe Hand Landmarker extracts 21 landmarks per frame from a webcam feed; those landmarks are interpreted into a `GestureState` object (pinch, taps, velocity, string crossings, key hover) which drives Tone.js synth voices and effect parameters. A single canvas renders the entire UI each frame: hand skeleton, animated strings, piano keyboard, hit points, faders, free-expression zone.

## System diagram
```
[Webcam] → [MediaPipe HandLandmarker] → [gesture.js: GestureState]
                                              ↓
                             ┌────────────────┼─────────────────┐
                             ↓                ↓                 ↓
                        [audio.js]       [strings.js]       [keys.js]
                             ↓                ↓                 ↓
                        [Tone.js] ← — — [canvas.js: single draw call per frame] ← [landmarks]
                             ↓
                     [MediaStreamDestination] → [MediaRecorder] → webm download
```

## Tech stack
| Layer | Technology | Why |
|---|---|---|
| Hand tracking | @mediapipe/tasks-vision (CDN) | GPU-accelerated 21-landmark model in the browser |
| Audio | Tone.js v14 (CDN) | PluckSynth / PolySynth + effects graph out of the box |
| Rendering | Canvas 2D | Single draw surface, no WebGL/Three needed for 2D wireframe |
| Recording | MediaRecorder API | Native, zero deps, captures Tone master bus |
| Fonts | DM Mono (Google Fonts) | Per design spec |

## Project structure
```
BD2_WavelengthGestures/
├── index.html
├── style.css
├── js/
│   ├── main.js       // boot, camera init, render loop
│   ├── tracker.js    // MediaPipe wrapper
│   ├── gesture.js    // GestureState from landmarks
│   ├── audio.js      // Tone.js graph
│   ├── strings.js    // 6 strings, animation state
│   ├── keys.js       // 2-octave keyboard
│   ├── canvas.js     // all drawing
│   └── recorder.js   // MediaRecorder capture
├── CLAUDE.md
├── architecture.md
└── changelog.md
```

## Data flow
1. `requestAnimationFrame` tick →
2. `tracker.detect(video, ts)` returns landmarks →
3. `gesture.update(landmarks)` produces `GestureState` →
4. `audio.update(state)` ramps synth params, triggers strings/keys →
5. `strings.update(state)` / `keys.update(state)` update visual state →
6. `canvas.draw({...})` clears and repaints full frame.

## Key boundaries
- `tracker.js` owns camera + MediaPipe; no audio or drawing.
- `gesture.js` is pure: landmarks in, `GestureState` out, no side effects.
- `audio.js` only reads `GestureState`; never touches the canvas.
- `canvas.js` only reads state; never mutates it.
- `recorder.js` taps Tone destination stream; independent of UI.

## Decision log
| Date | Decision | Rationale |
|---|---|---|
| 2026-04-15 | No framework, single canvas, ES modules | Per spec — keeps footprint tiny and load fast; canvas simpler than DOM keys/strings |
| 2026-04-15 | Tone.PluckSynth per-string (6 instances) vs one PolySynth | Physical-model pluck timbre per string; independent triggers for strum stagger |
| 2026-04-15 | Mirror landmarks via `x = 1 - x` and CSS `scaleX(-1)` on video | Intuitive — user's right hand appears on right side |

## Known constraints
- `getUserMedia` + `AudioContext` both require a user gesture → tap-to-begin overlay.
- MediaPipe wasm load is ~5 MB; first load gated on network.
- 60fps target; fall back to 30 segments per string wave if frame budget slips.
