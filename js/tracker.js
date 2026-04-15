// MediaPipe Hand Landmarker wrapper. Mirrors landmark X (so the on-screen
// hand matches a user-facing camera mirrored with CSS scaleX(-1)).

let handLandmarker = null;
let videoEl = null;
let lastResult = null;
let lastTs = 0;

const VISION_MODULE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function init(video) {
  videoEl = video;
  const { FilesetResolver, HandLandmarker } = await import(VISION_MODULE);
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    numHands: 2,
    runningMode: 'VIDEO',
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

function detect(ts) {
  if (!handLandmarker || !videoEl || videoEl.readyState < 2) return null;
  const t = Math.floor(ts || performance.now());
  if (t === lastTs) return lastResult;
  lastTs = t;
  let raw;
  try {
    raw = handLandmarker.detectForVideo(videoEl, t);
  } catch (e) {
    return null;
  }
  if (!raw || !raw.landmarks) {
    lastResult = { landmarks: [] };
    return lastResult;
  }
  // Mirror X so landmark space matches the on-screen mirrored camera.
  const mirrored = raw.landmarks.map((hand) =>
    hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }))
  );
  lastResult = { landmarks: mirrored };
  return lastResult;
}

export default { init, detect };
