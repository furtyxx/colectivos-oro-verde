#!/usr/bin/env node
// Regenera data/lineas.json (recorridos y paradas) a partir de Paraná Online.
//
//   node tools/actualizar.mjs            -> actualiza todas las líneas interurbanas
//   node tools/actualizar.mjs --calles   -> además vuelve a bajar las calles de OpenStreetMap
//
// De cada página https://www.paranaonline.com.ar/horarios-linea-N/ saca:
//   - la lista oficial de nombres de paradas
//   - el mapa de Google My Maps (recorrido + paradas numeradas con coordenadas)
// Como el mapa no trae nombres de parada, se nombran cruzando con las calles de OSM
// y, cuando coincide, con el nombre oficial de la lista.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(RAIZ, 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SITIO = 'https://www.paranaonline.com.ar';
const INDICE = SITIO + '/colectivos-parana/';
const SLUGS_BASE = ['horarios-linea-4', 'horarios-linea-6', 'horarios-linea-12', 'horarios-linea-15',
  'horarios-linea-17-am', 'horarios-linea-20', 'horarios-linea-22', 'horarios-linea-22e-an', 'horarios-linea-24'];
const URBANAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'l', 'm', 'p', 'r', 's'].map(x => 'linea-' + x);
const BBOX = '-31.87,-60.60,-31.69,-60.44';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// Puntos de control que aparecen como columnas en las planillas de ERSA.
const PUNTOS = [
  { clave: 'facultad', pos: [-31.833834, -60.52176], radio: 250, etiqueta: 'Facultad (cabecera Oro Verde)' },
  { clave: 'escalberdi', pos: [-31.83937, -60.52078], radio: 600, etiqueta: 'Escuela Alberdi (cabecera)' },
  { clave: 'terminal', pos: [-31.739728, -60.517608], radio: 250 },
  { clave: 'cruzsur', cruce: ['Avenida de las Américas', 'Cruz del Sur'], radio: 200 },
  { clave: 'plazaalberdi', pos: [-31.73365, -60.52487], radio: 300 },
  { clave: 'lapridacordoba', cruce: ['Laprida', 'Córdoba'], radio: 300 },
  { clave: '25mayo9julio', cruce: ['25 de Mayo', '9 de Julio'], radio: 200 },
];

const dormir = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function bajar(url, opts = {}) {
  let ultimo;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(75000), ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es', ...(opts.headers || {}) } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { ultimo = e; await dormir(2000 * (i + 1)); }
  }
  throw new Error(`No se pudo bajar ${url}: ${ultimo.message}`);
}

// ---------- geometría (puntos = [lat, lon]) ----------
const RAD = Math.PI / 180, RT = 6371000, COS0 = Math.cos(-31.78 * RAD);
const X = p => p[1] * RAD * RT * COS0, Y = p => p[0] * RAD * RT;
const dist = (a, b) => Math.hypot(X(a) - X(b), Y(a) - Y(b));
function proySeg(p, a, b) {
  const ax = X(a), ay = Y(a), dx = X(b) - ax, dy = Y(b) - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((X(p) - ax) * dx + (Y(p) - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(X(p) - (ax + t * dx), Y(p) - (ay + t * dy)), t };
}
const r5 = n => Math.round(n * 1e5) / 1e5;

function simplificar(pts, tol) { // Douglas-Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop(); let max = 0, k = -1;
    for (let m = i + 1; m < j; m++) { const d = proySeg(pts[m], pts[i], pts[j]).d; if (d > max) { max = d; k = m; } }
    if (max > tol) { keep[k] = 1; pila.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Ubica las paradas (en orden) a lo largo del recorrido. Devuelve metros desde el inicio o null.
function metrosEnRecorrido(pts, paradas) {
  const acum = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + dist(pts[i - 1], pts[i]));
  const cands = paradas.map(s => {
    const c = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const pr = proySeg([s.lat, s.lon], pts[i], pts[i + 1]);
      if (pr.d <= 70) c.push({ d: pr.d, m: acum[i] + pr.t * (acum[i + 1] - acum[i]) });
    }
    return c;
  });
  const elegir = (c, desde) => {
    const ok = c.filter(x => x.m >= desde - 30);
    if (!ok.length) return null;
    const min = Math.min(...ok.map(x => x.d));
    return ok.filter(x => x.d <= min + 15).sort((a, b) => a.m - b.m)[0];
  };
  let previo = -Infinity;
  return cands.map((c, i) => {
    const mejor = elegir(c, previo);
    if (!mejor) return c.length && previo > -Infinity ? { fuera: Math.round([...c].sort((a, b) => a.d - b.d)[0].m) } : null;
    // parada mal numerada en el mapa: salta muy adelante y la siguiente vuelve atrás
    const sig = cands[i + 1] && elegir(cands[i + 1], previo);
    if (previo > -Infinity && mejor.m - previo > 2500 && sig && sig.m < mejor.m - 1000) return { fuera: Math.round(mejor.m) };
    previo = mejor.m;
    return Math.round(mejor.m);
  });
}

// ---------- texto ----------
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const VACIAS = new Set(('AV AVDA AVENIDA CALLE BLVD BV BOULEVARD BULEVAR GRAL GENERAL DR DOCTOR PTE PRESIDENTE DE DEL LA LAS LOS EL Y ' +
  'ING INGENIERO ALTE ALMIRANTE CNEL CORONEL MONS MONSENOR PROF PROFESOR GDOR GOBERNADOR SGTO SARGENTO TTE TENIENTE').split(' '));
const tokens = s => norm(s).split(' ').filter(t => t && !VACIAS.has(t));
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
const tokIgual = (a, b) => a === b || (a.length >= 6 && b.length >= 6 && lev(a, b) <= 2);
function coincide(ta, tb) {
  if (!ta.length || !tb.length) return false;
  const n = ta.filter(a => tb.some(b => tokIgual(a, b))).length;
  return n >= 1 && n / Math.min(ta.length, tb.length) >= 0.6;
}
const MINUS = new Set(['de', 'del', 'y']), ARTIC = new Set(['la', 'las', 'los', 'el']);
function bonito(s) {
  return s.toLowerCase().split(/\s+/).map((w, i, a) => (i && (MINUS.has(w) || (ARTIC.has(w) && a[i - 1] === 'de'))) ? w : w.replace(/^[\p{L}]/u, c => c.toUpperCase())).join(' ')
    .replace(/^Avenida /, 'Av. ').replace(/ Avenida /g, ' Av. ').replace(/^Boulevard /, 'Bv. ').replace(/\bLinea\b/, 'Línea');
}
const desEntidad = s => s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#8217;/g, "'");

// ---------- calles OSM ----------
async function cargarCalles(forzar) {
  const archivo = path.join(DATA, 'calles.json');
  const guardar = async osm => {
    const porNombre = new Map();
    for (const w of osm.elements) {
      if (!w.geometry || !w.tags?.name || /^(footway|path|steps|cycleway|service|track|pedestrian)$/.test(w.tags.highway)) continue;
      const pts = simplificar(w.geometry.map(g => [r5(g.lat), r5(g.lon)]), 3);
      if (!porNombre.has(w.tags.name)) porNombre.set(w.tags.name, []);
      porNombre.get(w.tags.name).push(pts);
    }
    const calles = { fuente: '© colaboradores de OpenStreetMap (ODbL)', fecha: osm.osm3s?.timestamp_osm_base || new Date().toISOString(),
      calles: [...porNombre].map(([n, t]) => ({ n, t })).sort((a, b) => a.n.localeCompare(b.n)) };
    await fs.writeFile(archivo, JSON.stringify(calles));
    return calles;
  };
  const iOsm = process.argv.indexOf('--osm'); // archivo crudo de Overpass ya descargado
  if (iOsm > 0) return guardar(JSON.parse(await fs.readFile(process.argv[iOsm + 1], 'utf8')));
  if (!forzar) { try { return JSON.parse(await fs.readFile(archivo, 'utf8')); } catch { /* bajar */ } }
  const q = `[out:json][timeout:60];way["highway"]["name"](${BBOX});out geom qt;`;
  for (const host of OVERPASS) {
    try {
      log('Bajando calles de OpenStreetMap…', host);
      const txt = await bajar(host, { method: 'POST', body: new URLSearchParams({ data: q }) });
      return await guardar(JSON.parse(txt));
    } catch (e) { log('  falló:', e.message); }
  }
  throw new Error('No hay calles de OSM (ni guardadas ni descargables)');
}

function indiceCalles(calles) {
  const lista = calles.calles.map(c => {
    let s = 90, n = -90, w = 180, e = -180;
    for (const t of c.t) for (const p of t) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
    return { nombre: c.n, tok: tokens(c.n), tramos: c.t, s, n, w, e };
  });
  const M = 0.0012; // ~120 m
  return {
    lista,
    cerca(p, radio) { // calles a menos de `radio` m, la más cercana primero (una por nombre)
      const out = new Map();
      for (const c of lista) {
        if (p[0] < c.s - M || p[0] > c.n + M || p[1] < c.w - M || p[1] > c.e + M) continue;
        let min = Infinity;
        for (const t of c.tramos) for (let i = 0; i < t.length - 1; i++) { const d = proySeg(p, t[i], t[i + 1]).d; if (d < min) min = d; }
        if (min <= radio) { const k = c.tok.join(' ') || c.nombre; if (!out.has(k) || out.get(k).d > min) out.set(k, { nombre: c.nombre, tok: c.tok, d: min }); }
      }
      return [...out.values()].sort((a, b) => a.d - b.d);
    },
    cruces(a, b) { // puntos donde se cruzan calles llamadas a y b
      const ta = tokens(a), tb = tokens(b), res = [];
      const A = lista.filter(c => coincide(ta, c.tok)), B = lista.filter(c => coincide(tb, c.tok));
      for (const ca of A) for (const cb of B) {
        if (ca === cb || ca.n < cb.s - M || ca.s > cb.n + M || ca.e < cb.w - M || ca.w > cb.e + M) continue;
        for (const [P, Q] of [[ca, cb], [cb, ca]]) for (const t of P.tramos) for (const p of t) for (const u of Q.tramos) for (let i = 0; i < u.length - 1; i++) {
          if (proySeg(p, u[i], u[i + 1]).d < 25 && !res.some(r => dist(r, p) < 120)) res.push(p);
        }
      }
      return res;
    },
  };
}

// ---------- Paraná Online ----------
function leerPagina(html) {
  const paradas = [];
  const re = /<button class='parada-btn'[^>]*?data-target='horarios-ci-([\w-]+?)-(\d+)'[^>]*>\s*([^<]+?)\s*<\/button>/g;
  let m; while ((m = re.exec(html))) paradas.push({ id: m[2], nombre: desEntidad(m[3]).replace(/\s+/g, ' ') });
  return {
    mid: (html.match(/maps\/d\/(?:u\/\d\/)?(?:embed|viewer)\?mid=([\w-]+)/) || [])[1] || null,
    titulo: desEntidad((html.match(/<h1[^>]*>\s*([^<]+?)\s*</) || [])[1] || ''),
    tipoHoy: (html.match(/horarios-titulo horarios-(\w+)/) || [])[1] || null,
    modificado: (html.match(/"dateModified":"([^"]+)"/) || [])[1] || null,
    nota: desEntidad((html.match(/Última actualización:\s*([^<.]+)/) || [])[1] || '').trim(),
    paradas,
  };
}

// junta todos los pares [lat, lon] de una geometría anidada, en orden
function hojas(g, out = []) {
  if (Array.isArray(g) && g.length === 2 && typeof g[0] === 'number' && typeof g[1] === 'number') out.push(g);
  else if (Array.isArray(g)) for (const x of g) hojas(x, out);
  return out;
}

function leerMapa(html) {
  const m = html.match(/var _pageData = (".*?");<\/script>/s);
  if (!m) throw new Error('el mapa no trae _pageData');
  const capas = JSON.parse(JSON.parse(m[1]))[1][6] || [];
  return capas.map(c => {
    const feats = c[12]?.[0]?.[13]?.[0] || [];
    return {
      nombre: c[2] || '',
      puntos: feats.filter(f => f[1]).map(f => ({ nombre: String(f[5]?.[0]?.[1]?.[0] ?? ''), pos: f[1][0][0] })),
      lineas: feats.filter(f => f[2]).map(f => ({ nombre: String(f[5]?.[0]?.[1]?.[0] ?? ''), pts: hojas(f[2]) })),
    };
  });
}

function nombrarParadas(paradas, sentido, oficiales, idx) {
  const cerca = paradas.map(s => idx.cerca([s.lat, s.lon], 90));
  // nombre derivado de OSM
  paradas.forEach((s, i) => {
    const c = cerca[i];
    if (!c.length) { s.nombre = `Parada ${s.n}`; return; }
    const cruza = c.slice(1).find(x => x.d <= 60 && !coincide(x.tok, c[0].tok));
    s.nombre = bonito(c[0].nombre) + (cruza ? ' y ' + bonito(cruza.nombre) : '');
  });
  // intento de casar con la lista oficial
  const pares = [];
  const usados = new Set();
  oficiales.forEach((o, oi) => {
    if (o.sentido && o.sentido !== sentido) return;
    paradas.forEach((s, i) => {
      const c = cerca[i]; let costo = 0, hechas = 0; const partes = [];
      for (const p of o.partes) {
        const tp = tokens(p), hit = c.find(x => coincide(tp, x.tok));
        if (hit) { hechas++; costo += hit.d; partes.push(bonito(hit.nombre)); }
        else if (!idx.lista.some(x => coincide(tp, x.tok))) { costo += 60; partes.push(bonito(p)); } // referencia, no calle
        else return;
      }
      if (!hechas) return;
      pares.push({ i, oi, costo: costo + (o.partes.length - hechas) * 40, nombre: partes.join(' y ') });
    });
  });
  pares.sort((a, b) => a.costo - b.costo);
  const tomadas = new Set();
  for (const p of pares) {
    const clave = oficiales[p.oi].clave;
    if (tomadas.has(p.i) || usados.has(clave)) continue;
    tomadas.add(p.i); usados.add(clave);
    paradas[p.i].nombre = p.nombre; paradas[p.i].web = oficiales[p.oi].nombre;
  }
}

async function procesarLinea(slug, idx) {
  const url = `${SITIO}/${slug}/`;
  const pag = leerPagina(await bajar(url));
  if (!pag.mid) throw new Error('la página no tiene mapa');
  await dormir(800);
  const capas = leerMapa(await bajar(`https://www.google.com/maps/d/embed?mid=${pag.mid}`));
  const id = slug.replace('horarios-linea-', '').toUpperCase();
  const oficiales = pag.paradas.map(p => {
    const tag = (p.nombre.match(/\[(IDA|VUELTA)\]/) || [])[1];
    const limpio = p.nombre.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();
    return { nombre: limpio, sentido: tag ? tag.toLowerCase() : null, partes: limpio.split(/\s+Y\s+/), clave: norm(limpio) };
  });
  const sentidos = {};
  for (const c of capas) {
    const sen = /VUELTA/i.test(c.nombre) ? 'vuelta' : /IDA/i.test(c.nombre) ? 'ida' : 'ida';
    const S = sentidos[sen] ||= { desc: '', ramales: [], paradas: [] };
    if (c.lineas.length) for (const l of c.lineas) {
      const ramal = (c.nombre.match(/\(([^)]+)\)/) || [])[1] || '';
      const desc = l.nombre.replace(/^(IDA|VUELTA)\s*\/\/\s*/i, '').replace(/\s+-\s+/g, ' → ');
      if (!S.desc) S.desc = desc;
      S._crudo = l.nombre;
      S.ramales.push({ nombre: ramal.replace(/^Ramal\s+/i, ''), desc, pts: simplificar(l.pts.map(p => [r5(p[0]), r5(p[1])]), 4) });
    }
    if (c.puntos.length) {
      const num = c.puntos.every(p => /^\d+$/.test(p.nombre));
      const ord = num ? [...c.puntos].sort((a, b) => +a.nombre - +b.nombre) : c.puntos;
      for (const p of ord) S.paradas.push({ n: S.paradas.length + 1, lat: r5(p.pos[0]), lon: r5(p.pos[1]) });
    }
  }
  if (sentidos.ida && sentidos.vuelta && sentidos.vuelta.desc === sentidos.ida.desc) {
    const inv = t => t.split(' → ').reverse().join(' → ');
    sentidos.vuelta.desc = inv(sentidos.vuelta.desc); sentidos.vuelta.ramales.forEach(r => { r.desc = inv(r.desc); });
  }
  for (const [sen, S] of Object.entries(sentidos)) {
    delete S._crudo;
    nombrarParadas(S.paradas, sen, oficiales, idx);
    S.ramales.forEach(r => { r.largo = Math.round(r.pts.reduce((a, p, i) => a + (i ? dist(r.pts[i - 1], p) : 0), 0)); });
    let ms = S.ramales.map(r => metrosEnRecorrido(r.pts, S.paradas));
    // reubico las paradas que el mapa numera fuera de orden y recalculo
    const fuera = S.paradas.map((_, i) => ms.findIndex(x => x[i] && typeof x[i] === 'object')).map((r, i) => r >= 0 ? { i, r, m: ms[r][i].fuera } : null).filter(Boolean);
    if (fuera.length) {
      const movidas = fuera.map(f => ({ s: S.paradas[f.i], ...f }));
      let resto = S.paradas.filter(s => !movidas.some(x => x.s === s));
      for (const mv of movidas) {
        const mr = metrosEnRecorrido(S.ramales[mv.r].pts, resto);
        let pos = 0; mr.forEach((m, k) => { if (typeof m === 'number' && m <= mv.m) pos = k + 1; });
        resto = [...resto.slice(0, pos), mv.s, ...resto.slice(pos)];
      }
      S.paradas = resto; S.paradas.forEach((s, i) => { s.n = i + 1; });
      ms = S.ramales.map(r => metrosEnRecorrido(r.pts, S.paradas));
    }
    S.paradas.forEach((s, i) => { s.m = ms.map(x => typeof x[i] === 'number' ? x[i] : null); });
    S.puntos = {};
    for (const P of PUNTOS) {
      const cands = P.pos ? [P.pos] : idx.cruces(P.cruce[0], P.cruce[1]);
      let mejor = null;
      for (const c of cands) for (const s of S.paradas) { const d = dist(c, [s.lat, s.lon]); if (d <= P.radio && (!mejor || d < mejor.d)) mejor = { d, n: s.n }; }
      if (mejor && !(P.clave === 'escalberdi' && S.puntos.facultad === mejor.n)) {
        S.puntos[P.clave] = mejor.n;
        const s = S.paradas[mejor.n - 1];
        if (P.etiqueta && (!s.nombre.includes(' y ') || s.nombre.startsWith('Parada '))) s.nombre = P.etiqueta;
      }
    }
  }
  return {
    id, nombre: 'Línea ' + id.replace('-', ' '), url, mapa: `https://www.google.com/maps/d/viewer?mid=${pag.mid}`,
    webModificada: pag.modificado, webNota: pag.nota, sentidos, _tipoHoy: pag.tipoHoy, _oficiales: pag.paradas.length,
  };
}

// ---------- líneas urbanas (A, B, C…): la página lista las paradas de cada servicio, en orden, con el horario de todo el día ----------
const distAPoly = (p, pts) => { let m = Infinity; for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, proySeg(p, pts[i], pts[i + 1]).d); return m; };

async function procesarUrbana(slug, idx, previa) {
  const url = `${SITIO}/${slug}/`;
  const html = await bajar(url);
  const pag = leerPagina(html);
  if (!pag.mid) throw new Error('la página no tiene mapa');
  await dormir(800);
  const capas = leerMapa(await bajar(`https://www.google.com/maps/d/embed?mid=${pag.mid}`));
  const id = slug.replace('linea-', '').toUpperCase();
  const rutas = capas.flatMap(c => c.lineas.filter(l => l.pts.length > 3).map(l => simplificar(l.pts.map(p => [r5(p[0]), r5(p[1])]), 4)));
  const mapa = capas.filter(c => /parada/i.test(c.nombre)).flatMap(c => c.puntos.map(p => [p.pos[0], p.pos[1]]));
  const titulos = new Map([...html.matchAll(/<option value='(\d+)'[^>]*>([^<]+)<\/option>/g)].map(m => [m[1], desEntidad(m[2]).replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()]));
  const sentidos = {};
  for (const trozo of html.split(/<div class='linea-servicio' data-id='/).slice(1)) {
    const sid = trozo.match(/^(\d+)/)[1];
    const crudas = [...trozo.matchAll(/<button class='parada-btn' data-target='horarios-\d+-(\d+)'[^>]*>\s*([^<]+?)\s*<\/button>/g)]
      .map(m => ({ pid: m[1], web: desEntidad(m[2]).replace(/\s+/g, ' ').trim() }));
    if (crudas.length < 3) { if (previa?.sentidos?.[sid]) sentidos[sid] = previa.sentidos[sid]; continue; } // hoy no tiene horarios: conservo lo que había
    // cada parada se llama "CALLE A - CALLE B": la ubico en el cruce
    const lista = crudas.map(p => {
      const partes = p.web.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim().split(/\s+-\s+/);
      return { ...p, partes, cands: partes.length === 2 ? idx.cruces(partes[0], partes[1]) : [] };
    });
    // el recorrido es el trazo del mapa por el que pasan más paradas, en el orden en que están listadas
    let mejor = null;
    for (const pts of rutas) {
      const ps = [];
      for (const p of lista) {
        let c = null;
        for (const q of p.cands) { const d = distAPoly(q, pts); if (d <= 60 && (!c || d < c.d)) c = { d, q }; }
        if (!c) continue;
        const snap = mapa.map(q => ({ q, d: dist(q, c.q) })).filter(x => x.d <= 45).sort((a, b) => a.d - b.d)[0];
        ps.push({ ...p, lat: r5((snap ? snap.q : c.q)[0]), lon: r5((snap ? snap.q : c.q)[1]) });
      }
      if (ps.length < 3) continue;
      const ms = metrosEnRecorrido(pts, ps), buenas = ps.filter((_, i) => typeof ms[i] === 'number');
      if (!mejor || buenas.length > mejor.n) mejor = { pts, ps, ms, n: buenas.length };
    }
    if (!mejor || mejor.n < 3) { log(`  (${id} servicio ${sid}: no pude ubicar el recorrido, lo salteo)`); if (previa?.sentidos?.[sid]) sentidos[sid] = previa.sentidos[sid]; continue; }
    const paradas = [];
    mejor.ps.forEach((p, i) => {
      if (typeof mejor.ms[i] !== 'number') return;
      paradas.push({ n: paradas.length + 1, lat: p.lat, lon: p.lon, nombre: p.partes.map(bonito).join(' y '), web: p.web, pid: p.pid, m: [mejor.ms[i]] });
    });
    const desc = (titulos.get(sid) || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s*>\s*/g, ' → ').replace(/\s+/g, ' ').trim();
    const largo = Math.round(mejor.pts.reduce((a, p, i) => a + (i ? dist(mejor.pts[i - 1], p) : 0), 0));
    sentidos[sid] = { desc, cartel: (titulos.get(sid) || '').match(/^\[([^\]]+)\]/)?.[1] || '', ramales: [{ nombre: '', desc, pts: mejor.pts, largo }], paradas, puntos: {} };
  }
  return { id, nombre: 'Línea ' + id, tipo: 'urbana', url, mapa: `https://www.google.com/maps/d/viewer?mid=${pag.mid}`, webModificada: pag.modificado, webNota: pag.nota, sentidos, _tipoHoy: pag.tipoHoy, _oficiales: Object.keys(sentidos).length };
}

function resumenCambios(antes, ahora) {
  const out = [];
  if (!antes) return ['Línea nueva en los datos'];
  for (const sen of new Set([...Object.keys(antes.sentidos || {}), ...Object.keys(ahora.sentidos)])) {
    const a = antes.sentidos?.[sen], b = ahora.sentidos[sen];
    if (!a || !b) { out.push(`Sentido ${sen}: ${a ? 'ya no figura' : 'nuevo'}`); continue; }
    if (a.paradas.length !== b.paradas.length) out.push(`${sen}: pasó de ${a.paradas.length} a ${b.paradas.length} paradas`);
    const movidas = b.paradas.filter(s => !a.paradas.some(t => dist([s.lat, s.lon], [t.lat, t.lon]) < 40)).length;
    if (movidas) out.push(`${sen}: ${movidas} parada(s) nuevas o corridas de lugar`);
    const la = a.ramales.map(r => r.largo), lb = b.ramales.map(r => r.largo);
    if (la.length !== lb.length || la.some((x, i) => Math.abs(x - lb[i]) > 150)) out.push(`${sen}: cambió el recorrido (${la.join('/')} m → ${lb.join('/')} m)`);
  }
  return out;
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const idx = indiceCalles(await cargarCalles(process.argv.includes('--calles')));
  let slugs = SLUGS_BASE;
  try {
    const hallados = [...new Set([...(await bajar(INDICE)).matchAll(/paranaonline\.com\.ar\/(horarios-linea-[a-z0-9-]+)\//g)].map(m => m[1]))];
    if (hallados.length) slugs = [...new Set([...SLUGS_BASE.filter(s => hallados.includes(s)), ...hallados])];
  } catch (e) { log('No pude leer el índice de líneas, uso la lista fija:', e.message); }

  slugs = [...new Set([...slugs, ...URBANAS])];
  // --lineas a,f,6  solo vuelve a leer esas líneas (el resto queda como estaba)
  const solo = (process.argv.find(a => a.startsWith('--lineas=')) || '').slice(9).split(',').filter(Boolean).map(x => x.toLowerCase());
  let previo = null;
  try { previo = JSON.parse(await fs.readFile(path.join(DATA, 'lineas.json'), 'utf8')); } catch { /* primera vez */ }
  const lineas = [], errores = [], cambios = [], hoy = {};
  for (const slug of slugs) {
    if (solo.length && !solo.some(x => slug === 'linea-' + x || slug === 'horarios-linea-' + x)) {
      const igual = previo?.lineas.find(x => x.url && x.url.replace(/\/$/, '').endsWith('/' + slug));
      if (igual) lineas.push(igual);
      continue;
    }
    try {
      const antesL = previo?.lineas.find(x => x.url && x.url.replace(/\/$/, '').endsWith('/' + slug));
      const L = slug.startsWith('linea-') ? await procesarUrbana(slug, idx, antesL) : await procesarLinea(slug, idx);
      hoy[L.id] = L._tipoHoy; delete L._tipoHoy;
      const nPar = Object.values(L.sentidos).reduce((a, s) => a + s.paradas.length, 0);
      const conWeb = Object.values(L.sentidos).reduce((a, s) => a + s.paradas.filter(p => p.web).length, 0);
      log(`✓ ${L.nombre}: ${nPar} paradas (${conWeb} con nombre oficial de ${L._oficiales}), sentidos ${Object.keys(L.sentidos).join('/')}`);
      delete L._oficiales;
      if (!nPar) throw new Error('el mapa no trae paradas');
      const antes = antesL;
      const c = resumenCambios(antes, L);
      if (previo && c.length) cambios.push({ linea: L.id, detalle: c });
      lineas.push(L);
    } catch (e) {
      errores.push(`${slug}: ${e.message}`); log(`✗ ${slug}: ${e.message}`);
      const antes = previo?.lineas.find(x => x.url && x.url.replace(/\/$/, '').endsWith('/' + slug));
      if (antes) lineas.push(antes); // conservo lo que había
    }
    await dormir(1200);
  }
  if (!lineas.length) throw new Error('No se pudo leer ninguna línea; no toco los datos.');

  const igual = previo && JSON.stringify(previo.lineas) === JSON.stringify(lineas);
  const ahora = new Date().toISOString();
  if (!igual) {
    await fs.writeFile(path.join(DATA, 'lineas.json'), JSON.stringify({ generado: ahora, fuente: INDICE, lineas }));
    log('Escribí data/lineas.json');
  } else log('Recorridos y paradas sin cambios.');

  let hist = [];
  try { hist = JSON.parse(await fs.readFile(path.join(DATA, 'cambios.json'), 'utf8')).historial || []; } catch { /* vacío */ }
  for (const c of cambios) hist.unshift({ fecha: ahora.slice(0, 10), ...c });
  const tipos = Object.values(hoy).filter(Boolean);
  const estado = {
    revisado: ahora,
    // qué planilla muestra Paraná Online el día de la revisión (hábil / sábado / domingo)
    tipoHoy: tipos.length ? { fecha: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), tipo: tipos[0], porLinea: hoy } : null,
    errores, historial: hist.slice(0, 40),
  };
  await fs.writeFile(path.join(DATA, 'cambios.json'), JSON.stringify(estado, null, 1));
  if (cambios.length) log('Cambios detectados:', JSON.stringify(cambios));
  if (errores.length) log('Con errores:', errores.join(' | '));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
