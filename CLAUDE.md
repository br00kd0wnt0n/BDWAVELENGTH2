# Project: BD2_WavelengthGestures

## Global context
~/context-base/CLAUDE.md

## Project brief
Single-player, browser-based gestural synthesizer. Webcam + MediaPipe hand tracking drives a visual hand skeleton on a dark canvas and a Tone.js audio engine. Vanilla HTML/CSS/JS, no framework, no build step.

## Current persona
SCAFFOLDER

## Session goal
v1 scaffold: all zones (top hit points, 6 strings, 2-octave keys, free expression zone, pinch faders), PluckSynth strings, PolySynth keys, MediaRecorder capture.

---

## Foundation documents
- [architecture.md](architecture.md) — system structure, data flow, decisions
- [changelog.md](changelog.md) — session-by-session change history

## Quick start
```bash
# Serve statically — any static server will do. Must be HTTPS or localhost for getUserMedia.
python3 -m http.server 8000
# then open http://localhost:8000
```

## Key files
- Entry point: `index.html`
- Boot / render loop: `js/main.js`
- Hand tracking: `js/tracker.js`
- Gesture engine: `js/gesture.js`
- Audio engine: `js/audio.js`
- Strings: `js/strings.js`
- Keys: `js/keys.js`
- Canvas draw: `js/canvas.js`
- Recorder: `js/recorder.js`

## Environment variables
None — all CDN-loaded, no keys required.

## Project-specific conventions
- ES modules, one default-exported object per module with `init()` and `update()`
- No framework, no bundler, no TypeScript
- No UI text by default — labels only on hover (tooltips)
- No emoji in UI
- DEBUG constant at top of main.js gates all console output
