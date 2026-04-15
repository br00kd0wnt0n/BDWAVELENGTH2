# Wavelength Gestures

Single-player browser gestural synthesizer. MediaPipe hand tracking drives a wireframe hand + Tone.js audio: strings (pluck), keys (pad synth), pinch faders, scale selector.

## Local run

```bash
npm start
# open http://localhost:8000
```

Allow camera when prompted. Requires `http://localhost` or HTTPS (browser policy for `getUserMedia` + `AudioContext`).

## Controls

- **Both hands** tracked; all 5 fingertips can strum strings.
- **Strings** split: left half = bass, right half = treble. Drag fingers across to pluck/strum.
- **Piano (bottom)** — hover a key with index finger, pinch thumb-to-index to press. Hold pinch to sustain. Release to decay.
- **Faders (left strip)** — pinch inside the strip; fingertip Y = value. Top = filter cutoff, bottom = resonance.
- **Scale selector (top dots)** — tap one with index fingertip, or use ← / → arrow keys.
- **Free zone (right strip)** — palm presence controls reverb + delay.
- **Bottom bar** — mic toggle, record (download webm), camera preview PiP.

## Deploy (Railway)

1. Push this repo to GitHub.
2. In Railway: New Project → Deploy from GitHub → select the repo.
3. Railway picks up `railway.json`, installs Node (via Nixpacks), runs `node server.js` on `$PORT`. HTTPS is provided automatically (required for webcam + audio).

No env vars, no secrets, no external services.

## Stack

- Vanilla HTML/CSS/ES modules — no framework, no bundler
- [@mediapipe/tasks-vision](https://developers.google.com/mediapipe) via CDN (hand landmarker)
- [Tone.js v14](https://tonejs.github.io/) via CDN
- Zero-deps Node static server for hosting

See `architecture.md` for the module map.
