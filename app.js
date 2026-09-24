(function () {
'use strict';
const SK = window.SK;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (isFinite(x) ? (x * 100).toFixed(d) + '%' : '–');
const f2 = (x, d = 2) => (isFinite(x) && x !== null ? Number(x).toFixed(d) : '–');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; };
const shortDate = d => { if (!d) return ''; const [, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const clone = o => JSON.parse(JSON.stringify(o));
const fmtInt = n => (isFinite(n) ? Number(n).toLocaleString('en-US') : '–');

const TECH = ['Behind target', 'In front', 'Above', 'Below', 'Poor hold point', 'Poor visual pickup', 'Slow reaction', 'Rushed shot', 'Bad mount', 'Lost focus', 'Timing problem', 'Movement stopped', 'Incorrect lead', 'Mental error', 'Unknown'];
const MENTAL = ['Lost concentration', 'Overthinking', 'Thinking about score', 'Nervous', 'Rushed', 'Hesitated', 'Lack of confidence', 'Distracted', 'Frustrated after previous miss', 'Changed normal routine', 'Pressure', 'Unknown'];
const TYPES = ['Training', 'Competition', 'Qualification', 'Final', 'Test'];
const DEFAULT_SETTINGS = { customTech: [], customMental: [], threshold: 23 };

const S = {
  sessions: [], coach: [], settings: { ...DEFAULT_SETTINGS }, loaded: false,
  tab: 'scores', filter: { win: 'all', type: 'all', range: '', event: '', from: '', to: '' },
  sheet: null, selStation: null, focusStn: '', openTarget: null, ver: 0
};
let DEMO = null;
function demoData() {
  if (!DEMO) {
    const d = new Date(Date.now() - 150 * 864e5).toISOString().slice(0, 10);
    DEMO = window.SKDemo.make(SK, { sessions: 24, seed: 7, start: d });
  }
  return DEMO;
}
const isDemo = () => S.loaded && S.sessions.length === 0;
const data = () => (isDemo() ? demoData() : S.sessions);
let _cache = { v: -1 };
function allR() {
  const key = S.ver + ':' + isDemo();
  if (_cache.v !== key) _cache = { v: key, R: SK.flatten(data()) };
  return _cache.R;
}
const fR = () => SK.applyFilter(allR(), S.filter, today());
const sessionById = id => data().find(s => s.id === id);

// ---------------- storage ----------------
const Store = {
  mode: 'loading', db: null, q: new Map(),
  async init() {
    let db = null;
    try { if (window.claude && window.claude.use) db = await window.claude.use('db'); } catch (e) { db = null; }
    if (db) {
      this.mode = 'db'; this.db = db;
      let first = true;
      db.collection('sessions').onSnapshot(snap => {
        S.sessions = snap.docs.map(d => d.data()).filter(Boolean);
        S.loaded = true; S.ver++;
        if (first) { first = false; }
        render();
      }, err => { S.loaded = true; toast('Sync stopped (' + err.code + '). Reload to reconnect.'); render(); });
      db.collection('coach').onSnapshot(snap => { S.coach = snap.docs.map(d => d.data()); S.ver++; if (!S.sheet) render(); }, () => {});
      db.doc('settings/main').onSnapshot(snap => { if (snap.exists) S.settings = { ...DEFAULT_SETTINGS, ...snap.data() }; }, () => {});
    } else {
      this.mode = 'local';
      try {
        const raw = localStorage.getItem('skeetlog.v1');
        if (raw) { const o = JSON.parse(raw); S.sessions = o.sessions || []; S.coach = o.coach || []; S.settings = { ...DEFAULT_SETTINGS, ...(o.settings || {}) }; }
      } catch (e) { /* storage blocked: work in memory */ }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
      S.loaded = true; S.ver++; render();
    }
  },
  persistLocal() {
    try { localStorage.setItem('skeetlog.v1', JSON.stringify({ sessions: S.sessions, coach: S.coach, settings: S.settings })); } catch (e) { /* in-memory only */ }
  },
  enqueue(path, fn) {
    const prev = this.q.get(path) || Promise.resolve();
    const next = prev.then(fn).catch(e => {
      if (e && e.code === 'quota_exceeded') toast('Storage is full. Export and delete old sessions.');
      else toast('Could not save (' + ((e && e.code) || 'error') + '). Try again.');
    });
    this.q.set(path, next);
    return next;
  },
  saveSession(s) {
    s.updatedAt = Date.now();
    const i = S.sessions.findIndex(x => x.id === s.id);
    if (i >= 0) S.sessions[i] = s; else S.sessions.push(s);
    S.ver++;
    if (this.mode === 'db') { const body = clone(s); return this.enqueue('sessions/' + s.id, () => this.db.doc('sessions/' + s.id).set(body)); }
    this.persistLocal(); return Promise.resolve();
  },
  deleteSession(id) {
    S.sessions = S.sessions.filter(x => x.id !== id); S.ver++;
    if (this.mode === 'db') return this.enqueue('sessions/' + id, () => this.db.doc('sessions/' + id).delete());
    this.persistLocal(); return Promise.resolve();
  },
  saveCoach(n) {
    const i = S.coach.findIndex(x => x.id === n.id);
    if (i >= 0) S.coach[i] = n; else S.coach.push(n);
    if (this.mode === 'db') return this.enqueue('coach/' + n.id, () => this.db.doc('coach/' + n.id).set(clone(n)));
    this.persistLocal(); return Promise.resolve();
  },
  deleteCoach(id) {
    S.coach = S.coach.filter(x => x.id !== id);
    if (this.mode === 'db') return this.enqueue('coach/' + id, () => this.db.doc('coach/' + id).delete());
    this.persistLocal(); return Promise.resolve();
  },
  saveSettings() {
    if (this.mode === 'db') return this.enqueue('settings/main', () => this.db.doc('settings/main').set(clone(S.settings)));
    this.persistLocal(); return Promise.resolve();
  }
};

// ---------------- ui helpers ----------------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
const typePill = t => `<span class="pill ${SK.isComp(t) ? 'comp' : 'train'}">${esc(t)}</span>`;
const miniRound = (hits, cls = '') => {
  let out = `<span class="mini ${cls}" aria-hidden="true">`;
  SK.SEQ.forEach((t, i) => { if (i > 0 && SK.SEQ[i - 1].visit !== t.visit) out += '<b></b>'; out += `<i class="${hits[i] ? '' : 'm'}"></i>`; });
  return out + '</span>';
};
const hitsArr = r => r.hits.split('').map(c => (c === '1' ? 1 : 0));
function stat(k, v, n, unit) { return `<div class="stat"><span class="k">${k}</span><span class="v">${v}${unit ? `<small>${unit}</small>` : ''}</span><span class="n">${n || '&nbsp;'}</span></div>`; }
function whisk(t, dom, ref) {
  const W = 110, H = 20, x = v => 4 + (Math.max(dom[0], Math.min(dom[1], v)) - dom[0]) / (dom[1] - dom[0]) * (W - 8);
  if (!t.n) return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="dotplot" aria-hidden="true">
    <line x1="4" x2="${W - 4}" y1="10" y2="10" class="grid-l"/>
    ${ref != null ? `<line x1="${x(ref)}" x2="${x(ref)}" y1="2" y2="18" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="2 2"/>` : ''}
    <line x1="${x(t.lo)}" x2="${x(t.hi)}" y1="10" y2="10" class="ci"/>
    <circle cx="${x(t.rate)}" cy="10" r="4.5" class="pt" stroke="var(--surface)" stroke-width="1.5"/></svg>`;
}
function spark(vals, opts = {}) {
  const W = opts.w || 160, H = opts.h || 36, pts = vals.map((v, i) => [i, v]).filter(p => p[1] != null && isFinite(p[1]));
  if (pts.length < 2) return `<span class="muted" style="font-size:12px">${pts.length ? 'One data point so far' : 'No data yet'}</span>`;
  const lo = opts.min != null ? opts.min : Math.min(...pts.map(p => p[1])), hi = opts.max != null ? opts.max : Math.max(...pts.map(p => p[1]));
  const n = vals.length - 1 || 1;
  const x = i => 3 + i / n * (W - 6), y = v => H - 4 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 8);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  const area = d + ` L${x(last[0]).toFixed(1)} ${H} L${x(pts[0][0]).toFixed(1)} ${H} Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" aria-hidden="true">
    <path d="${area}" fill="var(--accent)" opacity=".10"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last[0])}" cy="${y(last[1])}" r="3.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/></svg>`;
}
function divColor(diff, span = 0.06) {
  if (!isFinite(diff)) return 'var(--div-mid)';
  const t = Math.max(-1, Math.min(1, diff / span));
  const pole = t < 0 ? 'var(--div-neg)' : 'var(--div-pos)';
  return `color-mix(in oklab, ${pole} ${Math.round(Math.abs(t) * 100)}%, var(--div-mid))`;
}

// ---------------- charts ----------------
function trendChart(series) {
  const W = 640, H = 230, P = { l: 30, r: 10, t: 12, b: 28 };
  const n = series.length;
  const ys = series.map(p => p.score);
  const lo = Math.max(0, Math.min(20, Math.min(...ys)) - 1), hi = 25;
  const x = i => P.l + (n === 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (n - 1));
  const y = v => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo);
  const step = hi - lo > 8 ? 2 : 1;
  let g = '';
  for (let v = hi; v >= lo; v -= step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid-l"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const roll = ys.map((_, i) => (i >= 4 ? SK.stats.mean(ys.slice(Math.max(0, i - 9), i + 1)) : null));
  const rd = roll.map((v, i) => (v == null ? '' : `${roll[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).join(' ');
  const r = n > 150 ? 2.5 : n > 60 ? 3.2 : 4;
  const dots = series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="${r}" fill="var(--${p.comp ? 'comp' : 'train'})" stroke="var(--surface)" stroke-width="1"/>`).join('');
  const colW = n > 1 ? (W - P.l - P.r) / (n - 1) : W - P.l - P.r;
  const hov = series.map((p, i) => `<rect x="${(x(i) - colW / 2).toFixed(1)}" y="${P.t}" width="${colW.toFixed(2)}" height="${H - P.t - P.b}" fill="transparent" data-tip="${esc(`${fmtDate(p.date)} · ${p.comp ? 'Competition' : 'Training'} · round ${p.idx + 1}\n${p.score}/25${roll[i] != null ? ` · 10-rd avg ${roll[i].toFixed(2)}` : ''}`)}"/>`).join('');
  const lab = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${shortDate(series[i].date)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score per round over time with 10-round rolling average">${g}
    <path d="${rd}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>${dots}${lab}${hov}</svg>
    <div class="legend"><span><i style="background:var(--train)"></i>Training round</span><span><i style="background:var(--comp)"></i>Competition round</span><span><i class="line" style="background:var(--ink)"></i>Rolling 10-round average</span></div>`;
}
// vertical dot plot: categories on x, mean score on y, n under each
function levelChart(levels, labels, opts = {}) {
  const W = 300, H = 150, P = { l: 30, r: 8, t: 14, b: 34 };
  const have = levels.filter(l => l.n > 0);
  if (!have.length) return '<div class="muted" style="font-size:13px">No ratings recorded yet.</div>';
  const vals = have.map(l => l.mean);
  let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.min(25, Math.ceil(Math.max(...vals) + 0.5));
  if (hi - lo < 2) lo = hi - 2;
  const k = levels.length;
  const x = i => P.l + (i + 0.5) * (W - P.l - P.r) / k;
  const y = v => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo);
  let g = '';
  for (let v = lo; v <= hi; v++) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid-l"/><text x="${P.l - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const pts = levels.map((l, i) => l.n ? `<circle cx="${x(i)}" cy="${y(l.mean)}" r="${l.n < (opts.minN || 5) ? 4 : 5.5}" fill="${l.n < (opts.minN || 5) ? 'var(--surface)' : 'var(--ink)'}" stroke="var(--ink)" stroke-width="1.8"/>
    <rect x="${x(i) - 18}" y="${P.t}" width="36" height="${H - P.t - P.b}" fill="transparent" data-tip="${esc(`${labels[i]}: ${l.mean.toFixed(2)} avg · n=${l.n}${l.n < (opts.minN || 5) ? ' (too few)' : ''}`)}"/>` : '').join('');
  const xl = levels.map((l, i) => `<text x="${x(i)}" y="${H - 18}" text-anchor="middle" style="fill:var(--ink2);font-weight:500">${labels[i]}</text><text x="${x(i)}" y="${H - 5}" text-anchor="middle">n=${l.n}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'Average score by level')}">${g}${pts}${xl}</svg>`;
}

// ---------------- field map ----------------
const FIELD = (() => {
  const c = { x: 200, y: 58 }, R = 150, pos = {};
  for (let k = 1; k <= 7; k++) { const th = Math.PI - (k - 1) * Math.PI / 6; pos[k] = { x: c.x + R * Math.cos(th), y: c.y + R * Math.sin(th) }; }
  pos[8] = { x: c.x, y: c.y };
  return pos;
})();
function fieldMap(st, overall, sel) {
  const stations = st.map(s => {
    const p = FIELD[s.stn];
    const fill = s.n ? divColor(s.rate - overall) : 'var(--div-mid)';
    const lblY = s.stn === 8 ? p.y - 30 : p.y + 38;
    return `<g class="stn${sel === s.stn ? ' sel' : ''}" tabindex="0" role="button" data-act="selStation" data-stn="${s.stn}" aria-label="Station ${s.stn}: ${s.n ? pct(s.rate) + ' over ' + s.n + ' targets' : 'no data'}"
      data-tip="${esc(`Station ${s.stn}\n${s.n ? `${pct(s.rate)} · ${s.h}/${s.n} hit\n${((s.rate - overall) * 100 >= 0 ? '+' : '') + ((s.rate - overall) * 100).toFixed(1)} pts vs your average` : 'No data'}`)}">
      <circle class="ring" cx="${p.x}" cy="${p.y}" r="27" fill="none" stroke="transparent"/>
      <circle class="dot" cx="${p.x}" cy="${p.y}" r="22" fill="${fill}"/>
      <text class="n" x="${p.x}" y="${p.y + 6}" text-anchor="middle">${s.stn}</text>
      <text class="r" x="${p.x}" y="${lblY}" text-anchor="middle">${s.n ? pct(s.rate) : '–'}</text></g>`;
  }).join('');
  return `<svg class="chart field-map" viewBox="0 0 400 262" role="group" aria-label="Skeet field heatmap. Select a station for detail.">
    <line x1="${FIELD[1].x}" y1="${FIELD[1].y}" x2="${FIELD[7].x}" y2="${FIELD[7].y}" stroke="var(--line)" stroke-dasharray="3 4"/>
    <path d="M ${FIELD[1].x} ${FIELD[1].y} A 150 150 0 0 0 ${FIELD[7].x} ${FIELD[7].y}" fill="none" stroke="var(--line)" stroke-width="1.5"/>
    <rect x="2" y="8" width="44" height="22" rx="4" fill="var(--surface2)" stroke="var(--line)"/><text x="24" y="23" text-anchor="middle" style="fill:var(--ink2);font-weight:500">HIGH</text>
    <rect x="354" y="86" width="44" height="22" rx="4" fill="var(--surface2)" stroke="var(--line)"/><text x="376" y="101" text-anchor="middle" style="fill:var(--ink2);font-weight:500">LOW</text>
    <g aria-hidden="true"><line x1="194" y1="126" x2="206" y2="138" stroke="var(--muted)"/><line x1="206" y1="126" x2="194" y2="138" stroke="var(--muted)"/><text x="214" y="136">crossing point</text></g>
    ${stations}</svg>
    <div class="legend" style="justify-content:center"><span><i style="background:var(--div-neg)"></i>Below your average</span><span><i style="background:var(--div-mid)"></i>At average</span><span><i style="background:var(--div-pos)"></i>Above average</span></div>`;
}

// ---------------- filter bar ----------------
function filterBar() {
  const R = allR(), f = S.filter;
  const ranges = [...new Set(R.map(r => r.range).filter(Boolean))].sort();
  const events = [...new Set(R.map(r => r.event).filter(Boolean))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  const wins = [['all', 'All rounds'], ['l5', 'Last 5 rounds'], ['l10', 'Last 10 rounds'], ['l25', 'Last 25 rounds'], ['l50', 'Last 50 rounds'], ['month', 'This month'], ['season', 'This season'], ['custom', 'Custom dates']];
  const n = fR().length;
  return `<div class="filters" role="group" aria-label="Filters">
    <select id="f-win" data-f="win" class="${f.win !== 'all' ? 'on' : ''}" aria-label="Time window">${wins.map(w => opt(w[0], w[1], f.win)).join('')}</select>
    <select id="f-type" data-f="type" class="${f.type !== 'all' ? 'on' : ''}" aria-label="Session type">${opt('all', 'Training + competition', f.type)}${opt('training', 'Training only', f.type)}${opt('competition', 'Competition only', f.type)}</select>
    <select id="f-range" data-f="range" class="${f.range ? 'on' : ''}" aria-label="Range">${opt('', 'All ranges', f.range)}${ranges.map(r => opt(r, r, f.range)).join('')}</select>
    <select id="f-event" data-f="event" class="${f.event ? 'on' : ''}" aria-label="Competition">${opt('', 'All competitions', f.event)}${events.map(r => opt(r, r, f.event)).join('')}</select>
    ${f.win === 'custom' ? `<input type="date" id="f-from" data-f="from" value="${esc(f.from)}" aria-label="From"><input type="date" id="f-to" data-f="to" value="${esc(f.to)}" aria-label="To">` : ''}
  </div><div class="fsum">${n} rounds · ${fmtInt(n * 25)} targets in view</div>`;
}
function banner() {
  if (isDemo()) return `<div class="banner"><span><b>Example data.</b> 24 made-up sessions so you can explore every screen. Your first saved session replaces them.</span></div>`;
  if (Store.mode === 'local' && backupDue()) return `<div class="banner"><span><b>Your data lives only on this phone.</b> Last backup: ${lastBackupText()}. Export one from More → Data.</span></div>`;
  return '';
}
const emptyView = msg => `<div class="empty" style="margin-top:16px">${msg}</div>`;

// ---------------- views ----------------
function vScores() {
  const R = fR();
  if (!R.length) return banner() + filterBar() + emptyView('<b>No rounds match these filters.</b> Widen the window or start a session.');
  const s = SK.summary(R);
  const ri = SK.roundIndex(R);
  const ctx = [['Session type', r => r.type], ['Wind', r => r.wx.wind], ['Light', r => r.wx.light], ['Weather', r => r.wx.cond], ['Range', r => r.range]];
  const sessions = SK.groupBySession(R).slice().reverse().slice(0, 12);
  return banner() + filterBar() + `
  <section class="blk card hero" aria-label="Average score">
    <div class="big num">${f2(s.mean)}<small>/25</small></div>
    <div class="meta">${s.rounds} rounds<br>${pct(s.hitRate)} hit rate<br>${s.n125 ? `${f2(s.avg125, 1)}/125 avg` : 'No 125s yet'}</div>
  </section>
  <section class="blk"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
    ${stat('Last 10 rounds', f2(s.last10), `n=${s.last10n}`, '/25')}
    ${stat('Last 50 rounds', f2(s.last50), `n=${s.last50n}`, '/25')}
    ${stat('Training', f2(s.train), `n=${s.trainN} rounds`, '/25')}
    ${stat('Competition', f2(s.comp), `n=${s.compN} rounds`, '/25')}
    ${stat('Average /125', s.n125 ? f2(s.avg125, 1) : '–', `${s.n125} five-round sessions`)}
    ${stat('Best /25', s.pb25, '', '/25')}
    ${stat('Best /125', s.pb125 ? s.pb125.total : '–', s.pb125 ? fmtDate(s.pb125.date) : 'needs 5 rounds in a session')}
    ${stat('Consistency', f2(s.sd), `SD · ${pct(s.within1, 0)} of rounds ±1 of avg`)}
    ${stat('Hit rate', pct(s.hitRate), `95% CI ${pct(SK.stats.wilson(s.hits, s.targets)[0])}–${pct(SK.stats.wilson(s.hits, s.targets)[1])}`)}
    ${stat('Targets shot', fmtInt(s.targets))}
    ${stat('Hits', fmtInt(s.hits))}
    ${stat('Misses', fmtInt(s.misses))}
  </div></section>
  <section class="blk"><h2 class="sec">Score progression <small>each dot is one round</small></h2><div class="card">${trendChart(s.series)}</div></section>
  <section class="blk"><h2 class="sec">By round of the session <small>early vs late</small></h2><div class="card">
    ${levelChart(ri.byIndex.map(b => ({ n: b.n, mean: b.mean })), ['Rd 1', 'Rd 2', 'Rd 3', 'Rd 4', 'Rd 5'], { aria: 'Average score by round number within a session' })}
    <p class="muted" style="font-size:13px;margin:8px 0 0">${ri.firstVsLast.sessions >= 3 ? `First round ${f2(ri.firstVsLast.first)} vs last round ${f2(ri.firstVsLast.last)} across ${ri.firstVsLast.sessions} sessions (paired p=${f2(ri.firstVsLast.p, 3)}${ri.firstVsLast.p < 0.05 ? '' : ', within normal variation'}).` : 'Needs 3+ sessions with 2+ rounds to compare first and last rounds.'} Hollow dots have fewer than 5 rounds.</p></div></section>
  <section class="blk"><h2 class="sec">Conditions & context</h2>
    <details class="fold"><summary>Average score by condition</summary><div class="body">
    ${ctx.map(([name, fn]) => { const rows = SK.byContext(R, fn); return rows.length ? `<div><div class="lbl" style="margin-bottom:6px">${name}</div><div class="tbl-wrap"><table><thead><tr><th>${name}</th><th class="num">Avg /25</th><th class="num">Rounds</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.key)}</td><td class="num mono">${f2(r.mean)}</td><td class="num mono">${r.n}${r.n < 10 ? ' <span class="muted">·few</span>' : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''; }).join('')}
    <p class="muted" style="font-size:12.5px;margin:0">Groups under 10 rounds are marked “few”. Treat them as anecdotes.</p></div></details></section>
  <section class="blk"><h2 class="sec">Sessions</h2><div class="list">
    ${sessions.map(g => { const sc = g.rounds.map(r => r.score); const tot = sc.reduce((a, b) => a + b, 0);
      return `<button class="row" data-act="openSession" data-sid="${esc(g.sid)}"><div class="grow"><div class="t">${fmtDate(g.date)} ${typePill(g.type)}</div>
      <div class="s">${esc(g.event || g.range || '')}</div><div class="s mono">${sc.join(' · ')}</div></div><div class="score">${tot}<small class="muted" style="font-size:14px">/${sc.length * 25}</small></div></button>`; }).join('')}
  </div></section>`;
}

function vTargets() {
  const R = fR();
  if (!R.length) return banner() + filterBar() + emptyView('<b>No rounds match these filters.</b>');
  const P = SK.presStats(R), st = SK.stationStats(R), G = SK.groups(R);
  const overall = SK.summary(R).hitRate;
  const okT = P.filter(t => t.n >= 30), okS = st.filter(s => s.n >= 60);
  const by = (a, f) => a.slice().sort((x, y) => f(x) - f(y));
  const wT = by(okT, t => t.rate)[0], sT = by(okT, t => -t.rate)[0], wS = by(okS, s => s.rate)[0], sS = by(okS, s => -s.rate)[0];
  if (S.selStation == null && wS) S.selStation = wS.stn;
  const sel = st.find(s => s.stn === S.selStation);
  const dom = [Math.min(0.6, Math.floor((Math.min(...P.filter(t => t.n).map(t => t.lo)) - 0.02) * 20) / 20), 1];
  const tile = (k, v, n) => stat(k, v, n);
  const tvc = SK.trainVsComp(R);
  const tvcRows = tvc.filter(t => t.tN && t.cN).sort((a, b) => b.diff - a.diff);
  const focus = S.focusStn ? Number(S.focusStn) : null;
  const ranked = P.filter(t => !focus || t.stn === focus).sort((a, b) => (a.n >= 30) === (b.n >= 30) ? a.rate - b.rate : (a.n >= 30 ? -1 : 1));
  // reasons tally
  const tally = { t: {}, m: {} };
  R.forEach(r => Object.values(r.reasons || {}).forEach(v => { (v.t || []).forEach(k => tally.t[k] = (tally.t[k] || 0) + 1); (v.m || []).forEach(k => tally.m[k] = (tally.m[k] || 0) + 1); }));
  const totalMiss = R.reduce((a, r) => a + 25 - r.score, 0);
  const tagged = R.reduce((a, r) => a + Object.keys(r.reasons || {}).length, 0);
  const cm = SK.consecutiveMisses(R);
  const coachFor = (kind, ref) => S.coach.filter(n => n.kind === kind && String(n.ref) === String(ref));
  let selPanel = '';
  if (sel) {
    const trend = SK.stationTrend(R, sel.stn, 10);
    const notes = [...coachFor('station', sel.stn), ...sel.targets.flatMap(t => coachFor('target', t.id))];
    selPanel = `<div class="card" style="margin-top:12px" id="stnpanel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div><div class="lbl">Station ${sel.stn}</div><div style="font:700 44px/1 var(--f-display)">${pct(sel.rate)}</div>
        <div class="mono muted" style="font-size:12px">95% CI ${pct(sel.lo)}–${pct(sel.hi)}</div></div>
        <div class="mono" style="font-size:13px;text-align:right">${fmtInt(sel.n)} attempts<br>${fmtInt(sel.h)} hits · ${fmtInt(sel.miss)} misses</div></div>
      <div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Hit rate over time <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">blocks of 10 rounds</span></div>
        ${spark(trend.map(b => b.rate), { w: 300, h: 44 })}</div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Target</th><th>Hit rate</th><th class="num">%</th><th class="num">n</th></tr></thead><tbody>
      ${sel.targets.map(t => `<tr><td>${esc(t.short)}<div class="muted" style="font-size:11.5px">${esc(t.dir)}</div></td><td>${whisk(t, dom, overall)}</td><td class="num mono">${pct(t.rate)}</td><td class="num mono">${t.n}</td></tr>`).join('')}</tbody></table></div>
      ${notes.length ? `<div class="stack" style="margin-top:12px"><div class="lbl">Coach notes</div>${notes.map(noteHtml).join('')}</div>` : ''}
    </div>`;
  }
  return banner() + filterBar() + `
  <section class="blk"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
    ${tile('Weakest station', wS ? `${wS.stn} · ${pct(wS.rate)}` : '–', wS ? `n=${wS.n}` : 'needs 60+ targets per station')}
    ${tile('Strongest station', sS ? `${sS.stn} · ${pct(sS.rate)}` : '–', sS ? `n=${sS.n}` : 'needs 60+ targets per station')}
    ${tile('Weakest target', wT ? pct(wT.rate) : '–', wT ? `${wT.short} · n=${wT.n}` : 'needs 30+ attempts per target')}
    ${tile('Strongest target', sT ? pct(sT.rate) : '–', sT ? `${sT.short} · n=${sT.n}` : 'needs 30+ attempts per target')}
  </div></section>
  <section class="blk"><h2 class="sec">Station heatmap <small>colour = hit rate vs your ${pct(overall)} average</small></h2>
    <div class="card">${fieldMap(st, overall, S.selStation)}</div>${selPanel}</section>
  <section class="blk"><h2 class="sec">Target types <small>dot = hit rate · bar = 95% CI · dashed = your average</small></h2>
    <div class="tbl-wrap"><table><thead><tr><th>Group</th><th>Hit rate</th><th class="num">%</th><th class="num">n</th></tr></thead><tbody>
    ${[G.singles, G.doubles, G.first, G.second, G.high, G.low].map((g, i) => `<tr${i % 2 === 0 && i ? ' style="border-top:2px solid var(--line)"' : ''}><td>${g.name}</td><td>${whisk(g, dom, overall)}</td><td class="num mono">${pct(g.rate)}</td><td class="num mono">${fmtInt(g.n)}</td></tr>`).join('')}
    </tbody></table></div></section>
  <section class="blk"><h2 class="sec">Every target, ranked <small>weakest first</small></h2>
    <div class="filters" style="padding-top:0"><select id="f-stn" data-f2="focusStn" aria-label="Station filter" class="${S.focusStn ? 'on' : ''}"><option value="">All stations</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}"${String(k) === S.focusStn ? ' selected' : ''}>Station ${k}</option>`).join('')}</select></div>
    <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Target</th><th>Hit rate</th><th class="num">%</th><th class="num">n</th><th>Read</th></tr></thead><tbody>
    ${ranked.map(t => { const flag = t.n < 30 ? '<span class="pill">Few attempts</span>' : t.hi < overall ? '<span class="pill bad">Below avg</span>' : t.lo > overall ? '<span class="pill good">Above avg</span>' : '<span class="muted flag">Normal range</span>';
      const open = S.openTarget === t.id;
      return `<tr tabindex="0" data-act="openTarget" data-id="${t.id}" aria-expanded="${open}"><td class="mono muted">${t.pos}</td><td>${esc(t.short)}<div class="muted" style="font-size:11.5px">${esc(t.dir)}</div></td><td>${whisk(t, dom, overall)}</td><td class="num mono">${pct(t.rate)}</td><td class="num mono">${t.n}</td><td>${flag}</td></tr>
      ${open ? `<tr><td colspan="6" style="white-space:normal;background:var(--surface2)"><div class="lbl" style="margin-bottom:4px">${esc(t.label)}: hit rate by 10-round block</div>${spark(targetTrend(R, t.pos - 1).map(b => b.rate), { w: 300, h: 40 })}${coachFor('target', t.id).map(noteHtml).join('')}</td></tr>` : ''}`; }).join('')}
    </tbody></table></div>
    <p class="muted" style="font-size:12.5px">“Below avg” only appears when the whole 95% interval sits under your overall rate and the target has 30+ attempts.</p></section>
  <section class="blk"><h2 class="sec">Training vs competition <small>largest drop first</small></h2>
    ${tvcRows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Target</th><th class="num">Training</th><th class="num">Comp.</th><th class="num">Gap</th><th class="num">q</th></tr></thead><tbody>
      ${tvcRows.map(t => `<tr><td>${esc(t.short)}</td><td class="num mono">${pct(t.tRate)} <span class="muted">(${t.tN})</span></td><td class="num mono">${pct(t.cRate)} <span class="muted">(${t.cN})</span></td><td class="num mono">${t.diff > 0 ? '−' : '+'}${Math.abs(t.diff * 100).toFixed(1)}</td><td class="num mono">${t.ok ? f2(t.q, 2) : '<span class="muted">n&lt;20</span>'}</td></tr>`).join('')}
      </tbody></table></div><p class="muted" style="font-size:12.5px">q is the p-value adjusted for testing 25 targets at once (Benjamini–Hochberg). Below 0.10 is worth attention; above that, the gap could be chance.</p>` : emptyView('Needs both training and competition rounds in the current filter.')}
  </section>
  <section class="blk"><h2 class="sec">Why you think you missed <small>${tagged} of ${totalMiss} misses tagged</small></h2>
    <div class="two">${[['Technical', tally.t], ['Mental', tally.m]].map(([n, o]) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]); const mx = e.length ? e[0][1] : 1;
      return `<div class="card"><div class="lbl" style="margin-bottom:8px">${n}</div>${e.length ? e.slice(0, 8).map(([k, v]) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(k)}</span><span class="mono">${v}</span></div><div class="bar-h"><i style="width:${v / mx * 100}%"></i></div></div>`).join('') : '<span class="muted" style="font-size:13px">None tagged yet.</span>'}</div>`; }).join('')}</div></section>
  <section class="blk"><h2 class="sec">Consecutive misses <small>runs within a round</small></h2><div class="card mono" style="font-size:13.5px">
    ${Object.keys(cm).length ? Object.entries(cm).map(([k, v]) => `${k === '1' ? 'Single misses' : k + ' in a row'}: <b>${v}</b>`).join(' · ') : 'No misses in view.'}</div></section>`;
}
function targetTrend(R, i, block = 10) {
  const out = [];
  for (let k = 0; k < R.length; k += block) { const c = R.slice(k, k + block); out.push({ rate: c.reduce((a, r) => a + r.hits[i], 0) / c.length }); }
  return out;
}

function vMental() {
  const R = fR();
  if (!R.length) return banner() + filterBar() + emptyView('<b>No rounds match these filters.</b>');
  const ck = SK.checkins(R), tr = SK.mentalTrend(R), pm = SK.postMiss(R), pr = SK.pressure(R);
  const lastVal = a => { const v = a.filter(x => x != null); return v.length ? v[v.length - 1] : null; };
  const avg = a => { const v = a.filter(x => x != null); return v.length ? SK.stats.mean(v) : null; };
  const trendTile = (k, arr) => `<div class="stat"><span class="k">${k}</span><span class="v">${avg(arr) != null ? f2(avg(arr), 1) : '–'}<small>/5 avg</small></span><div style="margin-top:4px">${spark(arr, { w: 150, h: 30, min: 1, max: 5 })}</div><span class="n">${arr.filter(x => x != null).length} sessions · latest ${lastVal(arr) != null ? f2(lastVal(arr), 1) : '–'}</span></div>`;
  const rel = m => {
    const labels = m.key === 'sleepH' ? SK.SLEEP_LABELS : ['1', '2', '3', '4', '5'];
    const summ = m.enough
      ? `≤2: <b>${f2(m.low.mean)}</b> (n=${m.low.n}) vs ≥4: <b>${f2(m.high.mean)}</b> (n=${m.high.n}) · q=${f2(m.q, 3)}${m.q < 0.1 ? '' : ' · could be chance'}`
      : `Not enough data yet (≤2: ${m.low.n}, ≥4: ${m.high.n} ${m.unit}; needs ${m.unit === 'rounds' ? 8 : 4}+ each)`;
    return `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><div class="lbl">${esc(m.label)}</div><span class="muted mono" style="font-size:11px">${m.unit}</span></div>
      ${levelChart(m.levels, labels, { minN: m.unit === 'rounds' ? 5 : 3, aria: m.label })}
      <div style="font-size:13px;margin-top:6px">${summ}</div>${m.after ? '<div class="muted" style="font-size:12px;margin-top:4px">Rated after the round, so the score may shape the rating.</div>' : ''}</div>`;
  };
  const np = pm.nextPresentation;
  const oe = (o, lbl) => `<div class="row"><div class="grow"><div class="t" style="font-weight:500">${lbl}</div><div class="s mono">n=${o.n} · expected ${pct(o.expRate)} for those targets${o.n >= 20 ? ` · p=${f2(o.p, 3)}` : ' · too few'}</div></div><div class="score" style="font-size:24px">${pct(o.rate)}</div></div>`;
  const pos24 = Object.entries(pr.pos24).sort((a, b) => b[1] - a[1]);
  const stop = Object.entries(pr.stoppers).sort((a, b) => b[1] - a[1]);
  return banner() + filterBar() + `
  <section class="blk"><h2 class="sec">Current trends <small>per session</small></h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
    ${trendTile('Confidence', tr.map(t => t.confidence))}${trendTile('Focus', tr.map(t => t.focus))}
    ${trendTile('Competition nerves', tr.filter(t => t.comp).map(t => t.nerves))}${trendTile('Mental fatigue', tr.map(t => t.mentalFatigue))}
  </div></section>
  <section class="blk"><h2 class="sec">After a miss <small>how the next targets go</small></h2>
    <div class="kpis3">${stat('Overall', pct(pm.overall.rate), `${fmtInt(pm.overall.n)} targets`)}${stat('Next target', pct(np.rate), `n=${np.n} · exp. ${pct(np.expRate)}`)}${stat('Next 3', pct(pm.next3.rate), `n=${pm.next3.n} · exp. ${pct(pm.next3.expRate)}`)}</div>
    <div class="list" style="margin-top:10px">
      ${oe(pm.next5, 'First 5 targets after a miss')}
      ${oe(pm.after2, 'Target after two misses in a row')}
      ${oe(pm.withinDouble, '2nd barrel after missing the 1st of a double')}
      <div class="row"><div class="grow"><div class="t" style="font-weight:500">Do misses cluster?</div><div class="s mono">Miss after a miss ${pct(pm.pMissAfterMiss)} vs miss after a hit ${pct(pm.pMissAfterHit)} · p=${f2(pm.clustering.p, 3)}</div></div>
      <div class="mono" style="text-align:right;font-size:13px">M→H ${pm.transitions.MH}<br>M→M ${pm.transitions.MM}</div></div>
    </div>
    <p class="muted" style="font-size:12.5px">“Expected” is what those exact targets normally give you, so a hard target following a miss doesn't count against you. The 2nd barrel of a double is shown on its own because it's the same event as the miss before it. This is a performance pattern, not a diagnosis.</p></section>
  <section class="blk"><h2 class="sec">Pressure & perfect rounds</h2>
    <div class="card"><div class="lbl" style="margin-bottom:8px">Clean through…</div>
      ${pr.cleanThrough.map(c => `<div style="display:grid;grid-template-columns:48px 1fr 88px;gap:10px;align-items:center;margin-bottom:6px"><span class="mono" style="font-size:13px">${c.k}/${c.k}</span><div class="bar-h" style="height:12px"><i style="width:${(c.pct * 100).toFixed(1)}%;background:var(--ink)"></i></div><span class="mono" style="font-size:13px;text-align:right">${pct(c.pct, 0)} <span class="muted">(${c.count})</span></span></div>`).join('')}
      <div class="mono muted" style="font-size:12px">of ${pr.rounds} rounds</div></div>
    <div class="grid" style="margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      ${stat('25/25 rounds', pr.twentyFives)}${stat('24/25 rounds', pr.twentyFours)}
      ${stat('20/20 → 25', pr.conv20.of ? pct(pr.conv20.made / pr.conv20.of, 0) : '–', `${pr.conv20.made} of ${pr.conv20.of}`)}
      ${stat('24/24 → 25', pr.conv24.of ? pct(pr.conv24.made / pr.conv24.of, 0) : '–', `${pr.conv24.made} of ${pr.conv24.of}`)}
    </div>
    <div class="list" style="margin-top:10px">
      ${oe(pr.finalFiveClean, 'Final five when clean through 20')}
      ${oe(pr.longRun, 'Targets 16–25 while the round is still clean')}
      <div class="row"><div class="grow"><div class="t" style="font-weight:500">Final five: training vs competition</div><div class="s mono">training ${pct(pr.finalFive.train.rate)} (n=${pr.finalFive.train.n}) · competition ${pct(pr.finalFive.comp.rate)} (n=${pr.finalFive.comp.n})${pr.finalFive.train.n && pr.finalFive.comp.n ? ` · p=${f2(pr.finalFive.test.p, 3)}` : ''}</div></div></div>
      <div class="row"><div class="grow"><div class="t" style="font-weight:500">Last round of a competition vs earlier rounds</div><div class="s mono">${pr.lastCompRound.sessions >= 3 ? `last ${f2(SK.stats.mean(pr.lastCompRound.last))} vs earlier ${f2(SK.stats.mean(pr.lastCompRound.earlier))} · ${pr.lastCompRound.sessions} events · p=${f2(pr.lastCompRound.test.p, 3)}` : 'Needs 3+ competitions with 2+ rounds'}</div></div></div>
      <div class="row"><div class="grow"><div class="t" style="font-weight:500">Targets 1–20 vs 21–25 (raw)</div><div class="s mono">${pct(pr.raw.early.rate)} vs ${pct(pr.raw.late.rate)} · 21–25 are the station 4 doubles and station 8, so a raw drop is expected from difficulty alone</div></div></div>
    </div>
    <div class="two" style="margin-top:10px">
      <div class="card"><div class="lbl" style="margin-bottom:6px">Where the one miss fell in your 24s</div>${pos24.length ? pos24.map(([p, c]) => `<div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(SK.SEQ[p].short)}</span><span class="mono">${c}×</span></div>`).join('') : '<span class="muted" style="font-size:13px">No 24s yet.</span>'}</div>
      <div class="card"><div class="lbl" style="margin-bottom:6px">What stopped rounds that were 20/20</div>${stop.length ? stop.map(([p, c]) => `<div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(SK.SEQ[p].short)}</span><span class="mono">${c}×</span></div>`).join('') : '<span class="muted" style="font-size:13px">Nothing yet.</span>'}</div>
    </div></section>
  <section class="blk"><h2 class="sec">How you felt vs how you shot <small>correlation, not cause</small></h2>
    <div class="two">${ck.round.map(rel).join('')}</div>
    <h2 class="sec" style="margin-top:18px">Session check-ins <small>one point per session (average of its rounds)</small></h2>
    <div class="two">${ck.sess.map(rel).join('')}</div>
    <p class="muted" style="font-size:12.5px">q is adjusted for testing ${ck.round.length + ck.sess.length} measures at once. Filled dots have enough rounds to read; hollow dots are too few.</p></section>`;
}

function vInsights() {
  const R = fR();
  if (!R.length) return banner() + filterBar() + emptyView('<b>No rounds match these filters.</b>');
  const pats = SK.patterns(R), ins = SK.insights(R);
  const kindPill = { technical: 'Technical', competition: 'Competition', concentration: 'Concentration' };
  return banner() + filterBar() + `
  <section class="blk"><h2 class="sec">Pattern flags <small>${pats.length ? pats.length + ' found' : 'none'}</small></h2>
    ${pats.length ? `<div class="stack">${pats.map(p => `<div class="pat"><span class="tag pill warn">${kindPill[p.kind]}</span><div><div style="font-weight:600">${esc(p.title)}</div><div style="font-size:14px;color:var(--ink2)">${esc(p.text)}</div></div></div>`).join('')}</div>`
      : emptyView('<b>No patterns pass the evidence bar yet.</b> A target needs 30+ attempts with its whole confidence interval below your average; a competition gap needs 20+ attempts on each side and q&lt;0.10.')}
  </section>
  <section class="blk"><h2 class="sec">Insights <small>${R.length} rounds in view</small></h2><div class="stack">
    ${ins.map(i => `<div class="ins${i.empty ? ' empty' : ''}"><span class="cat">${esc(i.cat)}</span><p>${esc(i.text)}</p>${i.empty ? `<ul><li>${esc(i.need)}</li></ul>` : `<ul>${i.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`}</div>`).join('')}
  </div></section>
  <p class="muted" style="font-size:12.5px;margin-top:14px;max-width:62ch">Each insight shows its sample and comparison. Nothing here says a mental state caused a miss: they are patterns that sit alongside your results. Every p-value is adjusted for the number of comparisons made.</p>`;
}

function noteHtml(n) {
  return `<div class="note"><div class="m">${esc(n.author || 'Coach')} · ${fmtDate(n.date)} · ${esc(refLabel(n))}</div><div>${esc(n.text)}</div></div>`;
}
function refLabel(n) {
  if (n.kind === 'session') { const s = sessionById(n.ref); return s ? `Session ${fmtDate(s.date)}` : 'Session'; }
  if (n.kind === 'round') { const [sid, i] = String(n.ref).split('#'); const s = sessionById(sid); return s ? `${fmtDate(s.date)} · round ${+i + 1}` : 'Round'; }
  if (n.kind === 'station') return `Station ${n.ref}`;
  if (n.kind === 'target') return SK.BY_ID[n.ref] ? SK.BY_ID[n.ref].short : n.ref;
  return '';
}

function vMore() {
  const R = allR();
  const m = SK.milestones(R, S.settings.threshold);
  const bw = b => (b ? `${b.total}` : '–');
  const bn = b => (b ? `${fmtDate(b.date)}${b.event ? ' · ' + b.event : ''}` : 'not yet');
  return banner() + `
  <section class="blk"><h2 class="sec">Personal bests & milestones <small>all data</small></h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      ${stat('First 25/25', m.first25 ? '✓' : '–', m.first25 ? fmtDate(m.first25.date) : 'not yet')}
      ${stat('25/25 rounds', m.count25)}
      ${stat('Best 50', bw(m.best50), bn(m.best50), '/50')}
      ${stat('Best 75', bw(m.best75), bn(m.best75), '/75')}
      ${stat('Best 100', bw(m.best100), bn(m.best100), '/100')}
      ${stat('Best 125', bw(m.best125), bn(m.best125), '/125')}
      ${stat('Longest hit streak', m.longestStreak, 'across rounds')}
      ${stat('Longest in one round', m.longestInRound, 'targets')}
      ${stat(`Rounds ≥${m.roundsAbove.threshold} in a row`, m.roundsAbove.best, 'consecutive rounds')}
      ${stat('Competition best', m.comp25 ?? '–', m.comp125 ? `best 125: ${m.comp125.total}` : 'no 125 yet', '/25')}
      ${stat('Training best', m.train25 ?? '–', m.train125 ? `best 125: ${m.train125.total}` : 'no 125 yet', '/25')}
      ${stat('Rounds logged', R.length, `${fmtInt(R.length * 25)} targets`)}
    </div></section>
  <section class="blk"><h2 class="sec">Coach</h2><button class="btn block" data-act="coach">Open coach view</button></section>
  <section class="blk"><h2 class="sec">Settings</h2><div class="card form">
    <div class="field"><label for="set-thr">Milestone: “rounds in a row at or above”</label><input id="set-thr" type="number" min="15" max="25" value="${S.settings.threshold}"></div>
    <div class="field"><label for="set-tech">Custom technical reasons <span class="muted" style="text-transform:none;letter-spacing:0">(comma separated)</span></label><input id="set-tech" value="${esc(S.settings.customTech.join(', '))}" placeholder="e.g. Head lifted, Late on gun"></div>
    <div class="field"><label for="set-mental">Custom mental tags</label><input id="set-mental" value="${esc(S.settings.customMental.join(', '))}" placeholder="e.g. Rushed routine"></div>
    <button class="btn primary" data-act="saveSettings">Save settings</button></div></section>
  <section class="blk"><h2 class="sec">Data <small>${Store.mode === 'db' ? 'synced to this artifact' : 'stored on this phone · last backup ' + lastBackupText()}</small></h2><div class="card stack">
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="exportJson">Export backup (.json)</button><button class="btn" data-act="exportCsv">Export every target (.csv)</button>
    <label class="btn" for="importFile" style="cursor:pointer">Import backup</label><input type="file" id="importFile" accept="application/json,.json" hidden></div>
    <p class="muted" style="font-size:13px;margin:0">The CSV has one row per target: date, session, round, position, station, house, single/double, 1st/2nd, result, reasons and note. Use it in a spreadsheet or bring it back here for deeper analysis.</p>
    <div id="importMsg"></div></div></section>
  <section class="blk"><h2 class="sec">The 25-target sequence <small>ISSF skeet qualification round</small></h2>
    <div class="tbl-wrap"><table><thead><tr><th class="num">#</th><th>Station</th><th>Presentation</th><th>House</th><th>Flight</th><th>ID</th></tr></thead><tbody>
    ${SK.SEQ.map(t => `<tr><td class="num mono">${t.pos}</td><td class="mono">${t.stn}</td><td>${t.kind === 'S' ? 'Single' : (t.dtype === 'reg' ? 'Double' : 'Reverse double') + (t.order === 1 ? ', 1st' : ', 2nd')}</td><td>${t.house === 'H' ? 'High' : 'Low'}</td><td>${esc(t.dir)}</td><td class="mono muted">${t.id}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="font-size:12.5px">Order per ISSF rule 9.9.3.3: stations 1→7, back to 4 for a regular and a reverse double, then 8. Flight labels are from the shooter's view. Finals use different sequences under the 2026 rulebook and will be added as their own templates.</p></section>`;
}

// ---------------- sheets ----------------
function openSheet(sheet) { S.sheet = sheet; renderSheet(); }
function closeSheet() { S.sheet = null; $('#sheetHost').innerHTML = ''; document.body.style.overflow = ''; render(); }
function sheetWrap(title, sub, body, foot) {
  return `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="in">
    <div class="bar"><button class="btn ghost" data-act="back" aria-label="Back">←</button><h1>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h1></div>${body}</div>
    ${foot ? `<div class="foot"><div class="in2">${foot}</div></div>` : ''}</div>`;
}
function renderSheet() {
  const sh = S.sheet;
  if (!sh) return;
  document.body.style.overflow = 'hidden';
  const fn = { sessionForm: shSessionForm, session: shSession, entry: shEntry, review: shReview, coach: shCoach }[sh.kind];
  $('#sheetHost').innerHTML = fn(sh);
  const el = $('#sheetHost .sheet');
  if (el && sh.scrollTop == null) el.scrollTop = 0;
}
const scale = (g, k, label, val) => `<div class="scale"><span class="lab">${label}</span><span class="opts" role="group" aria-label="${esc(label)}">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-act="scale" data-g="${g}" data-k="${k}" data-v="${v}" aria-pressed="${val === v}">${v}</button>`).join('')}</span></div>`;
const seg = (g, opts, cur) => `<div class="seg" role="group">${opts.map(o => `<button type="button" data-act="seg" data-g="${g}" data-v="${esc(o)}" aria-pressed="${o === cur}">${esc(o)}</button>`).join('')}</div>`;

function shSessionForm(sh) {
  const d = sh.draft;
  const R = allR();
  const ranges = [...new Set(R.map(r => r.range).filter(Boolean))];
  const comp = SK.isComp(d.type);
  const w = d.weather || {};
  const sel = (id, opts, cur, ph) => `<select id="${id}"><option value="">${ph}</option>${opts.map(o => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const body = `<div class="form" style="margin-top:14px">
    <div class="field"><span class="lbl">Session type</span>${seg('stype', TYPES, d.type)}
      <span class="muted" style="font-size:12.5px" id="finalHint" ${d.type === 'Final' ? '' : 'hidden'}>Finals use a different target sequence in the current ISSF rulebook. For now, rounds are recorded on the 25-target qualification layout.</span></div>
    <div class="two"><div class="field"><label for="sf-date">Date</label><input type="date" id="sf-date" value="${esc(d.date)}"></div>
      <div class="field"><label for="sf-range">Shooting range</label><input id="sf-range" list="rangeList" value="${esc(d.range || '')}" placeholder="Range name"><datalist id="rangeList">${ranges.map(r => `<option value="${esc(r)}">`).join('')}</datalist></div></div>
    <div class="field comp-only" ${comp ? '' : 'hidden'}><label for="sf-event">Competition / event</label><input id="sf-event" value="${esc(d.event || '')}" placeholder="e.g. Egyptian Championship 2026"></div>
    <details class="fold"${sh.edit ? '' : ''}><summary>Conditions & equipment</summary><div class="body">
      <div class="two"><div class="field"><label for="sf-cond">Weather</label>${sel('sf-cond', ['Sunny', 'Cloudy', 'Overcast', 'Hazy', 'Dust', 'Rain'], w.cond, 'Not recorded')}</div>
      <div class="field"><label for="sf-temp">Temperature (°C)</label><input id="sf-temp" type="number" inputmode="numeric" value="${esc(w.tempC ?? '')}"></div></div>
      <div class="field"><span class="lbl">Wind strength</span>${seg('wind', ['Calm', 'Light', 'Moderate', 'Strong'], w.wind)}</div>
      <div class="two"><div class="field"><label for="sf-winddir">Wind direction</label>${sel('sf-winddir', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Variable'], w.windDir, 'Not recorded')}</div>
      <div class="field"><label for="sf-light">Light</label>${sel('sf-light', ['Bright', 'Overcast', 'Flat / grey', 'Low sun', 'Floodlights'], w.light, 'Not recorded')}</div></div>
      <div class="two"><div class="field"><label for="sf-ammo">Cartridge</label><input id="sf-ammo" value="${esc(d.ammo || '')}" placeholder="e.g. 24g #9"></div>
      <div class="field"><label for="sf-choke">Choke / setup</label><input id="sf-choke" value="${esc(d.choke || '')}" placeholder="e.g. Skeet / Skeet"></div></div>
      <div class="field"><label for="sf-notes">Notes</label><textarea id="sf-notes">${esc(d.notes || '')}</textarea></div></div></details>
    <details class="fold"><summary>Pre-session check-in <span class="muted" style="font-weight:400;font-size:13px;margin-left:auto;margin-right:10px">optional</span></summary><div class="body">
      <div class="two"><div class="field"><label for="sf-sleeph">Hours slept</label><input id="sf-sleeph" type="number" step="0.5" min="0" max="14" inputmode="decimal" value="${esc(d.pre.sleepH ?? '')}"></div>
      <div class="field"><label for="sf-sore">Soreness / discomfort</label><input id="sf-sore" value="${esc(d.pre.soreness || '')}" placeholder="e.g. Tight right shoulder"></div></div>
      ${scale('spre', 'sleepQ', 'Sleep quality', d.pre.sleepQ)}${scale('spre', 'energy', 'Energy', d.pre.energy)}${scale('spre', 'physFatigue', 'Physical fatigue', d.pre.physFatigue)}
      ${scale('spre', 'confidence', 'Confidence', d.pre.confidence)}${scale('spre', 'focus', 'Focus', d.pre.focus)}${scale('spre', 'stress', 'Stress', d.pre.stress)}${scale('spre', 'motivation', 'Motivation', d.pre.motivation)}
      <div class="comp-only stack" ${comp ? '' : 'hidden'}>${scale('spre', 'nerves', 'Nervousness', d.pre.nerves)}${scale('spre', 'pressure', 'Perceived pressure', d.pre.pressure)}
      <div class="field"><label for="sf-expect">Expectations going in</label><input id="sf-expect" value="${esc(d.pre.expectations || '')}" placeholder="e.g. 118+, clean station 4"></div></div>
      <p class="muted" style="font-size:12.5px;margin:0">1 = very low, 5 = very high. Tap a selected number again to clear it.</p></div></details></div>`;
  return sheetWrap(sh.edit ? 'Edit session' : 'New session', sh.edit ? fmtDate(d.date) : 'Everything except the type is optional', body,
    `<button class="btn block primary" data-act="saveSession">${sh.edit ? 'Save changes' : 'Start round 1'}</button>`);
}

function shSession(sh) {
  const s = sessionById(sh.sid);
  if (!s) return sheetWrap('Session', 'Not found', emptyView('This session no longer exists.'), '');
  const rs = (s.rounds || []);
  const tot = rs.reduce((a, r) => a + hitsArr(r).reduce((x, y) => x + y, 0), 0);
  const notes = S.coach.filter(n => (n.kind === 'session' && n.ref === s.id) || (n.kind === 'round' && String(n.ref).startsWith(s.id + '#')));
  const w = s.weather || {};
  const pre = s.pre || {};
  const preTxt = [['Sleep', pre.sleepH ? pre.sleepH + 'h' : null], ['Sleep q.', pre.sleepQ], ['Energy', pre.energy], ['Confidence', pre.confidence], ['Focus', pre.focus], ['Stress', pre.stress], ['Nerves', pre.nerves], ['Pressure', pre.pressure]].filter(x => x[1] != null && x[1] !== '');
  const body = `
    <section class="blk card hero"><div class="big num">${tot}<small>/${rs.length * 25}</small></div>
      <div class="meta">${typePill(s.type)}<br>${esc(s.event || s.range || '')}<br>${rs.length} round${rs.length === 1 ? '' : 's'}${rs.length ? ' · avg ' + f2(tot / rs.length) : ''}</div></section>
    ${s.demo ? '<div class="banner"><span><b>Example session.</b> Read-only. Start your own session to begin logging.</span></div>' : ''}
    <section class="blk"><h2 class="sec">Rounds</h2>${rs.length ? `<div class="list">${rs.map((r, i) => { const h = hitsArr(r); const sc = h.reduce((a, b) => a + b, 0);
      const miss = SK.SEQ.filter((t, j) => !h[j]).map(t => t.short);
      return `<button class="row" data-act="openReview" data-sid="${esc(s.id)}" data-i="${i}"><div class="grow"><div class="t">Round ${i + 1}</div>${miniRound(h)}<div class="s">${miss.length ? esc(miss.join(' · ')) : 'Clean round'}</div></div><div class="score">${sc}</div></button>`; }).join('')}
      <div class="row" style="justify-content:space-between"><span class="lbl">Total</span><span class="score">${tot}<small class="muted" style="font-size:14px">/${rs.length * 25}</small></span></div></div>` : emptyView('No rounds yet.')}</section>
    <section class="blk"><h2 class="sec">Details</h2><div class="card mono" style="font-size:13px;line-height:1.7">
      ${fmtDate(s.date)} · ${esc(s.range || 'Range not recorded')}<br>
      ${[w.cond, w.tempC != null && w.tempC !== '' ? w.tempC + '°C' : null, w.wind ? 'Wind ' + w.wind + (w.windDir ? ' ' + w.windDir : '') : null, w.light].filter(Boolean).map(esc).join(' · ') || 'Conditions not recorded'}<br>
      ${[s.ammo, s.choke].filter(Boolean).map(esc).join(' · ') || ''}
      ${preTxt.length ? '<br>' + preTxt.map(([k, v]) => `${k} ${esc(v)}`).join(' · ') : ''}
      ${pre.expectations ? `<br>Expectations: ${esc(pre.expectations)}` : ''}${s.notes ? `<br><span style="font-family:var(--f-body)">${esc(s.notes)}</span>` : ''}</div></section>
    ${notes.length ? `<section class="blk"><h2 class="sec">Coach notes</h2><div class="stack">${notes.map(noteHtml).join('')}</div></section>` : ''}
    ${s.demo ? '' : `<section class="blk" id="delZone">${sh.confirmDel ? `<div class="confirm"><span>Delete this session and its ${rs.length} rounds? This can't be undone.</span><button class="btn danger" data-act="deleteSession">Delete</button><button class="btn" data-act="cancelDel">Keep</button></div>` : `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="editSession">Edit details</button><button class="btn ghost" data-act="askDel" style="color:var(--miss)">Delete session</button></div>`}</section>`}`;
  return sheetWrap(`${fmtDate(s.date)}`, `${s.type}${s.event ? ' · ' + s.event : ''}`, body,
    s.demo ? '' : `<button class="btn block primary" data-act="addRound" data-sid="${esc(s.id)}">+ Round ${rs.length + 1}</button>`);
}

function shEntry(sh) {
  const d = S.draft;
  const s = sessionById(d.sid);
  const score = 25 - d.misses.size;
  const visits = SK.VISITS.map((stn, vi) => {
    const ts = SK.SEQ.filter(t => t.visit === vi);
    const chip = t => { const m = d.misses.has(t.pos); const cap = t.kind === 'S' ? 'single' : (t.order === 1 ? '1st' : '2nd');
      return `<button type="button" class="tgt" data-act="toggle" data-pos="${t.pos}" aria-pressed="${m}" aria-label="${esc(t.label)}: ${m ? 'miss' : 'hit'}"><small>${cap}</small>${t.house === 'H' ? 'HIGH' : 'LOW'}<span class="mk">${m ? '✕ MISS' : '✓'}</span></button>`; };
    const singles = ts.filter(t => t.kind === 'S').map(chip).join('');
    const doubles = [...new Set(ts.filter(t => t.kind === 'D').map(t => t.dtype))].map(dt => `<span class="pair" title="${dt === 'reg' ? 'Double' : 'Reverse double'}">${ts.filter(t => t.kind === 'D' && t.dtype === dt).map(chip).join('')}</span>`).join('');
    return `<div class="visit"><div class="st">${stn}<small>${vi === 7 ? 'again' : 'stn'}</small></div><div class="tg">${singles}${doubles}</div></div>`;
  }).join('');
  const pre = d.pre;
  const body = `
    <div class="entryhead"><div class="sc num" id="liveScore">${score}<small>/25</small></div><div class="hint">Every target starts as a hit. Tap only the misses.</div></div>
    <div class="strip" id="liveStrip">${SK.SEQ.map(t => `<i class="${d.misses.has(t.pos) ? 'm' : ''}"></i>`).join('')}</div>
    <details class="fold" style="margin-bottom:10px"><summary>Quick check-in before the round <span class="muted" style="font-weight:400;font-size:13px;margin-left:auto;margin-right:10px">optional</span></summary><div class="body">
      ${scale('rpre', 'confidence', 'Confidence', pre.confidence)}${scale('rpre', 'focus', 'Focus', pre.focus)}${scale('rpre', 'energy', 'Energy', pre.energy)}${scale('rpre', 'nerves', 'Nerves / pressure', pre.nerves)}</div></details>
    <div class="visits">${visits}</div>`;
  const rn = d.idx == null ? (s.rounds || []).length + 1 : d.idx + 1;
  return sheetWrap(`Round ${rn}`, `${s.type} · ${fmtDate(s.date)}${s.range ? ' · ' + s.range : ''}`, body,
    `<button class="btn block primary" data-act="saveRound" id="saveRoundBtn">Save round · ${score}/25</button>`);
}

function shReview(sh) {
  const s = sessionById(sh.sid);
  const r = s && s.rounds[sh.i];
  if (!r) return sheetWrap('Round', '', emptyView('Round not found.'), '');
  const d = S.rdraft;
  const Rall = allR();
  const rv = SK.roundReview(Rall, s.id, sh.i);
  const h = hitsArr(r);
  const misses = SK.SEQ.filter((t, j) => !h[j]);
  const tech = [...TECH, ...S.settings.customTech], mental = [...MENTAL, ...S.settings.customMental];
  const ro = !!s.demo;
  const chips = (pos, grp, list) => `<div class="chips" role="group">${list.map(k => { const on = ((d.reasons[pos] || {})[grp] || []).includes(k);
    return `<button type="button" data-act="reason" data-pos="${pos}" data-grp="${grp}" data-k="${esc(k)}" aria-pressed="${on}"${ro ? ' disabled' : ''}>${esc(k)}</button>`; }).join('')}</div>`;
  const pre = r.pre || {};
  const preLine = [['Confidence', pre.confidence], ['Focus', pre.focus], ['Energy', pre.energy], ['Nerves', pre.nerves]].filter(x => x[1]);
  const delta = rv && rv.prevAvg != null ? rv.score - rv.prevAvg : null;
  const body = `
    <section class="blk" style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="bigscore num">${rv.score}<small>/25</small></div>
      <div class="mono" style="font-size:13px;text-align:right">${delta != null ? `${delta >= 0 ? 'Above' : 'Below'} your previous ${rv.prevN}-round avg<br>(${f2(rv.prevAvg)}, ${delta >= 0 ? '+' : ''}${f2(delta)})` : 'First round logged'}</div></section>
    ${miniRound(h)}
    ${s.demo ? '<div class="banner"><span><b>Example round.</b> Read-only.</span></div>' : ''}
    <section class="blk"><h2 class="sec">Misses <small>${misses.length ? 'tap to add what happened (optional)' : ''}</small></h2>
      ${misses.length ? `<div class="stack">${misses.map(t => { const rs = d.reasons[t.pos] || {}; const tags = [...(rs.t || []), ...(rs.m || [])];
        return `<details class="miss"><summary><span class="x">✕</span><div class="grow" style="flex:1;min-width:0"><div style="font-weight:600">${esc(t.label)}</div><div class="muted" style="font-size:12.5px">#${t.pos} · ${esc(t.dir)}${tags.length ? ' · ' + esc(tags.join(', ')) : ''}</div></div></summary>
        <div class="body"><div class="lbl">What happened</div>${chips(t.pos, 't', tech)}<div class="lbl">Mental</div>${chips(t.pos, 'm', mental)}
        <div class="field"><label for="mn-${t.pos}">Note</label><input id="mn-${t.pos}" data-mnote="${t.pos}" value="${esc(d.notes[t.pos] || '')}" placeholder="e.g. Saw the bird late off the house"${ro ? ' disabled' : ''}></div></div></details>`; }).join('')}</div>` : '<div class="card">Clean round. 25 straight.</div>'}</section>
    ${preLine.length ? `<section class="blk"><h2 class="sec">Before the round</h2><div class="card mono" style="font-size:13.5px">${preLine.map(([k, v]) => `${k} ${v}/5`).join(' · ')}</div></section>` : ''}
    <section class="blk"><h2 class="sec">After the round <small>optional</small></h2><div class="card stack">
      ${scale('post', 'focus', 'How focused were you?', d.post.focus)}${scale('post', 'confidence', 'How confident did you feel?', d.post.confidence)}
      ${scale('post', 'mentalFatigue', 'Mental fatigue', d.post.mentalFatigue)}${scale('post', 'physFatigue', 'Physical fatigue', d.post.physFatigue)}${scale('post', 'satisfaction', 'Satisfied with the round?', d.post.satisfaction)}
      <div class="field"><label for="rv-note">Note</label><input id="rv-note" value="${esc(d.note || '')}" placeholder="e.g. Lost concentration after station 4"${ro ? ' disabled' : ''}></div></div></section>
    ${rv.work ? `<section class="blk callout"><div class="k">Target to work on</div><div style="font-weight:600">${esc(rv.work.target.label)}</div><div class="muted" style="font-size:13px">${esc(rv.work.why)}</div></section>` : ''}
    ${rv.obs ? `<section class="blk callout"><div class="k">Performance observation</div><div style="font-size:14px">${esc(rv.obs)}</div></section>` : ''}
    ${ro ? '' : `<section class="blk"><button class="btn" data-act="editHits">Edit hits & misses</button></section>`}`;
  const last = sh.i === s.rounds.length - 1;
  return sheetWrap(`Round ${sh.i + 1} review`, `${s.type} · ${fmtDate(s.date)}`, body, ro ? '' :
    `<button class="btn block" data-act="saveReview" data-next="0">Save${last ? ' & finish' : ''}</button>${last ? `<button class="btn block primary" data-act="saveReview" data-next="1">Save & next round</button>` : ''}`);
}

function shCoach(sh) {
  const R = allR();
  const recent = R.slice(-10).reverse();
  const P = SK.presStats(R).filter(t => t.n >= 30).sort((a, b) => a.rate - b.rate).slice(0, 5);
  const pats = SK.patterns(R);
  const sm = SK.summary(R);
  const tr = SK.mentalTrend(R).slice(-8).reverse();
  const shooterNotes = [];
  data().slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(s => {
    if (s.notes) shooterNotes.push({ date: s.date, where: 'Session', text: s.notes });
    (s.rounds || []).forEach((r, i) => { if (r.note) shooterNotes.push({ date: s.date, where: `Round ${i + 1}`, text: r.note });
      Object.entries(r.notes || {}).forEach(([p, t]) => { if (t) shooterNotes.push({ date: s.date, where: `R${i + 1} · ${SK.SEQ[p - 1].short}`, text: t }); }); });
  });
  const kind = sh.kind2 || 'session';
  const refOpts = kind === 'session' ? data().slice().sort((a, b) => b.date.localeCompare(a.date)).map(s => [s.id, `${fmtDate(s.date)} · ${s.type}`])
    : kind === 'round' ? R.slice().reverse().slice(0, 40).map(r => [`${r.sid}#${r.idx}`, `${fmtDate(r.date)} · round ${r.idx + 1} · ${r.score}/25`])
    : kind === 'station' ? [1, 2, 3, 4, 5, 6, 7, 8].map(k => [String(k), `Station ${k}`]) : SK.SEQ.map(t => [t.id, `#${t.pos} ${t.short}`]);
  const notes = S.coach.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const body = `
    ${isDemo() ? '<div class="banner"><span><b>Example data.</b> Coach notes can be added once real sessions exist.</span></div>' : ''}
    <section class="blk"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      ${stat('Average', f2(sm.mean), `${sm.rounds} rounds`, '/25')}${stat('Last 10', f2(sm.last10), '', '/25')}
      ${stat('Training', f2(sm.train), `n=${sm.trainN}`, '/25')}${stat('Competition', f2(sm.comp), `n=${sm.compN}`, '/25')}</div></section>
    <section class="blk"><h2 class="sec">Coach notes <small>kept apart from app insights</small></h2>
      <div class="card form">
        <div class="two"><div class="field"><label for="cn-kind">Attach to</label><select id="cn-kind">${[['session', 'Session'], ['round', 'Round'], ['station', 'Station'], ['target', 'Target presentation']].map(([v, l]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="cn-ref">Which</label><select id="cn-ref">${refOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div></div>
        <div class="field"><label for="cn-text">Note</label><textarea id="cn-text" placeholder="e.g. Hold point on low 4 drifting toward the house. Move it 1 m out."></textarea></div>
        <div class="field"><label for="cn-author">Coach name</label><input id="cn-author" value="${esc(sh.author || '')}" placeholder="Coach"></div>
        <button class="btn primary" data-act="addCoachNote"${isDemo() ? ' disabled' : ''}>Add note</button></div>
      ${notes.length ? `<div class="stack" style="margin-top:10px">${notes.map(n => `<div class="note" style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div class="m">${esc(n.author || 'Coach')} · ${fmtDate(n.date)} · ${esc(refLabel(n))}</div><div>${esc(n.text)}</div></div><button class="btn ghost" data-act="delCoachNote" data-id="${esc(n.id)}" aria-label="Delete note">✕</button></div>`).join('')}</div>` : ''}</section>
    <section class="blk"><h2 class="sec">Recent rounds <small>miss map</small></h2><div class="list">${recent.map(r => `<div class="row"><div class="grow"><div class="s">${fmtDate(r.date)} · ${esc(r.type)} · R${r.idx + 1}</div>${miniRound(r.hits)}</div><div class="score">${r.score}</div></div>`).join('')}</div></section>
    <section class="blk"><h2 class="sec">Weakest targets <small>30+ attempts</small></h2>${P.length ? `<div class="tbl-wrap"><table><thead><tr><th>Target</th><th class="num">%</th><th class="num">n</th><th class="num">95% CI</th></tr></thead><tbody>${P.map(t => `<tr><td>${esc(t.short)}</td><td class="num mono">${pct(t.rate)}</td><td class="num mono">${t.n}</td><td class="num mono">${pct(t.lo, 0)}–${pct(t.hi, 0)}</td></tr>`).join('')}</tbody></table></div>` : emptyView('Needs 30+ attempts per target.')}</section>
    <section class="blk"><h2 class="sec">App-generated patterns</h2>${pats.length ? `<div class="stack">${pats.map(p => `<div class="pat"><span class="pill warn">${esc(p.kind)}</span><div style="font-size:14px">${esc(p.text)}</div></div>`).join('')}</div>` : emptyView('None pass the evidence bar yet.')}</section>
    <section class="blk"><h2 class="sec">Mental check-ins <small>recent sessions</small></h2>${tr.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th class="num">Conf.</th><th class="num">Focus</th><th class="num">Nerves</th><th class="num">Mental fatigue</th></tr></thead><tbody>${tr.map(t => `<tr><td>${fmtDate(t.date)}${t.comp ? ' <span class="pill comp">comp</span>' : ''}</td><td class="num mono">${f2(t.confidence, 1)}</td><td class="num mono">${f2(t.focus, 1)}</td><td class="num mono">${f2(t.nerves, 1)}</td><td class="num mono">${f2(t.mentalFatigue, 1)}</td></tr>`).join('')}</tbody></table></div>` : emptyView('No check-ins yet.')}</section>
    <section class="blk"><h2 class="sec">Shooter notes</h2>${shooterNotes.length ? `<div class="stack">${shooterNotes.slice(0, 15).map(n => `<div class="note"><div class="m">${fmtDate(n.date)} · ${esc(n.where)}</div><div>${esc(n.text)}</div></div>`).join('')}</div>` : emptyView('No notes yet.')}</section>`;
  return sheetWrap('Coach view', 'Summary for a coach, with notes kept separately', body, '');
}

// ---------------- actions ----------------
function newDraftSession() { return { id: uid(), type: 'Training', date: today(), range: '', event: '', weather: {}, ammo: '', choke: '', notes: '', pre: {}, rounds: [], createdAt: Date.now() }; }
function readSessionForm(d) {
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  d.date = v('sf-date') || today(); d.range = v('sf-range'); d.event = SK.isComp(d.type) ? v('sf-event') : '';
  d.weather = { ...d.weather, cond: v('sf-cond'), tempC: v('sf-temp') === '' ? null : Number(v('sf-temp')), windDir: v('sf-winddir'), light: v('sf-light') };
  d.ammo = v('sf-ammo'); d.choke = v('sf-choke'); d.notes = v('sf-notes');
  d.pre.sleepH = v('sf-sleeph') === '' ? null : Number(v('sf-sleeph')); d.pre.soreness = v('sf-sore'); d.pre.expectations = v('sf-expect');
  if (!SK.isComp(d.type)) { delete d.pre.nerves; delete d.pre.pressure; }
}
function startEntry(sid, idx) {
  const s = sessionById(sid);
  const r = idx != null ? s.rounds[idx] : null;
  const misses = new Set();
  if (r) hitsArr(r).forEach((h, i) => { if (!h) misses.add(i + 1); });
  S.draft = { sid, idx, misses, pre: r ? { ...(r.pre || {}) } : {} };
  openSheet({ kind: 'entry' });
}
function startReview(sid, i) {
  const s = sessionById(sid), r = s.rounds[i];
  S.rdraft = { reasons: clone(r.reasons || {}), notes: { ...(r.notes || {}) }, post: { ...(r.post || {}) }, note: r.note || '' };
  openSheet({ kind: 'review', sid, i });
}
function updateLive() {
  const d = S.draft, score = 25 - d.misses.size;
  const ls = $('#liveScore'); if (ls) ls.innerHTML = `${score}<small>/25</small>`;
  const st = $('#liveStrip'); if (st) st.innerHTML = SK.SEQ.map(t => `<i class="${d.misses.has(t.pos) ? 'm' : ''}"></i>`).join('');
  const b = $('#saveRoundBtn'); if (b) b.textContent = `Save round · ${score}/25`;
}
function scaleTarget(g) { return g === 'spre' ? S.sheet.draft.pre : g === 'rpre' ? S.draft.pre : S.rdraft.post; }

async function doExport(kind) {
  const src = S.sessions;
  if (!src.length) { toast('Nothing to export yet.'); return; }
  let filename, body;
  if (kind === 'json') { filename = `skeet-log-${today()}.json`; body = JSON.stringify({ app: 'skeet-log', version: 1, exported: new Date().toISOString(), sessions: src, coach: S.coach, settings: S.settings }, null, 1); }
  else {
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['date', 'session_id', 'type', 'range', 'event', 'round', 'position', 'station', 'house', 'kind', 'double_type', 'double_order', 'presentation_id', 'label', 'result', 'tech_reasons', 'mental_tags', 'note', 'pre_confidence', 'pre_focus', 'pre_energy', 'pre_nerves']];
    SK.flatten(src).forEach(r => SK.SEQ.forEach((t, i) => { const rs = r.reasons[t.pos] || {};
      rows.push([r.date, r.sid, r.type, r.range, r.event, r.idx + 1, t.pos, t.stn, t.house === 'H' ? 'High' : 'Low', t.kind === 'S' ? 'Single' : 'Double', t.dtype || '', t.order || '', t.id, t.label, r.hits[i] ? 'Hit' : 'Miss', (rs.t || []).join('; '), (rs.m || []).join('; '), r.notes[t.pos] || '', r.pre.confidence || '', r.pre.focus || '', r.pre.energy || '', r.pre.nerves || '']); }));
    filename = `skeet-targets-${today()}.csv`; body = rows.map(r => r.map(q).join(',')).join('\n');
  }
  const ok = await saveFile(filename, body, kind === 'json' ? 'application/json' : 'text/csv');
  if (ok && kind === 'json') { try { localStorage.setItem('skeetlog.lastBackup', String(Date.now())); } catch (e) { /* ignore */ } render(); }
}
async function saveFile(filename, text, mime) {
  // 1) inside Claude: platform download  2) phone share sheet (Save to Files / Drive)  3) plain download
  try {
    if (window.claude && window.claude.use) {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename, data: text }); toast('Export ready'); return true; }
    }
  } catch (e) { if (e && e.code === 'declined') return false; }
  const file = new File([text], filename, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); toast('Backup shared'); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Export downloaded'); return true;
  } catch (e) { toast('Export failed on this device.'); return false; }
}
function lastBackup() { try { return Number(localStorage.getItem('skeetlog.lastBackup')) || 0; } catch (e) { return 0; } }
function backupDue() { return S.sessions.length > 0 && Date.now() - lastBackup() > 14 * 864e5; }
function lastBackupText() { const t = lastBackup(); return t ? fmtDate(new Date(t).toISOString().slice(0, 10)) : 'never'; }
async function doImport(file) {
  const msg = $('#importMsg');
  try {
    const o = JSON.parse(await file.text());
    const ss = Array.isArray(o.sessions) ? o.sessions.filter(s => s && s.id && Array.isArray(s.rounds)) : [];
    if (!ss.length) throw new Error('No sessions found in that file.');
    for (const s of ss) { delete s.demo; await Store.saveSession(s); }
    for (const n of (o.coach || [])) if (n && n.id) await Store.saveCoach(n);
    msg.innerHTML = `<div class="banner" style="background:var(--hit-soft);border-color:transparent"><span>Imported ${ss.length} sessions.</span></div>`;
    render();
  } catch (e) { msg.innerHTML = `<div class="confirm"><span>Import failed: ${esc(e.message || 'unreadable file')}. Choose a backup exported from this app.</span></div>`; }
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (a === 'back') {
    const sh = S.sheet;
    if (sh && (sh.kind === 'entry' || sh.kind === 'review') && sh.from) { openSheet(sh.from); return; }
    closeSheet(); return;
  }
  if (a === 'newSession') { openSheet({ kind: 'sessionForm', draft: newDraftSession() }); return; }
  if (a === 'coach') { openSheet({ kind: 'coach' }); return; }
  if (a === 'openSession') { openSheet({ kind: 'session', sid: b.dataset.sid }); return; }
  if (a === 'selStation') { S.selStation = Number(b.dataset.stn); render(); const p = $('#stnpanel'); if (p) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
  if (a === 'openTarget') { S.openTarget = S.openTarget === b.dataset.id ? null : b.dataset.id; render(); return; }
  if (a === 'seg') {
    const g = b.dataset.g, v = b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (g === 'stype') { S.sheet.draft.type = v; const c = SK.isComp(v); document.querySelectorAll('.comp-only').forEach(x => { x.hidden = !c; }); $('#finalHint').hidden = v !== 'Final'; }
    if (g === 'wind') { const w = S.sheet.draft.weather; if (w.wind === v) { w.wind = ''; b.setAttribute('aria-pressed', 'false'); } else w.wind = v; }
    return;
  }
  if (a === 'scale') {
    const o = scaleTarget(b.dataset.g), k = b.dataset.k, v = Number(b.dataset.v);
    if (o[k] === v) { delete o[k]; b.setAttribute('aria-pressed', 'false'); }
    else { o[k] = v; b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }
    return;
  }
  if (a === 'saveSession') {
    const d = S.sheet.draft; readSessionForm(d);
    const edit = S.sheet.edit;
    await Store.saveSession(d);
    if (edit) { openSheet({ kind: 'session', sid: d.id }); toast('Session updated'); }
    else { startEntry(d.id, null); S.sheet.from = { kind: 'session', sid: d.id }; }
    return;
  }
  if (a === 'editSession') { const s = sessionById(S.sheet.sid); openSheet({ kind: 'sessionForm', edit: true, draft: clone(s) }); return; }
  if (a === 'askDel') { S.sheet.confirmDel = true; renderSheet(); return; }
  if (a === 'cancelDel') { S.sheet.confirmDel = false; renderSheet(); return; }
  if (a === 'deleteSession') { const id = S.sheet.sid; await Store.deleteSession(id); closeSheet(); toast('Session deleted'); return; }
  if (a === 'addRound') { startEntry(b.dataset.sid, null); S.sheet.from = { kind: 'session', sid: b.dataset.sid }; return; }
  if (a === 'toggle') {
    const p = Number(b.dataset.pos), d = S.draft;
    if (d.misses.has(p)) d.misses.delete(p); else d.misses.add(p);
    const m = d.misses.has(p);
    b.setAttribute('aria-pressed', String(m)); b.querySelector('.mk').textContent = m ? '✕ MISS' : '✓';
    b.setAttribute('aria-label', `${SK.SEQ[p - 1].label}: ${m ? 'miss' : 'hit'}`);
    updateLive(); return;
  }
  if (a === 'saveRound') {
    const d = S.draft, s = clone(sessionById(d.sid));
    const hits = SK.SEQ.map(t => (d.misses.has(t.pos) ? '0' : '1')).join('');
    let i;
    if (d.idx == null) { s.rounds.push({ hits, pre: d.pre, post: {}, reasons: {}, notes: {}, note: '', createdAt: Date.now() }); i = s.rounds.length - 1; }
    else {
      i = d.idx; const r = s.rounds[i]; r.hits = hits; r.pre = d.pre;
      Object.keys(r.reasons || {}).forEach(p => { if (hits[p - 1] === '1') delete r.reasons[p]; });
      Object.keys(r.notes || {}).forEach(p => { if (hits[p - 1] === '1') delete r.notes[p]; });
    }
    await Store.saveSession(s);
    startReview(s.id, i); S.sheet.from = { kind: 'session', sid: s.id };
    return;
  }
  if (a === 'openReview') { startReview(b.dataset.sid, Number(b.dataset.i)); S.sheet.from = { kind: 'session', sid: b.dataset.sid }; return; }
  if (a === 'editHits') { const { sid, i } = S.sheet; startEntry(sid, i); S.sheet.from = { kind: 'session', sid }; return; }
  if (a === 'reason') {
    const p = b.dataset.pos, g = b.dataset.grp, k = b.dataset.k;
    const o = S.rdraft.reasons[p] = S.rdraft.reasons[p] || { t: [], m: [] };
    o[g] = o[g] || [];
    const on = o[g].includes(k);
    o[g] = on ? o[g].filter(x => x !== k) : [...o[g], k];
    b.setAttribute('aria-pressed', String(!on));
    return;
  }
  if (a === 'saveReview') {
    const { sid, i } = S.sheet, s = clone(sessionById(sid)), r = s.rounds[i], d = S.rdraft;
    document.querySelectorAll('[data-mnote]').forEach(inp => { const v = inp.value.trim(); if (v) d.notes[inp.dataset.mnote] = v; else delete d.notes[inp.dataset.mnote]; });
    Object.keys(d.reasons).forEach(p => { const o = d.reasons[p]; if (!(o.t || []).length && !(o.m || []).length) delete d.reasons[p]; });
    r.reasons = d.reasons; r.notes = d.notes; r.post = d.post; r.note = ($('#rv-note') || {}).value || '';
    await Store.saveSession(s);
    if (b.dataset.next === '1') { startEntry(sid, null); S.sheet.from = { kind: 'session', sid }; }
    else { openSheet({ kind: 'session', sid }); toast('Round saved'); }
    return;
  }
  if (a === 'addCoachNote') {
    const text = $('#cn-text').value.trim();
    if (!text) { toast('Write the note first.'); return; }
    const author = $('#cn-author').value.trim();
    const n = { id: uid(), kind: $('#cn-kind').value, ref: $('#cn-ref').value, text, author: author || 'Coach', date: today(), createdAt: Date.now() };
    await Store.saveCoach(n); S.sheet.author = author; renderSheet(); toast('Note added'); return;
  }
  if (a === 'delCoachNote') { await Store.deleteCoach(b.dataset.id); renderSheet(); return; }
  if (a === 'saveSettings') {
    const list = id => $(id).value.split(',').map(x => x.trim()).filter(Boolean);
    S.settings = { ...S.settings, threshold: Math.max(15, Math.min(25, Number($('#set-thr').value) || 23)), customTech: list('#set-tech'), customMental: list('#set-mental') };
    await Store.saveSettings(); render(); toast('Settings saved'); return;
  }
  if (a === 'exportJson') { doExport('json'); return; }
  if (a === 'exportCsv') { doExport('csv'); return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f) { S.filter[t.dataset.f] = t.value; S.selStation = null; render(); return; }
  if (t.dataset.f2 === 'focusStn') { S.focusStn = t.value; render(); return; }
  if (t.id === 'cn-kind') { S.sheet.kind2 = t.value; S.sheet.author = $('#cn-author').value; renderSheet(); return; }
  if (t.id === 'importFile' && t.files && t.files[0]) { doImport(t.files[0]); t.value = ''; }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g[data-act],tr[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (e.key === 'Escape' && S.sheet) closeSheet();
});
// tooltips
const tip = $('#tip');
let tipTimer;
function showTip(el, x, y) {
  tip.textContent = el.getAttribute('data-tip'); tip.style.whiteSpace = 'pre-line'; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
  tip.style.top = Math.max(8, y - h - 12) + 'px';
}
document.addEventListener('pointermove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && e.pointerType === 'mouse') showTip(el, e.clientX, e.clientY); else if (e.pointerType === 'mouse') tip.hidden = true; });
document.addEventListener('pointerdown', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && e.pointerType !== 'mouse') { showTip(el, e.clientX, e.clientY); clearTimeout(tipTimer); tipTimer = setTimeout(() => { tip.hidden = true; }, 2500); } });
document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } });
document.addEventListener('focusout', () => { tip.hidden = true; });
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

// ---------------- render ----------------
const TABS = [
  ['scores', 'Scores', '<path d="M4 19V10M10 19V5M16 19v-7M22 19H2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'],
  ['targets', 'Targets', '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'],
  ['mental', 'Mental', '<path d="M2 12h4l3-7 4 14 3-7h6" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>'],
  ['insights', 'Insights', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>'],
  ['more', 'More', '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>']
];
function render() {
  $('#tabs').innerHTML = TABS.map(([k, l, ic]) => `<button data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${l}</button>`).join('');
  if (!S.loaded) return;
  const scroll = window.scrollY;
  const v = { scores: vScores, targets: vTargets, mental: vMental, insights: vInsights, more: vMore }[S.tab]();
  $('#view').innerHTML = v;
  window.scrollTo(0, scroll);
  $('#brandsub').textContent = isDemo() ? 'Example data' : `${allR().length} rounds logged`;
}

render();
Store.init();
setTimeout(() => { if (!S.loaded) { S.loaded = true; S.ver++; render(); } }, 11000);
})();
