// Pestaña "Líneas": colectivos en vivo (estimados), recorrido, horarios, historial y paradas de cada línea.
import { h, dialogo, mapa, gmaps, toast, poner, hoyISO } from './ui.js';
import { E, D, guardar, recordarLugar, cuandoLlega, calleListas, cargarCalles, tipoAuto, busesAhora, busesParaMapa, LEYENDA_BUS, refrescarHorarios, cargarResumen } from './estado.js';
import { aHora, NOMBRE_TIPO } from './motor.js';

const VIVO = '__vivo';
let sel = { linea: VIVO, sentido: 'ida', tipo: null };
const TIPOS = ['habil', 'sabado', 'domingo'];

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

const leyendaBuses = () => LEYENDA_BUS.map(([t, c]) => h('span', {}, h('i', { style: `background:${c}` }), t));

/** Mapa con los colectivos estimados; se vuelve a dibujar solo cada 15 s mientras la pestaña esté abierta. */
function mapaEnVivo({ ids, rutas = [], paradas = [], clave, alto = 400, lista = true }) {
  const caja = h('div', { class: 'mapa-en-vivo' }), detalle = h('div', { style: 'display:grid;gap:6px' });
  const pintar = () => {
    const buses = busesAhora(ids);
    poner(caja, mapa({ clave, calles: D.calles, rutas, paradas, buses: busesParaMapa(buses), alto, leyenda: leyendaBuses() }));
    if (!lista) return;
    poner(detalle,
      h('p', { class: 'suave chico' }, buses.length ? `${buses.length} colectivo(s) circulando ahora, según los horarios (estimado, no es el GPS real). Actualizado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.`
        : D.horarios ? 'Ahora no hay colectivos circulando según los horarios que tengo (o todavía no tengo los de este tramo del día).' : 'Todavía no cargaron los horarios.'),
      buses.length ? h('details', {}, h('summary', { class: 'suave' }, 'Ver la lista'), h('ul', { class: 'lista' }, buses.sort((a, b) => a.linea.id.localeCompare(b.linea.id, 'es', { numeric: true })).map(b => h('li', { style: 'padding:6px 0' },
        h('strong', {}, b.linea.nombre), ` ${b.hacia ? 'hacia el Centro' : 'desde el Centro'}`, h('small', {}, `entre ${b.anterior} y ${b.proxima} · llega ${aHora(b.tProxima % 1440)}`)))) ) : null);
  };
  pintar();
  let n = 0;
  const t = setInterval(() => {
    if (!caja.isConnected) return clearInterval(t);
    if (++n % 8 === 0) refrescarHorarios().then(pintar); else pintar();   // cada 2 min baja los horarios por si cambiaron
  }, 15000);
  const siCalles = () => { if (caja.isConnected) pintar(); };
  if (!D.calles) { cargarCalles().catch(() => {}); calleListas.addEventListener('listas', siCalles, { once: true }); }
  return [caja, lista ? detalle : null];
}

/** Servicios de un sentido para un tipo de día, como botones con la hora de salida. */
function panelHorarios(L, sentido, repintar) {
  const tipos = TIPOS.filter(t => D.horarios?.lineas?.[L.id]?.[t]);
  const auto = tipoAuto(hoyISO()).tipo;
  const tipo = tipos.includes(sel.tipo) ? sel.tipo : tipos.includes(auto) ? auto : tipos[0];
  const T = tipo && D.horarios.lineas[L.id][tipo];
  const filas = [];
  if (T) for (const b of T.bloques) if (b.sentido === sentido) b.filas.forEach(f => {
    const ks = f.map((x, k) => x != null ? k : -1).filter(k => k >= 0);
    if (ks.length >= 2) filas.push({ b, f, t0: f[ks[0]], t1: f[ks[ks.length - 1]], ini: ks[0], fin: ks[ks.length - 1] });
  });
  filas.sort((a, c) => a.t0 - c.t0);
  const S = L.sentidos[sentido];
  const cob = T ? Math.round((T.franjas.match(/1/g) || []).length / 48 * 100) : 0;
  const ver = x => dialogo(`${L.nombre} · ${aHora(x.t0 % 1440)}`, [
    h('p', { class: 'suave chico' }, S.desc),
    h('ol', { class: 'lista' }, x.b.paradas.map((n, k) => x.f[k] != null ? h('li', { style: 'padding:6px 0;display:grid;grid-template-columns:4.2em 1fr;gap:8px' }, h('strong', {}, aHora(x.f[k] % 1440)), h('span', {}, S.paradas[n - 1].nombre)) : null)),
  ]);
  return h('section', { class: 'panel' },
    h('h2', {}, 'Horarios de este sentido'),
    tipos.length ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de día' }, tipos.map(t => h('button', { 'aria-pressed': String(t === tipo), onclick: () => { sel.tipo = t; repintar(); } }, NOMBRE_TIPO[t][0].toUpperCase() + NOMBRE_TIPO[t].slice(1) + (t === auto ? ' (hoy)' : '')))) : null,
    !T ? h('p', { class: 'suave' }, 'Todavía no tengo horarios de esta línea: Paraná Online los muestra de a ~2 horas y la app los va juntando solos.')
      : h('div', {}, h('p', { class: (cob >= 85 ? 'bien-txt' : 'ojo-txt') + ' chico' }, cob >= 85 ? `✓ Horario completo (${filas.length} servicios).` : `Horario incompleto: tengo ${cob}% del día (${filas.length} servicios). Se completa solo con las lecturas de Paraná Online.`),
        h('p', { class: 'suave chico' }, 'Tocá un servicio para ver a qué hora pasa por cada parada.'),
        h('div', { class: 'chips-hora' }, filas.map(x => h('button', { class: 'btn mini', onclick: () => ver(x) }, aHora(x.t0 % 1440))))));
}

/** Historial: cómo fue cambiando el servicio de la línea día a día (cantidad de servicios, primero, último, intervalo). */
function panelHistorial(L) {
  const cuerpo = h('div', {}, h('p', { class: 'suave chico' }, 'Cargando…'));
  cargarResumen().then(R => {
    const dias = Object.entries(R?.dias || {}).filter(([, v]) => v[L.id]).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
    poner(cuerpo, dias.length ? h('table', { class: 'tabla-hist' },
      h('thead', {}, h('tr', {}, ['Día', 'Horario', 'Servicios', 'Primero', 'Último', 'Cada'].map(t => h('th', {}, t)))),
      h('tbody', {}, dias.map(([f, v]) => { const x = v[L.id]; return h('tr', {}, h('td', {}, f.slice(5).split('-').reverse().join('/')), h('td', {}, NOMBRE_TIPO[x.tipo] || x.tipo), h('td', {}, String(x.servicios) + (x.cobertura < 0.85 ? '*' : '')), h('td', {}, x.primera || '—'), h('td', {}, x.ultima || '—'), h('td', {}, x.intervaloMedio ? x.intervaloMedio + ' min' : '—')); })))
      : h('p', { class: 'suave chico' }, 'Todavía no hay historial de esta línea: empieza a juntarse con las lecturas de Paraná Online.'),
      dias.some(([, v]) => v[L.id].cobertura < 0.85) ? h('p', { class: 'suave chico' }, '* Día incompleto: la app todavía no había leído todo el día.') : null);
  });
  return h('details', { class: 'panel' }, h('summary', {}, 'Historial de horarios (por día)'),
    h('p', { class: 'suave chico' }, 'Cada día la app guarda cuántos servicios tuvo la línea y a qué hora empezó y terminó, para ver cómo cambia con el tiempo. El detalle de cada día está en data/historial/ del repositorio.'), cuerpo);
}

export function vistaLineas(raiz) {
  const repintar = () => vistaLineas(raiz);
  if (sel.linea !== VIVO && !D.lineas.some(l => l.id === sel.linea)) sel.linea = VIVO;
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Línea' },
    h('button', { 'aria-pressed': String(sel.linea === VIVO), onclick: () => { sel.linea = VIVO; repintar(); } }, '🚌 En vivo'),
    D.lineas.map(l => h('button', { 'aria-pressed': String(l.id === sel.linea), onclick: () => { sel.linea = l.id; repintar(); } }, l.id.replace('-', ' '))));

  if (sel.linea === VIVO) {
    const [caja, detalle] = mapaEnVivo({ ids: null, clave: 'en-vivo', alto: 460 });
    poner(raiz, chips, h('section', { class: 'panel' },
      h('h2', {}, 'Colectivos en vivo (estimados)'),
      h('p', { class: 'suave chico' }, 'Dónde estaría cada colectivo ahora, calculado con los horarios que publica Paraná Online (no es el GPS real de los coches). Arrastrá el mapa y acercá con ＋ / － o pellizcando; tocá una línea abajo para ver solo esa.'),
      caja, detalle,
      h('div', { class: 'fila' }, h('a', { class: 'btn mini', href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Tiempo real oficial (Cuándo llega)'))));
    return;
  }

  const L = D.lineas.find(l => l.id === sel.linea);
  if (!L) { poner(raiz, h('p', { class: 'nota mal' }, 'No pude cargar los recorridos.')); return; }
  if (!L.sentidos[sel.sentido]) sel.sentido = Object.keys(L.sentidos)[0];
  const S = L.sentidos[sel.sentido];
  const C = D.cambios, fecha = iso => iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const cambiosLinea = (C?.historial || []).filter(c => c.linea === L.id).slice(0, 3);
  const [caja, detalle] = mapaEnVivo({ ids: [L.id], clave: 'lineas-' + L.id + '-' + sel.sentido, alto: 400, rutas: S.ramales.map(r => r.pts), paradas: S.paradas });

  poner(raiz, chips,
    h('section', { class: 'panel' },
      h('h2', {}, L.nombre + (L.tipo === 'urbana' ? ' (urbana)' : '')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Sentido' }, Object.entries(L.sentidos).map(([k, s]) => h('button', { 'aria-pressed': String(k === sel.sentido), onclick: () => { sel.sentido = k; repintar(); } }, s.desc || k))),
      S.ramales.length > 1 && h('p', { class: 'suave chico' }, 'Ramales: ' + S.ramales.map((r, i) => (i ? 'azul' : 'verde') + ' = ' + (r.nombre || r.desc)).join(' · ')),
      caja, detalle,
      h('div', { class: 'fila' },
        h('a', { class: 'btn mini', href: L.url, target: '_blank', rel: 'noopener' }, 'Horarios en Paraná Online'),
        h('a', { class: 'btn mini', href: L.mapa, target: '_blank', rel: 'noopener' }, 'Mapa completo'),
        h('a', { class: 'btn mini', href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Cuándo llega'))),
    panelHorarios(L, sel.sentido, repintar),
    panelHistorial(L),
    h('section', { class: 'panel' },
      h('h2', {}, `Paradas (${S.paradas.length})`),
      h('p', { class: 'suave chico' }, 'Tocá una parada para ver a qué hora pasa y usarla como origen o destino.'),
      h('ol', { class: 'lista' }, S.paradas.map(s => h('li', {}, h('button', { onclick: () => accionesParada(L, s, sel.sentido) },
        h('span', { class: 'n' }, s.n), h('span', {}, s.nombre), h('span', { class: 'suave' }, '›')))))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Estado de los datos'),
      h('p', { class: 'suave' }, `Recorridos y paradas tomados de Paraná Online. Última revisión automática: ${fecha(C?.revisado)}. Último cambio guardado: ${fecha(D.generado)}.`),
      cambiosLinea.length ? h('div', { class: 'nota ojo' }, h('strong', {}, 'Cambios detectados en esta línea:'), h('ul', {}, cambiosLinea.map(c => h('li', {}, `${c.fecha}: ${c.detalle.join('; ')}`))))
        : h('p', { class: 'suave chico' }, 'Sin cambios de recorrido registrados en esta línea.'),
      C?.errores?.length ? h('p', { class: 'nota mal chico' }, 'La última revisión no pudo leer: ' + C.errores.join(' · ')) : null,
      h('p', { class: 'suave chico' }, 'Paraná Online muestra por parada solo los colectivos de las próximas ~2 horas. La app los lee cada pocos minutos y los va sumando para armar el horario completo; las líneas urbanas ya vienen completas.')));
}
