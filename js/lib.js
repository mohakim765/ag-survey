/* Pure logic: types, fields, production day, uptime, gas calc, checks, export. No DOM here (tested in node). */
(function (root) {
  'use strict';
  const FIELDS = {
    WHP: { l: 'WHP', u: 'psi' }, WHIP: { l: 'WHIP', u: 'psi' }, FLP: { l: 'FLP', u: 'psi' }, CSGP: { l: 'CSGP', u: 'psi' },
    CHK: { l: 'P. Choke', u: '/64' }, SSSV: { l: 'SCSSSV P.', u: 'psi' }, SSV: { l: 'SSV P.', u: 'psi' },
    CSG: { l: 'CSG Status', k: 'csg' },
    AMP: { l: 'Current', u: 'A', s: 'Amp' }, HZ: { l: 'Frequency', u: 'Hz', s: 'Hz' }, PI: { l: 'PI', u: 'psi' }, PD: { l: 'PD', u: 'psi' }, DP: { l: 'DP', u: 'psi' },
    TI: { l: 'Ti', u: '°F' }, TM: { l: 'Tm', u: '°F' },
    RUN: { l: 'Run Time', u: '%', s: 'Run' }, INFO: { l: 'Sam rate', sub: 'info production', u: '', s: 'Sam' }, FILL: { l: 'Pump Fillage', u: '%', s: 'Fill' },
    PSPD: { l: 'Pump Speed', u: '', s: 'Speed' }, PEAK: { l: 'Peak Load', u: '', s: 'Peak' }, MINL: { l: 'Minimum Load', u: '', s: 'Min' },
    FLD: { l: 'Fluid Load', u: '', s: 'Fluid' }, SPM: { l: 'SPM', u: '' },
    DS: { l: 'Downstream P. (DS)', u: 'psi', s: 'DS' }, US: { l: 'Upstream P. (US)', u: 'psi', s: 'US' }, DIFF: { l: 'Diff. P.', u: '', s: 'Diff' },
    TEMP: { l: 'Temperature', u: '°F', s: 'Temp' }, GINJ: { l: 'Gas Injection', u: 'MMSCFD', s: 'Gas' }, INJ: { l: 'Injection Rate', u: 'BWPD', s: 'Inj' },
  };
  const TYPES = {
    NF: { n: 'Natural Flow', f: ['WHP', 'FLP', 'CSGP', 'CHK', 'SSSV', 'SSV'], key: ['WHP', 'FLP'], req: ['WHP', 'FLP'] },
    PL: { n: 'Plunger Lift', f: ['WHP', 'FLP', 'CSGP'], key: ['WHP', 'FLP', 'CSGP'], req: ['WHP', 'CSGP'] },
    ESP: { n: 'ESP', f: ['WHP', 'FLP', 'CSGP', 'CSG', 'AMP', 'HZ', 'PI', 'PD', 'TI', 'TM'], key: ['WHP', 'AMP', 'HZ', 'PI'], req: ['WHP', 'AMP', 'HZ'] },
    SRP: { n: 'SRP', f: ['WHP', 'FLP', 'CSGP', 'CSG', 'RUN', 'INFO', 'FILL', 'PSPD', 'PEAK', 'MINL', 'FLD', 'SPM'], key: ['WHP', 'RUN', 'FILL', 'PSPD'], req: ['WHP', 'RUN', 'INFO', 'FILL', 'PSPD'] },
    WSW: { n: 'WSW', f: ['WHP', 'FLP', 'CSGP', 'CSG', 'AMP', 'HZ', 'PI', 'PD', 'TI', 'TM'], key: ['WHP', 'AMP', 'HZ'], req: ['WHP', 'AMP', 'HZ'] },
    WIW: { n: 'WIW', f: ['WHIP', 'FLP', 'CSGP', 'CSG', 'INJ'], key: ['WHIP', 'INJ'], req: ['WHIP', 'INJ'] },
    GL: { n: 'Gas Lift', f: ['WHIP', 'FLP', 'DS', 'US', 'DIFF', 'TEMP', 'GINJ'], key: ['WHIP', 'DS', 'DIFF', 'GINJ'], req: ['WHIP', 'DS', 'DIFF', 'GINJ'] },
  };
  const CSG = { F: 'Open to flare', P: 'Open to production', C: 'Closed' };
  // a WIW without a scanner: the injection is read with an ultrasonic meter or estimated
  const NOSCAN = 'No scanner', INJM = { U: 'Ultrasonic', E: 'Estimated' };
  const TYPE_ORDER = ['ESP', 'SRP', 'GL', 'NF', 'PL', 'WSW', 'WIW'];
  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  function dist(a, b) { const R = 6371000, p1 = a[1] * Math.PI / 180, p2 = b[1] * Math.PI / 180, dl = (b[0] - a[0]) * Math.PI / 180, dp = p2 - p1; const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  function bearing(a, b) { const p1 = a[1] * Math.PI / 180, p2 = b[1] * Math.PI / 180, dl = (b[0] - a[0]) * Math.PI / 180; const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  const OTHER = 'سبب تاني';
  // short list for the technician; the Excel and the sheet also show the matching AVOCET reason
  const SIMPLE_REASONS = [['Generator صيانة', 'Generator (Planned)'], ['Generator مشكلة', 'Generator (Unplanned)'], ['Wireline', 'Wireline Intervention - Gauging'], ['Treatment', 'Chemical Treatment'], ['Workover', 'Workover'], ['Underload', 'Under Load/Current (ESP DH Electrical)'], ['Overload', 'Over Load/Current (ESP Surface Electrical)'], ['No RPM', 'No RPM'], ['Flowline (مشكلة في الخط)', 'Flowline Failure']];
  const AVOCET = Object.assign(Object.fromEntries(SIMPLE_REASONS), { Other: 'OTHER-COMMENT' });
  const avocet = r => AVOCET[r] || r;
  const INTERMITTENT = 'INTERMITTENT PRODUCTION';

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hhmm = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const stamp = ts => ts ? ymd(new Date(ts)) + ' ' + hhmm(ts) : '';
  function addDays(day, n) { const [y, m, d] = day.split('-').map(Number); return ymd(new Date(y, m - 1, d + n, 12)); }
  // production day: the day that started at `h` o'clock (default 06:00)
  function prodDay(ts, h) { const d = new Date(ts); if (d.getHours() < h) d.setDate(d.getDate() - 1); return ymd(d); }
  function dayWindow(day, h) { const [y, m, d] = day.split('-').map(Number); return [new Date(y, m - 1, d, h).getTime(), new Date(y, m - 1, d + 1, h).getTime()]; }

  const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
  function normNum(s) { return String(s).replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٫,،]/g, '.').replace(/[^\d.\-]/g, ''); }
  function toNum(v) { if (v === '' || v == null) return null; const s = String(v).trim(); return /^-?\d+(\.\d+)?$/.test(s) || /^-?\.\d+$/.test(s) ? Number(s) : null; }

  // Gas injection from orifice readings: Q = sqrt(Diff × (DS + 14.7)) × Factor / 1,000,000  (MMSCFD)
  function gasCalc(k, ds, diff) { ds = toNum(ds); diff = toNum(diff); if (!(k > 0) || ds == null || diff == null || diff < 0 || ds + 14.7 < 0) return null; return Math.sqrt(diff * (ds + 14.7)) * k / 1e6; }
  function gasValue(w, v) { if (!v) return null; if (w.k > 0) return gasCalc(w.k, v.DS, v.DIFF); return toNum(v.GINJ); }
  function gasDiff(w, q, pct) { if (q == null || !(w.tg > 0)) return null; const d = (q - w.tg) / w.tg * 100; return { d: Math.round(d) || 0, bad: Math.abs(d) > pct }; }

  // downtime events: {id, w, s, e|null, r, o, by, src}
  function openEvent(dt, wid) { let x = null; for (const e of dt) if (e.w === wid && !e.e && (!x || e.s > x.s)) x = e; return x; }
  function downMs(dt, wid, a, b) {
    const iv = dt.filter(e => e.w === wid && e.s < b && (e.e == null || e.e > a)).map(e => [Math.max(e.s, a), Math.min(e.e == null ? b : e.e, b)]).sort((x, y) => x[0] - y[0]);
    let tot = 0, cs = null, ce = null;
    for (const [s, e] of iv) { if (cs == null || s > ce) { if (cs != null) tot += ce - cs; cs = s; ce = e; } else ce = Math.max(ce, e); }
    if (cs != null) tot += ce - cs; return tot;
  }
  /* downtime in whole hours, rounded up, as the reports have it (no halves or quarters: an hour and a half down is 2, half an
     hour is 1). A day's stops are added up first, then rounded; under a minute (the seconds of a time written "now") is 0 */
  const wholeH = ms => Math.max(0, Math.ceil((ms - 59999) / 36e5));
  /* hours online for a production day (up to `now` for the current day), the downtime in whole hours. fix: the hours online
     an approved report set for that well and day (a whole day only) */
  function uptime(dt, wid, day, h, now, fix) {
    const [a, b0] = dayWindow(day, h); const b = Math.min(b0, now); if (b <= a) return { up: 0, down: 0, span: 0 };
    const span = (b - a) / 36e5, r1 = v => Math.round(v * 10) / 10;
    if (typeof fix === 'number' && b === b0) { const up = Math.max(0, Math.min(span, fix)); return { up, down: r1(span - up), span: r1(span), fix: 1 }; }
    const down = Math.min(wholeH(downMs(dt, wid, a, b)), Math.ceil(span));
    return { up: r1(Math.max(0, span - down)), down, span: r1(span) };
  }
  /* each stop's share of the whole hours of its day: every stop keeps its whole hours and the hours the rounding added go to
     the stops with the biggest leftover minutes, so a day's stops add up to the day's whole hours (two half hours: 1 and 0) */
  function wholeSplit(parts, total) {
    const fl = parts.map(ms => Math.floor(ms / 36e5)), out = fl.slice(); let left = total - fl.reduce((s, v) => s + v, 0);
    const order = parts.map((ms, i) => [ms / 36e5 - fl[i], i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
    for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
    for (let i = out.length - 1; left < 0 && i >= 0; i--) { const t = Math.min(out[i], -left); out[i] -= t; left += t; }
    return out;
  }
  // the hours online an approved report set for a well and day (the engineer's choice when the report and the app differ)
  const hfixOf = (S, day, wid) => { const x = S.hfix && S.hfix[day] && S.hfix[day][wid]; return x && typeof x.h === 'number' ? x.h : undefined; };
  function reasonsFor() { return [...SIMPLE_REASONS.map(x => x[0]), OTHER]; }

  /* the fields a reading must have for the well to be done (★ in the form). Gas Lift: DS and Diff when the well has a factor,
     the gas reading itself when it is read directly; a disconnected meter needs no gas fields. */
  function reqFields(w, cfg) {
    const T = TYPES[w.t]; if (!T) return [];
    let r = (cfg && cfg.req && Array.isArray(cfg.req[w.t]) ? cfg.req[w.t] : T.req).filter(k => T.f.includes(k));
    if (w.t === 'GL') r = r.filter(k => w.k > 0 ? k !== 'GINJ' : k !== 'DS' && k !== 'DIFF');
    if (w.disc) r = r.filter(k => !['DS', 'DIFF', 'GINJ', 'US'].includes(k));
    return r;
  }
  /* how far the day's reading is: need / have / miss; after = the well ran again at that time, so only values written after
     it count (ft: when each value was written) */
  function progress(w, r, cfg, after) {
    const need = reqFields(w, cfg), v = (r && r.v) || {}, ft = (r && r.ft) || {};
    const fresh = k => !after || (ft[k] || (r && r.t) || 0) >= after;
    const miss = need.filter(k => !(v[k] != null && v[k] !== '' && fresh(k)));
    const any = isDone(r) && (!after || ((r && r.t) || 0) >= after);
    return { need: need.length, have: need.length - miss.length, miss, done: need.length ? !miss.length : any, any };
  }
  function isDone(r) { return !!r && (Object.values(r.v || {}).some(x => x !== '' && x != null) || !!(r.n && r.n.trim())); }
  function summary(w, r) {
    if (!r) return ''; const T = TYPES[w.t]; const ks = T.key.filter(k => r.v && r.v[k] != null && r.v[k] !== '');
    let s = ks.map(k => `${FIELDS[k].s || FIELDS[k].l} ${r.v[k]}`).join(' · ');
    if (w.t === 'GL' && w.k > 0) { const q = gasValue(w, r.v); if (q != null) s += (s ? ' · ' : '') + `Gas ${q.toFixed(3)}`; }
    if (!s && r.n) s = r.n.slice(0, 40); return s;
  }
  // > 30% change against the previous reading of the same field
  function deviations(w, r, prev) {
    const out = {}; if (!r || !prev) return out;
    for (const k of TYPES[w.t].f) { if (FIELDS[k].k) continue; const a = toNum(r.v[k]), b = toNum(prev.v[k]); if (a == null || b == null || b === 0) continue; const d = Math.round((a - b) / Math.abs(b) * 100); if (Math.abs(d) > 30) out[k] = d; }
    return out;
  }
  // the target and factor a reading was written with (they can change later; old days keep theirs)
  function wAt(w, r) { return r && 'wk' in r ? Object.assign({}, w, { k: r.wk || 0, tg: r.wt }) : w; }
  function checks(w, r, prev, cfg) {
    const out = []; if (!r) return out; w = wAt(w, r);
    for (const [k, p] of Object.entries(deviations(w, r, prev))) out.push(`${FIELDS[k].s || FIELDS[k].l} ${p > 0 ? '+' : ''}${p}% عن آخر قراية`);
    if (w.t === 'GL') { const g = gasDiff(w, gasValue(w, r.v), cfg.gasDiffPct); if (g && g.bad) out.push(`الجاز ${g.d > 0 ? '+' : ''}${g.d}% عن التارجت`); }
    if (w.t === 'WIW' && w.tg > 0) { const inj = toNum(r.v.INJ); if (inj != null && inj < 0.8 * w.tg) out.push(`الحقن ${Math.round(inj / w.tg * 100)}% من التارجت`); }
    return out;
  }

  // ---------- export ----------
  // chemicals the admin can put on a well; the technician writes the tank level %
  const CHEMS = [['SCI', 'Scale inhibitor'], ['COR', 'Corrosion inhibitor'], ['DEM', 'Demulsifier'], ['PAR', 'Paraffin (Wax) inhibitor'], ['MEOH', 'Methanol']];
  const CHEM_N = Object.fromEntries(CHEMS), CHEM_MIN = 30;
  const chemMin = (cfg, c) => { const v = cfg && cfg.chemMin && cfg.chemMin[c]; return typeof v === 'number' ? v : CHEM_MIN; };
  const AREA_N = (seed, id) => (seed.areas.find(a => a.id === id) || { n: id }).n;
  function inRange(day, from, to) { return day >= from && day <= to; }
  function exportSheets(S, seed, wells, opt) {
    const h = S.cfg.prodDayStart, now = opt.now || Date.now(), sel = new Set(opt.areas), from = opt.from, to = opt.to;
    const byId = Object.fromEntries(wells.map(w => [w.id, w]));
    const days = Object.keys(S.days).filter(d => inRange(d, from, to)).sort();
    const sheets = [];
    const order = ['NF', 'PL', 'ESP', 'SRP', 'WSW', 'WIW', 'GL'];
    for (const t of order) {
      const fs = TYPES[t].f, extra = t === 'GL' ? ['Metering', 'Factor', 'Gas Inj (MMSCFD)', 'Target (MMSCFD)', 'Diff %'] : t === 'WIW' ? ['Target (BWPD)', '% of target', 'Inj. reading'] : [];
      const rows = [['Prod. Day', 'Area', 'Table', 'Well', 'Status', 'Hours online', ...fs.map(k => (FIELDS[k].sub ? `${FIELDS[k].l} (${FIELDS[k].sub})` : FIELDS[k].l) + (FIELDS[k].u ? ` (${FIELDS[k].u})` : '')), ...extra, 'Comment', 'Technician', 'Time']];
      for (const day of days) {
        const D = S.days[day];
        for (const w of wells) {
          if (w.t !== t || !sel.has(w.a)) continue;
          const r = D.r[w.id], wq = wAt(w, r); const up = uptime(S.dt, w.id, day, h, now, hfixOf(S, day, w.id)); const ev = S.dt.some(e => e.w === w.id && e.s < dayWindow(day, h)[1] && (e.e == null || e.e > dayWindow(day, h)[0]));
          if (!r && !ev) continue;
          const vals = fs.map(k => { const v = r && r.v[k]; if (v == null || v === '') return null; if (FIELDS[k].k === 'csg') return CSG[v] || v; const x = toNum(v); return x == null ? v : x; });
          let ex = [];
          if (t === 'GL') { const q = r ? gasValue(wq, r.v) : null; const g = gasDiff(wq, q, S.cfg.gasDiffPct); ex = [wq.m || (wq.k ? 'Orifice' : ''), wq.k || null, q == null ? null : Math.round(q * 1000) / 1000, wq.tg || null, g ? { v: g.d, warn: g.bad } : null]; }
          if (t === 'WIW') { const inj = r ? toNum(r.v.INJ) : null; ex = [wq.tg || null, wq.tg > 0 && inj != null ? Math.round(inj / wq.tg * 1000) / 10 : null, inj == null ? null : INJM[r.v.INJM] || (wq.m === NOSCAN ? 'Estimated' : 'Scanner')]; }
          const [, de] = dayWindow(day, h), atEnd = Math.min(de, now), downNow = S.dt.some(e => e.w === w.id && e.s <= atEnd && (e.e == null || e.e > atEnd));
          rows.push([{ date: day }, AREA_N(seed, w.a), w.sec, w.n, downNow ? 'Down' : up.down > 0 ? 'Online (partial)' : 'Online', up.up, ...vals, ...ex, r && r.n || '', r && r.byn || '', r ? hhmm(r.t) : '']);
        }
      }
      if (rows.length > 1) sheets.push({ name: TYPES[t].n, rows, widths: [12, 14, 16, 18, 14, 10, ...fs.map(() => 11), ...extra.map(() => 13), 30, 16, 8] });
    }
    // pressures
    const pr = [['Prod. Day', 'Area', 'Point', 'Header', 'Pressure (psi)', 'Technician', 'Time']];
    for (const day of days) for (const p of seed.points) { if (!sel.has(p.a)) continue; const x = S.days[day].p[p.id]; if (!x) continue; for (const hd of p.h) { const v = x.h[hd || '-']; if (v == null || v === '') continue; pr.push([{ date: day }, AREA_N(seed, p.a), p.n, hd, toNum(v) ?? v, x.byn || '', hhmm(x.t)]); } }
    if (pr.length > 1) sheets.push({ name: 'Pressures', rows: pr, widths: [12, 14, 24, 8, 12, 16, 8] });
    // diesel, in the diesel sheet layout
    const ds = [['Prod. Day', 'Area', 'Group', 'Place', 'Wells', 'Well status', 'Tanks', 'Total (L)', 'Tank code', 'Capacity (L)', 'Level %', 'Technician', 'Time']];
    for (const day of days) {
      const [, end] = dayWindow(day, h);
      for (const t of seed.tanks) {
        if (!sel.has(t.a)) continue; const x = S.days[day].d[t.id]; if (!x) continue;
        const same = seed.tanks.filter(q => q.place === t.place && q.a === t.a);
        const st = t.w.map(id => openEvent(S.dt.filter(e => e.s < end), id) ? 'SI' : 'Flowing').join(' / ');
        const lv = toNum(x.v);
        ds.push([{ date: day }, AREA_N(seed, t.a), t.grp || '', t.place, t.w.map(id => byId[id] ? byId[id].n : id).join(' + '), st, same.length, same.reduce((s, q) => s + (q.cap || 0), 0) || null, t.code || 'NA', t.cap || null, lv == null ? null : { v: lv, warn: lv < S.cfg.dieselMin }, x.byn || '', hhmm(x.t)]);
      }
    }
    // chemicals: tank level, refill time, drums on the well and consumption per chemical on each well
    const cr = [['Prod. Day', 'Area', 'Well', 'Well type', 'Chemical', 'Level %', 'Alarm below %', 'Refill time', 'Drums', 'Consumption (L/day)', 'Technician', 'Time']];
    for (const day of days) {
      const C = S.days[day].c || {};
      for (const wid in C) {
        const w = byId[wid], x = C[wid]; if (!w || !sel.has(w.a)) continue;
        const codes = [...new Set(['v', 'f', 'dr', 'rt'].flatMap(p => Object.keys(x[p] || {})))];
        for (const code of codes) { const g = p => (x[p] || {})[code] ?? '', lv = toNum(g('v')), mn = chemMin(S.cfg, code), dr = toNum(g('dr')), rt = toNum(g('rt'));
          if (lv == null && !g('f') && dr == null && rt == null) continue;
          cr.push([{ date: day }, AREA_N(seed, w.a), w.n, w.t, CHEM_N[code] || code, lv == null ? null : { v: lv, warn: lv < mn }, mn, g('f'), dr, rt, x.byn || '', x.t ? hhmm(x.t) : '']); }
      }
    }
    if (cr.length > 1) sheets.push({ name: 'Chemicals', rows: cr, widths: [12, 14, 18, 8, 24, 9, 11, 10, 8, 12, 16, 8] });
    if (ds.length > 1) sheets.push({ name: 'Diesel', rows: ds, widths: [12, 14, 18, 18, 20, 12, 7, 10, 10, 11, 9, 16, 8] });
    // downtime
    const [a0] = dayWindow(from, h), [, b0] = dayWindow(to, h);
    // (each stop's hours: its share of the whole hours of each day it touches, so a well's day adds up to the day's downtime)
    const dr = [['Well', 'Area', 'Type', 'Reason', 'AVOCET reason', 'Details', 'From', 'To', 'Hours (in range)', 'Recorded by', 'Source']];
    const evs = S.dt.filter(e => byId[e.w] && sel.has(byId[e.w].a) && e.s < b0 && (e.e == null || e.e > a0)).sort((x, y) => x.s - y.s);
    const share = new Map(evs.map(e => [e, 0])), byW = new Map();
    for (const e of evs) { if (!byW.has(e.w)) byW.set(e.w, []); byW.get(e.w).push(e); }
    for (const [wid, es] of byW) for (let d = from; d <= to; d = addDays(d, 1)) {
      const [s, e0] = dayWindow(d, h), b = Math.min(e0, now); if (b <= s) continue;
      const part = es.map(e => Math.max(0, Math.min(e.e == null ? b : e.e, b) - Math.max(e.s, s))); if (!part.some(Boolean)) continue;
      const sp = wholeSplit(part, wholeH(downMs(es, wid, s, b))); es.forEach((e, i) => share.set(e, share.get(e) + sp[i]));
    }
    for (const e of evs) {
      const w = byId[e.w];
      dr.push([w.n, AREA_N(seed, w.a), w.t, e.r, avocet(e.r), e.o || '', stamp(e.s), e.e ? stamp(e.e) : 'لسه واقف', share.get(e), e.byn || '', e.src === 'int' ? 'تشغيل متقطع' : e.src === 'maint' ? 'صيانة' : e.src === 'job' ? 'شغل على البير' : e.src === 'rep' ? 'التقرير' : 'الفني']);
    }
    if (dr.length > 1) sheets.push({ name: 'Downtime', rows: dr, widths: [18, 14, 7, 24, 30, 26, 16, 16, 10, 16, 12] });
    // hours online per well per day
    const ho = [['Prod. Day', 'Area', 'Well', 'Type', 'Hours online', 'Hours down', 'Note']];
    for (const day of days) for (const w of wells) { if (!sel.has(w.a) || w.hid) continue; const u = uptime(S.dt, w.id, day, h, now, hfixOf(S, day, w.id)); if (u.span === 0) continue; ho.push([{ date: day }, AREA_N(seed, w.a), w.n, w.t, u.up, u.down, u.fix ? 'الساعات اتعدلت من التقرير' : '']); }
    if (ho.length > 1) sheets.push({ name: 'Hours online', rows: ho, widths: [12, 14, 18, 7, 12, 11, 24] });
    // samples
    const sm = [['Prod. Day', 'Time', 'Point', 'Area', 'Sample', 'Taken by', 'Technician', 'Comment']];
    for (const s of S.samples) { if (!inRange(s.day, from, to)) continue; const w = byId[s.w]; if (w && !sel.has(w.a)) continue; sm.push([{ date: s.day }, hhmm(s.ts), w ? w.n : s.pt, w ? AREA_N(seed, w.a) : '', ({ W: 'Water', D: 'Diesel' })[s.kind] || 'Oil', s.who, s.byn || '', s.n || '']); }
    if (sm.length > 1) sheets.push({ name: 'Samples', rows: sm, widths: [12, 7, 22, 14, 8, 14, 16, 30] });
    if (opt.audit) {
      const au = [['When', 'User', 'Prod. Day', 'What', 'Field', 'Old', 'New', 'Reason']];
      for (const x of S.audit) { if (!inRange(x.day || '', from, to)) continue; au.push([stamp(x.ts), x.byn || x.by, x.day ? { date: x.day } : '', x.refn || x.ref, x.f || '', x.a ?? '', x.b ?? '', x.why || '']); }
      if (au.length > 1) sheets.push({ name: 'Audit log', rows: au, widths: [16, 16, 12, 22, 16, 12, 12, 30] });
    }
    return sheets;
  }

  // a person removed from the app is known only by this hash of the user name (so the name is not kept anywhere)
  function uhash(x) {
    const s = 'wsuser:' + String(x || '').toLowerCase(); let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  const api = { NOSCAN, INJM, reqFields, progress, wAt, uhash, CHEMS, CHEM_N, CHEM_MIN, chemMin, FIELDS, TYPES, CSG, TYPE_ORDER, SIMPLE_REASONS, avocet, natural, dist, bearing, OTHER, INTERMITTENT, ymd, hhmm, stamp, addDays, prodDay, dayWindow, normNum, toNum, gasCalc, gasValue, gasDiff, openEvent, downMs, wholeH, wholeSplit, hfixOf, uptime, reasonsFor, isDone, summary, deviations, checks, exportSheets };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.L = api;
})(typeof self !== 'undefined' ? self : this);
