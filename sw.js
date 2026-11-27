/* AG Survey web: keep every file of the app so it opens with no network. A new build has a new cache name. */
const V = 'ags-f534db49ab', FILES = ["./", "css/AG_Survey_Field.css", "css/app.css", "img/icon-180.png", "img/icon-192.png", "img/icon-512.png", "img/icon-maskable-512.png", "img/icon.webp", "index.html", "js/app.js", "js/av.js", "js/boot.js", "js/lib.js", "js/pdf.js", "js/pmail.js", "js/rep.js", "js/sync.js", "js/xl.js", "js/xlsx.js", "manifest.webmanifest"];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ags-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // the sheet goes straight to the network
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).catch(() => r.mode === 'navigate' ? caches.match('./') : Response.error())));
});
