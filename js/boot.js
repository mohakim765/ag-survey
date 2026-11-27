/* AG Survey web (iPhone, computer). The site has no field data: the admin's private link (#link=…) brings the
   sheet link, then the wells' data comes from the sheet once and stays on the device. Then the app starts. */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  function b64d(t) { t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return decodeURIComponent(escape(atob(t))); }
  function readLink(text) {
    const m = String(text || '').match(/link=([A-Za-z0-9_-]+)/); if (!m) return null;
    try { const L = JSON.parse(b64d(m[1])); return L && /^https:\/\/script\.google(usercontent)?\.com\//.test(L.u) ? Object.assign({ u: L.u, k: L.k ? String(L.k) : '' }, L.m && Array.isArray(L.m.from) ? { m: { from: L.m.from.map(String), rows: Number(L.m.rows) || 0, t: Number(L.m.t) || 0 } } : {}) : null; } catch (e) { return null; }
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  // 1) a private link in the address: keep it, and take it out of the address bar
  const fromHash = readLink(location.hash);
  if (fromHash) { const o = get('ags_link'); if (!o || o.u !== fromHash.u) localStorage.removeItem('ags_card'); localStorage.setItem('ags_link', JSON.stringify(fromHash)); history.replaceState(null, '', location.pathname + location.search); }
  else if (/link=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  window.addEventListener('hashchange', () => { if (readLink(location.hash)) location.reload(); }); // a new link opened while the page is open
  const link = get('ags_link');
  // the person logs in here (name + password): the sheet gives this computer its own card. Old links still carry the shared key.
  let card = get('ags_card');
  const setConfig = () => { window.CONFIG = { syncUrl: link ? link.u : '', syncKey: link ? link.k : '', syncTok: card ? card.tok : '', syncDev: card ? card.dev : '', syncUsers: card ? card.users : null, syncMove: (link && link.m) || null, web: true }; };
  setConfig();
  window.SEED = get('ags_seed');
  if (link && (card || link.k) && window.SEED && window.SEED.wells) return start();
  screen(link);

  function start() {
    for (const f of ['lib', 'xlsx', 'xl', 'rep', 'pdf', 'av', 'pmail', 'sync', 'app']) { const s = document.createElement('script'); s.src = 'js/' + f + '.js'; s.async = false; document.body.appendChild(s); }
  }
  function shell(body) {
    app.innerHTML = `<main class="wrap"><img class="logoimg" src="img/icon-192.png" alt=""><h1 class="center" style="margin:0" dir="ltr">AG Survey</h1>${body}
      ${ios && !standalone ? '<div class="banner info" style="margin-top:14px">بعد ما يفتح: من Safari دوس زرار المشاركة <b>⬆</b> وبعدين <b>Add to Home Screen</b>، عشان يبقى أيقونة ويشتغل من غير نت.</div>' : ''}</main>`;
  }
  function screen(L, err) {
    if (!L) {
      shell(`<p class="center mute">البرنامج محتاج اللينك الخاص اللي بيبعته الأدمن.</p><div class="card">${err ? `<div class="banner">${esc(err)}</div>` : ''}
        <p style="margin:0 0 10px">افتح اللينك من رسالة الواتساب، أو انسخه والزقه هنا:</p>
        <input class="in" id="lk" dir="ltr" autocomplete="off" placeholder="https://…#link=…"><button class="btn pen wide" style="margin-top:10px" id="lkok">ربط</button></div>`);
      const go = () => { const x = readLink(document.getElementById('lk').value); if (!x) return screen(null, 'اللينك ده مش مظبوط. انسخه كله من الرسالة.'); localStorage.setItem('ags_link', JSON.stringify(x)); location.reload(); };
      document.getElementById('lkok').onclick = go; document.getElementById('lk').onkeydown = e => { if (e.key === 'Enter') go(); };
      return;
    }
    if (!card && !L.k) return get('ags_reg') ? activate(L, err) : login(L, err);
    shell(`<div class="card" style="margin-top:14px"><p style="margin:0" id="st">بينزّل بيانات الآبار من الشيت…</p></div>`);
    loadSeed(L).then(seed => { localStorage.setItem('ags_seed', JSON.stringify(seed)); window.SEED = seed; app.innerHTML = ''; start(); })
      .catch(e => {
        if (e.login) { card = null; localStorage.removeItem('ags_card'); setConfig(); return login(L, e.message); }
        shell(`<div class="card" style="margin-top:14px"><div class="banner">${esc(e.message || e)}</div><button class="btn pen wide" id="rt">جرّب تاني</button><button class="btn wide" style="margin-top:8px" id="nl">لينك تاني</button></div>`);
        document.getElementById('rt').onclick = () => location.reload();
        document.getElementById('nl').onclick = () => { localStorage.removeItem('ags_link'); location.reload(); };
      });
  }
  const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }).then(r => r.text()).then(t => JSON.parse(t));
  const newDev = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function login(L, err) {
    shell(`<p class="center mute">ادخل بحسابك في AG Survey</p><div class="card">${err ? `<div class="banner">${esc(err)}</div>` : ''}
      <label class="lab">اسم المستخدم أو رقم الموبايل</label><input class="in" id="lu" dir="ltr" autocapitalize="off" autocomplete="username">
      <label class="lab" style="margin-top:12px">الباسورد (4 أرقام)</label><div class="pinrow"><input id="lp" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"></div>
      <button class="btn pen wide" id="lok">دخول</button><button class="linkbtn center" id="tofg">نسيت الباسورد؟</button></div>
      <div class="card center"><p style="margin:0 0 10px">أول مرة تستخدم البرنامج؟</p><button class="btn wide" id="toreg">سجّل حساب جديد</button></div>`);
    document.getElementById('toreg').onclick = () => register(L); document.getElementById('tofg').onclick = () => forgot(L);
    const go = async () => {
      const idf = (document.getElementById('lu').value || '').trim(), pin = (document.getElementById('lp').value || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      if (!idf || !/^\d{4}$/.test(pin)) return login(L, 'اكتب اسم المستخدم أو الرقم، والباسورد 4 أرقام.');
      const b = document.getElementById('lok'); b.disabled = true; b.textContent = 'بيتأكد من الشيت…';
      const dev = (card && card.dev) || newDev(); let j;
      try { j = await post(L.u, { op: 'login', idf, pin, dev, app: 'web' }); } catch (e) { return login(L, 'مفيش نت، أو الشيت مش بيرد. جرّب تاني.'); }
      if (!j || !j.ok) return login(L, !j ? 'الشيت رد برد غلط.' : j.err === 'pin' ? `الباسورد غلط${j.left ? `. فاضل ${j.left} محاولات وبعدها الحساب يتقفل` : ''}.` : j.err === 'locked' ? 'الحساب اتقفل بعد 7 محاولات غلط. كلّم الأدمن يفتحه.' : j.err === 'nouser' ? 'مفيش حساب بالاسم أو الرقم ده.' : j.err === 'wait' ? 'حسابك لسه مستني تفعيل الأدمن. فعّله من الموبايل الأول.' : j.err === 'stopped' ? 'الجهاز ده متوقف من الأدمن.' : 'مقدرش يدخل: ' + j.err);
      gotCard(L, j, dev);
    };
    document.getElementById('lok').onclick = go; document.getElementById('lp').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function gotCard(L, j, dev) { card = { tok: j.tok, dev, users: j.users }; localStorage.setItem('ags_card', JSON.stringify(card)); localStorage.removeItem('ags_reg'); setConfig(); screen(L); }
  const num = v => String(v || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const val = id => (document.getElementById(id).value || '').trim();
  const sha = async t => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).map(b => b.toString(16).padStart(2, '0')).join('');
  const pinBox = (id, ph) => `<div class="pinrow"><input id="${id}" type="password" inputmode="numeric" maxlength="4" autocomplete="off"${ph ? ` placeholder="${ph}"` : ''}></div>`;
  const busy = (id, t) => { const b = document.getElementById(id); if (b) { b.disabled = true; b.textContent = t; } };
  // a new account from the iPhone / computer: the sheet makes it, the admin sends the activation code on WhatsApp
  function register(L, err) {
    shell(`<p class="center mute">حساب جديد. اسمك هيتكتب على كل قراية تدخلها، والأدمن بيفعّل الحساب بكود على الواتساب.</p><div class="card">${err ? `<div class="banner">${esc(err)}</div>` : ''}
      <label class="lab">الاسم بالكامل</label><input class="in" id="rn" autocomplete="name">
      <div class="two" style="margin-top:10px"><div><label class="lab">الرقم الوظيفي</label><input class="in" id="re" inputmode="numeric"></div><div><label class="lab">رقم الموبايل (الواتساب)</label><input class="in" id="rp" inputmode="tel" dir="ltr"></div></div>
      <label class="lab" style="margin-top:10px">اسم المستخدم (إنجليزي من غير مسافات)</label><input class="in" id="ru" dir="ltr" autocapitalize="off" autocomplete="username">
      <div class="two" style="margin-top:10px"><div><label class="lab">باسورد 4 أرقام</label>${pinBox('rk')}</div><div><label class="lab">أكّد الباسورد</label>${pinBox('rk2')}</div></div>
      <button class="btn pen wide" id="rok">تسجيل</button></div><button class="btn wide" id="back">عندي حساب، ادخل</button>`);
    document.getElementById('back').onclick = () => login(L);
    document.getElementById('rok').onclick = async () => {
      const name = val('rn').replace(/\s+/g, ' '), emp = num(val('re')), phone = num(val('rp')).replace(/[^\d]/g, '').replace(/^20(?=1\d{9}$)/, '0'), u = val('ru').toLowerCase(), k = num(val('rk')), k2 = num(val('rk2'));
      if (name.length < 3) return register(L, 'اكتب الاسم بالكامل');
      if (!emp) return register(L, 'اكتب الرقم الوظيفي');
      if (!/^01\d{9}$/.test(phone)) return register(L, 'رقم الموبايل لازم 11 رقم ويبدأ بـ 01');
      if (!/^[a-z][a-z0-9._-]{2,19}$/.test(u)) return register(L, 'اسم المستخدم: حروف إنجليزي وأرقام، من 3 لـ 20');
      if (!/^\d{4}$/.test(k)) return register(L, 'الباسورد لازم 4 أرقام'); if (k !== k2) return register(L, 'الباسوردين مش زي بعض');
      busy('rok', 'بيسجّل في الشيت…'); const dev = newDev(); let j;
      try { j = await post(L.u, { op: 'register', u, name, emp, phone, ph: await sha('ws:' + u + ':' + k), dev, app: 'web' }); } catch (e) { return register(L, 'مفيش نت، أو الشيت مش بيرد. جرّب تاني.'); }
      if (!j || !j.ok) return register(L, !j ? 'الشيت رد برد غلط.' : j.err === 'taken' ? 'اسم المستخدم ده مش متاح، اختار غيره' : j.err === 'phone' ? 'الرقم ده عليه حساب. ادخل بيه، ولو ناسي الباسورد دوس "نسيت الباسورد"' : j.err === 'busy' ? 'فيه حسابات كتير مستنية الأدمن. كلّمه الأول' : 'راجع البيانات وجرّب تاني');
      localStorage.setItem('ags_reg', JSON.stringify({ u, name, dev })); activate(L);
    };
  }
  function activate(L, err) {
    const R = get('ags_reg') || {};
    shell(`<div class="card"><h3 style="margin:0 0 6px">حسابك مستني التفعيل</h3>${err ? `<div class="banner">${esc(err)}</div>` : ''}
      <p class="mute" style="margin-top:0">${esc(R.name || '')} (<bdi dir="ltr">${esc(R.u || '')}</bdi>). الأدمن هيبعتلك كود 4 أرقام على الواتساب. ابعتله رسالة إنك سجلت.</p>
      <label class="lab">كود التفعيل</label><div class="pinrow"><input id="ac" inputmode="numeric" maxlength="4" autocomplete="one-time-code"></div>
      <button class="btn pen wide" id="aok">فعّل</button></div><button class="btn wide" id="back">خروج</button>`);
    document.getElementById('back').onclick = () => { localStorage.removeItem('ags_reg'); login(L); };
    document.getElementById('aok').onclick = async () => {
      const c = num(val('ac')); if (!/^\d{4}$/.test(c)) return activate(L, 'الكود 4 أرقام');
      busy('aok', 'بيتأكد من الكود…'); let j;
      try { j = await post(L.u, { op: 'activate', u: R.u, code: c, dev: R.dev || newDev(), app: 'web' }); } catch (e) { return activate(L, 'مفيش نت. جرّب تاني.'); }
      if (j && j.err === 'done') { localStorage.removeItem('ags_reg'); return login(L, 'حسابك اتفعّل. ادخل بالباسورد.'); }
      if (!j || !j.ok) return activate(L, codeErr(j));
      gotCard(L, j, R.dev || newDev());
    };
  }
  const codeErr = j => !j ? 'الشيت رد برد غلط.' : j.err === 'code' ? `الكود غلط${j.left ? ` (فاضل ${j.left})` : ''}` : j.err === 'old' ? 'الكود ده قديم. اطلب كود جديد من الأدمن' : j.err === 'used' ? 'الكود ده اتقفل بعد 5 محاولات غلط. اطلب كود جديد' : j.err === 'nocode' ? 'الكود لسه موصلش للشيت. اتأكد إن الأدمن بعته وجرّب تاني' : j.err === 'stopped' ? 'الجهاز ده متوقف من الأدمن' : 'مقدرش: ' + j.err;
  // forgotten password: a request to the admin, his code + a new password
  function forgot(L, err, info) {
    if (!info) {
      shell(`<p class="center mute">اكتب اسم المستخدم أو رقم الموبايل. هيوصل طلب للأدمن، وهو هيبعتلك كود على الواتساب.</p><div class="card">${err ? `<div class="banner">${esc(err)}</div>` : ''}
        <label class="lab">اسم المستخدم أو رقم الموبايل</label><input class="in" id="fu" dir="ltr" autocapitalize="off"><button class="btn pen wide" id="fok">كمّل</button></div><button class="btn wide" id="back">رجوع للدخول</button>`);
      document.getElementById('back').onclick = () => login(L);
      document.getElementById('fok').onclick = async () => {
        const idf = val('fu'); if (!idf) return forgot(L, 'اكتب اسم المستخدم أو رقم الموبايل');
        busy('fok', 'بيدوّر على حسابك…'); let j;
        try { j = await post(L.u, { op: 'forgot', idf, dev: newDev(), app: 'web' }); } catch (e) { return forgot(L, 'مفيش نت. جرّب تاني.'); }
        if (!j || !j.ok) return forgot(L, j && j.err === 'many' ? 'الرقم ده عليه أكتر من حساب. اكتب اسم المستخدم' : 'مفيش حساب بالاسم أو الرقم ده');
        forgot(L, '', j.users[0]);
      };
      return;
    }
    shell(`<p class="center mute">حساب ${esc(info.name)} · اتبعت طلب للأدمن. هيبعتلك كود 4 أرقام على الواتساب على رقمك <bdi dir="ltr">${esc(info.phone || '')}</bdi>.</p><div class="card">${err ? `<div class="banner">${esc(err)}</div>` : ''}
      <label class="lab">الكود اللي وصلك</label><div class="pinrow"><input id="fc" inputmode="numeric" maxlength="4" autocomplete="one-time-code"></div>
      <label class="lab">الباسورد الجديد (4 أرقام)</label>${pinBox('fk')}${pinBox('fk2', 'تأكيد')}<button class="btn pen wide" id="fok">غيّر الباسورد وادخل</button></div><button class="btn wide" id="back">رجوع للدخول</button>`);
    document.getElementById('back').onclick = () => login(L);
    document.getElementById('fok').onclick = async () => {
      const c = num(val('fc')), k = num(val('fk')), k2 = num(val('fk2'));
      if (!/^\d{4}$/.test(c)) return forgot(L, 'اكتب الكود اللي وصلك (4 أرقام)', info);
      if (!/^\d{4}$/.test(k)) return forgot(L, 'الباسورد الجديد 4 أرقام', info); if (k !== k2) return forgot(L, 'الباسوردين مش زي بعض', info);
      busy('fok', 'بيتأكد من الكود…'); const dev = (card && card.dev) || newDev(); let j;
      try { j = await post(L.u, { op: 'reset', u: info.u, code: c, ph: await sha('ws:' + info.u + ':' + k), dev, app: 'web' }); } catch (e) { return forgot(L, 'مفيش نت. جرّب تاني.', info); }
      if (!j || !j.ok) return forgot(L, codeErr(j), info);
      gotCard(L, j, dev);
    };
  }
  // the wells' data: the newest complete set of parts the Android app put in the sheet
  async function loadSeed(L) {
    let cur = 0, more = true, n = 0; const V = {};
    while (more && n++ < 200) {
      let j;
      try {
        j = await post(L.u, Object.assign({ cursor: cur, changes: [] }, card ? { tok: card.tok, dev: card.dev } : { key: L.k, dev: 'web-setup' }));
      } catch (e) { throw new Error('مفيش نت، أو الشيت مش بيرد. أول مرة لازم يبقى فيه نت.'); }
      if (j && !j.ok && (j.err === 'login' || (j.err === 'key' && !card))) throw Object.assign(new Error(j.err === 'key' ? 'اللينك ده من غير كارنيه. ادخل بحسابك.' : 'ادخل بحسابك تاني.'), { login: true });
      if (!j || !j.ok) throw new Error(j && j.err === 'locked' ? 'الحساب اتقفل بعد 7 محاولات غلط. كلّم الأدمن يفتحه.' : j && j.err === 'stopped' ? 'الجهاز ده متوقف من الأدمن.' : 'الشيت رد برد غلط.');
      if (j.renew && card) { card.tok = j.renew; localStorage.setItem('ags_card', JSON.stringify(card)); setConfig(); }
      for (const c of j.changes || []) {
        const p = String(c.k).split('|'); if (p[0] !== 'sd' || !c.d || typeof c.d.s !== 'string') continue;
        const v = V[p[1]] || (V[p[1]] = { n: c.d.n, p: {} }); v.p[+p[2]] = c.d.s;
      }
      cur = j.cursor; more = j.more; const st = document.getElementById('st'); if (st && more) st.textContent = `بينزّل من الشيت… (${cur})`;
    }
    const vers = Object.keys(V).filter(v => Object.keys(V[v].p).length >= V[v].n).sort();
    if (!vers.length) throw new Error('بيانات الآبار لسه موصلتش للشيت. الأدمن يفتح برنامج الأندرويد وهو متصل بالنت، وبعدين جرّب تاني.');
    const v = V[vers[vers.length - 1]], seed = JSON.parse(Array.from({ length: v.n }, (_, i) => v.p[i]).join(''));
    if (!seed || !seed.wells) throw new Error('بيانات الآبار ناقصة. جرّب تاني.');
    return seed;
  }
})();
