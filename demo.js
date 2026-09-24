/* Deterministic example history (clearly labelled as example data in the UI). */
(function (root) {
  'use strict';
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const BASE = { '1H': .97, '1D1': .96, '1D2': .93, '2H': .97, '2D1': .96, '2D2': .92, '3H': .97, '3D1': .95, '3D2': .91,
    '4H': .95, '4L': .9, '5L': .96, '5R1': .95, '5R2': .9, '6L': .97, '6R1': .96, '6R2': .93, '7R1': .98, '7R2': .95,
    '4D1': .94, '4D2': .86, '4R1': .93, '4R2': .82, '8H': .95, '8L': .96 };
  const COMP_DROP = { '5R2': .09, '4R2': .05, '8H': .04 };
  function make(SK, opts = {}) {
    const r = rng(opts.seed || 7);
    const pick = a => a[Math.floor(r() * a.length)];
    const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
    const sessions = [];
    const start = new Date(opts.start || '2026-04-02');
    const ranges = ['Cairo International Shooting Club', 'Smouha Range', 'Lonato (away)'];
    let day = 0;
    for (let s = 0; s < (opts.sessions || 22); s++) {
      day += 3 + Math.floor(r() * 5);
      const d = new Date(start.getTime() + day * 864e5).toISOString().slice(0, 10);
      const comp = s % 4 === 3;
      const type = comp ? (s % 8 === 7 ? 'Competition' : 'Qualification') : (r() < .1 ? 'Test' : 'Training');
      const nR = comp ? 5 : 2 + Math.floor(r() * 3);
      const sleepQ = clamp(3 + (r() - .5) * 3);
      const pre = { sleepH: +(6 + r() * 2.5).toFixed(1), sleepQ, energy: clamp(sleepQ + (r() - .5) * 2), physFatigue: clamp(2 + (r() - .5) * 2),
        confidence: clamp(3.4 + (r() - .5) * 2.5), focus: clamp(3.5 + (r() - .5) * 2), stress: clamp(2.5 + (r() - .5) * 2.5), motivation: clamp(4 + (r() - .5) * 2) };
      if (comp) { pre.nerves = clamp(3.2 + (r() - .5) * 3); pre.pressure = clamp(3.3 + (r() - .5) * 2.5); }
      const rounds = [];
      for (let i = 0; i < nR; i++) {
        const focus = clamp(3.4 + (r() - .5) * 3), conf = clamp(3.4 + (r() - .5) * 3), energy = clamp(3.5 - i * .2 + (r() - .5) * 2);
        const nerves = clamp((comp ? 3 : 1.8) + (r() - .5) * 2.5);
        const mentalAdj = (focus - 3) * .008 + (sleepQ - 3) * .004 - (comp && i === nR - 1 ? .01 : 0);
        let prevMiss = false; const hits = []; const reasons = {};
        SK.SEQ.forEach((t, p) => {
          let pr = BASE[t.id] + mentalAdj - (comp ? (COMP_DROP[t.id] || .005) : 0) - (prevMiss && t.order !== 2 ? .05 : 0);
          const h = r() < Math.min(.995, pr) ? 1 : 0;
          hits.push(h);
          if (!h && r() < .45) reasons[p + 1] = { t: [pick(['Behind target', 'Above', 'Poor visual pickup', 'Rushed shot', 'Movement stopped', 'Poor hold point'])],
            m: r() < .35 ? [pick(['Lost concentration', 'Thinking about score', 'Rushed', 'Frustrated after previous miss'])] : [] };
          prevMiss = !h;
        });
        const score = hits.reduce((a, b) => a + b, 0);
        rounds.push({ hits: hits.join(''), pre: r() < .85 ? { confidence: conf, focus, energy, nerves } : {},
          post: r() < .8 ? { focus: clamp(focus + (score - 23) * .4), confidence: clamp(conf + (score - 23) * .3), mentalFatigue: clamp(2 + i * .4 + (r() - .5) * 2), physFatigue: clamp(2 + i * .3 + (r() - .5) * 2), satisfaction: clamp(score - 20) } : {},
          reasons, notes: {}, note: '', createdAt: start.getTime() + day * 864e5 + i * 1e6 });
      }
      sessions.push({ id: 'demo' + s, demo: true, date: d, type, range: comp ? pick(ranges) : ranges[0], event: comp ? pick(['Egyptian Championship', 'Arab Cup', 'Club Grand Prix']) + ' ' + d.slice(0, 4) : '',
        weather: { cond: pick(['Sunny', 'Sunny', 'Cloudy', 'Hazy']), tempC: 22 + Math.round(r() * 14), wind: pick(['Calm', 'Light', 'Light', 'Moderate', 'Strong']), windDir: pick(['N', 'NE', 'NW', 'W']), light: pick(['Bright', 'Bright', 'Overcast', 'Low sun']) },
        ammo: pick(['24g #9 Fiocchi', '24g #9 RC']), choke: 'Skeet / Skeet', notes: '', pre, rounds, createdAt: start.getTime() + day * 864e5 });
    }
    return sessions;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { make }; else root.SKDemo = { make };
})(typeof window !== 'undefined' ? window : this);
