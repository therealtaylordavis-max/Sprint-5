// Vercel serverless function: AI coach review with Claude.
//
// The browser sends a few still frames from the clip (JPEG, base64) plus the
// deductions the on-device pose tracker flagged. Claude checks each flag
// against the frames and writes level-appropriate coaching feedback.
// The API key lives only in the Vercel project's environment variables.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';
const MAX_FRAMES = 8;
const MAX_FRAME_BYTES = 450_000; // base64 chars per frame
const RATE = { windowMs: 10 * 60 * 1000, max: 12 }; // per IP, per warm instance

// The key is read from ANTHROPIC_API_KEY, or from the name it was saved under
// in this project's Vercel settings.
const apiKey = () => process.env.ANTHROPIC_API_KEY || process.env.AnthropicAPIPocketJudge;

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE.max;
}

const SYSTEM = `You are an experienced gymnastics judge and coach (USA Gymnastics Development Program, Xcel, NCAA and FIG codes) helping young athletes train.

You receive a few still frames from a practice video, each labeled with its timestamp, plus execution deductions that an automatic pose tracker flagged. The tracker measures joint angles from 2-D video, so it can be fooled by camera angle, loose clothing, equipment blocking the body, or a skill that bends a joint on purpose.

Your job:
1. For each flagged deduction, look at the frame(s) nearest its timestamp and give a verdict: "confirmed" when the fault is visible, "likely_wrong" when the frame clearly contradicts it, or "uncertain" when the frames can't show it (for example, a step that happens between frames). Keep each note to one short sentence.
2. Note up to 3 additional execution faults you can clearly see that were not flagged. Only report what is visible; never guess.
3. Write coaching cues for the most important fixes: specific, encouraging, and suitable for a young athlete, naming the skill when you can tell it (for example "Make sure you're using straight arms on your kip, cast, and cast handstand"). Include 1-3 practical drills per cue.
4. List up to 3 genuine strengths.

Rules: comment only on technique and form, never on body shape, weight or appearance, and never try to identify the person. If a landing or position looks unsafe, say so kindly and suggest working with a coach or spotter. Keep the whole review short and positive.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'verdicts', 'extra_faults', 'cues', 'strengths'],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences of overall feedback.' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'note'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'uncertain', 'likely_wrong'] },
          note: { type: 'string' },
        },
      },
    },
    extra_faults: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['t', 'label', 'note'],
        properties: { t: { type: 'number' }, label: { type: 'string' }, note: { type: 'string' } },
      },
    },
    cues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'cue', 'drills'],
        properties: { title: { type: 'string' }, cue: { type: 'string' }, drills: { type: 'array', items: { type: 'string' } } },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
  },
};

const clip = (s, n) => String(s ?? '').slice(0, n);

function validate(body) {
  if (!body || typeof body !== 'object') return 'Missing request body.';
  const { frames, deductions } = body;
  if (!Array.isArray(frames) || frames.length === 0) return 'At least one frame is required.';
  if (frames.length > MAX_FRAMES) return `At most ${MAX_FRAMES} frames are allowed.`;
  for (const f of frames) {
    if (typeof f?.data !== 'string' || f.data.length > MAX_FRAME_BYTES || !/^[A-Za-z0-9+/=]+$/.test(f.data)) return 'Invalid frame image.';
    if (!Number.isFinite(f.t)) return 'Invalid frame time.';
  }
  if (!Array.isArray(deductions) || deductions.length > 40) return 'Invalid deductions list.';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (!apiKey()) {
    return res.status(503).json({ error: 'AI review is not set up yet (missing ANTHROPIC_API_KEY).' });
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) {
    return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many AI reviews in a short time. Please wait a few minutes.' });
  }
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ error: problem });

  const { event, level, skills = [], startValue, score, frames, deductions } = req.body;
  const flagged = deductions.map((d) => ({
    id: clip(d.id, 80), t: Number(d.t) || 0, label: clip(d.label, 60), detail: clip(d.detail, 120), amount: Number(d.amount) || 0,
  }));

  const content = [
    {
      type: 'text',
      text: [
        `Event: ${clip(event, 40)}`,
        `Level / code: ${clip(level, 60)}`,
        `Skills tagged by the athlete: ${skills.map((s) => clip(s, 40)).join(', ') || 'not specified'}`,
        `Tracker estimate: ${Number(score).toFixed(3)} from a start value of ${Number(startValue).toFixed(2)}`,
        `Flagged deductions (JSON): ${JSON.stringify(flagged)}`,
      ].join('\n'),
    },
  ];
  for (const f of frames) {
    content.push({ type: 'text', text: `Frame at ${Number(f.t).toFixed(2)}s${f.note ? ` (${clip(f.note, 80)})` : ''}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } });
  }

  const client = new Anthropic({ apiKey: apiKey() });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'The AI declined to review this clip.' });
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(502).json({ error: 'The AI review was cut short. Please try again.' });
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let review;
    try {
      review = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'The AI returned an unreadable review. Please try again.' });
    }
    return res.status(200).json({ review, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic auth failed — check ANTHROPIC_API_KEY');
      return res.status(503).json({ error: 'AI review is misconfigured (the API key was rejected).' });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'The AI service is busy. Please try again in a minute.' });
    }
    if (error instanceof Anthropic.BadRequestError) {
      console.error('Anthropic bad request:', error.message);
      return res.status(400).json({ error: 'The AI could not process these frames.' });
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}:`, error.message);
      return res.status(502).json({ error: 'The AI service had a problem. Please try again.' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
}
