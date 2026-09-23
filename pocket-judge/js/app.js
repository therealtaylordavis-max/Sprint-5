import { EVENTS, LEVELS, SKILLS, DEDUCTIONS, eventById, levelById, eventsForLevel } from './codes.js';
import { analyze, finalize } from './analyze.js';
import { trackVideo, loadLandmarker, CONNECTIONS } from './pose.js';
import * as db from './store.js';
import { lineChart, sparkline, barList } from './charts.js';
import { loadSample } from './sample.js';
import { pickFrameTimes, captureFrames, requestReview } from './ai.js';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $who = document.getElementById('who');

// ---- Helpers -------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(d).toLocaleDateString(undefined, opts);
const initials = (name) => name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const qs = (sel, root = $app) => root.querySelector(sel);
const qsa = (sel, root = $app) => [...root.querySelectorAll(sel)];

const I = {
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.2 3.2 0 0 1 0 6.3M18 14.3c1.8.8 3 2.6 3 4.7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  upload: '<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4m0 3v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  share: '<path d="M12 3v12m0-12L8 7m4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  gymnast: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5v6m0 0-4 6m4-6 4 6M5 10l7-1.5L19 10"/>',
  whistle: '<circle cx="9" cy="14" r="5"/><path d="M13 11h8v4h-5M9 14h.01M6 5l2 3M3 8l3 1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function banner(kind, html) {
  const ic = kind === 'warn' ? 'alert' : kind === 'good' ? 'check' : 'info';
  return `<div class="banner ${kind}">${icon(ic)}<div>${html}</div></div>`;
}

function levelOptions(selected) {
  const groups = [...new Set(LEVELS.map((l) => l.group))];
  return groups.map((g) => `<optgroup label="${esc(g)}">${LEVELS.filter((l) => l.group === g)
    .map((l) => `<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`).join('');
}

async function shareJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Pocket Judge share file' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

async function importFromFile() {
  const f = await pickFile('application/json,.json');
  if (!f) return null;
  try {
    const res = await db.importShare(JSON.parse(await f.text()));
    toast(`Imported ${res.athletes} athlete(s) and ${res.sessions} session(s).`);
    return res;
  } catch (e) {
    toast(e.message || 'Could not read that file.');
    return null;
  }
}

// ---- State & routing -----------------------------------------------------------

const state = { role: null, athleteId: null, coachUnlocked: false };
let cleanup = () => {};

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(query)) };
}

function renderNav(active) {
  const links = [
    ['home', '#/', 'Home'],
    ['camera', '#/judge', 'Judge'],
    ['chart', '#/progress', 'Progress'],
    ['users', '#/coach', 'Coach'],
    ['settings', '#/settings', 'Settings'],
  ];
  $nav.innerHTML = links.map(([ic, href, label]) =>
    `<a href="${href}" class="${active === label ? 'on' : ''}" ${active === label ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('');
  $nav.hidden = !state.role;
}

async function renderWho() {
  const a = state.athleteId ? await db.getAthlete(state.athleteId) : null;
  $who.innerHTML = state.role === 'coach' ? `<span class="pill coach">Coach mode</span>` : a ? `<span>${esc(a.name)} · ${esc(levelById(a.levelId).name)}</span>` : '';
}

async function route() {
  cleanup();
  cleanup = () => {};
  const { parts, query } = parseHash();
  const [page, id] = parts;
  state.role = await db.getSetting('role');
  state.athleteId = await db.getSetting('athleteId');
  if (state.athleteId && !(await db.getAthlete(state.athleteId))) state.athleteId = null;
  await renderWho();

  if (!state.role) { renderNav(); return viewWelcome(); }
  const views = {
    '': ['Home', () => (state.role === 'coach' ? viewCoach() : viewHome())],
    judge: ['Judge', () => viewJudge(query)],
    session: ['', () => viewSession(id)],
    progress: ['Progress', () => viewProgress(query.athlete || state.athleteId, query.event)],
    coach: ['Coach', () => viewCoach()],
    athlete: ['Coach', () => viewAthletePortal(id, query.event)],
    settings: ['Settings', () => viewSettings()],
  };
  const [label, fn] = views[page || ''] || views[''];
  renderNav(label || (state.role === 'coach' ? 'Coach' : 'Progress'));
  try {
    await fn();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="card">${banner('warn', `Something went wrong: ${esc(e.message)}`)}<a class="btn" href="#/">Go home</a></div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---- Welcome / onboarding ------------------------------------------------------

function viewWelcome() {
  $app.innerHTML = `
    <div class="stack">
      <div>
        <h1>Your pocket-sized gymnastics judge</h1>
        <p class="muted">Prop up your phone, film a skill or routine, and get an estimated execution score, flagged deductions, and coaching cues in seconds. Videos are analyzed on your device.</p>
      </div>
      <div class="role-pick">
        <button data-role="gymnast">${icon('gymnast')}<strong>I'm a gymnast</strong><span class="muted">Judge my skills and track my progress by event.</span></button>
        <button data-role="coach">${icon('whistle')}<strong>I'm a coach</strong><span class="muted">Manage a roster, view athletes' portals, and judge their footage.</span></button>
      </div>
      <form id="setup" class="card" hidden>
        <h2 id="setup-title"></h2>
        <label class="field">Name <input name="name" required autocomplete="name" maxlength="60" /></label>
        <label class="field" id="lvl">Level / program <select name="level">${levelOptions('L4')}</select></label>
        <label class="field" id="pin" hidden>Coach portal PIN (optional — keeps athletes out of coach tools on a shared device)
          <input name="pin" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" placeholder="4–8 digits" /></label>
        <button class="btn primary big">Get started</button>
      </form>
    </div>`;
  let role = null;
  qsa('[data-role]').forEach((b) => b.addEventListener('click', () => {
    role = b.dataset.role;
    qs('#setup').hidden = false;
    qs('#setup-title').textContent = role === 'coach' ? 'Set up your coach portal' : 'Create your gymnast profile';
    qs('#lvl').hidden = role === 'coach';
    qs('#pin').hidden = role !== 'coach';
    qs('input[name=name]').focus();
  }));
  qs('#setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await db.setSetting('role', role);
    if (role === 'gymnast') {
      const athlete = { id: db.uid(), name: f.get('name').trim(), levelId: f.get('level'), createdAt: Date.now(), self: true };
      await db.saveAthlete(athlete);
      await db.setSetting('athleteId', athlete.id);
    } else {
      await db.setSetting('coachName', f.get('name').trim());
      if (f.get('pin')) await db.setSetting('coachPin', f.get('pin'));
      state.coachUnlocked = true;
    }
    navigate(role === 'coach' ? '#/coach' : '#/');
  });
}

// ---- Home (gymnast) ------------------------------------------------------------

async function viewHome() {
  const athlete = await db.getAthlete(state.athleteId);
  if (!athlete) {
    $app.innerHTML = `<div class="card"><h2>No gymnast profile yet</h2><p class="muted">Create one in Settings, or switch to coach mode.</p><a class="btn primary" href="#/settings">Open settings</a></div>`;
    return;
  }
  const sessions = await db.listSessions(athlete.id);
  $app.innerHTML = `
    <h1>Hi, ${esc(athlete.name.split(' ')[0])}</h1>
    <p class="muted">${esc(levelById(athlete.levelId).name)} · ${sessions.length} judged session${sessions.length === 1 ? '' : 's'}</p>
    <a class="btn primary big" href="#/judge">${icon('camera')} Judge a skill or routine</a>
    <h2 style="margin-top:1.5rem">Your events</h2>
    <div class="grid events" id="tiles"></div>
    <div class="grid two" style="margin-top:1rem">
      <div class="card"><h2>Recent sessions</h2><ul class="list" id="recent"></ul></div>
      <div class="card"><h2>Filming tips</h2>${FILMING_TIPS}</div>
    </div>`;
  renderEventTiles(qs('#tiles'), athlete, sessions, (ev) => `#/progress?event=${ev}`);
  renderSessionList(qs('#recent'), sessions.slice(0, 6));
}

const FILMING_TIPS = `
  <ul class="small" style="padding-left:1.1rem;margin:0;color:var(--text-2)">
    <li>Film from the side, perpendicular to the skill, about 5–8 m back.</li>
    <li>Keep the whole body — hands to toes — in frame the entire time, including the landing.</li>
    <li>Prop the phone steady at hip height; landscape works best.</li>
    <li>Good lighting and a plain background improve tracking.</li>
    <li>One skill or one routine per clip (up to 2½ minutes).</li>
  </ul>`;

function renderEventTiles(host, athlete, sessions, hrefFor) {
  const evs = eventsForLevel(athlete.levelId);
  host.innerHTML = '';
  for (const ev of evs) {
    const list = sessions.filter((s) => s.event === ev.id).sort((a, b) => a.date - b.date);
    const scores = list.map((s) => s.result.score);
    const last = scores[scores.length - 1];
    const prev = scores[scores.length - 2];
    const delta = Number.isFinite(prev) ? last - prev : null;
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = hrefFor(ev.id);
    a.innerHTML = `
      <div class="ev"><strong>${esc(ev.name)}</strong><span class="muted small">${ev.short}</span></div>
      <div class="num">${list.length ? fmt(last, 3).replace(/0$/, '') : '—'}</div>
      <div class="meta"><span>${list.length ? `${list.length} session${list.length > 1 ? 's' : ''}${delta !== null ? ` · <span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)}</span>` : ''}` : 'No sessions yet'}</span></div>`;
    if (scores.length > 1) a.querySelector('.meta').appendChild(sparkline(scores.slice(-12), { width: 90, height: 28 }));
    host.appendChild(a);
  }
}

function renderSessionList(host, sessions, { showAthlete = null } = {}) {
  if (!sessions.length) {
    host.innerHTML = '<li class="muted">No sessions yet — judge your first skill!</li>';
    return;
  }
  host.innerHTML = sessions.map((s) => {
    const ev = eventById(s.event);
    const top = s.result.feedback?.[0];
    return `<li><a class="item" href="#/session/${s.id}">
      <div class="avatar" aria-hidden="true">${ev.short}</div>
      <div class="grow"><strong>${esc(ev.name)}</strong>${showAthlete ? ` · ${esc(showAthlete[s.athleteId] || '')}` : ''}
        <div class="small muted">${fmtDate(s.date)}${s.skills?.length ? ` · ${esc(s.skills.join(', '))}` : ''}${s.uploadedBy === 'coach' ? ' · <span class="pill coach">coach upload</span>' : ''}${s.sample ? ' · <span class="pill">sample</span>' : ''}</div>
        ${top ? `<div class="small muted">Top fix: ${esc(top.label)} (−${top.cost.toFixed(2)})</div>` : ''}
      </div>
      <div class="amount">${fmt(s.result.score, 3).replace(/0$/, '')}</div></a></li>`;
  }).join('');
}

// ---- Judge flow ------------------------------------------------------------------

async function viewJudge(query) {
  const athletes = await db.listAthletes();
  let athleteId = query.athlete || state.athleteId || athletes[0]?.id;
  if (!athletes.length) {
    $app.innerHTML = `<div class="card"><h2>Add an athlete first</h2><p class="muted">${state.role === 'coach' ? 'Add an athlete to your roster, then judge their footage.' : 'Create your gymnast profile in Settings.'}</p><a class="btn primary" href="${state.role === 'coach' ? '#/coach' : '#/settings'}">Continue</a></div>`;
    return;
  }
  const byCoach = query.by === 'coach' || state.role === 'coach';
  const sel = { event: null, skills: new Set(), blob: null };

  $app.innerHTML = `
    <h1>Judge a skill</h1>
    <form class="card" id="judge-form">
      <label class="field" ${athletes.length === 1 && state.role !== 'coach' ? 'hidden' : ''}>Athlete
        <select name="athlete">${athletes.map((a) => `<option value="${a.id}" ${a.id === athleteId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field">Level / scoring code <select name="level"></select></label>
      <div class="field">Event <div class="chips" id="events" role="radiogroup" aria-label="Event" style="margin-top:.35rem"></div></div>
      <div class="field" id="skills-wrap" hidden>Skills in this clip <span class="muted">(optional — makes feedback more specific)</span><div class="chips" id="skills" style="margin-top:.35rem"></div></div>
      <label class="field">Start value <input name="sv" type="number" step="0.05" min="0" max="20" value="10.0" style="max-width:140px" /></label>
    </form>
    <div class="card" id="capture">
      <h2>Add your video</h2>
      <div class="grid two">
        <button class="btn big" id="rec">${icon('camera')} Record with camera</button>
        <button class="btn big" id="up">${icon('upload')} Upload a video</button>
      </div>
      <p class="small muted" style="margin-top:.75rem">Tip: film from the side with the whole body in frame, including the landing.</p>
      <div id="cam" hidden style="margin-top:1rem">
        <div class="camera"><video id="live" playsinline muted autoplay></video><div class="count" id="count"></div><span class="rec" id="rec-ind" hidden>● REC</span></div>
        <div class="row" style="margin-top:.75rem">
          <button class="btn primary" id="start">Start (5s countdown)</button>
          <button class="btn" id="stop" disabled>Stop</button>
          <button class="btn" id="flip">Flip camera</button>
        </div>
      </div>
    </div>
    <div class="card" id="analyzing" hidden>
      <h2>Analyzing…</h2>
      <p class="muted" id="stage">Loading the pose model</p>
      <div class="progress"><span id="bar" style="width:0%"></span></div>
    </div>`;

  const form = qs('#judge-form');
  const setLevelFor = async (id) => {
    const a = await db.getAthlete(id);
    form.level.innerHTML = levelOptions(a.levelId);
    renderEvents();
  };
  const renderEvents = () => {
    const evs = eventsForLevel(form.level.value);
    if (!evs.find((e) => e.id === sel.event)) { sel.event = null; sel.skills.clear(); }
    qs('#events').innerHTML = evs.map((e) => `<button type="button" role="radio" aria-checked="${sel.event === e.id}" class="chip ${sel.event === e.id ? 'on' : ''}" data-ev="${e.id}">${esc(e.name)}</button>`).join('');
    qsa('[data-ev]').forEach((b) => b.addEventListener('click', () => { sel.event = b.dataset.ev; sel.skills.clear(); renderEvents(); }));
    const wrap = qs('#skills-wrap');
    wrap.hidden = !sel.event;
    if (sel.event) {
      qs('#skills').innerHTML = SKILLS[sel.event].map((s) => `<button type="button" class="chip ${sel.skills.has(s) ? 'on' : ''}" aria-pressed="${sel.skills.has(s)}" data-skill="${esc(s)}">${esc(s)}</button>`).join('');
      qsa('[data-skill]').forEach((b) => b.addEventListener('click', () => {
        const s = b.dataset.skill;
        sel.skills.has(s) ? sel.skills.delete(s) : sel.skills.add(s);
        b.classList.toggle('on');
        b.setAttribute('aria-pressed', sel.skills.has(s));
      }));
    }
  };
  form.athlete.addEventListener('change', () => { athleteId = form.athlete.value; setLevelFor(athleteId); });
  form.level.addEventListener('change', renderEvents);
  await setLevelFor(athleteId);
  loadLandmarker().catch(() => {}); // warm up the model while the user sets up

  const needEvent = () => {
    if (sel.event) return true;
    toast('Pick the event first.');
    qs('#events').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };

  qs('#up').addEventListener('click', async () => {
    if (!needEvent()) return;
    const f = await pickFile('video/*');
    if (f) run(f);
  });

  // Camera recording
  let stream = null;
  let recorder = null;
  let facing = 'environment';
  const stopStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  cleanup = () => { try { recorder?.state === 'recording' && recorder.stop(); } catch {} stopStream(); };
  const openCam = async () => {
    stopStream();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      toast('Camera unavailable — check permissions, or upload a video instead.');
      return false;
    }
    qs('#live').srcObject = stream;
    qs('#cam').hidden = false;
    return true;
  };
  qs('#rec').addEventListener('click', async () => { if (needEvent()) await openCam(); });
  qs('#flip').addEventListener('click', async () => { facing = facing === 'environment' ? 'user' : 'environment'; await openCam(); });
  qs('#start').addEventListener('click', async () => {
    if (!stream || !needEvent()) return;
    qs('#start').disabled = true;
    for (let n = 5; n > 0; n--) {
      qs('#count').textContent = n;
      await new Promise((r) => setTimeout(r, 1000));
      if (!stream) return;
    }
    qs('#count').textContent = '';
    const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    const chunks = [];
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      qs('#rec-ind').hidden = true;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      stopStream();
      qs('#cam').hidden = true;
      run(blob);
    };
    recorder.start(250);
    qs('#rec-ind').hidden = false;
    qs('#stop').disabled = false;
  });
  qs('#stop').addEventListener('click', () => { if (recorder?.state === 'recording') recorder.stop(); qs('#stop').disabled = true; });

  async function run(blob) {
    qs('#capture').hidden = true;
    form.querySelectorAll('input,select,button').forEach((x) => (x.disabled = true));
    qs('#analyzing').hidden = false;
    const t0 = performance.now();
    try {
      const track = await trackVideo(blob, ({ stage, pct }) => {
        qs('#stage').textContent = stage === 'model' ? 'Loading the pose model (first run only)…' : 'Tracking body position frame by frame…';
        qs('#bar').style.width = `${Math.round((stage === 'model' ? 0.05 : 0.05 + pct * 0.9) * 100)}%`;
      });
      qs('#stage').textContent = 'Scoring…';
      const skills = [...sel.skills];
      const levelId = form.level.value;
      const result = analyze({ frames: track.frames, event: sel.event, levelId, startValue: +form.sv.value || 10, skills });
      if (result.untracked) {
        qs('#analyzing').innerHTML = `${banner('warn', `<strong>No athlete detected in this clip.</strong> ${esc(result.warning)}`)}${FILMING_TIPS}<button class="btn primary" id="retry" style="margin-top:.75rem">Try another video</button>`;
        qs('#retry').addEventListener('click', route);
        return;
      }
      const session = {
        id: db.uid(), athleteId, event: sel.event, skills, levelId, date: Date.now(),
        uploadedBy: byCoach ? 'coach' : 'athlete', result, notes: '', coachNotes: '',
        duration: track.duration, analysisMs: Math.round(performance.now() - t0),
        poseTrack: track.frames.map((f) => ({ t: f.t, lm: f.lm })),
      };
      await db.saveVideo(session.id, blob);
      await db.saveSession(session);
      qs('#bar').style.width = '100%';
      location.hash = `#/session/${session.id}`;
    } catch (e) {
      console.error(e);
      qs('#analyzing').innerHTML = `${banner('warn', `Analysis failed: ${esc(e.message || e)}. Check your connection (the pose model downloads on first use) and try again.`)}<button class="btn" id="retry">Try again</button>`;
      qs('#retry').addEventListener('click', route);
    }
  }
}

// ---- Session detail -------------------------------------------------------------

async function viewSession(id) {
  const session = await db.getSession(id);
  if (!session) { $app.innerHTML = `<div class="card"><h2>Session not found</h2><a class="btn" href="#/">Home</a></div>`; return; }
  const athlete = await db.getAthlete(session.athleteId);
  const ev = eventById(session.event);
  const video = await db.getVideo(id);
  const url = video ? URL.createObjectURL(video) : null;
  const isCoach = state.role === 'coach';

  $app.innerHTML = `
    <div class="row spread"><a href="${isCoach ? `#/athlete/${session.athleteId}` : '#/progress'}" class="small">← ${isCoach ? esc(athlete?.name || 'Athlete') : 'Progress'}</a>
      <span class="small muted">${fmtDate(session.date, { dateStyle: 'medium' })}${session.analysisMs ? ` · analyzed in ${(session.analysisMs / 1000).toFixed(1)}s` : ''}</span></div>
    <div class="card hero" style="margin-top:.5rem">
      <div><div class="score" id="score"></div><div class="score-sub">Estimated execution score</div></div>
      <div class="grow" style="flex:1;min-width:200px">
        <h2 style="margin:0">${esc(ev.name)}${session.skills?.length ? ` <span class="muted" style="font-weight:500">· ${esc(session.skills.join(', '))}</span>` : ''}</h2>
        <div class="small muted">${esc(athlete?.name || '')} · ${esc(levelById(session.levelId).name)} · start value ${fmt(session.result.startValue)} · <span id="total"></span></div>
        ${session.uploadedBy === 'coach' ? '<span class="pill coach">Uploaded by coach</span>' : ''} ${session.sample ? '<span class="pill">Sample data</span>' : ''}
      </div>
    </div>
    ${session.result.warning ? banner('warn', esc(session.result.warning)) : ''}
    <div class="grid two">
      <div>
        ${url ? `<div class="player"><video id="vid" src="${url}" controls playsinline preload="metadata"></video><canvas id="ov"></canvas></div>
          <div class="timeline" id="tl" aria-label="Deduction timeline"></div>
          <label class="row small muted" style="margin-top:.4rem"><input type="checkbox" id="skel" checked /> Show skeleton overlay</label>`
          : `<div class="card muted">${session.sample ? 'Sample sessions have no video.' : 'Video not stored on this device.'}</div>`}
      </div>
      <div class="card"><h2>Flagged deductions</h2>
        <p class="small muted">Tap a deduction to dismiss it if the app got it wrong — the score updates.</p>
        <ul class="list" id="deds"></ul></div>
    </div>
    <div class="card" id="ai"></div>
    <div class="card"><h2>Coaching feedback</h2><div id="fb"></div></div>
    <div class="grid two">
      <label class="card field">Gymnast notes<textarea id="notes" ${isCoach ? 'readonly' : ''} placeholder="How did it feel?">${esc(session.notes)}</textarea></label>
      <label class="card field">Coach notes<textarea id="cnotes" ${isCoach ? '' : 'readonly'} placeholder="${isCoach ? 'Corrections, focus points…' : 'Your coach can add notes here.'}">${esc(session.coachNotes)}</textarea></label>
    </div>
    <div class="row"><button class="btn danger" id="del">${icon('trash')} Delete session</button></div>
    <p class="small muted" style="margin-top:1rem">Scores are estimates from 2-D video pose tracking — not an official score. Always defer to a certified judge and the current code of points.</p>`;

  const draw = () => {
    const r = finalize({ ...session.result, deductions: session.result.deductions, event: session.event, skills: session.skills, levelId: session.levelId });
    session.result = { ...session.result, ...r };
    qs('#score').textContent = fmt(r.score, 3).replace(/0$/, '');
    qs('#total').textContent = `−${fmt(r.total)} in deductions`;
    const ds = [...session.result.deductions].sort((a, b) => a.t - b.t);
    qs('#deds').innerHTML = ds.length ? ds.map((d) => `
      <li class="ded ${d.active ? '' : 'off'}">
        <button class="time" data-t="${d.t}" aria-label="Jump to ${d.t} seconds">${d.t.toFixed(1)}s</button>
        <div class="grow"><strong>${esc(d.label)}</strong> ${verdictBadge(d.id)}<div class="small muted">${esc(d.detail || '')}</div>${verdictNote(d.id)}</div>
        <span class="amount">−${fmt(d.amount)}</span>
        <button class="btn sm" data-toggle="${d.id}" aria-pressed="${!d.active}">${d.active ? 'Dismiss' : 'Restore'}</button>
      </li>`).join('') : '<li>No deductions detected — clean work!</li>';
    qsa('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const d = session.result.deductions.find((x) => x.id === b.dataset.toggle);
      d.active = !d.active;
      await db.saveSession(session);
      draw();
    }));
    qsa('[data-t]').forEach((b) => b.addEventListener('click', () => seekTo(+b.dataset.t)));
    const fb = session.result.feedback;
    qs('#fb').innerHTML = (fb.length ? fb.map((f) => `
      <div class="cue"><strong>${esc(f.label)}</strong> <span class="small muted">· ${f.count}× · −${f.cost.toFixed(2)}</span>
        <p style="margin:.25rem 0 0">${esc(f.cue)}</p>
        <ul>${f.drills.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('') : '')
      + (session.result.strengths?.length ? banner('good', `<strong>What went well:</strong> ${session.result.strengths.map(esc).join(' ')}`) : '');
    drawTimeline();
    renderAI();
  };

  const verdictFor = (id) => session.aiReview?.verdicts?.find((v) => v.id === id);
  function verdictBadge(id) {
    const v = verdictFor(id);
    if (!v) return '';
    const [cls, text] = { confirmed: ['ai-ok', 'AI: confirmed'], likely_wrong: ['ai-bad', 'AI: looks wrong'], uncertain: ['', 'AI: unsure'] }[v.verdict] || ['', 'AI'];
    return `<span class="pill ${cls}">${text}</span>`;
  }
  function verdictNote(id) {
    const v = verdictFor(id);
    return v?.note ? `<div class="small muted">${esc(v.note)}</div>` : '';
  }

  function renderAI() {
    const host = qs('#ai');
    if (!url) { host.hidden = true; return; }
    const r = session.aiReview;
    const wrong = r ? session.result.deductions.filter((d) => d.active && verdictFor(d.id)?.verdict === 'likely_wrong') : [];
    host.innerHTML = `
      <div class="row spread"><h2 style="margin:0">${icon('sparkle')} AI coach review</h2>
        <button class="btn sm ${r ? '' : 'primary'}" id="ai-go">${r ? 'Run again' : 'Get AI coach review'}</button></div>
      ${r ? `
        <p style="margin-top:.75rem">${esc(r.summary)}</p>
        ${wrong.length ? `<div class="row" style="margin-bottom:.75rem"><button class="btn sm" id="ai-apply">Dismiss ${wrong.length} flag${wrong.length > 1 ? 's' : ''} the AI thinks are wrong</button></div>` : ''}
        ${r.cues.map((c) => `<div class="cue"><strong>${esc(c.title)}</strong><p style="margin:.25rem 0 0">${esc(c.cue)}</p>
          ${c.drills?.length ? `<ul>${c.drills.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}
        ${r.extra_faults?.length ? `<h3>Also noticed (not scored)</h3><ul class="list">${r.extra_faults.map((f) => `<li><button class="time" data-ai-t="${Number(f.t) || 0}">${(Number(f.t) || 0).toFixed(1)}s</button><div class="grow"><strong>${esc(f.label)}</strong><div class="small muted">${esc(f.note)}</div></div></li>`).join('')}</ul>` : ''}
        ${r.strengths?.length ? banner('good', `<strong>Strengths:</strong> ${r.strengths.map(esc).join(' ')}`) : ''}
        <p class="small muted">Reviewed by Claude from ${session.aiFrames || 'a few'} still frames${session.aiReviewedAt ? ` on ${fmtDate(session.aiReviewedAt, { month: 'short', day: 'numeric' })}` : ''}. AI feedback can be wrong; the score only changes if you dismiss a flag.</p>`
      : `<p class="small muted" style="margin:.6rem 0 0">Sends up to 8 still frames (never the full video) to Claude, which checks each flagged deduction and writes personalised coaching cues.</p>`}
      <div id="ai-status" class="small muted" style="margin-top:.5rem"></div>`;
    qs('#ai-go', host).addEventListener('click', runAI);
    qs('#ai-apply', host)?.addEventListener('click', async () => {
      wrong.forEach((d) => { d.active = false; });
      await db.saveSession(session);
      draw();
      toast('Dismissed the flags the AI disagreed with.');
    });
    host.querySelectorAll('[data-ai-t]').forEach((b) => b.addEventListener('click', () => seekTo(+b.dataset.aiT)));
  }

  async function runAI() {
    if (!(await ensureAIConsent())) return;
    const status = qs('#ai-status');
    const btn = qs('#ai-go');
    btn.disabled = true;
    try {
      status.textContent = 'Grabbing still frames…';
      const duration = session.duration || vid?.duration || 1;
      const frames = await captureFrames(video, pickFrameTimes(session.result.deductions, duration));
      status.textContent = 'Claude is reviewing the frames — this usually takes 10–40 seconds…';
      const review = await requestReview({
        event: eventById(session.event).name,
        level: `${levelById(session.levelId).name} (${levelById(session.levelId).group})`,
        skills: session.skills || [],
        startValue: session.result.startValue,
        score: session.result.score,
        deductions: session.result.deductions.filter((d) => d.active).map(({ id, t, label, detail, amount }) => ({ id, t, label, detail, amount })),
        frames,
      });
      session.aiReview = review;
      session.aiFrames = frames.length;
      session.aiReviewedAt = Date.now();
      await db.saveSession(session);
      draw();
    } catch (e) {
      btn.disabled = false;
      status.innerHTML = banner('warn', esc(e.message));
    }
  }

  const vid = qs('#vid');
  const seekTo = (t) => { if (vid) { vid.pause(); vid.currentTime = t; vid.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  function drawTimeline() {
    const tl = qs('#tl');
    if (!tl || !vid) return;
    const dur = Number.isFinite(vid.duration) ? vid.duration : session.duration || 1;
    tl.innerHTML = session.result.deductions.filter((d) => d.active).map((d) =>
      `<button class="mark ${d.severity === 1 ? 'sev1' : ''}" style="left:${Math.min(100, (d.t / dur) * 100)}%" title="${esc(d.label)} −${fmt(d.amount)} at ${d.t.toFixed(1)}s" aria-label="${esc(d.label)} at ${d.t.toFixed(1)} seconds" data-t="${d.t}"></button>`).join('') + '<span class="head" id="head"></span>';
    tl.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => seekTo(+b.dataset.t)));
  }

  // Skeleton overlay synced to playback.
  let raf = 0;
  if (vid) {
    const cv = qs('#ov');
    const ctx = cv.getContext('2d');
    const track = session.poseTrack || [];
    const paint = () => {
      const w = vid.clientWidth;
      const h = vid.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dur = vid.duration || session.duration || 1;
      const head = qs('#head');
      if (head) head.style.left = `${(vid.currentTime / dur) * 100}%`;
      if (!qs('#skel')?.checked || !track.length || !vid.videoWidth) return;
      // Letterboxing: the video keeps its aspect ratio inside the element.
      const s = Math.min(w / vid.videoWidth, h / vid.videoHeight);
      const vw = vid.videoWidth * s;
      const vh = vid.videoHeight * s;
      const ox = (w - vw) / 2;
      const oy = (h - vh) / 2;
      let best = track[0];
      for (const f of track) if (Math.abs(f.t - vid.currentTime) < Math.abs(best.t - vid.currentTime)) best = f;
      if (!best.lm || Math.abs(best.t - vid.currentTime) > 0.3) return;
      const P = (i) => [ox + best.lm[i][0] * vw, oy + best.lm[i][1] * vh, best.lm[i][2]];
      const flagged = session.result.deductions.some((d) => d.active && Math.abs(d.t - vid.currentTime) < 0.25);
      ctx.lineWidth = 3;
      ctx.strokeStyle = flagged ? '#ff5252' : '#7df9c1';
      ctx.lineCap = 'round';
      for (const [a, b] of CONNECTIONS) {
        const pa = P(a); const pb = P(b);
        if (pa[2] < 0.4 || pb[2] < 0.4) continue;
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      for (let i = 11; i < 33; i++) {
        const p = P(i);
        if (p[2] < 0.4) continue;
        ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill();
      }
    };
    const loop = () => { paint(); raf = requestAnimationFrame(loop); };
    vid.addEventListener('loadedmetadata', () => { drawTimeline(); paint(); });
    loop();
  }
  cleanup = () => { cancelAnimationFrame(raf); if (url) URL.revokeObjectURL(url); };

  draw();
  const saveNotes = (field, el) => el.addEventListener('change', async () => { session[field] = el.value; await db.saveSession(session); toast('Notes saved.'); });
  saveNotes('notes', qs('#notes'));
  saveNotes('coachNotes', qs('#cnotes'));
  qs('#del').addEventListener('click', async () => {
    if (!confirm('Delete this session and its video?')) return;
    await db.deleteSession(id);
    location.hash = isCoach ? `#/athlete/${session.athleteId}` : '#/progress';
  });
}

async function ensureAIConsent() {
  if (await db.getSetting('aiConsent')) return true;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog">
    <h2>Before you use AI coach review</h2>
    <p class="small">This sends up to <strong>8 still frames</strong> from this clip, plus the flagged deductions, to <strong>Anthropic's Claude</strong> to get feedback. The full video is never uploaded, and nothing is sent unless you tap the review button.</p>
    <p class="small">If the gymnast is under 18, a parent or guardian should agree before using this feature.</p>
    <label class="row small"><input type="checkbox" name="ok" required /> I understand and agree</label>
    <div class="row" style="margin-top:.9rem"><button class="btn primary" value="yes">Continue</button><button class="btn" value="no" formnovalidate>Cancel</button></div>
  </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const answer = await new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue)));
  dlg.remove();
  if (answer !== 'yes') return false;
  await db.setSetting('aiConsent', true);
  return true;
}

// ---- Progress --------------------------------------------------------------------

async function renderProgress(host, athlete, eventId, baseHref) {
  const sessions = await db.listSessions(athlete.id);
  const evs = eventsForLevel(athlete.levelId);
  const extra = [...new Set(sessions.map((s) => s.event))].filter((e) => !evs.find((x) => x.id === e)).map(eventById);
  const allEvs = [...evs, ...extra];
  const current = allEvs.find((e) => e.id === eventId) ? eventId : 'all';
  const sep = baseHref.includes('?') ? '&' : '?';
  host.innerHTML = `
    <div class="tabs" role="tablist">
      <a class="chip ${current === 'all' ? 'on' : ''}" role="tab" aria-selected="${current === 'all'}" href="${baseHref}">All events</a>
      ${allEvs.map((e) => `<a class="chip ${current === e.id ? 'on' : ''}" role="tab" aria-selected="${current === e.id}" href="${baseHref}${sep}event=${e.id}">${esc(e.name)}</a>`).join('')}
    </div>
    <div id="pbody"></div>`;
  const body = qs('#pbody', host);

  const dedTotals = (list) => {
    const m = {};
    for (const s of list) for (const d of s.result.deductions) if (d.active) {
      m[d.key] ||= { label: DEDUCTIONS[d.key]?.label || d.label, value: 0, count: 0 };
      m[d.key].value += d.amount;
      m[d.key].count++;
    }
    return Object.values(m).map((x) => ({ ...x, value: x.value / Math.max(1, list.length) })).sort((a, b) => b.value - a.value).slice(0, 8);
  };

  if (current === 'all') {
    body.innerHTML = `
      <div class="grid events" id="tiles"></div>
      <div class="grid two" style="margin-top:1rem">
        <div class="card"><h2>Where points are going</h2><p class="small muted">Average deduction per session, all events</p><div id="bars"></div></div>
        <div class="card"><h2>Recent sessions</h2><ul class="list" id="recent"></ul></div>
      </div>`;
    renderEventTiles(qs('#tiles', body), athlete, sessions, (ev) => `${baseHref}${sep}event=${ev}`);
    barList(qs('#bars', body), dedTotals(sessions), { format: (v) => `−${v.toFixed(2)}` });
    renderSessionList(qs('#recent', body), sessions.slice(0, 8));
    return;
  }

  const list = sessions.filter((s) => s.event === current).sort((a, b) => a.date - b.date);
  const scores = list.map((s) => s.result.score);
  const recent = scores.slice(-3);
  const earlier = scores.slice(-6, -3);
  const trend = recent.length && earlier.length ? mean(recent) - mean(earlier) : null;
  body.innerHTML = `
    <div class="grid events">
      <div class="tile"><div class="muted small">Latest</div><div class="num">${list.length ? fmt(scores[scores.length - 1], 3).replace(/0$/, '') : '—'}</div></div>
      <div class="tile"><div class="muted small">Best</div><div class="num">${list.length ? fmt(Math.max(...scores), 3).replace(/0$/, '') : '—'}</div></div>
      <div class="tile"><div class="muted small">Average</div><div class="num">${list.length ? fmt(mean(scores)) : '—'}</div></div>
      <div class="tile"><div class="muted small">Trend (last 3 vs prior 3)</div><div class="num ${trend === null ? '' : trend >= 0 ? 'delta up' : 'delta down'}">${trend === null ? '—' : `${trend >= 0 ? '+' : '−'}${Math.abs(trend).toFixed(2)}`}</div></div>
    </div>
    <div class="card" style="margin-top:1rem"><h2>${esc(eventById(current).name)} score over time</h2><div id="line"></div></div>
    <div class="grid two">
      <div class="card"><h2>Most common deductions</h2><p class="small muted">Average per session</p><div id="bars"></div></div>
      <div class="card"><h2>Sessions</h2><div class="scroll-x"><table class="table"><thead><tr><th>Date</th><th>Skills</th><th>By</th><th class="num">Ded.</th><th class="num">Score</th></tr></thead><tbody>
        ${[...list].reverse().map((s) => `<tr><td><a href="#/session/${s.id}">${fmtDate(s.date, { month: 'short', day: 'numeric' })}</a></td><td>${esc((s.skills || []).join(', ') || '—')}</td><td>${s.uploadedBy === 'coach' ? 'Coach' : 'Self'}</td><td class="num">−${fmt(s.result.total)}</td><td class="num"><strong>${fmt(s.result.score, 3).replace(/0$/, '')}</strong></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No sessions yet.</td></tr>'}
      </tbody></table></div></div>
    </div>`;
  const drawLine = () => lineChart(qs('#line', body), list.map((s) => ({ x: s.date, y: s.result.score, label: (s.skills || []).join(', ') })));
  drawLine();
  const ro = new ResizeObserver(() => drawLine());
  ro.observe(qs('#line', body));
  const prev = cleanup;
  cleanup = () => { ro.disconnect(); prev(); };
  barList(qs('#bars', body), dedTotals(list), { format: (v) => `−${v.toFixed(2)}` });
}

async function viewProgress(athleteId, eventId) {
  const athlete = athleteId ? await db.getAthlete(athleteId) : null;
  if (!athlete) {
    if (state.role === 'coach') { location.hash = '#/coach'; return; }
    $app.innerHTML = `<div class="card"><h2>No profile yet</h2><a class="btn primary" href="#/settings">Create one</a></div>`;
    return;
  }
  $app.innerHTML = `<h1>Progress</h1><p class="muted">${esc(athlete.name)} · ${esc(levelById(athlete.levelId).name)}</p><div id="prog"></div>`;
  await renderProgress(qs('#prog'), athlete, eventId, '#/progress');
}

// ---- Coach portal ------------------------------------------------------------------

async function coachGate() {
  const pin = await db.getSetting('coachPin');
  if (!pin || state.coachUnlocked) return true;
  $app.innerHTML = `
    <form class="card" id="gate" style="max-width:420px">
      <h1>Coach portal</h1>
      <p class="muted">Enter the coach PIN to continue.</p>
      <label class="field">PIN <input name="pin" type="password" inputmode="numeric" autocomplete="off" required /></label>
      <button class="btn primary">Unlock</button>
    </form>`;
  qs('#gate').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.pin.value === pin) { state.coachUnlocked = true; route(); } else toast('Incorrect PIN.');
  });
  return false;
}

async function viewCoach() {
  if (!(await coachGate())) return;
  const coachName = await db.getSetting('coachName');
  const athletes = await db.listAthletes();
  const all = await db.listSessions();
  const names = Object.fromEntries(athletes.map((a) => [a.id, a.name]));
  $app.innerHTML = `
    <div class="row spread"><div><h1>Coach portal</h1><p class="muted">${coachName ? `${esc(coachName)} · ` : ''}${athletes.length} athlete${athletes.length === 1 ? '' : 's'}</p></div>
      <div class="row"><button class="btn primary" id="add">+ Add athlete</button><button class="btn" id="imp">${icon('upload')} Import athlete file</button></div></div>
    ${state.role !== 'coach' ? banner('info', 'You are viewing the coach portal from a gymnast profile. Switch to coach mode in Settings to make it the home screen.') : ''}
    <div class="card"><h2>Roster</h2><ul class="list" id="roster"></ul></div>
    <div class="grid two">
      <div class="card"><h2>Latest across the team</h2><ul class="list" id="recent"></ul></div>
      <div class="card"><h2>How sharing works</h2>
        <ol class="small" style="padding-left:1.1rem;margin:0;color:var(--text-2)">
          <li>Your gymnast opens <strong>Settings → Share with my coach</strong> and sends you the file (AirDrop, text, email).</li>
          <li>Tap <strong>Import athlete file</strong> here — their sessions and progress appear in their portal.</li>
          <li>Record or upload their footage yourself with <strong>Judge footage</strong> in their portal.</li>
          <li>Add coach notes, dismiss wrong flags, then <strong>Send back</strong> so they see your feedback.</li>
        </ol></div>
    </div>
    <dialog id="dlg"><form method="dialog" id="addf">
      <h2>Add athlete</h2>
      <label class="field">Name <input name="name" required maxlength="60" /></label>
      <label class="field">Level / program <select name="level">${levelOptions('L4')}</select></label>
      <div class="row"><button class="btn primary" value="ok">Add</button><button class="btn" value="cancel" formnovalidate>Cancel</button></div>
    </form></dialog>`;
  const roster = qs('#roster');
  roster.innerHTML = athletes.length ? athletes.map((a) => {
    const ss = all.filter((s) => s.athleteId === a.id);
    const last = ss[0];
    return `<li><a class="item" href="#/athlete/${a.id}"><div class="avatar">${esc(initials(a.name))}</div>
      <div class="grow"><strong>${esc(a.name)}</strong>${a.sample ? ' <span class="pill">sample</span>' : ''}<div class="small muted">${esc(levelById(a.levelId).name)} · ${ss.length} session${ss.length === 1 ? '' : 's'}${last ? ` · last ${fmtDate(last.date, { month: 'short', day: 'numeric' })}` : ''}</div></div>
      <span class="btn sm">Open portal →</span></a></li>`;
  }).join('') : '<li class="muted">No athletes yet. Add one, import a gymnast\'s share file, or load sample data in Settings.</li>';
  renderSessionList(qs('#recent'), all.slice(0, 6), { showAthlete: names });

  const dlg = qs('#dlg');
  qs('#add').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const f = new FormData(qs('#addf'));
    const a = { id: db.uid(), name: String(f.get('name')).trim(), levelId: f.get('level'), createdAt: Date.now() };
    if (!a.name) return;
    await db.saveAthlete(a);
    location.hash = `#/athlete/${a.id}`;
  });
  qs('#imp').addEventListener('click', async () => { if (await importFromFile()) route(); });
}

async function viewAthletePortal(id, eventId) {
  if (!(await coachGate())) return;
  const athlete = await db.getAthlete(id);
  if (!athlete) { location.hash = '#/coach'; return; }
  $app.innerHTML = `
    <a href="#/coach" class="small">← Roster</a>
    <div class="card hero" style="margin-top:.5rem">
      <div class="avatar" style="width:56px;height:56px;font-size:1.2rem">${esc(initials(athlete.name))}</div>
      <div style="flex:1;min-width:180px"><h1 style="margin:0">${esc(athlete.name)}</h1>
        <label class="small muted">Level <select id="lvl" style="padding:.2rem .4rem;font-size:.85rem">${levelOptions(athlete.levelId)}</select></label></div>
      <div class="row">
        <a class="btn primary" href="#/judge?athlete=${athlete.id}&by=coach">${icon('camera')} Judge footage</a>
        <button class="btn" id="send">${icon('share')} Send back</button>
        <button class="btn danger" id="rm" aria-label="Remove athlete">${icon('trash')}</button>
      </div>
    </div>
    <div id="prog"></div>`;
  qs('#lvl').addEventListener('change', async (e) => { await db.saveAthlete({ ...athlete, levelId: e.target.value }); route(); });
  qs('#send').addEventListener('click', async () => {
    const data = await db.exportAthlete(athlete.id, { includeVideos: false });
    await shareJSON(data, `pocket-judge-${athlete.name.replace(/\W+/g, '-').toLowerCase()}.json`);
  });
  qs('#rm').addEventListener('click', async () => {
    if (!confirm(`Remove ${athlete.name} and all their sessions from this device?`)) return;
    await db.deleteAthlete(athlete.id);
    if (state.athleteId === athlete.id) await db.setSetting('athleteId', null);
    location.hash = '#/coach';
  });
  await renderProgress(qs('#prog'), athlete, eventId, `#/athlete/${athlete.id}`);
}

// ---- Settings ------------------------------------------------------------------------

async function viewSettings() {
  const athlete = state.athleteId ? await db.getAthlete(state.athleteId) : null;
  const theme = await db.getSetting('theme', 'auto');
  const hasPin = !!(await db.getSetting('coachPin'));
  const aiConsent = !!(await db.getSetting('aiConsent'));
  $app.innerHTML = `
    <h1>Settings</h1>
    <div class="grid two">
      <form class="card" id="prof">
        <h2>${state.role === 'coach' ? 'My gymnast profile (optional)' : 'My profile'}</h2>
        <label class="field">Name <input name="name" value="${esc(athlete?.name || '')}" maxlength="60" ${state.role === 'coach' ? '' : 'required'} /></label>
        <label class="field">Level / program <select name="level">${levelOptions(athlete?.levelId || 'L4')}</select></label>
        <button class="btn primary">Save profile</button>
      </form>
      <div class="card">
        <h2>Share with my coach</h2>
        <p class="small muted">Creates a file with your sessions and progress that your coach imports in their portal. Nothing is uploaded to a server.</p>
        <label class="row small"><input type="checkbox" id="vids" /> Include videos (much larger file)</label>
        <div class="row" style="margin-top:.6rem"><button class="btn primary" id="share" ${athlete ? '' : 'disabled'}>${icon('share')} Share with my coach</button>
          <button class="btn" id="imp">${icon('upload')} Import coach feedback</button></div>
      </div>
      <div class="card">
        <h2>Mode</h2>
        <p class="small muted">Currently: <strong>${state.role === 'coach' ? 'Coach' : 'Gymnast'}</strong></p>
        <div class="row"><button class="btn" id="switch">Switch to ${state.role === 'coach' ? 'gymnast' : 'coach'} mode</button></div>
        <label class="field" style="margin-top:.8rem">Coach PIN ${hasPin ? '(set)' : '(not set)'}<input id="pin" inputmode="numeric" maxlength="8" placeholder="${hasPin ? 'Enter new PIN, or leave blank to remove' : '4–8 digits'}" /></label>
        <button class="btn sm" id="savepin">Save PIN</button>
      </div>
      <div class="card">
        <h2>Appearance & data</h2>
        <label class="field">Theme <select id="theme"><option value="auto">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <div class="row"><button class="btn" id="sample">Load sample athlete</button><button class="btn danger" id="reset">Erase all data</button></div>
      </div>
      <div class="card">
        <h2>AI coach review</h2>
        <p class="small muted">Optional. When you tap “Get AI coach review” on a session, up to 8 still frames (never the full video) are sent to Anthropic's Claude for feedback.</p>
        <p class="small">Consent: <strong>${aiConsent ? 'given' : 'not given yet'}</strong></p>
        ${aiConsent ? '<button class="btn sm" id="ai-revoke">Withdraw consent</button>' : ''}
      </div>
    </div>
    <div class="card"><h2>About the scores</h2>
      <p class="small">Pocket Judge tracks 33 body landmarks in every sampled frame (on your device, with MediaPipe) and measures elbow, knee, hip, shoulder and ankle angles, leg separation and split, flight and landing phases. Those measurements are compared against simplified execution tables for your level (USA Gymnastics Development Program / Xcel sizes, or FIG sizes for elite and upper men's levels) to estimate deductions from your start value.</p>
      <p class="small muted">It can't see everything a judge sees — artistry, rhythm, direction, and skill-specific requirements aren't evaluated, and camera angle matters. Treat it as a training tool, not an official score.</p>
      <h3>Filming tips</h3>${FILMING_TIPS}
    </div>`;
  qs('#theme').value = theme;
  qs('#ai-revoke')?.addEventListener('click', async () => { await db.setSetting('aiConsent', false); toast('AI review consent withdrawn.'); route(); });
  qs('#theme').addEventListener('change', async (e) => { await db.setSetting('theme', e.target.value); applyTheme(e.target.value); });
  qs('#prof').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name')).trim();
    if (!name) return;
    const a = athlete ? { ...athlete, name, levelId: f.get('level') } : { id: db.uid(), name, levelId: f.get('level'), createdAt: Date.now(), self: true };
    await db.saveAthlete(a);
    await db.setSetting('athleteId', a.id);
    toast('Profile saved.');
    navigate(state.role === 'coach' ? '#/settings' : '#/');
  });
  qs('#share').addEventListener('click', async () => {
    const data = await db.exportAthlete(athlete.id, { includeVideos: qs('#vids').checked });
    await shareJSON(data, `pocket-judge-${athlete.name.replace(/\W+/g, '-').toLowerCase()}.json`);
  });
  qs('#imp').addEventListener('click', async () => { if (await importFromFile()) route(); });
  qs('#switch').addEventListener('click', async () => {
    const next = state.role === 'coach' ? 'gymnast' : 'coach';
    await db.setSetting('role', next);
    navigate(next === 'coach' ? '#/coach' : athlete ? '#/' : '#/settings');
  });
  qs('#savepin').addEventListener('click', async () => {
    const v = qs('#pin').value.trim();
    if (v && !/^\d{4,8}$/.test(v)) { toast('PIN must be 4–8 digits.'); return; }
    await db.setSetting('coachPin', v || null);
    toast(v ? 'Coach PIN saved.' : 'Coach PIN removed.');
    route();
  });
  qs('#sample').addEventListener('click', async () => {
    const a = await loadSample();
    const asSelf = !state.athleteId && state.role !== 'coach';
    if (asSelf) await db.setSetting('athleteId', a.id);
    toast('Sample athlete added with 3 months of sessions.');
    navigate(asSelf ? '#/progress' : `#/athlete/${a.id}`);
  });
  qs('#reset').addEventListener('click', async () => {
    if (!confirm('Erase every athlete, session, and video on this device? This cannot be undone.')) return;
    await db.resetAll();
    state.coachUnlocked = false;
    navigate('#/');
  });
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

db.getSetting('theme', 'auto').then(applyTheme).catch(() => {});
route();
