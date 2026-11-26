/* The daily "AG Production Activity" email, in the shape the AG production engineers send it: the day's jobs on the
   wells, the intermittent wells opened and shut in, the deferred production (the day's downtime against yesterday's), the
   water-flood network (the engineer's WF dashboard), the samples. What the app does not know stays "**" in yellow, as the
   engineers mark what is left to fill; the engineer finishes it in Outlook.
   build(o) -> { subject, html, body (the html inside <body>, to paste), to, cc, notes }; eml(m) -> the text of an .eml that Outlook opens as a new email. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dmy = d => `${d.slice(8, 10)}-${MON[+d.slice(5, 7) - 1]}-${d.slice(0, 4)}`;
  const AR = /[؀-ۿ]/;
  const n0 = v => Math.round(v).toLocaleString('en-US');

  // the technician's reasons in the email's words (the engineer's Avocet reasons are English already)
  const REASON = { 'Generator صيانة': 'Generator PM', 'Generator مشكلة': 'Generator problem', Wireline: 'W/L work', Treatment: 'Chemical treatment', Workover: 'Workover', Underload: 'Underload', Overload: 'Overload', 'No RPM': 'No RPM signal', 'Flowline (مشكلة في الخط)': 'Flowline problem', 'INTERMITTENT PRODUCTION': 'Intermittent production', SI: 'S/I' };
  const WORKEN = { 'بلوف': 'Valves work', 'حفار': 'Rig work', 'شغل تاني': '' };
  const reasonText = e => { const r = REASON[e.r] || (e.r === 'Other' ? '' : e.r || ''), o = e.o && !AR.test(e.o) ? e.o : ''; return [r, o].filter(Boolean).join(', ') || '**'; };

  // a well's name in the email: the short name it is known by when the app's adds a suffix (XY-12ST: XY-12)
  const nameOf = w => (w.p && w.n.startsWith(w.p) ? w.p : w.n);
  // XY-1, XY-2, XY-7, ABC-02 -> XY-(1, 2, 7), ABC-02 (the wells of one field together, as the engineers write them)
  function names(ws) {
    const ns = ws.map(nameOf), grp = new Map(), out = [];
    for (const n of ns) { const m = n.match(/^([A-Z]+)-(\d+[A-Z0-9]*)$/i); const k = m ? m[1].toUpperCase() : null; if (k) { if (!grp.has(k)) grp.set(k, []); grp.get(k).push(m[2]); } }
    const done = new Set();
    for (const n of ns) {
      const m = n.match(/^([A-Z]+)-(\d+[A-Z0-9]*)$/i), k = m ? m[1].toUpperCase() : null;
      if (k && grp.get(k).length > 1) { if (!done.has(k)) { done.add(k); out.push(`${k}-(${grp.get(k).join(', ')})`); } }
      else out.push(n);
    }
    return out.join(', ');
  }

  /* the intermittent rotation: two groups of wells, one opened (about 12 hours of production) and the other shut in, turned
     over every day. rot: { a: [ids], b: [ids], ref: day, open: 'a'|'b' (the group opened that day), on, oil: { a, b } (each
     group's oil while opened: the engineers' theoretical figure) } */
  function rotOn(rot, day, L) {
    if (!rot || !rot.on || !rot.ref || !(rot.a || []).length || !(rot.b || []).length) return null;
    const k = Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(rot.ref + 'T12:00:00Z')) / 864e5);
    const open = ((k % 2) + 2) % 2 === 0 ? rot.open : rot.open === 'a' ? 'b' : 'a';
    return { open: rot[open], shut: rot[open === 'a' ? 'b' : 'a'], ko: open, ks: open === 'a' ? 'b' : 'a' };
  }

  // the oil truck of a well's EPF every other day: mtk { on, ref: day, yes (a truck that day), bbl }
  function truckOn(mtk, day) {
    if (!mtk || !mtk.on || !mtk.ref) return null;
    const k = Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(mtk.ref + 'T12:00:00Z')) / 864e5);
    return ((k % 2) + 2) % 2 === 0 ? !!mtk.yes : !mtk.yes;
  }

  // ---------------- the deferred production: the day's downtime against yesterday's ----------------
  function deferred(o) {
    const { S, L, wells, day, H, now, testOf } = o, yd = L.addDays(day, -1);
    const [s0, e0] = L.dayWindow(day, H), [y0, y1] = L.dayWindow(yd, H), T = Math.min(e0, now);
    const rt = rotOn(o.rot, day, L), inRot = new Set(rt ? rt.open.concat(rt.shut) : []), byId = new Map(wells.map(w => [w.id, w]));
    // (a stop still open counts to the day's end; the hours an approved report set win)
    const downH = (w, d, a, b) => { const fx = L.hfixOf(S, d, w.id); return typeof fx === 'number' ? 24 - fx : Math.min(24, L.wholeH(L.downMs(S.dt, w.id, a, b))); };
    const bopd = w => { const t = testOf(w); return t ? t.bopd || 0 : null; };
    const rows = [];
    if (rt) {
      const ow = rt.open.map(id => byId.get(id)).filter(Boolean), sw = rt.shut.map(id => byId.get(id)).filter(Boolean);
      // the oil against yesterday: the group's theoretical figure (opened: +, shut in: -); without one, its wells' tests for 12 hours
      const sum = ws => ws.some(w => bopd(w) == null) ? null : ws.reduce((a, w) => a + bopd(w), 0) * 12 / 24;
      const oil = (k, ws) => o.rot.oil && typeof o.rot.oil[k] === 'number' ? o.rot.oil[k] : sum(ws);
      const so = oil(rt.ko, ow), ss = oil(rt.ks, sw);
      if (ow.length) rows.push({ n: names(ow), dt: 12, r: 'Scheduled Intermittent Production [Back to production].', diff: so == null ? null : so });
      if (sw.length) rows.push({ n: names(sw), dt: 24, r: 'Scheduled Intermittent Production. [Still Down].', diff: ss == null ? null : -ss });
    }
    const tk = truckOn(o.mtk, day), tn = o.fix && o.fix.truck && o.fix.truck.n;
    if (tk != null && tn) rows.push({ n: tn, dt: 0, r: `Received ${tk ? 'one' : 'no'} oil truck today from the well’s EPF.`, diff: typeof o.mtk.bbl === 'number' ? (tk ? o.mtk.bbl : -o.mtk.bbl) : null });
    const down = [], back = [];
    for (const w of wells) {
      if (w.hid || w.t === 'WSW' || w.t === 'WIW' || inRot.has(w.id)) continue;
      // (running all day both days, or down all day both days: nothing new to tell, the table would never end; a well that
      // stopped is told the day it stopped and the day it ran again)
      const dT = downH(w, day, s0, e0), dY = downH(w, yd, y0, y1); if (!dT && !dY) continue; if (dT >= 24 && dY >= 24) continue;
      const b = bopd(w), diff = b == null ? null : b * (dY - dT) / 24;
      if (!dT) { back.push({ w, dt: 0, r: 'On production 24 hrs.', diff }); continue; }
      // the cause: the day's longest stop; still down at the day's end (or now)
      let main = null, len = -1;
      for (const e of S.dt) { if (e.w !== w.id) continue; const a = Math.max(e.s, s0), z = Math.min(e.e == null ? e0 : e.e, e0); if (z > a && z - a > len) { len = z - a; main = e; } }
      const still = S.dt.some(e => e.w === w.id && e.s < T && (e.e == null || e.e >= T));
      const more = dY && dY !== dT ? `, ${dT > dY ? 'More' : 'Less'} DT ${Math.abs(dT - dY)} hrs` : dY && dY === dT && dT < 24 ? `, Same DT as y'day` : '';
      down.push({ w, dt: dT, r: `${main ? reasonText(main) : '**'}${more}. [${still ? 'Still Down' : 'Back to production'}]`, diff });
    }
    // the wells with the same hours and remarks in one row
    const merge = list => { const m = new Map(); for (const x of list) { const k = x.dt + '|' + x.r; if (!m.has(k)) m.set(k, { ws: [], dt: x.dt, r: x.r, diff: 0 }); const g = m.get(k); g.ws.push(x.w); g.diff = g.diff == null || x.diff == null ? null : g.diff + x.diff; } return [...m.values()].map(g => ({ n: names(g.ws), dt: g.dt, r: g.r, diff: g.diff })); };
    rows.push(...merge(down.sort((x, y) => y.dt - x.dt)), ...merge(back));
    const total = rows.some(r => r.diff == null) ? null : rows.reduce((a, r) => a + r.diff, 0);
    return { rows, total, rot: rt ? { open: names(rt.open.map(id => byId.get(id)).filter(Boolean)), shut: names(rt.shut.map(id => byId.get(id)).filter(Boolean)) } : null };
  }

  // ---------------- the day's jobs on the wells (the engineer's plan): the email's opening part ----------------
  function jobs(o) {
    const { S, wells, day } = o, byId = new Map(wells.map(w => [w.id, w])), out = [], gpm = [];
    for (const k of Object.keys(S.plan || {}).filter(k => k.startsWith(day + '|')).sort()) {
      const p = S.plan[k] || {};
      for (const m of p.maint || []) {
        const ws = (m.w || []).map(id => byId.get(id)).filter(Boolean); if (!ws.length) continue;
        if (m.k === 'stop' || m.k === 'sync') { gpm.push(...ws); continue; }
        out.push({ h: names(ws), b: [m.n && !AR.test(m.n) ? m.n : 'Maintenance' + (m.n ? ': **' : '')] });
      }
      for (const x of p.work || []) {
        const w = byId.get(x.w); if (!w) continue;
        const kind = WORKEN[x.k] != null ? WORKEN[x.k] : x.k, note = x.n ? (AR.test(x.n) ? '**' : x.n) : '';
        out.push({ h: nameOf(w) + (kind ? ` (${kind})` : ''), b: [note || (kind ? kind + '.' : '**')] });
      }
    }
    out.gpm = gpm;
    return out;
  }

  // a standing comment's values: {p:POINT:LINE} the day's reading of a pressure point, {d:POINT:LINE} its change against
  // yesterday's (" (+7)"), {t:POINT} the time it was read, {truck} one / no (the EPF's oil truck that day)
  function fill(t, o) {
    const D = (o.S.days || {})[o.day] || {}, P = D.p || {}, Y = ((o.S.days || {})[o.L.addDays(o.day, -1)] || {}).p || {};
    const pv = (Q, id, hd) => { const x = Q[id], v = x && x.h ? String(x.h[hd] ?? '').trim() : ''; return /^-?\d+(\.\d+)?$/.test(v) ? +v : null; };
    const tk = truckOn(o.mtk, o.day);
    return String(t).replace(/\{d:([^:}]+):([^}]+)\}/g, (m, id, hd) => { const a = pv(P, id, hd), b = pv(Y, id, hd); if (a == null || b == null || a === b) return ''; const x = Math.round((a - b) * 10) / 10; return ` (${x > 0 ? '+' : ''}${x})`; })
      .replace(/\{truck\}/g, tk == null ? '**' : tk ? 'one' : 'no').replace(/\{p:([^:}]+):([^}]+)\}/g, (m, id, hd) => { const x = P[id], v = x && x.h ? x.h[hd] : null; return v != null && v !== '' ? String(v) : '**'; })
      .replace(/\{t:([^}]+)\}/g, (m, id) => { const x = P[id]; if (!x || !x.t || !x.h || !Object.keys(x.h).length) return '09:00 AM'; const d = new Date(x.t), h = d.getHours(), mi = d.getMinutes(); return `${String(h % 12 || 12).padStart(2, '0')}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; });
  }

  // ---------------- the HTML (inline styles: Outlook keeps those) ----------------
  const F = 'font-family:Calibri,Arial,sans-serif;';
  const HL = 'background:#FFF2CC;color:#77510B;font-weight:bold;';   // what the engineer still has to fill (the palette's soft amber)
  const hl = s => `<span style="${HL}">${esc(s)}</span>`;
  const txt = s => String(s).split(/(\*\*+)/).map(p => /^\*\*+$/.test(p) ? hl(p) : esc(p)).join('');
  const title = s => `<p style="margin:20px 0 8px;padding-bottom:3px;${F}font-size:14pt;font-weight:bold;color:#294B5C;border-bottom:2px solid #CFDAE2">${esc(s)}</p>`;
  // (the comments and the tables in the colours of the engineer's WF dashboard)
  const head = s => `<p style="margin:12px 0 3px;${F}font-size:11.5pt;font-weight:bold;color:#2F566A">${txt(s)}</p>`;
  const bullets = list => `<ul style="margin:0 0 0 24px;padding:0;color:#6B8493">${list.map(b => `<li style="${F}font-size:11pt;color:#243746;margin:1px 0">${txt(b)}</li>`).join('')}</ul>`;
  const line = s => `<p style="margin:0;${F}font-size:11pt;color:#243746">${s}</p>`;

  function deferredHtml(D) {
    const th = (s, al) => `<th style="${F}font-size:10pt;font-weight:bold;color:#FFFFFF;background:${C.h1};border:1px solid ${C.group};padding:5px 8px;text-align:${al || 'center'}">${s}</th>`;
    const td = (s, o) => `<td${o.cs ? ` colspan="${o.cs}"` : ''} style="${F}font-size:10pt;color:${o.fg || C.ink};background:${o.bg || '#FFFFFF'};${o.b ? 'font-weight:bold;' : ''}border:1px solid ${C.rule};padding:4px 8px;text-align:${o.al || 'center'};vertical-align:middle">${s}</td>`;
    // the hours down in bold; the oil against yesterday: more in green, less in red, none in grey (the text only: calm)
    const dt = (v, bg) => td(String(v), v > 0 ? { bg, b: 1 } : { bg, fg: C.na[1] });
    const diff = (v, o) => { if (v == null) return td(hl('**'), o); const r = Math.round(v); return r > 0 ? td('+' + n0(r), Object.assign({}, o, { fg: C.good[1], b: 1 })) : r < 0 ? td(n0(r), Object.assign({}, o, { fg: C.zero[1], b: 1 })) : td('0', Object.assign({}, o, { fg: C.na[1] })); };
    let h = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:680px"><tr>${th('Well')}${th('DT<br>Hrs.')}${th('Remarks', 'left')}${th('Oil<br>Diff.')}</tr>`;
    D.rows.forEach((r, i) => { const bg = i % 2 ? C.alt : '#FFFFFF'; h += `<tr>${td(txt(r.n), { bg, fg: C.name, b: 1 })}${dt(r.dt, bg)}${td(txt(r.r), { bg, al: 'left' })}${diff(r.diff, { bg })}</tr>`; });
    h += `<tr>${td('Total Oil Diff.', { cs: 3, bg: C.soft, b: 1, al: 'right' })}${diff(D.total, { bg: C.soft, b: 1 })}</tr></table>`;
    return h;
  }

  // the WF dashboard: the colours of the engineer's sheet
  const C = { ink: '#243746', name: '#2F566A', rule: '#CFDAE2', group: '#6B8493', h1: '#365B6D', h2: '#426D7E', soft: '#EAF2F7', alt: '#F5F8FA',
    good: ['#BFDCC8', '#21553A'], part: ['#FFE1A3', '#77510B'], zero: ['#EDC2BF', '#863F3A'], na: ['#DCE2E6', '#5F6C75'], hrs: [null, '#9C6500'], miss: [null, '#9C6500'], old: ['#FFF2CC', '#77510B'] };
  function wfHtml(rows, day) {
    const th = (s, bg) => `<th style="${F}font-size:10pt;font-weight:bold;color:#FFFFFF;background:${bg};border:1px solid ${C.group};padding:4px 6px;text-align:center">${s}</th>`;
    const cell = (s, o) => `<td${o.rs ? ` rowspan="${o.rs}"` : ''} style="${F}font-size:10pt;color:${o.fg || C.ink};background:${o.bg || o.row || '#FFFFFF'};${o.b ? 'font-weight:bold;' : ''}border:1px solid ${C.rule};${o.top ? `border-top:2px solid ${C.group};` : ''}padding:3px 6px;text-align:${o.al || 'center'};vertical-align:middle">${s}</td>`;
    // a reading: the day's; the newest before it in yellow; none: Missing
    const rd = (x, o) => x.miss ? cell('Missing', Object.assign({}, o, { bg: C.miss[0] || o.bg, fg: C.miss[1] })) : cell(n0(x.v), x.o ? Object.assign({}, o, { bg: C.old[0], fg: C.old[1] }) : o);
    const pc = (p, o) => p == null ? cell('Missing', Object.assign({}, o, { bg: C.miss[0] || o.bg, fg: C.miss[1] })) : p === 'N/A' ? cell('N/A', Object.assign({}, o, { bg: C.na[0], fg: C.na[1] }))
      : cell((p * 100).toFixed(1) + '%', Object.assign({}, o, { b: 1 }, p >= 1 ? { bg: C.good[0], fg: C.good[1] } : p > 0 ? { bg: C.part[0], fg: C.part[1] } : { bg: C.zero[0], fg: C.zero[1] }));
    const hr = (x, o) => x.miss ? cell('Missing', Object.assign({}, o, { bg: C.miss[0] || o.bg, fg: C.miss[1] })) : cell(String(x.v), x.v !== 24 ? Object.assign({}, o, { bg: C.hrs[0] || o.bg, fg: C.hrs[1], b: 1 }) : o);
    const cz = (c, o) => cell(esc(c || '—'), c === 'Not recorded' ? Object.assign({}, o, { fg: C.hrs[1], al: 'left' }) : Object.assign({}, o, { al: c && c !== '—' ? 'left' : 'center' }));
    let h = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <tr><td colspan="17" style="${F}font-size:13pt;font-weight:bold;color:#FFFFFF;background:#294B5C;padding:6px 8px">WATERFLOOD | DAILY ACTIVITY · ${esc(dmy(day))}</td></tr><tr>`;
    // (the source wells' design capacity and the percent of it: not exact, left out)
    for (const s of ['Source well', 'WHP<br>psi', 'FLP<br>psi', 'Amps<br>A', 'Freq.<br>Hz', 'Inj. total<br>bbl', 'Online<br>hrs/day', 'Downtime cause']) h += th(s, C.h1);
    for (const s of ['Injector well', 'WHIP<br>psi', 'CSG<br>psi', 'Actual<br>bbl', 'Target<br>bbl', 'Achieved<br>%', 'Support for wells', 'Online<br>hrs/day', 'Downtime cause']) h += th(s, C.h2);
    h += '</tr>';
    rows.forEach((s, gi) => {
      const bg = gi % 2 ? C.alt : '#FFFFFF', n = Math.max(1, s.inj.length);
      for (let i = 0; i < n; i++) {
        const x = s.inj[i], top = i === 0, o = { bg, top };
        h += '<tr>';
        if (top) {
          const so = { bg, top, rs: n };
          h += cell(esc(s.w.n), Object.assign({}, so, { fg: C.name, b: 1 })) + rd(s.whp, so) + rd(s.flp, so) + rd(s.amp, so) + rd(s.hz, so);
          h += s.tot == null ? cell('Missing', Object.assign({}, so, { bg: C.miss[0] || so.bg, fg: C.miss[1] })) : cell(n0(s.tot), Object.assign({}, so, { bg: C.soft, fg: s.part ? C.hrs[1] : C.ink, b: 1 }));
          h += hr(s.h, so) + cz(s.c, Object.assign({}, so, { bg: C.soft }));
        }
        if (x) h += cell(esc(x.w.n), Object.assign({}, o, { fg: C.name, b: 1 })) + rd(x.whip, o) + rd(x.csg, o) + (x.act.miss ? cell('Missing', Object.assign({}, o, { bg: C.miss[0] || o.bg, fg: C.miss[1] })) : cell(n0(x.act.v), Object.assign({}, o, x.act.o ? { bg: C.old[0], fg: C.old[1], b: 1 } : { bg: C.soft, b: 1 })))
          + cell(n0(x.tg), o) + pc(x.pct, o) + cell(esc(x.sup), Object.assign({}, o, { fg: C.name, b: 1, al: 'left' })) + hr(x.h, o) + cz(x.c, Object.assign({}, o, { bg: C.soft }));
        else h += cell('', o).repeat(9);
        h += '</tr>';
      }
    });
    h += '</table>';
    // what was not read that day: the date of the reading shown
    const old = [];
    for (const s of rows) {
      const one = (w, xs) => { const d = xs.filter(x => x && x.o).map(x => x.d).sort().pop(); if (d) old.push(`${w.n} (${dmy(d).slice(0, 6)})`); };
      one(s.w, [s.whp, s.flp, s.amp, s.hz]); for (const x of s.inj) one(x.w, [x.whip, x.csg, x.act]);
    }
    if (old.length) h += `<p style="margin:6px 0 0;${F}font-size:9pt;color:#607887"><span style="${HL}">Yellow</span>: not read today, the last reading is shown: ${esc(old.join(', '))}.</p>`;
    return { html: h, old: old.length };
  }

  function build(o) {
    const { S, L, day } = o, D = deferred(o), J = jobs(o), W = o.AV.wfDash(Object.assign({}, o, { net: o.net }));
    const samples = (S.samples || []).filter(s => s.day === day), byId = new Map(o.wells.map(w => [w.id, w]));
    const sn = k => { const l = samples.filter(s => s.kind === k).map(s => { const w = byId.get(s.w); return w ? nameOf(w) : s.pt; }).filter(Boolean); return [...new Set(l)].join(', '); };
    let h = `<div style="${F}font-size:11pt;color:#000">`;
    for (const j of J) h += head(j.h) + bullets(j.b);
    if (!J.length) h += head('**') + bullets(['**']);
    // the standing comments of every email: Generator PM (the day's generator maintenance), then the engineer's fixed ones
    h += head('Generator PM') + bullets([J.gpm.length ? names(J.gpm) : '**']);
    for (const f of (o.pmail && o.pmail.fixed) || []) h += head(f.h) + bullets((f.b || []).map(b => fill(b, o)));
    if (D.rot) h += head('Intermittent Flow Wells') + bullets([`Open the following wells ${D.rot.open}.`, `SI the following wells ${D.rot.shut}.`]);
    h += title('Deferred Production:') + deferredHtml(D);
    const wf = wfHtml(W, day);
    h += title('Water Flood System:') + wf.html;
    h += title('Samples:');
    const oil = sn('O'), water = sn('W'), diesel = sn('D');
    h += line(`Collected oil samples from wells: ( ${oil ? esc(oil) : hl('**')} )`);
    if (water) h += line(`Collected water samples from wells: ( ${esc(water)} )`);
    h += line(`Collected diesel samples from wells: ( ${diesel ? esc(diesel) : hl('**')} )`);
    h += title('Daily Production Survey:') + line('See the daily production survey report.');
    h += `<p style="margin:18px 0 0;${F}font-size:11.5pt;font-weight:bold;color:#294B5C">Production Eng. Dept.<br>Eastern Area - AG Field.</p></div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AG Production Activity ${dmy(day)}</title></head><body style="margin:8px">${h}</body></html>`;
    const pm = o.pmail || { to: [], cc: [] };
    return { subject: `AG Production Activity ${dmy(day)}`, html, body: h, to: pm.to || [], cc: pm.cc || [],
      notes: { jobs: J.length, rows: D.rows.length, rot: !!D.rot, wf: W.length, old: wf.old, total: D.total } };
  }

  // an .eml Outlook opens as a new email ready to send (X-Unsent): the subject, the recipients, the HTML in base64
  function eml(m) {
    const b64 = s => { const u = unescape(encodeURIComponent(s)); return (typeof btoa === 'function' ? btoa(u) : Buffer.from(u, 'binary').toString('base64')).replace(/.{76}/g, '$&\r\n'); };
    const word = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s).replace(/\r\n/g, '')}?=`;
    const addr = l => l.map(([n, a]) => `"${word(String(n).replace(/"/g, "'"))}" <${a}>`).join(',\r\n ');
    const hd = ['X-Unsent: 1', `Subject: ${word(m.subject)}`];
    if (m.to.length) hd.push('To: ' + addr(m.to));
    if (m.cc.length) hd.push('Cc: ' + addr(m.cc));
    hd.push('MIME-Version: 1.0', 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: base64');
    return hd.join('\r\n') + '\r\n\r\n' + b64(m.html) + '\r\n';
  }

  const api = { build, eml, deferred, jobs, names, rotOn, truckOn, dmy };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PMAIL = api;
})(typeof self !== 'undefined' ? self : this);
