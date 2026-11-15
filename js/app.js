// Arranque: carga estado y datos, rutea las pestañas y registra el service worker.
import { $, h } from './ui.js';
import { cargarEstado, cargarDatos, E } from './estado.js';
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
  if (E.viaje && !location.hash) location.hash = '#vivo';
  rutear();
}

// En la compu (localhost) el service worker solo se activa con ?sw, para no ver archivos viejos al desarrollar.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || (local && location.search.includes('sw')))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar();
