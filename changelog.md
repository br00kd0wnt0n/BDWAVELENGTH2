# Changelog: BD2_WavelengthGestures

All notable changes to this project are documented here, organized by session.

---

## 2026-04-15 — SCAFFOLDER + TUNER (session 1, end-to-end MVP + deploy)

**Session goal:** Build v1 per the Wavelength spec, iterate to feel right in-hand, ship to Railway.

### Added
- `index.html`, `style.css` — markup + palette, DM Mono, tap-to-begin overlay, controls bar (mic / record / camera PiP), tooltip pill
- `js/main.js` — boot, resize, render loop, occlusion grace, arrow-key scale cycling
- `js/tracker.js` — MediaPipe `HandLandmarker` via dynamic `import()` from jsdelivr; X-mirrored landmarks; frame timestamp dedupe
- `js/gesture.js` — multi-hand gesture interpreter. Per-hand state Map. Emits merged `GestureState` with: pinch + edges, velocity, tap BPM, string crossings (all fingertips × both hands), hovered + pressed + released keys, active zone
- `js/audio.js` — Tone graph: 12 PluckSynth strings (6 bass left + 6 treble right), PolySynth pad keys, UserMedia mic + PitchShift, scale remapping, global compressor/limiter, MediaStreamDestination for recording
- `js/strings.js` — 12 string animation states at 6 shared Y rows
- `js/keys.js` — 2 octaves C3–B4 inset 10–90%, scale-aware dimming, pinch-hold press model
- `js/canvas.js` — single-frame draw: background, strings (sinusoidal active / straight idle, end-anchored), keys, hit points + labels, faders + labels, free-zone, all hand skeletons, ripples, debug HUD
- `js/recorder.js` — MediaRecorder on Tone `MediaStreamDestination`, webm download with supported-mime fallback
- `server.js` — zero-dep Node static server (uses `$PORT`)
- `package.json` — start script, Node 18+ engines
- `railway.json` — Nixpacks + start command + healthcheck
- `.gitignore`, `README.md`
- `CLAUDE.md`, `architecture.md`, `changelog.md` — foundation docs

### Changed (within session)
- **Multi-hand support**: `main.js` passes all detected hands to `gesture.update`; canvas draws each; gesture module keyed by hand index in a Map.
- **All fingertips can strum**: string crossings track every fingertip of every hand, not just primary-hand index.
- **Layout respread**: instruments separated vertically with gaps; keys and strings inset to 10–90% so faders (left) and free-zone (right) have exclusive strips.
- **Anti-accidental plucks**: fingertip inside x<10% or x>90% no longer registers string crossings.
- **Faders**: moved from incremental pinch-drag to direct-Y positional while pinching. Hit strip widened to x<12%. Tracks index fingertip instead of palm center. Widened visual tracks + brighter hovered state.
- **Keys trigger model**: was `tapFired && hoveredKey`; now pinch-close = `keyOn`, pinch-open = `keyOff`. Per-hand `heldKey` tracked.
- **Keys voicing**: triangle short-release synth → fat-sawtooth pad (count 3, spread 30), A 0.12 / D 0.6 / S 0.7 / R 3.5, chorus (depth 0.7) + reverb (decay 5.5s, wet 0.5). Safety auto-release at 6s replaces old 2s.
- **Pinch threshold**: normalized distance threshold loosened 0.32 → 0.5 (against palm size) — detection was too strict.
- **Hover band**: expanded ±4% so users don't need to land exactly inside the keys band.
- **Labels visible by default** on hit points (scale names), faders (CUTOFF / RES), and free-zone (SPACE). Original spec said hover-only; in practice that was opaque.
- **Debug HUD** (bottom-left): zone, pinch active + normalized distance, hovered key name, tap BPM, hand speed.
- **Arrow keys** ← / → cycle the active scale globally.

### Fixed
- `dist2` crash from passing a single hand to multi-hand `gesture.update` — signature changed, `main.js` call updated to pass `state.allHands`.
- Keys "playing the same note" / not working — stemmed from `tapFired`-based trigger being too flaky; replaced with pinch-edge.
- Keys visually overlapping the fader strip — keys layout inset to match strings (x 10–90%).

### Decisions made
- PluckSynth per string over a single PolySynth: enables strum staggering + independent volume per velocity.
- Canvas-rendered keys: keeps everything in one draw pass with scale dimming.
- Zero-dep static server over Express/`serve-static`: no npm install on Railway cold deploy.
- Labels visible by default: Brook feedback — opacity lost to usability.

### Shipped
- GitHub: https://github.com/br00kd0wnt0n/BDWAVELENGTH2 (`main`, initial commit `83927ec`)
- Railway: prepared via `railway.json`; user to connect the GitHub repo in Railway dashboard. No env vars required.

### Known issues / next-session candidates
- Tap-BPM + swing computed but not routed to anything musical yet.
- Free-zone cross-fades reverb + delay feedback but doesn't switch effect *types* (spec called for type crossfade).
- No loading indicator during MediaPipe wasm + model fetch (~5 MB).
- No visual pulse on scale change beyond the hit-dot style.
- Recorder download uses `Date.now()` filename; fine but no way to preview before saving.
- Gesture thresholds are eye-calibrated; could benefit from a user-visible calibration pass.

### Phase 2 roadmap (called out by Brook at end of session 1)
- **WebSocket multiplayer** — shared room, see other users' hands/state. Requires refactoring control surfaces so each user has a visible "seat" and there's space to render N hand skeletons without crowding the instruments. Likely implications: instrument zones shrink or tile per-user, server authoritative state (Node/ws or Bun + a hub), presence + reconnection, per-user scale/fader independence vs jam-mode shared state.
- **MP3 export** — current recorder produces webm/opus (or mp4 in Safari). Swap to WAV capture then encode with `lamejs` (or similar) client-side, or post to a server-side ffmpeg step. Consider file size + encode latency.
- **More effects, global + per-instrument** — e.g. per-instrument delay/reverb sends (wet amounts separately controllable), global bus effects (tape saturation, sidechain, chorus on master), new gestures or UI surface for tweaking them live. May need a dedicated "effects" zone or a swipe-up drawer.

---

<!-- Copy the template above for each new session. Most recent session goes on top. -->
