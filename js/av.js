/* Avocet: the daily sheet that goes into Avocet. The same tabs, columns and well order as the old survey workbook's Avocet
   tabs (SEED.avocet, made from that workbook by scripts/build_avocet.py); the block from "Flow Time" on is pasted into Avocet.
   - readings: the day's; else the well's last reading in the app; else the old workbook's last value. A well shut in all
     day has its running values (amps, Hz, runtime, Sam rate, fillage, gas, injection, orifice diff) at 0 and its shut in
     pressure = its wellhead pressure. An injector's water is the day's volume: its rate x hours / 24 (as the old sheet).
   - hours: the app's stops that day (the app is the source; an approved report changes the app by closing and opening
     wells). The wells hidden from the technicians and the ones the app does not have: the newest approved report that has
     them, else the old workbook. The downtime cause: the stop's; when it has none (the stops a report makes for the wells
     it leaves without a cause), the last cause the reports or the old workbook gave the well.
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
  const colIdx = c => c ? c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : -1;
  const letter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const ageOf = (d, day) => d ? Math.round((Date.parse(day) - Date.parse(d)) / 864e5) : '';

  // what the Avocet sheet and the report's readings share: one production day's readings, hours and downtime causes
  function kit(o) {
    const { S, A, L, wells, day, H, now } = o;
    const byId = new Map(wells.map(w => [w.id, w]));
    const days = Object.keys(S.days || {}).filter(d => d <= day).sort().reverse();   // newest first
    const reps = S.reps || {}, repDays = Object.keys(reps).filter(d => d <= day).sort().reverse();
    const [s0, e0] = L.dayWindow(day, H), over = e0 <= now;

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
      const one = ln => { for (const d of days) { const x = S.days[d].p && S.days[d].p[p]; const v = x && x.h ? num(x.h[ln || '-']) : null; if (v != null) return { v, d }; } return null; };
      const x = one(l);
      // (a manifold whose line A alone is read: the old sheet gave its other lines A's reading of the day)
      if ((A.copyA || []).includes(p) && l && l !== 'A' && (!x || x.d < day)) { const a = one('A'); if (a && a.d === day) return { v: a.v, d: a.d, a: 1 }; }
      return x;
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
    // the hours: the app's stops for the wells the technicians see (an approved report reaches them by closing and opening
    // wells); the wells hidden from them and the ones the app does not have: the newest approved report, else the old workbook
    function hours(row, w) {
      if (w && !w.hid) { const a = appHours(w); return { h: a.h, c: a.c, o: a.o, src: 'البرنامج', d: day }; }
      for (const d of repDays) { const x = fromRec(reps[d], row, w); if (x) return { h: x[0], c: x[1], src: d === day ? 'تقرير اليوم' : 'آخر تقرير', d }; }
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

    return { byId, over, reading, mfdReading, appHours, hours, cause, causeOf };
  }

  function build(o) {
    const { S, A, L, wells, day } = o, prev = o.prev || null, snap = {}, chg = [];
    const { byId, over, reading, mfdReading, hours, cause, causeOf } = kit(o), lists = A.lists || {};
    const rev = [], st = { y: 0, r: 0, rows: 0, hrs: {}, untied: 0, down: 0 };
    const tabOrder = A.tabs.map(t => t.id).concat('MFD');
    const add = (tab, n, col, v, src, d, why, fill) => { rev.push({ tab, n, col, v, src, d, why, fill }); if (fill === 'y') st.y++; if (fill === 'r') st.r++; };

    const sheets = [], injP = new Map();
    for (const t of A.tabs) {
      const hdr = t.hdr.slice(), W = hdr.length, out = [[{ date: day }, `Production day ${day} (06:00 to 06:00)`], hdr];
      const lc = hdr.map(h => LISTCOL[String(h).trim()] || null);
      for (const row of t.rows) {
        const w = row.w ? byId.get(row.w) || null : null; st.rows++; if (!w) st.untied++;
        const hv = hours(row, w), hrs = hv ? Math.max(0, Math.min(24, hv.h)) : null, shut = hrs === 0;
        if (hv) st.hrs[hv.src] = (st.hrs[hv.src] || 0) + 1; if (hrs != null && hrs < 24) st.down++;
        const cells = new Array(W).fill(''), vk = {};
        cells[0] = row.n;
        if (!w) add(t.id, row.n, 'A', '', 'الشيت القديم', A.v, 'البير مش في البرنامج: قراياته من آخر قيم في الشيت القديم');
        if (hv && (hv.src === 'آخر تقرير' || hv.src === 'الشيت القديم')) add(t.id, row.n, 'C', hrs, hv.src, hv.d, w ? 'بير مستخبي عن الفنيين: ساعاته من آخر تقرير اتعمد' : 'بير مش في البرنامج: ساعاته من آخر تقرير اتعمد', 'y');
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
        // what changed since the last sheet of this day
        const hk = Object.keys(t.roles).find(c => t.roles[c] === 'hrs'), sk = Object.keys(t.roles).find(c => t.roles[c] === 'st'), ck = Object.keys(t.roles).find(c => t.roles[c] === 'cause');
        const cv = c => { const x = cells[colIdx(c)]; return x && typeof x === 'object' ? (x.v == null ? '' : x.v) : x == null ? '' : x; };
        const now3 = [cv(hk), cv(sk), cv(ck)], rk = t.id + '|' + row.n; snap[rk] = now3;
        const was = prev && prev.r && prev.r[rk];
        if (was) [hk, sk, ck].forEach((c, j) => {
          if (String(was[j]) === String(now3[j])) return; const i = colIdx(c), x = cells[i];
          if (!(x && typeof x === 'object' && x.fill === 'r')) cells[i] = { v: now3[j], fill: 'c' };
          chg.push([TABAR[t.id] || t.id, row.n, hdr[i], was[j], now3[j]]);
        });
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
        if (x) { c = x.d < day ? { v: x.v, fill: 'y' } : x.v; if (x.d < day) add('MFD', r.n, 'C', x.v, 'آخر قراية في البرنامج', x.d, '', 'y'); else if (x.a) add('MFD', r.n, 'C', x.v, 'خط A', x.d, 'الخط ده ملوش قراية: واخد قراية خط A زي الشيت القديم'); }
        else if (r.b && typeof r.b[0] === 'number') { c = { v: r.b[0], fill: 'y' }; add('MFD', r.n, 'C', r.b[0], 'الشيت القديم', r.b[1], r.p ? '' : 'الخط ده مش مربوط بمانيفولد في البرنامج', 'y'); }
        else { add('MFD', r.n, 'C', '', 'الشيت القديم', r.b ? r.b[1] : '', r.b ? `آخر قيمة كانت كلام: ${r.b[0]}` : 'مفيش قراية'); }
        let s = r.k.B || ''; if (s && lists.ms && !lists.ms.includes(s)) { s = { v: s, fill: 'r' }; add('MFD', r.n, 'B', r.k.B, '', '', 'مش في قايمة Avocet (Manifold Status)', 'r'); }
        out.push([r.n, s, c, r.k.D != null ? r.k.D : '', r.k.E || '', r.k.F || '']);
      }
      out.push([], [`${m.rows.length} Items`]);
      sheets.push({ name: m.sheet, rows: out, rtl: false, head: 1, freeze: { r: 2, c: 1 }, filter: false, widths: [36, 16, 12, 14, 60, 30] });
    }
    // the summary and the review, in Arabic
    const sum = [['البند', 'العدد'],
      ['يوم الإنتاج', `${day} (6 الصبح لـ 6 الصبح)`],
      ['ساعات التشغيل', 'من وقفات البرنامج. الآبار المستخبية عن الفنيين واللي مش في البرنامج: من آخر تقرير اتعمد'],
      ...(over ? [] : [['تنبيه', 'اليوم ده لسه مخلصش: البير الواقف دلوقتي محسوب واقف لحد آخر اليوم، والشغال محسوب شغال']]),
      ['الآبار والمانيفولدات', st.rows],
      ['آبار وقفت في اليوم ده (أقل من 24 ساعة)', st.down],
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
    // the changes since the last sheet of this day: a tab of them, the cells in blue
    if (prev) {
      sum.splice(2, 0, ['آخر مرة اتطلع الشيت ده', `${L.stamp(prev.t)}${prev.byn ? ' (' + prev.byn + ')' : ''}: اتغير ${chg.length} خانة، بالأزرق في التابات وفي تابة «اللي اتغير»`]);
      sheets.splice(1, 0, { name: 'اللي اتغير', rows: [['التابة', 'البير', 'العمود', 'كان', 'بقى']].concat(chg.length ? chg : [['مفيش حاجة اتغيرت من آخر مرة']]), widths: [16, 24, 22, 32, 32] });
    }
    return { sheets, stats: st, review: rev, over, snap: { t: o.now, r: snap }, changes: chg };
  }

  /* the production report's readings from the app, on the report's own rows and columns (its newest approved copy's order,
     else the seed's): WELL DATA, the WATER FLOOD WELLS injectors and source wells, MANIFOLDS. Pasted with Paste Special
     (Values, Skip blanks) a blank leaves the report's own value. The status, hours and downtime cause are the Avocet
     sheet's (the app's stops; a hidden well: the last approved report), the readings too (the day's, else the last one in
     yellow; a well shut all day has its running values 0); an injector's water is its rate for the hours it injected and a
     source well's the water of the injectors it feeds, as the report has them. */
  const RSTAT = { GL: 'G/L', NF: 'NF', PL: 'LIFT', ESP: 'ESP', SRP: 'SRP', WIW: 'INJ', WSW: 'WSW' };
  const RNEED = { NF: ['WH'], PL: ['WH'], GL: ['WH', 'GAS'], ESP: ['WH', 'AMP', 'HZ'], SRP: ['WH', 'RUN', 'FILL'], WIW: ['WH', 'INJ'], WSW: ['WH', 'AMP', 'HZ'] };
  const STOPST = /^(s\.?\s*i|w\.?\s*o|t\s*&\s*a|p\s*&\s*a|shut)/i;
  function report(o) {
    const { S, A, L, wells, day } = o, ord = o.ord || {};
    const { byId, reading, mfdReading, hours, causeOf } = kit(o);
    const rev = [], st = { y: 0, r: 0, rows: 0 };
    const add = (tab, n, col, v, src, d, why, fill) => { rev.push({ tab, n, col, v, src, d, why, fill }); if (fill === 'y') st.y++; if (fill === 'r') st.r++; };
    // a well's Avocet row: its old workbook values, its hours when the app has none
    const avBy = new Map(), avName = new Map();
    for (const t of A.tabs) for (const r of t.rows) { const x = { t, r }; if (r.w && !avBy.has(r.w)) avBy.set(r.w, x); avName.set(t.id + '|' + key(r.n), x); }
    // (by name only in the same kind of tab: the report's oil row of a well that is a water well now is not its water row)
    const OILT = ['NF', 'DE', 'ORI', 'ESP', 'ROD'], avOf = (wid, n, tabs) => (wid && avBy.get(wid)) || tabs.map(t => avName.get(t + '|' + key(n))).find(Boolean) || null;
    function val(tab, n, col, w, x, F, shut, fx) {
      if (shut && RUNNING.has(F)) return 0;
      fx = fx || (v => v);
      const y = w ? reading(w, F) : null;
      if (y) { const v = fx(y.v); if (y.d < day) { add(tab, n, col, v, 'آخر قراية في البرنامج', y.d, '', 'y'); return { v, fill: 'y' }; } return v; }
      const c = x && Object.keys(x.t.roles).find(k => x.t.roles[k] === 'r:' + F), b = c && x.r.b && x.r.b[c];
      if (b && (typeof b[0] === 'number' || F === 'CHK')) { const v = typeof b[0] === 'number' ? fx(b[0]) : b[0]; add(tab, n, col, v, 'الشيت القديم', b[1], '', 'y'); return { v, fill: 'y' }; }
      if (w && !shut && (RNEED[w.t] || []).includes(F)) { add(tab, n, col, '', '', '', 'مفيش قراية خالص', 'r'); return { v: '', fill: 'r' }; }
      return '';
    }
    // status, hours and cause of one row
    function stat(tab, n, w, x, rst, cols) {
      const hv = hours(x ? x.r : { n }, w); if (!hv) return { hv: null, shut: false };
      const h = Math.max(0, Math.min(24, hv.h)), shut = h === 0, out = {};
      out[cols.st] = shut ? 'SI' : (rst && !STOPST.test(rst) ? rst : w ? RSTAT[w.t] || '' : '');
      out[cols.h] = hv.src === 'آخر تقرير' || hv.src === 'الشيت القديم' ? { v: h, fill: 'y' } : h;
      if (hv.src === 'آخر تقرير' || hv.src === 'الشيت القديم') add(tab, n, letter(cols.h), h, hv.src, hv.d, w ? 'بير مستخبي عن الفنيين: ساعاته من آخر تقرير اتعمد' : 'بير مش في البرنامج: ساعاته من آخر تقرير اتعمد', 'y');
      if (h < 24) {
        const k = causeOf(x ? x.r : { n }, w, hv);
        if (!k) { if (h > 0) { out[cols.c] = { v: '', fill: 'r' }; add(tab, n, letter(cols.c), '', hv.src, hv.d, 'البير وقف جزء من اليوم ومفيش سبب', 'r'); } }
        else if (k.y) { /* the report leaves the cause of a well shut in for long blank: so does this */ }
        else out[cols.c] = k.c;
        const l = A.lists && A.lists.dt, cz = out[cols.c] && typeof out[cols.c] === 'object' ? out[cols.c].v : out[cols.c];
        if (cz && l && !l.includes(cz)) { out[cols.c] = { v: cz, fill: 'r' }; add(tab, n, letter(cols.c), cz, '', '', 'سبب مش في ليستة Avocet: المهندس يختار السبب', 'r'); }
      }
      return { hv, shut, h, out };
    }
    const put = (rows, r, c, v) => { while (rows.length <= r) rows.push([]); const row = rows[r]; while (row.length <= c) row.push(''); row[c] = v; };
    const head = (rows, r, cells) => { for (const [c, v] of cells) put(rows, r, c, v); };
    const sheets = [];
    // WELL DATA: B name, D status, E hours, G cause, H lift gas, I choke, J WHFP, K F/LINE, L casing, S-U SAM, AD-AE amps, Hz
    const wd = [];
    put(wd, 0, 0, { date: day }); put(wd, 0, 1, `قرايات البرنامج: يوم الإنتاج ${day} (6 الصبح لـ 6 الصبح)، لتقرير يوم ${L.addDays(day, 1)}`);
    head(wd, 1, [[1, 'WELL NAME'], [3, 'STATUS'], [4, 'HRS ONLINE'], [6, 'DOWNTIME CAUSE'], [7, 'LIFT GAS MMSCF/D'], [8, 'CHOKE 64"'], [9, 'WHFP PSI'], [10, 'F/LINE PSI'], [11, 'CASING PSI'], [18, 'DAILY SAM DATA'], [29, 'ESP']]);
    head(wd, 2, [[18, 'RUNTIME %'], [19, 'INF PROD'], [20, 'PUMP FILLAGE%'], [29, 'AMPS'], [30, 'Hz']]);
    for (const [ro, n, wid, rst] of ord.wd || []) {
      const w = wid ? byId.get(wid) || null : null, x = avOf(wid, n, OILT), T = 'WELL DATA', r = ro - 1; st.rows++;
      put(wd, r, 1, n); if (!w && !x) continue;   // a row the app and Avocet do not have (an old well): left as the report has it
      const s = stat(T, n, w, x, rst, { st: 3, h: 4, c: 6 }); for (const c in s.out || {}) put(wd, r, +c, s.out[c]);
      if (!w) continue;
      const v = (c, F) => put(wd, r, c, val(T, n, letter(c), w, x, F, s.shut));
      if (w.t === 'GL') { v(7, 'GAS'); v(9, 'WH'); v(10, 'FLP'); v(11, 'DS'); }
      else { v(8, 'CHK'); v(9, 'WH'); v(10, 'FLP'); v(11, 'CSGP'); }
      if (w.t === 'SRP') { v(18, 'RUN'); v(19, 'INFO'); v(20, 'FILL'); }
      if (w.t === 'ESP') { v(29, 'AMP'); v(30, 'HZ'); }
    }
    sheets.push({ name: 'WELL DATA', rows: wd, rtl: false, head: 1, freeze: { r: 3, c: 2 }, filter: false, widths: [12, 18, 4, 9, 9, 6, 26, 10, 8, 9, 9, 9].concat(new Array(6).fill(4), [10, 9, 12], new Array(8).fill(4), [8, 7]) });
    // WATER FLOOD WELLS: the injectors (D status, E hours, F cause, H the day's water, K WHIP, L casing) and the source wells
    // (D status, F WHP, G F/LINE, H casing, I-K amps, L Hz, N hours, O the water, R cause)
    const wf = [], vol = new Map();
    put(wf, 0, 0, { date: day }); put(wf, 0, 1, `قرايات البرنامج: يوم الإنتاج ${day}، لتقرير يوم ${L.addDays(day, 1)}`);
    head(wf, 1, [[1, 'WELL NAME'], [3, 'STATUS'], [4, 'HRS ONLINE'], [5, 'DOWNTIME CAUSE'], [7, 'ACTUAL INJ QTY bbl'], [10, 'WHIP PSI'], [11, 'CSG PSI']]);
    const injVol = (x, w, h) => { if (h === 0) return 0; const y = w ? reading(w, 'INJ') : null, b = x && x.r.b && x.r.b.P, rate = y ? y.v : b && typeof b[0] === 'number' ? b[0] : null; return rate == null || h == null ? null : r2(rate * h / 24); };
    for (const [ro, n, wid, rst] of ord.wi || []) {
      const w = wid ? byId.get(wid) || null : null, x = avOf(wid, n, ['INJ']), T = 'WATER FLOOD', r = ro - 1; st.rows++;
      put(wf, r, 1, n); if (!w && !x) continue;
      const s = stat(T, n, w, x, rst, { st: 3, h: 4, c: 5 }); for (const c in s.out || {}) put(wf, r, +c, s.out[c]);
      if (w || x) { const h = s.hv ? s.h : null; vol.set(key(n), injVol(x, w, h)); if (x) vol.set(key(x.r.n), vol.get(key(n))); }
      if (!w) continue;
      const h = s.hv ? s.h : 24;
      put(wf, r, 7, val(T, n, 'H', w, x, 'INJ', s.shut, v => r2(v * h / 24)));
      put(wf, r, 10, val(T, n, 'K', w, x, 'WH', s.shut)); put(wf, r, 11, val(T, n, 'L', w, x, 'CSGP', s.shut));
    }
    const ws = ord.ws || [];
    if (ws.length) {
      const h0 = ws[0][0] - 1;   // the report's source table: its title 3 rows above the first well
      head(wf, h0 - 3, [[1, 'SOURCE WELL STATUS']]);
      head(wf, h0 - 2, [[1, 'WELL NAME'], [3, 'STATUS'], [5, 'WHP PSI'], [6, 'FLINE PSI'], [7, 'CASING PSI'], [8, 'AMPS'], [11, 'Hz'], [13, 'HRS ONLINE'], [14, 'BWPD'], [17, 'DOWNTIME CAUSE']]);
      head(wf, h0 - 1, [[8, '1'], [9, '2'], [10, '3']]);
    }
    for (const [ro, n, wid, rst] of ws) {
      const w = wid ? byId.get(wid) || null : null, x = avOf(wid, n, ['Source']), T = 'WATER FLOOD', r = ro - 1; st.rows++;
      put(wf, r, 1, n); if (!w && !x) continue;   // (an old source well)
      const s = stat(T, n, w, x, rst, { st: 3, h: 13, c: 17 }); for (const c in s.out || {}) put(wf, r, +c, s.out[c]);
      if (!w) continue;
      put(wf, r, 5, val(T, n, 'F', w, x, 'WH', s.shut)); put(wf, r, 6, val(T, n, 'G', w, x, 'FLP', s.shut)); put(wf, r, 7, val(T, n, 'H', w, x, 'CSGP', s.shut));
      const amp = val(T, n, 'I', w, x, 'AMP', s.shut); put(wf, r, 8, amp); put(wf, r, 9, amp); put(wf, r, 10, amp);
      put(wf, r, 11, val(T, n, 'L', w, x, 'HZ', s.shut));
      // its water: the injectors it feeds (the Avocet source row's), each for the hours it injected
      if (x && x.t.id === 'Source' && (x.r.sum || []).length) {
        let sum = 0, any = false;
        for (const nn of x.r.sum) { let v = vol.get(key(nn)); if (v === undefined) { const xi = avName.get('INJ|' + key(nn)), wi = xi && xi.r.w ? byId.get(xi.r.w) : null, hv = xi ? hours(xi.r, wi) : null; v = xi ? injVol(xi, wi, hv ? Math.min(24, hv.h) : null) : null; } if (typeof v === 'number') { sum += v; any = true; } }
        put(wf, r, 14, any ? r2(sum) : '');
      }
    }
    sheets.push({ name: 'WATER FLOOD WELLS', rows: wf, rtl: false, head: 1, freeze: { r: 2, c: 2 }, filter: false, widths: [12, 18, 4, 9, 9, 24, 8, 12, 8, 8, 10, 9, 6, 10, 10, 6, 6, 24] });
    // MANIFOLDS: rows 4 on, D the pressure (the Avocet manifold list is the report's, in its order)
    if (A.mfd) {
      const mf = [];
      put(mf, 0, 0, { date: day }); put(mf, 0, 1, `قرايات البرنامج: يوم الإنتاج ${day}`);
      head(mf, 1, [[1, 'MANIFOLD'], [2, 'STATUS'], [3, 'PRESS PSIG']]);
      A.mfd.rows.forEach((m, i) => {
        const r = 3 + i, x = m.p ? mfdReading(m.p, m.l) : null; st.rows++;
        put(mf, r, 1, m.n);
        if (x) { put(mf, r, 3, x.d < day ? { v: x.v, fill: 'y' } : x.v); if (x.d < day) add('MANIFOLDS', m.n, 'D', x.v, 'آخر قراية في البرنامج', x.d, '', 'y'); }
        else if (m.b && typeof m.b[0] === 'number') { put(mf, r, 3, { v: m.b[0], fill: 'y' }); add('MANIFOLDS', m.n, 'D', m.b[0], 'الشيت القديم', m.b[1], m.p ? '' : 'الخط ده مش مربوط بمانيفولد في البرنامج', 'y'); }
      });
      sheets.push({ name: 'MANIFOLDS', rows: mf, rtl: false, head: 1, freeze: { r: 2, c: 2 }, filter: false, widths: [4, 36, 10, 12] });
    }
    const sum = [['البند', ''],
      ['يوم الإنتاج', `${day} (6 الصبح لـ 6 الصبح)`], ['التقرير', `التقرير اللي بتاريخ ${L.addDays(day, 1)}`],
      ['ترتيب الآبار', `زي ${ord.file || 'آخر تقرير اتعمد'}: كل بير في نفس الصف والعمود اللي ليه في التقرير`],
      ['اللصق في التقرير', 'انسخ من التابة والصق في نفس الخانة في التقرير بـ Paste Special: Values وعلّم على Skip blanks، عشان الخانة الفاضية متمسحش اللي في التقرير'],
      ['قيم من يوم قبل كده (أصفر)', st.y], ['قيم ناقصة أو سبب مش في ليستة Avocet (أحمر)', st.r]];
    const revRows = [['التابة', 'البير', 'العمود', 'القيمة', 'جت منين', 'تاريخها', 'من كام يوم', 'ملاحظة']].concat(rev.map(x => [x.tab, x.n, x.col, x.fill ? { v: x.v === '' ? '' : x.v, fill: x.fill } : x.v, x.src, x.d ? { date: x.d } : '', x.d ? ageOf(x.d, day) : '', x.why]));
    sheets.unshift({ name: 'ملخص', rows: sum, widths: [36, 100] });
    sheets.push({ name: 'مراجعة', rows: revRows, widths: [16, 24, 8, 12, 22, 12, 10, 50] });
    return { sheets, stats: st, review: rev };
  }
  const api = { build, report, key };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AV = api;
})(typeof self !== 'undefined' ? self : this);
