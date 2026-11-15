// Service worker: deja la app y los datos disponibles sin conexión.
// Estrategia: SIEMPRE se pide primero a la red (revalidando, sin usar copias viejas del navegador) y se guarda
// la respuesta; la copia guardada solo se usa si no hay conexión o la red tarda más de 6 s en contestar.
// Así los archivos de la app nunca quedan mezclados entre versiones.
const CACHE = 'colectivos-ov-v5';
const BASE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/estado.js', 'js/datos.js', 'js/motor.js', 'js/buscador.js', 'js/lector.js', 'js/ocr.js', 'js/tabla.js',
  'js/vista-planear.js', 'js/vista-vivo.js', 'js/vista-lineas.js', 'js/vista-planillas.js', 'js/vista-ajustes.js',
  'data/lineas.json', 'data/cambios.json', 'data/horarios.json', 'data/calles.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // API de Anthropic, OSM, Google, etc.: directo a la red
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(req, { cache: 'no-cache', signal: ctl.signal });
      clearTimeout(t); // el límite es para que empiece a contestar; descargar el cuerpo puede tardar lo que haga falta
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});

// Tocar un aviso (por ejemplo "Tocá el timbre") abre o trae al frente la app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const abierta = cs.find(c => 'focus' in c);
    return abierta ? abierta.focus() : self.clients.openWindow('./#vivo');
  }));
});
