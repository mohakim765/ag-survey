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
    const loose = n => base(n).replace(/([A-Z])\1+/g, '$1'), byLoose = new Map();
    for (const w of wells) for (const n of [w.n, w.p]) { if (!n) continue; const l = loose(n); if (!byLoose.has(l)) byLoose.set(l, new Set()); byLoose.get(l).add(w); }
    return n => {
      for (const k of [key(n), base(n)]) { const a = alias && alias[k]; if (a && byId.has(a)) return byId.get(a); }
      const w = byKey.get(key(n)); if (w) return w; const s = byBase.get(base(n)); if (s && s.size === 1) return [...s][0];
      const l = byLoose.get(loose(n)); return l && l.size === 1 ? [...l][0] : null;   // a name spelled with one letter doubled or not, only when one well fits
    };
  }
  const HEAD = [['st', /^status$/], ['hrs', /hrs\.?\s*online|operation\s*hrs/], ['cause', /downtime\s*cause/], ['req', /req\.?\s*inj/], ['act', /actual\s*inj/], ['k', /^factor$/], ['opt', /opt\.?\s*inj/], ['lg', /lift\s*gas/], ['def', /defer'?r?e?d\s*prod/], ['eop', /est\.?\s*oil\s*prod/]];
  // under "LAST WELL TEST": DATE, BFPD, BS&W %, MMSCFD, BOPD
  const SUB = [['td', /^date$/], ['tbf', /^bfpd$/], ['twc', /^bs\s*&\s*w/], ['tgas', /^mmscfd$/], ['tbo', /^bopd$/]];
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
        const lt = [...m].find(([cc, v]) => cc > c && cc < end && /last\s*well\s*test/i.test(txt(v)));
        if (lt) { const m2 = sh.cells.get(r + 1) || new Map(); for (const [cc, v] of m2) if (cc >= lt[0] && cc < lt[0] + 8) { const t = txt(v).toLowerCase(); for (const [k, re] of SUB) if (!(k in map) && re.test(t)) map[k] = cc; } }
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
  /* the engineering report's well tests ("Updated Well Test Data", "Gas Wells", "APOLLONIA"): the last test of each well,
     and today's hours, actual production, barrels lost and status (the tests tab has "running well status Today") */
  const TCOL = [['d', /^date$/], ['ts', /^status$/], ['bfpd', /^bfpd$/], ['wc', /^w\.?\s*c\.?\s*%?$/], ['bopd', /^(bopd|bcpd)$/], ['gas', /^t\.?\s*ass\.?\s*gas/],
    ['ig', /^inj\.?\s*gas/], ['hrs', /^oper\.?\s*hrs\.?\s*(td)?$/], ['act', /^(bopd|bcpd)\s*a?c?t?u?al/], ['diff', /^(bbls|bcpd)\s*diff/], ['stT', /running\s*well\s*status\s*today/], ['dn', /^down\s*time\s*today/], ['rem', /^remarks?$/]];
  function engTests(sheets) {
    const out = [];
    for (const sh of sheets) {
      if (sh.hidden || !/updated\s*well\s*test|gas\s*wells|apollonia/i.test(sh.name)) continue;
      const gasTab = /gas\s*wells|apollonia/i.test(sh.name);
      const rows = [...sh.cells.keys()].sort((a, b) => a - b), hr = rows.find(r => r <= 6 && /^(open\s*)?wells?$/i.test(txt(String((sh.cells.get(r) || new Map()).get(1) || ''))));
      if (!hr) continue;
      const map = {}; for (const [c, v] of sh.cells.get(hr)) { const t = txt(String(v)).toLowerCase(); for (const [k, re] of TCOL) if (!(k in map) && re.test(t)) map[k] = c; }
      for (const r of rows) {
        if (r <= hr) continue; const m = sh.cells.get(r), n = txt(String(m.get(1) == null ? '' : m.get(1)));
        if (!n || !isWell(n) || /total|field/i.test(n)) continue;
        const o = { n, sheet: sh.name.trim(), row: r }; for (const k in map) { const v = m.get(map[k]); if (v !== undefined && v !== '') o[k] = typeof v === 'string' ? txt(v) : v; }
        if (typeof o.d === 'number' && o.d > 30000 && o.d < 80000) o.d = serialDay(o.d); else delete o.d;
        if (gasTab) {   // a gas well: today's status is in column 39 (no title); without it, the hours of the day say it
          o.gt = 1; const c39 = m.get(39);
          if (o.stT == null || o.stT === '') { const h = num(o.hrs); if (typeof c39 === 'string' && c39.trim()) o.stT = txt(c39); else if (h != null) o.stT = h > 0 ? 'G.W' : 'S.I'; }
        }
        out.push(o);
      }
    }
    return out;
  }
  // "[9] Work Over Activity", "[10] Drilling activity", "[11] Rigless Operation" of the daily activity tab
  function engAct(sh) {
    const rows = [...sh.cells.keys()].sort((a, b) => a - b), out = { wo: [], drill: [], dnext: [], rigless: [] };
    const cell = (r, c) => { const v = (sh.cells.get(r) || new Map()).get(c); return v == null ? '' : txt(String(v)); };
    let sec = 0, cur = null, blk = [];
    for (const r of rows) {
      const t = cell(r, 1), m = /^\[\s*(\d+)\s*\]/.exec(t);
      if (m) { sec = +m[1]; cur = null; blk = []; continue; }
      const g = /^[●•]\s*(.+?)\s*(?:\(\s*([^)]+?)\s*\))?\s*$/.exec(t);
      if (sec === 9) {
        if (g && g[2] && isWell(g[1])) { cur = { n: g[1], rig: g[2], fm: cell(r, 5), pfm: cell(r, 10), plan: cell(r, 14), next: [] }; out.wo.push(cur); continue; }
        if (!cur) continue;
        if (/^operation$/i.test(t)) cur.op = cell(r, 2);
        else if (/^well\s*plan$/i.test(t)) { cur.job = cell(r, 2); for (const c of [14, 18, 22]) { const n = cell(r, c); if (n && n !== '0') cur.next.push({ n, c }); } }
        else if (/^expected\s*rig\s*release/i.test(t)) {
          const v = num((sh.cells.get(r) || new Map()).get(2)); if (v > 30000 && v < 80000) cur.rel = serialDay(v);
          for (const x of cur.next) { const j = cell(r, x.c); if (j && j !== '0') x.job = j; }
          for (const c of [6, 7]) { const v2 = num((sh.cells.get(r) || new Map()).get(c)); if (v2 > 0 && !cur.gain) cur.gain = v2; }
        }
      } else if (sec === 10) {
        const row = sh.cells.get(r) || new Map(), cols = [...row.keys()].filter(c => c > 1 && cell(r, c)).sort((a, b) => a - b);
        if (/^rig$/i.test(t)) { blk = cols.map(c => ({ rig: cell(r, c), c })); out.drill.push(...blk); }
        else if (/^well\s*\/?\s*target$/i.test(t)) blk.forEach(b => b.well = cell(r, b.c));
        else if (/^work\s*done$/i.test(t)) blk.forEach(b => b.done = cell(r, b.c));
        else if (/^next\s*wells?$/i.test(t)) for (const c of cols) out.dnext.push(cell(r, c));
      } else if (sec === 11) {
        if (g && !/^remarks?/i.test(g[1])) { cur = { n: g[1], what: g[2] || '', fm: cell(r, 5) }; out.rigless.push(cur); continue; }
        if (!cur) continue;
        if (/^operation$/i.test(t)) { cur.op = cell(r, 2); cur.plan = cell(r, 14); }
        else if (/^well\s*plan$/i.test(t)) cur.job = cell(r, 2);
      }
    }
    out.wo.forEach(x => x.next.forEach(y => delete y.c)); out.drill.forEach(x => delete x.c);
    return out;
  }
  // the engineering report's "[9] Work Over Activity": "● <well> (EDC-…)", then its "Operation" line
  function rigWells(sh) {
    const rows = [...sh.cells.keys()].sort((a, b) => a - b), out = []; let on = false;
    for (const r of rows) {
      const m = sh.cells.get(r), t = txt(m.get(1) == null ? '' : String(m.get(1)));
      if (/^\[\s*9\s*\]/.test(t) && /work\s*over/i.test(t)) { on = true; continue; }
      if (!on) continue; if (/^\[\s*\d+\s*\]/.test(t)) break;
      const g = /^[●•]\s*(.+?)\s*\(\s*([^)]+?)\s*\)/.exec(t);
      if (g && isWell(g[1])) out.push({ n: g[1], rig: g[2], row: r });
      else if (out.length && /^operation$/i.test(t)) out[out.length - 1].op = txt(String(m.get(2) == null ? '' : m.get(2))).slice(0, 80);
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
    const eng = sheets.find(s => /dist\.?\s*eng/i.test(s.name));
    const kind = eng ? 'eng' : has('st') && has('hrs') && secs.some(s => /well data|water flood/i.test(s.sheet)) ? 'oil' : has('k') || has('opt') ? 'gas' : has('st') ? 'status' : 'other';
    return { name: fileName, date, kind, rig: eng ? rigWells(eng) : [], tst: eng ? engTests(sheets) : [], act: eng ? engAct(eng) : null, sections: secs.map(s => ({ sheet: s.sheet, row: s.row, cols: s.cols, n: s.rows.length })), rows: secs.flatMap(s => s.rows.map(r => Object.assign(r, { cols: s.cols }))) };
  }
  // the status words of the reports
  const STOP = /^(S\.?\s*\/?\s*I|SHUT[\s-]*IN|P\s*&\s*A|T\.?A\.?|P\.?A\.?)$/i;
  const TYPE = { 'G/L': 'GL', 'GL': 'GL', 'ESP': 'ESP', 'SRP': 'SRP', 'NF': 'NF', 'N.F': 'NF', 'INJ': 'WIW', 'WSW': 'WSW', 'PL': 'PL', 'P.L': 'PL' };
  const num = v => typeof v === 'number' ? v : v == null || v === '' ? null : isNaN(+String(v).replace(/,/g, '')) ? null : +String(v).replace(/,/g, '');
  /* what to do with the files read (o: { files, wells, alias, dt, day, L, h, now, today, ty }):
     A row counts for a well only when its table fits the well's type: the Gas Lift sheet for Gas Lift wells, the water tables
     for WIW / WSW, the oil wells' tables for the rest. The same name can be an old well in one sheet and a new one in another.
     ask    - the engineer says whether the type changed: the well is only in tables of another type (then nothing is done
              from them until he says it changed), or the status says another lift type. o.ty = { wellId: new type }
     dup    - the same well twice in tables of its type, one stopped and one running, or with two targets: nothing is done
     xs     - the production and the engineering reports (same day) disagree whether the well is stopped (on a rig counts
              as stopped): nothing is closed until the engineer says "close it" (o.xs = { wellId: 'close' })
     xd     - other differences between the two: hours, lift gas, lift type, a well only in the engineering report
     xdate  - the two reports are not of the same day: they are not compared
     close  - stopped in the report, running in the app, shown to the technicians: they get a stop from the start of the report's
              day, or from the end of the well's last stop in that day (from)
     keep   - stopped in the report, but the app has the well running again after the report's day ended (newer): not closed
     (an older report still closes: a well that ran again since then is set running by whoever sees it; stale only warns)
     running- running in the report (hours > 0), stopped in the app since before the report's day ended: the stop ends (at), at
              the start of the report's day (or when it stopped) plus the hours the report says it was down
     hidRun - running in the report, hidden from the technicians
     hrs    - hours online in the report and in the app differ by an hour or more (that day)
     tg     - target / factor changes (WIW: REQ INJ QTY; Gas Lift: Opt. INJ. GAS and Factor)
     miss   - in the report, not in the app;  absent - shown in the app, not in the report */
  const WATER = t => t === 'WIW' || t === 'WSW';
  const stOf = r => String(r.st == null ? '' : r.st).trim();
  const isWater = r => /water|inj|wsw/i.test(r.sheet) || r.cols.includes('req');
  const tableOf = r => r.fk === 'gas' ? 'gas' : isWater(r) ? 'water' : 'oil';   // the gas sheet first: its name has "Injection" in it
  const fitsT = (t, r) => { if (r.rig) return true; const k = tableOf(r); return k === 'water' ? WATER(t) : k === 'gas' ? t === 'GL' : !WATER(t); };
  const isStop = r => !!r.rig || STOP.test(stOf(r));
  const r2 = v => Math.round(v * 100) / 100;
  const desc = r => r.rig ? 'على الحفار ' + r.rig : `${stOf(r) || '—'}${num(r.hrs) != null ? ' ' + num(r.hrs) + ' ساعة' : ''}`;
  // the type the table says: the Gas Lift sheet -> GL, a water table -> INJ / WSW, an oil table -> the status (G/L, ESP …) or lift gas
  const guess = r => {
    const k = tableOf(r), s = TYPE[stOf(r).toUpperCase()];
    if (k === 'gas') return 'GL'; if (k === 'water') return s && WATER(s) ? s : 'WIW';
    return s && !WATER(s) ? s : num(r.lg) > 0 ? 'GL' : null;
  };
  function plan(o) {
    const L = o.L, ty = o.ty || {}, xs = o.xs || {}, [s0, e0] = L.dayWindow(o.day, o.h), stale = o.day < L.addDays(o.today, -1);
    const wells = o.wells.map(w => ty[w.id] && ty[w.id] !== w.t ? Object.assign({}, w, { t: ty[w.id], t0: w.t }) : w);
    const mt = matcher(wells, o.alias);
    o.files.forEach((f, i) => f.rows.forEach(r => { r.fk = f.kind; r.fi = i; }));
    const hasSt = r => r.cols.includes('st') && r.cols.includes('hrs');
    // the wells on the work-over rigs count as stopped rows of the engineering report
    const engRows = f => (f.tst || []).filter(t => t.stT != null && t.stT !== '').map(t => ({ n: t.n, st: t.stT, hrs: num(t.hrs) == null ? 0 : num(t.hrs), cause: '', sheet: t.sheet, row: t.row, cols: ['st', 'hrs'], fk: 'eng', gt: t.gt, fi: o.files.indexOf(f) }));
    const rowsOf = f => (f.kind === 'eng' ? engRows(f) : f.rows).concat((f.rig || []).map(g => ({ n: g.n, st: 'W.O', hrs: 0, cause: 'Workover ' + g.rig, sheet: 'Work Over', row: 'rig' + g.row, cols: ['st', 'hrs', 'cause'], rig: g.rig, fk: f.kind, fi: o.files.indexOf(f) })));
    // status: the production report; without it, any file with a status and hours (the engineering report, the Gas Lift sheet)
    const oil = o.files.filter(f => f.kind === 'oil'), engs = o.files.filter(f => f.kind === 'eng');
    const src = oil.length ? oil : o.files.filter(f => (f.rig || []).length || f.rows.some(hasSt));
    /* gas wells (NF wells in the engineering report's "Gas Wells" / "APOLLONIA" tabs): the production report is an oil report
       and writes them SI; their status comes from the engineering report only. Without it, the list kept from the last one. */
    const gasNow = new Set(); for (const f of engs) for (const t of f.tst || []) if (t.gt) { const w = mt(t.n); if (w && (w.t0 || w.t) === 'NF') gasNow.add(w.id); }
    const G = gasNow.size ? gasNow : new Set(o.gasw || []);
    const oD0 = oil.map(f => f.date).filter(Boolean).sort().pop(), eD0 = engs.map(f => f.date).filter(Boolean).sort().pop(), sameDay = !(oD0 && eD0 && oD0 !== eD0);
    // every row of each well (a table read twice through two headers on one line is one row)
    const group = (files, miss, onlyGas) => {
      const by = new Map();
      for (const f of files) for (const r of rowsOf(f)) {
        if (!hasSt(r)) continue; const w = mt(r.n);
        if (!w) { if (miss && !miss.some(x => key(x.n) === key(r.n))) miss.push(r); continue; }
        if (G.has(w.id) ? !(r.fk === 'eng' && (r.gt || r.rig)) : onlyGas) continue;   // gas wells: only the engineering report's gas tabs (and its rigs)
        const g = by.get(w.id) || by.set(w.id, { w, rows: [] }).get(w.id);
        if (!g.rows.some(x => x.fi === r.fi && x.sheet === r.sheet && x.row === r.row)) g.rows.push(r);
      }
      return by;
    };
    const miss = [], by = group(src, miss);
    let gasSkip = 0; if (!(oil.length && engs.length && sameDay)) for (const f of oil) for (const r of f.rows) { const w = hasSt(r) && mt(r.n); if (w && G.has(w.id) && STOP.test(stOf(r))) gasSkip++; }
    if (oil.length && engs.length && sameDay) for (const [id, g] of group(engs, null, true)) by.set(id, g);   // the gas wells' status, from the engineering report
    const P = { day: o.day, stale, ask: [], dup: [], xs: [], xd: [], xdate: null, tests: [], defm: {}, eng: null, gasSkip, gas: G.size, close: [], keep: [], running: [], hidRun: [], hrs: [], tg: [], miss, absent: [], hidStop: 0, nSt: by.size };
    const st = new Map();
    for (const { w, rows } of by.values()) {
      const t0 = w.t0 || w.t, set = ty[w.id] && ty[w.id] !== t0 ? ty[w.id] : null, fit0 = rows.filter(r => fitsT(t0, r));
      let ask = null;
      if (!fit0.length) ask = { why: 'table', r: rows[0], ty: set || guess(rows[0]) };
      else { const r = fit0[0], sty = TYPE[stOf(r).toUpperCase()]; if (sty && sty !== t0 && !(sty === 'NF' && t0 === 'PL')) ask = { why: 'status', r, ty: set || sty }; }
      if (ask && !w.hid) P.ask.push(Object.assign(ask, { w, from: t0, set }));
      if (ask && ask.why === 'table' && !set) continue;   // only in tables of another type: nothing is done until the type is confirmed
      const use = rows.filter(r => fitsT(w.t, r)); if (!use.length) continue;
      const stops = use.map(isStop);
      if (stops.some(Boolean) && !stops.every(Boolean)) { if (!w.hid) P.dup.push({ w, rows: use }); continue; }
      st.set(w.id, { w, r: use.find(r => num(r.hrs) != null) || use[0] });
    }
    /* the production report against the engineering report (same day only): the status they disagree on is asked
       (o.xs = { wellId: 'close' }; until then nothing is closed from either), the rest is listed */
    const xsm = new Map(), oD = oil.map(f => f.date).filter(Boolean).sort().pop(), eD = engs.map(f => f.date).filter(Boolean).sort().pop();
    if (oil.length && engs.length && oD && eD && oD !== eD) P.xdate = { oil: oD, eng: eD };
    else if (oil.length && engs.length) {
      const elg = new Map(); for (const f of engs) for (const r of f.rows) if (r.cols.includes('lg')) { const w = mt(r.n); if (w && !elg.has(w.id)) elg.set(w.id, num(r.lg)); }
      for (const { w, rows } of group(engs, null).values()) {
        if (w.hid || G.has(w.id)) continue;
        const re = rows.find(r => r.rig) || rows.find(r => fitsT(w.t, r)); if (!re) continue;
        const u = st.get(w.id), rp = u ? u.r : null;
        if (!rp && by.has(w.id)) continue;   // in the production report, but its rows wait for a question
        const sp = rp ? isStop(rp) : false, se = isStop(re);
        if (!rp && !se) { P.xd.push({ w, x: 'في تقرير الهندسية بس: ' + desc(re) }); continue; }
        if (sp !== se) { const c = { w, rp, re, prodStop: sp, set: xs[w.id] === 'close' ? 'close' : null }; P.xs.push(c); xsm.set(w.id, c); continue; }
        const d = [];
        if (!sp) {
          const hp = num(rp.hrs), he = num(re.hrs); if (hp != null && he != null && Math.abs(hp - he) >= 1) d.push(`الساعات: الإنتاج ${hp} · الهندسية ${he}`);
          const gp = num(rp.lg), ge = elg.get(w.id); if (gp > 0 && ge > 0 && Math.abs(gp - ge) >= 0.05) d.push(`Lift gas: الإنتاج ${r2(gp)} · الهندسية ${r2(ge)}`);
          const tp = TYPE[stOf(rp).toUpperCase()], te = TYPE[stOf(re).toUpperCase()]; if (tp && te && tp !== te) d.push(`النوع: الإنتاج ${stOf(rp)} · الهندسية ${stOf(re)}`);
        }
        if (d.length) P.xd.push({ w, x: d.join(' · ') });
      }
    }
    const closeOrKeep = (w, r) => {
      if (w.hid) { P.hidStop++; return; }
      const later = o.dt.filter(e => e.w === w.id && e.e != null && e.e > s0).sort((a, b) => b.e - a.e)[0];
      if (later && later.e > e0) P.keep.push({ w, r, e: later }); else P.close.push({ w, r, from: later ? later.e : s0 });
    };
    for (const { w, r } of st.values()) {
      const c = xsm.get(w.id), stop = c ? c.set === 'close' : isStop(r), hrs = num(r.hrs), open = L.openEvent(o.dt, w.id);
      if (stop && !open) closeOrKeep(w, c && !c.prodStop ? c.re : r);
      else if (!stop && hrs > 0) {
        if (open && open.s < e0 && !w.hid) { const at = Math.min(e0, o.now, Math.max(open.s, s0) + Math.max(0, 24 - Math.min(hrs, 24)) * 3600000); P.running.push({ w, r, e: open, at: Math.max(at, open.s) }); }
        if (w.hid) P.hidRun.push({ w, r });
      }
    }
    // stopped only in the engineering report (on a rig), not in the production report: closed when the engineer says so
    for (const c of P.xs) if (!c.rp && c.set === 'close' && !L.openEvent(o.dt, c.w.id)) closeOrKeep(c.w, c.re);
    /* each oil well's newest test (the engineering report's when both have the same date); kept when newer than the one
       the app has. Same date with another BOPD is listed. */
    const tc = new Map(), tOf = w => tc.get(w.id) || tc.set(w.id, { w }).get(w.id);
    for (const f of engs) for (const t of f.tst || []) {
      if (!t.d || num(t.bopd) == null) continue; const w = mt(t.n); if (!w || WATER(w.t)) continue;
      const c = tOf(w); if (!c.eng || t.d > c.eng.d) c.eng = { d: t.d, bopd: num(t.bopd), bfpd: num(t.bfpd), wc: num(t.wc), gas: num(t.gas), src: 'eng' };
    }
    for (const f of oil) for (const r of f.rows) {
      if (r.tbo == null || typeof r.td !== 'number' || r.td < 30000) continue; const w = mt(r.n); if (!w || WATER(w.t) || G.has(w.id)) continue;
      const d = serialDay(r.td), c = tOf(w); if (!c.prod || d > c.prod.d) c.prod = { d, bopd: num(r.tbo), bfpd: num(r.tbf), wc: num(r.twc), gas: num(r.tgas), src: 'prod' };
      const v = num(r.def); if (v > 0 && !(w.id in P.defm)) P.defm[w.id] = r2(v);
    }
    const xdAdd = (w, x) => { const d = P.xd.find(y => y.w.id === w.id); if (d) d.x += ' · ' + x; else P.xd.push({ w, x }); };
    for (const c of tc.values()) {
      const e = c.eng, p = c.prod, pick = !p ? e : !e ? p : e.d >= p.d ? e : p;
      if (e && p && e.d === p.d && Math.abs((e.bopd || 0) - (p.bopd || 0)) > 0.5 && !c.w.hid && !P.xdate) xdAdd(c.w, `التست (${e.d}): الإنتاج ${r2(p.bopd)} · الهندسية ${r2(e.bopd)} برميل`);
      if (G.has(c.w.id)) pick.gw = 1;
      const old = (o.tests || {})[c.w.id];
      if (!old || !old.gw !== !pick.gw || (pick.d >= old.d && (old.d !== pick.d || old.src !== pick.src || Math.abs((old.bopd || 0) - (pick.bopd || 0)) > 1e-6))) P.tests.push(Object.assign({ w: c.w }, pick));
    }
    // Rig & Rigless of the newest engineering report, with the app's wells it names
    const ef = engs.filter(f => f.act).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    if (ef) {
      const id = n => { const w = mt(n); return w ? w.id : ''; }, a = ef.act;
      P.eng = { d: ef.date || o.day, file: ef.name, gw: [...gasNow],
        wo: a.wo.map(x => Object.assign({}, x, { i: id(x.n), next: x.next.map(y => Object.assign({}, y, { i: id(y.n) })) })),
        drill: a.drill.map(x => Object.assign({}, x)), dnext: a.dnext.slice(),
        rigless: a.rigless.map(x => Object.assign({}, x, { ws: x.n.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean).map(n => ({ n, i: id(n) })) })) };
    }
    // hours online on the report's day, with the stops that are about to be added
    if (e0 <= o.now) {
      const ends = new Map(P.running.map(x => [x.e, x.at]));
      const dt = o.dt.map(e => ends.has(e) ? Object.assign({}, e, { e: ends.get(e) }) : e).concat(P.close.map(x => ({ w: x.w.id, s: x.from || s0, e: null })));
      for (const { w, r } of st.values()) { if (w.hid) continue; const hrs = num(r.hrs); if (hrs == null) continue; const app = L.uptime(dt, w.id, o.day, o.h, o.now).up; if (Math.abs(app - hrs) >= 1) P.hrs.push({ w, r, app, rep: hrs }); }
    }
    // targets and factors, only from tables of the well's type; two different values for one well change nothing
    const cand = new Map(), add = (w, f, a, b) => { const k = w.id + '|' + f, c = cand.get(k) || cand.set(k, { w, f, a, v: [] }).get(k); if (!c.v.includes(b)) c.v.push(b); };
    for (const f of o.files) for (const r of f.rows) {
      const w = mt(r.n); if (!w) continue;
      if (r.cols.includes('req') && w.t === 'WIW' && tableOf(r) === 'water') { const v = num(r.req); if (v > 0) add(w, 'tg', w.tg, v); }
      if (w.t === 'GL' && (r.cols.includes('opt') || r.cols.includes('k'))) {
        const t = num(r.opt); if (t > 0) add(w, 'tg', w.tg, t);
        if (r.cols.includes('k')) { const k = num(r.k); add(w, 'k', w.k || 0, k > 0 ? k : 0); }
      }
    }
    for (const c of cand.values()) {
      if (c.v.length > 1) { if (!c.w.hid && !P.dup.some(d => d.w.id === c.w.id && d.f === c.f)) P.dup.push({ w: c.w, f: c.f, v: c.v }); continue; }
      const b = c.v[0]; if (Math.abs((c.a ?? 0) - (b ?? 0)) > 1e-9) P.tg.push({ w: c.w, f: c.f, a: c.a ?? null, b });
    }
    if (oil.length) P.absent = wells.filter(w => !w.hid && !by.has(w.id));
    return P;
  }
  root.REP = { toks, key, base, matcher, sections, extract, fileDate, serialDay, STOP, TYPE, num, plan, tableOf, desc, rigWells, engTests, engAct };
})(typeof self !== 'undefined' ? self : this);
