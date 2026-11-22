/* Daily survey sheet as PDF, drawn like the paper sheet. Pages are drawn on a canvas (so Arabic names render
   correctly) and wrapped as JPEG images in a minimal PDF. */
(function (root) {
  'use strict';
  const W = 1240, H = 1754, M = 46; // A4 at 150 dpi

  function pdfFromJpegs(pages) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, ct = pg + 1, im = pg + 2, cs = `q 595.28 0 0 841.89 0 0 cm /Im0 Do Q`;
      obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
      obj(ct, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
      obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
    });
    const xref = len, total = 3 + n * 3;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`; for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
  }

  function Pager() {
    const pages = []; let c, ctx, y;
    const font = (w, s) => `${w} ${s}px system-ui, "Noto Sans Arabic", Arial, sans-serif`;
    function newPage() { if (c) pages.push(c); c = document.createElement('canvas'); c.width = W; c.height = H; ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.textBaseline = 'middle'; y = M; }
    function fit(t, w) { t = String(t == null ? '' : t); if (ctx.measureText(t).width <= w) return t; while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
    function cell(x, yy, w, h, t, o) {
      o = o || {}; if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(x, yy, w, h); }
      ctx.strokeStyle = '#111'; ctx.lineWidth = o.thick ? 2 : 1; ctx.strokeRect(x + .5, yy + .5, w, h);
      if (t == null || t === '') return; ctx.font = font(o.bold ? 700 : 400, o.size || 17); ctx.fillStyle = o.color || '#111';
      const rtl = /[؀-ۿ]/.test(String(t)); ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textAlign = o.align === 'left' ? (rtl ? 'right' : 'left') : 'center';
      const tx = o.align === 'left' ? (rtl ? x + w - 6 : x + 6) : x + w / 2;
      ctx.fillText(fit(t, w - 10), tx, yy + h / 2 + 1);
    }
    function ensure(h, header) { if (y + h > H - M) { newPage(); if (header) header(); } }
    function title(t, sub) { ensure(60); ctx.font = font(700, 22); ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.direction = 'ltr'; ctx.fillText(t, M, y + 14); if (sub) { ctx.font = font(400, 15); ctx.fillStyle = '#555'; ctx.fillText(sub, M + ctx.measureText(t).width + 260, y + 14); } y += 32; }
    // cols: [{h, w, k}], rows: arrays of cells ({t, warn, bold})
    function table(name, cols, rows) {
      const tw = W - 2 * M, sum = cols.reduce((s, c) => s + c.w, 0), sc = tw / sum, rh = 30, hh = 40;
      const header = () => { let x = M; for (const c of cols) { cell(x, y, c.w * sc, hh, c.h, { fill: '#e8eaee', bold: true, size: 15 }); x += c.w * sc; } y += hh; };
      ensure(28 + hh + rh * Math.min(rows.length, 3)); title(name); header();
      for (const r of rows) {
        ensure(rh, () => { title(name + ' (cont.)'); header(); }); let x = M;
        r.forEach((v, i) => { const o = v && typeof v === 'object' ? v : { t: v }; cell(x, y, cols[i].w * sc, rh, o.t, { align: i === 0 ? 'left' : 'center', bold: i === 0 || o.bold, fill: o.warn ? '#fff1da' : o.down ? '#fde2e1' : null, color: o.warn ? '#8f4d00' : o.down ? '#b42318' : '#111' }); x += cols[i].w * sc; });
        y += rh;
      }
      y += 18;
    }
    function infoBox(items) {
      const lw = 190, vw = 420, rh = 36; for (const [k, v] of items) { cell(M, y, lw, rh, k, { fill: '#e8eaee', bold: true, align: 'left' }); cell(M + lw, y, vw, rh, v, { bold: true, size: 18, align: 'left' }); y += rh; }
      y += 20;
    }
    newPage();
    return { table, infoBox, title, done: () => { pages.push(c); return pages; }, get y() { return y; } };
  }

  function sheetPages(S, seed, wells, L, aid, day, now) {
    const a = seed.areas.find(x => x.id === aid), D = S.days[day] || { r: {}, d: {}, p: {} }, h = S.cfg.prodDayStart;
    const [s0, e0] = L.dayWindow(day, h), endT = Math.min(e0, now);
    const ws = wells.filter(w => w.a === aid && (!w.hid || D.r[w.id])).sort((x, y) => x.o - y.o);
    const tanks = seed.tanks.filter(t => t.a === aid);
    const ops = new Set(); for (const w of ws) { const r = D.r[w.id]; if (r && r.byn) ops.add(r.byn); }
    for (const t of tanks) { const x = D.d[t.id]; if (x && x.byn) ops.add(x.byn); }
    for (const w of ws) { const x = (D.c || {})[w.id]; if (x && x.byn) ops.add(x.byn); }
    const P = Pager();
    const pl = (S.plan || {})[day + '|' + aid]; if (pl) for (const n of pl.staff) ops.add(String(n).split(' · ')[0]);
    P.infoBox([['Survey Area', a.full + '  (' + a.n + ')'], ['Date', day + '  (from ' + String(h).padStart(2, '0') + ':00)'], ['Operator Name', [...ops].join(' · ') || '—']]);
    const num = v => { if (v == null || v === '') return ''; const x = L.toNum(v); return x == null ? v : x; };
    const status = w => { const e = S.dt.find(x => x.w === w.id && x.s <= endT && (x.e == null || x.e > endT)); if (e) return { t: 'Down · ' + e.r, down: true }; const u = L.uptime(S.dt, w.id, day, h, now); return u.down > 0 ? { t: `On ${u.up}h`, warn: true } : ''; };
    const dsl = w => { const v = tanks.filter(t => t.w.includes(w.id)).map(t => D.d[t.id] ? D.d[t.id].v : '').filter(x => x !== ''); if (!v.length) return ''; const low = v.some(x => L.toNum(x) < S.cfg.dieselMin); return { t: v.join('-') + '%', warn: low }; };
    const csg = v => v === 'F' ? 'Flare' : v === 'P' ? 'Prod.' : v === 'C' ? 'Closed' : '';
    const order = ['NF', 'PL', 'ESP', 'SRP', 'WSW', 'WIW', 'GL'];
    const COLS = {
      NF: [['Well Name', 'n', 3], ['WHP', 'WHP'], ['FLP', 'FLP'], ['CSGP', 'CSGP'], ['P. Choke', 'CHK'], ['SCSSSV P.', 'SSSV', 1.2], ['SSV P.', 'SSV'], ['Status', 'st', 2.2]],
      PL: [['Well Name', 'n', 3], ['WHP', 'WHP'], ['FLP', 'FLP'], ['CSGP', 'CSGP'], ['Status', 'st', 2.2]],
      ESP: [['ESP Well Name', 'n', 2.6], ['WHP', 'WHP'], ['FLP', 'FLP'], ['CSGP', 'CSGP'], ['CSG', 'CSG'], ['Amp', 'AMP'], ['Hz', 'HZ'], ['PI', 'PI'], ['PD', 'PD'], ['Ti', 'TI'], ['Tm', 'TM'], ['Diesel', 'dsl', 1.3], ['Status', 'st', 1.8]],
      SRP: [['SRP Well Name', 'n', 2.6], ['WHP', 'WHP'], ['FLP', 'FLP'], ['CSGP', 'CSGP'], ['CSG', 'CSG'], ['Run %', 'RUN'], ['Sam rate', 'INFO'], ['Fillage', 'FILL'], ['Speed', 'PSPD'], ['Peak', 'PEAK'], ['Min', 'MINL'], ['Fluid', 'FLD'], ['SPM', 'SPM'], ['Diesel', 'dsl', 1.3], ['Status', 'st', 1.8]],
      WSW: [['WSW Well Name', 'n', 2.6], ['WHP', 'WHP'], ['FLP', 'FLP'], ['CSGP', 'CSGP'], ['CSG', 'CSG'], ['Amp', 'AMP'], ['Hz', 'HZ'], ['PI', 'PI'], ['PD', 'PD'], ['Ti', 'TI'], ['Tm', 'TM'], ['Diesel', 'dsl', 1.3], ['Status', 'st', 1.8]],
      WIW: [['WIW Well Name', 'n', 2.6], ['WHIP', 'WHIP'], ['FLP', 'FLP'], ['CSGP', 'CSGP'], ['CSG', 'CSG'], ['Inj. Rate', 'INJ', 1.2], ['Target', 'tg', 1.2], ['Status', 'st', 2]],
      GL: [['Gas Lift Well Name', 'n', 2.6], ['WHIP', 'WHIP'], ['FLP', 'FLP'], ['DS', 'DS'], ['US', 'US'], ['Diff', 'DIFF'], ['Temp', 'TEMP'], ['Gas Inj.', 'q', 1.2], ['Target', 'tg', 1.1], ['Metering', 'm', 1.6], ['Status', 'st', 1.8]],
    };
    const TN = { NF: 'Natural Flow', PL: 'Plunger Lift', ESP: 'ESP', SRP: 'SRP', WSW: 'WSW (Water Source)', WIW: 'WIW (Water Injection)', GL: 'Gas Lift' };
    for (const t of order) {
      const list = ws.filter(w => w.t === t); if (!list.length) continue;
      const cols = COLS[t].map(([hh, k, w]) => ({ h: hh, k, w: w || 1 }));
      const rows = list.map(w => {
        const r = D.r[w.id], v = r ? r.v : {};
        return cols.map(c => {
          if (c.k === 'n') return w.n; if (c.k === 'st') return status(w); if (c.k === 'dsl') return dsl(w); if (c.k === 'CSG') return csg(v.CSG);
          if (c.k === 'tg') return w.tg ?? ''; if (c.k === 'm') return w.m || (w.k ? 'Orifice' : '');
          if (c.k === 'q') { const q = L.gasValue(w, v); if (q == null) return ''; const g = L.gasDiff(w, q, S.cfg.gasDiffPct); return { t: q.toFixed(3), warn: g && g.bad }; }
          if (c.k === 'INJ' && w.tg > 0) { const x = L.toNum(v.INJ); return x == null ? '' : { t: x, warn: x < 0.8 * w.tg }; }
          return num(v[c.k]);
        });
      });
      P.table(TN[t], cols, rows);
    }
    const pts = seed.points.filter(p => p.a === aid).sort((x, y) => x.o - y.o), prow = [];
    for (const p of pts) for (const hd of p.h) { const x = D.p[p.id]; prow.push([p.n, hd || '', x ? num(x.h[hd || '-']) : '']); }
    if (prow.length) P.table('Manifolds & Lines', [{ h: 'Point', w: 4 }, { h: 'Header', w: 1 }, { h: 'Pressure (psi)', w: 1.6 }], prow);
    const trow = tanks.filter(t => !t.w.length || t.w.some(id => ws.find(w => w.id === id))).map(t => { const x = D.d[t.id], v = x ? L.toNum(x.v) : null; return [t.place, t.code || 'NA', t.cap ? t.cap.toLocaleString('en') : '', v == null ? '' : { t: v + '%', warn: v < S.cfg.dieselMin }]; });
    if (trow.length) P.table('Diesel Tanks', [{ h: 'Place', w: 3 }, { h: 'Code', w: 1.4 }, { h: 'Capacity (L)', w: 1.5 }, { h: 'Level', w: 1.2 }], trow);
    const crow = [], C = D.c || {};
    for (const w of ws) for (const code of (w.ch || [])) { const x = C[w.id], v = x && x.v ? L.toNum(x.v[code]) : null, mn = L.chemMin(S.cfg, code); crow.push([w.n, L.CHEM_N[code] || code, v == null ? '' : { t: v + '%', warn: v < mn }]); }
    if (crow.length) P.table('Chemical Tanks', [{ h: 'Well', w: 2.4 }, { h: 'Chemical', w: 3.4 }, { h: 'Level', w: 1.2 }], crow);
    const ev = S.dt.filter(e => { const w = ws.find(x => x.id === e.w); return w && e.s < e0 && (e.e == null || e.e > s0); }).sort((x, y) => x.s - y.s);
    if (ev.length) P.table('Downtime', [{ h: 'Well', w: 2 }, { h: 'Reason', w: 3.4 }, { h: 'Details', w: 2.4 }, { h: 'From', w: 1.9 }, { h: 'To', w: 1.9 }], ev.map(e => [ws.find(x => x.id === e.w).n, { t: e.r, down: !e.e }, e.o || '', L.stamp(e.s), e.e ? L.stamp(e.e) : 'still down']));
    const notes = ws.filter(w => D.r[w.id] && D.r[w.id].n).map(w => [w.n, D.r[w.id].n]);
    if (notes.length) P.table('Comments', [{ h: 'Well', w: 1.4 }, { h: 'Comment', w: 6 }], notes);
    const sm = S.samples.filter(s => s.day === day && (s.w ? ws.find(w => w.id === s.w) : false)).sort((x, y) => x.ts - y.ts);
    if (sm.length) P.table('Samples', [{ h: 'Time', w: 1 }, { h: 'Point', w: 2.5 }, { h: 'Sample', w: 1.2 }, { h: 'Technician', w: 2.5 }], sm.map(s => [L.hhmm(s.ts), ws.find(w => w.id === s.w).n, s.kind === 'W' ? 'Water' : 'Oil', s.byn || '']));
    return P.done();
  }

  async function buildPdf(S, seed, wells, L, opt) {
    const canv = [];
    for (let d = opt.from; d <= opt.to; d = L.addDays(d, 1)) for (const aid of opt.areas) canv.push(...sheetPages(S, seed, wells, L, aid, d, opt.now || Date.now()));
    const pages = [];
    for (const c of canv) {
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82)); const buf = new Uint8Array(await blob.arrayBuffer());
      pages.push({ jpeg: buf, w: c.width, h: c.height });
    }
    return pdfFromJpegs(pages);
  }
  // the same pages as pictures, to send on WhatsApp
  async function buildImages(S, seed, wells, L, opt) {
    const out = [];
    for (let d = opt.from; d <= opt.to; d = L.addDays(d, 1)) for (const aid of opt.areas) {
      const cs = sheetPages(S, seed, wells, L, aid, d, opt.now || Date.now());
      for (const [i, c] of cs.entries()) { const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); out.push({ name: `survey_${aid}_${d}${cs.length > 1 ? '_' + (i + 1) : ''}.jpg`, jpeg: new Uint8Array(await blob.arrayBuffer()) }); }
    }
    return out;
  }
  // the manifold readings of one area and day as a picture (cut to the length of the table)
  async function manifoldImages(S, seed, L, aid, day) {
    const a = seed.areas.find(x => x.id === aid), D = S.days[day] || { p: {} }, h = S.cfg.prodDayStart;
    const pts = seed.points.filter(p => p.a === aid).sort((x, y) => x.o - y.o), ops = new Set(), prow = [];
    for (const p of pts) { const x = D.p[p.id]; if (x && x.byn) ops.add(x.byn); for (const hd of p.h) { const v = x ? x.h[hd || '-'] : ''; const n = L.toNum(v); prow.push([p.n, hd || '', v == null || v === '' ? '' : n == null ? v : n, x && x.t && v != null && v !== '' ? L.hhmm(x.t) : '']); } }
    const P = Pager();
    P.infoBox([['Survey Area', a.full + '  (' + a.n + ')'], ['Date', day + '  (from ' + String(h).padStart(2, '0') + ':00)'], ['Operator Name', [...ops].join(' · ') || '—']]);
    P.table('Manifolds & Lines', [{ h: 'Point', w: 4 }, { h: 'Header', w: 1 }, { h: 'Pressure (psi)', w: 1.6 }, { h: 'Time', w: 1 }], prow);
    const endY = P.y, pages = P.done(), out = [];
    for (const [i, c] of pages.entries()) {
      let cv = c;
      if (i === pages.length - 1) { const hh = Math.min(H, Math.ceil(endY + M / 2)); cv = document.createElement('canvas'); cv.width = W; cv.height = hh; cv.getContext('2d').drawImage(c, 0, 0); }
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
      out.push({ name: `manifold_${aid}_${day}${pages.length > 1 ? '_' + (i + 1) : ''}.jpg`, jpeg: new Uint8Array(await blob.arrayBuffer()) });
    }
    return out;
  }
  // the day's staff distribution as one clear picture for WhatsApp: every group under the other, name on the right, phone on the left
  async function staffImage(title, sub, groups) {
    const IW = 1080, PAD = 48, GH = 66, RH = 62, GAP = 22, HEAD = 150;
    const rows = groups.reduce((n, g) => n + Math.max(1, g.people.length), 0);
    const IH = HEAD + groups.length * (GH + GAP) + rows * RH + 70;
    const c = document.createElement('canvas'); c.width = IW; c.height = IH; const x = c.getContext('2d');
    const font = (w, sz) => `${w} ${sz}px system-ui, "Noto Sans Arabic", Arial, sans-serif`;
    const txt = (t, px, py, o) => { o = o || {}; x.font = font(o.w || 400, o.size || 32); x.fillStyle = o.color || '#111'; const rtl = o.rtl != null ? o.rtl : /[؀-ۿ]/.test(String(t)); x.direction = rtl ? 'rtl' : 'ltr'; x.textAlign = o.align || 'right'; x.fillText(String(t), px, py); };
    x.fillStyle = '#fff'; x.fillRect(0, 0, IW, IH); x.textBaseline = 'middle';
    x.fillStyle = '#121519'; x.fillRect(0, 0, IW, HEAD - 30);
    txt(title, IW - PAD, 46, { w: 800, size: 44, color: '#fff', rtl: true });
    txt(sub, IW - PAD, 92, { size: 28, color: '#d7dbe2', rtl: true });
    let y = HEAD;
    for (const g of groups) {
      x.fillStyle = g.job ? '#fff1da' : '#e8eefc'; x.fillRect(PAD / 2, y, IW - PAD, GH);
      x.strokeStyle = '#121519'; x.lineWidth = 2; x.strokeRect(PAD / 2 + 1, y + 1, IW - PAD - 2, GH - 2);
      txt(g.title, IW - PAD, y + GH / 2, { w: 800, size: 36, rtl: true });
      const k = g.people.length; txt(k === 1 ? 'فرد' : k === 2 ? 'فردين' : k ? k + (k < 11 ? ' أفراد' : ' فرد') : '', PAD, y + GH / 2, { size: 28, color: '#575d66', align: 'left', rtl: false });
      y += GH;
      if (!g.people.length) { txt('محدش', IW - PAD, y + RH / 2, { size: 30, color: '#8a9099', rtl: true }); y += RH; }
      for (const [i, p] of g.people.entries()) {
        if (i) { x.strokeStyle = '#dcdee2'; x.lineWidth = 1; x.beginPath(); x.moveTo(PAD, y + .5); x.lineTo(IW - PAD, y + .5); x.stroke(); }
        txt(p.n, IW - PAD, y + RH / 2, { w: 700, size: 34 });
        if (p.ph) txt(p.ph, PAD, y + RH / 2, { size: 32, color: '#1b3db8', align: 'left', rtl: false });
        y += RH;
      }
      y += GAP;
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    return new Uint8Array(await blob.arrayBuffer());
  }
  root.PDF = { buildPdf, buildImages, manifoldImages, pdfFromJpegs, staffImage };
})(typeof self !== 'undefined' ? self : this);
