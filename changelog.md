# Changelog: BD2_WavelengthGestures

All notable changes to this project are documented here, organized by session.

---

## 2026-04-15 — SCAFFOLDER mode

**Session goal:** v1 scaffold per spec — single-player gestural synth in vanilla JS.

### Added
- `index.html` — markup, canvas, overlay layers, controls bar, tap-to-begin
- `style.css` — DM Mono import, palette vars, tooltip, pulse animation, PiP
- `js/main.js` — boot flow, render loop, resize handling, DEBUG gate
- `js/tracker.js` — MediaPipe HandLandmarker wrapper, mirrored landmarks, 3-frame occlusion grace
- `js/gesture.js` — pinch, finger extension, velocity, tap BPM/swing, string crossing, key hover
- `js/audio.js` — 6 PluckSynth strings + PolySynth keys + mic UserMedia, scale system, master bus into MediaStreamDestination
- `js/strings.js` — per-string amplitude/phase/decay state + trigger API
- `js/keys.js` — 2-octave layout math, hover/press state, in-scale dimming
- `js/canvas.js` — single `draw()` that clears and repaints: bg, strings (sinusoidal), keys, hit points, faders, free zone, hand skeleton, ripples
- `js/recorder.js` — MediaRecorder → webm download
- `CLAUDE.md`, `architecture.md`, `changelog.md` — foundation docs

### Decisions made
- PluckSynth per string (not a single PolySynth) so strums can stagger triggers per-string
- Canvas-rendered piano keys (not DOM) so hover/press can participate in the single draw loop
- Landmarks mirrored in tracker so downstream code reads in viewport coordinates

### Known issues
- Not yet tested against real MediaPipe output; gesture thresholds may need tuning
- Tap-BPM window (last 4 taps) is naive — may want median over a larger window
- No mobile/touch fallback for when camera permission is denied
