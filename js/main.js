import tracker from './tracker.js';
import gesture from './gesture.js';
import audio from './audio.js';
import strings from './strings.js';
import keys from './keys.js';
import canvas from './canvas.js';
import recorder from './recorder.js';

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log('[synth]', ...a); };

const state = {
  ready: false,
  running: false,
  landmarks: null,
  lastLandmarks: null,
  allHands: [],
  lastHands: [],
  occlusionFrames: 0,
  gestureState: null,
  viewport: { w: window.innerWidth, h: window.innerHeight },
};

const els = {
  video: document.getElementById('camera'),
  pipVideo: document.getElementById('pip-video'),
  canvas: document.getElementById('scene'),
  begin: document.getElementById('begin'),
  beginBtn: document.getElementById('begin-btn'),
  beginMsg: document.getElementById('begin-msg'),
  tooltip: document.getElementById('tooltip'),
  pip: document.getElementById('pip'),
  btnMic: document.getElementById('btn-mic'),
  btnRecord: document.getElementById('btn-record'),
  btnCamera: document.getElementById('btn-camera'),
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  state.viewport.w = window.innerWidth;
  state.viewport.h = window.innerHeight;
  els.canvas.width = state.viewport.w * dpr;
  els.canvas.height = state.viewport.h * dpr;
  els.canvas.style.width = state.viewport.w + 'px';
  els.canvas.style.height = state.viewport.h + 'px';
  const ctx = els.canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.resize(state.viewport);
  strings.resize(state.viewport);
  keys.resize(state.viewport);
}

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

  els.video.srcObject = stream;
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

  wireControls();

  state.ready = true;
  state.running = true;
  els.begin.classList.add('fade');
  setTimeout(() => els.begin.remove(), 450);
  requestAnimationFrame(loop);
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
    els.tooltip.style.top = r.top + 'px';
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

function loop(ts) {
  if (!state.running) return;

  const result = tracker.detect(ts);
  const hands = result && result.landmarks ? result.landmarks : [];

  if (hands.length > 0) {
    state.allHands = hands;
    state.lastHands = hands;
    state.occlusionFrames = 0;
  } else if (state.lastHands && state.occlusionFrames < 3) {
    state.allHands = state.lastHands;
    state.occlusionFrames += 1;
  } else {
    state.allHands = [];
  }

  const primary = state.allHands[0] || null;
  state.landmarks = primary;
  state.gestureState = gesture.update(state.allHands, state.viewport, ts);

  audio.update(state.gestureState);
  strings.update(state.gestureState);
  keys.update(state.gestureState);

  canvas.draw({
    landmarks: state.landmarks,
    allHands: state.allHands,
    gestureState: state.gestureState,
    stringStates: strings.getStates(),
    keyStates: keys.getStates(),
    activeScale: audio.getActiveScale(),
    activeZone: gesture.getActiveZone(),
    faders: audio.getFaders(),
    viewport: state.viewport,
    now: ts,
  });

  requestAnimationFrame(loop);
}

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
});

function shiftScale(dir) {
  const order = audio.SCALE_ORDER;
  const cur = audio.getActiveScale();
  const i = order.indexOf(cur);
  const next = order[(i + dir + order.length) % order.length];
  audio.applyScale(next);
}
