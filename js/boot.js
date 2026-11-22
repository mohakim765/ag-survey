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
    try { const L = JSON.parse(b64d(m[1])); return L && /^https:\/\/script\.google(usercontent)?\.com\//.test(L.u) && L.k ? { u: L.u, k: L.k } : null; } catch (e) { return null; }
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  // 1) a private link in the address: keep it, and take it out of the address bar
  const fromHash = readLink(location.hash);
  if (fromHash) { localStorage.setItem('ags_link', JSON.stringify(fromHash)); history.replaceState(null, '', location.pathname + location.search); }
  else if (/link=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  window.addEventListener('hashchange', () => { if (readLink(location.hash)) location.reload(); }); // a new link opened while the page is open
  const link = get('ags_link');
  window.CONFIG = { syncUrl: link ? link.u : '', syncKey: link ? link.k : '', web: true };
  window.SEED = get('ags_seed');
  if (link && window.SEED && window.SEED.wells) return start();
  screen(link);

  function start() {
    for (const f of ['lib', 'xlsx', 'pdf', 'sync', 'app']) { const s = document.createElement('script'); s.src = 'js/' + f + '.js'; s.async = false; document.body.appendChild(s); }
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
    shell(`<div class="card" style="margin-top:14px"><p style="margin:0" id="st">بينزّل بيانات الآبار من الشيت…</p></div>`);
    loadSeed(L).then(seed => { localStorage.setItem('ags_seed', JSON.stringify(seed)); window.SEED = seed; app.innerHTML = ''; start(); })
      .catch(e => {
        shell(`<div class="card" style="margin-top:14px"><div class="banner">${esc(e.message || e)}</div><button class="btn pen wide" id="rt">جرّب تاني</button><button class="btn wide" style="margin-top:8px" id="nl">لينك تاني</button></div>`);
        document.getElementById('rt').onclick = () => location.reload();
        document.getElementById('nl').onclick = () => { localStorage.removeItem('ags_link'); location.reload(); };
      });
  }
  // the wells' data: the newest complete set of parts the Android app put in the sheet
  async function loadSeed(L) {
    let cur = 0, more = true, n = 0; const V = {};
    while (more && n++ < 200) {
      let j;
      try {
        const r = await fetch(L.u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: L.k, dev: 'web-setup', cursor: cur, changes: [] }), redirect: 'follow' });
        j = JSON.parse(await r.text());
      } catch (e) { throw new Error('مفيش نت، أو الشيت مش بيرد. أول مرة لازم يبقى فيه نت.'); }
      if (!j || !j.ok) throw new Error(j && j.err === 'key' ? 'اللينك ده قديم أو غلط. اطلب لينك جديد من الأدمن.' : 'الشيت رد برد غلط.');
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
