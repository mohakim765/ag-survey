/* AG Survey (سيرفاي الآبار) — UI. Offline-first; all data stays on the phone until the sync step is added. */
(function () {
  'use strict';
  const L = window.L, SEED = window.SEED, VERSION = '0.6.7';
  const $ = s => document.querySelector(s);
  const app = $('#app'), formEl = $('#form'), modalEl = $('#modal'), toastEl = $('#toast');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const Cap = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins : null;

  // ---------------- storage: IndexedDB, localStorage as fallback ----------------
  const DBN = 'well-survey', STORE = 'kv';
  let idb = null, saveT = 0;
  function openIdb() { return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function loadState() {
    try { idb = await openIdb(); const v = await new Promise((res, rej) => { const q = idb.transaction(STORE).objectStore(STORE).get('state'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); if (v) return v; } catch (e) { idb = null; }
    try { const raw = localStorage.getItem(DBN); if (raw) return JSON.parse(raw); } catch (e) { }
    return null;
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 120); }
  async function saveNow() {
    clearTimeout(saveT);
    if (idb) { try { await new Promise((res, rej) => { const t = idb.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(JSON.parse(JSON.stringify(S)), 'state'); t.oncomplete = res; t.onerror = () => rej(t.error); }); return; } catch (e) { } }
    try { localStorage.setItem(DBN, JSON.stringify(S)); } catch (e) { toast('مساحة التخزين خلصت. صدّر الداتا.'); }
  }
  const fresh = () => ({ v: 1, ui: { mode: 'type' }, plan: {}, errs: [], users: {}, me: null, admin: null, cfg: { prodDayStart: SEED.prodDayStart, dieselMin: SEED.dieselMin, gasDiffPct: SEED.gasDiffPct, edits: {}, newWells: {}, chemMin: {} }, days: {}, dt: [], samples: [], audit: [], jobs: {}, gone: {} });
  let S = fresh();

  // ---------------- config ----------------
  let WELLS = [], WBY = {}, TANKS = SEED.tanks;
  const EDITK = ['t', 'hid', 'int', 'r', 'ch'];   // what the admin can change on a well
  function rebuildWells() {
    const pick = e => { const o = {}; if (e) for (const k of EDITK) if (k in e) o[k] = e[k]; return o; };
    const added = Object.values(S.cfg.newWells || {});
    // route order (r) from the coordinates and the KML roads; paper order (o) is kept for the PDF
    WELLS = SEED.wells.concat(added).map(w => Object.assign({}, w, pick(S.cfg.edits[w.id]))).sort((a, b) => (a.r ?? a.o) - (b.r ?? b.o) || a.o - b.o);
    WBY = Object.fromEntries(WELLS.map(w => [w.id, w]));
    // every ESP / SRP well gets a diesel tank, also wells the admin added or changed to ESP / SRP
    const has = new Set(); for (const t of SEED.tanks) for (const id of t.w) has.add(id);
    TANKS = SEED.tanks.concat(WELLS.filter(w => (w.t === 'ESP' || w.t === 'SRP') && !has.has(w.id)).map(w => ({ id: 'ta-' + w.id, a: w.a, place: w.n, code: '', cap: null, w: [w.id], grp: '', chk: 1, auto: 1 })));
  }
  const SEEDX = () => Object.assign({}, SEED, { tanks: TANKS });
  const H = () => S.cfg.prodDayStart;
  const curDay = () => L.prodDay(Date.now(), H());
  const me = () => S.me && S.users[S.me];
  const isAdmin = () => !!ADMIN_ON;
  let ADMIN_ON = false;
  const areaOf = id => SEED.areas.find(a => a.id === id);
  const canStaff = () => isAdmin() || !!(me() && (me().role === 'lead' || me().role === 'eng'));   // رئيس الورشة أو المهندس: توزيعة الأفراد
  const canPlan = () => isAdmin() || !!(me() && me().role === 'eng');     // المهندس: الصيانات والشغل والمهام
  const planFor = (day, aid) => (S.plan && S.plan[day + '|' + aid]) || { staff: [], maint: [], work: [], tasks: [] };
  function planObj(day, aid) { S.plan = S.plan || {}; return S.plan[day + '|' + aid] || (S.plan[day + '|' + aid] = { staff: [], maint: [], work: [], tasks: [] }); }
  const MAINT = { stop: 'صيانة مولد (البير هيقف)', sync: 'صيانة مولد Sync (البير مش هيقف)', other: 'صيانة تانية' };
  const WORK = ['بلوف', 'Slickline', 'Wireline', 'Coil Tubing', 'حفار', 'شغل تاني'];
  // a person in the staff list is kept as "name" or "name · phone" (the sheet shows it as it is)
  const staffP = s => { s = String(s); const i = s.lastIndexOf(' · '), ph = i > 0 ? s.slice(i + 3).trim() : ''; return /^\+?[\d ]{7,}$/.test(ph) ? { n: s.slice(0, i).trim(), ph } : { n: s.trim(), ph: '' }; };
  const staffS = (n, ph) => n + (ph ? ' · ' + ph : '');
  const digits = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d+]/g, '');
  const isMe = e => { const u = me(); return !!u && ((e.ph && u.phone && digits(e.ph) === digits(u.phone)) || e.n === u.name); };
  const JOBS = ['توزيع سيارة الديزل', 'Treatment'];
  const jobsFor = d => (S.jobs && S.jobs[d]) || [];
  const jobObj = (d, id) => jobsFor(d).find(j => j.id === id);
  const AREA_ORDER = ['east', 'sag', 'hawk', 'wd33']; // two boxes a row: آبار الزيت and ساج, then أبورواش and 33
  const areasOrdered = () => AREA_ORDER.map(areaOf).filter(Boolean).concat(SEED.areas.filter(a => !AREA_ORDER.includes(a.id)));
  const myAreas = d => SEED.areas.filter(a => planFor(d, a.id).staff.some(s => isMe(staffP(s)))).map(a => a.id);
  const alertAreas = d => { const m = myAreas(d); return m.length ? m : S.ui.lastArea ? [S.ui.lastArea] : []; };
  const PLK = [['maint', 'صيانة'], ['work', 'شغل على بير'], ['tasks', 'مهمة']];
  const planItems = (d, aid) => { const pl = planFor(d, aid), out = []; for (const [k, lab] of PLK) for (const it of pl[k]) out.push({ k, lab, it, aid }); return out; };
  // new items from someone else that this phone hasn't opened yet
  const unseen = (d, aids) => { const seen = S.ui.seen || {}, out = []; for (const aid of aids) for (const x of planItems(d, aid)) if (!seen[x.it.id] && x.it.by !== S.me && !(x.k === 'tasks' && x.it.done)) out.push(x); return out; };
  function markSeen(d, aids) { S.ui.seen = S.ui.seen || {}; let ch = false; for (const aid of aids) for (const x of planItems(d, aid)) if (!S.ui.seen[x.it.id]) { S.ui.seen[x.it.id] = 1; ch = true; } if (ch) save(); }
  const sampleArea = s => s.a || (WBY[s.w] ? WBY[s.w].a : '');
  const visibleWells = aid => WELLS.filter(w => w.a === aid && !w.hid);
  const tanksOf = wid => TANKS.filter(t => t.w.includes(wid));
  function dayObj(day) { const D = S.days[day] || (S.days[day] = { r: {}, d: {}, p: {}, c: {} }); if (!D.c) D.c = {}; return D; }
  const dayGet = day => S.days[day] || { r: {}, d: {}, p: {}, c: {} };
  const chemOf = (day, wid) => { const x = (dayGet(day).c || {})[wid]; return x && x.v ? x.v : {}; };
  function prevReading(wid, day) { const ds = Object.keys(S.days).filter(d => d < day).sort().reverse(); for (const d of ds) { const r = S.days[d].r[wid]; if (r && L.isDone(r)) return { d, r }; } return null; }
  function audit(ref, refn, f, a, b, day, why) { const u = me(), aid = 'a' + uid(); S.audit.push({ id: aid, ts: Date.now(), by: S.me, byn: u ? u.name : '', day, ref, refn, f, a, b, why: why || '' }); mark('a|' + aid); if (S.audit.length > 20000) S.audit.splice(0, S.audit.length - 20000); }
  const mark = k => { if (window.SYNC) SYNC.mark(k); };
  const pushEv = ev => { S.dt.push(ev); mark('e|' + ev.id); return ev; };
  const stampBy = () => { const u = me(); return { by: S.me, byn: u ? u.name : '', t: Date.now() }; };

  async function sha(s) {
    if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
    let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(16);
  }

  // ---------------- view state ----------------
  let V = { v: 'home' }, VDAY = null; // VDAY: production day being viewed (admin can open past days)
  const viewDay = () => VDAY || curDay();
  const editable = () => viewDay() === curDay() || isAdmin();

  // ---------------- icons ----------------
  const P = {
    back: '<path d="M9 5l7 7-7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>', flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    well: '<path d="M12 3v18M8 21h8M9 7h6M10 11h4M7 3h10"/>', share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  };
  const ic = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  function toast(m) { toastEl.textContent = m; toastEl.hidden = false; toastEl.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.classList.remove('show'); setTimeout(() => toastEl.hidden = true, 250); }, 2600); }
  function arDay(d) { try { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 12).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d; } }
  const hm = ts => L.hhmm(ts);
  const hmWords = v => { const [H] = v.split(':').map(Number), night = H >= 18 || H < 6, h = night ? (H >= 18 ? H - 12 : H === 0 ? 12 : H) : (H <= 12 ? H : H - 12); return `${h}:${v.split(':')[1]} ${night ? 'ليلًا' : 'نهارًا'}`; };
  const hmA = ts => hmWords(hm(ts));
  function sinceTxt(ts) { const h = (Date.now() - ts) / 36e5; if (h < 1) return Math.max(1, Math.round(h * 60)) + ' دقيقة'; if (h < 48) return Math.round(h) + ' ساعة'; return Math.round(h / 24) + ' يوم'; }

  // ---------------- status helpers ----------------
  function wellState(w, day) {
    const r = dayGet(day).r[w.id], open = L.openEvent(S.dt, w.id);
    const prev = prevReading(w.id, day);
    const ck = L.checks(w, r, prev && prev.r, S.cfg);
    for (const t of tanksOf(w.id)) { const x = dayGet(day).d[t.id]; const v = x && L.toNum(x.v); if (v != null && v < S.cfg.dieselMin) ck.push(`ديزل ${t.code || t.place} ${v}%`); }
    const cv = chemOf(day, w.id); for (const c of w.ch || []) { const v = L.toNum(cv[c]); if (v != null && v < L.chemMin(S.cfg, c)) ck.push(`${L.CHEM_N[c] || c} ${v}%`); }
    return { r, open, done: L.isDone(r) || !!open, ck };
  }
  function areaStats(aid, day) {
    let done = 0, total = 0, down = 0, warn = 0;
    for (const w of visibleWells(aid)) { total++; const s = wellState(w, day); if (s.done) done++; if (s.open) down++; if (s.ck.length) warn++; }
    const D = dayGet(day); let dl = 0;
    for (const t of TANKS) if (t.a === aid) { const x = D.d[t.id]; const v = x && L.toNum(x.v); if (v != null && v < S.cfg.dieselMin) dl++; }
    let cl = 0; for (const w of visibleWells(aid)) { const cv = chemOf(day, w.id); for (const c of w.ch || []) { const v = L.toNum(cv[c]); if (v != null && v < L.chemMin(S.cfg, c)) cl++; } }
    return { done, total, down, warn, dl, cl };
  }

  // ---------------- shell ----------------
  const tabs = cur => { const nb = me() ? unseen(curDay(), alertAreas(curDay())).length : 0;
    return `<nav class="tabs">${[['home', 'home', 'المناطق'], ['follow', 'list', 'المتابعة'], ['export', 'dl', 'إرسال الداتا'], ['settings', 'gear', 'الإعدادات']].map(([v, i, l]) => `<button class="${cur === v ? 'on' : ''}" data-act="go" data-v="${v}">${ic(i)}${l}${v === 'follow' && nb ? `<b class="nbdg">${nb}</b>` : ''}</button>`).join('')}</nav>`; };
  const top = (title, sub, back) => `<header class="top"><div class="wrap">${back ? `<button class="ib" data-act="go" data-v="${back}" aria-label="رجوع">${ic('back')}</button>` : ''}<div class="tt"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${isAdmin() ? `<span class="tag" style="color:#f2f3f5;border-color:#f2f3f5">أدمن</span>` : ''}</div></header>`;
  const dayLine = () => { const d = viewDay(), past = d !== curDay(); return `${past ? 'يوم قديم: ' : 'يوم الإنتاج: '}${arDay(d)} · من ${H()} الصبح${me() ? ' · ' + esc(me().name) : ''}`; };

  // ---------------- login / register ----------------
  function vLogin() {
    const users = Object.values(S.users);
    if (!users.length || V.reg) return vRegister();
    const here = (S.ui.here || []).filter(u => S.users[u]).map(u => S.users[u]);
    const pick = here.length ? `<select class="in" id="lu">${here.map(u => `<option value="${esc(u.u)}" ${u.u === V.lu ? 'selected' : ''}>${esc(u.name)} (${esc(u.u)})</option>`).join('')}<option value="">حد تاني…</option></select><input class="in" id="lu2" dir="ltr" autocapitalize="off" placeholder="اكتب اسم المستخدم" style="margin-top:8px" hidden>`
      : `<input class="in" id="lu2" dir="ltr" autocapitalize="off" autocomplete="username" placeholder="اسم المستخدم اللي سجلت بيه">`;
    return `<main class="wrap"><img class="logoimg" src="img/icon.webp" alt=""><h1 class="center" style="margin:0" dir="ltr">AG Survey</h1><p class="center mute">ادخل باسمك</p>
    <div class="card"><label class="lab">اسم المستخدم</label>${pick}
    <label class="lab" style="margin-top:12px">الباسورد (4 أرقام)</label><div class="pinrow"><input id="lp" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>
    <button class="btn pen wide" data-act="login">دخول</button></div>
    <button class="btn wide" data-act="toreg">مستخدم جديد على الموبايل ده</button></main>`;
  }
  function vRegister() {
    const first = !Object.keys(S.users).length;
    return `<main class="wrap"><img class="logoimg" src="img/icon.webp" alt=""><h1 class="center" style="margin:0">${first ? 'أهلاً بيك' : 'مستخدم جديد'}</h1><p class="center mute">سجّل مرة واحدة. اسمك هيتكتب على كل قراية تدخلها.</p>
    <div class="card"><label class="lab">الاسم بالكامل</label><input class="in" id="rn" autocomplete="name">
    <div class="two" style="margin-top:10px"><div><label class="lab">الرقم الوظيفي</label><input class="in" id="re" inputmode="numeric"></div><div><label class="lab">رقم الموبايل</label><input class="in" id="rp" inputmode="tel" dir="ltr"></div></div>
    <label class="lab" style="margin-top:10px">اسم المستخدم <em>(إنجليزي من غير مسافات)</em></label><input class="in" id="ru" dir="ltr" autocapitalize="off" autocomplete="username">
    <div class="two" style="margin-top:10px"><div><label class="lab">باسورد 4 أرقام</label><input class="in" id="rk" type="password" inputmode="numeric" maxlength="4"></div><div><label class="lab">أكّد الباسورد</label><input class="in" id="rk2" type="password" inputmode="numeric" maxlength="4"></div></div>
    <button class="btn pen wide" data-act="register">تسجيل</button></div>${first ? '' : '<button class="btn wide" data-act="tolog">رجوع للدخول</button>'}</main>`;
  }
  async function doRegister() {
    const g = id => ($('#' + id).value || '').trim();
    const name = g('rn'), emp = L.normNum(g('re')), phone = L.normNum(g('rp')), u = g('ru').toLowerCase(), k = L.normNum(g('rk')), k2 = L.normNum(g('rk2'));
    if (name.length < 3) return toast('اكتب الاسم بالكامل');
    if (!emp) return toast('اكتب الرقم الوظيفي');
    if (!/^01\d{9}$/.test(phone)) return toast('رقم الموبايل لازم 11 رقم ويبدأ بـ 01');
    if (!/^[a-z][a-z0-9._-]{2,19}$/.test(u)) return toast('اسم المستخدم: حروف إنجليزي وأرقام، من 3 لـ 20');
    if (S.users[u] || (S.gone && S.gone[L.uhash(u)])) return toast('اسم المستخدم ده مش متاح، اختار غيره');
    if (!/^\d{4}$/.test(k)) return toast('الباسورد لازم 4 أرقام');
    if (k !== k2) return toast('الباسوردين مش زي بعض');
    S.users[u] = { u, name, emp, phone, ph: await sha('ws:' + u + ':' + k), at: Date.now(), verified: false }; mark('u|' + u);
    S.me = u; S.ui.here = [...new Set([...(S.ui.here || []), u])]; audit('user', u, 'تسجيل', '', name, curDay()); await saveNow(); V = { v: 'home' }; render(); toast('أهلاً ' + name.split(' ')[0]);
  }
  async function doLogin() {
    const sel = $('#lu'), u = sel && sel.value ? sel.value : (($('#lu2') || {}).value || '').trim().toLowerCase(), k = L.normNum($('#lp').value || ''); const x = S.users[u];
    if (!u) return toast('اكتب اسم المستخدم'); if (!x) return toast('اسم المستخدم ده مش موجود');
    if (x.ph !== await sha('ws:' + u + ':' + k)) { $('#lp').value = ''; return toast('الباسورد غلط'); }
    S.me = u; S.ui.here = [...new Set([...(S.ui.here || []), u])]; save(); V = { v: 'home' }; render();
  }

  // ---------------- home ----------------
  function vHome() {
    const d = viewDay();
    let h = top('AG Survey', dayLine()) + '<main class="wrap">';
    if (window.CONFIG && CONFIG.web && !S.ui.noInstall && !(window.matchMedia && matchMedia('(display-mode: standalone)').matches) && !navigator.standalone) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      h += `<div class="banner info inst"><span>${ios ? 'عشان تثبّته على الآيفون: من Safari دوس زرار المشاركة <b>⬆</b> وبعدين <b>Add to Home Screen</b>.' : window.__installEvt ? 'تقدر تثبّت البرنامج على الكمبيوتر وتفتحه من أيقونة.' : 'تقدر تثبّته من قايمة Chrome أو Edge: <b>Install AG Survey</b>.'}</span>${!ios && window.__installEvt ? '<button class="btn sm pen" data-act="install">ثبّت</button>' : ''}<button class="ib3 xs" data-act="noinst" aria-label="اقفل">×</button></div>`;
    }
    if (isAdmin()) h += `<div class="card"><label class="lab">اليوم اللي بتشوفه <em>(الأدمن بس يقدر يفتح أيام قديمة)</em></label><input class="in" type="date" id="vday" value="${d}" max="${curDay()}"></div>`;
    else if (d !== curDay()) VDAY = null;
    h += `<p class="homesync" data-sync>${syncLine()}</p><div class="agrid">`;
    for (const a of SEED.areas) {
      const s = areaStats(a.id, d), pct = s.total ? Math.round(s.done / s.total * 100) : 0, pl = planFor(d, a.id), todo = pl.tasks.filter(t => !t.done).length + pl.maint.length + pl.work.length;
      h += `<button class="atile" data-act="area" data-a="${a.id}"><span class="an">${esc(a.n)}</span><span class="af">${esc(a.full)}</span>
        <span class="ac"><b>${s.done}</b> من ${s.total}</span><span class="meter"><i style="width:${pct}%"></i></span>
        <span class="chips">${s.down ? `<span class="chip dn"><b>${s.down}</b> واقف</span>` : ''}${s.warn ? `<span class="chip w"><b>${s.warn}</b> تنبيه</span>` : ''}${s.dl ? `<span class="chip w">ديزل <b>${s.dl}</b></span>` : ''}${todo ? `<span class="chip"><b>${todo}</b> متابعة</span>` : ''}${unseen(d, [a.id]).length ? `<span class="chip new"><b>${unseen(d, [a.id]).length}</b> جديد</span>` : ''}</span></button>`;
    }
    return h + '</div></main>' + tabs('home');
  }
  // ---------------- area ----------------
  function vArea() {
    const a = areaOf(V.a); if (!a) { V = { v: 'home' }; return vHome(); }
    const d = viewDay(), st = areaStats(a.id, d), tab = V.tab || 'wells';
    const D = dayGet(d), tks = areaTanks(a.id), pts = SEED.points.filter(p => p.a === a.id);
    const nT = tks.length, tDone = tks.filter(t => D.d[t.id] && D.d[t.id].v !== '').length;
    const chW = visibleWells(a.id).filter(w => (w.ch || []).length), nC = chW.reduce((n, w) => n + w.ch.length, 0), cDone = chW.reduce((n, w) => { const cv = chemOf(d, w.id); return n + w.ch.filter(c => (cv[c] ?? '') !== '').length; }, 0);
    const nP = pts.reduce((n, p) => n + p.h.length, 0), pDone = pts.reduce((n, p) => n + p.h.filter(hd => D.p[p.id] && (D.p[p.id].h[hd || '-'] ?? '') !== '').length, 0);
    const pl = planFor(d, a.id), todo = pl.tasks.filter(t => !t.done).length + pl.maint.length + pl.work.length;
    const nu = unseen(d, [a.id]).length, smp = S.samples.filter(s => s.day === d && sampleArea(s) === a.id), sW = smp.filter(s => s.kind === 'W').length;
    let h = `<header class="top slim"><div class="wrap"><button class="ib" data-act="go" data-v="home" aria-label="رجوع">${ic('back')}</button><div class="tt"><h1>${esc(a.n)}</h1></div>
      <button class="fbtn ${tab === 'dt' ? 'on' : ''}" data-act="stab" data-v="dt">${ic('list')}المتابعة${nu ? `<b class="nbdg">${nu}</b>` : todo ? `<span class="fcnt">${todo}</span>` : ''}</button>${isAdmin() ? '<span class="tag" style="color:#f2f3f5;border-color:#f2f3f5">أدمن</span>' : ''}</div></header><main class="wrap">`;
    const tile = (k, label, big, sub) => `<button class="atab ${tab === k ? 'on' : ''}" data-act="stab" data-v="${k}"><span class="al">${label}</span><span class="ab">${big}</span>${sub ? `<span class="as">${sub}</span>` : ''}</button>`;
    h += `<div class="atabs">${tile('wells', 'الآبار', `${st.done}/${st.total}`, st.down ? `${st.down} واقف` : '')}${tile('samples', 'العينات', String(smp.length), smp.length ? `زيت ${smp.length - sW} · مية ${sW}` : 'مفيش لسه')}${tile('press', 'المانيفولد', nP ? `${pDone}/${nP}` : '—', '')}${tile('diesel', nC ? 'الديزل والكيميكال' : 'الديزل', nT + nC ? `${tDone + cDone}/${nT + nC}` : '—', [st.dl ? `${st.dl} ديزل تحت ${S.cfg.dieselMin}%` : '', st.cl ? `${st.cl} كيميكال ناقص` : ''].filter(Boolean).join(' · '))}</div>`;
    if (!editable()) h += `<div class="banner">ده يوم قديم. التعديل للأدمن بس.</div>`;
    if (tab === 'wells') h += areaWells(a, d);
    else if (tab === 'press') h += areaPress(a, d);
    else if (tab === 'diesel') h += areaDiesel(a, d);
    else if (tab === 'samples') h += areaSamples(a, d);
    else { h += areaDown(a, d); markSeen(d, [a.id]); }
    return h + '</main>' + tabs('home');
  }
  const TYPE_AR = { ESP: 'ESP', SRP: 'SRP', GL: 'Gas Lift', NF: 'Natural Flow', PL: 'Plunger Lift', WSW: 'WSW · مصدر مية', WIW: 'WIW · حقن مية' };
  const tchip = t => `<span class="tc t-${t}">${t === 'GL' ? 'GL' : t}</span>`;
  function wellRow(w, d, opt) {
    opt = opt || {}; const s = wellState(w, d); const sum = s.r ? L.summary(w, s.r) : '';
    const pl = planFor(d, w.a), job = pl.maint.some(m => m.w.includes(w.id)) || pl.work.some(x => x.w === w.id);
    const tags = [opt.chip ? tchip(w.t) : '', s.open ? `<span class="tag dn">واقف</span>` : '', w.int ? `<span class="tag int">متقطع</span>` : '', w.hid ? `<span class="tag hid">مخفي</span>` : '', job ? `<span class="tag job">شغل النهارده</span>` : '', opt.dist != null ? `<span class="tag">${opt.dist}</span>` : ''].join('');
    let sub = s.open ? `${esc(s.open.r)} · من ${sinceTxt(s.open.s)}` : sum ? esc(sum) : 'مستني قراية';
    if (!s.open) { const [s0, e0] = L.dayWindow(d, H()), dm = L.downMs(S.dt, w.id, s0, Math.min(e0, Date.now())); if (dm > 0) sub += ` · وقف ${durTxt(dm)} النهارده`; }
    return `<button class="wrow" data-act="well" data-w="${w.id}"><span class="wn">${esc(w.n)} ${tags}</span>
      <span class="ws ${s.open || sum ? '' : 'dim'}">${sub}</span>${s.ck.length ? `<span class="wa">${esc(s.ck.join(' · '))}</span>` : ''}
      <span class="wm">${s.ck.length ? '<i class="mk wn">!</i>' : s.done ? `<i class="mk ok">${ic('check')}</i>` : '<i class="mk"></i>'}</span></button>`;
  }
  const MODES = [['type', 'حسب النوع'], ['route', 'ترتيب الطريق'], ['map', 'الخريطة']];
  function wellMatch(q) { q = (q || '').trim().toUpperCase().replace(/[\s-]/g, ''); return w => !q || w.n.toUpperCase().replace(/[\s-]/g, '').includes(q) || (w.p || '').toUpperCase().replace(/[\s-]/g, '').includes(q); }
  function areaWells(a, d) {
    const mode = S.ui.mode || 'type', match = wellMatch(V.q);
    let h = `<div class="seg modes">${MODES.map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-act="mode" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (mode !== 'map') h += `<div class="search"><input id="q" placeholder="دوّر على بير" value="${esc(V.q || '')}" autocomplete="off" dir="ltr"></div>`;
    const list = WELLS.filter(w => w.a === a.id && !w.hid && match(w));
    if (mode === 'map') return h + areaMap(a, d);
    if (mode === 'route') {
      const dn = list.filter(w => wellState(w, d).done).length;
      h += `<section class="sec"><h3>بترتيب الطريق من محطة AG <small>${dn}/${list.length}</small></h3>${list.map(w => wellRow(w, d, { chip: 1 })).join('')}</section>`;
    } else {
      for (const t of L.TYPE_ORDER) {
        const ws = list.filter(w => w.t === t).sort((x, y) => L.natural(x.n, y.n)); if (!ws.length) continue;
        const dn = ws.filter(w => wellState(w, d).done).length;
        h += `<section class="sec ts-${t}"><h3><span class="th">${tchip(t)}${TYPE_AR[t] !== t ? ' ' + esc(TYPE_AR[t]) : ''}</span> <small>${dn}/${ws.length}</small></h3>${ws.map(w => wellRow(w, d)).join('')}</section>`;
      }
    }
    if (V.q) { const hid = WELLS.filter(w => w.hid && match(w)); if (hid.length) h += `<section class="sec"><h3>آبار مخفية <small>لو لقيت واحد شغال سجّله</small></h3>${hid.map(w => wellRow(w, d, { chip: 1 })).join('')}</section>`; }
    if (!list.length) h += `<p class="empty">مفيش بير بالاسم ده</p>`;
    return h;
  }
  // ---- map: wells of the area, the roads from the KML, and the phone's position (no internet needed)
  let POS = null, GEO = null, MAPV = null;
  let LOCT = null;
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  // where is the phone: the phone's own location service (Wi-Fi + GPS) through the plugin, the WebView's as a fallback.
  // A quick rough fix first, then the GPS to sharpen it.
  async function getPos(high, maxAge, ms) {
    if (Cap && Cap.Geolocation) {
      try { return await withTimeout(Cap.Geolocation.getCurrentPosition({ enableHighAccuracy: high, timeout: ms, maximumAge: maxAge }), ms + 3000, 'timeout'); }
      catch (e) { if (!/not implemented|unimplemented/i.test(String(e && (e.message || e)))) throw e; }
    }
    if (!navigator.geolocation) throw new Error('الموبايل مش بيدّي الموقع للتطبيق');
    return withTimeout(new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: high, timeout: ms, maximumAge: maxAge })), ms + 3000, 'timeout');
  }
  async function ensurePerm() {
    if (!(Cap && Cap.Geolocation)) return;
    let st = null; try { st = await Cap.Geolocation.checkPermissions(); } catch (e) { return; } // location turned off: getCurrentPosition says so
    const ok = x => x && (x.location === 'granted' || x.coarseLocation === 'granted');
    if (ok(st)) return;
    try { st = await Cap.Geolocation.requestPermissions(); } catch (e) { }
    if (!ok(st)) throw Object.assign(new Error('permission denied'), { code: 1 });
  }
  function geoMsg(e) {
    const m = String(e && (e.message || e) || ''), c = e && e.code;
    if (c === 1 || /denied|permission/i.test(m)) return { k: 'perm', t: 'التطبيق مش واخد إذن الموقع', how: 'من إعدادات الموبايل: التطبيقات ← AG Survey ← الأذونات ← الموقع ← "السماح أثناء استخدام التطبيق"، وشغّل "استخدام الموقع الدقيق".' };
    if (c === 2 || /disabled|not enabled|unavailable|location services|provider/i.test(m)) return { k: 'off', t: 'الموقع مقفول في الموبايل', how: 'افتح "الموقع" (Location) من الشريط اللي فوق في الموبايل، وجرّب تاني.' };
    if (c === 3 || /timeout|timed out|اتأخر/i.test(m)) return { k: 'slow', t: 'الموبايل مجابش مكانه في الوقت', how: 'لو انت جوه مبنى اطلع برة أو جنب شباك، واستنى دقيقة وجرّب تاني.' };
    return { k: 'other', t: 'مشكلة في الموقع', how: m.slice(0, 140) };
  }
  // far from the area (at home, in the office): keep the map on the wells and say how far
  const farKm = () => { if (!POS || !POS.ll || !V.a) return 0; const ws = WELLS.filter(w => w.a === V.a && w.ll); if (!ws.length) return 0; const m = Math.min(...ws.map(w => L.dist(POS.ll, w.ll))); return m > 30000 ? Math.round(m / 1000) : 0; };
  function centerOnMe() {
    if (!MAPV || !POS || !POS.ll) return; const km = farKm();
    if (km) return toast(`انت على بعد ${km} كم من ${areaOf(V.a).n}. الخريطة هتمشي معاك لما توصل.`);
    MAPV.cx = POS.ll[0]; MAPV.cy = POS.ll[1]; MAPV.z = Math.max(MAPV.z, 3);
  }
  async function locate(quiet) {
    if (GEO) return; GEO = { busy: 1 }; if (!quiet) { const b = $('[data-act=mme]'); if (b) b.classList.add('busy'); if (V.v === 'area' && S.ui.mode === 'map' && !FM) drawMapOnly(); }
    const set = p => { POS = { ll: [p.coords.longitude, p.coords.latitude], acc: Math.round(p.coords.accuracy || 0), t: Date.now() }; };
    const redraw = () => { if (V.v === 'area' && S.ui.mode === 'map' && !FM) drawMapOnly(); };
    let got = false;
    try {
      await ensurePerm();
      try { set(await getPos(false, 300000, 8000)); got = true; if (!quiet) centerOnMe(); redraw(); }
      catch (e) { const g = geoMsg(e); if (g.k === 'perm' || g.k === 'off') throw e; }
      set(await getPos(true, 0, 60000)); // offline in the desert the first GPS fix can take a minute
      if (!quiet && !got) centerOnMe(); got = true;
    } catch (e) {
      const g = geoMsg(e); logErr('GPS ' + g.k + ': ' + String(e && (e.code != null ? e.code + ' ' : '') + (e && e.message || e)).slice(0, 160));
      if (!got) { POS = Object.assign({}, POS, { err: g }); if (!quiet) toast('مش قادر أجيب مكانك: ' + g.t); }
    }
    GEO = null; redraw();
    clearTimeout(LOCT); if (POS && POS.ll && !POS.err) LOCT = setTimeout(() => { if (V.v === 'area' && S.ui.mode === 'map' && !FM && !document.hidden) locate(true); }, 30000);
  }
  function stopGeo() { clearTimeout(LOCT); }
  function mapBox(a) {
    const pts = WELLS.filter(w => w.a === a.id && !w.hid && w.ll).map(w => w.ll); if (!pts.length) return null;
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    const px = (x1 - x0) * 0.08 + 0.003, py = (y1 - y0) * 0.08 + 0.003; return [x0 - px, y0 - py, x1 + px, y1 + py];
  }
  function areaMap(a, d) {
    if (!MAPV || MAPV.a !== a.id) { const b = mapBox(a); MAPV = b ? { a: a.id, b, z: 1, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 } : null; }
    if (!MAPV) return '<p class="empty">مفيش إحداثيات للآبار دي</p>';
    return `<div class="mapw"><div id="map">${mapSvg(a, d)}</div><div class="mapbtns"><button class="ib2" data-act="mz" data-v="1" aria-label="تكبير">+</button><button class="ib2" data-act="mz" data-v="-1" aria-label="تصغير">−</button><button class="ib2" data-act="mme" aria-label="مكاني">◎</button><button class="ib2 meas ${MAPV.meas ? 'on' : ''}" data-act="mmeas" aria-label="المسافة من مكاني لبير">📏</button><button class="ib2" data-act="mfit" aria-label="المنطقة كلها">⤢</button><button class="ib2 north" data-act="mnorth" aria-label="الشمال لفوق"><span id="ncomp" style="transform:rotate(${MAPV.rot || 0}deg)">N</span></button></div></div>
      <div id="mapinfo">${mapInfo(a, d)}</div>`;
  }
  function mapScale() { const k = Math.cos(MAPV.cy * Math.PI / 180), b = MAPV.b; return { k, base: Math.min(1000 / ((b[2] - b[0]) * k), 1000 / (b[3] - b[1])) * MAPV.z }; }
  function mapInv(sx, sy) {
    const { k, base } = mapScale(), th = (MAPV.rot || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th), dx = sx - 500, dy = sy - 500;
    const x = dx * c + dy * sn, y = -dx * sn + dy * c; return [MAPV.cx + x / (k * base), MAPV.cy - y / base];
  }
  function keepAnchor(ll, scr) { // move the map so that the point `ll` sits under the finger at `scr`
    const { k, base } = mapScale(), th = (MAPV.rot || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th), dx = scr[0] - 500, dy = scr[1] - 500;
    const x = dx * c + dy * sn, y = -dx * sn + dy * c; MAPV.cx = ll[0] - x / (k * base); MAPV.cy = ll[1] + y / base;
  }
  function mapProj() {
    const { k, base } = mapScale(), th = (MAPV.rot || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    return ll => { const x = (ll[0] - MAPV.cx) * k * base, y = -(ll[1] - MAPV.cy) * base; return [500 + x * c - y * sn, 500 + x * sn + y * c]; };
  }
  function mapContent(a, d) {
    const pr = mapProj(); let g = '';
    for (const r of SEED.roads || []) g += `<polyline points="${r.map(p => pr(p).map(v => v.toFixed(1)).join(',')).join(' ')}" class="road"/>`;
    for (const w of WELLS.filter(x => x.a === a.id && !x.hid && x.ll)) {
      const [x, y] = pr(w.ll); if (x < -60 || x > 1060 || y < -60 || y > 1060) continue; const s = wellState(w, d);
      g += `<g class="wpt t-${w.t}${s.done ? ' done' : ''}${s.open ? ' down' : ''}" data-act="mw" data-w="${w.id}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16"/>${MAPV.z >= 1.5 || MAPV.sel === w.id ? `<text x="${(x + 22).toFixed(1)}" y="${(y + 7).toFixed(1)}">${esc(w.n)}</text>` : ''}</g>`;
    }
    const mw = measWell();
    if (mw) { // arrow from me to the well, with the distance in the middle
      const [x1, y1] = pr(POS.ll), [x2, y2] = pr(mw.ll), dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, k = Math.max(0, (len - 24) / len);
      const ex = x1 + dx * k, ey = y1 + dy * k, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      g += `<defs><marker id="arh" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" class="arh"/></marker></defs><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" class="mline" marker-end="url(#arh)"/>`;
      if (Math.abs(mx) < 3000 && Math.abs(my) < 3000) g += `<text x="${mx.toFixed(1)}" y="${(my - 14).toFixed(1)}" class="mlab">${fmtDist(L.dist(POS.ll, mw.ll))}</text>`;
    }
    if (POS && POS.ll) { const [x, y] = pr(POS.ll); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="26" class="me-halo"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" class="me"/>`; }
    return g;
  }
  function mapSvg(a, d) { return `<svg viewBox="0 0 1000 1000" class="map" role="img" aria-label="خريطة الآبار">${mapContent(a, d)}</svg>`; }
  const measWell = () => MAPV && MAPV.meas && POS && POS.ll && MAPV.sel && WBY[MAPV.sel] && WBY[MAPV.sel].ll ? WBY[MAPV.sel] : null;
  const bearTxt = b => ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'][Math.round(b / 45) % 8];
  function fitMeToWell(w) { // show me and the well together
    if (!MAPV || !POS || !POS.ll || !w.ll || farKm()) return;
    const { k, base } = mapScale(), b1 = base / MAPV.z, span = Math.max(Math.abs(w.ll[0] - POS.ll[0]) * k, Math.abs(w.ll[1] - POS.ll[1])) * b1;
    MAPV.cx = (w.ll[0] + POS.ll[0]) / 2; MAPV.cy = (w.ll[1] + POS.ll[1]) / 2; MAPV.z = Math.max(0.5, Math.min(12, 650 / Math.max(span, 1)));
  }
  function mapInfo(a, d) {
    let h = '';
    if (MAPV.meas) {
      const w = measWell();
      h += w ? `<div class="meascard"><span class="ml">من مكانك لـ <b dir="ltr">${esc(w.n)}</b></span><span class="mv">${fmtDist(L.dist(POS.ll, w.ll))} <span class="mar">${arrow(L.bearing(POS.ll, w.ll))}</span></span><span class="ms">ناحية ${bearTxt(L.bearing(POS.ll, w.ll))} · دقة الـ GPS ${POS.acc} متر · المسافة في خط مستقيم</span></div>`
        : `<div class="meascard"><span class="ml">${POS && POS.ll ? 'اضغط على البير اللي عاوز تعرف المسافة ليه' : GEO ? 'بيحدد مكانك… من غير نت أول مرة ممكن تاخد دقيقة' : 'لسه مكانك متحددش. اضغط ◎'}</span><span class="ms">علشان تقفل المسافة اضغط 📏 تاني</span></div>`;
    }
    if (MAPV.sel && WBY[MAPV.sel]) { const w = WBY[MAPV.sel]; h += `<section class="sec"><h3>${esc(w.n)} <small>${esc(TYPE_AR[w.t])}</small></h3>${wellRow(w, d, { chip: 1, dist: POS && POS.ll && w.ll ? fmtDist(L.dist(POS.ll, w.ll)) : null })}</section>`; }
    const km = farKm();
    if (POS && POS.ll && km) h += `<div class="banner" style="margin-top:10px">مكانك اتحدد، بس انت على بعد ${km} كم من ${esc(a.n)}، فالخريطة فاضلة على الآبار. لما توصل المنطقة هتلاقي نفسك على الخريطة وأقرب آبار ليك.</div>`;
    else if (POS && POS.ll) {
      const near = WELLS.filter(w => w.a === a.id && !w.hid && w.ll).map(w => ({ w, m: L.dist(POS.ll, w.ll) })).sort((x, y) => x.m - y.m).slice(0, 6);
      h += `<section class="sec"><h3>أقرب آبار ليك <small>دقة الـ GPS ${POS.acc} متر</small></h3>${near.map(x => wellRow(x.w, d, { chip: 1, dist: fmtDist(x.m) + ' ' + arrow(L.bearing(POS.ll, x.w.ll)) })).join('')}</section>`;
    } else h += `<p class="mute" style="margin:10px 2px">${GEO ? 'بيدوّر على مكانك… لو مفيش نت، أول مرة الـ GPS ممكن ياخد لحد دقيقة، خليك في مكان مكشوف.' : POS && POS.err ? '<b>مش قادر أجيب مكانك: ' + esc(POS.err.t || POS.err) + '.</b> ' + esc(POS.err.how || '') + ' وبعدها اضغط ◎ تاني.' : 'اضغط ◎ علشان تشوف مكانك وأقرب آبار ليك.'}</p>`;
    return h;
  }
  const fmtDist = m => m < 1000 ? Math.round(m / 10) * 10 + ' م' : (m / 1000).toFixed(1) + ' كم';
  const arrow = b => ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(b / 45) % 8];
  function drawMapOnly(noInfo) {
    const svg = $('#map svg.map'), i = $('#mapinfo'), a = areaOf(V.a); if (!svg || !a || !MAPV) return;
    svg.innerHTML = mapContent(a, viewDay()); const n = $('#ncomp'); if (n) n.style.transform = `rotate(${MAPV.rot || 0}deg)`;
    if (i && !noInfo) i.innerHTML = mapInfo(a, viewDay());
  }
  function areaPress(a, d) {
    const D = dayGet(d), ro = editable() ? '' : 'disabled';
    const ps = SEED.points.filter(p => p.a === a.id).sort((x, y) => x.o - y.o);
    if (!ps.length) return '<p class="empty">مفيش نقط ضغط في المنطقة دي</p>';
    let h = `<button class="btn wa2 wide" style="margin-top:12px" data-act="pimg">${ic('share')} ابعت المانيفولد صورة</button>`; const kinds = [...new Set(ps.map(p => p.kind))];
    for (const k of kinds) {
      h += `<section class="sec"><h3>${esc(k)}</h3>`;
      for (const p of ps.filter(x => x.kind === k)) for (const hd of p.h) {
        const x = D.p[p.id], v = x && x.h[hd || '-'];
        h += `<div class="irow"><span class="nm">${esc(p.n)}${hd ? ` <small>Header ${esc(hd)}</small>` : ''}</span><input inputmode="decimal" data-pt="${p.id}" data-h="${esc(hd || '-')}" value="${esc(v ?? '')}" ${ro}><span class="u">psi</span></div>`;
      }
      h += '</section>';
    }
    return h;
  }
  const areaTanks = aid => TANKS.filter(t => t.a === aid && (!t.w.length || t.w.some(id => WBY[id] && !WBY[id].hid)));
  function areaDiesel(a, d) {
    const D = dayGet(d), ro = editable() ? '' : 'disabled';
    const ts = areaTanks(a.id), chW = visibleWells(a.id).filter(w => (w.ch || []).length);
    if (!ts.length && !chW.length) return '<p class="empty">مفيش تانكات في المنطقة دي</p>';
    if (!ts.length) return chemSection(chW, d, ro);
    const places = []; for (const t of ts) { let p = places.find(x => x.n === t.place); if (!p) places.push(p = { n: t.place, t: [] }); p.t.push(t); }
    let h = `<p class="mute" style="margin:12px 2px 0">نسبة الديزل في كل تانك من 0 لـ 100. نفس النسبة بتظهر في شاشة البير، وبتروح لشيت الديزل لوحدها.</p><section class="sec"><h3>التانكات <small>تنبيه تحت ${S.cfg.dieselMin}%</small></h3>`;
    for (const p of places) {
      const wl = p.t[0].w.map(id => WBY[id]).filter(Boolean);
      for (const [i, t] of p.t.entries()) {
        const x = D.d[t.id], v = x ? x.v : '', n = L.toNum(v), low = n != null && n < S.cfg.dieselMin;
        h += `<div class="irow"><span class="nm">${esc(p.n)}${p.t.length > 1 ? ` · تانك ${i + 1}` : ''}<small>${esc(t.code || 'من غير كود')}${t.cap ? ' · ' + t.cap.toLocaleString('en') + ' لتر' : ''}${wl.length > 1 ? ' · مشترك: ' + wl.map(w => esc(w.n)).join(' + ') : ''}</small></span><input inputmode="decimal" data-tk="${t.id}" value="${esc(v)}" class="${low ? 'low' : ''}" ${ro}><span class="u">%</span></div>`;
      }
    }
    return h + '</section>' + chemSection(chW, d, ro);
  }
  function chemSection(ws, d, ro) {
    if (!ws.length) return '';
    let h = `<section class="sec"><h3>الكيميكال <small>نسبة التانك %</small></h3>`;
    for (const w of ws) { const cv = chemOf(d, w.id); for (const c of w.ch) { const v = cv[c] ?? '', n = L.toNum(v), mn = L.chemMin(S.cfg, c);
      h += `<div class="irow"><span class="nm">${esc(w.n)}<small><bdi dir="ltr">${esc(L.CHEM_N[c] || c)}</bdi> · تنبيه تحت ${mn}%</small></span><input inputmode="decimal" data-chw="${w.id}" data-chc="${c}" value="${esc(v)}" class="${n != null && n < mn ? 'low' : ''}" ${ro}><span class="u">%</span></div>`; } }
    return h + '</section>';
  }
  // ---------------- المتابعة: people, today's maintenance, work on wells, tasks ----------------
  function staffBlock(aid, d, cs, title) {
    const pl = planFor(d, aid), ppl = pl.staff.map(staffP), y = planFor(L.addDays(d, -1), aid).staff.length;
    let h = `<div class="sblock">${title ? `<div class="sbh"><b>${esc(areaOf(aid).n)}</b><small>${ppl.length ? ppl.length + ' فرد' : ''}</small></div>` : ''}`;
    h += ppl.length ? ppl.map((e, i) => `<div class="person"><span class="pn">${esc(e.n)}${isMe(e) ? ' <span class="tag">انت</span>' : ''}</span>${e.ph ? `<a class="tel" href="tel:${esc(digits(e.ph))}" dir="ltr">${esc(e.ph)}</a>` : ''}${cs ? `<button class="ib3" data-act="stdel" data-a="${aid}" data-i="${i}" aria-label="شيل">×</button>` : ''}</div>`).join('')
      : `<p class="mute" style="margin:6px 0">لسه محدش اتوزع هنا</p>`;
    if (cs) h += `<div class="addrow"><button class="btn sm pen" data-act="stadd" data-a="${aid}">+ فرد</button>${!ppl.length && y ? `<button class="btn sm" data-act="stcopy" data-a="${aid}">زي امبارح</button>` : ''}</div>`;
    return h + '</div>';
  }
  // one box of the distribution: an area, or an extra job (سيارة الديزل، Treatment، …)
  function sbox(t, d, cs) {
    const j = t.job ? jobObj(d, t.job) : null; if (t.job && !j) return '';
    const ppl = (j ? j.staff : planFor(d, t.aid).staff).map(staffP), da = j ? `data-j="${j.id}"` : `data-a="${t.aid}"`;
    let h = `<div class="sbox${j ? ' job' : ''}"><div class="sbt"><b>${esc(j ? j.k : areaOf(t.aid).n)}</b>${ppl.length ? `<small>${ppl.length}</small>` : ''}${j && cs ? `<button class="ib3 xs" data-act="jobdel" data-j="${j.id}" aria-label="امسح الخانة">×</button>` : ''}</div>`;
    h += ppl.length ? ppl.map((e, i) => `<div class="sp"><span class="spn"><span class="spt">${esc(e.n)}${isMe(e) ? ' <span class="tag">انت</span>' : ''}</span>${e.ph ? `<a class="tel" href="tel:${esc(digits(e.ph))}" dir="ltr">${esc(e.ph)}</a>` : ''}</span>${cs ? `<button class="ib3 xs" data-act="stdel" ${da} data-i="${i}" aria-label="شيل">×</button>` : ''}</div>`).join('')
      : `<p class="mute sempty">لسه محدش</p>`;
    if (cs) h += `<button class="btn sm pen sbadd" data-act="stadd" ${da}>+ فرد</button>`;
    return h + '</div>';
  }
  const itemText = x => { const nm = id => WBY[id] ? WBY[id].n : id, it = x.it;
    return x.k === 'maint' ? MAINT[it.k] + (it.at ? ' · ' + hmWords(it.at) : '') + ' · ' + it.w.map(nm).join('، ') + (it.n ? ' — ' + it.n : '')
      : x.k === 'work' ? nm(it.w) + ' · ' + it.k + (it.n ? ' — ' + it.n : '') : it.x + (it.w ? ' · ' + nm(it.w) : ''); };
  function planSections(aids, d, cp, many) {
    const seen = S.ui.seen || {}, nm = id => WBY[id] ? esc(WBY[id].n) : id, ar = aid => many ? `<span class="tag">${esc(areaOf(aid).n)}</span> ` : '';
    const fresh = it => !seen[it.id] && it.by !== S.me ? ' nw' : '', del = (k, it, aid) => cp ? `<button class="ib3" data-act="pldel" data-k="${k}" data-a="${aid}" data-i="${it.id}" aria-label="امسح">×</button>` : '';
    const all = k => aids.flatMap(aid => planFor(d, aid)[k].map(it => ({ it, aid })));
    const add = k => cp ? `<button class="linkbtn" data-act="pladd" data-k="${k}"${many ? '' : ` data-a="${aids[0]}"`}>+ ${{ maint: 'صيانة', work: 'شغل على بير', tasks: 'مهمة' }[k]}</button>` : '';
    const M = all('maint'), Wk = all('work'), T = all('tasks');
    let h = `<section class="sec plan"><h3>صيانات اليوم <small>المهندس · ${M.length}</small></h3>`;
    h += M.length ? M.map(({ it, aid }) => `<div class="pitem${fresh(it)}"><span class="pt">${ar(aid)}${esc(MAINT[it.k])}${it.at ? ` · ${esc(hmWords(it.at))}` : ''}<small>${it.w.map(nm).join(' · ')}${it.n ? ' — ' + esc(it.n) : ''}</small></span>${del('maint', it, aid)}</div>`).join('') : '<p class="empty">مفيش صيانات النهارده</p>';
    h += add('maint') + `</section><section class="sec plan"><h3>شغل على الآبار <small>${Wk.length}</small></h3>`;
    h += Wk.length ? Wk.map(({ it, aid }) => `<div class="pitem${fresh(it)}"><span class="pt">${ar(aid)}${nm(it.w)} · ${esc(it.k)}<small>${it.n ? esc(it.n) : ''}</small></span>${del('work', it, aid)}</div>`).join('') : '<p class="empty">مفيش شغل على آبار النهارده</p>';
    h += add('work') + `</section><section class="sec plan"><h3>مهام مطلوبة <small>${T.filter(x => x.it.done).length}/${T.length}</small></h3>`;
    h += T.length ? T.map(({ it, aid }) => `<div class="pitem${fresh(it)}"><label class="tk"><input type="checkbox" data-task="${it.id}" data-a="${aid}" ${it.done ? 'checked' : ''} ${editable() ? '' : 'disabled'}><span class="pt">${ar(aid)}${esc(it.x)}${it.w ? ' · ' + nm(it.w) : ''}<small>${it.done ? 'خلصت · ' + esc(it.done.byn || '') + ' ' + hmA(it.done.t) : esc(it.byn || '')}</small></span></label>${del('tasks', it, aid)}</div>`).join('') : '<p class="empty">مفيش مهام النهارده</p>';
    return h + add('tasks') + '</section>';
  }
  function vFollow() {
    const d = viewDay(), cs = canStaff() && editable(), cp = canPlan() && editable(), ids = SEED.areas.map(a => a.id), now = Date.now();
    let h = top('المتابعة', dayLine()) + '<main class="wrap">';
    if (!editable()) h += `<div class="banner">ده يوم قديم. التعديل للأدمن بس.</div>`;
    h += `<section class="sec plan"><h3>توزيعة الأفراد <button class="btn sm wa shr" data-act="stshare">${ic('share')} شير صورة</button></h3><div class="pbody"><div class="sgrid">${areasOrdered().map(a => sbox({ aid: a.id }, d, cs)).join('')}${jobsFor(d).map(j => sbox({ job: j.id }, d, cs)).join('')}${cs ? '<button class="sadd" data-act="jobadd"><b>+</b>خانة تانية<small>سيارة الديزل، Treatment…</small></button>' : ''}</div>`;
    const yd = L.addDays(d, -1);
    if (cs && ids.every(id => !planFor(d, id).staff.length) && !jobsFor(d).length && (ids.some(id => planFor(yd, id).staff.length) || jobsFor(yd).length)) h += `<button class="btn wide" style="margin-top:10px" data-act="stcopyall">نفس توزيعة امبارح</button>`;
    h += '</div></section>' + planSections(ids, d, cp, true);
    const open = WELLS.map(w => ({ w, e: L.openEvent(S.dt, w.id) })).filter(x => x.e);
    h += `<section class="sec"><h3>واقف دلوقتي <small>${open.length}</small></h3>`;
    h += open.length ? open.map(({ w, e }) => `<button class="wrow" data-act="well" data-w="${w.id}"><span class="wn">${esc(w.n)} <span class="tag">${esc(areaOf(w.a).n)}</span></span><span class="ws">${esc(e.r)}${e.o ? ' · ' + esc(e.o) : ''}</span><span class="wa">من ${hmA(e.s)} · بقاله ${durTxt(now - e.s)}</span><span class="wm"></span></button>`).join('') : '<p class="empty">كل الآبار شغالة</p>';
    markSeen(d, ids);
    return h + '</section></main>' + tabs('follow');
  }
  function areaDown(a, d) {
    const now = Date.now(), [s0, e0] = L.dayWindow(d, H()), cp = canPlan() && editable(), cs = canStaff() && editable();
    let h = `<section class="sec plan"><h3>المتابعة · الأفراد <small>${esc(a.n)}</small></h3><div class="pbody">${staffBlock(a.id, d, cs, false)}</div></section>`;
    h += planSections([a.id], d, cp, false);
    const ws = WELLS.filter(w => w.a === a.id);
    const open = ws.map(w => ({ w, e: L.openEvent(S.dt, w.id) })).filter(x => x.e);
    const today = S.dt.filter(e => WBY[e.w] && WBY[e.w].a === a.id && e.s < e0 && (e.e == null || e.e > s0)).sort((x, y) => y.s - x.s);
    h += `<section class="sec"><h3>واقف دلوقتي <small>${open.length}</small></h3>`;
    h += open.length ? open.map(({ w, e }) => `<button class="wrow" data-act="well" data-w="${w.id}"><span class="wn">${esc(w.n)} <span class="tag dn">واقف</span></span><span class="ws">${esc(e.r)}${e.o ? ' · ' + esc(e.o) : ''}</span><span class="wa">من ${hmA(e.s)} · بقاله ${durTxt(now - e.s)}</span><span class="wm"></span></button>`).join('') : '<p class="empty">كل الآبار شغالة</p>';
    h += `</section><section class="sec"><h3>وقفات النهارده <small>${today.length}</small></h3>`;
    h += today.length ? today.map(e => { const w = WBY[e.w]; return `<button class="wrow" data-act="well" data-w="${w.id}"><span class="wn">${esc(w.n)}</span><span class="ws">${esc(e.r)}${e.o ? ' · ' + esc(e.o) : ''}</span><span class="wa">${hmA(e.s)} ← ${e.e ? hmA(e.e) : 'لسه واقف'} · ${durTxt((e.e || now) - e.s)}</span><span class="wm"></span></button>`; }).join('') : '<p class="empty">مفيش وقفات النهارده</p>';
    h += `</section><section class="sec"><h3>ساعات التشغيل <small>من ${H()} الصبح لحد دلوقتي</small></h3>`;
    const rows = visibleWells(a.id).map(w => ({ w, u: L.uptime(S.dt, w.id, d, H(), now) })).filter(x => x.u.down > 0);
    h += rows.length ? rows.map(({ w, u }) => `<div class="irow"><span class="nm">${esc(w.n)}<small>شغال ${u.up} من ${u.span} ساعة</small></span></div>`).join('') : '<p class="empty">كل الآبار شغالة طول الوقت لحد دلوقتي</p>';
    return h + '</section>';
  }
  // people: pick from the people registered on the app (list + search, several at once), or type a name (phone optional)
  let PP = null; // { t: {aid}|{job}|{newJob}, sel: [user names], q, have: Set of names already in the box }
  function ppHtml(t, have) {
    PP = { t, sel: [], q: '', have: new Set(have) };
    const any = Object.keys(S.users).length;
    return `${any ? `<label class="lab">من المسجلين على التطبيق</label><div class="wp"><input class="in wpq" id="ppq" placeholder="ابحث بالاسم أو الرقم" autocomplete="off"><div id="pps">${ppSel()}</div><div class="wpl" id="ppl">${ppList()}</div></div>` : ''}
      <label class="lab" style="margin-top:12px">${any ? 'أو اكتب اسم مش مسجل' : 'الاسم'}</label><input class="in" id="stn" placeholder="الاسم" autocomplete="off">
      <input class="in" id="stp" inputmode="tel" dir="ltr" placeholder="رقم التليفون (اختياري)" autocomplete="off" style="margin-top:8px">`;
  }
  function ppList() {
    const q = PP.q.trim().toLowerCase(), qd = digits(q);
    const us = Object.values(S.users).filter(u => !PP.have.has(u.name) && (!q || String(u.name).toLowerCase().includes(q) || (qd.length >= 3 && digits(u.phone).includes(qd))))
      .sort((x, y) => String(x.name).localeCompare(String(y.name), 'ar'));
    return us.map(u => { const on = PP.sel.includes(u.u); return `<button type="button" class="wpi ${on ? 'on' : ''}" data-act="ppk" data-u="${esc(u.u)}"><i class="cb">${on ? ic('check') : ''}</i><b>${esc(u.name)}</b><span class="mute" dir="ltr">${esc(u.phone || '')}</span></button>`; }).join('')
      || `<p class="empty">${q ? 'مفيش حد بالاسم ده' : 'كل المسجلين موجودين هنا'}</p>`;
  }
  function ppSel() { const us = PP.sel.map(u => S.users[u]).filter(Boolean); return us.length ? `<div class="wpchips">${us.map(u => `<button type="button" class="wpc" data-act="ppk" data-u="${esc(u.u)}"><b>${esc(u.name)}</b> ✕</button>`).join('')}</div>` : ''; }
  function ppRefresh(top) { const l = $('#ppl'), x = $('#pps'); if (l) { const st = l.scrollTop; l.innerHTML = ppList(); l.scrollTop = top ? 0 : st; } if (x) x.innerHTML = ppSel(); }
  // the people chosen in the box: [] when none, null when the typed phone is wrong
  function ppPeople() {
    const out = PP.sel.map(u => S.users[u]).filter(Boolean).map(u => staffS(u.name, digits(u.phone)));
    const n = ($('#stn').value || '').trim(), ph = digits($('#stp').value);
    if (n) { if (ph && ph.replace('+', '').length < 7) { toast('رقم التليفون قصير'); return null; } if (!out.some(x => staffP(x).n === n)) out.push(staffS(n, ph)); }
    else if (ph) { toast('اكتب الاسم'); return null; }
    return out;
  }
  function staffBox(t) {
    const d = viewDay(), j = t.job ? jobObj(d, t.job) : null; if (t.job && !j) return;
    const list = j ? j.staff : planFor(d, t.aid).staff;
    modal(`<h3>${j ? 'ناس في ' + esc(j.k) : 'ناس في ' + esc(areaOf(t.aid).n)}</h3>${ppHtml(t, list.map(x => staffP(x).n))}
      <div class="btns" style="margin-top:12px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="stok">ضيف</button></div>`);
  }
  function staffOk() {
    const ppl = ppPeople(); if (ppl === null) return; if (!ppl.length) return toast('اختار حد أو اكتب اسم');
    const d = viewDay(), t = PP.t, j = t.job ? jobObj(d, t.job) : null; if (t.job && !j) return closeModal();
    const arr = j ? j.staff : planObj(d, t.aid).staff, add = ppl.filter(x => !arr.some(y => staffP(y).n === staffP(x).n));
    if (!add.length) return toast('موجودين بالفعل');
    arr.push(...add);
    if (j) { j.t = Date.now(); mark(`pj|${d}|${j.id}`); } else mark(`ps|${d}|${t.aid}`);
    audit('plan', j ? j.k : areaOf(t.aid).n, 'توزيعة الأفراد', '', add.join('، '), d); save(); closeModal(); render(); toast(add.length > 1 ? `اتضاف ${add.length}` : 'اتضاف');
  }
  // an extra box: the job, then its people
  function jobBox() {
    modal(`<h3>خانة جديدة في التوزيعة</h3><label class="lab">الشغلانة</label><select class="in" id="jk">${JOBS.map(x => `<option>${esc(x)}</option>`).join('')}<option value="__o">شغلانة تانية…</option></select>
      <div id="jkw" hidden><input class="in" id="jko" placeholder="اسم الشغلانة" autocomplete="off" style="margin-top:8px"></div>
      ${ppHtml({ newJob: 1 }, [])}
      <div class="btns" style="margin-top:12px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="jobok">ضيف الخانة</button></div>`);
  }
  function jobOk() {
    const sel = $('#jk').value, k = sel === '__o' ? ($('#jko').value || '').trim() : sel; if (!k) return toast('اكتب اسم الشغلانة');
    const ppl = ppPeople(); if (ppl === null) return;
    const d = viewDay(); S.jobs = S.jobs || {}; const list = S.jobs[d] || (S.jobs[d] = []);
    const j = Object.assign({ id: uid(), k, staff: ppl }, stampBy()); list.push(j); mark(`pj|${d}|${j.id}`);
    audit('plan', k, 'خانة في التوزيعة', '', ppl.join('، '), d); save(); closeModal(); render(); toast('اتضافت الخانة');
  }
  // the distribution as one picture on WhatsApp: every box under the other, so it reads clearly
  async function doStaffImage() {
    const d = viewDay(), groups = areasOrdered().map(a => ({ title: a.n, people: planFor(d, a.id).staff.map(staffP) })).concat(jobsFor(d).map(j => ({ title: j.k, job: 1, people: j.staff.map(staffP) })));
    if (!groups.some(g => g.people.length)) return toast('لسه محدش اتوزع النهارده');
    toast('بيجهز الصورة…');
    try { const jpeg = await PDF.staffImage('توزيعة الأفراد', 'يوم الإنتاج: ' + arDay(d) + ' · من ' + H() + ' الصبح', groups); await shareFile(`tawzee3_${d}.jpg`, jpeg, 'image/jpeg'); }
    catch (e) { toast('حصلت مشكلة في الصورة: ' + (e.message || e)); }
  }
  // remove a registered person completely: from every phone and from the sheet. The user name is kept only as a hash,
  // and the name and phone are wiped from everything they wrote or were written in (readings keep their values).
  function scrubUser(x) {
    const u = S.users[x] || null, h = L.uhash(x), name = u ? String(u.name || '').trim() : '', ph = u ? digits(u.phone).replace('+', '') : '';
    delete S.users[x]; S.ui.here = (S.ui.here || []).filter(v => v !== x); S.gone = S.gone || {}; S.gone[h] = 1;
    SYNC.forget('u|' + x); mark('ux|' + h);
    const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRe = name ? new RegExp('(^|[\\s·،,(:-])' + reEsc(name) + '(?=$|[\\s·،,):-])', 'gi') : null;
    const phHit = v => ph.length >= 7 && digits(v).includes(ph);
    const hit = v => typeof v === 'string' && (v === x || (name && v.trim().toLowerCase() === name.toLowerCase()) || phHit(v) || (nameRe && (nameRe.lastIndex = 0, nameRe.test(v))));
    const clean = v => { let t = v; if (nameRe) t = t.replace(nameRe, '$1'); if (ph.length >= 7) t = t.replace(/\+?\d[\d ]{6,}\d/g, m => digits(m).includes(ph) ? '' : m); t = t.replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '').replace(/،\s*،/g, '،').replace(/^\s*،\s*|\s*،\s*$/g, '').trim(); return t === x ? '' : t; };
    const person = v => { const p = staffP(v); return (name && p.n.toLowerCase() === name.toLowerCase()) || (p.ph && phHit(p.ph)); };
    const walk = v => {
      if (Array.isArray(v)) return v.filter(e => !(typeof e === 'string' && person(e))).map(walk);
      if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = (k === 'by' || k === 'u' || k === 'refn') && v[k] === x ? '' : walk(v[k]); return o; }
      return hit(v) ? clean(v) : v;
    };
    let n = 0;
    SYNC.each(k => {
      if (k.startsWith('u|') || k.startsWith('ux|')) return;
      const d = SYNC._get(k); if (d == null) return; const s0 = JSON.stringify(d);
      const d2 = walk(d); if (JSON.stringify(d2) === s0) return;
      SYNC._set(k, d2); SYNC.mark(k, 0, true); n++;
    });
    if (S.me === x) { S.me = null; ADMIN_ON = false; }
    return n;
  }
  // a person removed on another phone
  function onGone(h) {
    for (const u of Object.keys(S.users)) if (L.uhash(u) === h) { delete S.users[u]; S.ui.here = (S.ui.here || []).filter(v => v !== u); if (S.me === u) { S.me = null; ADMIN_ON = false; } }
  }
  // the web version (iPhone, computer) has no field data inside it: the Android app puts the wells' data
  // in the sheet in parts, and the web version takes it from there after the admin's private link
  const SEED_PART = 20000, WEB_URL = 'https://mohakim765.github.io/ag-survey/';
  let SEED_NEW = false;
  const seedText = () => JSON.stringify(SEED);
  function seedPart(ver, i) { if (ver !== SEED.version) return null; const t = seedText(), n = Math.ceil(t.length / SEED_PART); return i < n ? { n, i, s: t.slice(i * SEED_PART, (i + 1) * SEED_PART) } : null; }
  function onSeed(ver, i, d) {
    if (!d || typeof d.s !== 'string' || !(d.n > 0)) return;
    if (!(window.CONFIG && CONFIG.web)) { if (ver === SEED.version) S.seedPub = ver; return; }
    if (!(ver > (SEED.version || ''))) return;
    let P = null; try { P = JSON.parse(localStorage.getItem('ags_seed_parts') || 'null'); } catch (e) { }
    if (!P || P.v !== ver) P = { v: ver, n: d.n, p: {} };
    P.p[i] = d.s;
    if (Object.keys(P.p).length >= P.n) {
      const t = Array.from({ length: P.n }, (_, j) => P.p[j] || '').join('');
      try { if (JSON.parse(t).version === ver) { localStorage.setItem('ags_seed', t); SEED_NEW = true; } } catch (e) { }
      localStorage.removeItem('ags_seed_parts');
    } else try { localStorage.setItem('ags_seed_parts', JSON.stringify(P)); } catch (e) { }
  }
  function publishSeed() {
    if ((window.CONFIG && CONFIG.web) || !SYNC.url() || S.seedPub === SEED.version) return;
    const n = Math.ceil(seedText().length / SEED_PART); for (let i = 0; i < n; i++) SYNC.mark(`sd|${SEED.version}|${i}`);
    S.seedPub = SEED.version; save();
  }
  // the private link: opens the web version already tied to the sheet
  const webLink = () => WEB_URL + '#link=' + btoa(unescape(encodeURIComponent(JSON.stringify({ u: SYNC.url(), k: (window.CONFIG && CONFIG.syncKey) || '' })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // people the admin asked to remove before the delete button existed (by hash only)
  const GONE0 = ['58e77434de587e52'];
  // an alert when something new reaches the area this person works in
  function checkAlerts() {
    if (!me() || FM || !modalEl.hidden || VDAY) return;
    const d = curDay(), al = S.ui.alerted || (S.ui.alerted = {}), list = unseen(d, myAreas(d)).filter(x => !al[x.it.id]); // only people placed in the area
    if (!list.length) return;
    for (const x of list) al[x.it.id] = 1; save();
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) { }
    modal(`<h3>${list.length === 1 ? 'في حاجة جديدة في المتابعة' : `في ${list.length} حاجات جديدة في المتابعة`}</h3>${list.slice(0, 6).map(x => `<div class="pitem nw"><span class="pt"><b>${esc(x.lab)}</b> · ${esc(itemText(x))}<small>${esc(areaOf(x.aid).n)}${x.it.byn ? ' · من ' + esc(x.it.byn) : ''}</small></span></div>`).join('')}
      <div class="btns" style="margin-top:12px"><button class="btn" data-act="mclose">بعدين</button><button class="btn pen" data-act="gofollow" data-a="${list[0].aid}">افتح المتابعة</button></div>`);
  }
  // ---------------- samples, inside each area ----------------
  function areaSamples(a, d) {
    const list = S.samples.filter(s => s.day === d && sampleArea(s) === a.id).sort((x, y) => y.ts - x.ts), sel = V.sw ? WBY[V.sw] : null;
    let h = '<div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">عينة جديدة</h3>';
    h += `<label class="lab">البير أو النقطة</label>${sel ? `<div class="picked">${tchip(sel.t)} <b>${esc(sel.n)}</b><button class="btn sm" data-act="sclear">غيّر</button></div>`
      : `<input class="in" id="sq" placeholder="ابحث باسم البير، زي 13 أو NEAG" value="${esc(V.sq || '')}" autocomplete="off" dir="ltr"><div id="sres">${sampleResults(a.id)}</div>`}
      <label class="lab" style="margin-top:12px">نوع العينة</label><div class="seg" id="sk"><button type="button" class="${V.sk === 'W' ? '' : 'on'}" data-act="sk" data-v="O">زيت</button><button type="button" class="${V.sk === 'W' ? 'on' : ''}" data-act="sk" data-v="W">مية</button></div>
      <label class="lab" style="margin-top:12px">كومنت</label><input class="in" id="sn" placeholder="اختياري">
      <p class="mute">الوقت واسمك بيتسجلوا لوحدهم.</p><button class="btn pen wide" data-act="ssave" ${editable() ? '' : 'disabled'}>سجّل العينة</button></div>`;
    h += `<p class="h2">عينات النهارده (${list.length})</p><div class="card">${list.length ? list.map(s => { const w = WBY[s.w]; return `<div class="lrow"><span class="nm">${esc(w ? w.n : s.pt)}<small>${s.kind === 'W' ? 'مية' : 'زيت'} · ${hmA(s.ts)} · ${esc(s.byn || '')}${s.n ? ' · ' + esc(s.n) : ''}</small></span></div>`; }).join('') : '<p class="empty">مفيش عينات لسه</p>'}</div>`;
    return h;
  }
  // ---------------- a well picker: the search box and the list under it, always both ----------------
  let WP = null; // { ws, multi, sel, q, none, first, many, onPick }
  function wpHtml(o) {
    WP = Object.assign({ multi: false, sel: [], q: '', none: '', first: '', many: false, onPick: null }, o);
    return `<div class="wp"><input class="in wpq" id="wpq" placeholder="ابحث باسم البير، زي 99 أو SWAG" autocomplete="off" dir="ltr"><div id="wps">${wpSel()}</div><div class="wpl" id="wpl">${wpList()}</div></div>`;
  }
  function wpList() {
    const q = WP.q.trim(), ws = WP.ws.filter(wellMatch(q)), on = id => WP.sel.includes(id);
    let h = '';
    if (!q && WP.none) h += `<button type="button" class="wpi none ${WP.sel.length ? '' : 'on'}" data-act="wpk" data-w="">${esc(WP.none)}</button>`;
    if (!q && WP.first) h += `<button type="button" class="wpi none ${on('__first') ? 'on' : ''}" data-act="wpk" data-w="__first">${esc(WP.first)}</button>`;
    h += ws.map(w => `<button type="button" class="wpi ${on(w.id) ? 'on' : ''}" data-act="wpk" data-w="${w.id}">${WP.multi ? `<i class="cb">${on(w.id) ? ic('check') : ''}</i>` : ''}${tchip(w.t)} <b dir="ltr">${esc(w.n)}</b>${WP.many ? `<span class="mute">${esc(areaOf(w.a).n)}</span>` : ''}${w.hid ? '<span class="mute">مخفي</span>' : ''}</button>`).join('');
    if (!ws.length) h += `<p class="empty">مفيش بير بالاسم ده</p>`;
    return h;
  }
  function wpSel() {
    if (WP.sel[0] === '__first') return `<div class="wpchips"><span class="wpc">${esc(WP.first)}</span></div>`;
    const ws = WP.sel.map(id => WBY[id]).filter(Boolean);
    if (!ws.length) return WP.multi ? '<p class="mute wph">اختار بير أو أكتر</p>' : '';
    return `<div class="wpchips">${ws.map(w => WP.multi ? `<button type="button" class="wpc" data-act="wpk" data-w="${w.id}"><b dir="ltr">${esc(w.n)}</b> ✕</button>` : `<span class="wpc"><b dir="ltr">${esc(w.n)}</b></span>`).join('')}${WP.multi && ws.length > 1 ? `<span class="mute">${ws.length} آبار</span>` : ''}</div>`;
  }
  function wpRefresh(top) { const l = $('#wpl'), x = $('#wps'); if (l) { const st = l.scrollTop; l.innerHTML = wpList(); l.scrollTop = top ? 0 : st; } if (x) x.innerHTML = wpSel(); }
  function wpPick(id) {
    if (!WP) return;
    if (WP.multi) WP.sel = WP.sel.includes(id) ? WP.sel.filter(x => x !== id) : WP.sel.concat(id);
    else WP.sel = id ? [id] : [];
    wpRefresh(); if (WP.onPick) WP.onPick();
  }
  // generator maintenance only on wells that have a generator: ESP, SRP, WSW, or a diesel tank
  const hasGen = w => !!w && (['ESP', 'SRP', 'WSW'].includes(w.t) || tanksOf(w.id).length > 0);
  let MPA = null, MPK = null;
  function planPool(k, mk) {
    let ws = (MPA ? [MPA] : SEED.areas.map(a => a.id)).flatMap(visibleWells);
    if (k === 'maint' && mk !== 'other') ws = ws.filter(hasGen);
    return ws.sort((x, y) => L.natural(x.n, y.n));
  }
  function planBox(k, aid) {
    MPA = aid || null; MPK = k; const many = !aid;
    const t = { maint: 'صيانة اليوم', work: 'شغل على بير', tasks: 'مهمة' }[k], head = `<h3>${t}${many ? '' : ' · ' + esc(areaOf(aid).n)}</h3>`;
    const btns = `<div class="btns" style="margin-top:12px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="plok" data-k="${k}">حفظ</button></div>`;
    if (k === 'maint') modal(`${head}<label>نوع الصيانة</label><select class="in" id="mk">${Object.entries(MAINT).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select><p class="mute" id="mkh" style="margin:4px 0 0"></p>
      <label>الآبار</label>${wpHtml({ ws: planPool('maint', 'stop'), multi: true, many, onPick: planArea })}<div id="pla"></div>
      <label>ملاحظة</label><input class="in" id="mn" placeholder="اختياري">${btns}`);
    if (k === 'work') modal(`${head}<label>البير</label>${wpHtml({ ws: planPool('work'), many, onPick: planArea })}<div id="pla"></div>
      <label>نوع الشغل</label><select class="in" id="pwk">${WORK.map(x => `<option>${esc(x)}</option>`).join('')}</select><label>ملاحظة</label><input class="in" id="pwn">${btns}`);
    if (k === 'tasks') modal(`${head}<label>المطلوب</label><input class="in" id="ptx" placeholder="مثلاً: عينة مية من AG-119"><label>البير <em class="mute">(لو المهمة على بير)</em></label>${wpHtml({ ws: planPool('tasks'), none: 'من غير بير', many, onPick: planArea })}<div id="pla"></div>${btns}`);
    if (k === 'maint') { const mk = $('#mk'); mk.onchange = () => { const n = WP.sel.length; WP.ws = planPool('maint', mk.value); WP.sel = WP.sel.filter(id => WP.ws.some(w => w.id === id)); wpRefresh(true); planArea(); mkHint(); if (WP.sel.length < n) toast('شلت الآبار اللي مفيهاش مولد'); }; mkHint(); }
    planArea();
  }
  function mkHint() { const h = $('#mkh'), v = ($('#mk') || {}).value; if (h) h.textContent = v === 'other' ? '' : 'بتظهر آبار المولدات بس: ESP و SRP و WSW. البير اللي هيقف، الفني بيسجّل وقفته من شاشة البير.'; }
  // the area comes from the well; a task with no well needs its area, so the people there get the alert
  function planArea() {
    const el = $('#pla'); if (!el) return;
    if (MPA) { el.innerHTML = ''; return; }
    const aids = [...new Set(WP.sel.map(id => WBY[id] && WBY[id].a).filter(Boolean))];
    if (aids.length) { el.innerHTML = `<p class="autoarea">المنطقة: <b>${aids.map(a => esc(areaOf(a).n)).join('، ')}</b>${aids.length > 1 ? ' <span class="mute">(هتتوزع على متابعة كل منطقة)</span>' : ''}</p>`; return; }
    if (MPK === 'tasks') { const cur = $('#plsa') ? $('#plsa').value : ''; el.innerHTML = `<label>المنطقة <em class="mute">(عشان يوصل تنبيه للي فيها)</em></label><select class="in" id="plsa"><option value="">اختار المنطقة…</option>${SEED.areas.map(a => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</select>`; return; }
    el.innerHTML = '';
  }
  function planOk(k) {
    const d = viewDay(), base = () => Object.assign({ id: uid() }, stampBy()), aOf = id => WBY[id] ? WBY[id].a : null, done = [];
    if (k === 'maint') {
      const w = WP.sel.filter(id => WBY[id]); if (!w.length) return toast('اختار بير على الأقل');
      const mk = $('#mk').value, n = ($('#mn').value || '').trim();
      if (mk !== 'other' && w.some(id => !hasGen(WBY[id]))) return toast('صيانة المولد للآبار اللي عليها مولد بس');
      const by = {}; for (const id of w) (by[aOf(id)] = by[aOf(id)] || []).push(id);
      for (const [aid, ws] of Object.entries(by)) {
        const it = Object.assign(base(), { k: mk, w: ws, n }); planObj(d, aid).maint.push(it); mark(`pm|${d}|${aid}|${it.id}`);
        audit('plan', areaOf(aid).n, 'صيانة', '', MAINT[mk] + ': ' + ws.map(id => WBY[id].n).join('، '), d); done.push(aid);
      }
    }
    if (k === 'work') {
      const w = WP.sel[0]; if (!w || !WBY[w]) return toast('اختار البير'); const aid = aOf(w);
      const it = Object.assign(base(), { w, k: $('#pwk').value, n: ($('#pwn').value || '').trim() }); planObj(d, aid).work.push(it); mark(`pw|${d}|${aid}|${it.id}`);
      audit('plan', areaOf(aid).n, 'شغل على بير', '', WBY[w].n + ' ' + it.k, d); done.push(aid);
    }
    if (k === 'tasks') {
      const x = ($('#ptx').value || '').trim(); if (!x) return toast('اكتب المطلوب');
      const w = WP.sel[0] && WBY[WP.sel[0]] ? WP.sel[0] : null, aid = w ? aOf(w) : (MPA || ($('#plsa') ? $('#plsa').value : ''));
      if (!aid) return toast('اختار المنطقة');
      const it = Object.assign(base(), { x, w, done: null }); planObj(d, aid).tasks.push(it); mark(`pt|${d}|${aid}|${it.id}`); audit('plan', areaOf(aid).n, 'مهمة', '', x, d); done.push(aid);
    }
    save(); closeModal(); render(); toast(`اتحفظ ووصل لمتابعة ${done.map(a => areaOf(a).n).join(' و')}`);
  }
  // ---------------- well form ----------------
  let FM = null; // {w, v, n, dirty}
  function openWell(id) {
    const w = WBY[id]; if (!w) return; const r = dayGet(viewDay()).r[id];
    const tv = {}; for (const t of tanksOf(id)) { const x = dayGet(viewDay()).d[t.id]; tv[t.id] = x ? x.v : ''; }
    const cx = chemOf(viewDay(), id), cv = {}; for (const c of w.ch || []) cv[c] = cx[c] ?? '';
    FM = { w, v: Object.assign({}, r ? r.v : {}), n: r ? r.n || '' : '', tv, cv, dirty: false };
    renderForm(); formEl.hidden = false; document.body.classList.add('lock'); history.pushState({ f: 1 }, '');
  }
  function closeForm(force) {
    if (!FM) return; if (FM.dirty && !force) return confirmBox('في قرايات متحفظتش. تقفل من غير حفظ؟', 'اقفل من غير حفظ', () => closeForm(true));
    FM = null; formEl.hidden = true; formEl.innerHTML = ''; document.body.classList.remove('lock'); render(); setTimeout(checkAlerts, 300);
  }
  function fieldHtml(w, k, prev, ro) {
    const F = L.FIELDS[k], v = FM.v[k] ?? '';
    if (F.k === 'csg') return `<div class="fwide"><span class="lab">CSG Status</span><div class="seg" data-csg>${[['F', 'Open to flare'], ['P', 'Open to production'], ['C', 'Closed']].map(([c, l]) => `<button type="button" class="${v === c ? 'on' : ''}" data-act="csg" data-v="${c}" ${ro}>${l}</button>`).join('')}</div></div>`;
    const pv = prev && prev.r.v[k]; const dv = prev ? L.deviations(w, { v: { [k]: v } }, prev.r)[k] : null;
    return `<label class="fld"><span class="lab"><bdi dir="ltr">${esc(F.l)}</bdi> ${F.u ? `<em dir="ltr">${esc(F.u)}</em>` : ''}${F.sub ? `<small class="lsub" dir="ltr">${esc(F.sub)}</small>` : ''}</span><input inputmode="decimal" data-f="${k}" value="${esc(v)}" ${ro} autocomplete="off"><span class="prev" data-pv="${k}">${pv != null && pv !== '' ? `آخر مرة ${esc(pv)}` : ''}${dv ? ` <span class="w">${dv > 0 ? '+' : ''}${dv}%</span>` : ''}</span></label>`;
  }
  function calcHtml(w) {
    if (w.t === 'GL') {
      const q = L.gasValue(w, FM.v), g = L.gasDiff(w, q, S.cfg.gasDiffPct);
      if (w.k > 0) return `<div class="calc"><p class="mute">Gas = √(Diff × (DS + 14.7)) × ${w.k} ÷ 1,000,000</p><div class="qv ${g && g.bad ? 'w' : ''}">${q == null ? '—' : q.toFixed(3)} <small>MMSCFD</small></div><p class="mute">التارجت ${w.tg ?? '—'}${g ? ` · الفرق ${g.d > 0 ? '+' : ''}${g.d}%` : ''}</p></div>`;
      return `<div class="calc"><p class="mute">قراية مباشرة من العداد${w.m ? ' (' + esc(w.m) + ')' : ''}</p><p>التارجت <b>${w.tg ?? '—'}</b> MMSCFD${g ? ` · الفرق <b class="${g.bad ? 'w' : ''}">${g.d > 0 ? '+' : ''}${g.d}%</b>` : ''}</p></div>`;
    }
    if (w.t === 'WIW') { const inj = L.toNum(FM.v.INJ); return `<div class="calc"><p>التارجت <b>${w.tg ?? '—'}</b> BWPD${w.tg > 0 && inj != null ? ` · <b>${Math.round(inj / w.tg * 100)}%</b> من التارجت` : ''}</p></div>`; }
    return '';
  }
  function jobsHtml(w, d, e, evs, ro) {
    const pl = planFor(d, w.a), M = pl.maint.filter(m => m.w.includes(w.id)), Wk = pl.work.filter(x => x.w === w.id), T = pl.tasks.filter(x => x.w === w.id);
    if (!M.length && !Wk.length && !T.length) return '';
    const by = (it, n) => (n || it.byn) ? `<small>${n ? esc(n) : ''}${n && it.byn ? ' · ' : ''}${it.byn ? 'من ' + esc(it.byn) : ''}</small>` : '';
    let h = '<div class="jobs"><p class="evh">شغل النهارده على البير</p>';
    for (const m of M) {
      const logged = evs.some(x => x.mid === m.id), btn = m.k === 'stop' && !ro && !e && !logged ? `<button class="btn danger sm" data-act="mdown" data-i="${m.id}">البير وقف للصيانة</button>` : logged ? '<span class="mute">اتسجلت الوقفة</span>' : '';
      h += `<div class="job"><span class="jt">${esc(MAINT[m.k])}${by(m, m.n)}</span>${btn}</div>`;
    }
    for (const x of Wk) h += `<div class="job"><span class="jt">${esc(x.k)}${by(x, x.n)}</span></div>`;
    for (const x of T) h += `<div class="job"><span class="jt">${esc(x.x)}${by(x)}</span>${x.done ? '<span class="mute">اتعملت</span>' : ''}</div>`;
    return h + '</div>';
  }
  function statusHtml(w, ro) {
    const e = L.openEvent(S.dt, w.id), d = viewDay(), evs = dayEvents(w.id, d), [s0, e0] = L.dayWindow(d, H()), now = Date.now();
    let h = jobsHtml(w, d, e, evs, ro);
    if (e) h += `<div class="stbox dn"><div class="stq"><span class="stl"><span class="dot dn"></span>واقف من ${L.stamp(e.s)}</span></div><p class="mute" style="margin:4px 0 8px">${esc(e.r)}${e.o ? ' · ' + esc(e.o) : ''} · بقاله ${durTxt(now - e.s)}</p>
      ${ro ? '' : `<div class="stq"><span class="stl">${w.int ? 'البير اتفتح؟' : 'البير رجع اشتغل؟'}</span><button class="btn pen sm" data-act="${w.int ? 'intopen' : 'up'}">${w.int ? 'أيوه، اتفتح' : 'أيوه، رجع'}</button></div>`}`;
    else h += `<div class="stbox"><div class="stq"><span class="stl">البير شغال؟</span>${ro ? '<span class="mute">أيوه</span>' : `<div class="seg qseg"><button class="on" type="button" disabled>أيوه</button>${w.int ? '<button type="button" data-act="intclose">اتقفل PBU</button>' : ''}<button type="button" class="no" data-act="down">لأ، واقف</button></div>`}</div>`;
    if (evs.length) {
      const dm = L.downMs(S.dt, w.id, s0, Math.min(e0, now)), span = Math.min(e0, now) - s0;
      h += `<div class="evs"><p class="evh">النهارده وقف <b>${durTxt(dm)}</b> · اشتغل ${durTxt(Math.max(0, span - dm))}</p>${evs.map(x => `<div class="ev"><span class="evt">${esc(x.r)}${x.o ? ' · ' + esc(x.o) : ''}<small>${hmA(x.s)} ← ${x.e ? hmA(x.e) : 'لسه واقف'} · ${durTxt((x.e || now) - x.s)}${x.byn ? ' · ' + esc(x.byn) : ''}</small></span>${canEditEv(x) ? `<button class="ib3" data-act="evedit" data-e="${x.id}" aria-label="تعديل">✎</button>` : ''}</div>`).join('')}</div>`;
    }
    if (!ro && !e) h += `<button class="linkbtn" data-act="evadd">+ سجّل وقفة حصلت وخلصت</button>`;
    return h + '</div>';
  }
  function renderForm() {
    const w = FM.w, T = L.TYPES[w.t], d = viewDay(), ro = editable() ? '' : 'disabled';
    const prev = prevReading(w.id, d);
    let fs = T.f.slice(); if (w.t === 'GL' && w.k > 0) fs = fs.filter(k => k !== 'GINJ');
    const sub = [T.n, w.sec !== T.n ? w.sec : '', w.p ? 'في الورقة: ' + w.p : ''].filter(Boolean).join(' · ');
    let h = `<header class="fhead"><div class="wrap"><button class="ib" data-act="fclose" aria-label="رجوع">${ic('back')}</button><div class="tt"><h2 class="fname">${esc(w.n)}</h2><p class="sub">${esc(sub)}</p></div></div></header><div class="fbody"><div class="wrap">`;
    h += statusHtml(w, ro);
    if (w.hid) h += `<div class="banner">البير ده مخفي عن الفنيين. لو سجلت قراية، الأدمن هيعرف.</div>`;
    if (w.t === 'GL') h += `<div class="banner info">العداد: <b>${esc(w.m || (w.k > 0 ? 'Orifice' : '—'))}</b>${w.k > 0 ? ` · Factor ${w.k}` : ' · قراية مباشرة'}${w.tg ? ` · التارجت ${w.tg}` : ''}</div>`;
    if (w.disc) h += `<div class="banner">العداد Disconnected. القرايات مش إجبارية، اكتب اللي حصل في الكومنت.</div>`;
    h += `<div class="grid">${fs.map(k => fieldHtml(w, k, prev, ro)).join('')}</div><div id="calc">${calcHtml(w)}</div>`;
    const tk = tanksOf(w.id);
    if (tk.length) {
      h += `<p class="flab">الديزل</p><section class="sec" style="margin-top:0">`;
      for (const [i, t] of tk.entries()) { const v = FM.tv[t.id] ?? '', n = L.toNum(v); h += `<div class="irow"><span class="nm">${tk.length > 1 ? 'تانك ' + (i + 1) : 'التانك'}<small>${esc(t.code || 'من غير كود')}${t.cap ? ' · ' + t.cap.toLocaleString('en') + ' لتر' : ''}${t.w.length > 1 ? ' · مشترك مع ' + t.w.filter(x => x !== w.id).map(x => WBY[x] ? esc(WBY[x].n) : '').join(' + ') : ''}</small></span><input inputmode="decimal" data-ftk="${t.id}" value="${esc(v)}" class="${n != null && n < S.cfg.dieselMin ? 'low' : ''}" ${ro}><span class="u">%</span></div>`; }
      h += '</section>';
    }
    if ((w.ch || []).length) {
      h += `<p class="flab">الكيميكال</p><section class="sec" style="margin-top:0">`;
      for (const c of w.ch) { const v = FM.cv[c] ?? '', n = L.toNum(v), mn = L.chemMin(S.cfg, c); h += `<div class="irow"><span class="nm"><bdi dir="ltr">${esc(L.CHEM_N[c] || c)}</bdi><small>نسبة التانك · تنبيه تحت ${mn}%</small></span><input inputmode="decimal" data-fch="${c}" value="${esc(v)}" class="${n != null && n < mn ? 'low' : ''}" ${ro}><span class="u">%</span></div>`; }
      h += '</section>';
    }
    h += `<p class="flab">كومنت</p><textarea class="in" id="fn" ${ro} placeholder="${w.disc ? 'إيه حالة العداد؟' : 'اختياري'}">${esc(FM.n)}</textarea>`;
    if (prev) h += `<p class="mute" style="margin-top:10px">آخر قراية: ${esc(prev.d)}${prev.r.byn ? ' · ' + esc(prev.r.byn) : ''}</p>`;
    h += `</div></div><footer class="ffoot"><div class="wrap"><button class="btn" data-act="fclose">رجوع</button>${ro ? '' : '<button class="btn pen" data-act="fsave">حفظ</button>'}</div></footer>`;
    formEl.innerHTML = h;
  }
  function refreshCalc() { const c = $('#calc'); if (c && FM) c.innerHTML = calcHtml(FM.w); }
  function saveForm(why) {
    const w = FM.w, d = viewDay(); if (!editable()) return;
    for (const [tid, x] of Object.entries(FM.tv)) { if (x === '' || x == null) continue; const n = L.toNum(x); if (n == null || n < 0 || n > 100) { const el = formEl.querySelector(`[data-ftk="${tid}"]`); if (el) { el.classList.add('bad'); el.focus(); } return toast('نسبة الديزل لازم تبقى من 0 لـ 100'); } }
    for (const [c, x] of Object.entries(FM.cv || {})) { if (x === '' || x == null) continue; const n = L.toNum(x); if (n == null || n < 0 || n > 100) { const el = formEl.querySelector(`[data-fch="${c}"]`); if (el) { el.classList.add('bad'); el.focus(); } return toast('نسبة الكيميكال لازم تبقى من 0 لـ 100'); } }
    if (d !== curDay() && why == null) return askText('سبب التعديل في يوم قديم', 'اكتب السبب', t => saveForm(t));
    const D = dayObj(d), old = D.r[w.id] || { v: {}, n: '' };
    const v = {}; for (const [k, x] of Object.entries(FM.v)) if (x !== '' && x != null) v[k] = String(x);
    const n = ($('#fn') ? $('#fn').value : FM.n).trim();
    let changed = false;
    for (const k of new Set([...Object.keys(old.v), ...Object.keys(v)])) if ((old.v[k] ?? '') !== (v[k] ?? '')) { changed = true; if (old.v[k] != null) audit(w.id, w.n, k, old.v[k], v[k] ?? '', d, why); }
    if ((old.n || '') !== n) { changed = true; if (old.n) audit(w.id, w.n, 'كومنت', old.n, n, d, why); }
    if (changed) { if (Object.keys(v).length || n) D.r[w.id] = Object.assign({ v, n }, stampBy()); else delete D.r[w.id]; mark(`r|${d}|${w.id}`); }
    for (const [tid, x] of Object.entries(FM.tv)) setTank(tid, x, d, why);
    if (Object.keys(FM.cv || {}).length) setChem(w.id, FM.cv, d, why);
    if (w.hid && changed) audit(w.id, w.n, 'قراية على بير مخفي', '', 'اتسجل', d, why);
    save(); FM.dirty = false; closeForm(true); toast('اتحفظ');
  }
  function setChem(wid, vals, d, why) {
    const D = dayObj(d), old = D.c[wid], ov = old ? old.v : {}, nv = Object.assign({}, ov); let changed = false;
    for (const [c, x0] of Object.entries(vals)) {
      const x = x0 == null ? '' : String(x0).trim(), o = ov[c] ?? ''; if (o === x) continue; changed = true;
      if (o !== '') audit(wid, (WBY[wid] ? WBY[wid].n : wid) + ' · ' + (L.CHEM_N[c] || c), '%', o, x, d, why);
      if (x === '') delete nv[c]; else nv[c] = x;
    }
    if (!changed) return false;
    if (Object.keys(nv).length) D.c[wid] = Object.assign({ v: nv }, stampBy()); else delete D.c[wid];
    mark(`c|${d}|${wid}`); return true;
  }
  function setTank(tid, x, d, why) {
    const D = dayObj(d), old = D.d[tid], ov = old ? old.v : ''; x = x == null ? '' : String(x).trim(); if (ov === x) return;
    const t = TANKS.find(q => q.id === tid); if (ov !== '') audit(tid, 'ديزل ' + (t ? (t.code || t.place) : tid), '%', ov, x, d, why);
    if (x === '') delete D.d[tid]; else D.d[tid] = Object.assign({ v: x }, stampBy()); mark(`d|${d}|${tid}`);
  }
  function setPoint(pid, hd, x, d) {
    const D = dayObj(d); const o = D.p[pid] || { h: {} }; const ov = o.h[hd] ?? ''; x = String(x).trim(); if (ov === x) return;
    const p = SEED.points.find(q => q.id === pid); if (ov !== '') audit(pid, p ? p.n + (hd !== '-' ? ' ' + hd : '') : pid, 'psi', ov, x, d);
    if (x === '') delete o.h[hd]; else o.h[hd] = x; Object.assign(o, stampBy()); if (Object.keys(o.h).length) D.p[pid] = o; else delete D.p[pid]; mark(`p|${d}|${pid}`); save();
  }

  // downtime: time picker limited to now; HH:MM before the day start belongs to the next calendar day
  function tsFromHM(hmv, day) {
    day = day || viewDay(); const [hh, mm] = (hmv || '').split(':').map(Number); if (isNaN(hh) || (hmv === hm(Date.now()) && day === curDay())) return Date.now();
    const [a] = L.dayWindow(day, H()); const d = new Date(a); d.setHours(hh, mm || 0, 0, 0); if (hh < H()) d.setDate(d.getDate() + 1);
    return Math.min(d.getTime(), Date.now());
  }
  // hour 1-12 + minutes + نهارًا (6 الصبح لـ 6 بالليل) / ليلًا (6 بالليل لـ 6 الصبح)
  function timeInput(id, ts) {
    let h = '', m = '', night;
    const H0 = new Date(ts == null ? Date.now() : ts).getHours(); night = H0 >= 18 || H0 < 6;
    if (ts != null) { const dd = new Date(ts), H24 = dd.getHours(); m = String(dd.getMinutes()).padStart(2, '0'); h = night ? (H24 >= 18 ? H24 - 12 : H24 === 0 ? 12 : H24) : (H24 <= 12 ? H24 : H24 - 12); }
    return `<div class="tin" id="${id}"><div class="tnum" dir="ltr"><input class="in th" inputmode="numeric" maxlength="2" placeholder="--" value="${h}" aria-label="الساعة"><b>:</b><input class="in tm" inputmode="numeric" maxlength="2" placeholder="00" value="${m}" aria-label="الدقايق"></div>
      <div class="seg ampm"><button type="button" data-act="ampm" data-v="d" class="${night ? '' : 'on'}">نهارًا</button><button type="button" data-act="ampm" data-v="n" class="${night ? 'on' : ''}">ليلًا</button></div></div>`;
  }
  function readTime(id) { // '' when empty, null when wrong, else HH:MM (24h)
    const el = document.getElementById(id); if (!el) return '';
    const hs = L.normNum(el.querySelector('.th').value).trim(), ms = L.normNum(el.querySelector('.tm').value).trim();
    if (hs === '' && ms === '') return '';
    const hh = parseInt(hs, 10), mm = ms === '' ? 0 : parseInt(ms, 10);
    if (!(hh >= 1 && hh <= 12) || !(mm >= 0 && mm <= 59)) return null;
    const night = el.querySelector('.ampm .on').dataset.v === 'n';
    const H24 = !night ? (hh >= 6 && hh <= 11 ? hh : hh === 12 ? 12 : hh + 12) : (hh >= 6 && hh <= 11 ? hh + 12 : hh === 12 ? 0 : hh);
    return String(H24).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  const BADTIME = 'الساعة من 1 لـ 12، والدقايق من 0 لـ 59';
  function dayEvents(wid, d) { const [s0, e0] = L.dayWindow(d, H()); return S.dt.filter(e => e.w === wid && e.s < e0 && (e.e == null || e.e > s0)).sort((a, b) => a.s - b.s); }
  const durTxt = ms => { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return m + ' دقيقة'; const h = Math.floor(m / 60), r = m % 60; return (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h + (h <= 10 ? ' ساعات' : ' ساعة')) + (r ? ' و' + r + ' دقيقة' : ''); };
  const canEditEv = x => editable() && (isAdmin() || canPlan() || (x.by === S.me && L.prodDay(x.s, H()) === curDay()));
  function evBox(id) {
    const x = id ? S.dt.find(e => e.id === id) : null, w = FM.w, rs = L.reasonsFor(w.t, SEED), cur = x ? (rs.includes(x.r) ? x.r : L.OTHER) : '';
    modal(`<h3>${esc(w.n)}: ${x ? 'تعديل الوقفة' : 'وقفة حصلت وخلصت'}</h3><label>السبب</label><select class="in" id="er">${x ? '' : '<option value="">اختار السبب…</option>'}${rs.map(r => `<option ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <div id="ero" ${cur === L.OTHER ? '' : 'hidden'}><label>اكتب السبب</label><input class="in" id="eot" value="${esc(x ? (rs.includes(x.r) ? x.o || '' : (x.o || x.r)) : '')}"></div>
      <label>وقف الساعة</label>${timeInput('efr', x ? x.s : null)}<label>رجع الساعة</label>${timeInput('eto', x && x.e ? x.e : null)}
      ${x && !x.e ? '<p class="mute">سيب "رجع الساعة" فاضية لو البير لسه واقف.</p>' : ''}
      <div class="btns" style="margin-top:14px">${x ? '<button class="btn danger" data-act="evdel">امسح</button>' : ''}<button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="evok">حفظ</button></div>`);
    MEV = id || null; $('#er').onchange = () => { $('#ero').hidden = $('#er').value !== L.OTHER; };
  }
  let MEV = null;
  function evOk() {
    const w = FM.w, x = MEV ? S.dt.find(e => e.id === MEV) : null, r = $('#er').value, o = ($('#eot') ? $('#eot').value : '').trim();
    if (!r) return toast('اختار سبب الوقفة');
    if (r === L.OTHER && !o) return toast('اكتب السبب');
    const fv = readTime('efr'), tv = readTime('eto'); if (fv === null || tv === null) return toast(BADTIME);
    if (!fv) return toast('اكتب وقف الساعة كام');
    const s0 = tsFromHM(fv), e0 = tv ? tsFromHM(tv) : null;
    if (!x && e0 == null) return toast('اكتب رجع الساعة كام. لو البير لسه واقف استخدم "لأ، واقف"');
    if (e0 != null && e0 <= s0) return toast('وقت الرجوع لازم يبقى بعد وقت الوقفة');
    const clash = S.dt.some(e => e.w === w.id && e.id !== MEV && e.s < (e0 == null ? Infinity : e0) && (e.e == null || e.e > s0)); if (clash) return toast('الوقت ده متداخل مع وقفة تانية');
    const rr = r === L.OTHER ? 'Other' : r;
    if (x) { audit(w.id, w.n, 'تعديل وقفة', `${x.r} ${hm(x.s)}-${x.e ? hm(x.e) : 'لسه'}`, `${rr} ${hm(s0)}-${e0 ? hm(e0) : 'لسه'}`, viewDay()); Object.assign(x, { r: rr, o: r === L.OTHER ? o : '', s: s0, e: e0 }); mark('e|' + x.id); }
    else { pushEv(Object.assign({ id: uid(), w: w.id, s: s0, e: e0, r: rr, o: r === L.OTHER ? o : '', src: 'tech' }, stampBy())); audit(w.id, w.n, 'وقفة', '', `${rr} ${hm(s0)}-${hm(e0)}`, viewDay()); }
    save(); closeModal(); renderForm(); toast('اتسجل');
  }
  function evDel() { const x = S.dt.find(e => e.id === MEV), w = FM.w; if (!x) return; confirmBox('تمسح الوقفة دي؟', 'امسح', () => { S.dt = S.dt.filter(e => e.id !== x.id); mark('e|' + x.id); audit(w.id, w.n, 'مسح وقفة', `${x.r} ${hm(x.s)}-${x.e ? hm(x.e) : 'لسه'}`, '', viewDay()); save(); renderForm(); toast('اتمسحت'); }); }
  let DPRE = null; // {r, mid, o}: the stop comes from today's maintenance
  function downBox(w, pre) {
    const rs = L.reasonsFor(w.t, SEED); DPRE = pre || null;
    modal(`<h3>${esc(w.n)}: البير وقف${pre ? ' للصيانة' : ''}</h3><label>السبب</label><select class="in" id="dr"><option value="">اختار السبب…</option>${rs.map(r => `<option ${pre && pre.r === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <div id="dro" hidden><label>اكتب السبب</label><input class="in" id="dot"></div><label>وقف الساعة كام؟</label>${timeInput('dts', Date.now())}
      <div class="btns" style="margin-top:14px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn danger" data-act="downok">سجّل الوقفة</button></div>`);
    $('#dr').onchange = () => { $('#dro').hidden = $('#dr').value !== L.OTHER; };
  }
  function downOk() {
    const w = FM.w, r = $('#dr').value, o = ($('#dot') ? $('#dot').value : '').trim();
    if (!r) return toast('اختار سبب الوقفة');
    if (r === L.OTHER && !o) return toast('اكتب السبب');
    const tv = readTime('dts'); if (tv === null) return toast(BADTIME);
    const mt = DPRE && DPRE.r === r ? DPRE : null;
    const s = tsFromHM(tv); const e = Object.assign({ id: uid(), w: w.id, s, e: null, r: r === L.OTHER ? 'Other' : r, o: o || (mt ? mt.o : ''), src: mt ? 'maint' : 'tech' }, stampBy()); e.byn = stampBy().byn; if (mt) e.mid = mt.mid;
    pushEv(e); audit(w.id, w.n, 'داون تايم', '', `${e.r} من ${hm(s)}`, curDay()); save(); closeModal(); renderForm(); toast('اتسجلت الوقفة');
  }
  function upBox(w, intermittent) {
    modal(`<h3>${esc(w.n)}: ${intermittent ? 'فتحت البير' : 'رجع اشتغل'}</h3><label>الساعة كام؟</label>${timeInput('uts', Date.now())}
      ${intermittent ? '<label>WHSIP قبل الفتح <em class="mute">(اختياري)</em></label><input class="in" id="uws" inputmode="decimal">' : ''}
      <div class="btns" style="margin-top:14px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="upok">تمام</button></div>`);
  }
  function upOk() {
    const w = FM.w, e = L.openEvent(S.dt, w.id); if (!e) return closeModal();
    const tv = readTime('uts'); if (tv === null) return toast(BADTIME);
    let t = tsFromHM(tv); if (t < e.s) return toast('الوقت ده قبل ما البير يقف');
    e.e = t; const ws = $('#uws') ? L.normNum($('#uws').value) : ''; if (ws) e.ws = ws; mark('e|' + e.id);
    audit(w.id, w.n, 'رجع اشتغل', e.r, hm(t) + (ws ? ` · WHSIP ${ws}` : ''), curDay()); save(); closeModal(); renderForm(); toast('اتسجل');
  }
  function intClose() {
    const w = FM.w; const s = Date.now();
    pushEv(Object.assign({ id: uid(), w: w.id, s, e: null, r: L.INTERMITTENT, o: 'PBU', src: 'int' }, stampBy()));
    audit(w.id, w.n, 'تشغيل متقطع', '', 'اتقفل ' + hm(s), curDay()); save(); renderForm(); toast('اتسجل قفل البير');
  }

  // ---------------- samples ----------------
  function sampleResults(aid) {
    const q = (V.sq || '').trim();
    const m = WELLS.filter(w => !w.hid && (!aid || w.a === aid) && wellMatch(q)(w)).sort((a, b) => L.natural(a.n, b.n));
    return `<div class="wpl">${m.map(w => `<button type="button" class="wpi" data-act="spick" data-w="${w.id}">${tchip(w.t)} <b dir="ltr">${esc(w.n)}</b>${aid ? '' : `<span class="mute">${esc(areaOf(w.a).n)}</span>`}</button>`).join('')}${q && !m.length ? '<p class="empty">مفيش بير بالاسم ده</p>' : ''}</div>
      ${q ? `<div class="picks"><button class="pick other" data-act="sother">نقطة مش بير: <b dir="auto">${esc(q)}</b> <span class="mute">(محطة، خط، فاصل…)</span></button></div>` : '<p class="mute" style="margin:6px 2px 0">لو العينة من نقطة مش بير (محطة، خط، فاصل) اكتب اسمها فوق.</p>'}`;
  }
  function saveSample() {
    const w = V.sw || null, pt = V.spt || ''; if (!w && !pt) return toast('اختار البير أو النقطة');
    const kind = $('#sk .on').dataset.v; const ts = Date.now();
    const sid = uid(), aid = w && WBY[w] ? WBY[w].a : (V.v === 'area' ? V.a : ''); mark('s|' + sid); S.samples.push(Object.assign({ id: sid, ts, day: curDay(), a: aid, w, pt: w ? '' : pt, kind, n: ($('#sn').value || '').trim() }, stampBy()));
    V.sw = null; V.spt = ''; V.sq = ''; save(); render(); toast('اتسجلت العينة');
  }
  // ---------------- export ----------------
  function vExport() {
    const d = curDay(), from = V.from || d, to = V.to || d, sel = V.sel || [S.ui.lastArea || SEED.areas[0].id];
    let h = top('إرسال الداتا', 'للشيت، أو PDF على الواتساب، أو Excel') + '<main class="wrap">';
    h += `<div class="card"><h3 style="margin:0 0 6px">الشيت</h3><p style="margin:0 0 10px" data-sync>${syncLine()}</p>${SYNC.url() ? '<button class="btn pen wide" data-act="syncnow">ابعت دلوقتي</button><p class="mute" style="margin-bottom:0">التطبيق بيبعت لوحده كل شوية لما يلاقي نت. الزرار ده لو عاوز تبعت حالًا.</p>' : '<p class="mute" style="margin:0">لما الأدمن يحط رابط الشيت، القرايات هتتبعت لوحدها.</p>'}</div><div class="card">`;
    h += (canStaff() ? `<div class="two"><div><label class="lab">من يوم</label><input class="in" type="date" id="ef" value="${from}" max="${d}"></div><div><label class="lab">لحد يوم</label><input class="in" type="date" id="et" value="${to}" max="${d}"></div></div>` : `<p class="lab" style="margin:0">داتا النهارده: ${esc(arDay(d))}</p>`) + `
      <p class="lab" style="margin-top:14px">المناطق</p>${SEED.areas.map(a => `<label class="ck"><input type="checkbox" data-ea="${a.id}" ${sel.includes(a.id) ? 'checked' : ''}>${esc(a.n)}</label>`).join('')}
      <button class="btn wa wide" style="margin-top:12px" data-act="pdf">${ic('share')} ابعت PDF على الواتساب</button>
      <button class="btn wa2 wide" style="margin-top:8px" data-act="img">${ic('share')} ابعت صور على الواتساب</button>
      <button class="btn wide" style="margin-top:8px" data-act="xlsx">${ic('dl')} طلّع ملف Excel</button></div>
      <p class="mute">الـ PDF فيه صفحة لكل منطقة بنفس شكل ورقة السيرفاي: جدول لكل نوع بير، والمانيفولد، والديزل والكيميكال، والداون تايم. الصور نفس الصفحات بس كل صفحة صورة، أسهل تتفتح على الموبايل. لما تدوس، اختار واتساب من القايمة اللي هتظهر.</p>
      <p class="mute">الـ Excel فيه تابة لكل نوع بير، وتابة للديزل بنفس شكل ورقة الديزل، والكيميكال، والداون تايم وساعات التشغيل، والعينات${isAdmin() ? '، وسجل التعديلات' : ''}.</p>`;
    return h + '</main>' + tabs('export');
  }
  function exportOpts() {
    const from = $('#ef') ? $('#ef').value : curDay(), to = $('#et') ? $('#et').value : curDay(), areas = [...document.querySelectorAll('[data-ea]:checked')].map(x => x.dataset.ea);
    if (!from || !to || from > to) { toast('راجع التاريخ'); return null; } if (!areas.length) { toast('اختار منطقة على الأقل'); return null; }
    if (L.addDays(from, 31) < to) { toast('أقصى مدة شهر'); return null; }
    return { from, to, areas, audit: isAdmin(), now: Date.now() };
  }
  async function doExport() {
    const o = exportOpts(); if (!o) return;
    const sheets = L.exportSheets(S, SEEDX(), WELLS, o);
    if (!sheets.length) return toast('مفيش داتا في الأيام دي');
    const bytes = XLSX.buildXlsx(sheets); const name = `ag-survey_${o.from}${o.to !== o.from ? '_' + o.to : ''}.xlsx`;
    await shareFile(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  async function doPdf() {
    const o = exportOpts(); if (!o) return;
    if (L.addDays(o.from, 6) < o.to) return toast('الـ PDF لحد أسبوع بس. للمدة الأطول استخدم Excel');
    toast('بيجهز الـ PDF…');
    try {
      const bytes = await PDF.buildPdf(S, SEEDX(), WELLS, L, o);
      const an = o.areas.length === 1 ? '_' + o.areas[0] : '';
      await shareFile(`survey${an}_${o.from}${o.to !== o.from ? '_' + o.to : ''}.pdf`, bytes, 'application/pdf');
    } catch (e) { toast('حصلت مشكلة في الـ PDF: ' + (e.message || e)); }
  }
  async function doPressImage(aid, d) {
    toast('بيجهز الصورة…');
    try { const imgs = await PDF.manifoldImages(S, SEEDX(), L, aid, d); await shareFiles(imgs.map(x => ({ name: x.name, bytes: x.jpeg, mime: 'image/jpeg' }))); }
    catch (e) { toast('حصلت مشكلة في الصورة: ' + (e.message || e)); }
  }
  async function doImages() {
    const o = exportOpts(); if (!o) return;
    if (L.addDays(o.from, 6) < o.to) return toast('الصور لحد أسبوع بس');
    toast('بيجهز الصور…');
    try {
      const imgs = await PDF.buildImages(S, SEEDX(), WELLS, L, o);
      if (imgs.length > 30) return toast(`دول ${imgs.length} صورة. قلّل الأيام أو المناطق (لحد 30 صورة)`);
      await shareFiles(imgs.map(x => ({ name: x.name, bytes: x.jpeg, mime: 'image/jpeg' })));
    } catch (e) { toast('حصلت مشكلة في الصور: ' + (e.message || e)); }
  }
  async function shareFiles(list) {
    if (list.length === 1) return shareFile(list[0].name, list[0].bytes, list[0].mime);
    if (Cap && Cap.Filesystem && Cap.Share) {
      try { const uris = []; for (const f of list) { const r = await Cap.Filesystem.writeFile({ path: f.name, data: b64(f.bytes), directory: 'CACHE' }); uris.push(r.uri); } await Cap.Share.share({ title: 'AG Survey', files: uris, dialogTitle: 'ابعت الصور' }); return; }
      catch (e) { if (e && /cancel/i.test(String(e.message || e))) return; toast('مقدرتش أشارك الصور: ' + (e.message || e)); return; }
    }
    if (await webShare(list)) return;
    for (const f of list) { await shareFile(f.name, f.bytes, f.mime, true); await new Promise(r => setTimeout(r, 300)); }
  }
  // iPhone / touch screens: the system share sheet (WhatsApp…); a computer downloads the file
  async function webShare(list) {
    if (Cap || !navigator.canShare || !window.matchMedia || !matchMedia('(pointer:coarse)').matches) return false;
    try {
      const files = list.map(f => new File([f.bytes], f.name, { type: f.mime }));
      if (!navigator.canShare({ files })) return false;
      await navigator.share({ files, title: 'AG Survey' }); return true;
    } catch (e) { if (e && e.name === 'AbortError') return true; return false; }
  }
  async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('اتنسخ'); } catch (e) { const x = document.createElement('textarea'); x.value = t; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); toast('اتنسخ'); } catch (e2) { toast('مقدرتش أنسخ'); } x.remove(); } }
  function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  async function shareFile(name, bytes, mime, noWeb) {
    if (!noWeb && await webShare([{ name, bytes, mime }])) return;
    if (Cap && Cap.Filesystem && Cap.Share) {
      try { const r = await Cap.Filesystem.writeFile({ path: name, data: b64(bytes), directory: 'CACHE' }); await Cap.Share.share({ title: name, files: [r.uri], dialogTitle: 'ابعت الملف' }); return; }
      catch (e) { if (e && /cancel/i.test(String(e.message || e))) return; toast('مقدرتش أشارك الملف: ' + (e.message || e)); return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ---------------- settings / admin ----------------
  function vSettings() {
    const u = me();
    let h = top('الإعدادات', 'نسخة ' + VERSION) + '<main class="wrap">';
    h += `<div class="card"><h3 style="margin:0 0 8px">${esc(u.name)}</h3><div class="kv"><b>اسم المستخدم</b><span dir="ltr">${esc(u.u)}</span><b>الرقم الوظيفي</b><span>${esc(u.emp)}</span><b>الموبايل</b><span dir="ltr">${esc(u.phone)}</span></div>
      <div class="btns" style="margin-top:12px"><button class="btn" data-act="logout">تغيير المستخدم</button></div></div>`;
    if ((S.errs || []).length) h += `<div class="card"><h3 style="margin:0 0 6px">سجل الأخطاء (${S.errs.length})</h3><p class="mute" style="margin-top:0">لو التطبيق عمل مشكلة، ابعتلي السجل ده.</p><button class="btn wide" data-act="errsend">ابعت سجل الأخطاء</button></div>`;
    h += `<div class="card"><h3 style="margin:0 0 6px">نسخة احتياطية</h3><p class="mute" style="margin-top:0">${SYNC.url() ? 'الداتا بتتبعت للشيت لوحدها. النسخة دي لو حبيت تحتفظ بملف على جنب.' : 'لحد ما الموبايل يتربط بالشيت، الداتا عليه بس. ابعت نسخة كل كام يوم.'}</p><button class="btn wide" data-act="backup">ابعت نسخة احتياطية</button></div>`;
    h += isAdmin() ? `<div class="card"><h3 style="margin:0 0 8px">الأدمن</h3><div class="btns"><button class="btn pen" data-act="go" data-v="admin">${ic('shield')} الآبار والإعدادات</button><button class="btn" data-act="go" data-v="audit">سجل التعديلات</button></div><button class="btn wide" style="margin-top:8px" data-act="adminoff">اقفل وضع الأدمن</button></div>`
      : `<button class="btn wide" data-act="adminon">${ic('shield')} وضع الأدمن</button>`;
    return h + '</main>' + tabs('settings');
  }
  function adminOn() {
    if (!S.admin && SYNC.url()) return modal(`<h3>باسورد الأدمن</h3><p>الباسورد بيتحط من الشيت مرة واحدة: افتح الشيت ← القايمة <b>سيرفاي</b> ← <b>باسورد الأدمن</b>.</p><p class="mute">بعدها اضغط "جرّب دلوقتي" والموبايل فاتح نت.</p><p data-sync>${syncLine()}</p><div class="btns"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="admretry">جرّب دلوقتي</button></div>`);
    const first = !S.admin;
    modal(`<h3>${first ? 'اختار باسورد الأدمن' : 'باسورد الأدمن'}</h3><p class="mute">${first ? '6 أرقام. أي حد معاه الباسورد ده يقدر يعدل الآبار والأيام القديمة.' : '6 أرقام'}</p><div class="pinrow"><input id="ap" type="password" inputmode="numeric" maxlength="6"></div>${first ? '<div class="pinrow"><input id="ap2" type="password" inputmode="numeric" maxlength="6" placeholder="تأكيد"></div>' : ''}
      <div class="btns"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="adminok">دخول</button></div>`);
  }
  async function adminOk() {
    const p = L.normNum($('#ap').value || ''); if (!/^\d{6}$/.test(p)) return toast('الباسورد 6 أرقام');
    if (!S.admin && SYNC.url()) return adminOn();
    if (!S.admin) { if (p !== L.normNum($('#ap2').value || '')) return toast('الباسوردين مش زي بعض'); S.admin = await sha('wsadmin:' + p); audit('admin', 'الأدمن', 'باسورد', '', 'اتعمل', curDay()); save(); }
    else if (S.admin !== await sha('wsadmin:' + p)) { $('#ap').value = ''; return toast('الباسورد غلط'); }
    ADMIN_ON = true; closeModal(); V = { v: 'admin' }; render(); publishSeed();
  }
  function vAdmin() {
    const aid = V.a || SEED.areas[0].id, q = (V.q || '').trim().toUpperCase();
    let h = top('الآبار والإعدادات', 'الأدمن بس', 'settings') + '<main class="wrap">';
    h += `<div class="card"><h3 style="margin:0 0 8px">الإعدادات</h3><div class="two"><div><label class="lab">يوم الإنتاج بيبدأ الساعة</label><input class="in" id="ch" inputmode="numeric" value="${S.cfg.prodDayStart}"></div><div><label class="lab">تنبيه الديزل تحت %</label><input class="in" id="cd" inputmode="numeric" value="${S.cfg.dieselMin}"></div></div>
      <div class="two" style="margin-top:10px"><div><label class="lab">تنبيه فرق الجاز عن التارجت %</label><input class="in" id="cg" inputmode="numeric" value="${S.cfg.gasDiffPct}"></div><div></div></div>
      <p class="lab" style="margin-top:12px">تنبيه الكيميكال تحت %</p><div class="cmins">${L.CHEMS.map(([c, n]) => `<label class="cmin"><bdi dir="ltr">${esc(n)}</bdi><input class="in" data-cmin="${c}" inputmode="numeric" value="${L.chemMin(S.cfg, c)}"></label>`).join('')}</div>
      <button class="btn pen wide" style="margin-top:12px" data-act="cfgsave">حفظ</button></div>`;
    h += `<div class="card"><h3 style="margin:0 0 8px">الربط بالشيت</h3><label class="lab">رابط الشيت (Web app URL)</label><input class="in" id="surl" dir="ltr" value="${esc(SYNC.url())}" placeholder="https://script.google.com/macros/s/…/exec"><button class="btn pen wide" style="margin-top:8px" data-act="surlsave">حفظ وجرّب</button><p style="margin:10px 0 0" data-sync>${syncLine()}</p></div>`;
    if (SYNC.url() && !(window.CONFIG && CONFIG.web)) h += `<div class="card"><h3 style="margin:0 0 6px">نسخة الآيفون والكمبيوتر</h3><p class="mute" style="margin:0 0 10px">ابعت اللينك ده للي عاوز يشتغل من آيفون أو كمبيوتر. بيفتح البرنامج مربوط بالشيت، وبيانات الآبار بتنزل بعد ما يفتحه. اللينك ده زي باسورد للشيت، متبعتوش غير لناس الشغل.</p>
      <div class="btns"><button class="btn wa" data-act="weblinkshare">${ic('share')} ابعته</button><button class="btn" data-act="weblinkcopy">انسخ</button></div><p class="mute" style="margin:8px 0 0">${S.seedPub === SEED.version ? 'بيانات الآبار متحدثة على الشيت.' : 'بيانات الآبار هتتبعت للشيت مع أول إرسال.'}</p></div>`;
    h += `<div class="stabs">${SEED.areas.map(a => `<button class="stab ${a.id === aid ? 'on' : ''}" data-act="aarea" data-a="${a.id}">${esc(a.n)}</button>`).join('')}</div>
      <div class="search"><input id="aq" placeholder="دوّر على بير" value="${esc(V.q || '')}" dir="ltr"></div>
      <p class="mute" style="margin:10px 2px 0">"يظهر" يعني الفنيين يشوفوه في قايمة المنطقة. البير المخفي بيفضل بالداتا بتاعته وترجعه في أي وقت. تغيير النوع بيغيّر الخانات اللي الفني بيشوفها. ${SYNC.url() ? 'أي تغيير هنا بيوصل لكل الموبايلات أول ما يتبعت للشيت.' : 'التغيير هيوصل لكل الموبايلات لما الموبايل ده يتربط بالشيت.'}</p><div class="card">`;
    const us = Object.values(S.users);
    h += `<h3 style="margin:4px 0 8px">${SYNC.url() ? 'المستخدمين' : 'المستخدمين على الموبايل ده'}</h3>${us.map(u => `<div class="arow"><div class="nm">${esc(u.name)}<small dir="ltr">${esc(u.u)} · ${esc(u.phone)}</small></div><select class="in tsel" data-role="${esc(u.u)}"><option value="tech" ${!u.role || u.role === 'tech' ? 'selected' : ''}>فني</option><option value="lead" ${u.role === 'lead' ? 'selected' : ''}>رئيس ورشة (توزيعة الأفراد)</option><option value="eng" ${u.role === 'eng' ? 'selected' : ''}>مهندس (الصيانات والشغل والمهام)</option></select>${u.u === S.me ? '' : `<button class="ib3" data-act="udel" data-u="${esc(u.u)}" aria-label="امسح ${esc(u.name)}">×</button>`}</div>`).join('')}</div><div class="card"><h3 style="margin:4px 0 8px">الآبار</h3>`;
    const ws = WELLS.filter(w => w.a === aid && (!q || w.n.toUpperCase().includes(q)));
    h += `<h3 style="margin:16px 0 8px">الآبار <small class="mute">بترتيب الطريق</small></h3><button class="btn pen wide" style="margin-bottom:8px" data-act="nwell">+ بير جديد في ${esc(areaOf(aid).n)}</button>`;
    h += ws.map(w => `<div class="arow"><div class="nm">${esc(w.n)}<small>${w.add ? 'بير جديد' : w.geo ? 'اتنسب بالإحداثيات' : 'من ورقة السيرفاي'}${(w.ch || []).length ? ' · كيميكال ' + w.ch.length : ''}</small></div>
      <select class="in tsel" data-type="${w.id}">${L.TYPE_ORDER.map(t => `<option value="${t}" ${w.t === t ? 'selected' : ''}>${t === 'GL' ? 'Gas Lift' : t}</option>`).join('')}</select>
      <label class="swl">متقطع<span class="sw"><input type="checkbox" data-int="${w.id}" ${w.int ? 'checked' : ''}><i></i></span></label>
      <label class="swl">يظهر<span class="sw"><input type="checkbox" data-vis="${w.id}" ${w.hid ? '' : 'checked'}><i></i></span></label>
      <button class="btn sm" data-act="wedit" data-w="${w.id}">تعديل</button></div>`).join('');
    return h + '</div></main>' + tabs('settings');
  }
  function setEdit(id, k, val) {
    const e = S.cfg.edits[id] || (S.cfg.edits[id] = {}); const base = SEED.wells.find(w => w.id === id) || (S.cfg.newWells || {})[id] || {}; const old = WBY[id] ? WBY[id][k] : undefined;
    const same = k === 'ch' ? JSON.stringify(base.ch || []) === JSON.stringify(val || []) : (base[k] || 0) === (val || 0);
    if (same) delete e[k]; else e[k] = val; const u = me(); e.by = S.me; e.byn = u ? u.name : ''; e.at = Date.now(); // not stampBy(): its "t" is the type here
    if (!EDITK.some(x => x in e)) delete S.cfg.edits[id]; mark('cw|' + id);
    const lab = { hid: 'يظهر للفنيين', int: 'تشغيل متقطع', t: 'النوع', r: 'مكانه في ترتيب الطريق', ch: 'الكيميكال' }[k];
    const fmt = v => k === 'hid' ? (v ? 'مخفي' : 'يظهر') : k === 'int' ? (v ? 'أيوه' : 'لأ') : k === 'ch' ? (v || []).map(c => L.CHEM_N[c] || c).join('، ') : v;
    if (k === 'r') audit(id, WBY[id] ? WBY[id].n : id, lab, '', 'اتنقل', curDay()); else audit(id, WBY[id] ? WBY[id].n : id, lab, fmt(old), fmt(val), curDay());
    rebuildWells(); save();
  }
  // the admin: where a well comes in the route, its chemicals, a new well
  function rAfter(aid, afterId, selfId) {
    const ws = WELLS.filter(w => w.a === aid && w.id !== selfId), rr = w => w.r ?? w.o;
    if (!ws.length) return 10;
    if (afterId === '__first') return rr(ws[0]) - 5;
    const i = ws.findIndex(w => w.id === afterId); if (i < 0) return rr(ws[ws.length - 1]) + 10;
    return i + 1 < ws.length ? (rr(ws[i]) + rr(ws[i + 1])) / 2 : rr(ws[i]) + 10;
  }
  let MW = null, MNA = null;
  function wellBox(id) {
    const w = WBY[id]; if (!w) return; const ws = WELLS.filter(x => x.a === w.a), i = ws.findIndex(x => x.id === id);
    MW = id;
    modal(`<h3>${esc(w.n)}</h3><p class="lab">الكيميكال اللي على البير</p>${L.CHEMS.map(([c, n]) => `<label class="ck"><input type="checkbox" data-wch="${c}" ${(w.ch || []).includes(c) ? 'checked' : ''}><bdi dir="ltr">${esc(n)}</bdi></label>`).join('')}
      <label class="lab" style="margin-top:12px">مكانه في ترتيب الطريق: ييجي بعد</label>${wpHtml({ ws: ws.filter(x => x.id !== w.id), first: 'أول بير في الطريق', sel: [i > 0 ? ws[i - 1].id : '__first'] })}
      ${w.add ? '<button class="btn danger wide" style="margin-top:12px" data-act="wdel">امسح البير ده</button>' : ''}
      <div class="btns" style="margin-top:14px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="weditok">حفظ</button></div>`);
  }
  function wellEditOk() {
    const w = WBY[MW]; if (!w) return closeModal();
    const ch = [...document.querySelectorAll('[data-wch]:checked')].map(x => x.dataset.wch);
    const ws = WELLS.filter(x => x.a === w.a), i = ws.findIndex(x => x.id === w.id), prevId = i > 0 ? ws[i - 1].id : '__first', sel = WP.sel[0] || prevId;
    if (JSON.stringify(ch) !== JSON.stringify(w.ch || [])) setEdit(w.id, 'ch', ch);
    if (sel !== prevId) setEdit(w.id, 'r', rAfter(w.a, sel, w.id));
    closeModal(); render(); toast('اتحفظ');
  }
  function wellDel() {
    const w = WBY[MW]; if (!w || !w.add) return;
    confirmBox(`تمسح ${w.n}؟ القرايات اللي اتسجلت عليه هتفضل في الشيت.`, 'امسح', () => {
      delete S.cfg.newWells[w.id]; mark('nw|' + w.id); if (S.cfg.edits[w.id]) { delete S.cfg.edits[w.id]; mark('cw|' + w.id); }
      audit(w.id, w.n, 'مسح بير جديد', '', 'اتمسح', curDay()); rebuildWells(); save(); render(); toast('اتمسح');
    });
  }
  function newWellBox(aid) {
    const ws = WELLS.filter(w => w.a === aid); MNA = aid;
    modal(`<h3>بير جديد في ${esc(areaOf(aid).n)}</h3>
      <label class="lab">اسم البير</label><input class="in" id="nwn" dir="ltr" autocapitalize="characters" autocomplete="off" placeholder="AG-160">
      <label class="lab" style="margin-top:10px">النوع</label><select class="in" id="nwt">${L.TYPE_ORDER.map(t => `<option value="${t}">${t === 'GL' ? 'Gas Lift' : t}</option>`).join('')}</select><div id="nwx"></div>
      <label class="lab" style="margin-top:10px">ييجي بعد أنهي بير في ترتيب الطريق</label>${wpHtml({ ws, first: 'أول بير في الطريق', sel: [ws.length ? ws[ws.length - 1].id : '__first'] })}
      <label class="lab" style="margin-top:10px">الإحداثيات <em class="mute">(اختياري، عشان يظهر على الخريطة)</em></label><input class="in" id="nwll" dir="ltr" autocomplete="off" placeholder="29.79138, 28.55316">
      <p class="mute" style="margin:4px 0 0">خط العرض وبعده خط الطول، زي ما بتطلع من خرايط جوجل.</p>
      <div class="btns" style="margin-top:14px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="nwellok">إضافة</button></div>`);
    nwType(); $('#nwt').onchange = nwType;
  }
  function nwType() {
    const t = $('#nwt').value, x = $('#nwx'); if (!x) return;
    x.innerHTML = t === 'GL' ? `<div class="two" style="margin-top:10px"><div><label class="lab">Factor <em class="mute">(لو بيتحسب)</em></label><input class="in" id="nwk" inputmode="decimal" dir="ltr"></div><div><label class="lab">التارجت MMSCFD</label><input class="in" id="nwg" inputmode="decimal" dir="ltr"></div></div>`
      : t === 'WIW' ? `<label class="lab" style="margin-top:10px">التارجت BWPD <em class="mute">(اختياري)</em></label><input class="in" id="nwg" inputmode="decimal" dir="ltr">`
      : t === 'ESP' || t === 'SRP' ? '<p class="mute" style="margin:8px 0 0">هيتعمله خانة ديزل لوحده.</p>' : '';
  }
  function parseLL(raw) { // "lat, lon" -> [lon, lat]
    const s = String(raw || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').trim(); if (!s) return null;
    const m = s.split(/[\s,،;]+/).filter(Boolean).map(Number); if (m.length !== 2 || m.some(isNaN)) return false;
    const [la, lo] = m; return la > 28 && la < 32 && lo > 25 && lo < 31 ? [lo, la] : false;
  }
  function newWellOk() {
    const aid = MNA, n = ($('#nwn').value || '').trim().toUpperCase().replace(/\s+/g, ' '), t = $('#nwt').value;
    if (n.length < 3) return toast('اكتب اسم البير');
    const key = x => String(x || '').toUpperCase().replace(/[\s_-]/g, ''), dup = WELLS.find(w => key(w.n) === key(n) || (w.p && key(w.p) === key(n)));
    if (dup) return toast(`البير ده موجود في ${areaOf(dup.a).n}${dup.hid ? ' (مخفي، تقدر تظهره)' : ''}`);
    const ll = parseLL($('#nwll').value); if (ll === false) return toast('الإحداثيات: خط العرض وبعده خط الطول، زي 29.79138, 28.55316');
    const num = id => { const el = $('#' + id); return el ? L.toNum(L.normNum(el.value)) : null; };
    const id = 'n-' + uid(), r = rAfter(aid, WP.sel[0] || '__first', null), o = Math.max(9000, ...WELLS.filter(w => w.a === aid).map(w => w.o || 0)) + 10;
    const w = { id, n, a: aid, t, sec: L.TYPES[t].n, o, r, add: 1, by: S.me, byn: me() ? me().name : '', at: Date.now() };
    if (ll) w.ll = ll;
    if (t === 'GL') { const k = num('nwk'), g = num('nwg'); if (k) w.k = k; if (g) w.tg = g; }
    if (t === 'WIW') { const g = num('nwg'); if (g) w.tg = g; }
    S.cfg.newWells = S.cfg.newWells || {}; S.cfg.newWells[id] = w; mark('nw|' + id);
    audit(id, n, 'بير جديد', '', `${areaOf(aid).n} · ${t}`, curDay());
    rebuildWells(); save(); closeModal(); render(); toast('اتضاف البير');
  }
  function vAudit() {
    const list = S.audit.slice(-300).reverse();
    let h = top('سجل التعديلات', 'مين عدّل إيه وامتى', 'settings') + '<main class="wrap"><div class="card">';
    h += list.length ? list.map(x => `<div class="alog"><b>${esc(x.refn || x.ref)}</b> · ${esc(x.f || '')}: ${esc(x.a ?? '')} ← ${esc(x.b ?? '')}<br><span class="mute">${L.stamp(x.ts)} · ${esc(x.byn || x.by || '')}${x.why ? ' · السبب: ' + esc(x.why) : ''}</span></div>`).join('') : '<p class="empty">مفيش تعديلات لسه</p>';
    return h + '</div></main>' + tabs('settings');
  }
  async function backup() { const bytes = new TextEncoder().encode(JSON.stringify({ app: 'well-survey', version: VERSION, at: new Date().toISOString(), state: S })); await shareFile(`well-survey-backup_${curDay()}.json`, bytes, 'application/json'); }

  // ---------------- modal helpers ----------------
  function modal(html) { modalEl.innerHTML = `<div class="mcard" role="dialog" aria-modal="true">${html}</div>`; modalEl.hidden = false; const f = modalEl.querySelector('input,select'); if (f) setTimeout(() => f.focus(), 50); }
  function closeModal() { modalEl.hidden = true; modalEl.innerHTML = ''; MCB = null; }
  let MCB = null;
  function confirmBox(msg, ok, cb) { MCB = cb; modal(`<p style="font-size:17px;margin:4px 0 12px">${esc(msg)}</p><div class="btns"><button class="btn" data-act="mclose">لأ</button><button class="btn danger" data-act="mok">${esc(ok)}</button></div>`); }
  function askText(title, ph, cb) { MCB = () => { const v = ($('#mt').value || '').trim(); if (!v) return toast('اكتب السبب'); closeModal(); cb(v); }; modal(`<h3>${esc(title)}</h3><input class="in" id="mt" placeholder="${esc(ph)}"><div class="btns" style="margin-top:12px"><button class="btn" data-act="mclose">إلغاء</button><button class="btn pen" data-act="mok">تمام</button></div>`); }

  // ---------------- render + events ----------------
  function render() {
    if (!me()) { app.innerHTML = vLogin(); return; }
    if (!(V.v === 'area' && (V.tab || 'wells') === 'wells' && S.ui.mode === 'map')) stopGeo();
    const v = V.v;
    app.innerHTML = v === 'area' ? vArea() : v === 'follow' ? vFollow() : v === 'export' ? vExport() : v === 'settings' ? vSettings() : v === 'admin' && isAdmin() ? vAdmin() : v === 'audit' && isAdmin() ? vAudit() : vHome();
  }
  function go(v, extra) { V = Object.assign({ v }, extra || {}); render(); window.scrollTo(0, 0); }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) { if (e.target === modalEl) closeModal(); return; }
    const a = b.dataset.act;
    switch (a) {
      case 'go': return go(b.dataset.v);
      case 'area': S.ui.lastArea = b.dataset.a; save(); return go('area', { a: b.dataset.a, tab: 'wells' });
      case 'stab': V.tab = b.dataset.v; return render();
      case 'mode': S.ui.mode = b.dataset.v; save(); return render();
      case 'mmeas': if (MAPV) { MAPV.meas = !MAPV.meas; b.classList.toggle('on', MAPV.meas);
          if (MAPV.meas) { toast('اضغط على أي بير تعرف المسافة من مكانك ليه'); if (!POS || !POS.ll || POS.err || Date.now() - POS.t > 60000) locate(false); else if (MAPV.sel && WBY[MAPV.sel]) fitMeToWell(WBY[MAPV.sel]); }
          drawMapOnly(); } return;
      case 'mw': if (MAPV) { MAPV.sel = b.dataset.w; if (MAPV.meas && WBY[MAPV.sel]) { if (POS && POS.ll) fitMeToWell(WBY[MAPV.sel]); else toast('لسه مكانك متحددش، استنى ثواني'); } drawMapOnly(); const i = MAPV.meas ? $('.mapw') : $('#mapinfo'); if (i) i.scrollIntoView({ behavior: 'smooth', block: MAPV.meas ? 'center' : 'nearest' }); } return;
      case 'mz': if (MAPV) { MAPV.z = Math.max(0.5, Math.min(40, MAPV.z * (b.dataset.v === '1' ? 1.6 : 1 / 1.6))); drawMapOnly(); } return;
      case 'mnorth': if (MAPV) { MAPV.rot = 0; drawMapOnly(); } return;
      case 'mme': if (MAPV && POS && POS.ll && Date.now() - POS.t < 60000 && !POS.err) { centerOnMe(); drawMapOnly(); } else { toast('بيدوّر على مكانك…'); locate(false); } return;
      case 'mfit': if (MAPV) { MAPV.z = 1; MAPV.rot = 0; MAPV.cx = (MAPV.b[0] + MAPV.b[2]) / 2; MAPV.cy = (MAPV.b[1] + MAPV.b[3]) / 2; drawMapOnly(); } return;
      case 'spick': V.sw = b.dataset.w; V.spt = ''; return render();
      case 'sother': V.sw = null; V.spt = (V.sq || '').trim(); { const r = $('#sres'); if (r) r.innerHTML = `<div class="picked">نقطة: <b dir="auto">${esc(V.spt)}</b></div>`; } return;
      case 'sclear': V.sw = null; V.spt = ''; return render();
      case 'pdf': return doPdf();
      case 'img': return doImages();
      case 'nwell': return newWellBox(V.a || SEED.areas[0].id);
      case 'nwellok': return newWellOk();
      case 'wedit': return wellBox(b.dataset.w);
      case 'weditok': return wellEditOk();
      case 'wdel': return wellDel();
      case 'syncnow': { document.querySelectorAll('[data-sync]').forEach(el => el.innerHTML = '<span class="sy run">بيبعت…</span>'); SYNC.run(true); return; }
      case 'surlsave': {
        const u = ($('#surl').value || '').trim();
        if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) return toast('الرابط لازم يبقى بالشكل ده: https://script.google.com/macros/s/…/exec');
        audit('sync', 'رابط الشيت', 'URL', SYNC.url() ? 'كان فيه رابط' : '', u ? 'اتحط رابط' : 'اتشال', curDay()); SYNC.setUrl(u); toast(u ? 'اتحفظ. بيجرب يبعت…' : 'اتشال الرابط'); if (u) SYNC.run(true); return render();
      }
      case 'errsend': return shareFile(`well-survey-errors_${curDay()}.txt`, new TextEncoder().encode(`v${VERSION}\n` + (S.errs || []).map(x => `${L.stamp(x.t)} [${x.v}] ${x.m}`).join('\n')), 'text/plain');
      case 'well': return openWell(b.dataset.w);
      case 'fclose': return closeForm();
      case 'fsave': return saveForm();
      case 'csg': if (!FM) return; FM.v.CSG = FM.v.CSG === b.dataset.v ? '' : b.dataset.v; FM.dirty = true; b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === FM.v.CSG)); return;
      case 'down': return downBox(FM.w);
      case 'mdown': { const m = planFor(viewDay(), FM.w.a).maint.find(x => x.id === b.dataset.i); return downBox(FM.w, { r: 'Generator صيانة', mid: b.dataset.i, o: m && m.n ? m.n : '' }); }
      case 'wpk': return wpPick(b.dataset.w);
      case 'downok': return downOk();
      case 'up': return upBox(FM.w, false);
      case 'intopen': return upBox(FM.w, true);
      case 'upok': return upOk();
      case 'pladd': return canPlan() ? planBox(b.dataset.k, b.dataset.a || null) : null;
      case 'gofollow': closeModal(); S.ui.lastArea = b.dataset.a; return go('area', { a: b.dataset.a, tab: 'dt' });
      case 'pimg': return doPressImage(V.a, viewDay());
      case 'ppk': { if (!PP) return; const u = b.dataset.u; PP.sel = PP.sel.includes(u) ? PP.sel.filter(x => x !== u) : PP.sel.concat(u); return ppRefresh(); }
      case 'stok': return staffOk();
      case 'jobadd': return canStaff() ? jobBox() : null;
      case 'jobok': return jobOk();
      case 'jobdel': { if (!canStaff()) return; const d = viewDay(), j = jobObj(d, b.dataset.j); if (!j) return; return confirmBox(`تمسح خانة ${j.k}؟`, 'امسح', () => { S.jobs[d] = jobsFor(d).filter(x => x.id !== j.id); mark(`pj|${d}|${j.id}`); audit('plan', j.k, 'مسح خانة', j.staff.join('، '), '', d); save(); render(); }); }
      case 'stshare': return doStaffImage();
      case 'weblinkshare': { const t = 'AG Survey للآيفون والكمبيوتر:\n' + webLink(); if (navigator.share && !Cap) { navigator.share({ text: t }).catch(() => { }); return; } if (Cap && Cap.Share) { Cap.Share.share({ text: t, dialogTitle: 'ابعت اللينك' }).catch(() => { }); return; } return copyText(t); }
      case 'install': { const e = window.__installEvt; if (e) { e.prompt(); e.userChoice.finally(() => { window.__installEvt = null; render(); }); } return; }
      case 'noinst': S.ui.noInstall = 1; save(); return render();
      case 'weblinkcopy': return copyText(webLink());
      case 'udel': { if (!isAdmin()) return; const u = S.users[b.dataset.u]; if (!u) return; if (u.u === S.me) return toast('مينفعش تمسح نفسك');
        return confirmBox(`تمسح ${u.name} من التطبيق خالص؟ اسمه ورقمه هيتشالوا من كل الموبايلات ومن الشيت. القرايات اللي كتبها هتفضل من غير اسم.`, 'امسح', () => { scrubUser(u.u); audit('user', '', 'مسح مستخدم', '', '', curDay()); save(); render(); toast('اتمسح'); }); }
      case 'stcopyall': { if (!canStaff()) return; const d = viewDay(); for (const a of SEED.areas) { const y = planFor(L.addDays(d, -1), a.id).staff; if (y.length && !planFor(d, a.id).staff.length) { planObj(d, a.id).staff = y.slice(); mark(`ps|${d}|${a.id}`); } }
        if (!jobsFor(d).length) for (const j of jobsFor(L.addDays(d, -1))) { S.jobs[d] = S.jobs[d] || []; const n = Object.assign({ id: uid(), k: j.k, staff: j.staff.slice() }, stampBy()); S.jobs[d].push(n); mark(`pj|${d}|${n.id}`); }
        audit('plan', 'كل المناطق', 'توزيعة الأفراد', '', 'زي امبارح', d); save(); return render(); }
      case 'plok': return planOk(b.dataset.k);
      case 'pldel': { const k = b.dataset.k, id = b.dataset.i, aid = b.dataset.a || V.a; return confirmBox('تمسحها؟', 'امسح', () => { const pl = planObj(viewDay(), aid); pl[k] = pl[k].filter(x => x.id !== id); mark(`${{ maint: 'pm', work: 'pw', tasks: 'pt' }[k]}|${viewDay()}|${aid}|${id}`); audit('plan', areaOf(aid).n, 'مسح', k, '', viewDay()); save(); render(); }); }
      case 'stadd': return canStaff() ? staffBox(b.dataset.j ? { job: b.dataset.j } : { aid: b.dataset.a || V.a }) : null;
      case 'stdel': { if (!canStaff()) return; const d = viewDay();
        if (b.dataset.j) { const j = jobObj(d, b.dataset.j); if (!j) return; const n = j.staff.splice(+b.dataset.i, 1)[0]; j.t = Date.now(); mark(`pj|${d}|${j.id}`); audit('plan', j.k, 'توزيعة الأفراد', n, '', d); save(); return render(); }
        const aid = b.dataset.a || V.a, pl = planObj(d, aid); const n = pl.staff.splice(+b.dataset.i, 1)[0]; mark(`ps|${d}|${aid}`); audit('plan', areaOf(aid).n, 'توزيعة الأفراد', n, '', d); save(); return render(); }
      case 'stcopy': { if (!canStaff()) return; const aid = b.dataset.a || V.a, pl = planObj(viewDay(), aid); pl.staff = planFor(L.addDays(viewDay(), -1), aid).staff.slice(); mark(`ps|${viewDay()}|${aid}`); save(); return render(); }
      case 'evadd': return evBox(null);
      case 'evedit': return evBox(b.dataset.e);
      case 'evok': return evOk();
      case 'ampm': b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); return;
      case 'evdel': return evDel();
      case 'intclose': return intClose();
      case 'mclose': return closeModal();
      case 'mok': { const cb = MCB; if (cb) { closeModal(); cb(); } return; }
      case 'login': return doLogin();
      case 'register': return doRegister();
      case 'toreg': V.reg = 1; return render();
      case 'tolog': V.reg = 0; return render();
      case 'logout': S.me = null; ADMIN_ON = false; VDAY = null; save(); V = { v: 'home' }; return render();
      case 'sk': V.sk = b.dataset.v; b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); return;
      case 'ssave': return saveSample();
      case 'xlsx': return doExport();
      case 'backup': return backup();
      case 'adminon': return adminOn();
      case 'adminok': return adminOk();
      case 'admretry': { b.disabled = true; b.textContent = 'بيتصل…'; SYNC.run(false).then(() => { closeModal(); if (S.admin) adminOn(); else toast(SYNC.status().err ? 'مقدرش يتصل: ' + SYNC.status().err : 'لسه مفيش باسورد في الشيت'); }); return; }
      case 'adminoff': ADMIN_ON = false; VDAY = null; return go('settings');
      case 'aarea': V.a = b.dataset.a; V.q = ''; return render();
      case 'cfgsave': {
        const h = parseInt(L.normNum($('#ch').value), 10), dm = parseFloat(L.normNum($('#cd').value)), g = parseFloat(L.normNum($('#cg').value));
        if (!(h >= 0 && h <= 23)) return toast('الساعة من 0 لـ 23'); if (!(dm > 0 && dm < 100) || !(g > 0 && g < 100)) return toast('راجع النسب');
        const cm = {}; for (const el of document.querySelectorAll('[data-cmin]')) { const v = parseFloat(L.normNum(el.value)); if (!(v >= 0 && v < 100)) return toast('نسب الكيميكال من 0 لـ 99'); cm[el.dataset.cmin] = v; }
        for (const [k, v] of [['prodDayStart', h], ['dieselMin', dm], ['gasDiffPct', g]]) if (S.cfg[k] !== v) { audit('cfg', 'الإعدادات', k, S.cfg[k], v, curDay()); S.cfg[k] = v; }
        for (const [c, v] of Object.entries(cm)) if (L.chemMin(S.cfg, c) !== v) audit('cfg', 'الإعدادات', 'تنبيه ' + (L.CHEM_N[c] || c), L.chemMin(S.cfg, c), v, curDay());
        S.cfg.chemMin = cm; mark('cs');
        save(); return toast('اتحفظ');
      }
    }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f && FM) { const n = L.normNum(t.value); if (n !== t.value) t.value = n; FM.v[t.dataset.f] = n; FM.dirty = true; if (['DS', 'DIFF', 'GINJ', 'INJ'].includes(t.dataset.f)) refreshCalc(); return; }
    if (t.dataset.ftk && FM) { const n = L.normNum(t.value); if (n !== t.value) t.value = n; FM.tv[t.dataset.ftk] = n; FM.dirty = true; const x = L.toNum(n); t.classList.toggle('bad', n !== '' && (x == null || x < 0 || x > 100)); t.classList.toggle('low', x != null && x <= 100 && x < S.cfg.dieselMin); return; }
    if (t.dataset.fch && FM) { const n = L.normNum(t.value); if (n !== t.value) t.value = n; FM.cv[t.dataset.fch] = n; FM.dirty = true; const x = L.toNum(n); t.classList.toggle('bad', n !== '' && (x == null || x < 0 || x > 100)); t.classList.toggle('low', x != null && x >= 0 && x <= 100 && x < L.chemMin(S.cfg, t.dataset.fch)); return; }
    if (t.dataset.chw) { const n = L.normNum(t.value); if (n !== t.value) t.value = n; const x = L.toNum(n); t.classList.toggle('bad', n !== '' && (x == null || x < 0 || x > 100)); t.classList.toggle('low', x != null && x >= 0 && x <= 100 && x < L.chemMin(S.cfg, t.dataset.chc)); return; }
    if (t.id === 'ppq' && PP) { PP.q = t.value; ppRefresh(true); return; }
    if (t.id === 'wpq' && WP) { WP.q = t.value; wpRefresh(true); return; }
    if (t.id === 'sq') { V.sq = t.value; V.spt = ''; const r = $('#sres'); if (r) r.innerHTML = sampleResults(V.v === 'area' ? V.a : null); return; }
    if (t.id === 'fn' && FM) { FM.n = t.value; FM.dirty = true; return; }
    if (t.dataset.pt || t.dataset.tk) { const n = L.normNum(t.value); if (n !== t.value) t.value = n; if (t.dataset.tk) { const x = L.toNum(n); t.classList.toggle('bad', n !== '' && (x == null || x < 0 || x > 100)); t.classList.toggle('low', x != null && x <= 100 && x < S.cfg.dieselMin); } return; }
    if (t.id === 'q') { V.q = t.value; const pos = t.selectionStart; render(); const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } return; }
    if (t.id === 'aq') { V.q = t.value; const pos = t.selectionStart; render(); const q = $('#aq'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } return; }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.pt) { const x = L.toNum(t.value); if (t.value !== '' && x == null) { toast('اكتب رقم'); return; } setPoint(t.dataset.pt, t.dataset.h, t.value, viewDay()); return toast('اتحفظ'); }
    if (t.dataset.tk) { const x = L.toNum(t.value); if (t.value !== '' && (x == null || x < 0 || x > 100)) { toast('نسبة الديزل لازم تبقى من 0 لـ 100'); t.focus(); return; } setTank(t.dataset.tk, t.value, viewDay()); save(); return toast(x != null && x < S.cfg.dieselMin ? `اتحفظ. الديزل تحت ${S.cfg.dieselMin}%` : 'اتحفظ'); }
    if (t.dataset.chw) { const x = L.toNum(t.value), c = t.dataset.chc, mn = L.chemMin(S.cfg, c); if (t.value !== '' && (x == null || x < 0 || x > 100)) { toast('نسبة الكيميكال لازم تبقى من 0 لـ 100'); t.focus(); return; } setChem(t.dataset.chw, { [c]: t.value }, viewDay()); save(); return toast(x != null && x < mn ? `اتحفظ. ${L.CHEM_N[c] || c} تحت ${mn}%` : 'اتحفظ'); }
    if (t.id === 'vday') { VDAY = t.value && t.value !== curDay() ? t.value : null; return render(); }
    if (t.dataset.vis) return setEdit(t.dataset.vis, 'hid', t.checked ? 0 : 1);
    if (t.dataset.int) return setEdit(t.dataset.int, 'int', t.checked ? 1 : 0);
    if (t.dataset.type) { setEdit(t.dataset.type, 't', t.value); return toast('اتغير النوع'); }
    if (t.dataset.task) { const aid = t.dataset.a || V.a, pl = planObj(viewDay(), aid), x = pl.tasks.find(q => q.id === t.dataset.task); if (!x) return; x.done = t.checked ? stampBy() : null; mark(`pt|${viewDay()}|${aid}|${x.id}`); audit('plan', areaOf(aid).n, 'مهمة', t.checked ? '' : 'خلصت', t.checked ? 'خلصت: ' + x.x : x.x, viewDay()); save(); return render(); }
    if (t.id === 'jk') { const w = $('#jkw'); if (w) { w.hidden = t.value !== '__o'; if (!w.hidden) $('#jko').focus(); } return; }
    if (t.id === 'lu') { const o = $('#lu2'); if (o) { o.hidden = t.value !== ''; if (!o.hidden) o.focus(); } return; }
    if (t.dataset.role) { const u = S.users[t.dataset.role]; if (!u) return; audit('user', u.u, 'الصلاحية', u.role || 'tech', t.value, curDay()); u.role = t.value; mark('u|' + u.u); save(); return toast('اتغيرت الصلاحية'); }
  });
  // map gestures: one finger moves the map, two fingers zoom and turn it
  const PTRS = new Map(); let GST = null, RAF = 0, NOCLICK = false;
  const mapEl = () => $('#map svg.map');
  function svgPt(e) { const m = mapEl(); if (!m) return null; const r = m.getBoundingClientRect(); return [(e.clientX - r.left) * 1000 / r.width, (e.clientY - r.top) * 1000 / r.height]; }
  function gesture() {
    const pts = [...PTRS.values()];
    if (pts.length === 1) GST = { kind: 'pan', p0: pts[0], anchor: mapInv(pts[0][0], pts[0][1]), moved: GST ? GST.moved : false };
    else if (pts.length >= 2) { const [a, b] = pts, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; GST = { kind: 'pinch', d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, a0: Math.atan2(b[1] - a[1], b[0] - a[0]), z0: MAPV.z, r0: MAPV.rot || 0, anchor: mapInv(mid[0], mid[1]), moved: true }; }
  }
  function redraw() { if (RAF) return; RAF = requestAnimationFrame(() => { RAF = 0; drawMapOnly(true); }); }
  document.addEventListener('pointerdown', e => { if (!MAPV || !e.target.closest('svg.map')) return; const p = svgPt(e); if (!p) return; PTRS.set(e.pointerId, p); gesture(); });
  document.addEventListener('pointermove', e => {
    if (!GST || !PTRS.has(e.pointerId) || !MAPV) return; const p = svgPt(e); if (!p) return; PTRS.set(e.pointerId, p); const pts = [...PTRS.values()];
    if (GST.kind === 'pan' && pts.length === 1) { if (!GST.moved && Math.hypot(p[0] - GST.p0[0], p[1] - GST.p0[1]) < 14) return; GST.moved = true; keepAnchor(GST.anchor, p); }
    else if (GST.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dd = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      MAPV.z = Math.max(0.5, Math.min(40, GST.z0 * dd / GST.d0)); MAPV.rot = ((GST.r0 + (ang - GST.a0) * 180 / Math.PI) % 360 + 360) % 360; keepAnchor(GST.anchor, mid);
    } else return;
    e.preventDefault(); redraw();
  }, { passive: false });
  function pointerEnd(e) {
    if (!PTRS.has(e.pointerId)) return; PTRS.delete(e.pointerId);
    if (PTRS.size) { gesture(); return; }
    const moved = GST && GST.moved; GST = null;
    if (moved) { NOCLICK = true; setTimeout(() => NOCLICK = false, 80); const i = $('#mapinfo'), a = areaOf(V.a); if (i && a) i.innerHTML = mapInfo(a, viewDay()); }
  }
  document.addEventListener('pointerup', pointerEnd); document.addEventListener('pointercancel', pointerEnd);
  document.addEventListener('click', e => { if (NOCLICK && e.target.closest('svg.map')) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('wheel', e => { if (!MAPV || !e.target.closest('svg.map')) return; e.preventDefault(); const p = svgPt(e), an = mapInv(p[0], p[1]); MAPV.z = Math.max(0.5, Math.min(40, MAPV.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); keepAnchor(an, p); redraw(); }, { passive: false });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lp') doLogin(); });
  window.addEventListener('popstate', () => { if (FM) closeForm(); });
  // Android back button
  if (Cap && Cap.App) Cap.App.addListener('backButton', () => { if (!modalEl.hidden) return closeModal(); if (FM) return closeForm(); if (V.v !== 'home' && me()) return go(V.v === 'admin' || V.v === 'audit' ? 'settings' : 'home'); Cap.App.exitApp(); });
  // a new production day starts while the app is open
  setInterval(() => { if (!FM && modalEl.hidden && me() && !VDAY && document.activeElement === document.body) render(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  function syncMeta(k, d) {
    if (d == null || typeof d !== 'object' || Array.isArray(d)) return d;
    const [p, a, b] = k.split('|'), o = Object.assign({}, d), an = id => (areaOf(id) || {}).n || id || '';
    if (p === 'r') { const w = WBY[b]; if (w) { o._n = w.n; o._a = an(w.a); o._ty = w.t; if (w.t === 'GL' && w.k > 0) { const q = L.gasValue(w, d.v); if (q != null) o._q = Math.round(q * 1000) / 1000; } } }
    if (p === 'c') { const w = WBY[b]; if (w) { o._n = w.n; o._a = an(w.a); o._ty = w.t; } }
    if (p === 'nw') { o._a = an(d.a); }
    if (p === 'd') { const t = TANKS.find(x => x.id === b); if (t) { o._place = t.place; o._code = t.code; o._cap = t.cap; o._a = an(t.a); } }
    if (p === 'p') { const x = SEED.points.find(q => q.id === b); if (x) { o._n = x.n; o._a = an(x.a); } }
    if (p === 'e') { const w = WBY[d.w]; if (w) { o._n = w.n; o._a = an(w.a); } o._av = L.avocet(d.r); }
    if (p === 's') { const w = WBY[d.w]; o._n = w ? w.n : d.pt; o._a = w ? an(w.a) : d.a ? an(d.a) : ''; }
    if (p === 'pm') o._txt = MAINT[d.k] + ': ' + (d.w || []).map(id => WBY[id] ? WBY[id].n : id).join('، ') + (d.n ? ' — ' + d.n : '');
    if (p === 'pw') o._txt = (WBY[d.w] ? WBY[d.w].n : d.w) + ' · ' + d.k + (d.n ? ' — ' + d.n : '');
    if (p === 'pt') o._txt = d.x + (d.w && WBY[d.w] ? ' · ' + WBY[d.w].n : '');
    if (p === 'cw') { const w = WBY[a] || SEED.wells.find(x => x.id === a); if (w) o._n = w.n; }
    return o;
  }
  function syncDone(r) {
    if (r.cfgChanged) rebuildWells();
    if (r.got && !FM && modalEl.hidden && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render();
    document.querySelectorAll('[data-sync]').forEach(el => el.innerHTML = syncLine());
    if (r.got) checkAlerts();
    if (SEED_NEW) { SEED_NEW = false; toast('بيانات الآبار اتحدثت. اقفل البرنامج وافتحه تاني'); }
    if (r.manual) { const st = SYNC.status(); toast(st.err ? 'مقدرتش أبعت: ' + st.err : `اتبعت ${r.sent} واستلمت ${r.got}`); }
  }
  function syncLine() {
    if (!window.SYNC) return '';
    const st = SYNC.status();
    if (!st.linked) return `<span class="sy off">مش متربط بالشيت لسه</span>`;
    if (st.running) return `<span class="sy run">بيبعت…</span>`;
    if (st.err && st.net) return `<span class="sy off">${esc(st.err)}${st.pending ? ` · ${st.pending} مستني يتبعت لما النت يرجع` : ''}</span>`;
    if (st.err) return `<span class="sy bad">مقدرش يبعت: ${esc(st.err)}${st.pending ? ` · ${st.pending} مستني` : ''}</span>`;
    return `<span class="sy ok">${st.pending ? `${st.pending} مستني يتبعت` : 'كله اتبعت'}${st.last ? ' · آخر مرة ' + hmA(st.last) : ''}</span>`;
  }
  // keep the last errors so they can be sent from the settings screen
  function logErr(m) { try { S.errs = (S.errs || []).concat([{ t: Date.now(), m: String(m).slice(0, 400), v: V.v + '/' + (V.tab || '') + '/' + S.ui.mode }]).slice(-30); save(); } catch (e) { } }
  window.addEventListener('error', e => { logErr((e.message || 'error') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); toast('حصلت مشكلة. اتسجلت في الإعدادات.'); });
  window.addEventListener('unhandledrejection', e => { logErr('promise: ' + (e.reason && e.reason.message || e.reason)); });
  (async function init() {
    const st = await loadState(); if (st && st.v === 1) S = Object.assign(fresh(), st, { cfg: Object.assign(fresh().cfg, st.cfg || {}), ui: Object.assign(fresh().ui, st.ui || {}) });
    S.ui.mode = 'type'; // the app opens on the list by type
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
    if (!S.ui.here) S.ui.here = Object.keys(S.users);
    SYNC.init({ getS: () => S, save, meta: syncMeta, onDone: syncDone, onGone, seedPart, onSeed, cutDay: () => L.addDays(curDay(), -60), version: VERSION });
    for (const h of GONE0) if (!(S.gone && S.gone[h])) { const x = Object.keys(S.users).find(u => L.uhash(u) === h); if (x) { scrubUser(x); save(); } else { S.gone = S.gone || {}; S.gone[h] = 1; } } // a phone that never had the person only remembers the hash
    // forget "seen" marks of plan items older than a few days
    { const keep = new Set(); for (let i = 0; i < 4; i++) for (const a of SEED.areas) for (const x of planItems(L.addDays(curDay(), -i), a.id)) keep.add(x.it.id);
      for (const m of ['seen', 'alerted']) if (S.ui[m]) for (const id in S.ui[m]) if (!keep.has(id)) delete S.ui[m][id]; }
    rebuildWells(); render(); setTimeout(checkAlerts, 1500);
    if (me() && me().role === 'eng') publishSeed();
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installEvt = e; if (V.v === 'home' && !FM) render(); });
  })();
  window.__ws = { get S() { return S; }, get MAPV() { return MAPV; }, L, rebuildWells, render, timeInput, readTime, saveNow };
})();
