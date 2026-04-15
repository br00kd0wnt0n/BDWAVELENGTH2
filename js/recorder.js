// Captures the Tone master output via MediaStreamDestination and triggers a
// webm download when stopped.

let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let recording = false;

function init({ button }) {
  // no-op; the caller wires the click handler. We expose toggle().
}

function getSupportedMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function start() {
  if (recording) return true;
  if (!window.Tone || !Tone.context) return false;

  // Build a destination stream from Tone context
  const dest = Tone.context.createMediaStreamDestination();
  Tone.Destination.connect(dest);

  const mime = getSupportedMime();
  try {
    mediaRecorder = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    return false;
  }
  chunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ext = (mime && mime.includes('mp4')) ? 'm4a' : 'webm';
    a.href = url;
    a.download = `gestural-synth-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
  };

  mediaRecorder.start();
  startedAt = Date.now();
  recording = true;
  return true;
}

function stop() {
  if (!recording || !mediaRecorder) return false;
  mediaRecorder.stop();
  recording = false;
  return false;
}

function toggle() {
  if (recording) { stop(); return false; }
  // start is async but returns a promise-ish bool; UI updates optimistically.
  start();
  return true;
}

function isRecording() { return recording; }

export default { init, start, stop, toggle, isRecording };
