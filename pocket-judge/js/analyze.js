// Turns a pose track (MediaPipe landmarks per sampled frame) into flagged
// deductions, an estimated execution score, and coaching feedback.
//
// Pure functions — no DOM — so the logic can be tested in Node.

import { DEDUCTIONS, CUES, POSITIVE, eventById, levelById } from './codes.js';

const L = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lToe: 31, rToe: 32,
};
const VIS = 0.5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] || 0) + (b[2] || 0)) / 2];
const angleBetween = (u, v) => {
  const d = len(u) * len(v);
  if (!d) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / d))) * 180) / Math.PI;
};
// Interior angle at b for the chain a-b-c.
const joint = (a, b, c) => angleBetween(sub(a, b), sub(c, b));

const percentile = (arr, p) => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};

// Per-frame measurements.
export function measure(frame) {
  if (!frame?.lm) return null;
  const p = frame.lm; // normalized image coords [x, y, visibility]
  const w = frame.w || frame.lm.map(([x, y]) => [x, y, 0]); // world coords (meters)
  const vis = (...ids) => ids.every((i) => (p[i][2] ?? 1) >= VIS);
  const J = (a, b, c) => (vis(a, b, c) ? joint(w[a], w[b], w[c]) : NaN);

  const shMid = mid(p[L.lSh], p[L.rSh]);
  const hipMid = mid(p[L.lHip], p[L.rHip]);
  const torso = Math.max(0.02, Math.hypot(shMid[0] - hipMid[0], shMid[1] - hipMid[1]));
  const anMid = mid(p[L.lAn], p[L.rAn]);

  const legVecL = sub(w[L.lAn], w[L.lHip]);
  const legVecR = sub(w[L.rAn], w[L.rHip]);
  const legLen = (len(legVecL) + len(legVecR)) / 2 || 1;

  return {
    t: frame.t,
    elbowL: J(L.lSh, L.lEl, L.lWr),
    elbowR: J(L.rSh, L.rEl, L.rWr),
    kneeL: J(L.lHip, L.lKn, L.lAn),
    kneeR: J(L.rHip, L.rKn, L.rAn),
    hipL: J(L.lSh, L.lHip, L.lKn),
    hipR: J(L.rSh, L.rHip, L.rKn),
    shoulderL: J(L.lHip, L.lSh, L.lEl),
    shoulderR: J(L.rHip, L.rSh, L.rEl),
    footL: J(L.lKn, L.lAn, L.lToe),
    footR: J(L.rKn, L.rAn, L.rToe),
    split: vis(L.lHip, L.rHip, L.lAn, L.rAn) ? angleBetween(legVecL, legVecR) : NaN,
    ankleGap: vis(L.lAn, L.rAn) ? len(sub(w[L.lAn], w[L.rAn])) / legLen : NaN,
    torso,
    hipX: hipMid[0], hipY: hipMid[1],
    anX: anMid[0],
    lAnX: p[L.lAn][0], rAnX: p[L.rAn][0],
    lowAnkleY: Math.max(p[L.lAn][1], p[L.rAn][1]),
    highAnkleY: Math.min(p[L.lAn][1], p[L.rAn][1]),
    kneeY: Math.max(p[L.lKn][1], p[L.rKn][1]),
    wristY: Math.max(p[L.lWr][1], p[L.rWr][1]),
    shY: shMid[1],
    inverted: anMid[1] < shMid[1] - 0.3 * torso,
  };
}

// Group consecutive flagged samples into episodes: [{start, end, frames:[m...]}].
function episodes(ms, pred, { minLen = 2, gap = 1 } = {}) {
  const out = [];
  let cur = null;
  let miss = 0;
  ms.forEach((m, i) => {
    if (m && pred(m, i)) {
      if (!cur) cur = { i0: i, frames: [] };
      cur.frames.push(m);
      cur.i1 = i;
      miss = 0;
    } else if (cur) {
      miss++;
      if (miss > gap) {
        if (cur.frames.length >= minLen) out.push(cur);
        cur = null;
        miss = 0;
      }
    }
  });
  if (cur && cur.frames.length >= minLen) out.push(cur);
  return out.map((e) => ({ ...e, start: e.frames[0].t, end: e.frames[e.frames.length - 1].t }));
}

const minOf = (...v) => Math.min(...v.filter(Number.isFinite));

export function analyze({ frames, event, levelId, startValue = 10, skills = [] }) {
  const level = levelById(levelId);
  const ev = eventById(event) || eventById('floor');
  const scale = level.scale;
  const ms = frames.map(measure);
  const valid = ms.filter(Boolean);
  const coverage = frames.length ? valid.length / frames.length : 0;
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 0.1;
  const flags = [];
  const add = (key, sev, t, detail, extra = {}) => {
    const def = DEDUCTIONS[key];
    flags.push({
      id: `${key}-${Math.round(t * 1000)}-${flags.length}`,
      key,
      label: def.label,
      severity: sev,
      amount: +def.amount(sev, scale, level).toFixed(2),
      t: +t.toFixed(2),
      detail,
      active: true,
      ...extra,
    });
  };

  if (valid.length < 5) {
    return {
      startValue, score: startValue, total: 0, deductions: [], feedback: [], strengths: [],
      coverage, warning: 'The athlete could not be tracked in this clip. Film from the side, keep the whole body in frame, and use good lighting.',
    };
  }

  const torso = percentile(valid.map((m) => m.torso), 50);
  const apparatus = ev.kind === 'apparatus';

  // --- Ground & flight phases -------------------------------------------------
  // Ground = where the lowest ankle rests most of the time near the end of the clip
  // (the landing mat for apparatus events).
  const tail = valid.slice(Math.floor(valid.length * (apparatus ? 0.75 : 0)));
  const ground = percentile(tail.map((m) => m.lowAnkleY), apparatus ? 85 : 75);
  const airborne = ms.map((m) => !!m && m.lowAnkleY < ground - 0.45 * torso && m.wristY < ground - 0.3 * torso);

  // Landings: the frame where an airborne run (>= ~0.15s) returns to the ground.
  const landings = [];
  let run = 0;
  ms.forEach((m, i) => {
    if (!m) return;
    if (airborne[i]) run++;
    else {
      if (run * dt >= 0.15) landings.push(i);
      run = 0;
    }
  });
  const finalLanding = landings.length ? landings[landings.length - 1] : -1;
  const nearLanding = (i) => landings.some((li) => i >= li - Math.ceil(0.12 / dt) && i <= li + Math.ceil(0.3 / dt));

  // Frames where body form is judged in the air / upside down.
  const active = ms.map((m, i) => {
    if (!m || nearLanding(i)) return false;
    if (apparatus) return finalLanding < 0 || i < finalLanding - Math.ceil(0.15 / dt);
    return airborne[i] || m.inverted;
  });
  const isTuck = (m) => minOf(m.kneeL, m.kneeR) < 100 && minOf(m.hipL, m.hipR) < 110;

  // --- Bent arms ---------------------------------------------------------------
  for (const e of episodes(ms, (m, i) => active[i] && (apparatus || m.inverted) && minOf(m.elbowL, m.elbowR) < 158)) {
    const worst = Math.min(...e.frames.map((m) => minOf(m.elbowL, m.elbowR)));
    const sev = worst < 125 ? 3 : worst < 145 ? 2 : 1;
    add('bentArms', sev, e.start, `Elbows bent to ~${Math.round(worst)}°`);
  }

  // --- Bent knees (ignore intentional tucks / pikes) ---------------------------
  for (const e of episodes(ms, (m, i) => active[i] && !isTuck(m) && minOf(m.kneeL, m.kneeR) < 155 && minOf(m.hipL, m.hipR) > 110)) {
    const worst = Math.min(...e.frames.map((m) => minOf(m.kneeL, m.kneeR)));
    const sev = worst < 120 ? 3 : worst < 140 ? 2 : 1;
    add('bentKnees', sev, e.start, `Knees bent to ~${Math.round(worst)}°`);
  }

  // --- Flexed feet (capped: at most 6 instances) ------------------------------
  let footCount = 0;
  for (const e of episodes(ms, (m, i) => active[i] && minOf(m.footL, m.footR) < 138)) {
    if (footCount++ >= 6) break;
    const worst = Math.min(...e.frames.map((m) => minOf(m.footL, m.footR)));
    add('flexedFeet', worst < 115 ? 2 : 1, e.start, `Ankle angle ~${Math.round(worst)}° (pointed ≈ 160°+)`);
  }

  // --- Leg separation (legs should be together) --------------------------------
  if (ev.id !== 'pommel') {
    for (const e of episodes(ms, (m, i) => active[i] && m.split < 45 && m.ankleGap > 0.28 && (m.inverted || apparatus), { minLen: 3 })) {
      const worst = Math.max(...e.frames.map((m) => m.ankleGap));
      add('legSeparation', worst > 0.5 ? 2 : 1, e.start, 'Legs apart when they should be squeezed together');
    }
  }

  // --- Leaps & jumps: split amplitude ------------------------------------------
  if (['floor', 'beam'].includes(ev.id)) {
    const req = level.split;
    for (const e of episodes(ms, (m, i) => airborne[i] && !m.inverted && m.split > 60, { minLen: 1 })) {
      const peak = Math.max(...e.frames.map((m) => m.split));
      const short = req - peak;
      if (short > 5) {
        const sev = short > 20 ? 3 : short > 10 ? 2 : 1;
        add('splitShort', sev, e.frames.find((m) => m.split === peak).t, `Split ~${Math.round(peak)}° vs ${req}° required`, { requirement: req });
      }
    }
  }

  // --- Handstand shape (sustained inversions only) ------------------------------
  for (const e of episodes(ms, (m, i) => m.inverted && !airborne[i], { minLen: Math.max(3, Math.ceil(0.35 / dt)) })) {
    const hip = percentile(e.frames.map((m) => minOf(m.hipL, m.hipR)), 50);
    const sh = percentile(e.frames.map((m) => minOf(m.shoulderL, m.shoulderR)), 50);
    if (hip < 160) add('handstandShape', hip < 135 ? 3 : hip < 150 ? 2 : 1, e.start, `Body line ~${Math.round(hip)}° at the hips`);
    if (sh < 155) add('closedShoulders', sh < 130 ? 3 : sh < 145 ? 2 : 1, e.start, `Shoulder angle ~${Math.round(sh)}°`);
  }

  // --- Balance checks (beam) -----------------------------------------------------
  if (ev.id === 'beam') {
    const win = Math.max(4, Math.ceil(0.8 / dt));
    let i = 0;
    while (i < ms.length - win) {
      const seg = ms.slice(i, i + win).filter((m, k) => m && !airborne[i + k] && !m.inverted);
      if (seg.length >= win * 0.7) {
        const sway = seg.map((m) => (m.hipX - m.anX) / torso);
        const range = Math.max(...sway) - Math.min(...sway);
        const reversals = sway.slice(2).filter((s, k) => Math.sign(sway[k + 1] - sway[k]) !== Math.sign(s - sway[k + 1])).length;
        if (range > 0.35 && reversals >= 2) {
          add('balanceCheck', range > 0.7 ? 3 : range > 0.5 ? 2 : 1, seg[0].t, 'Hips swayed off the beam line');
          i += win * 2;
          continue;
        }
      }
      i += Math.ceil(win / 2);
    }
  }

  // --- Landings: steps, deep landing, hands down, falls --------------------------
  landings.forEach((li, n) => {
    const isFinal = n === landings.length - 1;
    const after = Math.ceil(1.6 / dt);
    // A landing that rebounds into another skill is a connection, not a finish.
    const next = landings[n + 1];
    const reboundAt = ms.findIndex((m, i) => i > li && airborne[i]);
    const connected = reboundAt > 0 && reboundAt - li <= Math.ceil(0.5 / dt);
    if (!isFinal && connected) return;
    const end = Math.min(ms.length, li + after, next ?? Infinity, reboundAt > li ? reboundAt : Infinity);
    const win = ms.slice(li, end).filter(Boolean);
    if (win.length < 2) return;
    const t0 = ms[li]?.t ?? win[0].t;

    const fell = win.some((m) => m.hipY > ground - 0.35 * torso || m.kneeY > ground - 0.05 * torso && m.hipY > ground - 0.7 * torso);
    if (fell) {
      add('fall', 3, t0, 'Hips or knees reached the mat');
      return;
    }
    if (win.some((m) => m.wristY > ground - 0.12 * torso)) add('handDown', 3, t0, 'Hand support on the mat');

    // Steps: an ankle travelling sideways more than ~0.35 torso after settling.
    const settle = win.slice(Math.min(win.length - 1, Math.ceil(0.2 / dt)));
    let steps = 0;
    for (const key of ['lAnX', 'rAnX']) {
      let anchor = settle[0][key];
      for (const m of settle) {
        const d = Math.abs(m[key] - anchor) / torso;
        if (d > 0.35) {
          steps++;
          add('landingStep', d > 1.0 ? 3 : 1, m.t, d > 1.0 ? 'Large step (wider than shoulders)' : 'Small step / adjustment');
          anchor = m[key];
          if (steps >= 4) break;
        }
      }
    }
    const deepest = Math.min(...win.map((m) => minOf(m.hipL, m.hipR)));
    if (deepest < 80) add('deepLanding', deepest < 60 ? 2 : 1, t0, `Hips closed to ~${Math.round(deepest)}° on landing`);
  });

  return finalize({ startValue, deductions: flags, event: ev.id, skills, coverage, levelId });
}

// Recompute totals & feedback from the (possibly user-edited) deduction list.
export function finalize({ startValue, deductions, event, skills = [], coverage = 1, levelId }) {
  const level = levelById(levelId);
  const live = deductions.filter((d) => d.active);
  // USAG caps: feet & steps don't stack indefinitely.
  const capped = {};
  const caps = { flexedFeet: 0.3, landingStep: 0.4, balanceCheck: 0.8 };
  let total = 0;
  for (const d of live) {
    const cap = caps[d.key];
    const used = capped[d.key] || 0;
    const amt = cap ? Math.max(0, Math.min(d.amount, cap - used)) : d.amount;
    capped[d.key] = used + amt;
    total += amt;
  }
  total = Math.round(total * 100) / 100;
  const score = Math.max(0, Math.round((startValue - total) * 1000) / 1000);

  const byKey = {};
  live.forEach((d) => { (byKey[d.key] ||= []).push(d); });
  const order = Object.entries(byKey).sort((a, b) => sum(b[1]) - sum(a[1]));
  const feedback = order.map(([key, list]) => {
    const c = CUES[key](event, skills, list[0]);
    return { key, label: DEDUCTIONS[key].label, count: list.length, cost: +sum(list).toFixed(2), ...c };
  });
  const strengths = Object.entries(POSITIVE)
    .filter(([k]) => !byKey[k] && relevant(k, event))
    .map(([, v]) => v);

  return {
    startValue, score, total, deductions, feedback, strengths, coverage, level: level.id,
    warning: coverage < 0.6 ? 'The athlete was only tracked in part of this clip, so some deductions may be missed. Keep the whole body in frame.' : null,
  };
}

const sum = (list) => list.reduce((s, d) => s + d.amount, 0);
const relevant = (key, event) => {
  if (key === 'splitShort') return ['floor', 'beam'].includes(event);
  if (key === 'balanceCheck') return event === 'beam';
  return true;
};
