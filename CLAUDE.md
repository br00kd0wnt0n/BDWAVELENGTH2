# Project: BD2_WavelengthGestures (a.k.a. BDWAVELENGTH2)

## Global context
~/context-base/CLAUDE.md

## Project brief
Single-player, browser-based gestural synthesizer. Webcam + MediaPipe hand tracking drives a wireframe hand on a dark canvas and a Tone.js audio engine. Both hands + all 5 fingertips each are active. Vanilla HTML/CSS/ES modules, no framework, no build step. Hosted via a zero-deps Node static server.

## Current persona
SCAFFOLDER → TUNER (layout + gesture ergonomics + synth voicing all iterated in session 1)

## Session goal
Ship v1 to Railway. Next sessions: polish, record-path testing, more expressive gestures.

---

## Foundation documents
- [architecture.md](architecture.md) — system structure, data flow, decisions
- [changelog.md](changelog.md) — session-by-session change history

## Quick start
```bash
npm start
# http://localhost:8000
# Allow camera when prompted. Localhost or HTTPS only (getUserMedia policy).
```

## Deploy
- GitHub: https://github.com/br00kd0wnt0n/BDWAVELENGTH2
- Railway: connects via `railway.json` → Nixpacks → `node server.js` on `$PORT`. HTTPS automatic.
- No env vars, no secrets, no external services.

## Key files
- Entry: `index.html` (loads Tone.js from CDN globally, then `js/main.js` as module)
- Server: `server.js` (zero-dep Node static server, reads `PORT`)
- Boot / render loop: `js/main.js`
- Hand tracking: `js/tracker.js` (MediaPipe vision bundle via dynamic `import()`, landmarks mirrored on X)
- Gesture engine: `js/gesture.js` (multi-hand, per-hand state `Map`, emits merged `GestureState`)
- Audio engine: `js/audio.js` (12 PluckSynth strings + PolySynth pad keys + mic UserMedia)
- Strings vibration: `js/strings.js` (12 states; draws left/right halves at same 6 Y rows)
- Keys layout: `js/keys.js` (2 octaves C3–B4, inset 10–90% width)
- Canvas draw: `js/canvas.js` (single `draw()` per frame; owns LAYOUT constants)
- Recorder: `js/recorder.js` (MediaRecorder on Tone `MediaStreamDestination`)

## Current layout (all percentages of viewport)
- Hit points (scale selectors): y 8%, 5 dots with visible labels (CHROMATIC / MAJOR / MINOR / PENTATONIC / BLUES)
- Strings band: y 20–48%; x 10–48% (left bass), 52–90% (right treble); dashed divider at x=50%
- Gap: y 48–58%
- Keys band: y 60–82%, x 10–90%
- Faders strip: x 2–~7%, y 22–46% (CUTOFF top, RES bottom)
- Free expression strip: x 92–98%, y 22–46% (palm Y → reverb wet, palm X → delay feedback)

## Gesture → instrument contract (current — differs from original spec in places)
- **Strings**: any fingertip of any hand crossing a row Y between frames triggers the string on that X-side. Crossings suppressed when x<10% or x>90% so reaching for controls doesn't pluck.
- **Keys**: index fingertip hovers (band ±4% tolerance). **Pinch-close** on a hovered key = `keyOn`; **pinch-open** = `keyOff`. Each hand holds one key at a time. Safety auto-release at 6s.
- **Faders**: pinch while fingertip is in x<0.12 strip. Fingertip Y within the fader's range = value directly (no incremental drag). Cutoff at y 0.22–0.34, resonance at 0.34–0.46.
- **Scale**: tap (peak-Y detection) on a top-row hit point, OR ← / → arrow keys.

## Audio voicing (current)
- Strings: 6 PluckSynth bass (D4 A3 F3 D3 A2 D2) + 6 treble (D5 A4 F4 D4 A3 D3). Scale retune snaps each to nearest in-scale degree.
- Keys: `PolySynth(Tone.Synth)` with fat sawtooth (count 3, spread 30), envelope A 0.12 / D 0.6 / S 0.7 / R 3.5. Chain: Chorus (f 0.6, depth 0.7, 50% wet) → Reverb (decay 5.5s, 50% wet) → master.
- Master: Compressor (-18, ratio 4) → Limiter (-3 dB).
- Mic: `UserMedia` → `PitchShift` → master. Toggle via bottom-bar button; pitch shift driven by pinch-drag Y while in space zone.

## Environment variables
None.

## Project-specific conventions
- ES modules, one default-exported object per module with `init()` / `update()` / etc.
- `DEBUG` constant at top of `main.js` gates console output. Always `false` at commit.
- `canvas.js` is the source of truth for layout percentages (`LAYOUT` object). Other modules that need the same values duplicate them — if you change a number, grep for it.
- Labels visible by default despite the original spec saying "hover-only" — Brook wanted clarity over minimalism once real hands were in the loop.

## Known gaps / next-session candidates
- Tap-BPM / swing are computed but not musically routed yet.
- Free-zone cross-fades reverb + delay but doesn't "morph" effect types; spec originally called for effect-type crossfade.
- No PiP camera preview polish (the element works, toggle wired, but unstyled edge cases).
- No visual feedback on active scale change beyond the dot pulse.
- MediaPipe cold-load (~5 MB wasm) shows no progress indicator between tap-to-begin and first frame — could add a status message.
