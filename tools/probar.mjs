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
  ok(!s.recomendado && s.sinPlanilla.length > 0, 'sábado: sin planilla');
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

console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
