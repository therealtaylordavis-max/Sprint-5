// In-browser pose tracking with MediaPipe Pose Landmarker. Video never leaves
// the device: frames are decoded and analyzed locally.

const VERSION = '1.0.1';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

let landmarkerPromise = null;

async function create(vision, fileset, delegate) {
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

export function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await import(`${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      try {
        return await create(vision, fileset, 'GPU');
      } catch {
        return create(vision, fileset, 'CPU');
      }
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

const round = (n) => Math.round(n * 1000) / 1000;

function seek(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

function loadVideo(blob) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = URL.createObjectURL(blob);
    v.onloadeddata = async () => {
      // MediaRecorder WebM files often report Infinity duration until scanned.
      if (!Number.isFinite(v.duration)) {
        await seek(v, 1e7);
        await seek(v, 0);
      }
      resolve(v);
    };
    v.onerror = () => reject(new Error('This video format could not be decoded by your browser.'));
  });
}

// Samples the clip and returns [{t, lm:[[x,y,vis]...], w:[[x,y,z]...]}].
export async function trackVideo(blob, onProgress = () => {}) {
  onProgress({ stage: 'model', pct: 0 });
  const landmarker = await loadLandmarker();
  const video = await loadVideo(blob);
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the video length.');
  if (duration > 150) throw new Error('Clips longer than 2½ minutes are not supported — trim to a single routine.');

  // ~12 fps for short skills, fewer for long routines (keeps analysis to seconds).
  const fps = Math.max(6, Math.min(15, 300 / duration));
  const step = 1 / fps;
  const frames = [];
  let ts = 0;
  for (let t = 0; t < duration; t += step) {
    await seek(video, Math.min(t, duration - 0.001));
    ts += 1 + Math.round(step * 1000);
    const res = landmarker.detectForVideo(video, ts);
    const lm = res.landmarks?.[0];
    const w = res.worldLandmarks?.[0];
    frames.push({
      t: round(t),
      lm: lm ? lm.map((p) => [round(p.x), round(p.y), round(p.visibility ?? 1)]) : null,
      w: w ? w.map((p) => [round(p.x), round(p.y), round(p.z)]) : null,
    });
    onProgress({ stage: 'track', pct: Math.min(1, t / duration) });
  }
  const size = { w: video.videoWidth, h: video.videoHeight };
  URL.revokeObjectURL(video.src);
  return { frames, duration, size };
}

export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31], [27, 29], [29, 31], [24, 26], [26, 28], [28, 32], [28, 30], [30, 32],
];
