// Service worker: deja la app y los datos disponibles sin conexión.
// Estrategia: se responde desde la copia guardada y, si hay red, se actualiza en segundo plano
// (la próxima vez que abras la app ves lo nuevo). Los datos de recorridos van primero por red.
const CACHE = 'colectivos-ov-v2';
const BASE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/estado.js', 'js/datos.js', 'js/motor.js', 'js/buscador.js', 'js/lector.js', 'js/ocr.js', 'js/tabla.js',
  'js/vista-planear.js', 'js/vista-vivo.js', 'js/vista-lineas.js', 'js/vista-planillas.js', 'js/vista-ajustes.js',
  'data/lineas.json', 'data/cambios.json', 'data/calles.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // API de Anthropic, OSM, etc.: directo a la red
  const deRed = () => fetch(req).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
    return r;
  });
  if (/\/data\/(lineas|cambios)\.json$/.test(url.pathname)) {
    // recorridos: lo más nuevo si hay conexión, si no lo guardado
    e.respondWith(deRed().catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(guardado => {
    const red = deRed().catch(() => guardado);
    if (guardado) { e.waitUntil(red); return guardado; }
    return red;
  }));
});
