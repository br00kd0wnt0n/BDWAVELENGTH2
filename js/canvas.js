// Single draw call per frame. Reads state, never mutates it.

import gesture from './gesture.js';

const COLORS = {
  bg: '#080809',
  dim: 'rgba(255,255,255,0.08)',
  mid: 'rgba(255,255,255,0.18)',
  bright: 'rgba(255,255,255,0.55)',
  accent: 'rgba(255,255,255,0.90)',
  stringIdle: 'rgba(255,255,255,0.10)',
  stringActive: 'rgba(255,255,255,0.85)',
  keyWhite: 'rgba(255,255,255,0.08)',
  keyBlack: 'rgba(0,0,0,0.6)',
  keyBlackStroke: 'rgba(255,255,255,0.10)',
  keyActive: 'rgba(255,255,255,0.70)',
  hitIdle: 'rgba(255,255,255,0.05)',
  hitActive: 'rgba(255,255,255,0.15)',
};

// Collaborator tint colors — index cycles per new peer
export const COLLAB_COLORS = ['#7c3aed', '#00e5cc', '#f43f72', '#f59e0b'];

let ctxEl = null;
let vp = { w: 0, h: 0 };
let ripples = [];
let stringYsCache = [];
let lastTapFiredAt = 0;
let showHUD = false;

const HIT_LABELS = ['CHROMATIC','MAJOR','MINOR','PENTATONIC','BLUES'];

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freqToHue(freq) {
  // Low (30Hz) = 22 (amber), High (2400Hz) = 272 (violet)
  const logF = Math.log2(Math.max(30, Math.min(2400, freq)));
  const t = (logF - Math.log2(30)) / (Math.log2(2400) - Math.log2(30));
  return Math.round(22 + t * 250);
}

function drawCameraBackground(c, videoEl) {
  if (!videoEl || videoEl.readyState < 2) {
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, vp.w, vp.h);
    return;
  }
  // Draw camera feed, mirrored + de-saturated
  c.save();
  c.filter = 'saturate(0.08) brightness(0.22)';
  c.translate(vp.w, 0);
  c.scale(-1, 1);
  c.drawImage(videoEl, 0, 0, vp.w, vp.h);
  c.restore();

  // Dark overlay to keep the instrument readable
  c.fillStyle = 'rgba(6,6,9,0.50)';
  c.fillRect(0, 0, vp.w, vp.h);

  // Vignette: draw from center outward
  const vg = c.createRadialGradient(
    vp.w * 0.5, vp.h * 0.42, vp.h * 0.12,
    vp.w * 0.5, vp.h * 0.5,  vp.h * 0.9
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  c.fillStyle = vg;
  c.fillRect(0, 0, vp.w, vp.h);
}

function lerpColor(a, b, t) {
  const ra = parseRgba(a), rb = parseRgba(b);
  const r  = Math.round(ra[0] + (rb[0] - ra[0]) * t);
  const g  = Math.round(ra[1] + (rb[1] - ra[1]) * t);
  const bl = Math.round(ra[2] + (rb[2] - ra[2]) * t);
  const al = ra[3] + (rb[3] - ra[3]) * t;
  return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
}

function parseRgba(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 255, 255, 1];
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  while (parts.length < 4) parts.push(1);
  return parts;
}

// ─── Init / resize ────────────────────────────────────────────────────────────

function init(canvasEl) {
  ctxEl = canvasEl;
}

function resize(viewport) {
  vp = viewport;
  const top    = vp.h * LAYOUT.stringsTop;
  const bottom = vp.h * LAYOUT.stringsBottom;
  stringYsCache = Array.from({ length: 6 }, (_, i) => top + (bottom - top) * (i / 5));
  gesture.setLayout({ stringYs: stringYsCache });
}

function ctx() { return ctxEl.getContext('2d'); }

// ─── Main draw ────────────────────────────────────────────────────────────────

function draw({
  landmarks, allHands, gestureState, stringStates, keyStates,
  activeScale, activeZone, faders, viewport, now,
  videoEl,       // HTMLVideoElement for background
  remoteHands,   // { [userId]: { hands, color } } from BroadcastChannel peers
}) {
  if (!ctxEl) return;
  const c = ctx();
  vp = viewport || vp;

  // Background: live camera feed (de-saturated) or flat black
  drawCameraBackground(c, videoEl);

  drawStrings(c, stringStates, now);
  drawKeys(c, keyStates);
  drawHitPoints(c, activeScale);
  drawFaders(c, faders, gestureState);
  drawFreeZone(c, activeZone);

  // Local hands
  const hands = (allHands && allHands.length) ? allHands : (landmarks ? [landmarks] : []);
  for (let i = 0; i < hands.length; i++) {
    drawHand(c, hands[i], i === 0 ? gestureState : null);
  }

  // Remote collaborator ghost hands
  if (remoteHands) {
    for (const remote of Object.values(remoteHands)) {
      if (!remote.hands) continue;
      for (const hand of remote.hands) {
        drawHand(c, hand, null, { tint: remote.color, alpha: 0.38 });
      }
    }
  }

  drawRipples(c, now);
  if (showHUD) drawHUD(c, gestureState, keyStates);

  // Tap ripple
  if (gestureState && gestureState.tapFired) {
    const tip = gestureState.fingertips && gestureState.fingertips[1];
    if (tip) {
      ripples.push({
        x: tip.x * vp.w,
        y: tip.y * vp.h,
        start: now,
        maxR: 40,
      });
    }
    lastTapFiredAt = now;
  }
}

// ─── Strings ──────────────────────────────────────────────────────────────────

function drawStrings(c, stringStates, now) {
  if (!stringStates) return;
  const { states, ys } = stringStates;
  const yList = (ys && ys.length) ? ys : stringYsCache;
  const N = 30;

  const leftStart  = vp.w * LAYOUT.stringsXStart;
  const leftEnd    = vp.w * 0.48;
  const rightStart = vp.w * 0.52;
  const rightEnd   = vp.w * LAYOUT.stringsXEnd;

  // Center divider
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
    drawStringSegment(c, states[row],      leftStart,  leftEnd,  y, now, N);
    drawStringSegment(c, states[row + 6],  rightStart, rightEnd, y, now, N);
  }
}

function drawStringSegment(c, s, x0, x1, y, now, N) {
  if (!s) return;
  const elapsed = now - (s.lastTriggered || 0);
  const amp = (s.amplitude || 0) * Math.exp(-(s.decayRate || 0.0025) * elapsed);
  const hue = freqToHue(s.frequency || 220);

  if (amp < 0.5 || !s.lastTriggered) {
    // Idle: very faint with subtle hue
    c.strokeStyle = `hsla(${hue}, 25%, 45%, 0.12)`;
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
    return;
  }

  const colorMix = Math.min(1, amp / 18);
  c.lineWidth = 0.8 + colorMix * 0.6;

  // Glow pass (wide, soft)
  c.shadowBlur = 8 + colorMix * 18;
  c.shadowColor = `hsla(${hue}, 80%, 55%, ${colorMix * 0.7})`;
  c.strokeStyle = `hsla(${hue}, 75%, 65%, ${0.35 + colorMix * 0.6})`;
  c.beginPath();
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const x  = x0 + (x1 - x0) * t;
    const env = Math.sin(Math.PI * t);
    const yy  = y + amp * env * Math.sin(x * (s.frequency || 220) * 0.0002 + elapsed * 0.012);
    if (k === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
  }
  c.stroke();
  c.shadowBlur = 0;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

function drawKeys(c, keyStates) {
  if (!keyStates || !keyStates.layout) return;
  const { whites, blacks } = keyStates.layout;
  const hovered  = keyStates.hoveredIndex;
  const active   = keyStates.activeNotes;
  const scaleSet = keyStates.scaleNotes;

  for (const w of whites) {
    const isHovered = hovered === w.midi;
    const isActive  = active && active.has(w.midi);
    const inScale   = !scaleSet || scaleSet.has(w.midi);
    let fill = COLORS.keyWhite;
    if (!inScale)  fill = 'rgba(255,255,255,0.03)';
    if (isHovered) fill = 'rgba(255,255,255,0.18)';
    if (isActive)  fill = COLORS.keyActive;
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

  for (const b of blacks) {
    const isHovered = hovered === b.midi;
    const isActive  = active && active.has(b.midi);
    const inScale   = !scaleSet || scaleSet.has(b.midi);
    let fill = COLORS.keyBlack;
    if (!inScale)  fill = 'rgba(0,0,0,0.75)';
    if (isHovered) fill = 'rgba(255,255,255,0.22)';
    if (isActive)  fill = COLORS.keyActive;
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

// ─── Scale hit points ─────────────────────────────────────────────────────────

function drawHitPoints(c, activeScale) {
  const y     = vp.h * LAYOUT.hitY;
  const count = HIT_LABELS.length;
  const stepX = vp.w / (count + 1);

  for (let i = 0; i < count; i++) {
    const x      = stepX * (i + 1);
    const active = HIT_LABELS[i] === activeScale;

    if (active) {
      c.shadowBlur  = 14;
      c.shadowColor = 'rgba(255,255,255,0.35)';
    }
    c.strokeStyle = active ? COLORS.bright : 'rgba(255,255,255,0.12)';
    c.lineWidth   = active ? 0.8 : 0.5;
    c.beginPath();
    c.arc(x, y, active ? 20 : 16, 0, Math.PI * 2);
    c.stroke();
    c.shadowBlur = 0;

    c.fillStyle = active ? COLORS.accent : COLORS.mid;
    c.beginPath();
    c.arc(x, y, active ? 2.5 : 1.5, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = active ? COLORS.bright : 'rgba(255,255,255,0.18)';
    c.font = `${active ? 9 : 8}px "DM Mono", monospace`;
    c.textAlign = 'center';
    c.fillText(HIT_LABELS[i], x, y + 36);
  }
}

// ─── Faders ───────────────────────────────────────────────────────────────────

function drawFaders(c, faders, gs) {
  if (!faders) return;
  const trackW = 22;
  const fadersBlockTop    = vp.h * LAYOUT.fadersTop;
  const fadersBlockBottom = vp.h * LAYOUT.fadersBottom;
  const fadersBlockH      = fadersBlockBottom - fadersBlockTop;
  const trackH = (fadersBlockH - 16) / 2;
  const leftX  = vp.w * 0.02;

  const tip = gs && gs.fingertips && gs.fingertips[1];
  const inStrip = tip && tip.x < 0.12 && tip.y >= 0.20 && tip.y <= 0.48;

  if (inStrip) {
    c.fillStyle = 'rgba(255,255,255,0.02)';
    c.fillRect(0, fadersBlockTop - 20, vp.w * 0.12, fadersBlockH + 32);
  }

  const hoveringCutoff = tip && tip.x < 0.12 && tip.y >= 0.20 && tip.y < 0.34;
  const hoveringRes    = tip && tip.x < 0.12 && tip.y >= 0.34 && tip.y <= 0.48;

  drawFader(c, leftX, fadersBlockTop,               trackW, trackH, faders.cutoff,    'CUTOFF', hoveringCutoff, gs?.pinchActive);
  drawFader(c, leftX, fadersBlockTop + trackH + 16, trackW, trackH, faders.resonance, 'RES',    hoveringRes,    gs?.pinchActive);
}

function drawFader(c, x, y, w, h, value, label, hovering, pinching) {
  const borderColor = hovering ? (pinching ? COLORS.accent : COLORS.bright) : 'rgba(255,255,255,0.12)';
  c.strokeStyle = borderColor;
  c.lineWidth   = hovering ? 1 : 0.5;
  c.strokeRect(x + 0.5, y + 0.5, w, h);
  const thumbY = y + h - h * Math.max(0, Math.min(1, value));
  c.fillStyle  = hovering ? COLORS.accent : COLORS.bright;
  c.fillRect(x - 6, thumbY - 1.5, w + 12, 3);
  if (label) {
    c.fillStyle = hovering ? COLORS.bright : 'rgba(255,255,255,0.18)';
    c.font = '8px "DM Mono", monospace';
    c.textAlign = 'center';
    c.fillText(label, x + w / 2, y - 4);
  }
}

// ─── Free zone ────────────────────────────────────────────────────────────────

function drawFreeZone(c, activeZone) {
  const x0 = vp.w * LAYOUT.freeLeft;
  const x1 = vp.w * LAYOUT.freeRight;
  const y0 = vp.h * LAYOUT.freeTop;
  const y1 = vp.h * LAYOUT.freeBottom;
  c.strokeStyle = activeZone === 'space' ? COLORS.bright : 'rgba(255,255,255,0.06)';
  c.lineWidth   = 0.5;
  c.setLineDash([3, 5]);
  c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  c.setLineDash([]);
  c.fillStyle = 'rgba(255,255,255,0.15)';
  c.font = '8px "DM Mono", monospace';
  c.textAlign = 'center';
  c.fillText('SPACE', (x0 + x1) / 2, y0 - 4);
}

// ─── Hand ─────────────────────────────────────────────────────────────────────

function drawHand(c, landmarks, gs, opts = {}) {
  if (!landmarks) return;
  const { tint = null, alpha = 1.0 } = opts;

  const mapX = (p) => p.x * vp.w;
  const mapY = (p) => p.y * vp.h;

  c.save();
  c.globalAlpha = alpha;

  // Skeleton connections
  const connColor = tint
    ? hexToRgba(tint, 0.5)
    : COLORS.dim;
  c.strokeStyle = connColor;
  c.lineWidth   = 1;
  c.beginPath();
  for (const [a, b] of gesture.MP_CONN) {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) continue;
    c.moveTo(mapX(pa), mapY(pa));
    c.lineTo(mapX(pb), mapY(pb));
  }
  c.stroke();

  // Landmark dots
  for (let i = 0; i < landmarks.length; i++) {
    const p     = landmarks[i];
    const isTip = gesture.FINGERTIPS.includes(i);
    const dotColor = tint
      ? hexToRgba(tint, isTip ? 0.85 : 0.45)
      : (isTip ? COLORS.bright : COLORS.mid);
    c.fillStyle = dotColor;
    c.beginPath();
    c.arc(mapX(p), mapY(p), isTip ? 4.5 : 3, 0, Math.PI * 2);
    c.fill();
  }

  // Pinch pulse (local hand only)
  if (!tint && gs && gs.pinchActive) {
    const a = landmarks[4], b = landmarks[8];
    if (a && b) {
      const cx = (mapX(a) + mapX(b)) / 2;
      const cy = (mapY(a) + mapY(b)) / 2;
      c.strokeStyle = COLORS.accent;
      c.lineWidth   = 0.8;
      c.beginPath();
      c.arc(cx, cy, 10 + 4 * Math.sin(performance.now() * 0.01), 0, Math.PI * 2);
      c.stroke();
    }
  }

  c.restore();
}

// ─── Ripples ─────────────────────────────────────────────────────────────────

function drawRipples(c, now) {
  ripples = ripples.filter((r) => now - r.start < 220);
  for (const r of ripples) {
    const t   = (now - r.start) / 220;
    const rad = r.maxR * t;
    c.strokeStyle = `rgba(255,255,255,${0.65 * (1 - t)})`;
    c.lineWidth   = 0.8;
    c.beginPath();
    c.arc(r.x, r.y, rad, 0, Math.PI * 2);
    c.stroke();
  }
}

// ─── HUD (debug, off by default) ─────────────────────────────────────────────

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
  c.font      = '10px "DM Mono", monospace';
  c.textAlign = 'left';
  c.fillStyle = 'rgba(255,255,255,0.45)';
  const x = 20;
  let y = vp.h - 12 - (lines.length - 1) * 14;
  for (const line of lines) {
    c.fillText(line, x, y);
    y += 14;
  }
  c.restore();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function setHUDVisible(v) { showHUD = v; }

export default { init, resize, draw, setHUDVisible };
