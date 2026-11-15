// Pestaña "Líneas": recorrido y paradas de cada línea, y estado de los datos.
import { h, dialogo, mapa, gmaps, toast, poner } from './ui.js';
import { E, D, guardar, recordarLugar, cuandoLlega } from './estado.js';
import { aHora, NOMBRE_TIPO } from './motor.js';

let sel = { linea: null, sentido: 'ida' };

/** Horarios en que pasa un colectivo por una parada, según lo que publica Paraná Online (por tipo de día). */
function horariosDeParada(L, sentido, s) {
  const out = [];
  for (const [tipo, T] of Object.entries(D.horarios?.lineas?.[L.id] || {})) {
    const horas = [];
    for (const b of T.bloques) {
      const k = b.sentido === sentido ? b.paradas.indexOf(s.n) : -1;
      if (k >= 0) for (const f of b.filas) if (f[k] != null) horas.push(f[k]);
    }
    if (horas.length) out.push({ tipo, horas: [...new Set(horas)].sort((a, b) => a - b), completo: (T.franjas.match(/1/g) || []).length >= 41 });
  }
  return out;
}

function accionesParada(L, s, sentido) {
  const usar = clave => { E.plan[clave] = recordarLugar({ nombre: s.nombre, lat: s.lat, lon: s.lon }).id; guardar(); dl.cerrar(); location.hash = '#planear'; };
  const dl = dialogo(s.nombre, [
    h('p', { class: 'suave' }, `${L.nombre} · parada ${s.n}` + (s.web ? ` · en Paraná Online: ${s.web}` : ' · nombre deducido del mapa')),
    ...horariosDeParada(L, sentido, s).map(x => h('p', { class: 'chico' }, h('strong', {}, `Pasa ${NOMBRE_TIPO[x.tipo]}: `), x.horas.map(aHora).join(' · '), x.completo ? '' : ' (todavía incompleto)')),
    h('button', { class: 'btn pri', onclick: () => usar('destino') }, 'Quiero ir acá (destino)'),
    h('button', { class: 'btn', onclick: () => usar('origen') }, 'Salgo desde acá (origen)'),
    h('button', { class: 'btn', onclick: () => { const l = recordarLugar({ nombre: s.nombre, lat: s.lat, lon: s.lon }); delete l.reciente; guardar(); toast('Guardado en tus lugares'); dl.cerrar(); } }, '⭐ Guardar en mis lugares'),
    h('a', { class: 'btn', href: gmaps(s), target: '_blank', rel: 'noopener' }, 'Ver en Google Maps'),
  ]);
}

export function vistaLineas(raiz) {
  const repintar = () => vistaLineas(raiz);
  if (!sel.linea || !D.lineas.some(l => l.id === sel.linea)) sel.linea = D.lineas[0]?.id;
  const L = D.lineas.find(l => l.id === sel.linea);
  if (!L) { poner(raiz, h('p', { class: 'nota mal' }, 'No pude cargar los recorridos.')); return; }
  if (!L.sentidos[sel.sentido]) sel.sentido = Object.keys(L.sentidos)[0];
  const S = L.sentidos[sel.sentido];
  const C = D.cambios, fecha = iso => iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const cambiosLinea = (C?.historial || []).filter(c => c.linea === L.id).slice(0, 3);

  poner(raiz, 
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Línea' }, D.lineas.map(l => h('button', { 'aria-pressed': String(l.id === L.id), onclick: () => { sel.linea = l.id; repintar(); } }, l.id.replace('-', ' ')))),
    h('section', { class: 'panel' },
      h('h2', {}, L.nombre),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Sentido' }, Object.entries(L.sentidos).map(([k, s]) => h('button', { 'aria-pressed': String(k === sel.sentido), onclick: () => { sel.sentido = k; repintar(); } }, s.desc || k))),
      S.ramales.length > 1 && h('p', { class: 'suave chico' }, 'Ramales: ' + S.ramales.map((r, i) => (i ? 'azul' : 'verde') + ' = ' + (r.nombre || r.desc)).join(' · ')),
      mapa({ rutas: S.ramales.map(r => r.pts), paradas: S.paradas, marcas: [{ ...S.paradas[0], color: '#2563eb', texto: 'Sale' }, { ...S.paradas[S.paradas.length - 1], color: '#dc2626', texto: 'Termina' }] }),
      h('div', { class: 'fila' },
        h('a', { class: 'btn mini', href: L.url, target: '_blank', rel: 'noopener' }, 'Horarios en Paraná Online'),
        h('a', { class: 'btn mini', href: L.mapa, target: '_blank', rel: 'noopener' }, 'Mapa completo'),
        h('a', { class: 'btn mini', href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Cuándo llega'))),
    h('section', { class: 'panel' },
      h('h2', {}, `Paradas (${S.paradas.length})`),
      h('p', { class: 'suave chico' }, 'Tocá una parada para usarla como origen o destino.'),
      h('ol', { class: 'lista' }, S.paradas.map(s => h('li', {}, h('button', { onclick: () => accionesParada(L, s, sel.sentido) },
        h('span', { class: 'n' }, s.n), h('span', {}, s.nombre), h('span', { class: 'suave' }, '›')))))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Estado de los datos'),
      h('p', { class: 'suave' }, `Recorridos y paradas tomados de Paraná Online. Última revisión automática: ${fecha(C?.revisado)}. Último cambio guardado: ${fecha(D.generado)}.`),
      cambiosLinea.length ? h('div', { class: 'nota ojo' }, h('strong', {}, 'Cambios detectados en esta línea:'), h('ul', {}, cambiosLinea.map(c => h('li', {}, `${c.fecha}: ${c.detalle.join('; ')}`))))
        : h('p', { class: 'suave chico' }, 'Sin cambios de recorrido registrados en esta línea.'),
      C?.errores?.length ? h('p', { class: 'nota mal chico' }, 'La última revisión no pudo leer: ' + C.errores.join(' · ')) : null,
      h('p', { class: 'suave chico' }, 'Los horarios por parada los junta solo la app de Paraná Online cada media hora; las líneas urbanas ya están completas y las interurbanas se van completando durante la semana.')));
}
