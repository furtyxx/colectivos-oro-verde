#!/usr/bin/env node
// Pruebas de la lógica:  node tools/probar.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../js/motor.js';
import { PRECARGADAS, CFG_DEFECTO, MI_PARADA, TERMINAL } from '../js/datos.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { lineas } = JSON.parse(fs.readFileSync(path.join(raiz, 'data/lineas.json'), 'utf8'));
const calles = JSON.parse(fs.readFileSync(path.join(raiz, 'data/calles.json'), 'utf8')).calles;
const L = id => lineas.find(l => l.id === id);
const planillas = PRECARGADAS.map(p => ({ ...p, columnas: M.resolverColumnas(L(p.linea), p.nombres, p.vueltaDesde) }));
const cfg = structuredClone(CFG_DEFECTO);

let fallas = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fallas++; };
const h = M.aHora;

console.log('Horas');
ok(M.aMin('5:10') === 310 && M.aMin('23.05') === 1385 && M.aMin('x') === null, 'aMin');
ok(h(310) === '5:10' && h(1445) === '0:05', 'aHora');
ok(JSON.stringify(M.filaAMin(['23:50', '0:05'])) === '[1430,1445]', 'cruce de medianoche');

console.log('Planillas precargadas = pares que pasó el usuario');
const paresHabil = '5:10-5:46 5:40-6:17 6:00-6:37 6:20-7:01 6:40-7:21 7:40-8:21 8:01-8:42 8:26-9:07 8:51-9:32 9:16-9:57 9:41-10:22 10:06-10:47 10:31-11:12 10:56-11:37 11:17-11:58 11:38-12:19 11:59-12:40 12:20-13:01 12:45-13:24 13:11-13:50 13:37-14:16 14:03-14:42 14:28-15:07 14:53-15:32 15:18-15:57 15:43-16:22 16:04-16:45 16:25-17:06 16:46-17:27 17:07-17:48 17:28-18:09 17:49-18:30 18:10-18:51 18:31-19:12 18:52-19:33 19:13-19:54 19:38-20:16 20:08-20:46 21:08-21:44 22:08-22:44 23:05-23:39';
const paresDom = '6:00-6:34 7:42-8:16 8:42-9:18 9:42-10:18 10:42-11:18 11:42-12:18 12:42-13:18 13:42-14:18 14:42-15:18 15:40-16:16 16:38-17:14 17:38-18:14 18:33-19:09 19:28-20:02 20:31-21:05 21:17-21:49 22:30-23:00';
for (const [pl, pares] of [[planillas[0], paresHabil], [planillas[1], paresDom]]) {
  const iF = pl.columnas.findIndex(c => c.sentido === 'ida' && c.punto === 'facultad'), iC = pl.columnas.findIndex(c => c.sentido === 'ida' && c.punto === 'cruzsur');
  const mios = pl.filas.filter(f => f[iF] != null).map(f => h(f[iF]) + '-' + h(f[iC])).join(' ');
  ok(mios === pares, `${pl.nombre}: ${pl.filas.length} filas, pares Facultad–Cruz Sur idénticos`);
  const dudas = M.validarPlanilla(pl.filas);
  ok(dudas.size === 0, `${pl.nombre}: validación sin celdas sospechosas` + (dudas.size ? ' -> ' + [...dudas].map(([k, v]) => k + ' ' + v).join(' | ') : ''));
  const sinParada = pl.columnas.filter(c => !c.parada).map(c => c.nombre + '(' + c.sentido + ')');
  console.log('    columnas sin parada en el mapa:', sinParada.join(', ') || 'ninguna');
}

console.log('Validador detecta errores de lectura');
{
  const filas = structuredClone(planillas[1].filas);
  filas[7][4] = M.aMin('14:48'); // 14:18 mal leído
  filas[3][9] = M.aMin('10:14'); // 10:44 mal leído
  const d = M.validarPlanilla(filas);
  ok(d.has('7,4') && d.has('3,9'), `marca las 2 celdas alteradas (${d.size} avisos)`);
}

console.log('Caso pedido: domingo, micro 15:10, margen 20');
{
  const micro = M.aMin('15:10');
  const r = M.planificar({ lineas, planillas, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', limite: micro - 20, tope: micro, cfg });
  const v = r.recomendado;
  console.log(`    recomendado: sale Facultad ${h(v.salida.t)}, en parada desde ${h(v.tParada)}, pasa ${h(v.tSube)}, baja ${h(v.tBaja)} en ${v.op.baja.nombre}, terminal ${h(v.tLlega)} (camina ${v.op.minDestino} min, ${v.op.mDestino} m)`);
  ok(h(v.salida.t) === '13:42' && v.salida.nombre === 'Facultad', 'recomendado: el de 13:42');
  ok(h(v.tSube) === '13:47' && h(v.tParada) === '13:37', 'en mi esquina 13:47, estar desde 13:37');
  ok(v.refs.some(x => x.nombre === 'Américas y Cruz Sur' && h(x.t) === '14:18'), 'Cruz Sur 14:18');
  ok(v.op.baja.nombre === 'Adolfo Alsina y Luis Agote' && h(v.tBaja) === '14:20', 'baja en Alsina y Luis Agote 14:20');
  ok(h(v.tLlega) === '14:34', 'terminal 14:34');
  ok(r.anterior && h(r.anterior.salida.t) === '12:42', 'anterior: 12:42');
  ok(r.justo === null, 'no hay "muy justo" (el de 14:42 llega 15:34, después del micro)');
  ok(r.sinPlanilla.some(o => o.linea.id === '15' && o.mDestino < 150), 'avisa que la línea 15 deja a <150 m de la terminal pero no tiene planilla');
}
{
  const micro = M.aMin('15:10');
  const r = M.planificar({ lineas, planillas, origen: MI_PARADA, destino: TERMINAL, tipo: 'habil', limite: micro - 20, tope: micro, cfg });
  console.log(`    (si corriera hábil) recomendado ${h(r.recomendado.salida.t)} → terminal ${h(r.recomendado.tLlega)}; anterior ${h(r.anterior.salida.t)}; justo ${r.justo ? h(r.justo.salida.t) + ' → ' + h(r.justo.tLlega) : '—'}`);
  ok(h(r.recomendado.salida.t) === '13:37' && h(r.recomendado.tLlega) === '14:32', 'hábil: 13:37 → terminal 14:32');
  ok(r.justo && h(r.justo.salida.t) === '14:03' && h(r.justo.tLlega) === '14:58', 'hábil: muy justo 14:03 → 14:58');
}
{
  const r = M.planificar({ lineas, planillas, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', limite: M.aMin('6:30'), tope: M.aMin('6:50'), cfg });
  ok(!r.recomendado && !r.justo, 'si ninguno llega (micro 6:50 de domingo) no recomienda nada → remis');
  const s = M.planificar({ lineas, planillas, origen: MI_PARADA, destino: TERMINAL, tipo: 'sabado', limite: 900, cfg });
  const v = s.recomendado;
  console.log(`    sábado, llegar 15:00: línea ${v?.op.linea.id}, sale ${v && h(v.salida.t)} de ${v?.salida.nombre}, pasa ${v && h(v.tSube)} por ${v?.op.sube.nombre}, baja ${v && h(v.tBaja)} en ${v?.op.baja.nombre}, llega ${v && h(v.tLlega)}`);
  ok(v && v.op.linea.id === '15' && /Ruiz Moreno/.test(v.op.baja.nombre) && v.op.minDestino <= 3 && v.tLlega <= 900, 'sábado: usa la planilla de la línea 15 y deja a 2 min de la terminal');
  ok(h(v.tBaja) === '14:14' || (v.tBaja > v.tSube && v.tBaja - v.tSube < 40), 'sábado: tiempos de la 15 razonables');
  ok(s.sinPlanilla.some(o => o.linea.id === '6'), 'sábado: avisa que la línea 6 no tiene planilla de sábado');
}

console.log('Servicios que salen de Esc. Alberdi (hábiles 7:00 y 7:20)');
{
  const op = M.opcionesDeViaje(lineas, MI_PARADA, TERMINAL, cfg).find(o => o.linea.id === '6');
  const vs = M.viajesDeOpcion(op, planillas[0], cfg).filter(v => v.salida.nombre === 'Esc Alberdi');
  ok(vs.length === 2 && vs.every(v => v.dudoso) && h(vs[0].tSube) === '7:05' && h(vs[0].tBaja) === '7:43', `quedan marcados como dudosos: ${vs.map(v => h(v.tSube) + '→' + h(v.tBaja)).join(', ')}`);
}

console.log('Vuelta a casa (Terminal → mi parada)');
{
  const r = M.planificar({ lineas, planillas, origen: TERMINAL, destino: MI_PARADA, tipo: 'habil', desde: M.aMin('18:00'), cfg });
  const v = r.recomendado;
  console.log(`    sube en ${v.op.sube.nombre} (${v.op.mOrigen} m) ${h(v.tSube)} → baja ${v.op.baja.nombre} ${h(v.tBaja)}; línea ${v.op.linea.id} ${v.op.sentido}`);
  ok(v.op.sentido === 'vuelta' && v.tSube >= M.aMin('18:00') && v.tBaja > v.tSube && v.tBaja - v.tSube < 45, 'encuentra servicio de vuelta con tiempos razonables');
}

console.log('Otros destinos');
{
  const dest = M.buscarEsquinas(calles, 'Urquiza', 'Corrientes')[0];
  ok(!!dest, 'esquina Urquiza y Corrientes: ' + (dest ? `${dest.nombre} (${dest.lat}, ${dest.lon})` : 'no encontrada'));
  const ops = M.opcionesDeViaje(lineas, MI_PARADA, dest, cfg);
  console.log('    opciones:', ops.map(o => `L${o.linea.id} ${o.sentido}: baja ${o.baja.nombre} (${o.mDestino} m, ${o.minDestino} min)`).join(' | '));
  ok(['6', '15'].every(id => ops.some(o => o.linea.id === id)) && ops.every(o => o.sentido === 'ida' && o.mOrigen <= cfg.radioOrigen), 'ofrece 6 y 15 (y otras que pasen cerca de mi parada), todas hacia Paraná');
  ok(M.buscarParadas(lineas, 'alsina agote').length === 1, 'búsqueda de parada "alsina agote"');
  const c = M.coordsEnTexto('https://www.google.com/maps/place/x/@-31.7335,-60.5297,17z');
  ok(c && c.lat === -31.7335 && c.lon === -60.5297, 'coordenadas dentro de un link de Google Maps');
  ok(M.tipoDeDia('2026-11-15').tipo === 'domingo' && M.tipoDeDia('2026-11-14').tipo === 'sabado' && M.tipoDeDia('2026-11-16').tipo === 'habil' && M.tipoDeDia('2026-12-25').tipo === 'domingo', 'tipo de día');
}

console.log('Columnas leídas de una foto');
{
  const nombres = ['Faculta d', 'Esc Alberdi', 'KM 5 1/2', 'La Virgen', 'América a y Cruz Sur', 'Plaza Alberd i', 'Laprida y Córdob a', 'Laprida y Cordob a', '25 de mayo y 9 de julio', 'América s y Cruz Sur', 'La Virgen', 'KM 5 1/2', 'Esc Alberdi', 'Faculta d'];
  const cols = M.resolverColumnas(L('6'), nombres);
  ok(M.dondeVuelve(nombres) === 7, 'detecta dónde empieza la vuelta');
  ok(cols[0].punto === 'facultad' && cols[0].parada === 1 && cols[4].punto === 'cruzsur' && cols[4].sentido === 'ida' && cols[9].punto === 'cruzsur' && cols[9].sentido === 'vuelta' && cols[13].parada === 48, 'ubica Facultad y Cruz Sur con encabezados cortados');
}

console.log('Lector de fotos en el teléfono (palabras reconocidas de las dos planillas reales)');
{
  const T = await import('../js/tabla.js');
  ok(T.horaDeTexto('7:17') === '7:17' && T.horaDeTexto('1231') === '12:31' && T.horaDeTexto('717') === '7:17' && T.horaDeTexto('1O:O5') === '10:05' && T.horaDeTexto('25') === null && T.horaDeTexto('2026)') === null && T.horaDeTexto('1/2') === null && T.horaDeTexto('Ear') === null, 'reconoce horas y descarta lo que no lo es');
  const comparar = (tabla, ref) => {
    const r = T.resultadoDeTabla(tabla);
    let bien = 0, mal = 0, falta = 0, sobra = 0;
    for (let f = 0; f < Math.max(r.filas.length, ref.filas.length); f++) for (let c = 0; c < ref.nombres.length; c++) {
      const a = r.filas[f]?.[c] ?? null, b = ref.filas[f]?.[c] ?? null;
      if (a === b) { if (a != null) bien++; } else if (a == null) falta++; else if (b == null) sobra++; else mal++;
    }
    return { r, bien, mal, falta, sobra };
  };
  for (const [archivo, ref, tipo, vig] of [['palabras-habiles.json', PRECARGADAS[0], 'habil', '26/05/26'], ['palabras-domingo.json', PRECARGADAS[1], 'domingo', 'AGOSTO 2026']]) {
    const tabla = T.armarTabla(JSON.parse(fs.readFileSync(path.join(raiz, 'tools/muestras', archivo), 'utf8')));
    ok(tabla.linea === '6' && tabla.tipo === tipo && tabla.vigencia === vig, `${archivo}: título → línea ${tabla.linea}, ${tabla.tipo}, vigencia ${tabla.vigencia}`);
    ok(tabla.nombres.join('|') === ref.nombres.join('|'), `${archivo}: las ${tabla.nombres.length} paradas (columnas) con su nombre completo`);
    const cols = M.resolverColumnas(L('6'), tabla.nombres), colsRef = M.resolverColumnas(L('6'), ref.nombres, ref.vueltaDesde);
    ok(cols.every((c, i) => c.parada === colsRef[i].parada && c.sentido === colsRef[i].sentido) && M.dondeVuelve(tabla.nombres) === ref.vueltaDesde, `${archivo}: cada columna queda en la misma parada del recorrido que la planilla precargada (${cols.filter(c => c.parada).length} ubicadas), ida y vuelta separadas`);
    const uno = comparar(tabla, ref), total = ref.filas.flat().filter(x => x != null).length;
    console.log(`    1ª pasada: ${uno.bien} de ${total} horarios bien, ${uno.mal} mal, ${uno.falta} sin leer, ${uno.sobra} de más; en rojo para corregir: ${uno.r.sinFormato.length}`);
    ok(uno.mal === 0 && uno.sobra === 0 && uno.falta === uno.r.sinFormato.length && uno.falta <= 1, `${archivo}: ningún horario mal leído y lo que no se pudo leer queda marcado`);
    // 2ª pasada simulada: el relector devuelve la hora correcta solo en las celdas que tenían algo, y basura en las vacías
    const centro = (f, c) => `${Math.round(tabla.cols[c].cx)},${Math.round(tabla.filas[f].cy)}`;
    const verdad = new Map(); ref.filas.forEach((fila, f) => fila.forEach((m, c) => { if (m != null) verdad.set(centro(f, c), M.aHora(m)); }));
    await T.segundaPasada(tabla, caja => {
      for (const [k, v] of verdad) { const [x, y] = k.split(',').map(Number); if (x >= caja.left && x <= caja.left + caja.width && y >= caja.top && y <= caja.top + caja.height) return v.replace(':', ''); }
      return ['1', '11', ':1'][caja.left % 3]; // ruido típico de una celda vacía (pedacitos de la grilla)
    });
    const dos = comparar(tabla, ref);
    ok(dos.bien === total && dos.mal + dos.falta + dos.sobra === 0, `${archivo}: con la 2ª pasada quedan los ${total} horarios, sin inventar nada en las celdas vacías`);
    ok(dos.r.dudas.length === uno.falta && M.validarPlanilla(dos.r.filas).size === 0, `${archivo}: lo que costó leer queda en amarillo (${dos.r.dudas.length}) y la planilla es coherente`);
    // un relector que inventa la misma hora en todas las celdas vacías no logra meterla donde no encaja
    const t2 = T.armarTabla(JSON.parse(fs.readFileSync(path.join(raiz, 'tools/muestras', archivo), 'utf8')));
    await T.segundaPasada(t2, () => '111');
    const tres = comparar(t2, ref);
    console.log(`    relector tramposo ("1:11" en todas las vacías): ${tres.sobra} celdas inventadas de ${ref.filas.flat().filter(x => x == null).length} vacías, todas marcadas en amarillo`);
    ok(tres.sobra <= 5 && tres.mal === 0 && tres.r.dudas.length >= tres.sobra, `${archivo}: el control de orden frena casi todo lo inventado y lo que pasa queda en duda`);
  }
  // ---- otros formatos: línea 15 (título sin "LÍNEA", horas con cero adelante, imagen chica con marca de agua) ----
  const vocabulario = T.vocabularioDe(lineas.flatMap(l => Object.values(l.sentidos).flatMap(s => s.paradas.flatMap(p => [p.nombre, p.web || '']))));
  const marcadas = r => new Set([...r.dudas, ...r.sinFormato].map(d => d.fila + ',' + d.columna).concat([...M.validarPlanilla(r.filas).keys()]));
  const medir = (tabla, ref) => {
    const { r, bien, mal, falta, sobra } = comparar(tabla, ref), m = marcadas(r);
    let sinAviso = 0;
    for (let f = 0; f < ref.filas.length; f++) for (let c = 0; c < ref.nombres.length; c++) if ((r.filas[f]?.[c] ?? null) !== (ref.filas[f][c] ?? null) && !m.has(f + ',' + c)) sinAviso++;
    return { r, bien, mal, falta, sobra, sinAviso, avisos: m.size };
  };
  {
    const ref = PRECARGADAS.find(p => p.id === 'pre-15-habil'), total = ref.filas.flat().filter(x => x != null).length;
    const tabla = T.armarTabla(JSON.parse(fs.readFileSync(path.join(raiz, 'tools/muestras/palabras-l15-habiles.json'), 'utf8')), { vocabulario });
    const x = medir(tabla, ref);
    console.log(`    línea 15 hábiles (imagen nítida, una lectura): ${x.bien} de ${total} bien; título "${tabla.titulo}"; columnas: ${tabla.nombres.join(' | ')}`);
    ok(x.bien === total && x.mal + x.falta + x.sobra === 0, 'línea 15 hábiles: los 180 horarios, con horas escritas "04:50"');
    ok(tabla.tipo === 'habil' && tabla.linea === '' && M.adivinarLinea(lineas, tabla.nombres) === '15', 'línea 15 hábiles: el título no dice la línea y se deduce de las paradas');
    const cols = M.resolverColumnas(L('15'), tabla.nombres);
    ok(M.dondeVuelve(tabla.nombres) === 7 && cols.map(c => c.parada || 0).join(',') === '0,4,5,0,43,46,52,1,8,11,0,49,50,0', 'línea 15 hábiles: cada columna en su parada (Ramírez y Saraví / Ruiz Moreno = Terminal)');
  }
  {
    const ref = PRECARGADAS.find(p => p.id === 'pre-15-sabado'), total = ref.filas.flat().filter(x => x != null).length;
    const pasadas = JSON.parse(fs.readFileSync(path.join(raiz, 'tools/muestras/pasadas-l15-sabado.json'), 'utf8'));
    const tabla = T.armarTabla(pasadas, { vocabulario });
    const x = medir(tabla, ref);
    console.log(`    línea 15 sábados (imagen de 720 px con marca de agua, ${pasadas.length} lecturas): ${x.bien} de ${total} bien, ${x.mal} mal, ${x.falta} sin leer; marcadas para revisar ${x.avisos}; mal sin marcar ${x.sinAviso}`);
    console.log(`    columnas: ${tabla.nombres.join(' | ')}`);
    ok(tabla.linea === '15' && tabla.tipo === 'sabado' && tabla.celdas.length === 9 && tabla.nombres.length === 14, 'línea 15 sábados: línea, tipo de día y forma de la tabla');
    ok(x.bien >= 100 && x.sobra === 0, 'línea 15 sábados: al menos 100 de 108 horarios bien');
    ok(x.sinAviso === 0, 'línea 15 sábados: ningún horario mal queda sin marcar');
    ok(M.dondeVuelve(tabla.nombres) === 7 && M.resolverColumnas(L('15'), tabla.nombres).map(c => c.parada || 0).join(',') === '0,4,5,0,43,46,52,1,8,11,0,49,50,0', 'línea 15 sábados: cada columna en su parada');
    const una = medir(T.armarTabla(pasadas[0], { vocabulario }), ref);
    console.log(`    (la misma imagen con una sola lectura: ${una.bien} bien, ${una.mal} mal)`);
  }
  {
    // dos planillas en una imagen: la segunda desplazada hacia abajo, con su propio título
    const una = JSON.parse(fs.readFileSync(path.join(raiz, 'tools/muestras/palabras-domingo.json'), 'utf8'));
    const altoImg = Math.max(...una.map(p => p.y1)) + 60;
    const dos = [...una, ...una.map(p => ({ ...p, t: p.t === 'DOMINGO' ? 'SÁBADOS' : p.t, y0: p.y0 + altoImg, y1: p.y1 + altoImg }))];
    const ts = T.armarTablas(dos);
    ok(ts.length === 2 && ts[0].tipo === 'domingo' && ts[1].tipo === 'sabado' && ts.every(t => t.celdas.length === 17 && t.nombres.length === 14), 'una imagen con dos planillas (domingo y sábados) se separa en dos');
  }
  let tiro = false; try { T.armarTabla([{ t: 'hola', c: 90, x0: 0, y0: 0, x1: 10, y1: 10 }]); } catch { tiro = true; }
  ok(tiro, 'una imagen sin tabla de horarios da error en vez de una planilla vacía');
}

console.log('Horarios por parada de Paraná Online (todas las líneas)');
{
  // bloque de ejemplo armado con las paradas reales de una línea: 2 colectivos a ~20 km/h
  const armarBloque = (L, sentido, tipos, salidas, filtro = () => true) => {
    const S = L.sentidos[sentido], ps = S.paradas.filter((p, i) => p.m[0] != null && i % 4 === 0 && filtro(p));
    const filas = salidas.map(t0 => ps.map(p => Math.round(t0 + p.m[0] / 330)));
    return { sentido, ramal: 0, cartel: '', paradas: ps.map(p => p.n), filas, ps };
  };
  const completo = { franjas: '1'.repeat(48) };
  const L6 = L('6'), b6 = armarBloque(L6, 'ida', null, [M.aMin('16:00'), M.aMin('17:00')]);
  const horarios = { 6: { domingo: { franjas: '0'.repeat(45) + '111', bloques: [{ ...b6 }] } } };
  const cfg0 = { ...cfg, usarPlanillas: false };
  const solo = M.planificar({ lineas, planillas, horarios, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', desde: M.aMin('15:00'), cfg: cfg0 });
  const v6 = solo.viajes.filter(v => v.op.linea.id === '6');
  console.log(`    línea 6 con horarios del sitio: ${v6.map(v => h(v.tSube) + '→' + h(v.tBaja)).join(', ')}`);
  ok(v6.length === 2 && v6.every(v => v.fuente === 'sitio' && v.salida.enParada), 'los dos colectivos del sitio aparecen, marcados como "sitio"');
  ok(v6[1].tSube - v6[0].tSube === 60 && v6[0].tBaja > v6[0].tSube + 15, 'la hora en mi parada se acomoda entre las paradas que sí tienen horario (misma separación que las salidas)');
  ok(!solo.viajes.some(v => v.fuente === 'planilla'), 'sin permiso de planillas no usa planillas');
  const mezcla = M.planificar({ lineas, planillas, horarios, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', desde: M.aMin('15:00'), cfg: { ...cfg, usarPlanillas: true } });
  const dups = mezcla.viajes.filter(v => v.op.linea.id === '6' && v.fuente === 'planilla').filter(p => v6.some(s => Math.abs(s.tSube - p.tSube) <= 4));
  ok(mezcla.viajes.some(v => v.fuente === 'planilla') && dups.length === 0, 'las planillas completan lo que falta y no duplican lo que el sitio ya confirma');
  const full = M.planificar({ lineas, planillas, horarios: { 6: { domingo: { ...completo, bloques: [b6] } } }, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', desde: M.aMin('15:00'), cfg: { ...cfg, usarPlanillas: true } });
  ok(!full.viajes.some(v => v.op.linea.id === '6' && v.fuente === 'planilla'), 'con el día completo en el sitio, ya no se usan las planillas');
  ok(M.coberturaDe(horarios[6].domingo) === 3 / 48 && M.coberturaDe(undefined) === 0, 'cobertura del día: 3 de 48 franjas');

  // línea urbana (sentidos con el número de servicio), día completo
  const LA = L('A'), sentA = Object.keys(LA.sentidos)[0], SA = LA.sentidos[sentA];
  const bA = armarBloque(LA, sentA, null, [M.aMin('7:00'), M.aMin('9:00'), M.aMin('11:00')]);
  const ini = SA.paradas.find(p => p.n === bA.paradas[1]), fin = SA.paradas.find(p => p.n === bA.paradas.at(-2));
  const rA = M.planificar({ lineas, planillas: [], horarios: { A: { domingo: { ...completo, bloques: [bA] } } }, origen: ini, destino: fin, tipo: 'domingo', desde: M.aMin('8:30'), cfg: cfg0 });
  const vA = rA.proximos.find(v => v.op.linea.id === 'A');
  console.log(`    línea urbana A (${SA.desc}): ${vA ? `pasa ${h(vA.tSube)}, baja ${h(vA.tBaja)} en ${vA.op.baja.nombre}` : 'sin viajes'}`);
  ok(vA && vA.fuente === 'sitio' && vA.tSube >= M.aMin('9:00') && vA.tSube < M.aMin('9:20') && vA.op.sentido === sentA, 'una línea urbana funciona igual: el colectivo de las 9:00 pasa por la parada de subida a esa hora más lo que tarda en llegar');
  ok(rA.proximos.length <= 5 && Object.values(rA.proximos.reduce((a, v) => (a[v.op.linea.id] = (a[v.op.linea.id] || 0) + 1, a), {})).every(n => n <= 2), 'en "salir" muestra como mucho dos servicios por línea');
  ok(rA.proximos.every((v, i, a) => !i || a[i - 1].tLlega <= v.tLlega), '"salir" ordena por la hora de llegada, no por la de salida');
  ok(D_LINEAS_URBANAS(lineas) >= 10, 'hay al menos 10 líneas urbanas con recorrido');
}
function D_LINEAS_URBANAS(ls) { return ls.filter(l => l.tipo === 'urbana' && Object.values(l.sentidos).every(s => s.paradas.length >= 3 && s.paradas.every(p => p.m[0] != null))).length; }

console.log('Dónde voy en el recorrido (GPS)');
{
  const S = L('6').sentidos.ida, pts = S.ramales[0].pts, a = S.paradas[10], b = S.paradas[30];
  const pa = M.proyectar(pts, a), pb = M.proyectar(pts, b);
  ok(pa.fuera < 70 && pb.fuera < 70 && pb.m > pa.m + 1000, `una parada cae sobre el recorrido (a ${Math.round(pa.fuera)} m) y la siguiente va más adelante (${Math.round(pb.m - pa.m)} m)`);
  const lejos = M.proyectar(pts, { lat: a.lat, lon: a.lon - 0.3 });
  ok(lejos.fuera > 20000, 'un punto a 28 km del recorrido figura como "fuera"');
}

console.log('Colectivos estimados en el mapa y viajes con trasbordo');
{
  const S6 = L('6').sentidos.ida, pts6 = S6.ramales[0].pts;
  const largo = S6.ramales[0].largo, mitad = M.puntoEn(pts6, largo / 2), ini = M.puntoEn(pts6, 0), fin = M.puntoEn(pts6, largo + 500);
  ok(M.proyectar(pts6, mitad).fuera < 5 && Math.abs(M.proyectar(pts6, mitad).m - largo / 2) < 30, 'puntoEn: a mitad del recorrido cae sobre el recorrido, a la mitad');
  ok(M.dist(ini, { lat: pts6[0][0], lon: pts6[0][1] }) < 1 && M.dist(fin, { lat: pts6.at(-1)[0], lon: pts6.at(-1)[1] }) < 1, 'puntoEn: antes del comienzo y después del final queda en los extremos');
  ok(M.esIda(L('6'), 'ida') && !M.esIda(L('6'), 'vuelta') && M.esIda(L('A'), Object.keys(L('A').sentidos)[0]) && !M.esIda(L('A'), Object.keys(L('A').sentidos)[1]), 'sentidos: ida y vuelta tienen colores distintos (interurbanas y urbanas)');

  // un colectivo de la línea 6 que sale a las 16:00 y pasa por 12 paradas con horario
  const ps = S6.paradas.filter((p, i) => p.m[0] != null && i % 4 === 0);
  const bloque = { sentido: 'ida', ramal: 0, cartel: '', paradas: ps.map(p => p.n), filas: [ps.map(p => Math.round(M.aMin('16:00') + p.m[0] / 330))] };
  const hor = { 6: { domingo: { franjas: '1'.repeat(48), bloques: [bloque] } } };
  const medio = M.aMin('16:00') + Math.round(ps[Math.floor(ps.length / 2)].m[0] / 330);
  const b1 = M.busesEnVivo({ lineas, horarios: hor, tipo: 'domingo', ahora: medio });
  ok(b1.length === 1 && b1[0].ida && M.proyectar(pts6, b1[0]).fuera < 30 && Math.abs(M.proyectar(pts6, b1[0]).m - ps[Math.floor(ps.length / 2)].m[0]) < 400, `a las ${h(medio)} el colectivo está a mitad de recorrido (${b1[0] ? b1[0].anterior : '—'} → ${b1[0] ? b1[0].proxima : '—'})`);
  ok(M.busesEnVivo({ lineas, horarios: hor, tipo: 'domingo', ahora: M.aMin('15:30') }).length === 0 && M.busesEnVivo({ lineas, horarios: hor, tipo: 'domingo', ahora: M.aMin('23:50') }).length === 0, 'antes de salir y después de terminar no aparece');
  ok(M.busesEnVivo({ lineas, horarios: hor, tipo: 'habil', ahora: medio }).length === 0 && M.busesEnVivo({ lineas, horarios: hor, tipo: 'domingo', ahora: medio, ids: ['15'] }).length === 0, 'respeta el tipo de día y el filtro de líneas');
  const pasaMedianoche = { 6: { domingo: { franjas: '1'.repeat(48), bloques: [{ ...bloque, filas: [bloque.filas[0].map((t, i) => M.aMin('23:40') + Math.round(ps[i].m[0] / 330))] }] } } };
  ok(M.busesEnVivo({ lineas, horarios: pasaMedianoche, tipo: 'domingo', ahora: 20 }).length === 1, 'un servicio que cruza la medianoche sigue apareciendo a las 00:20');

  // trasbordo: busco dos puntos sin línea directa que se unan con dos colectivos
  const urb = lineas.filter(l => l.tipo === 'urbana');
  const puntos = urb.flatMap(l => Object.values(l.sentidos).flatMap(s => s.paradas.filter((_, i) => i % 9 === 0).map(p => ({ lat: p.lat, lon: p.lon, linea: l.id }))));
  let par = null;
  for (let i = 0; i < puntos.length && !par; i += 3) for (let j = i + 7; j < puntos.length && !par; j += 11) {
    const a = puntos[i], b = puntos[j];
    if (a.linea === b.linea || M.dist(a, b) < 3500 || M.opcionesDeViaje(lineas, a, b, cfg).length) continue;
    const r = M.rutasConTrasbordo({ lineas, origen: a, destino: b, cfg });
    if (r.length) par = { a, b, r };
  }
  ok(!!par, 'hay pares de lugares sin colectivo directo que se resuelven con trasbordo');
  if (par) {
    const r0 = par.r[0];
    console.log(`    ejemplo: ${r0.tramos.map(o => 'línea ' + o.linea.id + ' (' + o.sube.nombre + ' → ' + o.baja.nombre + ')').join('  +  ')}; ~${Math.round(r0.minutos)} min`);
    ok(par.r.every(x => x.tramos.length >= 2 && x.tramos.every((o, i) => o.baja.m[o.ri] > o.sube.m[o.ri] + 300 && (!i || (x.tramos[i - 1].linea.id !== o.linea.id && M.dist(x.tramos[i - 1].baja, o.sube) <= 300)))), 'cada tramo avanza en su recorrido, cambia de línea y la parada de trasbordo está a ≤ 300 m');
    ok(M.dist(par.a, r0.tramos[0].sube) <= cfg.radioOrigen && M.dist(par.b, r0.tramos.at(-1).baja) <= cfg.radioDestino, 'sube cerca del origen y baja cerca del destino');
    // con horarios completos inventados para esas dos líneas: el segundo colectivo sale después de que llegás
    const bloquesDe = (op, salidas) => { const S = op.linea.sentidos[op.sentido], ps = S.paradas.filter(p => p.m[op.ri] != null && (p.n % 2 === 0 || p.n === op.sube.n || p.n === op.baja.n)); return salidas.map(t0 => ({ sentido: op.sentido, ramal: op.ri, cartel: '', paradas: ps.map(p => p.n), filas: [ps.map(p => Math.round(t0 + p.m[op.ri] / 330))] })); };
    const horarios2 = {};
    for (const op of r0.tramos) { const salidas = [...Array(24)].map((_, k) => M.aMin('5:00') + k * 40); (horarios2[op.linea.id] ||= { domingo: { franjas: '1'.repeat(48), bloques: [] } }).domingo.bloques.push(...bloquesDe(op, salidas)); }
    const res = M.planificarRutas({ lineas, planillas: [], horarios: horarios2, origen: par.a, destino: par.b, tipo: 'domingo', desde: M.aMin('12:00'), cfg: { ...cfg, usarPlanillas: false } });
    const x = res.rutas[0];
    ok(x && x.servicios.length >= 2 && x.servicios.every((v, i) => !i || v.tSube >= x.servicios[i - 1].tLlega + 3) && x.tSalir >= M.aMin('12:00') && x.tLlega > x.tSalir, `encadena los horarios: sale ${x && h(x.tSalir)}, llega ${x && h(x.tLlega)}`);
    const dominado = M.planificarRutas({ lineas, planillas: [], horarios: horarios2, origen: par.a, destino: par.b, tipo: 'domingo', desde: M.aMin('12:00'), cfg: { ...cfg, usarPlanillas: false }, directos: [{ tSalir: x.tSalir + 5, tLlega: x.tLlega - 5 }] });
    ok(!dominado.rutas.some(r => r.tSalir === x.tSalir && r.tLlega === x.tLlega), 'si en directo salís después y llegás antes, no ofrece el trasbordo');
    const tarde = M.planificarRutas({ lineas, planillas: [], horarios: horarios2, origen: par.a, destino: par.b, tipo: 'domingo', limite: x.tLlega, cfg: { ...cfg, usarPlanillas: false } });
    ok(tarde.rutas.length && tarde.rutas.every(r => r.tLlega <= x.tLlega) && tarde.rutas[0].tSalir >= x.tSalir, 'en modo "llegar a una hora" toma el que sale más tarde y llega a tiempo');
  }
}

console.log('Solo colectivos que todavía no pasaron (hora actual)');
{
  const micro = M.aMin('15:10'), base = { lineas, planillas, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', limite: micro - 20, tope: micro, cfg };
  const temprano = M.planificar({ ...base, ahora: M.aMin('13:00') }), tarde = M.planificar({ ...base, ahora: M.aMin('13:50') });
  ok(temprano.recomendado && h(temprano.recomendado.salida.t) === '13:42', 'a las 13:00 el recomendado (pasa 13:47) todavía sirve');
  ok(!tarde.recomendado && !tarde.anterior && tarde.viajes.every(v => v.tSube >= M.aMin('13:50')), 'a las 13:50 el de las 13:47 ya pasó: no se ofrece ni él ni el anterior');
  const salir = M.planificar({ lineas, planillas, origen: MI_PARADA, destino: TERMINAL, tipo: 'domingo', desde: M.aMin('12:00'), ahora: M.aMin('14:30'), cfg });
  ok(salir.proximos.length > 0 && salir.proximos.every(v => v.tSube >= M.aMin('14:30')), 'en "salgo desde" con la hora actual 14:30 solo aparecen los que pasan después');
  const ayer = M.planificar({ ...base, ahora: null });
  ok(ayer.recomendado && h(ayer.recomendado.salida.t) === '13:42', 'para otro día (sin hora actual) se ven todos los servicios');
}

console.log('Próximos arribos en una parada');
{
  const S6 = L('6').sentidos.ida, ps = S6.paradas.filter((p, i) => p.m[0] != null && i % 3 === 0);
  const bloque = { sentido: 'ida', ramal: 0, cartel: '', paradas: ps.map(p => p.n), filas: ['16:00', '17:00', '18:00'].map(t0 => ps.map(p => Math.round(M.aMin(t0) + p.m[0] / 330))) };
  const hor = { 6: { domingo: { franjas: '1'.repeat(48), bloques: [bloque] } } };
  const parada = ps[Math.floor(ps.length / 2)], pasa = t0 => Math.round(M.aMin(t0) + parada.m[0] / 330);
  const base = { lineas, planillas: [], horarios: hor, tipo: 'domingo', punto: { lat: parada.lat, lon: parada.lon }, radio: 150, cfg: { ...cfg, usarPlanillas: false } };
  const x = M.arribosCerca({ ...base, ahora: pasa('16:00') + 5 }).find(r => r.linea.id === '6' && r.sentido === 'ida');
  console.log('    próximos en esa parada: ' + (x ? x.arribos.map(a => h(a.t) + ' (en ' + a.falta + ' min)').join(', ') : 'ninguno'));
  ok(x && x.arribos.length === 2 && x.arribos[0].t === pasa('17:00') && x.arribos[1].t === pasa('18:00') && x.arribos.every(a => a.fuente === 'sitio' && a.falta > 0), 'a las 16:xx + 5 min ya no figura el de las 16:00: aparecen el de las 17:00 y el de las 18:00, con cuánto falta');
  ok(x.d < 40 && x.parada.nombre === parada.nombre, 'toma la parada de ese recorrido más cercana al lugar');
  ok(!M.arribosCerca({ ...base, ahora: pasa('18:00') + 1 }).some(r => r.linea.id === '6' && r.arribos.length), 'después del último no queda ninguno');
  const lejos = M.arribosCerca({ ...base, punto: { lat: parada.lat - 0.1, lon: parada.lon - 0.1 } });
  ok(!lejos.some(r => r.linea.id === '6'), 'si el lugar está lejos de las paradas, no aparece la línea');
  const corto = M.arribosCerca({ ...base, ahora: pasa('16:00') - 200, horas: 1 }).find(r => r.linea.id === '6');
  ok(!corto || corto.arribos.every(a => a.falta <= 60), 'solo muestra los de las próximas horas pedidas');
}

console.log('Recolector de horarios de Paraná Online');
{
  const H = await import('./horarios.mjs');
  // página con el formato de las interurbanas (cartel por destino) y de las urbanas (servicio en el id)
  const inter = "<div class='horarios-titulo horarios-sabado'>x</div><div class='parada-card'> <button class='parada-btn' data-interurbano='1' data-target='horarios-ci-6-647' > 25 DE MAYO </button> <div id='x' class='parada-horarios'> <div class='cartel-bloque'><div class='cartel-titulo'>[A ORO VERDE]</div><span class='hora-item'>17:31</span> <span class='hora-item'>18:31</span> </div> <div class='cartel-bloque'><span class='cartel-titulo'>[A C.GOB]</span><span class='hora-item'>09:05</span></div> </div> </div>";
  const urbana = "<div class='horarios-titulo horarios-habil'>x</div><div class='parada-card'> <button class='parada-btn' data-target='horarios-3-508'> AV. ZANNI - CALLE 926 </button> <div id='y' class='parada-horarios'> <span class='hora-item'>07:00</span> <span class='hora-item'>00:10</span> </div> </div>";
  const a = H.leerHorarios(inter), u = H.leerHorarios(urbana, true);
  ok(a.tipo === 'sabado' && a.paradas[0].pid === '647' && a.paradas[0].carteles.length === 2 && a.paradas[0].carteles[0].horas.join() === '1051,1111', 'lee una parada interurbana: tipo de día, id y horarios por cartel');
  ok(u.tipo === 'habil' && u.paradas[0].pid === '508' && u.paradas[0].carteles[0].cartel === 's3' && u.completo, 'lee una parada urbana: el servicio queda como cartel');
  // acumulado: ventana de unas 2 horas y reemplazo en las urbanas
  const crudo = { linea: '6', tipos: {} };
  const r1 = H.acumular(crudo, a, '2026-11-15', 17 * 60);
  const T = crudo.tipos.sabado;
  ok(r1.nuevos === 2 && T.franjas.slice(34, 37) === '111' && T.franjas[33] === '0' && T.franjas[37] === '0', 'una lectura a las 17:00 guarda los 2 horarios de la ventana (el de las 9:05 queda afuera) y cubre las franjas de 17:00 a 18:30');
  const r2 = H.acumular(crudo, a, '2026-11-15', 17 * 60 + 5);
  ok(r2.nuevos === 0, 'la misma lectura de nuevo no suma nada');
  const cu = { linea: 'A', tipos: {} };
  H.acumular(cu, u, '2026-11-15', 600);
  ok(cu.tipos.habil.franjas === '1'.repeat(48) && Object.keys(cu.tipos.habil.paradas['508'].c.s3).join() === '420,1450', 'urbana: el día queda completo y el 00:10 cuenta como 24:10');
  const u2 = H.leerHorarios(urbana.replace("<span class='hora-item'>07:00</span>", "<span class='hora-item'>07:05</span>"), true);
  H.acumular(cu, u2, '2026-11-16', 700);
  ok(Object.keys(cu.tipos.habil.paradas['508'].c.s3).join() === '425,1450', 'urbana: si cambió el horario, el nuevo reemplaza al viejo');
  // armar servicios: dos colectivos que pasan por 3 paradas de la línea 6
  const S = L('6').sentidos.ida, ps = S.paradas.filter(p => p.web).filter((p, i) => i % 6 === 0).slice(0, 3);
  const c6 = { linea: '6', tipos: { domingo: { fechas: ['2026-11-15'], franjas: '1'.repeat(48), paradas: {} } } };
  ps.forEach((p, k) => { c6.tipos.domingo.paradas['p' + p.n] = { n: p.web, c: { '[IDA]': { [600 + k * 10]: '2026-11-15', [660 + k * 10]: '2026-11-15' } } }; });
  const der = H.derivar(c6, { ...L('6'), sentidos: { ida: { ...S, paradas: S.paradas.map(p => ({ ...p })) } } });
  const b = der.domingo?.bloques.find(x => x.sentido === 'ida');
  ok(b && b.filas.length === 2 && b.filas.every(f => f.filter(x => x != null).length === 3) && b.filas[0][0] === 600 && b.filas[1][2] === 680, 'dos colectivos separados por una hora se arman como dos servicios de 3 paradas');
}

console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
