// Single draw call per frame. Reads state, never mutates it.

import gesture from './gesture.js';

const COLORS = {
  bg: '#080809',
  dim: 'rgba(255,255,255,0.08)',
  mid: 'rgba(255,255,255,0.18)',
  bright: 'rgba(255,255,255,0.55)',
  accent: 'rgba(255,255,255,0.90)',
  stringIdle: 'rgba(255,255,255,0.12)',
  stringActive: 'rgba(255,255,255,0.85)',
  keyWhite: 'rgba(255,255,255,0.10)',
  keyBlack: 'rgba(0,0,0,0.6)',
  keyBlackStroke: 'rgba(255,255,255,0.12)',
  keyActive: 'rgba(255,255,255,0.70)',
  hitIdle: 'rgba(255,255,255,0.05)',
  hitActive: 'rgba(255,255,255,0.15)',
};

let ctxEl = null;
let vp = { w: 0, h: 0 };
let ripples = [];
let stringYsCache = [];
let lastTapFiredAt = 0;

const HIT_LABELS = ['CHROMATIC','MAJOR','MINOR','PENTATONIC','BLUES'];

function init(canvasEl) {
  ctxEl = canvasEl;
}

const LAYOUT = {
  hitY: 0.08,
  stringsTop: 0.20, stringsBottom: 0.48,
  stringsXStart: 0.10, stringsXEnd: 0.90,
  keysTop: 0.60,
  fadersLeft: 0.02, fadersWidth: 0.06,
  fadersTop: 0.22, fadersBottom: 0.46,
  freeLeft: 0.92, freeRight: 0.98,
  freeTop: 0.22, freeBottom: 0.46,
};

function resize(viewport) {
  vp = viewport;
  const top = vp.h * LAYOUT.stringsTop;
  const bottom = vp.h * LAYOUT.stringsBottom;
  stringYsCache = Array.from({ length: 6 }, (_, i) => top + (bottom - top) * (i / 5));
  gesture.setLayout({ stringYs: stringYsCache });
}

function ctx() { return ctxEl.getContext('2d'); }

function draw({ landmarks, allHands, gestureState, stringStates, keyStates, activeScale, activeZone, faders, viewport, now }) {
  if (!ctxEl) return;
  const c = ctx();
  vp = viewport || vp;

  // Clear
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, vp.w, vp.h);

  drawStrings(c, stringStates, now);
  drawKeys(c, keyStates);
  drawHitPoints(c, activeScale);
  drawFaders(c, faders, gestureState);
  drawFreeZone(c, activeZone);

  const hands = (allHands && allHands.length) ? allHands : (landmarks ? [landmarks] : []);
  for (let i = 0; i < hands.length; i++) {
    drawHand(c, hands[i], i === 0 ? gestureState : null);
  }

  drawRipples(c, now);
  drawHUD(c, gestureState, keyStates);

  // Tap fire -> ripple on index fingertip
  if (gestureState && gestureState.tapFired) {
    const tip = gestureState.fingertips && gestureState.fingertips[1];
    if (tip) {
      ripples.push({
        x: (1 - 0) * tip.x * vp.w,
        y: tip.y * vp.h,
        start: now,
        maxR: 40,
      });
    }
    lastTapFiredAt = now;
  }
}

function drawStrings(c, stringStates, now) {
  if (!stringStates) return;
  const { states, ys } = stringStates;
  const yList = (ys && ys.length) ? ys : stringYsCache;
  const N = 30;

  const leftStart = vp.w * LAYOUT.stringsXStart;
  const leftEnd = vp.w * 0.48;
  const rightStart = vp.w * 0.52;
  const rightEnd = vp.w * LAYOUT.stringsXEnd;

  // Side divider (dimmed center line)
  c.strokeStyle = COLORS.dim;
  c.lineWidth = 0.5;
  c.setLineDash([2, 6]);
  c.beginPath();
  c.moveTo(vp.w * 0.5, vp.h * LAYOUT.stringsTop - 4);
  c.lineTo(vp.w * 0.5, vp.h * LAYOUT.stringsBottom + 4);
  c.stroke();
  c.setLineDash([]);

  for (let row = 0; row < yList.length; row++) {
    const y = yList[row];
    drawStringSegment(c, states[row],        leftStart,  leftEnd,  y, now, N);   // left (bass) 0-5
    drawStringSegment(c, states[row + 6],    rightStart, rightEnd, y, now, N);   // right (treble) 6-11
  }
}

function drawStringSegment(c, s, x0, x1, y, now, N) {
  if (!s) return;
  const elapsed = now - (s.lastTriggered || 0);
  const amp = (s.amplitude || 0) * Math.exp(-(s.decayRate || 0.0025) * elapsed);

  if (amp < 0.5 || !s.lastTriggered) {
    c.strokeStyle = COLORS.stringIdle;
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
    return;
  }
  const colorMix = Math.min(1, amp / 18);
  c.strokeStyle = lerpColor(COLORS.stringIdle, COLORS.stringActive, colorMix);
  c.lineWidth = 0.8;
  c.beginPath();
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const x = x0 + (x1 - x0) * t;
    const env = Math.sin(Math.PI * t); // anchor both ends
    const yy = y + amp * env * Math.sin(x * (s.frequency || 220) * 0.0002 + elapsed * 0.012);
    if (k === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
  }
  c.stroke();
}

function drawKeys(c, keyStates) {
  if (!keyStates || !keyStates.layout) return;
  const { whites, blacks } = keyStates.layout;
  const hovered = keyStates.hoveredIndex;
  const active = keyStates.activeNotes;
  const scaleSet = keyStates.scaleNotes;

  // Whites
  for (const w of whites) {
    const isHovered = hovered === w.midi;
    const isActive = active && active.has(w.midi);
    const inScale = !scaleSet || scaleSet.has(w.midi);
    let fill = COLORS.keyWhite;
    if (!inScale) fill = 'rgba(255,255,255,0.04)';
    if (isHovered) fill = 'rgba(255,255,255,0.18)';
    if (isActive) fill = COLORS.keyActive;
    c.fillStyle = fill;
    c.fillRect(w.x, w.y, w.w, w.h);
    c.strokeStyle = COLORS.dim;
    c.lineWidth = 0.5;
    c.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);

    if (isHovered) {
      c.fillStyle = COLORS.mid;
      c.font = '8px "DM Mono", monospace';
      c.textAlign = 'center';
      c.fillText(w.name, w.x + w.w / 2, w.y - 4);
    }
  }

  // Blacks on top
  for (const b of blacks) {
    const isHovered = hovered === b.midi;
    const isActive = active && active.has(b.midi);
    const inScale = !scaleSet || scaleSet.has(b.midi);
    let fill = COLORS.keyBlack;
    if (!inScale) fill = 'rgba(0,0,0,0.75)';
    if (isHovered) fill = 'rgba(255,255,255,0.22)';
    if (isActive) fill = COLORS.keyActive;
    c.fillStyle = fill;
    c.fillRect(b.x, b.y, b.w, b.h);
    c.strokeStyle = COLORS.keyBlackStroke;
    c.lineWidth = 0.5;
    c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

    if (isHovered) {
      c.fillStyle = COLORS.mid;
      c.font = '8px "DM Mono", monospace';
      c.textAlign = 'center';
      c.fillText(b.name, b.x + b.w / 2, b.y - 4);
    }
  }
}

function drawHitPoints(c, activeScale) {
  const y = vp.h * LAYOUT.hitY;
  const count = HIT_LABELS.length;
  const stepX = vp.w / (count + 1);
  for (let i = 0; i < count; i++) {
    const x = stepX * (i + 1);
    const active = HIT_LABELS[i] === activeScale;
    c.strokeStyle = active ? COLORS.bright : COLORS.mid;
    c.lineWidth = 0.5;
    c.beginPath();
    c.arc(x, y, 18, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = active ? COLORS.accent : COLORS.bright;
    c.beginPath();
    c.arc(x, y, 1.5, 0, Math.PI * 2);
    c.fill();
    // label below each dot
    c.fillStyle = active ? COLORS.bright : COLORS.mid;
    c.font = '8px "DM Mono", monospace';
    c.textAlign = 'center';
    c.fillText(HIT_LABELS[i], x, y + 34);
  }
}

function drawFaders(c, faders, gs) {
  if (!faders) return;
  const trackW = 22;
  const fadersBlockTop = vp.h * LAYOUT.fadersTop;
  const fadersBlockBottom = vp.h * LAYOUT.fadersBottom;
  const fadersBlockH = fadersBlockBottom - fadersBlockTop;
  const trackH = (fadersBlockH - 16) / 2;
  const leftX = vp.w * 0.02;

  // Highlight the whole strip when a fingertip is inside it
  const tip = gs && gs.fingertips && gs.fingertips[1];
  const inStrip = tip && tip.x < 0.12 && tip.y >= 0.20 && tip.y <= 0.48;

  if (inStrip) {
    c.fillStyle = 'rgba(255,255,255,0.03)';
    c.fillRect(0, fadersBlockTop - 20, vp.w * 0.12, fadersBlockH + 32);
  }

  const hoveringCutoff = tip && tip.x < 0.12 && tip.y >= 0.20 && tip.y < 0.34;
  const hoveringRes    = tip && tip.x < 0.12 && tip.y >= 0.34 && tip.y <= 0.48;

  drawFader(c, leftX, fadersBlockTop,               trackW, trackH, faders.cutoff,    'CUTOFF', hoveringCutoff, gs?.pinchActive);
  drawFader(c, leftX, fadersBlockTop + trackH + 16, trackW, trackH, faders.resonance, 'RES',    hoveringRes,    gs?.pinchActive);
}

function drawFader(c, x, y, w, h, value, label, hovering, pinching) {
  const borderColor = hovering ? (pinching ? COLORS.accent : COLORS.bright) : COLORS.mid;
  c.strokeStyle = borderColor;
  c.lineWidth = hovering ? 1 : 0.5;
  c.strokeRect(x + 0.5, y + 0.5, w, h);
  const thumbY = y + h - h * Math.max(0, Math.min(1, value));
  c.fillStyle = hovering ? COLORS.accent : COLORS.bright;
  c.fillRect(x - 6, thumbY - 1.5, w + 12, 3);
  if (label) {
    c.fillStyle = hovering ? COLORS.bright : COLORS.mid;
    c.font = '8px "DM Mono", monospace';
    c.textAlign = 'center';
    c.fillText(label, x + w / 2, y - 4);
  }
}

function drawFreeZone(c, activeZone) {
  const x0 = vp.w * LAYOUT.freeLeft;
  const x1 = vp.w * LAYOUT.freeRight;
  const y0 = vp.h * LAYOUT.freeTop;
  const y1 = vp.h * LAYOUT.freeBottom;
  c.strokeStyle = activeZone === 'space' ? COLORS.bright : COLORS.dim;
  c.lineWidth = 0.5;
  c.setLineDash([3, 5]);
  c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  c.setLineDash([]);
  c.fillStyle = COLORS.mid;
  c.font = '8px "DM Mono", monospace';
  c.textAlign = 'center';
  c.fillText('SPACE', (x0 + x1) / 2, y0 - 4);
}

function drawHand(c, landmarks, gs) {
  if (!landmarks) return;
  const mapX = (p) => p.x * vp.w;
  const mapY = (p) => p.y * vp.h;

  // Connections
  c.strokeStyle = COLORS.dim;
  c.lineWidth = 1;
  c.beginPath();
  for (const [a, b] of gesture.MP_CONN) {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) continue;
    c.moveTo(mapX(pa), mapY(pa));
    c.lineTo(mapX(pb), mapY(pb));
  }
  c.stroke();

  // Landmarks
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    const isTip = gesture.FINGERTIPS.includes(i);
    c.fillStyle = isTip ? COLORS.bright : COLORS.mid;
    c.beginPath();
    c.arc(mapX(p), mapY(p), isTip ? 4.5 : 3, 0, Math.PI * 2);
    c.fill();
  }

  // Pinch pulse: ripple around index/thumb midpoint
  if (gs && gs.pinchActive) {
    const a = landmarks[4], b = landmarks[8];
    if (a && b) {
      const cx = (mapX(a) + mapX(b)) / 2;
      const cy = (mapY(a) + mapY(b)) / 2;
      c.strokeStyle = COLORS.accent;
      c.lineWidth = 0.8;
      c.beginPath();
      c.arc(cx, cy, 10 + 4 * Math.sin(performance.now() * 0.01), 0, Math.PI * 2);
      c.stroke();
    }
  }
}

function drawRipples(c, now) {
  ripples = ripples.filter((r) => now - r.start < 200);
  for (const r of ripples) {
    const t = (now - r.start) / 200;
    const rad = r.maxR * t;
    c.strokeStyle = `rgba(255,255,255,${0.7 * (1 - t)})`;
    c.lineWidth = 0.8;
    c.beginPath();
    c.arc(r.x, r.y, rad, 0, Math.PI * 2);
    c.stroke();
  }
}

function drawHUD(c, gs, keyStates) {
  if (!gs) return;
  const lines = [
    `zone: ${gs.activeZone || '-'}`,
    `pinch: ${gs.pinchActive ? 'YES' : 'no'}  norm: ${(gs.pinchNorm ?? 0).toFixed(2)}`,
    `hover key: ${gs.hoveredKeyIndex != null ? (keyStates?.noteNames?.[gs.hoveredKeyIndex] || gs.hoveredKeyIndex) : '-'}`,
    `tap: ${gs.tapFired ? 'FIRED' : (gs.tapBPM ? gs.tapBPM + ' bpm' : '-')}`,
    `speed: ${Math.round(gs.handSpeed || 0)} px/s`,
  ];
  c.save();
  c.font = '10px "DM Mono", monospace';
  c.textAlign = 'left';
  c.fillStyle = 'rgba(255,255,255,0.55)';
  const x = 20;
  let y = vp.h - 12 - (lines.length - 1) * 14;
  for (const line of lines) {
    c.fillText(line, x, y);
    y += 14;
  }
  c.restore();
}

function lerpColor(a, b, t) {
  const ra = parseRgba(a), rb = parseRgba(b);
  const r = Math.round(ra[0] + (rb[0] - ra[0]) * t);
  const g = Math.round(ra[1] + (rb[1] - ra[1]) * t);
  const bl = Math.round(ra[2] + (rb[2] - ra[2]) * t);
  const al = ra[3] + (rb[3] - ra[3]) * t;
  return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
}

function parseRgba(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255,255,255,1];
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  while (parts.length < 4) parts.push(1);
  return parts;
}

export default { init, resize, draw };
