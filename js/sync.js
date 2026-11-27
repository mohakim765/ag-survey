/* Sync with the Google Sheet (Apps Script web app).
   Local-first: every change is marked with the time it happened and queued; when there is a network the queue is sent,
   and changes from the other phones are pulled from the sheet's log (newest edit of a record wins). */
(function (root) {
  'use strict';
  let C = null, timer = 0, running = false, lastRun = 0, current = null, manualAsk = false;
  const S = () => C.getS();
  const st = () => S().sync;
  const clone = x => x == null ? null : JSON.parse(JSON.stringify(x));
  const strip = d => { if (!d || typeof d !== 'object' || Array.isArray(d)) return d; const o = {}; for (const k in d) if (k[0] !== '_') o[k] = d[k]; return o; };
  const DAY_KEYS = { r: 'r', d: 'd', p: 'p', c: 'c' };
  const PLAN = { pm: 'maint', pw: 'work', pt: 'tasks' };
  const UMAP = { uc: 'ucode', ur: 'ureq', uq: 'uprof' };   // codes from the admin, password requests, requests to change a name / number

  function planObj(day, aid) { const s = S(); s.plan = s.plan || {}; return s.plan[day + '|' + aid] || (s.plan[day + '|' + aid] = { staff: [], maint: [], work: [], tasks: [] }); }
  function findFromEnd(arr, id) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] && arr[i].id === id) return i; return -1; }

  function get(k) {
    const s = S(), [p, a, b, c] = k.split('|');
    if (DAY_KEYS[p]) { const D = s.days[a]; return D && D[p] && D[p][b] ? clone(D[p][b]) : null; }
    if (p === 'e') { const i = findFromEnd(s.dt, a); return i < 0 ? null : clone(s.dt[i]); }
    if (p === 's') { const i = findFromEnd(s.samples, a); return i < 0 ? null : clone(s.samples[i]); }
    if (p === 'ps') { const pl = s.plan && s.plan[a + '|' + b]; return pl ? clone(pl.staff) : null; }
    if (PLAN[p]) { const pl = s.plan && s.plan[a + '|' + b]; if (!pl) return null; const i = findFromEnd(pl[PLAN[p]], c); return i < 0 ? null : clone(pl[PLAN[p]][i]); }
    if (p === 'cw') return s.cfg.edits[a] ? clone(s.cfg.edits[a]) : null;
    if (p === 'nw') return s.cfg.newWells && s.cfg.newWells[a] ? clone(s.cfg.newWells[a]) : null;
    if (p === 'ir') return s.cfg.irot ? clone(s.cfg.irot) : null;   // the intermittent rotation (the daily email)
    if (p === 'wx') return s.cfg.wfx ? clone(s.cfg.wfx) : null;     // the engineer's water-flood network: design capacities, wells supported
    if (p === 'tk') return s.cfg.mtk ? clone(s.cfg.mtk) : null;     // the EPF's oil truck every other day (the daily email)
    if (p === 'cs') return { prodDayStart: s.cfg.prodDayStart, dieselMin: s.cfg.dieselMin, gasDiffPct: s.cfg.gasDiffPct, chemMin: clone(s.cfg.chemMin || {}), req: clone(s.cfg.req || {}) };
    if (p === 'u') return s.users[a] ? clone(s.users[a]) : null;
    if (UMAP[p]) { const m = s[UMAP[p]]; return m && m[a] ? clone(m[a]) : null; }
    if (p === 'ux') return s.gone && s.gone[a] ? { del: 1 } : null;
    if (p === 'sd') return C.seedPart ? C.seedPart(a, +b) : null;   // the wells' data, in parts, for the web version
    if (p === 'pj') { const L = s.jobs && s.jobs[a]; if (!L) return null; const i = findFromEnd(L, b); return i < 0 ? null : clone(L[i]); }
    if (p === 'a') { const i = findFromEnd(s.audit, a); return i < 0 ? null : clone(s.audit[i]); }
    if (p === 'rp') return s.reps && s.reps[a] ? clone(s.reps[a]) : null;   // a comparison with the daily report
    if (p === 'wt') return s.tests && s.tests[a] ? clone(s.tests[a]) : null;   // a well's newest test (from the reports)
    if (p === 'en') return s.eng && s.eng[a] ? clone(s.eng[a]) : null;       // Rig & Rigless of an engineering report
    if (p === 'as') return s.avs && s.avs[a] ? clone(s.avs[a]) : null;       // the last Avocet sheet of a day (what changed since)
    if (p === 'hf') return s.hfix && s.hfix[a] && s.hfix[a][b] ? clone(s.hfix[a][b]) : null;   // a well's hours a report set for a day
    return null;
  }
  // a record written by a person who was removed (their old phone): keep the values, drop the name
  function unname(d, s) {
    if (!s.gone || !d || typeof d !== 'object') return d;
    const g = v => typeof v === 'string' && v !== '' && s.gone[root.L.uhash(v)];
    const w = v => { if (Array.isArray(v)) return v.map(w); if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = w(v[k]); if (g(o.by)) { o.by = ''; o.byn = ''; } if (g(o.refn)) o.refn = ''; return o; } return v; };
    return w(d);
  }
  function set(k, d) {
    const s = S(), [p, a, b, c] = k.split('|'); d = unname(strip(d), s);
    if (DAY_KEYS[p]) { if (d) { const D = s.days[a] || (s.days[a] = { r: {}, d: {}, p: {}, c: {} }); (D[p] = D[p] || {})[b] = d; } else if (s.days[a] && s.days[a][p]) delete s.days[a][p][b]; return; }
    const upsert = (arr, id) => { const i = findFromEnd(arr, id); if (d) { if (i < 0) arr.push(d); else arr[i] = d; } else if (i >= 0) arr.splice(i, 1); };
    if (p === 'e') return upsert(s.dt, a);
    if (p === 's') return upsert(s.samples, a);
    if (p === 'ps') { planObj(a, b).staff = Array.isArray(d) ? d : []; return; }
    if (PLAN[p]) return upsert(planObj(a, b)[PLAN[p]], c);
    if (p === 'cw') { if (d && Object.keys(d).length) s.cfg.edits[a] = d; else delete s.cfg.edits[a]; return; }
    if (p === 'nw') { s.cfg.newWells = s.cfg.newWells || {}; if (d) s.cfg.newWells[a] = d; else delete s.cfg.newWells[a]; return; }
    if (p === 'ir') { if (d) s.cfg.irot = d; return; }
    if (p === 'wx') { if (d) s.cfg.wfx = d; return; }
    if (p === 'tk') { if (d) s.cfg.mtk = d; return; }
    if (p === 'cs') { if (d) { for (const f of ['prodDayStart', 'dieselMin', 'gasDiffPct']) if (typeof d[f] === 'number') s.cfg[f] = d[f]; if (d.chemMin && typeof d.chemMin === 'object') s.cfg.chemMin = d.chemMin; if (d.req && typeof d.req === 'object' && !Array.isArray(d.req)) s.cfg.req = d.req; } return; }
    if (p === 'u') { if (d && !(s.gone && s.gone[root.L.uhash(a)])) s.users[a] = d; return; }   // a removed person never comes back
    if (UMAP[p]) { const m = s[UMAP[p]] || (s[UMAP[p]] = {}); if (d && !(s.gone && s.gone[root.L.uhash(a)])) m[a] = d; else delete m[a]; return; }
    if (p === 'sd') { if (C.onSeed) C.onSeed(a, +b, d); return; }
    if (p === 'ux') { if (d && d.del) { s.gone = s.gone || {}; s.gone[a] = 1; if (C.onGone) C.onGone(a); } return; }
    if (p === 'pj') { s.jobs = s.jobs || {}; return upsert(s.jobs[a] || (s.jobs[a] = []), b); }
    if (p === 'a') return upsert(s.audit, a);
    if (p === 'rp') { s.reps = s.reps || {}; if (d) s.reps[a] = d; else delete s.reps[a]; }
    if (p === 'wt') { s.tests = s.tests || {}; if (d) s.tests[a] = d; else delete s.tests[a]; }
    if (p === 'en') { s.eng = s.eng || {}; if (d) s.eng[a] = d; else delete s.eng[a]; }
    if (p === 'as') { s.avs = s.avs || {}; if (d) s.avs[a] = d; else delete s.avs[a]; }
    if (p === 'hf') { s.hfix = s.hfix || {}; if (d) (s.hfix[a] = s.hfix[a] || {})[b] = d; else if (s.hfix[a]) { delete s.hfix[a][b]; if (!Object.keys(s.hfix[a]).length) delete s.hfix[a]; } }
  }

  // force: keep the time for an audit record too (a rewritten audit must not be undone by an older copy)
  function mark(k, t, force) {
    if (!C) return; const y = st(); if (!y) return; t = t || Date.now();
    y.dirty[k] = t; if (force || k[0] !== 'a' || k[1] !== '|') y.mt[k] = t;
    schedule(5000);
  }
  // every record on this phone: put(key, time written on it)
  function eachKey(put) {
    const s = S();
    for (const day in s.days) for (const p in DAY_KEYS) for (const id in (s.days[day][p] || {})) { const x = s.days[day][p][id]; put(`${p}|${day}|${id}`, x && x.t); }
    for (const e of s.dt) put('e|' + e.id, e.t);
    for (const x of s.samples) put('s|' + x.id, x.t || x.ts);
    for (const key in s.plan || {}) { const [day, aid] = key.split('|'), pl = s.plan[key]; if (pl.staff.length) put(`ps|${day}|${aid}`); for (const p in PLAN) for (const it of pl[PLAN[p]]) put(`${p}|${day}|${aid}|${it.id}`, it.t); }
    for (const day in s.jobs || {}) for (const j of s.jobs[day]) put(`pj|${day}|${j.id}`, j.t);
    for (const id in s.cfg.edits) put('cw|' + id, s.cfg.edits[id].at);
    for (const id in (s.cfg.newWells || {})) put('nw|' + id, s.cfg.newWells[id].at);
    if (s.cfg.irot) put('ir', s.cfg.irot.at);
    if (s.cfg.wfx) put('wx', s.cfg.wfx.at);
    if (s.cfg.mtk) put('tk', s.cfg.mtk.at);
    // settings: only when this phone changed them, so a new phone doesn't push the defaults over the admin's values
    const y = st(), D = root.SEED || {}; if (y.mt.cs || ['prodDayStart', 'dieselMin', 'gasDiffPct'].some(f => D[f] != null && s.cfg[f] !== D[f]) || Object.keys(s.cfg.chemMin || {}).length || Object.keys(s.cfg.req || {}).length) put('cs');
    for (const u in s.users) if (!s.users[u]._seed) put('u|' + u, s.users[u].at);   // the admin account from the seed is on every phone already
    for (const p in UMAP) for (const u in s[UMAP[p]] || {}) put(p + '|' + u, s[UMAP[p]][u].t);
    for (const h in s.gone || {}) put('ux|' + h);
    for (const d in s.reps || {}) put('rp|' + d, s.reps[d].t);
    for (const id in s.tests || {}) put('wt|' + id, s.tests[id].t);
    for (const d in s.eng || {}) put('en|' + d, s.eng[d].t);
    for (const d in s.avs || {}) put('as|' + d, s.avs[d].t);
    for (const d in s.hfix || {}) for (const id in s.hfix[d]) put(`hf|${d}|${id}`, s.hfix[d][id].t);
    for (const x of s.audit) { if (!x.id) x.id = 'a' + x.ts.toString(36) + Math.random().toString(36).slice(2, 6); put('a|' + x.id, x.ts); }
  }
  // first link (or the sheet was emptied): send everything on this phone
  function seedAll() {
    const y = st(), now = Date.now();
    // the edit time of a record that was never sent = the time written on it (so an old record doesn't beat a newer one from another phone)
    eachKey((k, rt) => { const v = y.mt[k] || Number(rt) || now; if (!y.dirty[k]) y.dirty[k] = v; if (!(k[0] === 'a' && k[1] === '|') && !y.mt[k]) y.mt[k] = v; });
    y.seeded = true;
  }

  const url = () => ((st() && st().url) || (root.CONFIG && root.CONFIG.syncUrl) || '').trim();
  const key = () => (root.CONFIG && root.CONFIG.syncKey) || '';
  function schedule(ms) { if (!url()) return; clearTimeout(timer); timer = setTimeout(() => run(false), ms); }

  async function post(body) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, to = setTimeout(() => ctl && ctl.abort(), 30000);
    try {
      const r = await fetch(url(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined, redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(await r.text());
      if (j && j.err === 'busy') throw Object.assign(new Error('الشيت مشغول، هيحاول تاني لوحده'), { net: true });
      if (!j || !j.ok) throw new Error(j && j.err === 'key' ? 'مفتاح الربط غلط' : (j && j.err) || 'رد غلط من الشيت'); return j;
    } catch (e) {
      if (e.net) throw e;
      const net = e.name === 'AbortError' || e instanceof TypeError; // no network / too slow: normal in the field, the queue waits
      const m = e.name === 'AbortError' ? 'النت ضعيف والطلب اتأخر' : e instanceof TypeError ? 'مفيش نت' : e instanceof SyntaxError ? 'الشيت رد برد غلط. اتأكد من الرابط ومن الـ Deploy' : /^HTTP \d/.test(e.message) ? 'الشيت مش بيرد (' + e.message + ')' : e.message || String(e);
      throw Object.assign(new Error(m), { net });
    }
    finally { clearTimeout(to); }
  }

  // a second call while sending just waits for the one in progress
  function run(manual) {
    if (running) { if (manual) manualAsk = true; return current; }
    current = doRun(manual); return current;
  }
  // the sheet link changed. A copy of the old sheet (CONFIG.syncMove: the old links, the rows its log had and the time of the copy):
  // keep reading from where the copy starts, and send again what changed after the copy (it may have gone to the old sheet only).
  // Any other new sheet: read it from the start and send everything on this phone.
  function moved() {
    const y = st(), m = root.CONFIG && root.CONFIG.syncMove, from = (m && m.from) || [];
    if (y.url && from.includes(y.url)) y.url = '';   // the link saved on this phone was the old sheet
    const u = url(); if (!u || y.at === u) return;
    if (m && from.length && u === String(root.CONFIG.syncUrl || '').trim() && y.seeded && (!y.at || from.includes(y.at))) {
      y.cursor = Math.min(y.cursor, Number(m.rows) || 0);
      eachKey((k, rt) => { const v = y.mt[k] || Number(rt) || 0; if (v >= m.t && !y.dirty[k]) y.dirty[k] = v; });
    } else if (y.at) { y.cursor = 0; y.seeded = false; }
    y.at = u;
  }
  async function doRun(manual) {
    const y = st(); if (y) moved(); if (!y || !url()) return { ok: false, err: 'مش متربط بالشيت' };
    // the app is in the background on Android: the phone's own background job sends the changes (when there is a network)
    if (!manual && typeof document !== 'undefined' && document.hidden && C.bgOn && C.bgOn()) return { ok: false, err: '' };
    running = true; lastRun = Date.now(); clearTimeout(timer);
    let got = 0, sent = 0, cfgChanged = false, usersChanged = false, repChanged = false;
    try {
      if (C.before) await C.before();   // what the background job already sent is not sent again
      if (!y.seeded) seedAll();
      for (let loop = 0; loop < 40; loop++) {
        const keys = Object.keys(y.dirty).sort((a, b) => y.dirty[a] - y.dirty[b]).slice(0, 300);
        const changes = keys.map(k => ({ k, t: y.dirty[k], u: S().me || '', d: C.meta(k, get(k)) }));
        const res = await post({ key: key(), dev: y.dev, cursor: y.cursor, changes, app: C.version });
        for (const c of changes) if (y.dirty[c.k] === c.t) delete y.dirty[c.k];
        sent += changes.length;
        if (res.reset) { y.cursor = 0; seedAll(); continue; }
        for (const c of res.changes || []) {
          if (c.dev === y.dev) continue;
          const lt = y.mt[c.k] || 0, pend = y.dirty[c.k];
          if (pend && pend > c.t) continue;
          if (c.t >= lt || (c.k.startsWith('a|') && !lt)) {
            set(c.k, c.d); got++;
            if (!c.k.startsWith('a|')) y.mt[c.k] = c.t;
            if (pend && pend <= c.t) delete y.dirty[c.k];
            if (c.k.startsWith('cw|') || c.k.startsWith('nw|') || c.k === 'cs') cfgChanged = true;
            if (/^u[xcrq]?\|/.test(c.k)) usersChanged = true;
            if (c.k.startsWith('rp|')) repChanged = true;
          }
        }
        y.cursor = res.cursor;
        if (!res.more && !Object.keys(y.dirty).length) break;
      }
      y.last = Date.now(); y.err = ''; y.net = false; prune();
      return { ok: true, got, sent };
    } catch (e) { y.err = e.message || String(e); y.net = !!e.net; return { ok: false, err: y.err }; }
    finally {
      running = false; const m = manual || manualAsk; manualAsk = false; C.save(); C.onDone({ got, sent, cfgChanged, usersChanged, repChanged, manual: m });
      // still something to send: try again soon (no network: every 20 seconds, so it goes as soon as the network is back)
      if (Object.keys(y.dirty).length) schedule(!y.err ? 3000 : y.net ? 20000 : 60000);
    }
  }
  // forget modification times of old days (only recent days can still be edited)
  function prune() {
    const y = st(), cut = C.cutDay(); if (!cut) return;
    for (const k in y.mt) { const p = k.split('|'); if ((DAY_KEYS[p[0]] || p[0] === 'ps' || p[0] === 'pj' || p[0] === 'rp' || p[0] === 'en' || p[0] === 'as' || p[0] === 'hf' || PLAN[p[0]]) && p[1] < cut && !y.dirty[k]) delete y.mt[k]; }
  }
  function status() { const y = st() || {}; return { linked: !!url(), pending: Object.keys(y.dirty || {}).length, last: y.last || 0, err: y.err || '', net: !!y.net, running }; }

  function init(ctx) {
    C = ctx; const s = S();
    s.sync = Object.assign({ url: '', dev: '', cursor: 0, last: 0, dirty: {}, mt: {}, seeded: false, err: '' }, s.sync || {});
    if (!s.sync.dev) s.sync.dev = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    moved();
    setInterval(() => { if (!document.hidden && Date.now() - lastRun > 80000) run(false); }, 30000);
    window.addEventListener('online', () => schedule(1000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(1500); });
    schedule(2000);
  }
  function setUrl(u) { st().url = (u || '').trim(); st().seeded = false; st().cursor = 0; st().at = url(); C.save(); schedule(500); }
  function each(fn) { const ks = []; eachKey(k => ks.push(k)); for (const k of ks) fn(k); }
  // for the phone's background job: the request the app would send now (the oldest changes first)
  function outbox(max) {
    const y = st(); if (!y || !url() || !y.seeded) return null;
    const keys = Object.keys(y.dirty).sort((a, b) => y.dirty[a] - y.dirty[b]).slice(0, max || 1000); if (!keys.length) return null;
    const changes = keys.map(k => ({ k, t: y.dirty[k], u: S().me || '', d: C.meta(k, get(k)) })), sent = {};
    for (const c of changes) sent[c.k] = c.t;
    return { url: url(), body: JSON.stringify({ key: key(), dev: y.dev, cursor: y.cursor, changes, app: C.version, bg: 1 }), keys: sent };
  }
  // the background job sent these: they are not waiting any more (unless they changed again since)
  function sentBy(keys) { const y = st(); let n = 0; if (!y) return 0; for (const k in keys || {}) if (y.dirty[k] === keys[k]) { delete y.dirty[k]; n++; } if (n) { y.last = Date.now(); y.err = ''; y.net = false; } return n; }
  function forget(k) { const y = st(); if (y) { delete y.dirty[k]; delete y.mt[k]; } }
  root.SYNC = { init, mark, run, status, setUrl, url, each, forget, outbox, sentBy, schedule, _get: get, _set: set };
})(typeof self !== 'undefined' ? self : this);
