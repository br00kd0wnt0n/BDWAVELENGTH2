// Multi-hand, multi-fingertip gesture interpreter.
// Each of up to 2 hands contributes:
//   - All 5 fingertips to string-crossing detection
//   - Its index fingertip to key hover
//   - Its pinch edge (thumb↔index) to key press / drag
//   - Its velocity into merged hand speed
// Primary hand (index 0) also drives pose flags, active zone, tap BPM.

const MP_CONN = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

const FINGERTIPS = [4, 8, 12, 16, 20];
const PALM_HISTORY_SIZE = 5;
const TAP_SMOOTH = 5;
const TAP_MIN_INTERVAL_MS = 150;
const TAP_MIN_DISPLACEMENT = 0.04;
const PINCH_THRESHOLD = 0.5;

const perHand = new Map();

const shared = {
  activeZone: null,
  stringYs: [],
  keyBand: { top: 0, bottom: 0 },
  keyLayout: null,
};

function setLayout({ stringYs, keyBand, keyLayout }) {
  if (stringYs) shared.stringYs = stringYs;
  if (keyBand) shared.keyBand = keyBand;
  if (keyLayout) shared.keyLayout = keyLayout;
}
function getActiveZone() { return shared.activeZone; }

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function extended(lm, tipIdx, pipIdx) {
  return lm[tipIdx].y < lm[pipIdx].y - 0.02;
}

function getHandState(idx) {
  if (!perHand.has(idx)) {
    perHand.set(idx, {
      palmHistory: [],
      tapYBuffer: [],
      tapTimestamps: [],
      lastIndexY: null,
      tapCooldownUntil: 0,
      tapDirection: 0,
      tapPeakY: null,
      pinchOpen: true,
      pinchAnchor: null,
      lastFingerYs: {},
      heldKey: null,
    });
  }
  return perHand.get(idx);
}

function update(hands, viewport, ts) {
  const gs = emptyState();

  if (!hands || !hands.length) {
    perHand.clear();
    return gs;
  }

  for (let h = 0; h < Math.min(hands.length, 2); h++) {
    const lm = hands[h];
    if (!lm || lm.length < 21) continue;
    processHand(gs, lm, getHandState(h), viewport, ts, h);
  }

  return gs;
}

function processHand(gs, lm, hs, viewport, ts, handIdx) {
  const wrist = lm[0], mcp = lm[9];
  const palmSize = Math.max(0.0001, dist2(wrist, mcp));
  const palmX = (wrist.x + mcp.x) / 2;
  const palmY = (wrist.y + mcp.y) / 2;
  const isPrimary = handIdx === 0;

  if (isPrimary) {
    gs.fingertips = FINGERTIPS.map((i) => ({
      x: lm[i].x, y: lm[i].y, z: lm[i].z,
    }));
    gs.wristX = wrist.x;
    gs.wristY = wrist.y;
    gs.palmX = palmX;
    gs.palmY = palmY;
  }

  // Pinch (per hand)
  const thumb = lm[4], index = lm[8];
  const pinchDist = dist2(thumb, index);
  const pinchNorm = pinchDist / palmSize;
  const pinchActive = pinchNorm < PINCH_THRESHOLD;

  if (pinchActive) gs.pinchActive = true;
  if (isPrimary) {
    gs.pinchAperture = Math.max(0, Math.min(1, pinchNorm / 0.6));
    gs.pinchNorm = pinchNorm;
  }

  let pinchJustClosed = false;
  if (pinchActive && hs.pinchOpen) {
    hs.pinchAnchor = { x: palmX, y: palmY };
    hs.pinchOpen = false;
    pinchJustClosed = true;
  } else if (!pinchActive && !hs.pinchOpen) {
    hs.pinchAnchor = null;
    hs.pinchOpen = true;
  }
  if (pinchJustClosed) gs.pinchJustClosed = true;

  if (isPrimary && pinchActive && hs.pinchAnchor) {
    gs.pinchDragActive = true;
    gs.pinchDragX = (palmX - hs.pinchAnchor.x) * viewport.w;
    gs.pinchDragY = (palmY - hs.pinchAnchor.y) * viewport.h;
  }

  // Pose flags (primary only)
  if (isPrimary) {
    const idxExt = extended(lm, 8, 6);
    const midExt = extended(lm, 12, 10);
    const ringExt = extended(lm, 16, 14);
    const pinkExt = extended(lm, 20, 18);
    gs.indexPointing = idxExt && !midExt && !ringExt && !pinkExt;
    gs.palmOpen = idxExt && midExt && ringExt && pinkExt;
    gs.fistClosed = !idxExt && !midExt && !ringExt && !pinkExt;
  }

  // Velocity
  hs.palmHistory.push({ x: palmX, y: palmY, t: ts });
  if (hs.palmHistory.length > PALM_HISTORY_SIZE) hs.palmHistory.shift();
  let handSpeed = 0;
  if (hs.palmHistory.length >= 4) {
    const old = hs.palmHistory[hs.palmHistory.length - 4];
    const dt = Math.max(1, ts - old.t);
    const dx = (palmX - old.x) * viewport.w;
    const dy = (palmY - old.y) * viewport.h;
    const vx = dx / dt * 1000;
    const vy = dy / dt * 1000;
    handSpeed = Math.sqrt(vx * vx + vy * vy);
    if (isPrimary) {
      gs.palmVelX = vx;
      gs.palmVelY = vy;
    }
  }
  gs.handSpeed = Math.max(gs.handSpeed || 0, handSpeed);

  // String crossings from ALL fingertips of this hand.
  // 12 strings: 0-5 LEFT (fingertip x < 0.5), 6-11 RIGHT (x >= 0.5).
  // Skip crossings when fingertip is inside the fader strip (x < 0.08)
  // or the free-expression strip (x > 0.92) so reaching controls doesn't
  // accidentally pluck strings.
  if (shared.stringYs.length) {
    for (const tipIdx of FINGERTIPS) {
      const tip = lm[tipIdx];
      const curTipY = tip.y * viewport.h;
      const curTipX = tip.x;
      const key = `t${tipIdx}`;
      const lastY = hs.lastFingerYs[key];
      const inControlStrip = curTipX < 0.10 || curTipX > 0.90;
      if (!inControlStrip && lastY != null && lastY !== curTipY) {
        const sideOffset = curTipX < 0.5 ? 0 : 6;
        const lo = Math.min(lastY, curTipY);
        const hi = Math.max(lastY, curTipY);
        shared.stringYs.forEach((sy, i) => {
          const absIdx = i + sideOffset;
          if (sy >= lo && sy <= hi && !gs.stringsCrossed.includes(absIdx)) {
            gs.stringsCrossed.push(absIdx);
          }
        });
      }
      hs.lastFingerYs[key] = curTipY;
    }
  }

  // Key hover + press (index fingertip of this hand)
  const curX = index.x * viewport.w;
  const curY = index.y * viewport.h;
  const hoverTop = shared.keyBand.top - viewport.h * 0.04;
  const hoverBottom = shared.keyBand.bottom + viewport.h * 0.04;
  let hoveredMidi = null;
  if (shared.keyLayout && curY >= hoverTop && curY <= hoverBottom) {
    hoveredMidi = shared.keyLayout.hitTest(curX, curY);
    if (hoveredMidi !== null) {
      if (gs.hoveredKeyIndex == null) gs.hoveredKeyIndex = hoveredMidi;
      if (!gs.hoveredKeys.includes(hoveredMidi)) gs.hoveredKeys.push(hoveredMidi);
    }
  }

  // Press on pinch-close over a key; release on pinch-open.
  if (pinchJustClosed && hoveredMidi !== null) {
    hs.heldKey = hoveredMidi;
    gs.keyPressed = true;
    if (!gs.keyPresses.includes(hoveredMidi)) gs.keyPresses.push(hoveredMidi);
  }
  if (!pinchActive && hs.heldKey !== null) {
    if (!gs.keyReleases.includes(hs.heldKey)) gs.keyReleases.push(hs.heldKey);
    hs.heldKey = null;
  }

  // Active zone (primary hand only). Layout:
  //  hit    y 0–12%
  //  strings y 16–50%  (with faders in left 8%, free-zone in right 8%)
  //  gap    y 50–58%
  //  keys   y 58–85%
  if (isPrimary) {
    if (palmX > 0.92 && curY < viewport.h * 0.50) shared.activeZone = 'space';
    else if (palmX < 0.08 && curY < viewport.h * 0.50) shared.activeZone = 'faders';
    else if (curY < viewport.h * 0.12) shared.activeZone = 'hit';
    else if (curY < viewport.h * 0.50) shared.activeZone = 'strings';
    else if (curY < viewport.h * 0.58) shared.activeZone = null;
    else if (curY < viewport.h * 0.85) shared.activeZone = 'keys';
    else shared.activeZone = null;
    gs.activeZone = shared.activeZone;

    if (shared.activeZone === 'space') {
      gs.spaceX = Math.max(0, Math.min(1, (palmX - 0.92) / 0.06));
      gs.spaceY = 1 - Math.max(0, Math.min(1, (palmY - 0.22) / 0.24));
    }
  }

  // Tap detection (primary hand only)
  if (isPrimary) {
    hs.tapYBuffer.push(index.y);
    if (hs.tapYBuffer.length > TAP_SMOOTH) hs.tapYBuffer.shift();
    const smoothY = hs.tapYBuffer.reduce((s, v) => s + v, 0) / hs.tapYBuffer.length;
    if (hs.lastIndexY !== null) {
      const dy = smoothY - hs.lastIndexY;
      if (dy > 0.002) {
        hs.tapDirection = -1;
        hs.tapPeakY = hs.tapPeakY == null ? smoothY : Math.max(hs.tapPeakY, smoothY);
      } else if (dy < -0.002 && hs.tapDirection === -1) {
        const displacement = (hs.tapPeakY || 0) - (hs.lastIndexY - Math.abs(dy));
        if (displacement >= TAP_MIN_DISPLACEMENT && ts - hs.tapCooldownUntil > 0) {
          gs.tapFired = true;
          hs.tapTimestamps.push(ts);
          if (hs.tapTimestamps.length > 4) hs.tapTimestamps.shift();
          hs.tapCooldownUntil = ts + TAP_MIN_INTERVAL_MS;
        }
        hs.tapDirection = 1;
        hs.tapPeakY = null;
      }
    }
    hs.lastIndexY = smoothY;

    if (hs.tapTimestamps.length >= 2) {
      const diffs = [];
      for (let i = 1; i < hs.tapTimestamps.length; i++) {
        diffs.push(hs.tapTimestamps[i] - hs.tapTimestamps[i - 1]);
      }
      const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
      gs.tapBPM = mean > 0 ? Math.round(60000 / mean) : null;
    }
  }
}

function emptyState() {
  return {
    pinchActive: false, pinchAperture: 0, pinchNorm: 0,
    pinchJustClosed: false, pinchJustOpened: false,
    fistClosed: false, palmOpen: false, indexPointing: false,
    palmX: 0.5, palmY: 0.5, wristX: 0.5, wristY: 0.5,
    fingertips: [],
    palmVelX: 0, palmVelY: 0, handSpeed: 0,
    tapFired: false, tapBPM: null, tapSwing: 0,
    pinchDragX: 0, pinchDragY: 0, pinchDragActive: false,
    stringsCrossed: [], stringsVelocity: 0,
    hoveredKeyIndex: null,
    hoveredKeys: [],
    keyPressed: false,
    keyPresses: [],
    keyReleases: [],
    activeZone: null,
    spaceX: 0, spaceY: 0,
  };
}

export default { update, setLayout, getActiveZone, MP_CONN, FINGERTIPS };
