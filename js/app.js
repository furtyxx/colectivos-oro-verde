// Arranque: carga estado y datos, rutea las pestañas y registra el service worker.
import { $, h } from './ui.js';
import { cargarEstado, cargarDatos, cargarCalles, E, guardar, recordarLugar } from './estado.js';
import { lugarDeTextoCompartido } from './buscador.js';
import { dialogo, toast } from './ui.js';
import { vistaPlanear } from './vista-planear.js';
import { vistaVivo, retomarViaje } from './vista-vivo.js';
import { vistaLineas } from './vista-lineas.js';
import { vistaPlanillas } from './vista-planillas.js';
import { vistaAjustes } from './vista-ajustes.js';

const VISTAS = { planear: vistaPlanear, vivo: vistaVivo, lineas: vistaLineas, planillas: vistaPlanillas, ajustes: vistaAjustes };

function rutear() {
  const tab = VISTAS[location.hash.slice(1)] ? location.hash.slice(1) : 'planear';
  document.querySelectorAll('.tabs a').forEach(a => {
    const activa = a.dataset.tab === tab;
    a.classList.toggle('activa', activa);
    if (activa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const raiz = $('#vista');
  raiz.replaceChildren();
  VISTAS[tab](raiz);
  window.scrollTo(0, 0);
}

function red() { $('#estado-red').hidden = navigator.onLine; }

async function iniciar() {
  cargarEstado();
  try { await cargarDatos(); }
  catch (e) {
    $('#vista').replaceChildren(h('p', { class: 'nota mal' }, 'No pude cargar los recorridos. Abrí la app una vez con conexión para que queden guardados.'));
    return;
  }
  retomarViaje();
  window.addEventListener('hashchange', rutear);
  window.addEventListener('online', red); window.addEventListener('offline', red); red();
  if (E.viaje && !location.hash && !recibido()) location.hash = '#vivo';
  rutear();
  window.__listo = true; clearTimeout(window.__arranque);
  try { sessionStorage.removeItem('reintento'); } catch { /* da igual */ }
  cargarCalles().catch(() => {}); // las calles de fondo de los mapas se cargan después, sin frenar el arranque
  await atenderCompartido();
}

// Compartir un lugar desde Google Maps hacia esta app (share_target del manifest): llega como ?title=&text=&url=
function recibido() { const q = new URLSearchParams(location.search); return !!(q.get('text') || q.get('url') || q.get('title')); }
async function atenderCompartido() {
  const q = new URLSearchParams(location.search);
  const [titulo, texto, enlace] = [q.get('title'), q.get('text'), q.get('url')].map(x => x || '');
  const txt = [texto.includes(titulo) ? '' : titulo, texto, texto.includes(enlace) ? '' : enlace].filter(Boolean).join('\n');
  if (!txt) return;
  history.replaceState(null, '', location.pathname + '#planear'); // limpia la dirección para que no se repita al recargar
  toast('Buscando el lugar que compartiste…');
  let res = [];
  try { res = await lugarDeTextoCompartido(txt); } catch { /* sin conexión o sin resultados */ }
  const usar = (clave, p) => { E.plan[clave] = recordarLugar(p).id; guardar(); dl.cerrar(); if (location.hash !== '#planear') location.hash = '#planear'; else rutear(); };
  const dl = dialogo('Lugar compartido', res.length
    ? [h('p', { class: 'suave' }, 'Elegí cuál es y para qué lo querés usar:'),
       ...res.slice(0, 4).map(p => h('div', { class: 'panel' }, h('strong', {}, p.nombre),
         h('div', { class: 'fila', style: 'margin-top:8px' }, h('button', { class: 'btn pri', onclick: () => usar('destino', p) }, 'Quiero ir acá'), h('button', { class: 'btn', onclick: () => usar('origen', p) }, 'Salgo desde acá'))))]
    : [h('p', {}, 'No pude ubicar ese lugar. Google Maps a veces comparte un link corto que no trae la posición: probá con "Compartir" → "Copiar link" de la vista de mapa y pegalo en el buscador, o cargá la clave de Google en Ajustes.')]);
}

// En la compu (localhost) el service worker solo se activa con ?sw, para no ver archivos viejos al desarrollar.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || (local && location.search.includes('sw')))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar().catch(e => { window.__rescate?.(e?.message || String(e)); });
