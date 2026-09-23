// Small dependency-free SVG charts: score trend line, sparkline, and
// horizontal bars. Colors come from CSS custom properties (see styles.css).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function niceDomain(values, pad = 0.2) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; }
  lo = Math.max(0, Math.floor((lo - pad) * 2) / 2);
  hi = Math.min(10, Math.ceil((hi + pad) * 2) / 2);
  return [lo, hi];
}

// points: [{x: timestamp, y: score, label}]
export function lineChart(host, points, { height = 220 } = {}) {
  host.innerHTML = '';
  host.classList.add('chart');
  if (points.length === 0) {
    host.innerHTML = '<p class="muted empty">No judged sessions yet for this event.</p>';
    return;
  }
  const width = Math.max(280, host.clientWidth || 600);
  const m = { t: 12, r: 16, b: 28, l: 40 };
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const pts = [...points].sort((a, b) => a.x - b.x);
  const [y0, y1] = niceDomain(pts.map((p) => p.y));
  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x === x0 ? x0 + 1 : pts[pts.length - 1].x;
  const X = (x) => m.l + (pts.length === 1 ? W / 2 : ((x - x0) / (x1 - x0)) * W);
  const Y = (y) => m.t + H - ((y - y0) / (y1 - y0)) * H;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': `Score trend, ${pts.length} sessions` }, host);
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = y0 + ((y1 - y0) * i) / ticks;
    el('line', { x1: m.l, x2: m.l + W, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
    el('text', { x: m.l - 8, y: Y(v) + 4, class: 'axis', 'text-anchor': 'end' }, svg).textContent = v.toFixed(1);
  }
  const xt = pts.length === 1 ? [pts[0]] : [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
  xt.forEach((p, i) => {
    el('text', { x: X(p.x), y: height - 8, class: 'axis', 'text-anchor': pts.length === 1 ? 'middle' : ['start', 'middle', 'end'][i] }, svg).textContent = fmtDate(p.x);
  });

  if (pts.length > 1) {
    el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(''), class: 'line' }, svg);
  }
  pts.forEach((p) => el('circle', { cx: X(p.x), cy: Y(p.y), r: 4, class: 'dot' }, svg));
  const last = pts[pts.length - 1];
  el('text', { x: Math.min(X(last.x), m.l + W - 4), y: Y(last.y) - 10, class: 'label', 'text-anchor': 'end' }, svg).textContent = last.y.toFixed(2);

  // Hover layer: crosshair + tooltip snapping to the nearest session.
  const cross = el('line', { y1: m.t, y2: m.t + H, class: 'crosshair', visibility: 'hidden' }, svg);
  const focus = el('circle', { r: 6, class: 'focus', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  host.appendChild(tip);
  const hit = el('rect', { x: m.l - 10, y: 0, width: W + 20, height, fill: 'transparent' }, svg);
  const move = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * width;
    const p = pts.reduce((best, q) => (Math.abs(X(q.x) - px) < Math.abs(X(best.x) - px) ? q : best));
    cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x));
    focus.setAttribute('cx', X(p.x)); focus.setAttribute('cy', Y(p.y));
    cross.setAttribute('visibility', 'visible'); focus.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<strong>${p.y.toFixed(2)}</strong><span>${fmtDate(p.x)}</span>${p.label ? `<span>${p.label}</span>` : ''}`;
    const left = (X(p.x) / width) * r.width;
    tip.style.left = `${Math.min(r.width - 150, Math.max(0, left - 70))}px`;
    tip.style.top = `${(Y(p.y) / height) * r.height - 70}px`;
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

export function sparkline(values, { width = 120, height = 32 } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'spark', 'aria-hidden': 'true' });
  if (values.length < 2) return svg;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const X = (i) => 3 + (i / (values.length - 1)) * (width - 6);
  const Y = (v) => height - 4 - ((v - lo) / span) * (height - 8);
  el('path', { d: values.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(''), class: 'line' }, svg);
  el('circle', { cx: X(values.length - 1), cy: Y(values[values.length - 1]), r: 3, class: 'dot' }, svg);
  return svg;
}

// rows: [{label, value, note}]
export function barList(host, rows, { format = (v) => v } = {}) {
  host.innerHTML = '';
  if (!rows.length) {
    host.innerHTML = '<p class="muted empty">No deductions flagged yet.</p>';
    return;
  }
  const max = Math.max(...rows.map((r) => r.value));
  const list = document.createElement('div');
  list.className = 'bars';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.title = r.note || '';
    row.innerHTML = `<span class="bar-label">${r.label}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span><span class="bar-value">${format(r.value)}</span>`;
    list.appendChild(row);
  }
  host.appendChild(list);
}
