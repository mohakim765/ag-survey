/* AG Survey: what the daily reports say about each well (status, hours online, downtime cause, targets, factor).
   Works on the sheets from XL.read: every table that has a "WELL NAME" header is read by its column titles. */
(function (root) {
  'use strict';
  // well names: AG-02A = AG 2A = ag_02a; Shadow-E03 = SHADOW E3 …
  function toks(s) {
    s = String(s || '').toUpperCase().replace(/_/g, '-').replace(/X\(A\)/g, 'XA_');
    const out = [];
    for (const p0 of s.match(/[A-Z]+|\d+/g) || []) { const p = /^\d+$/.test(p0) ? String(parseInt(p0, 10)) : p0; if (out.length && /^[A-Z]+$/.test(p) && /^[A-Z]+$/.test(out[out.length - 1])) out[out.length - 1] += p; else out.push(p); }
    return out;
  }
  const key = s => toks(s).join('-');
  function base(s) {
    let t = toks(s), ch = true;
    while (ch && t.length > 2) { ch = false; if (t.length >= 3 && /^H?ST$/.test(t[t.length - 2]) && /^\d+$/.test(t[t.length - 1])) { t = t.slice(0, -2); ch = true; continue; } if (/^(ST|HST|H|X|XA|WSW|WW)$/.test(t[t.length - 1])) { t = t.slice(0, -1); ch = true; } }
    return t.join('-');
  }
  // name -> app well (exact name, the name on the paper, then without ST / H / X / WSW endings when only one well fits)
  function matcher(wells, alias) {
    const byKey = new Map(), byBase = new Map(), byId = new Map(wells.map(w => [w.id, w]));
    for (const w of wells) for (const n of [w.n, w.p]) { if (!n) continue; if (!byKey.has(key(n))) byKey.set(key(n), w); const b = base(n); if (!byBase.has(b)) byBase.set(b, new Set()); byBase.get(b).add(w); }
    return n => { const a = alias && alias[key(n)]; if (a && byId.has(a)) return byId.get(a); const w = byKey.get(key(n)); if (w) return w; const s = byBase.get(base(n)); return s && s.size === 1 ? [...s][0] : null; };
  }
  const HEAD = [['st', /^status$/], ['hrs', /hrs\.?\s*online|operation\s*hrs/], ['cause', /downtime\s*cause/], ['req', /req\.?\s*inj/], ['act', /actual\s*inj/], ['k', /^factor$/], ['opt', /opt\.?\s*inj/], ['lg', /lift\s*gas/]];
  const txt = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const isWell = s => /^[A-Za-z][A-Za-z .'()\-_]{0,20}\d/.test(s) && !/^(total|item|date)/i.test(s);
  const isHead = s => /^well\s*name$/i.test(s);
  function sections(sh) {
    const rows = [...sh.cells.keys()].sort((a, b) => a - b), out = [];
    for (const r of rows) {
      const m = sh.cells.get(r), heads = [...m].filter(([, v]) => isHead(txt(v))).map(([c]) => c).sort((a, b) => a - b);
      heads.forEach((c, i) => {
        const end = heads[i + 1] || c + 40, map = {};
        for (const [cc, v] of m) if (cc > c && cc < end) { const t = txt(v).toLowerCase(); for (const [k, re] of HEAD) if (!(k in map) && re.test(t)) map[k] = cc; }
        if (!Object.keys(map).length) return;
        const got = []; let empty = 0;
        for (const r2 of rows) {
          if (r2 <= r) continue; const mm = sh.cells.get(r2), n = txt(mm.get(c) == null ? '' : String(mm.get(c)));
          if (!n) { if (++empty > 6) break; continue; } empty = 0;
          if (isHead(n) || !isWell(n)) break;
          const o = { n, sheet: sh.name, row: r2 }; for (const k in map) { const v = mm.get(map[k]); if (v !== undefined && v !== '') o[k] = typeof v === 'string' ? v.trim() : v; }
          got.push(o);
        }
        out.push({ sheet: sh.name, row: r, col: c, cols: Object.keys(map), rows: got });
      });
    }
    return out;
  }
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const p2 = n => String(n).padStart(2, '0');
  function fileDate(name) {
    const m = /(\d{1,2})[-_ .]?([A-Za-z]{3})[A-Za-z]*[-_ .]?(\d{4}|\d{2})(?!\d)/.exec(name || ''); if (!m || !MON[m[2].toUpperCase()]) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${p2(MON[m[2].toUpperCase()])}-${p2(+m[1])}`;
  }
  const serialDay = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return d.toISOString().slice(0, 10); };
  // one file: its date, what kind of report it is, and one line per well
  function extract(sheets, fileName) {
    const secs = []; for (const sh of sheets) if (!sh.hidden) secs.push(...sections(sh));
    let date = fileDate(fileName);
    if (!date) for (const s of secs) { const sh = sheets.find(x => x.name === s.sheet); for (const r of [1, 2]) for (const [, v] of sh.cells.get(r) || []) if (!date && typeof v === 'number' && v > 40000 && v < 60000) date = serialDay(v); }
    const has = k => secs.some(s => s.cols.includes(k));
    const kind = has('st') && has('hrs') && secs.some(s => /well data|water flood/i.test(s.sheet)) ? 'oil' : has('k') || has('opt') ? 'gas' : has('st') ? 'status' : 'other';
    return { name: fileName, date, kind, sections: secs.map(s => ({ sheet: s.sheet, row: s.row, cols: s.cols, n: s.rows.length })), rows: secs.flatMap(s => s.rows.map(r => Object.assign(r, { cols: s.cols }))) };
  }
  // the status words of the reports
  const STOP = /^(S\.?\s*\/?\s*I|SHUT[\s-]*IN|P\s*&\s*A|T\.?A\.?|P\.?A\.?)$/i;
  const TYPE = { 'G/L': 'GL', 'GL': 'GL', 'ESP': 'ESP', 'SRP': 'SRP', 'NF': 'NF', 'N.F': 'NF', 'INJ': 'WIW', 'WSW': 'WSW', 'PL': 'PL', 'P.L': 'PL' };
  const num = v => typeof v === 'number' ? v : v == null || v === '' ? null : isNaN(+String(v).replace(/,/g, '')) ? null : +String(v).replace(/,/g, '');
  /* what to do with the files read (o: { files, wells, alias, dt, day, L, h, now, today }):
     close  - stopped in the report, running in the app, shown to the technicians: they get a stop from the start of the report's day
     keep   - stopped in the report, but the app has the well running again after the report's day began: not closed
     (an older report still closes: a well that ran again since then is set running by whoever sees it; stale only warns)
     running- running in the report (hours > 0), stopped in the app
     hidRun - running in the report, hidden from the technicians
     hrs    - hours online in the report and in the app differ by an hour or more (that day)
     types  - the report's lift type is not the app's type
     tg     - target / factor changes (WIW: REQ INJ QTY; Gas Lift: Opt. INJ. GAS and Factor)
     miss   - in the report, not in the app;  absent - shown in the app, not in the report */
  function plan(o) {
    const L = o.L, mt = matcher(o.wells, o.alias), [s0, e0] = L.dayWindow(o.day, o.h), stale = o.day < L.addDays(o.today, -1);
    const hasSt = r => r.cols.includes('st') && r.cols.includes('hrs');
    const oil = o.files.filter(f => f.kind === 'oil'), src = oil.length ? oil : o.files.filter(f => f.rows.some(hasSt));
    // a well can be in two tables (oil wells and water wells): the table that fits the well's type wins
    const st = new Map(), miss = [], water = r => /water|inj|wsw/i.test(r.sheet) || r.cols.includes('req');
    const fits = (w, r) => (w.t === 'WIW' || w.t === 'WSW') === water(r);
    for (const f of src) for (const r of f.rows) {
      if (!hasSt(r)) continue; const w = mt(r.n);
      if (!w) { if (!miss.some(x => key(x.n) === key(r.n))) miss.push(r); continue; }
      const had = st.get(w.id); if (!had || (!fits(w, had.r) && fits(w, r))) st.set(w.id, { w, r });
    }
    const P = { day: o.day, stale, close: [], keep: [], running: [], hidRun: [], hrs: [], types: [], tg: [], miss, absent: [], hidStop: 0, nSt: st.size };
    for (const { w, r } of st.values()) {
      const s = String(r.st == null ? '' : r.st).trim(), stop = STOP.test(s), hrs = num(r.hrs), open = L.openEvent(o.dt, w.id);
      if (stop && !open) {
        if (w.hid) { P.hidStop++; continue; }
        const later = o.dt.filter(e => e.w === w.id && e.e != null && e.e > s0).sort((a, b) => b.e - a.e)[0];
        if (later) P.keep.push({ w, r, e: later }); else P.close.push({ w, r });
      } else if (!stop && hrs > 0) { if (open && open.s < e0 && !w.hid) P.running.push({ w, r, e: open }); if (w.hid) P.hidRun.push({ w, r }); }
      const ty = TYPE[s.toUpperCase()]; if (ty && !w.hid && ty !== w.t && !(ty === 'NF' && w.t === 'PL')) P.types.push({ w, r, ty });
    }
    // hours online on the report's day, with the stops that are about to be added
    if (e0 <= o.now) {
      const dt = o.dt.concat(P.close.map(x => ({ w: x.w.id, s: s0, e: null })));
      for (const { w, r } of st.values()) { if (w.hid) continue; const hrs = num(r.hrs); if (hrs == null) continue; const app = L.uptime(dt, w.id, o.day, o.h, o.now).up; if (Math.abs(app - hrs) >= 1) P.hrs.push({ w, r, app, rep: hrs }); }
    }
    // targets and factors
    const seen = new Set(), ch = (w, f, a, b) => { const k = w.id + f; if (seen.has(k)) return; seen.add(k); if (Math.abs((a ?? 0) - (b ?? 0)) > 1e-9) P.tg.push({ w, f, a: a ?? null, b }); };
    for (const f of o.files) for (const r of f.rows) {
      const w = mt(r.n); if (!w) continue;
      if (r.cols.includes('req') && w.t === 'WIW') { const v = num(r.req); if (v > 0) ch(w, 'tg', w.tg, v); }
      if (w.t === 'GL' && (r.cols.includes('opt') || r.cols.includes('k'))) {
        const t = num(r.opt); if (t > 0) ch(w, 'tg', w.tg, t);
        if (r.cols.includes('k')) { const k = num(r.k); ch(w, 'k', w.k || 0, k > 0 ? k : 0); }
      }
    }
    if (oil.length) P.absent = o.wells.filter(w => !w.hid && !st.has(w.id));
    return P;
  }
  root.REP = { toks, key, base, matcher, sections, extract, fileDate, serialDay, STOP, TYPE, num, plan };
})(typeof self !== 'undefined' ? self : this);
