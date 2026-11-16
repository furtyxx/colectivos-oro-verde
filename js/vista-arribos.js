// Pestaña "Arribos": qué colectivos van a pasar por una parada (o por las paradas cerca tuyo), con cuánto falta.
// Sale de los horarios por parada que publica Paraná Online (los programados); no es el GPS real de los coches.
import { h, poner, toast, ahoraMin, hoyISO, fmtM } from './ui.js';
import { E, D, guardar, lugar, planillasListas, recordarLugar, cuandoLlega, tipoAuto, refrescarHorarios, fuenteTxt, busesAhora, SEGUIMIENTO } from './estado.js';
import { arribosCerca, aHora, NOMBRE_TIPO, esIda } from './motor.js';
import { abrirBuscador, miUbicacion } from './buscador.js';
import { irALinea } from './vista-lineas.js';

let aqui = null;                                   // ubicación actual (no se guarda)
const RADIOS = [150, 300, 500];

const faltaTxt = m => m <= 0 ? 'ahora' : m < 60 ? `en ${m} min` : `en ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;

export function vistaArribos(raiz) {
  const A = E.arribos ||= { lugar: 'casa', radio: 300 };
  if (A.lugar !== '__gps' && !lugar(A.lugar)) A.lugar = E.lugares[0]?.id;
  const repintar = () => vistaArribos(raiz);
  const resultado = h('div', { style: 'display:grid;gap:10px' });

  const sel = h('select', { 'aria-label': 'Parada o lugar', onchange: async () => {
    const v = sel.value;
    if (v === '__buscar') return abrirBuscador('Parada o lugar', p => { A.lugar = p.id === '__gps' ? (aqui = p, '__gps') : recordarLugar(p).id; guardar(); repintar(); });
    if (v === '__gps') { try { aqui = await miUbicacion(); } catch (e) { toast(e.message); return repintar(); } }
    A.lugar = v; guardar(); repintar();
  } },
  h('option', { value: '__gps', selected: A.lugar === '__gps' }, '📍 Cerca mío ahora'),
  E.lugares.map(l => h('option', { value: l.id, selected: A.lugar === l.id }, l.nombre)),
  h('option', { value: '__buscar' }, '🔎 Buscar otra parada o lugar…'));

  poner(raiz,
    h('section', { class: 'panel' },
      h('h2', {}, 'Próximos colectivos'),
      h('p', { class: 'suave chico' }, 'Qué colectivos van a pasar por las paradas de un lugar, con cuánto falta. Solo cuenta los que todavía no pasaron.'),
      h('label', { class: 'campo' }, 'Lugar', sel),
      h('div', { class: 'campo' }, 'Paradas hasta a qué distancia',
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Distancia' }, RADIOS.map(r => h('button', { 'aria-pressed': String(A.radio === r), onclick: () => { A.radio = r; guardar(); repintar(); } }, fmtM(r)))))),
    resultado,
    h('p', { class: 'suave chico' }, 'Los horarios son los que Paraná Online publica para cada parada (programados). ',
      h('a', { href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Cuándo llega'), ' da el tiempo real oficial, pero a veces avisa que no hay arribos o que se excedió el límite de consultas; por eso acá se arma con Paraná Online.'));

  const punto = A.lugar === '__gps' ? aqui : lugar(A.lugar);
  if (!punto) { resultado.append(h('p', { class: 'nota ojo' }, A.lugar === '__gps' ? 'Tocá "Cerca mío ahora" otra vez y permití la ubicación.' : 'Elegí un lugar.')); return; }

  const pintar = () => {
    if (!raiz.isConnected || !resultado.isConnected) return;
    const ahora = ahoraMin() + new Date().getSeconds() / 60, hoy = hoyISO(), auto = tipoAuto(hoy);
    const lista = arribosCerca({ lineas: D.lineas, planillas: planillasListas(), horarios: D.horarios?.lineas || null, tipo: auto.tipo, punto, radio: A.radio, ahora, cfg: E.cfg });
    const con = lista.filter(x => x.arribos.length), sin = lista.filter(x => !x.arribos.length);
    const buses = busesAhora(null);
    // dónde está ahora el colectivo que va a llegar primero a esa parada (el más cercano que todavía no pasó)
    const dondeViene = x => buses.filter(b => b.linea.id === x.linea.id && b.sentido === x.sentido && b.ramal === x.ri && b.m <= x.parada.m[x.ri] + 30).sort((a, b) => b.m - a.m)[0];
    poner(resultado,
      h('p', { class: 'suave' }, `Son las ${aHora(Math.floor(ahora))} (horario ${NOMBRE_TIPO[auto.tipo]}). ${con.length ? `${con.length} línea(s) con colectivos en las próximas 3 horas.` : ''}`),
      !lista.length ? h('div', { class: 'nota ojo' }, `No encontré paradas de colectivo a menos de ${fmtM(A.radio)}. Probá con una distancia mayor.`) : null,
      lista.length && !con.length ? h('div', { class: 'nota ojo' }, 'Por las paradas de ahí no pasan más colectivos en las próximas 3 horas (o todavía no tengo esos horarios).') : null,
      ...con.map(x => h('article', { class: 'viaje rec' },
        h('div', { class: 'cab' }, h('span', { class: 'lin' }, x.linea.nombre.replace('Línea ', 'Línea ')), h('span', { class: 'etq' }, esIda(x.linea, x.sentido) ? 'Ida' : 'Vuelta'), h('span', { class: 'suave chico' }, x.desc)),
        h('div', { class: 'fila', style: 'align-items:baseline' },
          h('div', { class: 'grande-hora' }, aHora(x.arribos[0].t % 1440)), h('div', { class: 'crece' }, h('strong', {}, faltaTxt(x.arribos[0].falta)), h('div', { class: 'suave chico' }, `en ${x.parada.nombre} (a ${fmtM(x.d)})`))),
        (b => b ? h('p', { class: 'posicion chico' }, h('strong', {}, '🚌 Ahora viene ' + (b.estimadoAtras ? `en camino hacia ${b.proxima}` : `entre ${b.anterior} y ${b.proxima}`)), `a ${fmtM(Math.max(0, x.parada.m[x.ri] - b.m))} de la parada. `, h('span', { class: 'suave' }, SEGUIMIENTO + '.')) : h('p', { class: 'suave chico' }, 'Todavía no se ubica por dónde viene (puede no haber salido todavía). ' + SEGUIMIENTO + '.'))(dondeViene(x)),
        h('div', { class: 'chips-hora' }, x.arribos.slice(1).map(a => h('span', { class: 'btn mini', style: 'cursor:default' }, `${a.fuente === 'sitio' ? '' : '≈ '}${aHora(a.t % 1440)} · ${faltaTxt(a.falta)}`))),
        h('p', { class: 'chico ' + (x.arribos.every(a => a.fuente === 'sitio') ? 'bien-txt' : 'ojo-txt') }, 'Fuente del horario: ', h('strong', {}, [...new Set(x.arribos.map(a => fuenteTxt(a.fuente)))].join(' y ')), x.arribos.every(a => a.fuente === 'sitio') ? '' : ' (los marcados con ≈ son estimados; todavía no tengo el horario de Paraná Online para esa parada)'),
        h('button', { class: 'btn mini', onclick: () => irALinea(x.linea.id, x.sentido) }, 'Ver todos los horarios de la línea'))),
      sin.length ? h('details', {}, h('summary', { class: 'suave' }, `${sin.length} línea(s) cerca sin colectivos próximos`),
        h('ul', { class: 'lista' }, sin.map(x => h('li', { style: 'padding:6px 0' }, h('strong', {}, x.linea.nombre), ` · ${esIda(x.linea, x.sentido) ? 'Ida' : 'Vuelta'}`, h('small', {}, `${x.parada.nombre} (a ${fmtM(x.d)}) · ${x.hay ? 'ya pasaron todos los de hoy' : 'todavía no tengo sus horarios'}`))))) : null);
  };
  pintar();
  // se actualiza solo: cuenta regresiva cada 20 s y horarios nuevos cada 2 minutos
  let n = 0;
  const t = setInterval(() => {
    if (!resultado.isConnected) return clearInterval(t);
    if (document.querySelector('dialog[open]')) return;
    if (++n % 6 === 0) refrescarHorarios().then(pintar); else pintar();
  }, 20000);
}
