#!/usr/bin/env node
// Junta los horarios por parada que publica Paraná Online y arma con ellos los servicios de cada línea.
//
//   node tools/horarios.mjs            toma una muestra de todas las líneas y regenera data/horarios.json
//   node tools/horarios.mjs --solo     no baja nada: solo regenera data/horarios.json con lo ya juntado
//
// Cómo funciona: la página de cada línea muestra, para cada parada, los colectivos que pasan en las próximas
// dos horas (y en las líneas urbanas, los de todo el día). Una tarea automática corre esto cada media hora:
// cada muestra agrega los horarios que ve a data/horarios/crudo/<línea>.json, separados por tipo de día
// (hábil, sábado, domingo: el que la página dice que rige hoy). Con un día entero de muestras de cada tipo
// queda el horario completo de cada parada. Después se encadenan los horarios parada por parada, en el orden
// del recorrido, para reconstruir cada servicio (un colectivo de punta a punta), que es lo que usa la app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(RAIZ, 'data'), CRUDO = path.join(DATA, 'horarios', 'crudo');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VENTANA = 100;        // minutos hacia adelante que la página muestra con seguridad
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

/** Acumulado de una línea + su recorrido -> bloques de servicios por tipo de día. */
export function derivar(crudo, linea) {
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
        const porNombre = new Map(S.paradas.filter(s => s.web).map(s => [servicio && s.pid ? s.pid : s.web, s]));
        const mias = paradas.filter(p => porNombre.has(servicio ? p.pid : p.nombre) && (!p.sentido || p.sentido === sentido))
          .map(p => ({ ...p, nombre: servicio ? p.pid : p.nombre }));
        S.ramales.forEach((_, ri) => {
          const nodos = mias.map(p => ({ ...p, n: porNombre.get(p.nombre).n, m: porNombre.get(p.nombre).m[ri] })).filter(x => x.m != null).sort((a, b) => a.m - b.m);
          if (nodos.length < 2) return;
          const filas = encadenar(nodos);
          // puntaje: horarios que quedaron dentro de algún servicio de varias paradas
          const unidos = filas.reduce((s, f) => s + f.filter(x => x != null).length, 0);
          if (!mejor || unidos > mejor.unidos) mejor = { sentido, ramal: ri, nodos, filas, unidos };
        });
      }
      if (!mejor || !mejor.filas.length) continue;
      bloques.push({ cartel, sentido: mejor.sentido, ramal: mejor.ramal, paradas: mejor.nodos.map(x => x.n), filas: mejor.filas });
    }
    if (bloques.length) out[tipo] = { fechas: T.fechas, franjas: T.franjas, bloques };
  }
  return out;
}

async function leerJson(f, def) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return def; } }

async function main() {
  const solo = process.argv.includes('--solo');
  const { lineas } = JSON.parse(await fs.readFile(path.join(DATA, 'lineas.json'), 'utf8'));
  await fs.mkdir(CRUDO, { recursive: true });
  const ar = new Date(Date.now() - 3 * 3600e3), fecha = ar.toISOString().slice(0, 10), minAhora = ar.getUTCHours() * 60 + ar.getUTCMinutes();
  // de madrugada la página ya muestra el día siguiente pero todavía circulan los últimos servicios de ayer: no muestreo
  const muestrear = !solo && minAhora >= 235;
  const lineasSolo = (process.argv.find(a => a.startsWith('--lineas=')) || '').slice(9).split(',').filter(Boolean).map(x => x.toLowerCase());
  if (!solo && !muestrear) log('Es de madrugada: no tomo muestra.');
  const salida = { generado: new Date().toISOString(), fuente: 'https://www.paranaonline.com.ar/colectivos-parana/', lineas: {} };
  let huboCambios = false;
  for (const L of lineas) {
    const archivo = path.join(CRUDO, L.id + '.json');
    const crudo = await leerJson(archivo, { linea: L.id, tipos: {} });
    if (muestrear && (!lineasSolo.length || lineasSolo.includes(L.id.toLowerCase()))) {
      try {
        const m = leerHorarios(await bajar(L.url), L.tipo === 'urbana');
        if (!m.tipo) throw new Error('la página no dice qué tipo de día rige');
        const conHoras = m.paradas.filter(p => p.carteles.length).length;
        const r = acumular(crudo, m, fecha, minAhora);
        log(`✓ ${L.nombre}: ${m.tipo}, ${conHoras} de ${m.paradas.length} paradas con horarios, ${r.nuevos} horarios nuevos`);
        if (r.cambio) { await fs.writeFile(archivo, JSON.stringify(crudo)); huboCambios = true; }
      } catch (e) { log(`✗ ${L.nombre}: ${e.message}`); }
      await dormir(700);
    }
    const d = derivar(crudo, L);
    if (Object.keys(d).length) salida.lineas[L.id] = d;
  }
  const destino = path.join(DATA, 'horarios.json');
  const previo = await leerJson(destino, null);
  if (!previo || JSON.stringify(previo.lineas) !== JSON.stringify(salida.lineas)) {
    await fs.writeFile(destino, JSON.stringify(salida));
    log('Escribí data/horarios.json');
  } else log(huboCambios ? 'Acumulado actualizado; los servicios no cambiaron.' : 'Sin novedades.');
  for (const [id, d] of Object.entries(salida.lineas)) for (const [tipo, t] of Object.entries(d))
    log(`  línea ${id} ${tipo}: ${t.bloques.map(b => `${b.cartel || '(sin cartel)'} → ${b.sentido}, ${b.paradas.length} paradas, ${b.filas.length} servicios`).join(' | ')}; franjas cubiertas ${[...t.franjas].filter(x => x === '1').length}/48`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
