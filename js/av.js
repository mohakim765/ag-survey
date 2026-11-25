/* Avocet: the daily sheet that goes into Avocet. The same tabs, columns and well order as the old survey workbook's Avocet
   tabs (SEED.avocet, made from that workbook by scripts/build_avocet.py); the block from "Flow Time" on is pasted into Avocet.
   - readings: the day's; else the well's last reading in the app; else the old workbook's last value. A well shut in all
     day has its running values (amps, Hz, runtime, Sam rate, fillage, gas, injection, orifice diff) at 0 and its shut in
     pressure = its wellhead pressure. An injector's water is the day's volume: its rate x hours / 24 (as the old sheet).
   - hours: the day's approved production report (gas wells: the engineering report's gas tab); else the app's stops that
     day; else the last report that has the well; else the old workbook. The downtime cause: the day's report; when it
     leaves it blank (it does for wells shut in for long), the app's stop, else the last cause the reports or the old
     workbook gave the well.
   - yellow: a value from an earlier day; red: a value missing where it is needed, or not in Avocet's lists. The "مراجعة"
     tab lists every one of them with where it came from and its date. */
(function (root) {
  'use strict';
  const RUNNING = new Set(['AMP', 'HZ', 'RUN', 'INFO', 'FILL', 'GAS', 'INJ', 'DIFF']);   // (strokes per minute is the pump's setting: kept)
  const NEEDED = { NF: ['WH'], DE: ['WH', 'GAS'], ORI: ['WH', 'GAS'], ESP: ['WH', 'AMP', 'HZ'], ROD: ['WH', 'RUN', 'FILL'], INJ: ['WH', 'INJ'], Source: ['WH', 'AMP', 'HZ'] };
  const RUNLABEL = { NF: 'Natural Flow', DE: 'Gas Lift', ORI: 'Gas Lift', ESP: 'ESP Lift', ROD: 'Sucker Rod Lift', INJ: 'Water Injection', Source: 'Water Source' };
  const CSGFAM = { 'Open To Flare': 'F', 'Regulated To Flare': 'F', 'Regulated To Production': 'P', 'Closed': 'C' }, CSGDEF = { F: 'Open To Flare', P: 'Regulated To Production', C: 'Closed' };
  const LISTCOL = { 'Status': 'st', 'Casing Status': 'csg', 'Choke Control': 'ck', 'Production Facility': 'fac', 'Production System': 'sys', 'ESP Manufacturer': 'esp', 'Downtime type': 'dt', 'Measured By': 'mb', 'Running Mode': 'rm', 'Manifold Status': 'ms' };
  // the report's causes that are not Avocet's: a rig's work over, and an intermittent well's build-up (the old sheet wrote it so)
  // ("SI" is a status, not a cause: the stops a report makes when it gives no cause carry it)
  const CAUSEMAP = [[/^(workover|work over|w\.?o)\b/i, 'Workover'], [/^intermittent\s*production$/i, 'Low Reservoir Pressure/Depleted'], [/^t\s*&\s*a$/i, ''], [/^s\.?\s*i\.?$/i, '']];
  const TABAR = { NF: 'NF', DE: 'DE (Gas Lift)', ORI: 'ORI (Gas Lift)', ESP: 'ESP', ROD: 'ROD (SRP)', INJ: 'INJ (حقن)', Source: 'Source (WSW)', MFD: 'Manifold' };
  const key = s => (String(s).toUpperCase().match(/[A-Z]+|\d+/g) || []).map(x => /\d/.test(x) ? String(+x) : x).join('.');
  const num = v => { if (v == null || v === '' || typeof v === 'boolean') return null; if (typeof v === 'number') return isFinite(v) ? v : null; const m = String(v).trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*\/\s*64)?$/); return m ? +m[1] : null; };
  const r2 = v => Math.round(v * 100) / 100;
  const letter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const ageOf = (d, day) => d ? Math.round((Date.parse(day) - Date.parse(d)) / 864e5) : '';

  function build(o) {
    const { S, A, L, wells, day, H, now } = o;
    const byId = new Map(wells.map(w => [w.id, w]));
    const days = Object.keys(S.days || {}).filter(d => d <= day).sort().reverse();   // newest first
    const reps = S.reps || {}, repDays = Object.keys(reps).filter(d => d < day).sort().reverse();
    const [s0, e0] = L.dayWindow(day, H), over = e0 <= now, lists = A.lists || {};
    const rev = [], st = { y: 0, r: 0, rows: 0, hrs: {}, untied: 0 };
    const tabOrder = A.tabs.map(t => t.id).concat('MFD');
    const add = (tab, n, col, v, src, d, why, fill) => { rev.push({ tab, n, col, v, src, d, why, fill }); if (fill === 'y') st.y++; if (fill === 'r') st.r++; };

    // a reading of one well: the day's, else the newest before it (the gas with that day's orifice factor)
    function reading(w, f) {
      const fld = f === 'WH' ? (w.t === 'GL' || w.t === 'WIW' ? 'WHIP' : 'WHP') : f;
      for (const d of days) {
        const r = S.days[d].r && S.days[d].r[w.id]; if (!r || !r.v) continue;
        let v;
        if (f === 'GAS') v = L.gasValue(Object.assign({}, w, { k: r.wk != null ? r.wk : w.k }), r.v);
        else if (f === 'CSG') v = /^[FPC]$/.test(r.v.CSG || '') ? r.v.CSG : null;
        else { v = num(r.v[fld]); if (f === 'WH' && v == null) v = num(r.v[fld === 'WHP' ? 'WHIP' : 'WHP']); }
        if (v != null) return { v, d, r };
      }
      return null;
    }
    // a manifold line's pressure: the day's, else the newest before it
    function mfdReading(p, l) {
      for (const d of days) { const x = S.days[d].p && S.days[d].p[p]; const v = x && x.h ? num(x.h[l || '-']) : null; if (v != null) return { v, d }; }
      return null;
    }
    // the app's stops in the day: the hours the well was down (a stop still open counts to the day's end) and the cause of
    // its longest stop that has one (with the technician's words when he wrote his own)
    function appHours(w) {
      const iv = []; let main = '', note = '', longest = -1;
      for (const e of S.dt || []) {
        if (e.w !== w.id) continue; const a = Math.max(e.s, s0), b = Math.min(e.e == null ? e0 : e.e, e0); if (b <= a) continue;
        iv.push([a, b]); const c = cause(L.avocet ? L.avocet(e.r) : e.r);
        if (c && b - a > longest) { longest = b - a; main = c; note = e.o || ''; }
      }
      iv.sort((x, y) => x[0] - y[0]); let down = 0, cur = null;
      for (const [a, b] of iv) { if (!cur || a > cur[1]) { if (cur) down += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
      if (cur) down += cur[1] - cur[0];
      return { h: r2(Math.max(0, 24 - down / 3600000)), c: main, o: note };
    }
    function fromRec(rec, row, w) {
      if (!rec) return null; let x = w && rec.wh && rec.wh[w.id];
      if (!x && rec.whn) for (const k of [row.n, w && w.n, w && w.p].filter(Boolean).map(key)) if (rec.whn[k]) { x = rec.whn[k]; break; }
      return x && x[0] != null ? x : null;
    }
    function hours(row, w) {
      let x = fromRec(reps[day], row, w);
      if (x) return { h: x[0], c: x[1], src: x[2] === 'p' ? 'تقرير الإنتاج' : 'تقرير الهندسية', d: day };
      if (w && !w.hid) { const a = appHours(w); return { h: a.h, c: a.c, o: a.o, src: 'البرنامج', d: day }; }
      for (const d of repDays) { x = fromRec(reps[d], row, w); if (x) return { h: x[0], c: x[1], src: 'آخر تقرير', d }; }
      if (row.h && row.h[0] != null) return { h: row.h[0], c: row.h[1], src: 'الشيت القديم', d: A.v };
      return null;
    }
    const cause = c => { c = String(c || '').trim(); for (const [re, to] of CAUSEMAP) if (re.test(c)) return to; return c; };
    // why a well was down: the day's report; when it gives none (it leaves the wells shut in for long blank), the app's stop
    // that day, else the last report that gave one, else the old workbook's (the last two yellow)
    function causeOf(row, w, hv) {
      if (cause(hv.c)) return { c: cause(hv.c), o: hv.o };
      if (w) { const a = appHours(w); if (a.h < 24 && a.c) return { c: a.c, src: 'وقفة في البرنامج', d: day, o: a.o }; }
      for (const d of repDays) { const x = fromRec(reps[d], row, w); if (x && x[0] < 24 && cause(x[1])) return { c: cause(x[1]), src: 'آخر تقرير', d, y: 1 }; }
      if (row.h && row.h[0] != null && row.h[0] < 24 && cause(row.h[1])) return { c: cause(row.h[1]), src: 'الشيت القديم', d: A.v, y: 1 };
      return null;
    }

    const sheets = [], injP = new Map();
    for (const t of A.tabs) {
      const hdr = t.hdr.slice(), W = hdr.length, out = [[{ date: day }, `Production day ${day} (06:00 to 06:00)`], hdr];
      const lc = hdr.map(h => LISTCOL[String(h).trim()] || null);
      for (const row of t.rows) {
        const w = row.w ? byId.get(row.w) || null : null; st.rows++; if (!w) st.untied++;
        const hv = hours(row, w), hrs = hv ? Math.max(0, Math.min(24, hv.h)) : null, shut = hrs === 0;
        if (hv) st.hrs[hv.src] = (st.hrs[hv.src] || 0) + 1;
        const cells = new Array(W).fill(''), vk = {};
        cells[0] = row.n;
        if (!w) add(t.id, row.n, 'A', '', 'الشيت القديم', A.v, 'البير مش في البرنامج: قراياته من آخر قيم في الشيت القديم');
        if (hv && hv.src !== 'تقرير الإنتاج' && hv.src !== 'تقرير الهندسية') add(t.id, row.n, 'C', hrs, hv.src, hv.d, 'الساعات مش من تقرير اليوم', hv.src === 'البرنامج' ? null : 'y');
        // one value of the row: from the app (the day's or an older one), else the old workbook; yellow when from an earlier day.
        // The injector's water is the day's volume: its rate for the hours it injected (rate x hours / 24, as the old sheet).
        const val = (c, F) => {
          if (shut && RUNNING.has(F)) return { v: 0 };
          const fx = F === 'INJ' && hrs != null && hrs < 24 ? v => r2(v * hrs / 24) : v => v, why = v => F === 'INJ' && hrs != null && hrs < 24 ? `المعدل ${v} × ${hrs} ساعة ÷ 24` : '';
          const x = w ? reading(w, F) : null;
          if (x) { const v = fx(x.v); if (x.d < day) { add(t.id, row.n, c, v, 'آخر قراية في البرنامج', x.d, why(x.v), 'y'); return { v, fill: 'y', d: x.d, r: x.r }; } return { v, d: x.d, r: x.r }; }
          const b = row.b && row.b[c];
          if (b) {
            if (typeof b[0] === 'number') { const v = fx(b[0]); add(t.id, row.n, c, v, 'الشيت القديم', b[1], why(b[0]), 'y'); return { v, fill: 'y', d: b[1] }; }
            add(t.id, row.n, c, '', 'الشيت القديم', b[1], `آخر قيمة كانت كلام: ${b[0]}`);
          }
          if ((NEEDED[t.id] || []).includes(F) && !shut) { add(t.id, row.n, c, '', '', '', 'مفيش قراية خالص', 'r'); return { v: '', fill: 'r' }; }
          return { v: '' };
        };
        const roles = t.roles;
        for (let i = 1; i < W; i++) {
          const c = letter(i), role = roles[c] || 'k';
          let cell = '';
          if (role === 'dt') cell = '';
          else if (role === 'hrs') cell = hrs == null ? { v: '', fill: 'r' } : hv.src === 'آخر تقرير' || hv.src === 'الشيت القديم' ? { v: hrs, fill: 'y' } : hrs;
          else if (role === 'st') cell = hrs == null ? '' : shut ? 'Shut In' : (row.st || RUNLABEL[t.id]);
          else if (role === 'down') cell = hrs == null ? '' : r2(24 - hrs);
          else if (role === 'cause') {
            if (hrs == null || hrs >= 24) cell = '';
            else {
              const k = causeOf(row, w, hv);
              if (!k) { cell = { v: '', fill: 'r' }; add(t.id, row.n, c, '', hv.src, hv.d, 'البير وقف ومفيش سبب', 'r'); }
              else if (k.y) { cell = { v: k.c, fill: 'y' }; add(t.id, row.n, c, k.c, k.src, k.d, 'التقرير مكتبش سبب: آخر سبب معروف للبير', 'y'); }
              else cell = k.c;
              if (k && k.o) add(t.id, row.n, c, k.c, 'وقفة في البرنامج', day, 'الفني كتب: ' + k.o);
            }
          }
          else if (role === 'csg') {
            const k = row.k[c] || '', x = w ? reading(w, 'CSG') : null;
            if (x) { const fam = x.v, v = k && CSGFAM[k] === fam ? k : CSGDEF[fam]; cell = x.d < day ? { v, fill: 'y' } : v; if (x.d < day) add(t.id, row.n, c, v, 'آخر قراية في البرنامج', x.d, '', 'y'); }
            else cell = k;
          }
          else if (role.startsWith('r:')) { const x = val(c, role.slice(2)); vk[c] = x; cell = x.fill ? { v: x.v, fill: x.fill } : x.v; }
          else if (role === 'fw') {   // the injector's flowing line: its own reading, else the injection pressure (as the old sheet)
            const x = w ? reading(w, 'FLP') : null;
            if (x) { cell = x.d < day ? { v: x.v, fill: 'y' } : x.v; if (x.d < day) add(t.id, row.n, c, x.v, 'آخر قراية في البرنامج', x.d, '', 'y'); }
            else cell = '=K';
          }
          else if (role === 'mb') {
            const x = w && w.m === (L.NOSCAN || 'No scanner') ? reading(w, 'INJ') : null, m = x && x.r && x.r.v.INJM;
            cell = m === 'U' ? 'Ultrasonic' : m === 'E' ? 'Estimate' : (row.k[c] || '');
          }
          else if (role === 'md' || role === 'sum' || role === 'whsip') cell = '=' + role;
          else cell = row.k[c] != null ? row.k[c] : '';
          cells[i] = cell;
        }
        // what needs the other columns: the shut in pressure, the injector's line pressure, the dates, the source's water
        const Kc = cells[10], Kv = Kc && typeof Kc === 'object' ? Kc.v : Kc;
        for (let i = 1; i < W; i++) {
          const c = cells[i]; if (typeof c !== 'string' || c[0] !== '=') continue; const role = c.slice(1);
          if (role === 'K') cells[i] = Kc;
          else if (role === 'whsip') cells[i] = shut ? Kc : '';
          else if (role === 'md') {
            // the last measurement date: a typed one stays (an ultrasonic test, an estimate); a meter read every day has the
            // date of its reading (the water's, else the pressure's); the rows the old sheet left blank stay blank
            const kd = row.k[letter(i)], x = [vk.P, vk.K].find(y => y && y.d);
            cells[i] = kd ? (/^\d{4}-\d\d-\d\d$/.test(kd) ? { date: kd } : kd) : row.md && x ? { date: x.d } : '';
          }
          else if (role === 'sum') { let s = 0, any = false; for (const n of row.sum || []) { const p = injP.get(n); if (typeof p === 'number') { s += p; any = true; } } cells[i] = any ? r2(s) : 0; }
        }
        if (t.id === 'INJ') { const p = cells[15]; injP.set(row.n, typeof p === 'object' && p ? (typeof p.v === 'number' ? p.v : null) : typeof p === 'number' ? p : null); }
        // Avocet's lists
        for (let i = 1; i < W; i++) {
          if (!lc[i]) continue; const c = cells[i], v = c && typeof c === 'object' ? c.v : c; if (v === '' || v == null) continue;
          const l = lists[lc[i]]; if (l && !l.includes(String(v).trim())) { cells[i] = { v, fill: 'r' }; add(t.id, row.n, letter(i), v, '', '', `مش في قايمة Avocet (${hdr[i]})`, 'r'); }
        }
        out.push(cells);
      }
      out.push([], [`${t.rows.length} Items`]);
      sheets.push({ name: t.sheet, rows: out, rtl: false, head: 1, freeze: { r: 2, c: 1 }, filter: false, widths: [22].concat(hdr.slice(1).map(h => Math.max(9, Math.min(26, String(h).length * 0.9)))) });
    }
    // the manifolds
    if (A.mfd) {
      const m = A.mfd, out = [[{ date: day }, `Production day ${day} (06:00 to 06:00)`], m.hdr.slice()];
      for (const r of m.rows) {
        st.rows++;
        let c = '';
        const x = r.p ? mfdReading(r.p, r.l) : null;
        if (x) { c = x.d < day ? { v: x.v, fill: 'y' } : x.v; if (x.d < day) add('MFD', r.n, 'C', x.v, 'آخر قراية في البرنامج', x.d, '', 'y'); }
        else if (r.b && typeof r.b[0] === 'number') { c = { v: r.b[0], fill: 'y' }; add('MFD', r.n, 'C', r.b[0], 'الشيت القديم', r.b[1], r.p ? '' : 'الخط ده مش مربوط بمانيفولد في البرنامج', 'y'); }
        else { add('MFD', r.n, 'C', '', 'الشيت القديم', r.b ? r.b[1] : '', r.b ? `آخر قيمة كانت كلام: ${r.b[0]}` : 'مفيش قراية'); }
        let s = r.k.B || ''; if (s && lists.ms && !lists.ms.includes(s)) { s = { v: s, fill: 'r' }; add('MFD', r.n, 'B', r.k.B, '', '', 'مش في قايمة Avocet (Manifold Status)', 'r'); }
        out.push([r.n, s, c, r.k.D != null ? r.k.D : '', r.k.E || '', r.k.F || '']);
      }
      out.push([], [`${m.rows.length} Items`]);
      sheets.push({ name: m.sheet, rows: out, rtl: false, head: 1, freeze: { r: 2, c: 1 }, filter: false, widths: [36, 16, 12, 14, 60, 30] });
    }
    // the summary and the review, in Arabic
    const rec = reps[day];
    const sum = [['البند', 'العدد'],
      ['يوم الإنتاج', `${day} (6 الصبح لـ 6 الصبح)`],
      ['تقرير الإنتاج', rec && rec.wh ? `اتعمد (${(rec.files || []).join('، ')})` : 'لسه متعمدش: ساعات الآبار من وقفات البرنامج'],
      ...(over ? [] : [['تنبيه', 'اليوم ده لسه مخلصش: الساعات لحد آخره على فرض إن مفيش حاجة هتتغير']]),
      ['الآبار والمانيفولدات', st.rows],
      ['قيم من يوم قبل كده (أصفر)', st.y],
      ['قيم ناقصة أو مش في قوايم Avocet (أحمر)', st.r],
      ['آبار مش في البرنامج (قراياتها من الشيت القديم)', st.untied],
      ...Object.entries(st.hrs).map(([k, v]) => ['الساعات من ' + k, v]),
      ['من فين القراية', 'قراية اليوم، وإلا آخر قراية للبير في البرنامج، وإلا آخر قيمة في الشيت القديم. البير الواقف طول اليوم الأمبير والهيرتز والرن تايم والجاز والحقن بتاعه صفر.'],
      ['النسخ لـ Avocet', 'من عمود Flow Time لحد آخر عمود، لحد قبل سطر Items، والصق في Avocet بنفس ترتيب الآبار.']];
    rev.sort((a, b) => tabOrder.indexOf(a.tab) - tabOrder.indexOf(b.tab));
    const revRows = [['التابة', 'البير', 'العمود', 'القيمة', 'جت منين', 'تاريخها', 'من كام يوم', 'ملاحظة']].concat(rev.map(x => [TABAR[x.tab] || x.tab, x.n, x.col, x.fill ? { v: x.v === '' ? '' : x.v, fill: x.fill } : x.v, x.src, x.d ? { date: x.d } : '', x.d ? ageOf(x.d, day) : '', x.why]));
    sheets.unshift({ name: 'ملخص', rows: sum, widths: [44, 90] });
    sheets.push({ name: 'مراجعة', rows: revRows, widths: [16, 24, 8, 12, 22, 12, 10, 50] });
    return { sheets, stats: st, review: rev, report: !!(rec && rec.wh), over };
  }
  const api = { build, key };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AV = api;
})(typeof self !== 'undefined' ? self : this);
