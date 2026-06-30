import tracker from './tracker.js';
import gesture from './gesture.js';
import audio from './audio.js';
import strings from './strings.js';
import keys from './keys.js';
import canvas, { setHUDVisible } from './canvas.js';
import recorder from './recorder.js';

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log('[synth]', ...a); };

// ─── Session (BroadcastChannel collaboration) ─────────────────────────────────
// Sharing the URL lets other browser tabs/windows join the same session.
// Each peer's hands appear as colored ghost overlays on your canvas.

const sessionCode = (() => {
  const p = new URLSearchParams(window.location.search);
  let c = p.get('s');
  if (!c) {
    c = Math.random().toString(36).slice(2, 6).toUpperCase();
    window.history.replaceState({}, '', `?s=${c}`);
  }
  return c;
})();

const userId = (() => {
  let id = sessionStorage.getItem('wg-uid');
  if (!id) { id = Math.random().toString(36).slice(2, 9); sessionStorage.setItem('wg-uid', id); }
  return id;
})();

const COLLAB_COLORS = ['#7c3aed', '#00e5cc', '#f43f72', '#f59e0b'];
let collabColorIdx = 0;
const remoteHands = {};   // { [userId]: { hands, color, ts } }
let channel = null;

function initSession() {
  channel = new BroadcastChannel(`wg-${sessionCode}`);
  channel.postMessage({ type: 'join', userId });

  channel.onmessage = ({ data }) => {
    if (data.userId === userId) return;

    if (data.type === 'join' || data.type === 'ack') {
      if (!remoteHands[data.userId]) {
        remoteHands[data.userId] = {
          color: COLLAB_COLORS[collabColorIdx++ % COLLAB_COLORS.length],
          hands: [],
          ts: 0,
        };
        // Announce back so the joiner sees us
        if (data.type === 'join') channel.postMessage({ type: 'ack', userId });
      }
    }

    if (data.type === 'frame' && remoteHands[data.userId]) {
      remoteHands[data.userId].hands = data.hands;
      remoteHands[data.userId].ts   = performance.now();
    }

    // Play remote string triggers locally — their hands become our instruments too
    if (data.type === 'strings' && data.indices) {
      data.indices.forEach((i) => strings.trigger(i, data.velNorm || 0.5));
    }
  };
}

// ─── App state ────────────────────────────────────────────────────────────────

const state = {
  ready: false,
  running: false,
  landmarks: null,
  allHands: [],
  lastHands: [],
  occlusionFrames: 0,
  gestureState: null,
  viewport: { w: window.innerWidth, h: window.innerHeight },
  hudVisible: false,
  frameCount: 0,
};

const els = {
  video:    document.getElementById('camera'),
  pipVideo: document.getElementById('pip-video'),
  canvas:   document.getElementById('scene'),
  begin:    document.getElementById('begin'),
  beginBtn: document.getElementById('begin-btn'),
  beginMsg: document.getElementById('begin-msg'),
  tooltip:  document.getElementById('tooltip'),
  pip:      document.getElementById('pip'),
  btnMic:   document.getElementById('btn-mic'),
  btnRecord:document.getElementById('btn-record'),
  btnCamera:document.getElementById('btn-camera'),
  sessionBadge: document.getElementById('session-badge'),
};

// ─── Resize ───────────────────────────────────────────────────────────────────

function resize() {
  const dpr = window.devicePixelRatio || 1;
  state.viewport.w = window.innerWidth;
  state.viewport.h = window.innerHeight;
  els.canvas.width  = state.viewport.w * dpr;
  els.canvas.height = state.viewport.h * dpr;
  els.canvas.style.width  = state.viewport.w + 'px';
  els.canvas.style.height = state.viewport.h + 'px';
  const ctx = els.canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.resize(state.viewport);
  strings.resize(state.viewport);
  keys.resize(state.viewport);
}

// ─── Begin ────────────────────────────────────────────────────────────────────

async function begin() {
  els.beginMsg.textContent = 'starting…';
  try {
    await Tone.start();
    log('tone started');
  } catch (e) {
    els.beginMsg.textContent = 'audio failed';
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: false,
    });
  } catch (e) {
    els.beginMsg.textContent = 'camera required';
    return;
  }

  els.video.srcObject    = stream;
  els.pipVideo.srcObject = stream;
  await new Promise((res) => {
    if (els.video.readyState >= 2) return res();
    els.video.addEventListener('loadeddata', res, { once: true });
  });
  await els.video.play().catch(() => {});

  try {
    await tracker.init(els.video);
  } catch (e) {
    els.beginMsg.textContent = 'tracking failed';
    log(e);
    return;
  }

  audio.init();
  recorder.init({ button: els.btnRecord });
  canvas.init(els.canvas);
  strings.init(audio);
  keys.init(audio);

  initSession();
  if (els.sessionBadge) {
    els.sessionBadge.textContent = sessionCode;
    els.sessionBadge.classList.remove('hidden');
  }

  wireControls();
  wireCanvasClick();

  state.ready   = true;
  state.running = true;
  els.begin.classList.add('fade');
  setTimeout(() => els.begin.remove(), 450);
  requestAnimationFrame(loop);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

// Click on the top hit-point band to change scale (reliable fallback for gesture tap)
function wireCanvasClick() {
  els.canvas.addEventListener('click', (e) => {
    if (!state.ready) return;
    const rect = els.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top)  / rect.height;
    if (y < 0.15) {
      const order = audio.SCALE_ORDER;
      const step  = 1 / (order.length + 1);
      let nearest = 0, bestD = Infinity;
      for (let i = 0; i < order.length; i++) {
        const d = Math.abs(x - step * (i + 1));
        if (d < bestD) { bestD = d; nearest = i; }
      }
      audio.applyScale(order[nearest]);
    }
  });
}

function wireControls() {
  els.btnMic.addEventListener('click', async () => {
    const on = await audio.toggleMic();
    els.btnMic.classList.toggle('active', on);
  });

  els.btnRecord.addEventListener('click', () => {
    const on = recorder.toggle();
    els.btnRecord.classList.toggle('active', on);
  });

  els.btnCamera.addEventListener('click', () => {
    const hidden = els.pip.classList.toggle('hidden');
    els.btnCamera.classList.toggle('active', !hidden);
  });

  const showTip = (e) => {
    const tip = e.currentTarget.dataset.tip;
    if (!tip) return;
    els.tooltip.textContent = tip;
    const r = e.currentTarget.getBoundingClientRect();
    els.tooltip.style.left = (r.left + r.width / 2) + 'px';
    els.tooltip.style.top  = r.top + 'px';
    els.tooltip.classList.remove('hidden');
  };
  const hideTip = () => els.tooltip.classList.add('hidden');

  [els.btnMic, els.btnRecord, els.btnCamera].forEach((b) => {
    b.addEventListener('mouseenter', showTip);
    b.addEventListener('mouseleave', hideTip);
    b.addEventListener('focus', showTip);
    b.addEventListener('blur', hideTip);
  });
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

function loop(ts) {
  if (!state.running) return;
  state.frameCount++;

  const result = tracker.detect(ts);
  const hands  = result && result.landmarks ? result.landmarks : [];

  if (hands.length > 0) {
    state.allHands      = hands;
    state.lastHands     = hands;
    state.occlusionFrames = 0;
  } else if (state.lastHands && state.occlusionFrames < 3) {
    state.allHands      = state.lastHands;
    state.occlusionFrames++;
  } else {
    state.allHands = [];
  }

  const primary = state.allHands[0] || null;
  state.landmarks   = primary;
  state.gestureState = gesture.update(state.allHands, state.viewport, ts);

  audio.update(state.gestureState);
  strings.update(state.gestureState);
  keys.update(state.gestureState, state.allHands);

  // Broadcast hand positions every 3rd frame (≈20Hz)
  if (channel && state.allHands.length && state.frameCount % 3 === 0) {
    channel.postMessage({ type: 'frame', userId, hands: state.allHands.slice(0, 2) });
  }

  // Broadcast string triggers so remote peers hear them too
  if (channel && state.gestureState?.stringsCrossed?.length) {
    channel.postMessage({
      type: 'strings',
      userId,
      indices: state.gestureState.stringsCrossed,
      velNorm: Math.min(1, (state.gestureState.handSpeed || 0) / 1200),
    });
  }

  // Prune stale remote hands (> 300ms without update = gone)
  const now = performance.now();
  for (const uid of Object.keys(remoteHands)) {
    if (now - remoteHands[uid].ts > 300) remoteHands[uid].hands = [];
  }

  canvas.draw({
    landmarks:    state.landmarks,
    allHands:     state.allHands,
    gestureState: state.gestureState,
    stringStates: strings.getStates(),
    keyStates:    keys.getStates(),
    activeScale:  audio.getActiveScale(),
    activeZone:   gesture.getActiveZone(),
    faders:       audio.getFaders(),
    viewport:     state.viewport,
    now:          ts,
    videoEl:      els.video,
    remoteHands,
  });

  requestAnimationFrame(loop);
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────

window.addEventListener('resize', resize);
resize();

els.beginBtn.addEventListener('click', begin, { once: true });

document.addEventListener('keydown', (e) => {
  if (!state.ready) {
    if (e.key === 'Enter' || e.key === ' ') begin();
    return;
  }
  if (e.key === 'ArrowLeft') shiftScale(-1);
  else if (e.key === 'ArrowRight') shiftScale(+1);
  else if (e.key === 'd' || e.key === 'D') {
    state.hudVisible = !state.hudVisible;
    setHUDVisible(state.hudVisible);
  }
  else if (e.key === 's' || e.key === 'S') {
    // Copy session link to clipboard
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
  }
});

function shiftScale(dir) {
  const order = audio.SCALE_ORDER;
  const cur   = audio.getActiveScale();
  const i     = order.indexOf(cur);
  const next  = order[(i + dir + order.length) % order.length];
  audio.applyScale(next);
}
