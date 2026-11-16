// Pestaña "En viaje": pasos con cuenta regresiva, "Ya subí", avisos de bajada por GPS (o por horario).
import { h, $, toast, fmtM, hoyISO, gmapsAPie, mapa, confirmar, poner } from './ui.js';
import { E, D, guardar, linea, cuandoLlega, calleListas, cargarCalles, busesAhora, busesParaMapa, LEYENDA_BUS, fuenteTxt } from './estado.js';
import { aHora, dist, proyectar } from './motor.js';

const ORDEN = { nada: 0, prep: 1, timbre: 2, bajar: 3, caminando: 4, fin: 5 };
const R = { mapaBox: null, fix: null, gpsError: '', watch: null, lock: null, audio: null, reloj: null, alarma: null, silenciada: {}, raiz: null };

// ---------- crear / terminar ----------
/** Datos de un tramo de viaje (un colectivo). destino = adónde se camina al bajar: el destino final o la parada del próximo colectivo. */
function armarTramo(v, ctx, origenNombre, destino) {
  const corta = s => ({ n: s.n, nombre: s.nombre, lat: s.lat, lon: s.lon });
  return {
    id: Date.now(), fecha: ctx.fecha, linea: v.op.linea.id, lineaNombre: v.op.linea.nombre, sentido: v.op.sentido, ri: v.op.ri, desc: v.op.desc,
    sube: corta(v.op.sube), baja: corta(v.op.baja),
    origen: { nombre: origenNombre }, destino: { nombre: destino.nombre, lat: destino.lat, lon: destino.lon },
    salida: v.salida, tSalir: v.tSalir, tParada: v.tParada, tSube: v.tSube, tBaja: v.tBaja, tLlega: v.tLlega,
    minOrigen: v.op.minOrigen, minDestino: v.op.minDestino, mDestino: v.op.mDestino,
    refs: v.refs.filter(r => r.t > v.tSube && r.t < v.tBaja), micro: ctx.micro ?? null,
    subeExacto: v.subeExacto, bajaExacto: v.bajaExacto, dudoso: v.dudoso,
    avisos: false, subiReal: null, bajeReal: null, etapa: 'nada', siguientes: [], tramo: { i: 1, de: 1 }, fuente: v.fuente || 'planilla',
  };
}

export function iniciarViaje(v, ctx) {
  E.viaje = armarTramo(v, ctx, ctx.origen.nombre, ctx.destino);
  guardar();
  location.hash = '#vivo';
  toast('Viaje guardado. Cuando salgas, activá los avisos.');
}

/** Viaje con trasbordo: r = una ruta de planificarRutas. Arranca con el primer colectivo y deja los otros para después. */
export function iniciarRuta(r, ctx) {
  const sv = r.servicios, n = sv.length;
  const tramos = sv.map((v, i) => {
    const sig = sv[i + 1];
    const dest = sig ? { nombre: `parada ${sig.op.sube.nombre} (para la ${sig.op.linea.nombre})`, lat: sig.op.sube.lat, lon: sig.op.sube.lon } : ctx.destino;
    const t = armarTramo(v, ctx, i ? sv[i - 1].op.baja.nombre : ctx.origen.nombre, dest);
    t.tramo = { i: i + 1, de: n }; t.id += i; t.micro = i === n - 1 ? ctx.micro ?? null : null;
    return t;
  });
  const [primero, ...resto] = tramos;
  E.viaje = { ...primero, siguientes: resto };
  guardar();
  location.hash = '#vivo';
  toast(`Viaje de ${n} colectivos guardado. Cuando salgas, activá los avisos.`);
}

/** Terminé un tramo y paso al próximo colectivo del viaje. */
function seguirTramo() {
  const V = E.viaje, [prox, ...resto] = V.siguientes || [];
  if (!prox) return;
  pararAlarma(); $('#alerta').hidden = true;
  E.viaje = { ...prox, siguientes: resto, avisos: V.avisos, id: prox.id };
  R.silenciada = {}; guardar(); pintar();
}

async function terminar() {
  if (!(await confirmar('¿Terminar este viaje y apagar los avisos?', 'Terminar'))) return;
  apagar(); E.viaje = null; guardar(); pintar();
}

// ---------- tiempo ----------
/** Minutos transcurridos desde las 0:00 del día del viaje (con decimales). */
function ahora() {
  const [y, m, d] = E.viaje.fecha.split('-').map(Number);
  return (Date.now() - new Date(y, m - 1, d).getTime()) / 60000;
}
/** Horarios corregidos con la hora real en que subí. */
function tiempos() {
  const V = E.viaje, atraso = V.subiReal != null ? Math.max(-20, Math.min(120, V.subiReal - V.tSube)) : 0;
  const tBaja = V.tBaja + atraso;
  const tLlega = V.bajeReal != null ? V.bajeReal + V.minDestino : V.tLlega + atraso;
  return { atraso: Math.round(atraso), tBaja, tLlega, refs: V.refs.map(r => ({ ...r, t: r.t + atraso })) };
}
function falta(min) {
  const s = Math.round(min * 60), a = Math.abs(s);
  const txt = a >= 3600 ? `${Math.floor(a / 3600)} h ${Math.floor(a % 3600 / 60)} min` : a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` : `${a} s`;
  return (s < 0 ? 'hace ' : '') + txt;
}

// ---------- sonido, vibración, pantalla ----------
function audio() {
  if (!R.audio) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; R.audio = new C(); }
  if (R.audio.state === 'suspended') R.audio.resume().catch(() => {});
  return R.audio;
}
function bip(frec, dur, cuando = 0, vol = 0.6) {
  if (!E.cfg.sonido) return; // por defecto los avisos solo vibran
  const c = audio(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + cuando;
  o.type = 'square'; o.frequency.value = frec;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
}
const SONIDO = {
  prep: () => { bip(660, .18); bip(880, .28, .24); navigator.vibrate?.([200, 100, 200]); },
  timbre: () => { for (let i = 0; i < 3; i++) bip(1047, .22, i * .3); navigator.vibrate?.([400, 150, 400, 150, 400]); },
  bajar: () => { [784, 988, 1175, 1568].forEach((f, i) => bip(f, .16, i * .17)); bip(1568, .5, .7); navigator.vibrate?.([700, 150, 700, 150, 1000]); },
};
/** Prueba: vibra ya y, a los 6 segundos, manda un aviso de prueba (para ver cómo se ve con otra app al frente). */
export async function probarSonido() {
  SONIDO.timbre();
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  const ok = 'Notification' in window && Notification.permission === 'granted';
  toast(ok ? 'En 6 segundos te mando un aviso de prueba: salí de la app para ver cómo aparece.' : 'Las notificaciones están bloqueadas: los avisos solo se ven con la app abierta. Activalas en los ajustes del teléfono.', 6000);
  if (ok) setTimeout(() => notificar('¡Tocá el timbre!', 'Esto es una prueba del aviso de bajada.', 'timbre'), 6000);
}

async function pantallaPrendida() {
  if (!('wakeLock' in navigator) || R.lock || document.visibilityState !== 'visible') return;
  try { R.lock = await navigator.wakeLock.request('screen'); R.lock.addEventListener('release', () => { R.lock = null; }); } catch { /* batería baja o sin permiso */ }
}
document.addEventListener('visibilitychange', () => { if (E.viaje?.avisos && document.visibilityState === 'visible') pantallaPrendida(); });

// ---------- GPS ----------
function gpsOn() {
  if (R.watch != null) return;
  if (!navigator.geolocation) { R.gpsError = 'Este dispositivo no tiene GPS: aviso por horario.'; return; }
  R.watch = navigator.geolocation.watchPosition(
    p => { R.fix = { lat: p.coords.latitude, lon: p.coords.longitude, prec: p.coords.accuracy, ts: Date.now() }; R.gpsError = ''; evaluar(); pintarMapa(); },
    e => { R.gpsError = e.code === 1 ? 'Sin permiso de ubicación: aviso por horario.' : 'Sin señal de GPS: aviso por horario.'; pintarMapa(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
const gpsOk = () => R.fix && Date.now() - R.fix.ts < 45000 && R.fix.prec <= 250;

export function activarAvisos() {
  if (!E.viaje) return;
  E.viaje.avisos = true; guardar();
  audio(); bip(880, .12, 0, .3);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  gpsOn(); pantallaPrendida();
  arrancarReloj();
}
function apagar() {
  if (R.watch != null) navigator.geolocation.clearWatch(R.watch);
  R.watch = null; R.fix = null;
  R.lock?.release().catch(() => {}); R.lock = null;
  clearInterval(R.reloj); R.reloj = null;
  pararAlarma(); $('#alerta').hidden = true;
}
function arrancarReloj() { let n = 0; if (!R.reloj) R.reloj = setInterval(() => { evaluar(); refrescar(); if (++n % 15 === 0) pintarMapa(); }, 1000); } // el mapa se repinta cada 15 s para mover los colectivos

// ---------- avisos ----------
const PATRON = { prep: [200, 100, 200], timbre: [400, 150, 400, 150, 400, 150, 400], bajar: [700, 150, 700, 150, 700, 150, 1000] };
/** Aviso del sistema (un cartelito arriba, aunque estés en otra app). Solo si la app no está a la vista. */
async function notificar(titulo, cuerpo, etapa) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  const op = { body: cuerpo, tag: 'ov-aviso', renotify: true, requireInteraction: etapa !== 'prep', vibrate: PATRON[etapa], icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(titulo, op); else new Notification(titulo, op);
  } catch { /* el navegador no deja mostrarla */ }
}
function pararAlarma() { clearInterval(R.alarma); R.alarma = null; }
function mostrarAlerta(etapa) {
  const V = E.viaje, el = $('#alerta'), porGps = gpsOk();
  const T = {
    prep: ['Preparate para bajar', `Falta poco para ${V.baja.nombre}.`],
    timbre: ['¡Tocá el timbre!', `La próxima es ${V.baja.nombre}.`],
    bajar: ['¡Bajate acá!', `${V.baja.nombre}. Después caminás ${V.minDestino} min.`],
  }[etapa];
  el.className = 'alerta ' + etapa;
  poner(el, h('h2', {}, T[0]), h('p', {}, T[1]),
    h('p', { class: 'chico' }, porGps ? `Estás a ${fmtM(dist(R.fix, V.baja))} de la parada (GPS).` : 'Aviso según el horario (sin GPS).'),
    etapa === 'bajar'
      ? h('button', { class: 'btn', onclick: yaBaje }, 'Ya bajé')
      : h('button', { class: 'btn', onclick: () => { R.silenciada[etapa] = true; pararAlarma(); el.hidden = true; } }, 'Entendido'));
  el.hidden = false;
  pararAlarma();
  SONIDO[etapa]();
  notificar(T[0], T[1], etapa);
  if (etapa !== 'prep') {
    let n = 0; const max = etapa === 'timbre' ? 14 : 12;
    R.alarma = setInterval(() => { if (++n >= max || E.viaje?.etapa !== etapa) return pararAlarma(); SONIDO[etapa](); }, etapa === 'timbre' ? 3000 : 2500);
  } else setTimeout(() => { if (E.viaje?.etapa === 'prep' && !R.silenciada.prep) el.hidden = true; }, 12000);
}
function ponerEtapa(e) {
  E.viaje.etapa = e; guardar();
  if (e === 'prep' || e === 'timbre' || e === 'bajar') mostrarAlerta(e);
  else { pararAlarma(); $('#alerta').hidden = true; }
  pintar();
}
function yaBaje() {
  const V = E.viaje; V.bajeReal = ahora(); ponerEtapa('caminando');
}
function yaSubi() {
  const V = E.viaje; V.subiReal = ahora();
  if (!V.avisos) activarAvisos();
  guardar(); pintar();
  const { atraso, tLlega } = tiempos();
  toast(atraso > 1 ? `Anotado: viene ${atraso} min atrasado. Llegás ~${aHora(tLlega)}.` : atraso < -1 ? `Anotado: pasó ${-atraso} min antes.` : 'Anotado: viene en horario.');
}

/** Decide en qué etapa de aviso estamos. Se llama cada segundo y con cada lectura de GPS. */
function evaluar() {
  const V = E.viaje; if (!V || !V.avisos) return;
  const cfg = E.cfg, t = ahora(), { tBaja } = tiempos();
  if (V.etapa === 'caminando') {
    if (gpsOk() && dist(R.fix, V.destino) < 60) ponerEtapa('fin');
    return;
  }
  if (V.etapa === 'fin') return;
  if (V.etapa === 'bajar') { // si no tocó "Ya bajé", lo doy por bajado solo
    if ((gpsOk() && dist(R.fix, V.baja) > 200) || t > tBaja + 6) { V.bajeReal = V.bajeReal ?? t; ponerEtapa('caminando'); }
    return;
  }
  if (V.subiReal == null && t < V.tSube - cfg.adelanto) return; // todavía no pudo haber subido
  let e = 'nada';
  if (gpsOk()) {
    const d = dist(R.fix, V.baja);
    if (d <= cfg.gpsBajar && R.fix.prec <= 120) e = 'bajar'; else if (d <= cfg.gpsTimbre) e = 'timbre'; else if (d <= cfg.gpsPreparate) e = 'prep';
  } else {
    const f = tBaja - t;
    if (f <= 0) e = 'bajar'; else if (f <= 1.5) e = 'timbre'; else if (f <= 4) e = 'prep';
  }
  if (ORDEN[e] > ORDEN[V.etapa]) ponerEtapa(e);
}

// ---------- pantalla ----------
function pasos() {
  const V = E.viaje, T = tiempos(), t = ahora(), subio = V.subiReal != null;
  const L = [
    V.minOrigen > 0 && { t: V.tSalir, txt: 'Salir caminando a la parada', sub: `${V.minOrigen} min hasta ${V.sube.nombre}` },
    { t: V.tParada, txt: 'Estar en la parada', sub: `${V.sube.nombre} · puede pasar desde esta hora` },
    { t: subio ? V.subiReal : V.tSube, txt: subio ? 'Subiste' : `Pasa el ${V.lineaNombre}`, sub: subio ? (T.atraso ? `${Math.abs(T.atraso)} min ${T.atraso > 0 ? 'después' : 'antes'} del horario (${aHora(V.tSube)})` : 'en horario') : `horario${V.subeExacto ? '' : ' estimado'} en tu parada`, clave: 'sube' },
    ...T.refs.filter(r => V.bajeReal == null || r.t < V.bajeReal).map(r => ({ t: r.t, txt: r.nombre, sub: V.fuente === 'sitio' ? 'parada con horario de Paraná Online' : 'punto de control de la planilla' })),
    { t: V.bajeReal ?? T.tBaja, txt: V.bajeReal != null ? 'Bajaste' : `Tocar timbre y bajar en ${V.baja.nombre}`, sub: V.bajeReal != null ? V.baja.nombre : 'te aviso antes con vibración', clave: 'baja' },
    { t: T.tLlega, txt: `Llegar a ${V.destino.nombre}`, sub: V.minDestino ? `${V.minDestino} min caminando (${fmtM(V.mDestino)})` : 'la parada está al lado' },
    V.micro != null && { t: V.micro, txt: 'Sale tu micro', sub: T.tLlega <= V.micro ? `llegás con ${Math.round(V.micro - T.tLlega)} min de margen` : '⚠ con este atraso no llegás' },
  ].filter(Boolean);
  let iAhora = L.findIndex(p => p.t > t);
  if (iAhora < 0) iAhora = L.length;
  const iSube = L.findIndex(p => p.clave === 'sube'), iBaja = L.findIndex(p => p.clave === 'baja');
  if (!subio && t >= V.tParada) iAhora = Math.min(iAhora, iSube); // sigo esperando aunque haya pasado la hora
  if (subio) iAhora = Math.max(iAhora, iSube + 1);
  if (V.bajeReal != null) iAhora = Math.max(iAhora, iBaja + 1);
  if (V.etapa === 'fin') iAhora = L.length;
  return { L, iAhora, T, t };
}

/** Mapa del recorrido con tu posición, y en qué parte del recorrido vas. Se repinta con cada lectura de GPS. */
function pintarMapa() {
  const V = E.viaje, box = R.mapaBox;
  if (!V || !box?.isConnected) return;
  const Lin = linea(V.linea), S = Lin?.sentidos[V.sentido];
  if (!S) return;
  const pts = S.ramales[V.ri]?.pts || S.ramales[0].pts, ri = S.ramales[V.ri] ? V.ri : 0;
  const bajaS = S.paradas[V.baja.n - 1];
  const ok = gpsOk(), pos = ok ? proyectar(pts, R.fix) : null, enRuta = pos && pos.fuera <= 250;
  const marcas = [{ ...V.sube, color: '#2563eb', texto: 'Subís' }, { ...V.baja, color: '#dc2626', texto: 'Bajás' }, { ...V.destino, color: '#16a34a', texto: V.destino.nombre.split(' ')[0] }];
  if (ok && pos.fuera < 8000) marcas.push({ ...R.fix, color: '#f59e0b', texto: 'Vos' });
  const info = [];
  if (!ok) info.push(h('span', { class: 'suave' }, R.gpsError || 'Buscando señal de GPS…'));
  else if (!enRuta) info.push(h('strong', {}, `Estás a ${fmtM(pos.fuera)} del recorrido`), h('span', { class: 'suave' }, V.subiReal == null ? 'Todavía no subiste al colectivo.' : 'Te alejaste del recorrido de la línea.'));
  else {
    const m = pos.m, hechas = S.paradas.filter(s => s.m[ri] != null && s.m[ri] <= m + 15), faltan = S.paradas.filter(s => s.m[ri] != null && s.m[ri] > m + 15);
    const ant = hechas.at(-1), prox = faltan[0], bm = bajaS?.m[ri];
    const hasta = bm != null ? bm - m : null;
    info.push(
      h('strong', {}, hasta != null && hasta < -80 ? 'Ya pasaste tu parada de bajada' : `Vas por ${ant ? ant.nombre : 'el comienzo del recorrido'}`),
      prox && h('span', {}, `Próxima parada: ${prox.nombre}`),
      hasta != null && hasta >= -80 && h('span', {}, `Faltan ${faltan.filter(s => s.n <= V.baja.n).length} paradas (${fmtM(Math.max(0, hasta))}) para bajar en ${V.baja.nombre}`));
  }
  if (!D.calles) { cargarCalles().catch(() => {}); calleListas.addEventListener('listas', pintarMapa, { once: true }); }
  const buses = busesAhora([V.linea]);   // los colectivos de esta línea, estimados con los horarios
  poner(box, mapa({ clave: 'viaje-' + V.id, calles: D.calles, rutas: [pts], paradas: S.paradas, marcas, buses: busesParaMapa(buses), leyenda: buses.length ? LEYENDA_BUS.map(([t, c]) => h('span', {}, h('i', { style: `background:${c}` }), t)) : null }), h('div', { class: 'posicion' }, ...info.filter(Boolean)));
}

function refrescar() { // actualiza solo números que cambian cada segundo
  const V = E.viaje, raiz = R.raiz;
  if (!V || !raiz?.isConnected) return;
  const { L, iAhora, t } = pasos();
  const prox = L[iAhora], num = $('.cuenta .num', raiz), cap = $('.cuenta .cap', raiz), gps = $('#gps-linea', raiz);
  if (num && cap) {
    if (V.etapa === 'fin') { num.textContent = '✓'; cap.textContent = V.siguientes?.length ? 'Llegaste a la parada del próximo colectivo' : 'Llegaste'; }
    else if (!prox) { num.textContent = '✓'; cap.textContent = 'Ya pasaron todos los horarios'; }
    else { num.textContent = falta(prox.t - t); cap.textContent = `${prox.t >= t ? 'para' : 'desde'}: ${prox.txt} (${aHora(prox.t)})`; }
  }
  if (gps) {
    if (!V.avisos) gps.textContent = gpsOk() ? `GPS ok (±${Math.round(R.fix.prec)} m). Avisos apagados.` : 'Avisos apagados.';
    else if (gpsOk()) {
      const obj = V.etapa === 'caminando' || V.etapa === 'fin' ? V.destino : V.baja;
      gps.textContent = `GPS ok (±${Math.round(R.fix.prec)} m). Estás a ${fmtM(dist(R.fix, obj))} de ${obj.nombre}.`;
    } else gps.textContent = R.gpsError || 'Buscando señal de GPS… mientras tanto aviso por horario.';
  }
  const marcado = $('.linea-tiempo', raiz)?.dataset.ahora;
  if (marcado != null && +marcado !== iAhora) pintar();
}

function pintar() {
  const raiz = R.raiz; if (!raiz?.isConnected) return;
  const V = E.viaje;
  document.querySelector('.tabs a[data-tab="vivo"]')?.classList.toggle('punto', !!V);
  if (!V) {
    poner(raiz, h('section', { class: 'panel' }, h('h2', {}, 'No hay ningún viaje en curso'),
      h('p', { class: 'suave' }, 'Planeá un viaje y tocá "Iniciar este viaje". Acá vas a ver los pasos con cuenta regresiva y el aviso para bajarte.'),
      h('a', { class: 'btn pri', href: '#planear' }, 'Planear un viaje')));
    return;
  }
  const { L, iAhora, T } = pasos();
  R.mapaBox = h('div', { class: 'mapa-vivo' });
  const otroDia = V.fecha !== hoyISO();
  const acciones = [];
  if (!V.avisos) acciones.push(h('button', { class: 'btn pri grande', onclick: () => { activarAvisos(); pintar(); } }, '🔔 Activar avisos, GPS y pantalla prendida'));
  if (V.subiReal == null) acciones.push(h('button', { class: 'btn grande' + (V.avisos ? ' pri' : ''), onclick: yaSubi }, '🚌 Ya subí'));
  else if (V.bajeReal == null) acciones.push(h('button', { class: 'btn grande', onclick: yaBaje }, 'Ya bajé'));
  if (V.etapa === 'caminando' || V.etapa === 'fin') acciones.push(h('a', { class: 'btn grande pri', href: gmapsAPie(V.destino), target: '_blank', rel: 'noopener' }, `🚶 Cómo llegar a pie a ${V.destino.nombre}`));
  if (V.siguientes?.length && (V.bajeReal != null || V.etapa === 'caminando' || V.etapa === 'fin')) acciones.push(h('button', { class: 'btn grande' + (V.etapa === 'fin' ? ' pri' : ''), onclick: seguirTramo }, `➡️ Ya estoy en la parada: seguir con la ${V.siguientes[0].lineaNombre}`));

  poner(raiz, 
    h('section', { class: 'panel' },
      V.tramo?.de > 1 && h('p', { class: 'nota chico' }, `Colectivo ${V.tramo.i} de ${V.tramo.de}` + (V.siguientes?.length ? `. Después: ${V.siguientes.map(s => s.lineaNombre).join(' → ')}.` : '.')),
      h('div', { class: 'fila' }, h('span', { class: 'lin' }, V.lineaNombre), h('strong', { class: 'crece' }, `${V.origen.nombre} → ${V.destino.nombre}`)),
      h('p', { class: 'suave' }, `Servicio que sale de ${V.salida.nombre} a las ${aHora(V.salida.t)} · ${V.desc}`),
      otroDia && h('p', { class: 'nota ojo' }, `Este viaje es para el ${V.fecha.split('-').reverse().join('/')}.`),
      V.fuente && h('p', { class: 'suave chico' }, 'Fuente de los horarios: ', h('strong', {}, fuenteTxt(V.fuente)), V.fuente === 'sitio' ? '' : ' (estimado)'),
      V.dudoso && h('p', { class: 'nota ojo chico' }, 'Servicio dudoso: no está confirmado que pase por tu parada.'),
      h('div', { class: 'cuenta' }, h('div', { class: 'num' }, '…'), h('div', { class: 'cap suave' }, '')),
      ...acciones,
      R.mapaBox,
      h('p', { id: 'gps-linea', class: 'suave chico' }, ''),
      T.atraso ? h('p', { class: 'nota chico' }, `Horarios recalculados con ${Math.abs(T.atraso)} min de ${T.atraso > 0 ? 'atraso' : 'adelanto'}.`) : null),
    h('section', { class: 'panel' }, h('h2', {}, 'Pasos'),
      h('ol', { class: 'linea-tiempo', 'data-ahora': iAhora }, L.map((p, i) => h('li', { class: i < iAhora ? 'hecho' : i === iAhora ? 'ahora' : '' },
        h('span', { class: 'h' }, aHora(p.t)), h('span', { class: 'p' }), h('span', {}, p.txt, h('small', {}, p.sub)))))),
    h('section', { class: 'panel' },
      h('div', { class: 'fila' },
        h('a', { class: 'btn mini', href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Colectivo en tiempo real'),
        h('a', { class: 'btn mini', href: gmapsAPie(V.destino), target: '_blank', rel: 'noopener' }, 'A pie desde donde estoy'))),
    h('button', { class: 'btn peligro', onclick: terminar }, 'Terminar viaje'));
  pintarMapa();
  refrescar();
}

export function vistaVivo(raiz) {
  R.raiz = raiz;
  pintar();
  if (E.viaje) { arrancarReloj(); gpsOn(); } // el GPS marca por dónde vas aunque no hayas activado los avisos
}

/** Al abrir la app con un viaje guardado: retoma GPS y reloj (el sonido necesita un toque). */
export function retomarViaje() {
  document.querySelector('.tabs a[data-tab="vivo"]')?.classList.toggle('punto', !!E.viaje);
  if (!E.viaje) return;
  if (E.viaje.fecha < hoyISO() && ahora() > E.viaje.tLlega + 180) { E.viaje = null; guardar(); return; } // viaje viejo
  arrancarReloj();
  if (E.viaje.avisos) {
    gpsOn(); pantallaPrendida();
    document.addEventListener('pointerdown', () => audio(), { once: true });
  }
}
