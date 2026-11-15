// Pestaña "En viaje": pasos con cuenta regresiva, "Ya subí", avisos de bajada por GPS (o por horario).
import { h, $, toast, fmtM, hoyISO, gmapsAPie, mapa, confirmar, poner } from './ui.js';
import { E, guardar, linea, cuandoLlega } from './estado.js';
import { aHora, dist } from './motor.js';

const ORDEN = { nada: 0, prep: 1, timbre: 2, bajar: 3, caminando: 4, fin: 5 };
const R = { fix: null, gpsError: '', watch: null, lock: null, audio: null, reloj: null, alarma: null, silenciada: {}, raiz: null };

// ---------- crear / terminar ----------
export function iniciarViaje(v, ctx) {
  const corta = s => ({ n: s.n, nombre: s.nombre, lat: s.lat, lon: s.lon });
  E.viaje = {
    id: Date.now(), fecha: ctx.fecha, linea: v.op.linea.id, lineaNombre: v.op.linea.nombre, sentido: v.op.sentido, ri: v.op.ri, desc: v.op.desc,
    sube: corta(v.op.sube), baja: corta(v.op.baja),
    origen: { nombre: ctx.origen.nombre }, destino: { nombre: ctx.destino.nombre, lat: ctx.destino.lat, lon: ctx.destino.lon },
    salida: v.salida, tSalir: v.tSalir, tParada: v.tParada, tSube: v.tSube, tBaja: v.tBaja, tLlega: v.tLlega,
    minOrigen: v.op.minOrigen, minDestino: v.op.minDestino, mDestino: v.op.mDestino,
    refs: v.refs.filter(r => r.t > v.tSube && r.t < v.tBaja), micro: ctx.micro ?? null,
    subeExacto: v.subeExacto, bajaExacto: v.bajaExacto, dudoso: v.dudoso,
    avisos: false, subiReal: null, bajeReal: null, etapa: 'nada',
  };
  guardar();
  location.hash = '#vivo';
  toast('Viaje guardado. Cuando salgas, activá los avisos.');
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
export function probarSonido() { SONIDO.timbre(); }

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
    p => { R.fix = { lat: p.coords.latitude, lon: p.coords.longitude, prec: p.coords.accuracy, ts: Date.now() }; R.gpsError = ''; evaluar(); },
    e => { R.gpsError = e.code === 1 ? 'Sin permiso de ubicación: aviso por horario.' : 'Sin señal de GPS: aviso por horario.'; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
const gpsOk = () => R.fix && Date.now() - R.fix.ts < 45000 && R.fix.prec <= 250;

export function activarAvisos() {
  if (!E.viaje) return;
  E.viaje.avisos = true; guardar();
  audio(); bip(880, .12, 0, .3);
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
function arrancarReloj() { if (!R.reloj) R.reloj = setInterval(() => { evaluar(); refrescar(); }, 1000); }

// ---------- avisos ----------
function pararAlarma() { clearInterval(R.alarma); R.alarma = null; }
function mostrarAlerta(etapa) {
  const V = E.viaje, el = $('#alerta'), porGps = gpsOk();
  const T = {
    prep: ['Preparate', `Falta poco para ${V.baja.nombre}. Andá acercándote a la puerta.`],
    timbre: ['¡TOCÁ EL TIMBRE!', `La próxima es ${V.baja.nombre}.`],
    bajar: ['BAJATE ACÁ', `${V.baja.nombre}. Después caminás ${V.minDestino} min hasta ${V.destino.nombre}.`],
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
    ...T.refs.filter(r => V.bajeReal == null || r.t < V.bajeReal).map(r => ({ t: r.t, txt: r.nombre, sub: 'punto de control de la planilla' })),
    { t: V.bajeReal ?? T.tBaja, txt: V.bajeReal != null ? 'Bajaste' : `Tocar timbre y bajar en ${V.baja.nombre}`, sub: V.bajeReal != null ? V.baja.nombre : 'te aviso antes con sonido y vibración', clave: 'baja' },
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

function refrescar() { // actualiza solo números que cambian cada segundo
  const V = E.viaje, raiz = R.raiz;
  if (!V || !raiz?.isConnected) return;
  const { L, iAhora, t } = pasos();
  const prox = L[iAhora], num = $('.cuenta .num', raiz), cap = $('.cuenta .cap', raiz), gps = $('#gps-linea', raiz);
  if (num && cap) {
    if (V.etapa === 'fin') { num.textContent = '✓'; cap.textContent = 'Llegaste'; }
    else if (!prox) { num.textContent = '✓'; cap.textContent = 'Ya pasaron todos los horarios'; }
    else { num.textContent = falta(prox.t - t); cap.textContent = `${prox.t >= t ? 'para' : 'desde'}: ${prox.txt} (${aHora(prox.t)})`; }
  }
  if (gps) {
    if (!V.avisos) gps.textContent = 'Avisos apagados.';
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
  const { L, iAhora, T } = pasos(), Lin = linea(V.linea), S = Lin?.sentidos[V.sentido];
  const otroDia = V.fecha !== hoyISO();
  const acciones = [];
  if (!V.avisos) acciones.push(h('button', { class: 'btn pri grande', onclick: () => { activarAvisos(); pintar(); } }, '🔔 Activar avisos, GPS y pantalla prendida'));
  if (V.subiReal == null) acciones.push(h('button', { class: 'btn grande' + (V.avisos ? ' pri' : ''), onclick: yaSubi }, '🚌 Ya subí'));
  else if (V.bajeReal == null) acciones.push(h('button', { class: 'btn grande', onclick: yaBaje }, 'Ya bajé'));
  if (V.etapa === 'caminando' || V.etapa === 'fin') acciones.push(h('a', { class: 'btn grande pri', href: gmapsAPie(V.destino), target: '_blank', rel: 'noopener' }, `🚶 Cómo llegar a pie a ${V.destino.nombre}`));

  poner(raiz, 
    h('section', { class: 'panel' },
      h('div', { class: 'fila' }, h('span', { class: 'lin' }, V.lineaNombre), h('strong', { class: 'crece' }, `${V.origen.nombre} → ${V.destino.nombre}`)),
      h('p', { class: 'suave' }, `Servicio que sale de ${V.salida.nombre} a las ${aHora(V.salida.t)} · ${V.desc}`),
      otroDia && h('p', { class: 'nota ojo' }, `Este viaje es para el ${V.fecha.split('-').reverse().join('/')}.`),
      V.dudoso && h('p', { class: 'nota ojo chico' }, 'Servicio dudoso: no está confirmado que pase por tu parada.'),
      h('div', { class: 'cuenta' }, h('div', { class: 'num' }, '…'), h('div', { class: 'cap suave' }, '')),
      ...acciones,
      h('p', { id: 'gps-linea', class: 'suave chico' }, ''),
      T.atraso ? h('p', { class: 'nota chico' }, `Horarios recalculados con ${Math.abs(T.atraso)} min de ${T.atraso > 0 ? 'atraso' : 'adelanto'}.`) : null),
    h('section', { class: 'panel' }, h('h2', {}, 'Pasos'),
      h('ol', { class: 'linea-tiempo', 'data-ahora': iAhora }, L.map((p, i) => h('li', { class: i < iAhora ? 'hecho' : i === iAhora ? 'ahora' : '' },
        h('span', { class: 'h' }, aHora(p.t)), h('span', { class: 'p' }), h('span', {}, p.txt, h('small', {}, p.sub)))))),
    S && h('section', { class: 'panel' }, h('h2', {}, 'Recorrido'),
      mapa({ rutas: [S.ramales[V.ri]?.pts || S.ramales[0].pts], paradas: S.paradas, marcas: [
        { ...V.sube, color: '#2563eb', texto: 'Subís' }, { ...V.baja, color: '#dc2626', texto: 'Bajás' }, { ...V.destino, color: '#16a34a', texto: V.destino.nombre.split(' ')[0] },
        ...(gpsOk() ? [{ ...R.fix, color: '#f59e0b', texto: 'Vos' }] : [])] }),
      h('div', { class: 'fila' },
        h('a', { class: 'btn mini', href: cuandoLlega, target: '_blank', rel: 'noopener' }, 'Colectivo en tiempo real'),
        h('a', { class: 'btn mini', href: gmapsAPie(V.destino), target: '_blank', rel: 'noopener' }, 'A pie desde donde estoy'))),
    h('button', { class: 'btn peligro', onclick: terminar }, 'Terminar viaje'));
  refrescar();
}

export function vistaVivo(raiz) {
  R.raiz = raiz;
  pintar();
  if (E.viaje) arrancarReloj();
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
