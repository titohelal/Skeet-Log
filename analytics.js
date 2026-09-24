/* Skeet analytics engine — pure functions, no DOM. */
(function (root) {
  'use strict';

  // ---------- ISSF skeet 25-target sequence (verified: ISSF 9.9.3.3 order) ----------
  function dirOf(stn, house) {
    if (stn === 8) return 'Incoming';
    if (stn === 1) return house === 'H' ? 'Outgoing' : 'Incoming';
    if (stn === 7) return house === 'L' ? 'Outgoing' : 'Incoming';
    if (stn === 2) return house === 'H' ? 'Quartering away' : 'Quartering in';
    if (stn === 6) return house === 'L' ? 'Quartering away' : 'Quartering in';
    return house === 'H' ? 'Crossing L→R' : 'Crossing R→L';
  }
  const SEQ = [];
  const VISITS = [1, 2, 3, 4, 5, 6, 7, 4, 8];
  (function build() {
    let pos = 0;
    const single = (visit, stn, house) => {
      pos++;
      SEQ.push({ pos, visit, stn, house, kind: 'S', dtype: null, order: 0, id: stn + house,
        label: `Station ${stn} ${house === 'H' ? 'High' : 'Low'} single`,
        short: `${stn} ${house === 'H' ? 'High' : 'Low'}`, dir: dirOf(stn, house) });
    };
    const dbl = (visit, stn, dtype) => {
      const houses = dtype === 'reg' ? ['H', 'L'] : ['L', 'H'];
      houses.forEach((house, i) => {
        pos++;
        const order = i + 1;
        const tag = dtype === 'reg' ? 'D' : 'R';
        SEQ.push({ pos, visit, stn, house, kind: 'D', dtype, order, id: `${stn}${tag}${order}`,
          label: `Station ${stn} ${dtype === 'reg' ? 'double' : 'reverse double'}, ${order === 1 ? '1st' : '2nd'} target (${house === 'H' ? 'High' : 'Low'})`,
          short: `${stn} ${dtype === 'reg' ? 'Dbl' : 'Rev dbl'} ${order === 1 ? '1st' : '2nd'} ${house}`,
          dir: dirOf(stn, house) });
      });
    };
    single(0, 1, 'H'); dbl(0, 1, 'reg');
    single(1, 2, 'H'); dbl(1, 2, 'reg');
    single(2, 3, 'H'); dbl(2, 3, 'reg');
    single(3, 4, 'H'); single(3, 4, 'L');
    single(4, 5, 'L'); dbl(4, 5, 'rev');
    single(5, 6, 'L'); dbl(5, 6, 'rev');
    dbl(6, 7, 'rev');
    dbl(7, 4, 'reg'); dbl(7, 4, 'rev');
    single(8, 8, 'H'); single(8, 8, 'L');
  })();
  const BY_ID = Object.fromEntries(SEQ.map(t => [t.id, t]));

  const COMP_TYPES = ['Competition', 'Qualification', 'Final'];
  const isComp = t => COMP_TYPES.includes(t);

  // ---------- small stats kit ----------
  const sum = a => a.reduce((x, y) => x + y, 0);
  const mean = a => (a.length ? sum(a) / a.length : NaN);
  function sd(a) {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
  }
  function wilson(h, n, z = 1.96) {
    if (!n) return [0, 1];
    const p = h / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
    const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
  }
  function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normCdf = x => 0.5 * (1 + erf(x / Math.SQRT2));
  const pFromZ = z => 2 * (1 - normCdf(Math.abs(z)));
  function twoProp(h1, n1, h2, n2) {
    if (!n1 || !n2) return { z: 0, p: 1, diff: NaN };
    const p = (h1 + h2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    const diff = h1 / n1 - h2 / n2;
    if (!se) return { z: 0, p: 1, diff };
    const z = diff / se;
    return { z, p: pFromZ(z), diff };
  }
  function bh(ps) {
    const m = ps.length, q = new Array(m);
    const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    let prev = 1;
    for (let k = m - 1; k >= 0; k--) {
      const [p, i] = idx[k];
      prev = Math.min(prev, (p * m) / (k + 1));
      q[i] = prev;
    }
    return q;
  }
  function lgamma(x) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-12, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  const tP = (t, df) => (df > 0 && isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 1);
  function welch(a, b) {
    if (a.length < 2 || b.length < 2) return { t: 0, df: 0, p: 1, diff: mean(a) - mean(b) };
    const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
    const diff = mean(a) - mean(b);
    const se = Math.sqrt(va + vb);
    if (!se) return { t: 0, df: 0, p: diff === 0 ? 1 : 0, diff };
    const t = diff / se;
    const df = (va + vb) ** 2 / (va * va / (a.length - 1) + vb * vb / (b.length - 1));
    return { t, df, p: tP(t, df), diff };
  }
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return { r: NaN, p: 1, n };
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    if (!sxx || !syy) return { r: 0, p: 1, n };
    const r = sxy / Math.sqrt(sxx * syy);
    const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
    return { r, p: tP(t, n - 2), n };
  }
  function linreg(ys) {
    const n = ys.length;
    if (n < 3) return { slope: 0, p: 1 };
    const xs = ys.map((_, i) => i);
    const pr = pearson(xs, ys);
    const slope = pr.r * (sd(ys) / sd(xs));
    return { slope: isFinite(slope) ? slope : 0, p: pr.p, r: pr.r };
  }
  // observed hits vs expected (sum of per-target baselines); normal approximation
  function obsExp(obs, probs) {
    const n = probs.length, exp = sum(probs), v = sum(probs.map(b => b * (1 - b)));
    const z = v > 0 ? (obs - exp) / Math.sqrt(v) : 0;
    return { obs, exp, n, rate: n ? obs / n : NaN, expRate: n ? exp / n : NaN, z, p: pFromZ(z) };
  }

  // ---------- flatten & filter ----------
  function byDate(a, b) {
    return (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0);
  }
  function flatten(sessions) {
    const out = [];
    sessions.slice().sort(byDate).forEach(s => {
      const rs = (s.rounds || []).filter(r => r && typeof r.hits === 'string' && r.hits.length === 25);
      rs.forEach((r, i) => {
        const hits = r.hits.split('').map(c => (c === '1' ? 1 : 0));
        out.push({
          sid: s.id, s, r, idx: i, of: rs.length, date: s.date, type: s.type, comp: isComp(s.type),
          range: s.range || '', event: s.event || '', hits, score: sum(hits),
          pre: r.pre || {}, post: r.post || {}, spre: s.pre || {}, wx: s.weather || {},
          reasons: r.reasons || {}, notes: r.notes || {}
        });
      });
    });
    return out;
  }
  function applyFilter(R, f, today) {
    f = f || {};
    let x = R;
    if (f.type === 'training') x = x.filter(r => !r.comp);
    else if (f.type === 'competition') x = x.filter(r => r.comp);
    if (f.range) x = x.filter(r => r.range === f.range);
    if (f.event) x = x.filter(r => r.event === f.event);
    const t = today || new Date().toISOString().slice(0, 10);
    const win = f.win || 'all';
    const m = /^l(\d+)$/.exec(win);
    if (m) x = x.slice(-Number(m[1]));
    else if (win === 'month') x = x.filter(r => (r.date || '').slice(0, 7) === t.slice(0, 7));
    else if (win === 'season') x = x.filter(r => (r.date || '').slice(0, 4) === t.slice(0, 4));
    else if (win === 'custom') x = x.filter(r => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to));
    return x;
  }

  // ---------- score summary ----------
  function bestWindow(R, k) {
    // best total over k consecutive rounds inside one session
    let best = null;
    groupBySession(R).forEach(g => {
      for (let i = 0; i + k <= g.rounds.length; i++) {
        const tot = sum(g.rounds.slice(i, i + k).map(r => r.score));
        if (!best || tot > best.total) best = { total: tot, date: g.date, sid: g.sid, event: g.event, type: g.type };
      }
    });
    return best;
  }
  function groupBySession(R) {
    const m = new Map();
    R.forEach(r => {
      if (!m.has(r.sid)) m.set(r.sid, { sid: r.sid, date: r.date, type: r.type, comp: r.comp, event: r.event, range: r.range, s: r.s, rounds: [] });
      m.get(r.sid).rounds.push(r);
    });
    return [...m.values()];
  }
  function summary(R) {
    const sc = R.map(r => r.score);
    const n = sc.length;
    const m = mean(sc);
    const hits = sum(sc), targets = n * 25;
    const full = groupBySession(R).filter(g => g.rounds.length >= 5).map(g => sum(g.rounds.slice(0, 5).map(r => r.score)));
    const comp = R.filter(r => r.comp).map(r => r.score), train = R.filter(r => !r.comp).map(r => r.score);
    return {
      rounds: n, mean: m, sd: sd(sc),
      within1: n ? sc.filter(s => Math.abs(s - m) <= 1).length / n : NaN,
      pb25: n ? Math.max(...sc) : NaN,
      last10: mean(sc.slice(-10)), last10n: Math.min(10, n),
      last50: mean(sc.slice(-50)), last50n: Math.min(50, n),
      comp: mean(comp), compN: comp.length, train: mean(train), trainN: train.length,
      avg125: mean(full), n125: full.length, pb125: bestWindow(R, 5),
      targets, hits, misses: targets - hits, hitRate: targets ? hits / targets : NaN,
      series: R.map(r => ({ date: r.date, score: r.score, comp: r.comp, sid: r.sid, idx: r.idx }))
    };
  }

  // ---------- target-level ----------
  function presStats(R, filterPos) {
    return SEQ.map((t, i) => {
      let h = 0, n = 0;
      R.forEach(r => { n++; h += r.hits[i]; });
      const ci = wilson(h, n);
      return { ...t, h, n, miss: n - h, rate: n ? h / n : NaN, lo: ci[0], hi: ci[1] };
    }).filter(t => !filterPos || filterPos(t));
  }
  function baseline(R) { return presStats(R).map(t => (t.n ? t.rate : 0.9)); }
  function stationStats(R) {
    const P = presStats(R);
    return [1, 2, 3, 4, 5, 6, 7, 8].map(stn => {
      const ts = P.filter(t => t.stn === stn);
      const h = sum(ts.map(t => t.h)), n = sum(ts.map(t => t.n));
      const ci = wilson(h, n);
      return { stn, h, n, miss: n - h, rate: n ? h / n : NaN, lo: ci[0], hi: ci[1], targets: ts };
    });
  }
  function agg(P, pred, name) {
    const ts = P.filter(pred);
    const h = sum(ts.map(t => t.h)), n = sum(ts.map(t => t.n));
    const ci = wilson(h, n);
    return { name, h, n, rate: n ? h / n : NaN, lo: ci[0], hi: ci[1] };
  }
  function groups(R) {
    const P = presStats(R);
    return {
      singles: agg(P, t => t.kind === 'S', 'Singles'), doubles: agg(P, t => t.kind === 'D', 'Doubles'),
      first: agg(P, t => t.order === 1, 'Double: 1st target'), second: agg(P, t => t.order === 2, 'Double: 2nd target'),
      high: agg(P, t => t.house === 'H', 'High house'), low: agg(P, t => t.house === 'L', 'Low house')
    };
  }
  function stationTrend(R, stn, block = 10) {
    const idx = SEQ.map((t, i) => (t.stn === stn ? i : -1)).filter(i => i >= 0);
    const out = [];
    for (let i = 0; i < R.length; i += block) {
      const chunk = R.slice(i, i + block);
      let h = 0, n = 0;
      chunk.forEach(r => idx.forEach(j => { n++; h += r.hits[j]; }));
      out.push({ from: chunk[0].date, to: chunk[chunk.length - 1].date, h, n, rate: h / n, rounds: chunk.length });
    }
    return out;
  }
  function trainVsComp(R, minN = 20) {
    const T = presStats(R.filter(r => !r.comp)), C = presStats(R.filter(r => r.comp));
    const rows = SEQ.map((t, i) => {
      const a = T[i], b = C[i];
      const tp = twoProp(a.h, a.n, b.h, b.n);
      return { ...t, tH: a.h, tN: a.n, tRate: a.rate, cH: b.h, cN: b.n, cRate: b.rate, diff: tp.diff, p: tp.p, ok: a.n >= minN && b.n >= minN };
    });
    const ok = rows.filter(r => r.ok);
    const q = bh(ok.map(r => r.p));
    ok.forEach((r, i) => { r.q = q[i]; });
    rows.forEach(r => { if (r.q === undefined) r.q = 1; });
    return rows;
  }

  // ---------- post-miss ----------
  function postMiss(R) {
    const base = baseline(R);
    let tH = 0, tN = 0;
    R.forEach(r => { tN += 25; tH += r.score; });
    const nextPres = [], nextPresHits = [], inDbl = [], inDblHits = [];
    const w3p = [], w3h = [], w5p = [], w5h = [];
    const after2p = [], after2h = [];
    const tr = { HH: 0, HM: 0, MH: 0, MM: 0 };
    const missStations = new Set();
    let missesFollowedByMiss = 0;
    R.forEach(r => {
      const h = r.hits;
      for (let p = 0; p < 25; p++) {
        if (p > 0) tr[(h[p - 1] ? 'H' : 'M') + (h[p] ? 'H' : 'M')]++;
        if (h[p] === 0 && p < 24) {
          const sameDouble = SEQ[p].order === 1;
          if (sameDouble) { inDbl.push(base[p + 1]); inDblHits.push(h[p + 1]); }
          else {
            nextPres.push(base[p + 1]); nextPresHits.push(h[p + 1]);
            if (!h[p + 1]) { missStations.add(SEQ[p + 1].stn); missesFollowedByMiss++; }
          }
          for (let k = 1; k <= 5 && p + k < 25; k++) {
            if (k <= 3) { w3p.push(base[p + k]); w3h.push(h[p + k]); }
            w5p.push(base[p + k]); w5h.push(h[p + k]);
          }
        }
        if (p >= 1 && p < 24 && h[p] === 0 && h[p - 1] === 0) { after2p.push(base[p + 1]); after2h.push(h[p + 1]); }
      }
    });
    const pairsM = tr.MH + tr.MM, pairsH = tr.HH + tr.HM;
    const clustering = twoProp(tr.MM, pairsM, tr.HM, pairsH); // P(miss|prev miss) - P(miss|prev hit)
    return {
      overall: { h: tH, n: tN, rate: tN ? tH / tN : NaN },
      nextPresentation: obsExp(sum(nextPresHits), nextPres),
      withinDouble: obsExp(sum(inDblHits), inDbl),
      next3: obsExp(sum(w3h), w3p),
      next5: obsExp(sum(w5h), w5p),
      after2: obsExp(sum(after2h), after2p),
      transitions: tr,
      pMissAfterMiss: pairsM ? tr.MM / pairsM : NaN, pMissAfterHit: pairsH ? tr.HM / pairsH : NaN,
      clustering, missStationsAfterMiss: missStations.size, missesFollowedByMiss
    };
  }

  // ---------- pressure / perfect rounds ----------
  function firstMiss(h) { const i = h.indexOf(0); return i < 0 ? 25 : i; }
  function pressure(R) {
    const base = baseline(R);
    const n = R.length;
    const cleanThrough = [10, 15, 20, 23, 24].map(k => {
      const c = R.filter(r => firstMiss(r.hits) >= k).length;
      return { k, count: c, pct: n ? c / n : NaN };
    });
    const c20 = R.filter(r => firstMiss(r.hits) >= 20);
    const c24 = R.filter(r => firstMiss(r.hits) >= 24);
    const twentyFives = R.filter(r => r.score === 25).length;
    const twentyFours = R.filter(r => r.score === 24);
    const pos24 = {};
    twentyFours.forEach(r => { const p = r.hits.indexOf(0); pos24[p] = (pos24[p] || 0) + 1; });
    const stoppers = {};
    c20.filter(r => r.score < 25).forEach(r => { const p = firstMiss(r.hits); stoppers[p] = (stoppers[p] || 0) + 1; });
    // raw 1-20 vs 21-25 (different targets; shown with the difficulty caveat)
    let aH = 0, aN = 0, bH = 0, bN = 0;
    R.forEach(r => { for (let p = 0; p < 25; p++) { if (p < 20) { aN++; aH += r.hits[p]; } else { bN++; bH += r.hits[p]; } } });
    // final five when clean through 20, vs those same targets' baselines
    const f5p = [], f5h = [];
    c20.forEach(r => { for (let p = 20; p < 25; p++) { f5p.push(base[p]); f5h.push(r.hits[p]); } });
    // long clean run: targets hit while the round is still clean after ≥15 straight hits
    const lrp = [], lrh = [];
    R.forEach(r => { const fm = firstMiss(r.hits); for (let p = 15; p < 25 && p <= fm; p++) { lrp.push(base[p]); lrh.push(r.hits[p]); } });
    // final 5 training vs competition
    const f5 = (sub) => { let h = 0, m = 0; sub.forEach(r => { for (let p = 20; p < 25; p++) { m++; h += r.hits[p]; } }); return { h, n: m, rate: m ? h / m : NaN }; };
    const f5t = f5(R.filter(r => !r.comp)), f5c = f5(R.filter(r => r.comp));
    // last round of competition vs earlier rounds
    const compS = groupBySession(R.filter(r => r.comp)).filter(g => g.rounds.length >= 2);
    const lastR = compS.map(g => g.rounds[g.rounds.length - 1].score);
    const earlierR = [].concat(...compS.map(g => g.rounds.slice(0, -1).map(r => r.score)));
    return {
      rounds: n, cleanThrough,
      conv20: { made: c20.filter(r => r.score === 25).length, of: c20.length },
      conv24: { made: c24.filter(r => r.score === 25).length, of: c24.length },
      twentyFives, twentyFours: twentyFours.length, pos24, stoppers,
      raw: { early: { h: aH, n: aN, rate: aN ? aH / aN : NaN }, late: { h: bH, n: bN, rate: bN ? bH / bN : NaN } },
      finalFiveClean: obsExp(sum(f5h), f5p),
      longRun: obsExp(sum(lrh), lrp),
      finalFive: { train: f5t, comp: f5c, test: twoProp(f5t.h, f5t.n, f5c.h, f5c.n) },
      lastCompRound: { last: lastR, earlier: earlierR, test: welch(lastR, earlierR), sessions: compS.length }
    };
  }

  // ---------- check-ins vs score ----------
  const ROUND_METRICS = [
    { key: 'confidence', src: 'pre', label: 'Confidence (before round)' },
    { key: 'focus', src: 'pre', label: 'Focus (before round)' },
    { key: 'energy', src: 'pre', label: 'Energy (before round)' },
    { key: 'nerves', src: 'pre', label: 'Nerves / pressure (before round)' },
    { key: 'focus', src: 'post', label: 'Focus (rated after round)', after: true },
    { key: 'confidence', src: 'post', label: 'Confidence (rated after round)', after: true },
    { key: 'mentalFatigue', src: 'post', label: 'Mental fatigue (after round)', after: true },
    { key: 'physFatigue', src: 'post', label: 'Physical fatigue (after round)', after: true }
  ];
  const SESSION_METRICS = [
    { key: 'sleepQ', label: 'Sleep quality' }, { key: 'sleepH', label: 'Hours slept', bucket: true },
    { key: 'energy', label: 'Energy (session)' }, { key: 'physFatigue', label: 'Physical fatigue (session)' },
    { key: 'confidence', label: 'Confidence (session)' }, { key: 'focus', label: 'Focus (session)' },
    { key: 'stress', label: 'Stress' }, { key: 'motivation', label: 'Motivation' },
    { key: 'nerves', label: 'Nervousness (competition)' }, { key: 'pressure', label: 'Perceived pressure (competition)' }
  ];
  function sleepBucket(h) { return h < 6 ? 1 : h < 7 ? 2 : h < 8 ? 3 : h < 9 ? 4 : 5; }
  const SLEEP_LABELS = ['<6h', '6–7h', '7–8h', '8–9h', '9h+'];
  function levelTable(pairs, minGroup) {
    const levels = [1, 2, 3, 4, 5].map(l => { const s = pairs.filter(p => p.v === l).map(p => p.y); return { level: l, n: s.length, mean: mean(s) }; });
    const low = pairs.filter(p => p.v <= 2).map(p => p.y), high = pairs.filter(p => p.v >= 4).map(p => p.y);
    const w = welch(high, low);
    const pr = pearson(pairs.map(p => p.v), pairs.map(p => p.y));
    return { levels, n: pairs.length, low: { n: low.length, mean: mean(low) }, high: { n: high.length, mean: mean(high) },
      test: w, r: pr.r, rp: pr.p, enough: low.length >= minGroup && high.length >= minGroup };
  }
  function checkins(R, minGroup = 8) {
    const round = ROUND_METRICS.map(m => {
      const pairs = R.filter(r => r[m.src][m.key] >= 1).map(r => ({ v: r[m.src][m.key], y: r.score }));
      return { ...m, unit: 'rounds', ...levelTable(pairs, minGroup) };
    });
    const sessions = groupBySession(R);
    const sess = SESSION_METRICS.map(m => {
      const pairs = sessions.filter(g => g.s.pre && g.s.pre[m.key] != null && g.s.pre[m.key] !== '')
        .map(g => ({ v: m.bucket ? sleepBucket(Number(g.s.pre[m.key])) : Number(g.s.pre[m.key]), y: mean(g.rounds.map(r => r.score)) }));
      return { ...m, unit: 'sessions', ...levelTable(pairs, Math.max(4, Math.round(minGroup / 2))) };
    });
    const all = [...round, ...sess];
    const testable = all.filter(x => x.enough);
    const q = bh(testable.map(x => x.test.p));
    testable.forEach((x, i) => { x.q = q[i]; });
    all.forEach(x => { if (x.q === undefined) x.q = 1; });
    return { round, sess };
  }
  function mentalTrend(R) {
    return groupBySession(R).map(g => {
      const f = k => { const v = g.rounds.map(r => r.pre[k]).filter(x => x >= 1); return v.length ? mean(v) : null; };
      const mf = g.rounds.map(r => r.post.mentalFatigue).filter(x => x >= 1);
      return { date: g.date, comp: g.comp, confidence: f('confidence'), focus: f('focus'),
        nerves: g.comp ? (g.s.pre && g.s.pre.nerves ? Number(g.s.pre.nerves) : f('nerves')) : null,
        mentalFatigue: mf.length ? mean(mf) : null };
    });
  }

  // ---------- context ----------
  function roundIndex(R) {
    const out = [1, 2, 3, 4, 5].map(i => { const s = R.filter(r => r.idx + 1 === i).map(r => r.score); return { i, n: s.length, mean: mean(s) }; });
    const S = groupBySession(R).filter(g => g.rounds.length >= 2);
    const d = S.map(g => g.rounds[g.rounds.length - 1].score - g.rounds[0].score);
    const m = mean(d), s = sd(d);
    const t = s ? m / (s / Math.sqrt(d.length)) : 0;
    return { byIndex: out, firstVsLast: { sessions: S.length, meanDiff: m, p: d.length > 2 ? tP(t, d.length - 1) : 1,
      first: mean(S.map(g => g.rounds[0].score)), last: mean(S.map(g => g.rounds[g.rounds.length - 1].score)) } };
  }
  function byContext(R, keyFn) {
    const m = new Map();
    R.forEach(r => { const k = keyFn(r); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(r.score); });
    return [...m.entries()].map(([k, s]) => ({ key: k, n: s.length, mean: mean(s) })).sort((a, b) => b.n - a.n);
  }
  function consecutiveMisses(R) {
    let runs = {};
    R.forEach(r => { let c = 0; r.hits.forEach((h, i) => { if (!h) c++; if (h || i === 24) { if (c) runs[c] = (runs[c] || 0) + 1; c = 0; } }); });
    return runs;
  }

  // ---------- milestones ----------
  function milestones(R, threshold = 23) {
    const f25 = R.find(r => r.score === 25);
    let best = 0, cur = 0, bestIn = 0;
    R.forEach(r => { let c = 0; r.hits.forEach(h => { if (h) { cur++; c++; best = Math.max(best, cur); bestIn = Math.max(bestIn, c); } else { cur = 0; c = 0; } }); });
    let run = 0, bestRun = 0;
    R.forEach(r => { if (r.score >= threshold) { run++; bestRun = Math.max(bestRun, run); } else run = 0; });
    const comp = R.filter(r => r.comp), train = R.filter(r => !r.comp);
    const mx = a => (a.length ? Math.max(...a.map(r => r.score)) : null);
    return {
      first25: f25 ? { date: f25.date, event: f25.event } : null,
      best50: bestWindow(R, 2), best75: bestWindow(R, 3), best100: bestWindow(R, 4), best125: bestWindow(R, 5),
      longestStreak: best, longestInRound: bestIn, roundsAbove: { threshold, best: bestRun },
      comp25: mx(comp), train25: mx(train), comp125: bestWindow(comp, 5), train125: bestWindow(train, 5),
      count25: R.filter(r => r.score === 25).length
    };
  }

  // ---------- improvement ----------
  function improvement(R) {
    const last = R.slice(-50);
    if (last.length < 30) return { enough: false, rounds: last.length };
    const half = Math.floor(last.length / 2);
    const A = presStats(last.slice(0, half)), B = presStats(last.slice(half));
    const rows = SEQ.map((t, i) => { const tp = twoProp(B[i].h, B[i].n, A[i].h, A[i].n); return { ...t, before: A[i], after: B[i], diff: tp.diff, p: tp.p }; });
    const q = bh(rows.map(r => r.p));
    rows.forEach((r, i) => { r.q = q[i]; });
    const lr = linreg(last.map(r => r.score));
    return { enough: true, rounds: last.length, half, rows, trend: lr,
      before: mean(last.slice(0, half).map(r => r.score)), after: mean(last.slice(half).map(r => r.score)) };
  }

  // ---------- pattern flags ----------
  const pct = x => (isFinite(x) ? (x * 100).toFixed(1) + '%' : '–');
  function patterns(R, opts = {}) {
    const minN = opts.minN || 30;
    const out = [];
    const P = presStats(R);
    const overall = R.length ? sum(R.map(r => r.score)) / (R.length * 25) : NaN;
    const T = presStats(R.filter(r => !r.comp)), C = presStats(R.filter(r => r.comp));
    P.forEach((t, i) => {
      if (t.n < minN) return;
      if (t.hi < overall) {
        const tOk = T[i].n >= 10 ? T[i].rate < overall : true;
        const cOk = C[i].n >= 10 ? C[i].rate < overall : true;
        if (tOk && cOk) out.push({ kind: 'technical', title: 'Possible technical pattern', target: t,
          text: `${t.label}: ${pct(t.rate)} across ${t.n} attempts (95% CI ${pct(t.lo)}–${pct(t.hi)}), below your overall ${pct(overall)}.` +
            (T[i].n >= 10 && C[i].n >= 10 ? ` Low in both training (${pct(T[i].rate)}, n=${T[i].n}) and competition (${pct(C[i].rate)}, n=${C[i].n}).` : '') });
      }
    });
    trainVsComp(R).forEach(t => {
      if (t.ok && t.diff >= 0.08 && t.q < 0.1) out.push({ kind: 'competition', title: 'Possible competition-related pattern', target: t,
        text: `${t.label}: ${pct(t.tRate)} in training (n=${t.tN}) vs ${pct(t.cRate)} in competition (n=${t.cN}). Gap ${(t.diff * 100).toFixed(1)} pts, adjusted q=${t.q.toFixed(3)}.` });
    });
    const pm = postMiss(R);
    const np = pm.nextPresentation;
    if (np.n >= 30 && np.obs < np.exp && np.p < 0.05 && pm.missStationsAfterMiss >= 4)
      out.push({ kind: 'concentration', title: 'Possible concentration-related pattern',
        text: `After a miss, the next target was hit ${pct(np.rate)} of the time (n=${np.n}), against ${pct(np.expRate)} expected for those same targets. Follow-up misses spread across ${pm.missStationsAfterMiss} stations, so this is not one hard target.` });
    return out;
  }

  // ---------- insights ----------
  function insights(R, opts = {}) {
    const out = [];
    const need = (cat, msg) => out.push({ cat, empty: true, text: 'Not enough data yet.', need: msg });
    const P = presStats(R);
    const overall = R.length ? sum(R.map(r => r.score)) / (R.length * 25) : NaN;
    // TECHNICAL
    const ranked = P.filter(t => t.n >= 30).sort((a, b) => a.rate - b.rate);
    if (ranked.length) {
      const w = ranked[0];
      out.push({ cat: 'Technical', text: `${w.label} is your lowest-performing target at ${pct(w.rate)} across ${w.n} attempts.`,
        evidence: [`95% CI ${pct(w.lo)}–${pct(w.hi)}`, `Overall hit rate ${pct(overall)} (${R.length} rounds)`,
          w.hi < overall ? 'The whole interval sits below your overall rate.' : 'The interval overlaps your overall rate, so treat this as a lead, not a finding.'] });
    } else need('Technical', 'Needs 30+ attempts per target (about 30 rounds).');
    // COMPETITION
    const tvc = trainVsComp(R).filter(t => t.ok).sort((a, b) => b.diff - a.diff);
    const trR = R.filter(r => !r.comp), coR = R.filter(r => r.comp);
    if (tvc.length && coR.length >= 10) {
      const t = tvc[0];
      const w = welch(trR.map(r => r.score), coR.map(r => r.score));
      out.push({ cat: 'Competition', text: `${t.label}: ${pct(t.tRate)} in training vs ${pct(t.cRate)} in competition, your largest training-to-competition gap.`,
        evidence: [`Training n=${t.tN}, competition n=${t.cN}`, `Adjusted q=${t.q.toFixed(3)} across ${tvc.length} targets compared` + (t.q < 0.1 ? '' : '. Not distinguishable from noise yet.'),
          `Round average: training ${mean(trR.map(r => r.score)).toFixed(2)} (n=${trR.length}) vs competition ${mean(coR.map(r => r.score)).toFixed(2)} (n=${coR.length}), p=${w.p.toFixed(3)}`] });
    } else need('Competition', 'Needs 20+ competition and 20+ training rounds.');
    // MENTAL
    const ck = checkins(R);
    // ratings given after the round can reflect the score itself, so they never headline
    const sig = [...ck.round, ...ck.sess].filter(x => x.enough && !x.after).sort((a, b) => a.q - b.q);
    if (sig.length) {
      const x = sig[0];
      const unit = x.unit;
      out.push({ cat: 'Mental', text: `After recording ${x.label.toLowerCase()} ≤2/5, your average was ${x.low.mean.toFixed(2)} compared with ${x.high.mean.toFixed(2)} when it was ≥4/5.`,
        evidence: [`${x.low.n} ${unit} at ≤2, ${x.high.n} ${unit} at ≥4`, `Adjusted q=${x.q.toFixed(3)} after testing ${sig.length} check-in measures` + (x.q < 0.1 ? '' : '. Could be chance.'),
          x.after ? 'Rated after the round, so the score may have shaped the rating.' : 'Correlation only. It does not show that this state caused the score.'] });
    } else need('Mental', 'Needs 8+ rounds at both ≤2 and ≥4 on at least one check-in.');
    // RESET
    const pm = postMiss(R);
    const np = pm.nextPresentation;
    if (np.n >= 30) {
      const gap = (np.expRate - np.rate) * 100;
      out.push({ cat: 'Reset', text: `On the target immediately after a miss, you hit ${pct(np.rate)}, ${Math.abs(gap).toFixed(1)} pts ${gap > 0 ? 'below' : 'above'} what those same targets usually give you (${pct(np.expRate)}).`,
        evidence: [`${np.n} targets that followed a miss (second barrel of the same double excluded)`, `p=${np.p.toFixed(3)}` + (np.p < 0.05 ? '' : '. Within normal variation.'),
          `Miss→miss ${pm.transitions.MM}, miss→hit ${pm.transitions.MH}`] });
    } else need('Reset', 'Needs 30+ misses followed by a new presentation.');
    // END OF ROUND
    const pr = pressure(R);
    if (pr.finalFiveClean.n >= 50) {
      const f = pr.finalFiveClean;
      out.push({ cat: 'End of round', text: `When clean through 20, you hit ${pct(f.rate)} of the final five targets, against ${pct(f.expRate)} expected from those targets' normal rates.`,
        evidence: [`${pr.conv20.of} rounds reached 20/20, ${pr.conv20.made} became 25s`, `p=${f.p.toFixed(3)}` + (f.p < 0.05 ? '' : '. Within normal variation.'),
          `Raw targets 1–20 ${pct(pr.raw.early.rate)} vs 21–25 ${pct(pr.raw.late.rate)}. 21–25 are the station 4 doubles and station 8, so a raw gap is expected.`] });
    } else need('End of round', 'Needs 10+ rounds that reach 20/20.');
    // IMPROVEMENT
    const im = improvement(R);
    if (im.enough) {
      const mv = im.rows.filter(r => r.before.n >= 10).sort((a, b) => a.q - b.q || b.diff - a.diff)[0];
      if (mv && mv.q < 0.1) {
        out.push({ cat: 'Improvement', text: `Over your last ${im.rounds} rounds, ${mv.label} went from ${pct(mv.before.rate)} to ${pct(mv.after.rate)}.`,
          evidence: [`First ${im.half} vs last ${im.rounds - im.half} rounds (n=${mv.before.n} / ${mv.after.n})`, `Adjusted q=${mv.q.toFixed(3)} across 25 targets`,
            `Round average ${im.before.toFixed(2)} → ${im.after.toFixed(2)}`] });
      } else {
        out.push({ cat: 'Improvement', text: `Over your last ${im.rounds} rounds your average moved ${im.before.toFixed(2)} → ${im.after.toFixed(2)}. No single target has changed by more than normal variation.`,
          evidence: [`First ${im.half} vs last ${im.rounds - im.half} rounds`, `Score trend ${im.trend.slope >= 0 ? '+' : ''}${(im.trend.slope * 10).toFixed(2)} per 10 rounds, p=${im.trend.p.toFixed(3)}`,
            mv ? `Largest target move: ${mv.short} ${pct(mv.before.rate)} → ${pct(mv.after.rate)} (q=${mv.q.toFixed(2)}, not reliable)` : ''].filter(Boolean) });
      }
    } else need('Improvement', `Needs 30+ rounds (you have ${im.rounds}).`);
    return out;
  }

  // ---------- round review ----------
  function roundReview(Rall, sid, idx) {
    const pos = Rall.findIndex(r => r.sid === sid && r.idx === idx);
    if (pos < 0) return null;
    const r = Rall[pos];
    const prev = Rall.slice(Math.max(0, pos - 10), pos);
    const hist = Rall.filter((_, i) => i !== pos);
    const P = presStats(hist);
    const misses = SEQ.filter((t, i) => !r.hits[i]).map(t => ({ ...t, hist: P[t.pos - 1] }));
    let work = null;
    const cand = misses.filter(m => m.hist.n >= 20).sort((a, b) => a.hist.rate - b.hist.rate);
    if (cand.length) work = { target: cand[0], why: `Missed today and ${pct(cand[0].hist.rate)} over ${cand[0].hist.n} earlier attempts` };
    else {
      const w = P.filter(t => t.n >= 30).sort((a, b) => a.rate - b.rate)[0];
      if (w) work = { target: w, why: `Your lowest target overall: ${pct(w.rate)} over ${w.n} attempts` };
      else if (misses.length) work = { target: misses[0], why: 'Missed today. Not enough history yet to rank it.' };
    }
    let obs = null;
    const pm = postMiss(hist);
    const hadFollowMiss = r.hits.some((h, i) => i > 0 && !h && !r.hits[i - 1] && SEQ[i - 1].order !== 1);
    if (hadFollowMiss && pm.nextPresentation.n >= 30 && pm.nextPresentation.p < 0.05 && pm.nextPresentation.obs < pm.nextPresentation.exp)
      obs = `This round had a miss directly after a miss. Historically you hit ${pct(pm.nextPresentation.rate)} on the target after a miss vs ${pct(pm.nextPresentation.expRate)} expected (n=${pm.nextPresentation.n}).`;
    return { r, score: r.score, misses, prevAvg: prev.length ? mean(prev.map(x => x.score)) : null, prevN: prev.length, work, obs };
  }

  const API = { SEQ, VISITS, BY_ID, COMP_TYPES, isComp, flatten, applyFilter, summary, presStats, stationStats, groups, stationTrend,
    trainVsComp, postMiss, pressure, checkins, mentalTrend, roundIndex, byContext, consecutiveMisses, milestones, improvement,
    patterns, insights, roundReview, groupBySession, SLEEP_LABELS, ROUND_METRICS, SESSION_METRICS,
    stats: { mean, sd, wilson, twoProp, bh, welch, pearson, tP, normCdf, obsExp, ibeta } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SK = API;
})(typeof window !== 'undefined' ? window : this);
