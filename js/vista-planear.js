// Pestaña "Planear": de dónde a dónde, a qué hora, y qué colectivo conviene.
import { h, toast, fmtM, hoyISO, ahoraMin, fechaLinda, poner } from './ui.js';
import { E, D, guardar, lugar, planillasListas, recordarLugar, cuandoLlega, tipoAuto } from './estado.js';
import { planificar, planificarRutas, opcionesDeViaje, tipoDeDia, aMin, aHora, NOMBRE_TIPO } from './motor.js';
import { abrirBuscador, miUbicacion } from './buscador.js';
import { iniciarViaje, iniciarRuta } from './vista-vivo.js';

let aqui = null; // ubicación actual (no se guarda)
const TIPOS = ['habil', 'sabado', 'domingo'];

function resolver(id) { return id === '__gps' ? aqui : lugar(id); }

export { tipoAuto }; // (vive en estado.js para que lo usen también el mapa en vivo y las líneas)

function selectorLugar(clave, etiqueta, repintar) {
  const sel = h('select', { 'aria-label': etiqueta, onchange: async () => {
    const v = sel.value;
    if (v === '__buscar') return abrirBuscador(etiqueta + ': buscar lugar', p => { E.plan[clave] = p.id === '__gps' ? (aqui = p, '__gps') : recordarLugar(p).id; guardar(); repintar(); });
    if (v === '__gps') { try { aqui = await miUbicacion(); } catch (e) { toast(e.message); return repintar(); } }
    E.plan[clave] = v; guardar(); repintar();
  } },
  E.lugares.map(l => h('option', { value: l.id, selected: E.plan[clave] === l.id }, l.nombre)),
  h('option', { value: '__gps', selected: E.plan[clave] === '__gps' }, '📍 Mi ubicación actual'),
  h('option', { value: '__buscar' }, '🔎 Buscar otro lugar…'));
  return h('label', { class: 'campo' }, etiqueta, sel);
}

function tarjeta(v, clase, etiqueta, ctx) {
  const L = v.op.linea, aprox = x => (x ? '' : '~');
  const pasos = [
    v.op.minOrigen > 0 && h('li', {}, h('b', {}, aHora(v.tSalir)), h('span', {}, `Salí caminando hacia la parada (${v.op.minOrigen} min, ${fmtM(v.op.mOrigen)})`)),
    h('li', {}, h('b', {}, aHora(v.tParada)), h('span', {}, 'Estar en la parada ', h('strong', {}, v.op.sube.nombre), ` desde esta hora (puede pasar hasta ${E.cfg.adelanto} min antes)`)),
    h('li', {}, h('b', {}, aprox(v.subeExacto) + aHora(v.tSube)), h('span', {}, 'Horario en que pasa por tu parada')),
    ...v.refs.filter(r => r.t > v.tSube && r.t < v.tBaja).map(r => h('li', { class: 'ref' }, h('b', {}, aHora(r.t)), h('span', {}, r.nombre))),
    h('li', {}, h('b', {}, aprox(v.bajaExacto) + aHora(v.tBaja)), h('span', {}, 'Bajás en ', h('strong', {}, v.op.baja.nombre), v.op.minDestino ? ` y caminás ${v.op.minDestino} min (${fmtM(v.op.mDestino)})` : '')),
    h('li', {}, h('b', {}, aHora(v.tLlega)), h('span', {}, 'Llegás a ', h('strong', {}, ctx.destino.nombre), ctx.micro != null ? ` — ${ctx.micro - v.tLlega} min antes de las ${aHora(ctx.micro)}` : '')),
  ];
  return h('article', { class: 'viaje ' + clase },
    h('div', { class: 'cab' }, h('span', { class: 'etq' }, etiqueta), h('span', { class: 'lin' }, L.nombre), h('span', { class: 'suave chico' }, v.op.desc)),
    h('div', {}, h('div', { class: 'grande-hora' }, aHora(v.salida.t)), h('div', { class: 'suave' }, v.salida.enParada ? 'pasa por tu parada' : 'sale de ' + v.salida.nombre)),
    h('ul', { class: 'pasos' }, pasos),
    v.dudoso && h('p', { class: 'nota ojo chico' }, 'Este servicio sale de otra cabecera: no está confirmado que pase por tu parada ni a qué hora exacta.'),
    (!v.subeExacto || !v.bajaExacto) && h('p', { class: 'suave chico' }, `~ = hora estimada entre dos puntos ${v.fuente === 'sitio' ? 'de los horarios de Paraná Online' : 'de la planilla'}.`),
    h('p', { class: 'chico ' + (v.fuente === 'sitio' ? 'bien-txt' : 'ojo-txt') }, v.fuente === 'sitio' ? '✓ Horario publicado por Paraná Online' : '≈ Estimado con la planilla: todavía no tengo el horario de Paraná Online para este tramo'),
    h('button', { class: 'btn pri', onclick: () => iniciarViaje(v, ctx) }, 'Iniciar este viaje'));
}

/** Una ruta con varios colectivos, con horarios. */
function tarjetaRuta(r, ctx, etiqueta) {
  const sv = r.servicios, ult = sv.length - 1;
  const pasos = [];
  sv.forEach((v, i) => {
    if (i === 0 && v.op.minOrigen > 0) pasos.push(h('li', {}, h('b', {}, aHora(v.tSalir)), h('span', {}, `Salí caminando hacia la parada (${v.op.minOrigen} min, ${fmtM(v.op.mOrigen)})`)));
    pasos.push(h('li', {}, h('b', {}, (v.subeExacto ? '' : '~') + aHora(v.tSube)), h('span', {}, h('strong', {}, `Tomá la ${v.op.linea.nombre}`), ` en ${v.op.sube.nombre}` + (i === 0 ? ` (estar desde ${aHora(v.tParada)})` : ''), h('small', { class: 'suave', style: 'display:block' }, v.op.desc))));
    for (const x of v.refs.filter(x => x.t > v.tSube && x.t < v.tBaja)) pasos.push(h('li', { class: 'ref' }, h('b', {}, aHora(x.t)), h('span', {}, x.nombre)));
    const sig = sv[i + 1];
    pasos.push(h('li', {}, h('b', {}, (v.bajaExacto ? '' : '~') + aHora(v.tBaja)), h('span', {}, 'Bajate en ', h('strong', {}, v.op.baja.nombre),
      sig ? ` y caminá ${v.op.minDestino || 1} min (${fmtM(v.op.mDestino)}) hasta la parada ${sig.op.sube.nombre}; esperás ${Math.max(0, sig.tSube - v.tLlega)} min` : (v.op.minDestino ? ` y caminás ${v.op.minDestino} min (${fmtM(v.op.mDestino)})` : ''))));
  });
  pasos.push(h('li', {}, h('b', {}, aHora(r.tLlega)), h('span', {}, 'Llegás a ', h('strong', {}, ctx.destino.nombre), ctx.micro != null ? ` — ${ctx.micro - r.tLlega} min antes de las ${aHora(ctx.micro)}` : '')));
  const estimado = sv.some(v => v.fuente !== 'sitio');
  return h('article', { class: 'viaje rec' },
    h('div', { class: 'cab' }, h('span', { class: 'etq' }, etiqueta), ...sv.map(v => h('span', { class: 'lin' }, v.op.linea.nombre.replace('Línea ', ''))), h('span', { class: 'suave chico' }, `${sv.length} colectivos · ${r.tLlega - r.tSalir} min en total`)),
    h('div', {}, h('div', { class: 'grande-hora' }, aHora(r.tSalir)), h('div', { class: 'suave' }, 'hora de salir caminando')),
    h('ul', { class: 'pasos' }, pasos),
    h('p', { class: 'chico ' + (estimado ? 'ojo-txt' : 'bien-txt') }, estimado ? '≈ Algún tramo está estimado con la planilla: todavía no tengo ese horario de Paraná Online' : '✓ Horarios publicados por Paraná Online'),
    h('button', { class: 'btn pri', onclick: () => iniciarRuta(r, ctx) }, 'Iniciar este viaje'));
}

/** Combinación de colectivos posible pero sin horarios todavía. */
function resumenRuta(c) {
  return h('div', { class: 'nota' }, h('strong', {}, c.tramos.map(o => o.linea.nombre).join(' + ')),
    h('ol', { class: 'chico', style: 'margin:6px 0 0;padding-left:1.2em' }, c.tramos.map((o, i) => h('li', {}, `${o.linea.nombre}: subís en ${o.sube.nombre}${i === 0 && o.mOrigen ? ` (a ${fmtM(o.mOrigen)})` : ''}, bajás en ${o.baja.nombre}${i < c.tramos.length - 1 ? ` y caminás ${fmtM(o.mDestino)} a la próxima parada` : o.mDestino ? ` (a ${fmtM(o.mDestino)} del destino)` : ''}`))),
    h('p', { class: 'suave chico', style: 'margin:6px 0 0' }, `Unos ${Math.round(c.minutos)} min en total. Todavía no tengo los horarios de todos los tramos.`));
}

function avisoSinPlanilla(op, tipo) {
  const L = op.linea;
  return h('div', { class: 'nota' },
    h('strong', {}, `${L.nombre} también te sirve`), ` (${op.desc}): subís en ${op.sube.nombre}` + (op.minOrigen ? ` (a ${fmtM(op.mOrigen)})` : '') +
    `, bajás en ${op.baja.nombre}, a ${fmtM(op.mDestino)} del destino (${op.minDestino || 1} min a pie). Todavía no tengo los horarios de ${NOMBRE_TIPO[tipo]} de esa línea (se van sumando solos).`,
    h('div', { class: 'fila', style: 'margin-top:8px' },
      h('a', { class: 'btn mini', href: L.url, target: '_blank', rel: 'noopener' }, 'Paraná Online'),
      h('a', { class: 'btn mini', href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Cuándo llega')));
}

function bloque(res, ctx) {
  const out = [];
  if (ctx.modo === 'llegar') {
    if (res.recomendado) out.push(tarjeta(res.recomendado, 'rec', 'Recomendado', ctx));
    else if (res.viajes.length) out.push(h('div', { class: 'nota mal' }, h('strong', {}, 'Ningún colectivo te deja con ese margen. '),
      res.justo ? 'Mirá el "muy justo" de abajo o pedí un remis/Uber.' : 'Pedí un remis o un Uber.'));
    if (res.anterior) out.push(tarjeta(res.anterior, 'ant', 'El anterior (más holgado)', ctx));
    if (res.justo) out.push(tarjeta(res.justo, 'justo', 'Muy justo (sin margen)', ctx));
  } else {
    if (!res.proximos.length && res.viajes.length) out.push(h('div', { class: 'nota mal' }, 'No quedan colectivos desde esa hora. Pedí un remis o un Uber.'));
    res.proximos.forEach((v, i) => out.push(tarjeta(v, i ? 'ant' : 'rec', i ? 'Después' : 'Próximo', ctx)));
  }
  const [primera, ...resto] = res.sinPlanilla;
  if (primera) out.push(avisoSinPlanilla(primera, res.tipo));
  if (resto.length) out.push(h('details', {}, h('summary', { class: 'suave' }, `Otras ${resto.length} línea(s) que pasan cerca, todavía sin horarios`),
    h('div', { style: 'display:grid;gap:8px' }, resto.map(op => avisoSinPlanilla(op, res.tipo)))));
  return out;
}

export function vistaPlanear(raiz) {
  const repintar = () => vistaPlanear(raiz);
  const P = E.plan;
  if (!P.fecha || P.fecha < hoyISO()) P.fecha = hoyISO();
  if (P.margen == null) P.margen = E.cfg.margen;
  if (!resolver(P.origen)) P.origen = E.lugares[0].id;
  if (!resolver(P.destino)) P.destino = (E.lugares[1] || E.lugares[0]).id;
  const set = (k, v) => { P[k] = v; guardar(); repintar(); };

  const form = h('section', { class: 'panel' },
    h('div', { class: 'fila', style: 'align-items:end' },
      h('div', { class: 'crece', style: 'display:grid;gap:8px' }, selectorLugar('origen', 'Desde', repintar), selectorLugar('destino', 'Hasta', repintar)),
      h('button', { class: 'btn', title: 'Invertir', 'aria-label': 'Invertir origen y destino', onclick: () => { [P.origen, P.destino] = [P.destino, P.origen]; if (P.modo === 'llegar' && !P.hora) P.modo = 'salir'; guardar(); repintar(); } }, '⇅')),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo' },
      h('button', { 'aria-pressed': String(P.modo === 'llegar'), onclick: () => set('modo', 'llegar') }, 'Tengo que llegar a una hora'),
      h('button', { 'aria-pressed': String(P.modo === 'salir'), onclick: () => set('modo', 'salir') }, 'Salgo ahora / desde las…')),
    h('div', { class: 'dos' },
      h('label', { class: 'campo' }, 'Fecha', h('input', { type: 'date', value: P.fecha, min: hoyISO(), onchange: e => set('fecha', e.target.value || hoyISO()) })),
      h('label', { class: 'campo' }, P.modo === 'llegar' ? 'Sale mi micro (o tengo que estar)' : 'Desde las (vacío = ahora)', h('input', { type: 'time', value: P.hora, onchange: e => set('hora', e.target.value) }))),
    P.modo === 'llegar' && h('label', { class: 'campo' }, 'Quiero llegar con estos minutos de margen',
      h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 180, value: P.margen, onchange: e => set('margen', Math.max(0, +e.target.value || 0)) })),
    h('div', { class: 'campo' }, 'Horario que está corriendo',
      h('div', { class: 'seg', role: 'group' }, ['auto', ...TIPOS].map(t => h('button', { 'aria-pressed': String(P.tipo === t), onclick: () => set('tipo', t) }, t === 'auto' ? 'Según el día' : NOMBRE_TIPO[t][0].toUpperCase() + NOMBRE_TIPO[t].slice(1))))));

  const salida = h('div', { style: 'display:grid;gap:12px' });
  poner(raiz, form, salida);

  const origen = resolver(P.origen), destino = resolver(P.destino);
  if (!origen || !destino) return;
  if (origen === destino) { salida.append(h('p', { class: 'nota' }, 'Elegí un destino distinto del origen.')); return; }
  const micro = P.modo === 'llegar' ? aMin(P.hora) : null;
  if (P.modo === 'llegar' && micro == null) { salida.append(h('p', { class: 'nota' }, 'Poné a qué hora sale tu micro (o a qué hora tenés que estar) y te digo qué colectivo tomar.')); return; }

  const planillas = planillasListas(), horarios = D.horarios?.lineas || null;
  const opciones = opcionesDeViaje(D.lineas, origen, destino, E.cfg);
  const sinDirecto = !opciones.length;
  const auto = tipoAuto(P.fecha);
  const principal = P.tipo === 'auto' ? auto.tipo : P.tipo;
  // tipos de día con algún horario: del sitio, o de las planillas si está permitido usarlas
  const conPlanilla = TIPOS.filter(t => opciones.some(o => horarios?.[o.linea.id]?.[t] || (E.cfg.usarPlanillas !== false && planillas.some(p => p.tipo === t && p.linea === o.linea.id))));
  const hoy = P.fecha === hoyISO();
  const ctx = { modo: P.modo, micro, destino, origen, fecha: P.fecha };
  let directoOk = false, directos = () => [];
  const calc = tipo => planificar({ lineas: D.lineas, planillas, horarios, origen, destino, tipo, cfg: E.cfg,
    ...(P.modo === 'llegar' ? { limite: micro - P.margen, tope: micro } : { desde: aMin(P.hora) ?? (hoy ? ahoraMin() : 0) }) });

  salida.append(h('p', { class: 'suave' }, `${fechaLinda(P.fecha)}: ` + (P.tipo === 'auto' ? `tomo horario ${NOMBRE_TIPO[auto.tipo]} porque ${auto.motivo}.` : `elegiste horario ${NOMBRE_TIPO[principal]}.`) +
    (P.modo === 'llegar' ? ` Tenés que estar a las ${aHora(micro - P.margen)}.` : '')));

  if (sinDirecto) {
    salida.append(h('div', { class: 'nota ojo' }, h('strong', {}, 'Ninguna línea une esos dos puntos directo. '),
      `Busqué paradas hasta ${fmtM(E.cfg.radioOrigen)} del origen y ${fmtM(E.cfg.radioDestino)} del destino (se cambia en Ajustes). Abajo te armo el viaje combinando colectivos.`));
  } else if (conPlanilla.includes(principal)) {
    const resP = calc(principal);
    salida.append(h('h2', { class: 'sec' }, `Con horario ${NOMBRE_TIPO[principal]}`), ...bloque(resP, ctx));
    directoOk = !!resP.recomendado;
    directos = () => resP.viajes.filter(v => (P.modo === 'llegar' ? true : v.tSube >= (aMin(P.hora) ?? (hoy ? ahoraMin() : 0))));
  } else {
    salida.append(h('div', { class: 'nota ojo' }, h('strong', {}, `Todavía no tengo horarios de ${NOMBRE_TIPO[principal]} para estas líneas. `),
      conPlanilla.length ? 'Te muestro las opciones con los otros tipos de día; fijate cuál está corriendo.' : 'Los voy juntando solos de Paraná Online: en unos días van a estar completos.'),
    ...(conPlanilla.length ? [] : calc(principal).sinPlanilla.map(op => avisoSinPlanilla(op, principal))));
  }
  for (const t of conPlanilla.filter(t => t !== principal)) {
    const res = calc(t), cuerpo = bloque({ ...res, sinPlanilla: [] }, ctx);
    const resumen = P.modo === 'llegar'
      ? (res.recomendado ? `sale ${aHora(res.recomendado.salida.t)}, estar en la parada ${aHora(res.recomendado.tParada)}` : 'ninguno llega a tiempo')
      : (res.recomendado ? `próximo: pasa ${aHora(res.recomendado.tSube)}` : 'no quedan servicios');
    salida.append(h('details', { class: 'panel', open: !conPlanilla.includes(principal) },
      h('summary', {}, `Si en realidad corre horario ${NOMBRE_TIPO[t]}: ${resumen}`), ...cuerpo));
  }
  // ---- con trasbordo: más de un colectivo (abierto solo si en directo no hay nada) ----
  const cuerpoT = h('div', { style: 'display:grid;gap:10px' });
  let hecho = false;
  const llenarT = () => {
    if (hecho) return; hecho = true;
    cuerpoT.replaceChildren(h('p', { class: 'suave' }, 'Buscando combinaciones…'));
    setTimeout(() => {
      const r = planificarRutas({ lineas: D.lineas, planillas, horarios, origen, destino, tipo: principal, cfg: E.cfg, directos: directos(),
        ...(P.modo === 'llegar' ? { limite: micro - P.margen } : { desde: aMin(P.hora) ?? (hoy ? ahoraMin() : 0) }) });
      poner(cuerpoT,
        ...r.rutas.map((x, i) => tarjetaRuta(x, ctx, i ? 'Otra opción' : P.modo === 'llegar' ? 'Recomendado' : 'La más rápida')),
        r.rutas.length ? null : h('p', { class: 'nota ojo' }, r.descartadas ? 'Con trasbordo no llegás antes que yendo directo.' : r.sinHorario.length ? 'Hay combinaciones, pero ninguna tiene horarios que sirvan para ese momento todavía.' : 'Ninguna combinación de hasta 3 colectivos une esos dos puntos.'),
        r.sinHorario.length ? h('details', {}, h('summary', { class: 'suave' }, `${r.sinHorario.length} combinación(es) más, sin horarios todavía`), h('div', { style: 'display:grid;gap:8px;margin-top:8px' }, r.sinHorario.slice(0, 6).map(resumenRuta))) : null);
    }, 20);
  };
  const detT = h('details', { class: 'panel', open: !directoOk }, h('summary', {}, directoOk ? 'También con trasbordo (más de un colectivo)' : 'Con trasbordo (más de un colectivo)'), cuerpoT);
  detT.addEventListener('toggle', () => { if (detT.open) llenarT(); });
  if (!directoOk) llenarT();
  salida.append(detT);
  salida.append(h('p', { class: 'suave chico' }, 'Si no sabés qué horario corre, mirá las dos opciones y andá a la parada para la más temprana. ',
    h('a', { href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Ver el colectivo en tiempo real'), '.'));
}
