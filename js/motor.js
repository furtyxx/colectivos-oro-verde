// Lógica pura (sin DOM): horarios, planillas, geometría y planificador.
// Se usa igual en el navegador y en las pruebas de tools/probar.mjs.

const RAD = Math.PI / 180;

/** Distancia en metros entre dos puntos {lat, lon}. */
export function dist(a, b) {
  const x = (b.lon - a.lon) * RAD * Math.cos((a.lat + b.lat) / 2 * RAD), y = (b.lat - a.lat) * RAD;
  return Math.hypot(x, y) * 6371000;
}

/** "5:10" -> 310. Devuelve null si no es una hora. */
export function aMin(txt) {
  const m = /^\s*(\d{1,2})\s*[:.;hH]\s*(\d{2})\s*$/.exec(txt ?? '');
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 29 || mi > 59 ? null : h * 60 + mi;
}
/** 310 -> "5:10" */
export function aHora(min) {
  if (min == null || Number.isNaN(min)) return '—';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

export const sinAcentos = s => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VACIAS = new Set('av avda avenida calle bv blvd boulevard gral general dr de del la las los el y e esq esquina'.split(' '));
export const palabras = s => sinAcentos(s).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(t => t && !VACIAS.has(t));
const palIgual = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
/** ¿Todas las palabras de `busca` aparecen en `texto`? */
export function contiene(texto, busca) {
  const t = palabras(texto), b = palabras(busca);
  return b.length > 0 && b.every(x => t.some(y => palIgual(x, y)));
}

// ---------- tipo de día ----------
const FERIADOS_FIJOS = ['01-01', '03-24', '04-02', '05-01', '05-25', '06-20', '07-09', '12-08', '12-25'];
export const NOMBRE_TIPO = { habil: 'hábil', sabado: 'sábado', domingo: 'domingo' };
/** "2026-11-15" -> { tipo: 'domingo', motivo } */
export function tipoDeDia(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  if (dow === 0) return { tipo: 'domingo', motivo: 'es domingo' };
  if (FERIADOS_FIJOS.includes(iso.slice(5))) return { tipo: 'domingo', motivo: 'es feriado (suele correr horario de domingo)' };
  if (dow === 6) return { tipo: 'sabado', motivo: 'es sábado' };
  return { tipo: 'habil', motivo: 'es día hábil' };
}

// ---------- planillas ----------
const ALIAS = [
  ['facultad', /^fac/], ['escalberdi', /^esc/], ['inta', /\binta\b/], ['km5', /km\s*5|kms\s*1\/2/], ['virgen', /virgen/],
  // "Ramírez y Saraví" / "Ramírez y Ruiz Moreno" son las dos esquinas de la Terminal sobre Av. Ramírez
  ['terminal', /terminal|ramirez.*(sarav|ruiz|moreno)/], ['cruzsur', /cruz/], ['plazaalberdi', /plaza\s*alb/], ['lapridacordoba', /laprida.*cor|cor.*laprida/], ['25mayo9julio', /25.*mayo|mayo.*9|9.*julio/],
];
export function claveDePunto(nombre) {
  const n = sinAcentos(nombre).replace(/\s+/g, ' ').trim();
  for (const [clave, re] of ALIAS) if (re.test(n)) return clave;
  return null;
}

/** Índice de la primera columna de "vuelta" (donde la planilla pega la vuelta). */
export function dondeVuelve(nombres) {
  const n = nombres.map(x => sinAcentos(x).replace(/\s+/g, ''));
  for (let i = 1; i < n.length; i++) if (n[i] && n[i] === n[i - 1]) return i;
  // la vuelta es el espejo de la ida: busco el punto donde más columnas se reflejan (aguanta nombres mal leídos)
  const pal = nombres.map(x => palabras(x)), parecidos = (a, b) => a.length && b.length && a.some(x => b.includes(x));
  let mejor = 0, donde = 0;
  for (let i = 1; i < n.length; i++) {
    let iguales = 0;
    for (let k = 0; i - 1 - k >= 0 && i + k < n.length; k++) if (parecidos(pal[i - 1 - k], pal[i + k])) iguales++;
    if (iguales > mejor) { mejor = iguales; donde = i; }
  }
  if (mejor >= 3) return donde;
  for (let i = 1; i < n.length; i++) if (n[i] && n.slice(0, i).includes(n[i])) return i;
  return n.length;
}

/** A qué parada del recorrido corresponde una columna de la planilla. */
export function resolverColumna(linea, sentido, nombre) {
  const S = linea?.sentidos?.[sentido];
  const base = { nombre, sentido, punto: null, parada: null, aprox: false, dudoso: false };
  if (!S) return base;
  const clave = claveDePunto(nombre);
  if (clave) {
    let n = S.puntos?.[clave] ?? null, aprox = false, dudoso = false;
    // la línea no tiene esa cabecera en el mapa: lo trato como si saliera de Facultad, pero queda en duda
    if (!n && clave === 'escalberdi' && S.puntos?.facultad) { n = S.puntos.facultad; aprox = dudoso = true; }
    if (!n && clave === 'lapridacordoba') { n = sentido === 'ida' ? S.paradas.length : 1; aprox = true; }
    if (n || clave !== 'terminal') return { ...base, punto: clave, parada: n, aprox, dudoso };
  }
  // encabezado con forma de esquina ("Ramírez y Feliciano"): busco la parada que tenga esas calles
  const es = p => contiene(p.nombre, nombre) || (!!p.web && contiene(p.web, nombre));
  const s = S.paradas.find(es);
  if (s) return { ...base, parada: s.n };
  // la cabecera del centro figura con el nombre de la parada del otro sentido ("Santa Fe y Laprida")
  const O = linea.sentidos[sentido === 'ida' ? 'vuelta' : 'ida'];
  if (O?.paradas.length && es(O.paradas[0])) return { ...base, parada: S.paradas.length, aprox: true };
  if (O?.paradas.length && es(O.paradas.at(-1))) return { ...base, parada: 1, aprox: true };
  return base;
}

/**
 * De qué línea es una planilla según sus encabezados (cuando la imagen no lo dice).
 * Devuelve el id de la línea que ubica más columnas en su recorrido, o null si no hay una clara ganadora.
 */
export function adivinarLinea(lineas, nombres) {
  const puntos = lineas.map(l => ({ id: l.id, p: resolverColumnas(l, nombres).reduce((s, c) => s + (c.parada ? (c.aprox ? 0.5 : 1) : 0), 0) })).sort((a, b) => b.p - a.p);
  return puntos.length && puntos[0].p >= 2 && puntos[0].p > (puntos[1]?.p ?? 0) ? puntos[0].id : null;
}

/** Arma las columnas (con sentido y parada) a partir de los nombres leídos. */
export function resolverColumnas(linea, nombres, vueltaDesde = dondeVuelve(nombres)) {
  return nombres.map((nombre, i) => resolverColumna(linea, i < vueltaDesde ? 'ida' : 'vuelta', nombre));
}

/** Convierte una fila de textos a minutos, acomodando el cruce de medianoche. */
export function filaAMin(textos) {
  let prev = null;
  return textos.map(t => {
    let m = typeof t === 'number' ? t : aMin(t);
    if (m == null) return null;
    if (prev != null && m < prev - 720) m += 1440;
    prev = m;
    return m;
  });
}

/**
 * Revisa una planilla y marca celdas sospechosas (para corregir lecturas de fotos).
 * Devuelve un Map "fila,col" -> motivo.
 */
export function validarPlanilla(filas) {
  const dudas = new Map();
  const marcar = (f, c, por) => { const k = f + ',' + c; if (!dudas.has(k)) dudas.set(k, por); };
  const tramos = new Map(); // "c1>c2" -> [{f, d}]
  filas.forEach((fila, f) => {
    let ant = -1;
    fila.forEach((t, c) => {
      if (t == null) return;
      if (ant >= 0) {
        const d = t - fila[ant];
        if (d < 0) { marcar(f, c, 'va para atrás respecto de la columna anterior'); marcar(f, ant, 'la columna siguiente da una hora anterior'); }
        const k = ant + '>' + c; if (!tramos.has(k)) tramos.set(k, []); tramos.get(k).push({ f, d });
      }
      ant = c;
    });
  });
  for (const [k, lista] of tramos) {
    if (lista.length < 4) continue;
    const orden = lista.map(x => x.d).sort((a, b) => a - b), med = orden[Math.floor(orden.length / 2)];
    const [c1, c2] = k.split('>').map(Number);
    for (const { f, d } of lista) if (Math.abs(d - med) > Math.max(5, med * 0.5)) {
      marcar(f, c2, `tramo de ${d} min (lo normal en esta planilla son ${med})`); marcar(f, c1, `tramo de ${d} min hasta la columna siguiente (lo normal son ${med})`);
    }
  }
  const nCols = Math.max(0, ...filas.map(f => f.length));
  for (let c = 0; c < nCols; c++) {
    let prev = null;
    filas.forEach((fila, f) => {
      const t = fila[c]; if (t == null) return;
      if (prev != null && t < prev) marcar(f, c, 'es anterior a la fila de arriba');
      prev = t;
    });
  }
  return dudas;
}

// ---------- horario en cualquier parada ----------
export function paradaCercana(S, punto, radio = Infinity) {
  let mejor = null, dm = radio;
  for (const s of S.paradas) { const d = dist(s, punto); if (d <= dm) { dm = d; mejor = s; } }
  return mejor;
}

/** Puntos con horario conocido de una fila, ordenados por posición en el recorrido. */
export function anclasDeFila(pl, fila, linea, sentido, ri, reglas = []) {
  const S = linea.sentidos[sentido], crudo = [];
  pl.columnas.forEach((c, i) => {
    const t = fila[i];
    if (t == null || c.sentido !== sentido || !c.parada) return;
    const m = S.paradas[c.parada - 1]?.m[ri];
    if (m != null) crudo.push({ m, t, col: i, aprox: !!c.aprox, dudoso: !!c.dudoso });
  });
  for (const r of reglas) {
    if (r.linea !== linea.id || r.sentido !== sentido) continue;
    const base = S.puntos?.[r.punto];
    const ci = pl.columnas.findIndex((c, i) => c.sentido === sentido && fila[i] != null && (c.punto === r.punto || (base && c.parada === base)));
    const s = paradaCercana(S, r, 150);
    if (ci >= 0 && s && s.m[ri] != null) crudo.push({ m: s.m[ri], t: fila[ci] + r.mas, regla: true, aprox: !!pl.columnas[ci].aprox, dudoso: !!pl.columnas[ci].dudoso });
  }
  crudo.sort((a, b) => a.m - b.m || (a.regla ? 1 : -1));
  const out = [];
  for (const a of crudo) {
    const p = out[out.length - 1];
    if (p && Math.abs(a.m - p.m) < 40) { if (a.regla || (p.aprox && !a.aprox)) out[out.length - 1] = a; continue; }
    if (p && a.t < p.t) continue;
    out.push(a);
  }
  return out;
}

/** Hora (min) en la posición m del recorrido: exacta si es un punto de la planilla, si no interpolada. */
export function horaEn(anclas, m) {
  if (!anclas.length || m == null) return null;
  const V0 = 330, vel = (a, b) => Math.min(600, Math.max(150, (b.m - a.m) / Math.max(1, b.t - a.t)));
  const ex = anclas.find(a => Math.abs(a.m - m) < 40);
  if (ex) return { t: ex.t, exacto: !ex.aprox, aprox: !!ex.aprox };
  const p = anclas[0], u = anclas[anclas.length - 1];
  if (m < p.m) return { t: p.t - (p.m - m) / (anclas.length > 1 ? vel(p, anclas[1]) : V0), exacto: false, aprox: !!p.aprox };
  if (m > u.m) return { t: u.t + (m - u.m) / (anclas.length > 1 ? vel(anclas[anclas.length - 2], u) : V0), exacto: false, aprox: !!u.aprox };
  for (let i = 0; i < anclas.length - 1; i++) {
    const a = anclas[i], b = anclas[i + 1];
    if (m >= a.m && m <= b.m) return { t: a.t + (b.t - a.t) * (m - a.m) / (b.m - a.m), exacto: false, aprox: !!(a.aprox || b.aprox) };
  }
  return null;
}

// ---------- planificador ----------
export const minCaminata = (metros, cfg) => metros < 40 ? 0 : Math.max(1, Math.round(metros * cfg.factorCaminata / cfg.pasoMin));

/** Combinaciones línea/sentido que sirven para ir de origen a destino sin trasbordo. */
export function opcionesDeViaje(lineas, origen, destino, cfg) {
  const out = [];
  for (const L of lineas) for (const [sentido, S] of Object.entries(L.sentidos)) {
    S.ramales.forEach((R, ri) => {
      const enRamal = S.paradas.filter(s => s.m[ri] != null);
      let sube = null, ds = cfg.radioOrigen;
      for (const s of enRamal) { const d = dist(s, origen); if (d <= ds) { ds = d; sube = s; } }
      if (!sube) return;
      const cand = enRamal.filter(s => s.m[ri] > sube.m[ri] + 300).map(s => ({ s, d: dist(s, destino) })).filter(x => x.d <= cfg.radioDestino);
      if (!cand.length) return;
      const dmin = Math.min(...cand.map(x => x.d));
      const baja = cand.find(x => x.d <= dmin + Math.max(60, dmin * 0.1)); // la primera "casi igual de cerca"
      const prev = out.find(o => o.linea === L && o.sentido === sentido && o.sube.n === sube.n && o.baja.n === baja.s.n);
      if (prev) { prev.ramales.push(ri); return; }
      out.push({
        id: `${L.id}-${sentido}-${sube.n}-${baja.s.n}`, linea: L, sentido, ramales: [ri], ri, desc: R.desc || S.desc,
        sube, baja: baja.s, mOrigen: Math.round(ds), mDestino: Math.round(baja.d),
        minOrigen: minCaminata(ds, cfg), minDestino: minCaminata(baja.d, cfg),
        tramo: Math.round(baja.s.m[ri] - sube.m[ri]),
      });
    });
  }
  return out.sort((a, b) => (a.mOrigen + a.mDestino) - (b.mOrigen + b.mDestino));
}

/** Todos los servicios de una planilla para una opción, con horarios en subida, bajada y destino. */
export function viajesDeOpcion(op, pl, cfg) {
  const out = [];
  pl.filas.forEach((fila, fi) => {
    const anclas = anclasDeFila(pl, fila, op.linea, op.sentido, op.ri, cfg.reglas);
    if (!anclas.length) return;
    const hs = horaEn(anclas, op.sube.m[op.ri]), hb = horaEn(anclas, op.baja.m[op.ri]);
    if (!hs || !hb) return;
    const tSube = Math.floor(hs.t + 1e-6), tBaja = Math.max(tSube + 1, Math.ceil(hb.t - 1e-6));
    const cols = pl.columnas.map((c, i) => ({ c, t: fila[i] })).filter(x => x.c.sentido === op.sentido && x.t != null);
    out.push({
      op, planilla: pl, fila: fi, tSube, tBaja,
      tParada: tSube - cfg.adelanto, tSalir: tSube - cfg.adelanto - op.minOrigen, tLlega: tBaja + op.minDestino,
      subeExacto: hs.exacto, bajaExacto: hb.exacto, dudoso: anclas.some(a => a.dudoso),
      salida: cols[0] ? { nombre: cols[0].c.nombre, t: cols[0].t } : null,
      refs: cols.map(x => ({ nombre: x.c.nombre, t: x.t })),
    });
  });
  return out.sort((a, b) => a.tSube - b.tSube);
}

/**
 * Planifica un viaje para un tipo de día.
 *   modo llegada: { limite, tope }  -> limite = hora a la que querés estar; tope = hora en que ya es tarde (sale el micro)
 *   modo salida:  { desde }         -> próximos servicios a partir de esa hora
 */
export function planificar({ lineas, planillas, origen, destino, tipo, limite = null, tope = null, desde = null, cfg }) {
  const opciones = opcionesDeViaje(lineas, origen, destino, cfg);
  const viajes = [], sinPlanilla = [];
  for (const op of opciones) {
    const pls = planillas.filter(p => p.linea === op.linea.id && p.tipo === tipo);
    const antes = viajes.length;
    for (const pl of pls) viajes.push(...viajesDeOpcion(op, pl, cfg));
    if (viajes.length === antes) sinPlanilla.push(op);
  }
  viajes.sort((a, b) => a.tSube - b.tSube || a.tLlega - b.tLlega);
  const res = { tipo, opciones, sinPlanilla, viajes, recomendado: null, anterior: null, justo: null, proximos: [] };
  if (limite != null) {
    const llegan = viajes.filter(v => v.tLlega <= limite);
    res.recomendado = llegan[llegan.length - 1] || null;
    res.anterior = llegan.length > 1 ? llegan[llegan.length - 2] : null;
    const hasta = tope ?? limite;
    res.justo = viajes.find(v => v.tLlega > limite && v.tLlega <= hasta - 2 && (!res.recomendado || v.tSube > res.recomendado.tSube)) || null;
  } else if (desde != null) {
    res.proximos = viajes.filter(v => v.tSube >= desde).slice(0, 4);
    res.recomendado = res.proximos[0] || null;
  }
  return res;
}

// ---------- búsqueda de lugares ----------
/** Coordenadas escritas a mano o dentro de un link de Google Maps. */
export function coordsEnTexto(txt) {
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/, /(-?\d{1,2}\.\d{3,})\s*[,; ]\s*(-?\d{1,3}\.\d{3,})/];
  for (const p of pats) { const m = p.exec(txt); if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }; } }
  return null;
}

/** Paradas (de todas las líneas) cuyo nombre contiene el texto, sin repetir lugares. */
export function buscarParadas(lineas, texto, max = 12) {
  const out = [];
  for (const L of lineas) for (const [sentido, S] of Object.entries(L.sentidos)) for (const s of S.paradas) {
    if (!contiene(s.nombre, texto)) continue;
    const prev = out.find(o => dist(o, s) < 60);
    if (prev) { if (!prev.lineas.includes(L.id)) prev.lineas.push(L.id); continue; }
    out.push({ nombre: s.nombre, lat: s.lat, lon: s.lon, lineas: [L.id], tipo: 'parada' });
  }
  return out.slice(0, max);
}

function proy(p, a, b) { // distancia de p al segmento a-b, puntos [lat, lon]
  const k = Math.cos(p[0] * RAD), ax = a[1] * k, ay = a[0], dx = b[1] * k - ax, dy = b[0] - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / l2)) : 0;
  return Math.hypot(p[1] * k - (ax + t * dx), p[0] - (ay + t * dy)) * RAD * 6371000;
}
/** Esquinas "Calle A y Calle B" usando las calles de OSM guardadas. */
export function buscarEsquinas(calles, a, b) {
  const A = calles.filter(c => contiene(c.n, a)), B = calles.filter(c => contiene(c.n, b)), res = [];
  for (const ca of A) for (const cb of B) {
    if (ca === cb) continue;
    for (const [P, Q] of [[ca, cb], [cb, ca]]) for (const t of P.t) for (const p of t) for (const u of Q.t) for (let i = 0; i < u.length - 1; i++) {
      if (proy(p, u[i], u[i + 1]) < 25 && !res.some(r => dist(r, { lat: p[0], lon: p[1] }) < 150)) res.push({ nombre: `${ca.n} y ${cb.n}`, lat: p[0], lon: p[1], tipo: 'esquina' });
    }
  }
  return res.slice(0, 8);
}
/** Calles cuyo nombre contiene el texto (se ubican en su punto medio). */
export function buscarCalles(calles, texto, max = 6) {
  return calles.filter(c => contiene(c.n, texto)).slice(0, max).map(c => {
    const t = c.t.reduce((a, b) => (b.length > a.length ? b : a)), p = t[Math.floor(t.length / 2)];
    return { nombre: c.n + ' (a mitad de la calle)', lat: p[0], lon: p[1], tipo: 'calle' };
  });
}
