#!/usr/bin/env node
// Junta los horarios por parada que publica Paraná Online y arma con ellos los servicios de cada línea.
//
//   node tools/horarios.mjs                       toma una muestra de todas las líneas y regenera data/horarios.json
//   node tools/horarios.mjs --solo                no baja nada: solo regenera con lo ya juntado
//   node tools/horarios.mjs --bucle --minutos=340 --publicar   modo servidor: muestrea cada 5 min durante 5 h 40 min,
//                                                 sube los datos a GitHub cada hora y vuelve a lanzarse (ver el workflow)
//
// Qué muestra la página (medido el 15/11/2026, 7 lecturas con un minuto de diferencia): para cada parada, los horarios
// que pasan desde ahora y hasta unas 2 horas adelante; lo que ya pasó desaparece. Los horarios NO se mueven de una
// lectura a otra (son los programados, no una predicción con el GPS): lo único que cambia es que van entrando
// horarios nuevos al final de la ventana. Por eso alcanza con muestrear cada pocos minutos: cada horario se ve
// durante unas 2 horas. Las líneas urbanas traen el día completo en cada lectura.
//
// Cada muestra agrega lo que ve a data/horarios/crudo/<línea>.json, separado por tipo de día (hábil, sábado,
// domingo: el que la página dice que rige hoy). Con las lecturas de un día entero queda el horario completo de
// cada parada. Después se encadenan parada por parada, en el orden del recorrido, para reconstruir cada servicio
// (un colectivo de punta a punta), que es lo que usa la app (data/horarios.json).
// Además queda un historial por día (data/historial/AAAA-MM-DD.json) y un resumen para ver tendencias
// (data/historial/resumen.json): cuántos servicios tiene cada línea, primer y último horario, intervalo medio.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { indiceCalles, ubicarEnRecorrido, dist } from './geo.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(RAIZ, 'data'), CRUDO = path.join(DATA, 'horarios', 'crudo'), HISTORIAL = path.join(DATA, 'historial');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VENTANA = 115;        // minutos hacia adelante que la página muestra con seguridad (medido: unos 120)
const VENCE_DIAS = 24;      // un horario que no se vuelve a ver en este tiempo se da de baja (cambió la planilla)
const REFRESCO_DIAS = 6;    // cada cuánto se anota de nuevo que un horario sigue vigente (para no reescribir el archivo en cada muestra)

const dormir = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const limpiar = s => s.replace(/&#0?39;|&#8217;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const sinEtiqueta = s => s.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function bajar(url) {
  let ultimo;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { ultimo = e; await dormir(2000 * (i + 1)); }
  }
  throw new Error(`No se pudo bajar ${url}: ${ultimo.message}`);
}

/** Página de una línea -> { tipo de día que rige hoy, paradas: [{ pid, nombre, carteles: [{ cartel, horas[] en minutos }] }] } */
export function leerHorarios(html, completo = false) {
  const crudo = (html.match(/horarios-titulo horarios-([\w-]+)/) || [])[1] || '';
  const tipo = /dom|fer/.test(crudo) ? 'domingo' : /sab/.test(crudo) ? 'sabado' : crudo ? 'habil' : null;
  const paradas = [];
  for (const trozo of html.split(/<div class='parada-card'>/).slice(1)) {
    const b = trozo.match(/<button class='parada-btn'([^>]*)>\s*([^<]+?)\s*<\/button>/);
    const destino = b && (b[1].match(/data-target='([^']+)'/) || [])[1];
    if (!destino) continue;
    const urbana = /^horarios-(\d+)-(\d+)$/.exec(destino);          // urbanas: horarios-<servicio>-<parada>
    const pid = urbana ? urbana[2] : (destino.match(/-(\d+)$/) || [])[1];
    if (!pid) continue;
    const carteles = [];
    const cuerpo = trozo.slice(b.index + b[0].length);
    const bloques = cuerpo.includes("class='cartel-bloque'") ? cuerpo.split(/class='cartel-bloque'/).slice(1) : [cuerpo];
    for (const bl of bloques) {
      const cartel = urbana ? 's' + urbana[1] : limpiar((bl.match(/cartel-titulo'>([^<]*)</) || [])[1] || '');
      const horas = [...bl.matchAll(/class='hora-item'>\s*(\d{1,2}):(\d{2})\s*</g)].map(m => +m[1] * 60 + +m[2]);
      if (horas.length) carteles.push({ cartel, horas });
    }
    paradas.push({ pid, nombre: limpiar(b[2]), carteles });
  }
  return { tipo, paradas, completo };
}

/** Agrega una muestra al acumulado de una línea. Devuelve cuántos horarios nuevos aparecieron. */
export function acumular(crudo, muestra, fecha, minAhora) {
  const T = crudo.tipos[muestra.tipo] ||= { fechas: [], franjas: '0'.repeat(48), paradas: {} };
  let nuevos = 0, cambio = false;
  if (muestra.completo) {
    if (T.franjas !== '1'.repeat(48)) { T.franjas = '1'.repeat(48); cambio = true; }
    if (!T.fechas.includes(fecha)) { T.fechas.push(fecha); T.fechas = T.fechas.slice(-12); cambio = true; }
    for (const p of muestra.paradas) {
      const P = T.paradas[p.pid] ||= { n: p.nombre, c: {} };
      if (P.n !== p.nombre) { P.n = p.nombre; cambio = true; }
      for (const { cartel, horas } of p.carteles) {
        const nuevo = {};
        for (let h of horas) { if (h < 240) h += 1440; nuevo[h] = fecha; }
        const viejo = Object.keys(P.c[cartel] || {}).join(',');
        if (viejo !== Object.keys(nuevo).sort((a, b) => a - b).join(',')) { nuevos += Object.keys(nuevo).filter(k => !(P.c[cartel] || {})[k]).length; cambio = true; }
        else for (const k of Object.keys(nuevo)) nuevo[k] = P.c[cartel][k]; // sin cambios: conservo la fecha anterior (no reescribo el archivo)
        P.c[cartel] = nuevo;
      }
    }
    return { nuevos, cambio };
  }
  if (!T.fechas.includes(fecha)) { T.fechas.push(fecha); T.fechas = T.fechas.slice(-12); cambio = true; }
  // franjas de media hora que esta muestra cubre por completo
  const fr = [...T.franjas];
  for (let s = 0; s < 48; s++) if (s * 30 >= minAhora - 5 && s * 30 + 30 <= minAhora + VENTANA && fr[s] !== '1') { fr[s] = '1'; cambio = true; }
  T.franjas = fr.join('');
  for (const p of muestra.paradas) {
    const P = T.paradas[p.pid] ||= { n: p.nombre, c: {} };
    if (P.n !== p.nombre) { P.n = p.nombre; cambio = true; }
    for (const { cartel, horas } of p.carteles) {
      const C = P.c[cartel] ||= {};
      for (let h of horas) {
        if (h < 240 && minAhora > 720) h += 1440;               // 00:20 visto a la noche: sigue siendo el servicio de hoy
        if (h < minAhora - 30 || h > minAhora + 200) continue;   // fuera de lo que la página puede estar mostrando
        const visto = C[h];
        if (!visto) { C[h] = fecha; nuevos++; cambio = true; }
        else if (dias(visto, fecha) >= REFRESCO_DIAS) { C[h] = fecha; cambio = true; }
      }
    }
  }
  return { nuevos, cambio };
}

/**
 * Reconstruye los servicios de un cartel: recorre las paradas en el orden del recorrido y une cada horario
 * con el servicio que venía de la parada anterior (el más cercano que no se pase de velocidad razonable).
 */
export function encadenar(nodos) {
  const viajes = [];
  nodos.forEach((nd, k) => {
    const usados = new Set();
    for (const t of nd.horas) {
      let mejor = null;
      for (const v of viajes) {
        if (usados.has(v)) continue;
        const km = (nd.m - v.m) / 1000, salto = t - v.t;
        if (salto < km * 0.7 - 1.5 || salto > 3 + km * 7) continue;     // ni más de ~75 km/h ni menos de ~8 km/h
        const error = Math.abs(salto - km * 3);                           // lo esperable: unos 20 km/h
        if (!mejor || error < mejor.error) mejor = { v, error };
      }
      if (mejor) { mejor = mejor.v; mejor.celdas[k] = t; mejor.t = t; mejor.m = nd.m; usados.add(mejor); }
      else { const v = { t, m: nd.m, celdas: { [k]: t } }; viajes.push(v); usados.add(v); }
    }
  });
  return viajes.filter(v => Object.keys(v.celdas).length >= 2)
    .map(v => nodos.map((_, k) => v.celdas[k] ?? null))
    .sort((a, b) => a.find(x => x != null) - b.find(x => x != null));
}

/** Un servicio es creíble si sus horarios no retroceden y no hace falta más de ~85 km/h para cumplirlos (si no, se mezclaron dos colectivos). */
/** ¿Puede el mismo colectivo pasar por la parada a (hora ta, metro ma) y después por la b? */
function compatibles(ta, ma, tb, mb) {
  const dt = tb - ta, km = (mb - ma) / 1000;
  if (dt < -1 || (km > 0.5 && dt <= 0)) return false;                      // no retrocede en el tiempo
  if (dt > 0 && km > 0.4 && km / dt * 60 > 85) return false;              // no vuela (más de 85 km/h)
  if (dt > 3 + Math.max(0, km) * 7) return false;                         // ni se arrastra (menos de ~8 km/h)
  return true;
}

/**
 * Limpia un servicio: si alguna parada quedó mal ubicada (o es de otro colectivo), saca SOLO esas celdas y se queda
 * con la secuencia más larga de paradas que el mismo colectivo puede cumplir. Antes se descartaba el servicio entero,
 * y así se perdían colectivos en el mapa.
 */
export function depurar(fila, nodos) {
  const idx = fila.map((t, k) => (t != null ? k : -1)).filter(k => k >= 0);
  const n = idx.length, mejor = new Array(n).fill(1), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const a = idx[j], b = idx[i];
    if (mejor[j] + 1 > mejor[i] && compatibles(fila[a], nodos[a].m, fila[b], nodos[b].m)) { mejor[i] = mejor[j] + 1; prev[i] = j; }
  }
  let fin = 0; for (let i = 1; i < n; i++) if (mejor[i] > mejor[fin]) fin = i;
  const quedan = new Set(); for (let i = n ? fin : -1; i >= 0; i = prev[i]) quedan.add(idx[i]);
  return fila.map((t, k) => (quedan.has(k) ? t : null));
}

export function verosimil(fila, nodos) {
  const ps = fila.map((t, k) => (t != null ? [t, nodos[k].m] : null)).filter(Boolean);
  for (let i = 1; i < ps.length; i++) {
    const dt = ps[i][0] - ps[i - 1][0], km = (ps[i][1] - ps[i - 1][1]) / 1000;
    if (dt < -1 || (km > 0.5 && dt <= 0) || (dt > 0 && km > 0.4 && km / dt * 60 > 85)) return false;
  }
  return true;
}

const bonito = s => s.toLowerCase().replace(/(^|[\s.(])\p{L}/gu, c => c.toUpperCase()).replace(/\b(De|Del|Y|La|Las|Los|El)\b/g, w => w.toLowerCase()).replace(/^y /, 'Y ');

/**
 * Ubica una parada del sitio ("AV. DE LAS AMERICAS Y ALEJO PEIRET", o "CALLE A - CALLE B" en las urbanas) sobre un recorrido:
 * busca el cruce de esas dos calles y se queda con el que cae a ≤ 70 m del trazo. Devuelve { lat, lon, m (metros desde el comienzo) }.
 */
export function colocar(nombre, pts, geo, urbana = false) {
  const trozos = nombre.split(urbana ? /\s+-\s+/ : /\s+Y\s+/).map(x => x.trim()).filter(Boolean);
  // "RUTA PROVINCIAL 11 Y FACULTAD DE CIENCIA Y TECNOLOGIA" tiene más de un " Y ": pruebo cada corte posible
  for (let k = 1; k < trozos.length; k++) {
    const a = trozos.slice(0, k).join(urbana ? ' - ' : ' Y '), b = trozos.slice(k).join(urbana ? ' - ' : ' Y ');
    let mejor = null;
    for (const c of geo.cruces(a, b)) { const u = ubicarEnRecorrido(c, pts); if (u.d <= 70 && (!mejor || u.d < mejor.d)) mejor = { lat: c[0], lon: c[1], m: Math.round(u.m), d: u.d }; }
    if (mejor) return mejor;
  }
  return null;
}

/**
 * ¿El cartel nombra el destino de ese sentido? "[A CASA DE GOBIERNO]" con "Facultad → Casa de Gobierno" da +1;
 * si nombra el origen da -1. Ayuda a no confundir ida con vuelta cuando las paradas solas no alcanzan.
 */
function afinidad(cartel, S) {
  const pal = t => new Set(t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !['DEL', 'LAS', 'LOS', 'RAMAL', 'IDA', 'VUELTA'].includes(w)));
  // abreviaturas de los carteles: "C.GOB", "E.ALB", "S.BENITO", "COLONIAC.GOBIERNO"
  const c = cartel.replace(/^[|]$/g, '').toUpperCase()
    .replace(/C.s*GOB(IERNO)?/g, ' CASA GOBIERNO ').replace(/E.s*ALB(ERDI)?/g, ' ESCUELA ALBERDI ').replace(/S.s*BENITO/g, ' SAN BENITO ')
    .replace(/COL.s*/g, 'COLONIA ').replace(/s+/g, ' ').trim();
  // "FACULTAD A C.GOB" = de Facultad a Casa de Gobierno; "A ORO VERDE" / "AL INTA" = hacia ahí
  const m = /^(?:(.*?)s+)?AL?s+(.+)$/.exec(c);
  const origen = pal(m ? m[1] || '' : ''), destino = pal(m ? m[2] : c);
  const toca = (set, trozo) => [...pal(trozo)].some(w => set.has(w) || [...set].some(x => x.length >= 5 && (x.startsWith(w) || w.startsWith(x))));
  let v = 0;
  for (const d of [S.desc, ...S.ramales.map(r => r.desc)].filter(Boolean)) {
    const p = d.split(/s*(?:→|>)s*/);
    if (p.length < 2) continue;
    const ini = p[0], fin = p[p.length - 1];
    const x = (toca(destino, fin) ? 1 : 0) - (toca(destino, ini) ? 1 : 0) + (toca(origen, ini) ? 1 : 0) - (toca(origen, fin) ? 1 : 0);
    if (Math.abs(x) > Math.abs(v)) v = x;
  }
  return Math.max(-1, Math.min(1, v));
}

const VEL_ESTIMADA = 330;   // metros por minuto (~20 km/h) para pasar de una diferencia de horario a una distancia

/** Punto [lat, lon] a m metros del comienzo de un recorrido. */
function puntoEnRecorrido(pts, m) {
  let acum = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (acum + l >= m) { const t = l ? (m - acum) / l : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
    acum += l;
  }
  return pts[pts.length - 1];
}

/**
 * Para una parada que no se pudo ubicar por nombre (por ejemplo "AV. ALMAFUERTE Y UNIVERSIDAD TEC."): sus horarios son
 * los mismos de otra parada ya ubicada, corridos unos minutos (el colectivo tarda lo mismo todos los días). Busco esa
 * parada y ese corrimiento, y la pongo a esa distancia (a ~20 km/h). Es aproximado: solo mueve unos cientos de metros
 * la posición estimada del colectivo, no cambia ningún horario.
 */
export function colocarPorHorario(p, resueltos, largo) {
  let mejor = null;
  for (const r of resueltos) {
    const conjunto = new Set(r.horas);
    for (let d = -25; d <= 25; d++) {
      let coinciden = 0;
      for (const t of p.horas) if (conjunto.has(t - d)) coinciden++;
      if (coinciden >= Math.max(2, Math.ceil(p.horas.length * 0.6)) && (!mejor || coinciden > mejor.coinciden || (coinciden === mejor.coinciden && Math.abs(d) < Math.abs(mejor.d)))) mejor = { r, d, coinciden };
    }
  }
  if (!mejor) return null;
  const m = Math.max(0, Math.min(largo, mejor.r.m + mejor.d * VEL_ESTIMADA));
  return { m: Math.round(m), aprox: true };
}

/** Acumulado de una línea + su recorrido -> bloques de servicios por tipo de día. geo = índice de calles (para ubicar las paradas del sitio que el mapa no trae). */
export function derivar(crudo, linea, geo = null) {
  const out = {};
  for (const [tipo, T] of Object.entries(crudo.tipos)) {
    const ultima = [...T.fechas].sort().at(-1);
    // carteles: cada uno es un destino/ramal; junto sus paradas con horarios vigentes
    const porCartel = new Map();
    for (const [pid, P] of Object.entries(T.paradas)) for (const [cartel, C] of Object.entries(P.c)) {
      const horas = Object.entries(C).filter(([, visto]) => dias(visto, ultima) <= VENCE_DIAS).map(([h]) => +h).sort((a, b) => a - b);
      if (!horas.length) continue;
      const etiqueta = (P.n.match(/\[(IDA|VUELTA)\]/) || [])[1];
      if (!porCartel.has(cartel)) porCartel.set(cartel, []);
      porCartel.get(cartel).push({ pid, nombre: sinEtiqueta(P.n), sentido: etiqueta ? etiqueta.toLowerCase() : null, horas });
    }
    const bloques = [];
    for (const [cartel, paradas] of porCartel) {
      // a qué sentido y ramal del recorrido corresponde: el que ubica más paradas y deja los horarios en orden
      let mejor = null;
      const servicio = /^s(\d+)$/.exec(cartel)?.[1];                   // urbanas: el cartel es el servicio y ese es el sentido
      for (const [sentido, S] of Object.entries(linea.sentidos)) {
        if (servicio && sentido !== servicio) continue;
        const porClave = new Map(S.paradas.filter(s => s.web).map(s => [servicio && s.pid ? s.pid : s.web, s]));
        const clave = p => (servicio ? p.pid : p.nombre);
        const delSentido = paradas.filter(p => !p.sentido || p.sentido === sentido);
        S.ramales.forEach((R, ri) => {
          // paradas del sitio que son paradas del mapa
          const base = delSentido.filter(p => porClave.has(clave(p)))
            .map(p => ({ pid: p.pid, nombre: p.nombre, horas: p.horas, n: porClave.get(clave(p)).n, m: porClave.get(clave(p)).m[ri] })).filter(x => x.m != null);
          // las demás: las ubico por el cruce de calles sobre este recorrido (así no se pierde ningún horario que muestra el sitio)
          const extras = [];
          if (geo) for (const p of delSentido) {
            if (porClave.has(clave(p))) continue;
            const u = colocar(p.nombre, R.pts, geo, !!servicio);
            if (u) extras.push({ pid: p.pid, nombre: p.nombre, horas: p.horas, n: 1000 + extras.length, m: u.m, lat: u.lat, lon: u.lon, extra: true });
          }
          // el sentido y el ramal se eligen SOLO con las paradas ubicadas por su lugar (mapa o cruce de calles): si se
          // eligieran también con las ubicadas por horario, cualquier cartel "encajaría" en cualquier sentido
          const nodos = [...base, ...extras].sort((a, b) => a.m - b.m);
          if (nodos.length < 2) return;
          const filas = encadenar(nodos).map(f => depurar(f, nodos)).filter(f => f.filter(x => x != null).length >= 2);
          // puntaje: horarios que quedaron dentro de algún servicio de varias paradas
          const unidos = filas.reduce((s, f) => s + f.filter(x => x != null).length - 1, 0);   // tramos entre paradas consecutivas del mismo colectivo
          const puntaje = unidos + afinidad(cartel, S) * Math.max(10, unidos * 0.5);
          if (!mejor || puntaje > mejor.puntaje) mejor = { sentido, ramal: ri, R, delSentido, nodos, filas, unidos, puntaje };
        });
      }
      if (mejor) {
        // ya con el sentido elegido, sumo las paradas que solo se pueden ubicar por su horario y rearmo los servicios
        const extrasH = [];
        for (const p of mejor.delSentido) {
          if (mejor.nodos.some(x => x.pid === p.pid)) continue;
          const u = colocarPorHorario(p, mejor.nodos, mejor.R.largo || 1e9);
          if (u) { const [la, lo] = puntoEnRecorrido(mejor.R.pts, u.m); extrasH.push({ pid: p.pid, nombre: p.nombre, horas: p.horas, m: u.m, lat: la, lon: lo, extra: true, aprox: true }); }
        }
        if (extrasH.length) {
          let k = 1000 + mejor.nodos.filter(x => x.extra).length;
          for (const x of extrasH) x.n = k++;
          const nodos = [...mejor.nodos, ...extrasH].sort((a, b) => a.m - b.m);
          const filas = encadenar(nodos).map(f => depurar(f, nodos)).filter(f => f.filter(x => x != null).length >= 2);
          if (filas.reduce((s, f) => s + f.filter(x => x != null).length - 1, 0) >= mejor.unidos) { mejor.nodos = nodos; mejor.filas = filas; }
        }
      }
      if (!mejor || !mejor.filas.length) continue;
      const b = { cartel, sentido: mejor.sentido, ramal: mejor.ramal, paradas: mejor.nodos.map(x => x.n), filas: mejor.filas };
      const ex = mejor.nodos.filter(x => x.extra);
      // las paradas que no están en el mapa de la línea llevan su propio nombre y posición dentro del bloque (n >= 1000)
      if (ex.length) b.extras = ex.map(x => ({ n: x.n, nombre: bonito(x.nombre), lat: Math.round(x.lat * 1e5) / 1e5, lon: Math.round(x.lon * 1e5) / 1e5, m: x.m, ...(x.aprox ? { aprox: true } : {}) }));
      bloques.push(b);
    }
    if (bloques.length) out[tipo] = { fechas: T.fechas, franjas: T.franjas, bloques };
  }
  return out;
}

async function leerJson(f, def) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return def; } }
const hh = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** Hora y fecha en Argentina (UTC-3). */
function ahoraAR() {
  const ar = new Date(Date.now() - 3 * 3600e3);
  return { fecha: ar.toISOString().slice(0, 10), min: ar.getUTCHours() * 60 + ar.getUTCMinutes() };
}

/** Lee una línea y suma lo que ve a su acumulado. Devuelve { crudo, cambio, nuevos, tipo } o lanza error. */
async function muestrearLinea(L, fecha, min) {
  const archivo = path.join(CRUDO, L.id + '.json');
  const crudo = await leerJson(archivo, { linea: L.id, tipos: {} });
  const m = leerHorarios(await bajar(L.url), L.tipo === 'urbana');
  if (!m.tipo) throw new Error('la página no dice qué tipo de día rige');
  const conHoras = m.paradas.filter(p => p.carteles.length).length;
  const r = acumular(crudo, m, fecha, min);
  if (r.cambio) await fs.writeFile(archivo, JSON.stringify(crudo));
  return { ...r, tipo: m.tipo, conHoras, total: m.paradas.length };
}

/** Rearma data/horarios.json con los recorridos de data/lineas.json y todo lo acumulado. Devuelve el objeto. */
async function regenerar() {
  const { lineas } = JSON.parse(await fs.readFile(path.join(DATA, 'lineas.json'), 'utf8'));
  const salida = { generado: new Date().toISOString(), fuente: 'https://www.paranaonline.com.ar/colectivos-parana/', lineas: {} };
  const calles = await leerJson(path.join(DATA, 'calles.json'), null);
  const geo = calles ? indiceCalles(calles) : null;     // para ubicar las paradas del sitio que el mapa de la línea no trae
  for (const L of lineas) {
    const crudo = await leerJson(path.join(CRUDO, L.id + '.json'), { linea: L.id, tipos: {} });
    const d = derivar(crudo, L, geo);
    if (Object.keys(d).length) salida.lineas[L.id] = d;
  }
  const destino = path.join(DATA, 'horarios.json');
  const previo = await leerJson(destino, null);
  const cambio = !previo || JSON.stringify(previo.lineas) !== JSON.stringify(salida.lineas);
  if (cambio) await fs.writeFile(destino, JSON.stringify(salida));
  return { salida, cambio };
}

/**
 * Historial del día: copia de los servicios (con la hora aproximada de paso por cada parada) de los tipos de día
 * que se leyeron ese día, y un resumen por línea para comparar días entre sí.
 */
async function guardarHistorial(salida, fecha) {
  await fs.mkdir(HISTORIAL, { recursive: true });
  const dia = { fecha, generado: salida.generado, lineas: {} }, resumen = {};
  for (const [id, tipos] of Object.entries(salida.lineas)) for (const [tipo, T] of Object.entries(tipos)) {
    if (!T.fechas.includes(fecha)) continue;
    (dia.lineas[id] ||= {})[tipo] = T;
    const salidas = T.bloques.flatMap(b => b.filas.map(f => f.find(x => x != null))).filter(x => x != null).sort((a, b) => a - b);
    const huecos = salidas.slice(1).map((x, i) => x - salidas[i]).filter(x => x > 0);
    resumen[id] = { tipo, servicios: salidas.length, primera: salidas.length ? hh(salidas[0]) : null, ultima: salidas.length ? hh(salidas.at(-1)) : null,
      intervaloMedio: huecos.length ? Math.round(huecos.reduce((a, b) => a + b, 0) / huecos.length) : null, cobertura: Math.round([...T.franjas].filter(c => c === '1').length / 48 * 100) / 100 };
  }
  if (!Object.keys(dia.lineas).length) return;
  await fs.writeFile(path.join(HISTORIAL, fecha + '.json'), JSON.stringify(dia));
  const archivo = path.join(HISTORIAL, 'resumen.json');
  const res = await leerJson(archivo, { dias: {} });
  res.dias[fecha] = resumen;
  for (const f of Object.keys(res.dias).sort().slice(0, -400)) delete res.dias[f];
  await fs.writeFile(archivo, JSON.stringify(res));
}

const git = (...args) => new Promise(r => execFile('git', args, { cwd: RAIZ }, (e, out, err) => r({ ok: !e, out: String(out).trim(), err: String(err).trim() })));

/** Sube lo juntado a GitHub (solo si algo cambió). Pensado para correr dentro del workflow. */
async function publicar() {
  await git('config', 'user.name', 'actualizador-automatico');
  await git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  await git('add', 'data/horarios', 'data/horarios.json', 'data/historial', 'data/lineas.json', 'data/cambios.json');
  if ((await git('diff', '--cached', '--quiet')).ok) return false;
  await git('commit', '-q', '-m', 'Datos: horarios de Paraná Online');
  for (let i = 0; i < 3; i++) {
    await git('pull', '--rebase', '-q', '--autostash');
    const p = await git('push', '-q');
    if (p.ok) return true;
    await dormir(4000 * (i + 1));
  }
  log('No pude subir los datos (se reintenta en la próxima hora).');
  return false;
}

async function una(solo, lineasSolo) {
  const { lineas } = JSON.parse(await fs.readFile(path.join(DATA, 'lineas.json'), 'utf8'));
  await fs.mkdir(CRUDO, { recursive: true });
  const { fecha, min } = ahoraAR();
  // de madrugada la página ya muestra el día siguiente pero todavía circulan los últimos servicios de ayer: no muestreo
  const muestrear = !solo && min >= 235;
  if (!solo && !muestrear) log('Es de madrugada: no tomo muestra.');
  if (muestrear) for (const L of lineas) {
    if (lineasSolo.length && !lineasSolo.includes(L.id.toLowerCase())) continue;
    try {
      const r = await muestrearLinea(L, fecha, min);
      log(`✓ ${L.nombre}: ${r.tipo}, ${r.conHoras} de ${r.total} paradas con horarios, ${r.nuevos} horarios nuevos`);
    } catch (e) { log(`✗ ${L.nombre}: ${e.message}`); }
    await dormir(700);
  }
  const { salida, cambio } = await regenerar();
  await guardarHistorial(salida, fecha);
  log(cambio ? 'Escribí data/horarios.json' : 'Sin novedades en los servicios.');
  for (const [id, d] of Object.entries(salida.lineas)) for (const [tipo, t] of Object.entries(d))
    log(`  línea ${id} ${tipo}: ${t.bloques.map(b => `${b.cartel || '(sin cartel)'} → ${b.sentido}, ${b.paradas.length} paradas, ${b.filas.length} servicios`).join(' | ')}; franjas cubiertas ${[...t.franjas].filter(x => x === '1').length}/48`);
}

/**
 * Modo servidor: cada 5 minutos lee las líneas interurbanas (la página solo muestra ~2 horas hacia adelante) y cada
 * hora las urbanas (traen el día entero). Cada hora rearma los servicios, guarda el historial y sube todo a GitHub.
 */
async function bucle(minutos, publicarCambios) {
  const fin = Date.now() + minutos * 60e3;
  const PASO = 5 * 60e3;
  let tick = 0, ultimaSubida = Date.now(), recorridosDe = null;
  while (Date.now() < fin) {
    // una vez por día (después de las 4:30) se actualizan recorridos y paradas
    const hoyAR = ahoraAR();
    if (hoyAR.min >= 270 && recorridosDe !== hoyAR.fecha && !process.argv.includes('--sin-recorridos')) {
      recorridosDe = hoyAR.fecha;
      log('Actualizando recorridos y paradas…');
      const r = await new Promise(res => execFile(process.execPath, [path.join(RAIZ, "tools", "actualizar.mjs")], { cwd: RAIZ, timeout: 15 * 60e3, maxBuffer: 1 << 24 }, (e, out, err) => res({ ok: !e, out: String(out).trim().split(String.fromCharCode(10)).slice(-6).join(String.fromCharCode(10)), err: String(err).slice(-300) })));
      log(r.ok ? r.out : 'No pude actualizar los recorridos: ' + r.err);
    }
    const t0 = Date.now(), { lineas } = JSON.parse(await fs.readFile(path.join(DATA, 'lineas.json'), 'utf8'));
    await fs.mkdir(CRUDO, { recursive: true });
    const { fecha, min } = ahoraAR();
    if (min >= 235) {
      const urbanasTambien = tick % 12 === 0;
      let nuevos = 0, fallas = 0;
      for (const L of lineas) {
        if (L.tipo === 'urbana' && !urbanasTambien) continue;
        try { nuevos += (await muestrearLinea(L, fecha, min)).nuevos; } catch (e) { fallas++; log(`✗ ${L.nombre}: ${e.message}`); }
        await dormir(900);
      }
      log(`${fecha} ${hh(min)} · muestra ${tick}: ${nuevos} horarios nuevos${fallas ? `, ${fallas} líneas con error` : ''}`);
    } else log(`${fecha} ${hh(min)} · madrugada, sin muestra`);
    tick++;
    if (Date.now() - ultimaSubida >= 60 * 60e3 || Date.now() + PASO >= fin) {
      const { salida } = await regenerar();
      await guardarHistorial(salida, fecha);
      if (publicarCambios) log((await publicar()) ? 'Datos subidos a GitHub.' : 'Sin cambios para subir.');
      ultimaSubida = Date.now();
    }
    const resto = PASO - (Date.now() - t0);
    if (Date.now() + Math.max(resto, 0) < fin) await dormir(Math.max(resto, 1000)); else break;
  }
}

async function main() {
  const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').slice(n.length + 3);
  const lineasSolo = arg('lineas').split(',').filter(Boolean).map(x => x.toLowerCase());
  if (process.argv.includes('--bucle')) {
    await bucle(+arg('minutos') || 340, process.argv.includes('--publicar'));
    return;
  }
  await una(process.argv.includes('--solo'), lineasSolo);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
