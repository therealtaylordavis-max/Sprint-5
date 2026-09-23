// AI coach review: grabs a few still frames from the stored clip and asks the
// server (api/review.js → Claude) to check the flagged deductions.

const MAX_FRAMES = 8;
const MAX_SIDE = 640;

// Pick frame times: every flagged moment (biggest deductions first), then fill
// with evenly spaced frames so Claude sees the whole skill.
export function pickFrameTimes(deductions, duration) {
  const picks = [];
  const near = (t) => picks.some((p) => Math.abs(p.t - t) < 0.2);
  const flagged = deductions.filter((d) => d.active).sort((a, b) => b.amount - a.amount);
  for (const d of flagged) {
    if (picks.length >= 6) break;
    if (!near(d.t)) picks.push({ t: d.t, note: `flagged: ${d.label}` });
  }
  const fill = MAX_FRAMES - picks.length;
  for (let i = 0; i < fill; i++) {
    const t = +(((i + 0.5) / fill) * duration).toFixed(2);
    if (!near(t)) picks.push({ t });
  }
  return picks.sort((a, b) => a.t - b.t);
}

function seek(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

export async function captureFrames(blob, picks) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('Could not read the video.'));
  });
  if (!Number.isFinite(video.duration)) { await seek(video, 1e7); await seek(video, 0); }
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  const frames = [];
  for (const p of picks) {
    await seek(video, Math.min(p.t, video.duration - 0.01));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
    frames.push({ t: p.t, note: p.note, data });
  }
  URL.revokeObjectURL(video.src);
  return frames;
}

export async function requestReview(payload) {
  let res;
  try {
    res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the AI review service. Check your connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `AI review failed (${res.status}).`);
  return body.review;
}
