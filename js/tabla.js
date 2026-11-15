// Arma la tabla de una planilla a partir de las palabras que reconoce el lector del teléfono (OCR).
// Lógica pura: no toca el DOM, así se puede probar con node (tools/probar.mjs).
//
// Acepta una o varias "pasadas" de lectura de la misma imagen (distintos tamaños o limpiezas): cada pasada
// vota qué dice cada celda, y cuando no se ponen de acuerdo se elige la lectura que respeta el orden y los
// tiempos de viaje del resto de la planilla. Nunca se inventa una hora: solo se elige entre lo que se leyó,
// y lo que no quedó firme se marca para que la persona lo confirme con la foto.
import { aMin, sinAcentos, claveDePunto } from './motor.js';

/** Nombre prolijo de los puntos que ya conozco, para no guardar encabezados cortados ("Faculta d"). */
const NOMBRE_PUNTO = {
  facultad: 'Facultad', escalberdi: 'Esc Alberdi', inta: 'INTA', km5: 'KM 5 1/2', virgen: 'La Virgen',
  terminal: 'Terminal', cruzsur: 'Américas y Cruz Sur', plazaalberdi: 'Plaza Alberdi',
  lapridacordoba: 'Laprida y Córdoba', '25mayo9julio': '25 de Mayo y 9 de Julio',
};
const CLAVE_TITULO = /\b(linea|horarios?|habil(es)?|sabados?|domingos?|feriados?|lunes|viernes)\b/;

const mediana = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const RUIDO = /^[\s|_—–\-.,:;'"`~^*°!¡()[\]{}\\/<>«»=+]*$/;
/** Minutos que van de a hasta b (dando la vuelta a la medianoche). Más de 720 = b es anterior a a. */
const tramo = (a, b) => ((b - a) % 1440 + 1440) % 1440;

/** Texto reconocido -> "H:MM" si es una hora (tolera las confusiones típicas del OCR), o null. */
export function horaDeTexto(texto) {
  let s = String(texto ?? '').trim().replace(/^[|[\]!¡]+|[|[\]!¡]+$/g, '');
  if (!/\d/.test(s) || s.length > 6) return null;
  if ((s.match(/\d/g) || []).length >= 2) s = s.replace(/[oOQD]/g, '0').replace(/[lIi]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/[Zz]/g, '2');
  const m = /^(\d{1,2})\s*[:.;,'’·-]\s*(\d{2})$/.exec(s) || /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 24 || mi > 59 ? null : h + ':' + m[2];
}

/** Agrupa valores en una dimensión: corta cuando el salto entre vecinos supera el umbral. */
function grupos(items, valor, umbral) {
  const orden = [...items].sort((a, b) => valor(a) - valor(b)), res = [];
  let ant = null;
  for (const it of orden) {
    const v = valor(it);
    if (ant == null || v - ant > umbral) res.push([]);
    res.at(-1).push(it); ant = v;
  }
  return res;
}

function distancia(a, b) { // de edición (Levenshtein)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Lista de nombres (paradas, calles) -> Map palabra sin acentos -> palabra bien escrita. */
export function vocabularioDe(nombres) {
  const v = new Map();
  for (const n of [...nombres, ...Object.values(NOMBRE_PUNTO), 'Escuela', 'Esc', 'Terminal', 'Hospital', 'Plaza', 'Avenida'])
    for (const p of String(n).split(/[^\p{L}\d]+/u)) if (p.length >= 2 && !v.has(sinAcentos(p))) v.set(sinAcentos(p), p);
  return v;
}
const NEXOS = new Set('y e de del la las los el a av avda'.split(' '));

/** Texto de un encabezado tal como se leyó en una pasada, y cuántas de sus palabras existen. */
function candidatoDeNombre(pals, altoLetra, vocab) {
  const lineas = grupos(pals, p => p.cy, altoLetra * 0.6).map(l => l.sort((a, b) => a.x0 - b.x0).map(p => p.t.replace(/^[^\p{L}\d]+|[^\p{L}\d.]+$/gu, '')).filter(Boolean));
  // pego los pedacitos de palabra cortada ("Hospit" + "al"), salvo que sean una palabra por sí mismos
  const partes = [];
  for (const l of lineas) {
    if (partes.length && l.length === 1 && /^\p{Ll}{1,2}$/u.test(l[0]) && !/^[yeao]$/.test(l[0]) && /\p{L}$/u.test(partes.at(-1))) partes[partes.length - 1] += l[0];
    else partes.push(...l);
  }
  // una "y" suelta al principio o al final es un pedazo de otra celda
  while (partes.length > 1 && /^[ye]$/i.test(partes[0])) partes.shift();
  while (partes.length > 1 && /^[ye]$/i.test(partes.at(-1))) partes.pop();
  let buenas = 0, contadas = 0;
  const texto = partes.map(p => {
    const n = sinAcentos(p).replace(/[^a-z0-9ñ]/g, '');
    if (!vocab || !n || /\d/.test(n) || NEXOS.has(n)) return p;
    contadas++;
    if (vocab.has(n)) { buenas++; const bien = vocab.get(n); return /^\p{Ll}/u.test(p) && /^\p{Lu}/u.test(bien) ? bien : p; }
    if (n.length < 4) return p;
    // casi igual a una palabra conocida (una o dos letras mal leídas): la corrijo
    const tope = n.length >= 7 ? 2 : 1;
    let mejor = null, dm = tope + 1, empate = false;
    for (const [k, bien] of vocab) {
      if (Math.abs(k.length - n.length) > tope) continue;
      const d = distancia(n, k);
      if (d < dm) { dm = d; mejor = bien; empate = false; } else if (d === dm) empate = true;
    }
    if (mejor && !empate) { buenas += 0.5; return p === p.toUpperCase() ? mejor.toUpperCase() : mejor; }
    return p;
  }).join(' ').replace(/\s+/g, ' ').trim();
  return { texto, buenas, puntaje: contadas ? buenas / contadas : 0.5 };
}

function nombreDeColumna(cands) {
  const validos = cands.filter(c => c.texto);
  if (!validos.length) return '';
  const veces = t => validos.filter(c => sinAcentos(c.texto) === sinAcentos(t)).length;
  // gana el que tiene más palabras conocidas; a igualdad, el que más veces se leyó
  const orden = c => [c.puntaje, c.buenas, veces(c.texto)];
  const gana = (a, b) => { const x = orden(a), y = orden(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  const mejor = validos.reduce((a, b) => (gana(b, a) ? b : a)).texto;
  const clave = claveDePunto(mejor), n = sinAcentos(mejor);
  if (!clave) return mejor;
  if (clave === 'terminal' && !/terminal/.test(n)) return mejor;      // "Ramírez y Saraví": es la Terminal, pero dejo el nombre de la planilla
  if (clave === 'escalberdi' && /escuela/.test(n)) return 'Escuela Alberdi';
  return NOMBRE_PUNTO[clave] || mejor;
}

function leerTitulo(titulo) {
  const n = sinAcentos(titulo);
  const lin = /linea\s*(?:n[°ºo.]*\s*)?(\d+\s?[a-z]?\b)/.exec(n);
  const tipos = [[/habil|lunes|viernes/, 'habil'], [/sabado/, 'sabado'], [/domingo|feriado/, 'domingo']].filter(([re]) => re.test(n)).map(x => x[1]);
  const vig = /\(([^)]+)\)/.exec(titulo) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.exec(titulo);
  return {
    linea: lin ? lin[1].replace(/\s/g, '').toUpperCase() : '',
    tipo: tipos.length === 1 ? tipos[0] : null,
    vigencia: vig ? (vig[1] || vig[0]).trim().replace(/[),.;]+$/, '') : '',
  };
}

/** Ordena los candidatos de una celda y deja elegido el más votado. */
function decidir(cel, nPasadas) {
  const c = [...cel.votos].map(([t, v]) => ({ t, ...v })).sort((a, b) => b.n - a.n || b.c - a.c);
  cel.cands = c;
  if (!c.length) { cel.t = null; cel.c = 0; cel.firme = false; return; }
  cel.t = c[0].t; cel.c = c[0].c;
  const total = c.reduce((s, x) => s + x.n, 0);
  // firme: con una sola pasada, se leyó con seguridad; con varias, la mayoría clara de las lecturas coincide
  cel.firme = nPasadas === 1 && !cel.releida ? c.length === 1 && c[0].c >= 75 : c[0].n >= 2 && c[0].n >= total * 0.6 && c[0].n > (c[1]?.n || 0);
}

function votar(cel, hora, conf) {
  const v = cel.votos.get(hora);
  if (v) { v.n++; v.c = Math.max(v.c, conf); } else cel.votos.set(hora, { n: 1, c: conf });
}

/** Horas que salen de cambiar un solo dígito (lo que pasa cuando el lector confunde un número por otro). */
function parecidas(hora) {
  const res = new Set();
  [...hora].forEach((ch, i) => { if (ch >= '0' && ch <= '9') for (const o of '0123456789') { const h = horaDeTexto(hora.slice(0, i) + o + hora.slice(i + 1)); if (h && h !== hora) res.add(h); } });
  return [...res];
}

const ALCANCE = 3, TOLERANCIA = 4; // columnas vecinas que se comparan, y minutos de diferencia que se aceptan

/**
 * Compara cada celda con las de su fila usando los minutos de viaje que se repiten en la planilla.
 * - Entre las lecturas de una celda elige una que cierre con la fila (si hay), la más votada.
 * - Si ninguna lectura cierra, prueba cambiar un dígito por otro parecido (6/8, 1/7…): si exactamente una
 *   variante cierra con toda la fila, la propone y la deja marcada.
 * - Todo lo que no quedó firme, o no cierra, queda con una nota para confirmar con la foto.
 * Con una sola pasada y la celda leída con seguridad no toca nada (lo revisa después el validador general).
 */
function afinar(tabla) {
  const { celdas, nPasadas } = tabla, nc = tabla.cols.length;
  const min = cel => aMin(cel.t);
  const revisar = cel => cel?.t && !(nPasadas === 1 && cel.firme && !cel.releida);
  let tipico = new Map();
  const medir = () => {
    const m = new Map();
    for (const fila of celdas) for (let a = 0; a < nc; a++) if (fila[a]?.t) for (let b = a + 1; b <= a + ALCANCE && b < nc; b++) if (fila[b]?.t) {
      const k = a + '>' + b; if (!m.has(k)) m.set(k, []); m.get(k).push(tramo(min(fila[a]), min(fila[b])));
    }
    // el valor típico es el que más se repite (±2 min): aguanta que varias lecturas de esa columna estén mal
    tipico = new Map();
    for (const [k, v] of m) {
      if (v.length < 3) continue;
      const cerca = x => v.filter(y => Math.abs(y - x) <= 2);
      const centro = v.reduce((a, b) => (cerca(b).length > cerca(a).length ? b : a));
      if (cerca(centro).length < 2) continue;
      const val = mediana(cerca(centro)), iguales = v.filter(y => y === val).length;
      // regular: casi todas las filas tardan exactamente lo mismo (ahí un minuto de diferencia ya es sospechoso)
      tipico.set(k, { v: val, regular: v.length >= 4 && iguales >= Math.ceil(v.length * 0.7) });
    }
  };
  /** Cómo cierra una hora en la celda (f, c): cuántas vecinas de la fila la respaldan y por cuántos minutos se aparta. */
  const cierre = (f, c, hora) => {
    const m = aMin(hora), fila = celdas[f];
    let total = 0, bien = 0, peor = 0, alReves = false, enPunto = 0, fuera = 0;
    for (let o = Math.max(0, c - ALCANCE); o <= Math.min(nc - 1, c + ALCANCE); o++) {
      if (o === c || !fila[o]?.t) continue;
      const d = o < c ? tramo(min(fila[o]), m) : tramo(m, min(fila[o]));
      const tp = tipico.get(o < c ? o + '>' + c : c + '>' + o);
      if (tp == null) { if (d > 720 && Math.abs(o - c) === 1) alReves = true; continue; }
      total++;
      const dev = d > 720 ? 999 : Math.abs(d - tp.v);
      if (dev <= TOLERANCIA) { bien++; peor = Math.max(peor, dev); }
      if (tp.regular) { if (dev === 0) enPunto++; else fuera++; }
    }
    // orden dentro de la columna: comparo con las dos celdas más cercanas de cada lado que cierren con su propia fila
    // (así una vecina mal leída no hace quedar mal a esta)
    const enOrden = (a, b) => b >= a || (a >= 20 * 60 && b < 5 * 60);
    const vert = df => {
      const v = [];
      for (let ff = f + df; ff >= 0 && ff < celdas.length && v.length < 2; ff += df) { const x = celdas[ff][c]; if (x?.t && x.cierraFila !== false) v.push(min(x)); }
      return !v.length || v.some(x => (df < 0 ? enOrden(x, m) : enOrden(m, x)));
    };
    const vertical = vert(-1) && vert(1);
    // cierra: la mayoría de las vecinas con patrón conocido la respalda (o no hay patrón y al menos no va para atrás)
    return {
      total, bien, peor, vertical, enPunto, fuera,
      sano: total ? bien >= Math.max(1, Math.ceil(total / 2)) : !alReves,
      justo: total >= 2 && bien === total && peor <= 1,
      desfasado: fuera > enPunto,                       // en una planilla regular, no coincide con la mayoría de sus vecinas
      clavado: total >= 2 && bien === total && peor === 0 && enPunto >= 1, // coincide al minuto con todas
    };
  };

  for (let vuelta = 0; vuelta < 3; vuelta++) {
    medir();
    celdas.forEach((fila, f) => fila.forEach((cel, c) => {
      if (!revisar(cel)) return;
      const ev = cel.cands.map(x => ({ ...x, ...cierre(f, c, x.t) }));
      const sanos = ev.filter(x => x.sano && x.vertical);
      let elegido = (sanos.length ? sanos : ev)[0], propuesta = null;      // ev ya viene ordenado por votos
      // una lectura menos votada que calza al minuto con toda la fila le gana a una que se aparta
      const justa = sanos.find(x => x.justo);
      if (justa && justa !== elegido && elegido.peor >= 3) elegido = justa;
      const clavada = sanos.find(x => x.clavado);
      if (clavada && elegido.desfasado) elegido = clavada;
      if (!sanos.length || elegido.desfasado) {
        // ninguna lectura cierra: pruebo cambiar un dígito por otro parecido; vale solo si una única variante calza con toda la fila
        const hip = [...new Set(cel.cands.slice(0, 2).flatMap(x => parecidas(x.t)))].map(t => ({ t, ...cierre(f, c, t) }))
          .filter(x => x.vertical && !cel.votos.has(x.t) && (x.clavado || (x.justo && x.fuera === 0 && !sanos.length)));
        if (hip.length === 1) propuesta = hip[0];
      }
      cel.propuesta = propuesta ? { de: elegido.t, a: propuesta.t } : null;
      cel.t = propuesta ? propuesta.t : elegido.t;
      cel.c = cel.votos.get(cel.t)?.c ?? 0;
      const usado = propuesta || elegido;
      cel.cierra = usado.sano && usado.vertical;
      cel.cierraFila = usado.sano;
      cel.calza = !propuesta && cel.cierra && ((cel.firme && cel.t === cel.cands[0].t) || (usado.justo && cel.votos.get(cel.t).n >= 2));
    }));
  }
  celdas.forEach(fila => fila.forEach(cel => {
    if (!cel || cel.notaFija) return;
    if (!revisar(cel) || cel.calza) { cel.nota = ''; return; }
    const otras = cel.cands.filter(x => x.t !== cel.t).map(x => x.t).slice(0, 2);
    cel.nota = cel.propuesta ? `se leía ${cel.propuesta.de}, pero por los horarios de la fila tiene que ser ${cel.propuesta.a}. Confirmala con la foto`
      : !cel.cierra ? `no cierra con el resto de la fila${otras.length ? ` (también se leyó ${otras.join(' y ')})` : ''}. Confirmala con la foto`
        : otras.length ? `no se lee bien: puede ser ${cel.t} o ${otras.join(' o ')}. Confirmala con la foto` : 'se lee con poca seguridad: confirmala con la foto';
  }));
}

function armarUna(P, nPasadas, vocab) {
  const H = P.filter(p => p.hora && !p.mudo);
  const alto = mediana(H.map(p => p.y1 - p.y0)), ancho = mediana(H.map(p => p.x1 - p.x0));
  const borde = (g, k0, k1) => ({ a: Math.min(...g.map(p => p[k0])), b: Math.max(...g.map(p => p[k1])) });
  const filas = grupos(H, p => p.cy, alto * 0.6).map(g => ({ cy: mediana(g.map(p => p.cy)), y0: borde(g, 'y0', 'y1').a, y1: borde(g, 'y0', 'y1').b, n: g.length }));
  const cols = grupos(H, p => p.cx, ancho * 0.45).map(g => ({ cx: mediana(g.map(p => p.cx)), x0: borde(g, 'x0', 'x1').a, x1: borde(g, 'x0', 'x1').b, n: g.length }));
  // una "fila" suelta de un solo número muy arriba suele ser parte del título (un año, una fecha)
  while (filas.length > 2 && filas[0].n <= nPasadas && filas[1].cy - filas[0].cy > alto * 2.5 && filas[1].n > filas[0].n) filas.shift();

  const masCerca = (lista, v, k) => { let mejor = 0; lista.forEach((x, i) => { if (Math.abs(x[k] - v) < Math.abs(lista[mejor][k] - v)) mejor = i; }); return mejor; };
  const celdas = filas.map(() => cols.map(() => null));
  const arriba = filas[0].y0 - alto * 0.3;
  for (const p of P) {
    if (p.cy < arriba || p.mudo) continue;
    const f = masCerca(filas, p.cy, 'cy'), c = masCerca(cols, p.cx, 'cx');
    if (Math.abs(filas[f].cy - p.cy) > alto * 0.8) continue;
    const cel = celdas[f][c] ||= { votos: new Map(), bruto: '', porPasada: new Map() };
    if (p.hora) {
      votar(cel, p.hora, p.c);
      const ya = cel.porPasada.get(p.pasada);
      if (ya && ya !== p.hora) cel.choque = true;
      cel.porPasada.set(p.pasada, p.hora);
    } else if (!cel.bruto && /[\p{L}\d]/u.test(p.t)) cel.bruto = p.t;
  }
  for (const fila of celdas) for (const cel of fila) if (cel) { decidir(cel, nPasadas); if (!cel.t && !cel.bruto) cel.bruto = '?'; }

  // título y encabezados: lo que está por encima de la primera fila de horarios, pasada por pasada
  const cab = P.filter(p => p.cy < arriba && !p.hora);
  const altoLetra = mediana(cab.filter(p => /\p{L}{3,}/u.test(p.t)).map(p => p.y1 - p.y0)) || alto;
  const limite = i => [i ? (cols[i - 1].cx + cols[i].cx) / 2 : -Infinity, i < cols.length - 1 ? (cols[i].cx + cols[i + 1].cx) / 2 : Infinity];
  const titulos = [], porColumna = cols.map(() => []);
  for (let i = 0; i < nPasadas; i++) {
    const mias = cab.filter(p => p.pasada === i);
    const lineas = grupos(mias, p => p.cy, altoLetra * 0.6);
    const deTitulo = lineas.filter(l => CLAVE_TITULO.test(sinAcentos(l.map(p => p.t).join(' '))));
    // por debajo del título está el encabezado; sin título, tomo solo lo que está pegado a la tabla
    const piso = deTitulo.length ? Math.max(...deTitulo.flat().map(p => p.cy)) + altoLetra * 0.4 : arriba - alto * 8;
    if (deTitulo.length) titulos.push(deTitulo.map(l => l.sort((a, b) => a.x0 - b.x0).map(p => p.t).join(' ')).join(' '));
    const enc = mias.filter(p => !deTitulo.some(l => l.includes(p)) && p.cy > piso);
    cols.forEach((_, c) => { const [a, b] = limite(c); porColumna[c].push(candidatoDeNombre(enc.filter(p => p.cx >= a && p.cx < b), altoLetra, vocab)); });
  }
  const nombres = porColumna.map((cands, i) => nombreDeColumna(cands) || `Columna ${i + 1}`);
  // un encabezado al que le falta una palabra ("Santa y Laprida") se completa con el de la otra columna que
  // tiene las mismas y alguna más ("Santa Fe y Laprida"), si hay una sola así
  const pals = nombres.map(n => sinAcentos(n).split(/[^a-z0-9ñ]+/).filter(Boolean));
  nombres.forEach((n, i) => {
    const mayores = [...new Set(nombres.filter((m, j) => j !== i && pals[j].length > pals[i].length && pals[i].length && pals[i].every(p => pals[j].includes(p))))];
    if (mayores.length === 1) nombres[i] = mayores[0];
  });
  const leidos = titulos.map(leerTitulo);
  const masVotado = k => { const v = leidos.map(x => x[k]).filter(Boolean); return v.sort((a, b) => v.filter(x => x === b).length - v.filter(x => x === a).length)[0] || (k === 'tipo' ? null : ''); };
  const titulo = titulos.sort((a, b) => b.length - a.length)[0] || '';

  const tabla = { titulo, linea: masVotado('linea'), tipo: masVotado('tipo'), vigencia: masVotado('vigencia'), nombres, cols, filas, celdas, alto, ancho, nPasadas };
  afinar(tabla);
  return tabla;
}

/**
 * entrada: una lista de palabras [{ t, c (confianza 0-100), x0, y0, x1, y1 }] o varias (una por pasada),
 * todas en las mismas coordenadas. Devuelve una tabla por cada planilla que haya en la imagen.
 * Cada tabla: { titulo, linea, tipo, vigencia, nombres[], cols[], filas[], celdas[fila][col] }
 * y cada celda es null (vacía) o { t: "H:MM" | null, bruto, c, firme, cands, nota }.
 */
export function armarTablas(entrada, { vocabulario, soloTexto = [] } = {}) {
  const pasadas = Array.isArray(entrada[0]) ? entrada : [entrada];
  const P = [];
  pasadas.forEach((lista, i) => { for (const p of lista) if (p.t && !RUIDO.test(p.t)) P.push({ ...p, pasada: i, cx: (p.x0 + p.x1) / 2, cy: (p.y0 + p.y1) / 2, hora: horaDeTexto(p.t), mudo: soloTexto.includes(i) }); });
  const H = P.filter(p => p.hora && !p.mudo);
  const error = () => new Error('No encontré una tabla de horarios en la imagen. Probá con la imagen original de la planilla, o con una foto más derecha y con mejor luz.');
  if (H.length < 4) throw error();
  const alto = mediana(H.map(p => p.y1 - p.y0));
  // filas de toda la imagen; donde hay un hueco grande con texto en el medio empieza otra planilla
  const filas = grupos(H, p => p.cy, alto * 0.6).map(g => ({ cy: mediana(g.map(p => p.cy)), y1: Math.max(...g.map(p => p.y1)) }));
  const paso = mediana(filas.slice(1).map((f, i) => f.cy - filas[i].cy)) || alto * 2;
  const cortes = [-Infinity];
  for (let i = 1; i < filas.length; i++) {
    const hueco = filas[i].cy - filas[i - 1].cy;
    if (hueco < Math.max(paso * 2.2, alto * 3)) continue;
    const enMedio = P.filter(p => !p.hora && p.pasada === 0 && p.cy > filas[i - 1].y1 && p.cy < filas[i].cy - alto && /\p{L}{3,}/u.test(p.t));
    if (enMedio.length >= 2) cortes.push(filas[i - 1].y1 + alto * 0.4);
  }
  cortes.push(filas.at(-1).y1 + alto * 0.5);
  const tablas = [];
  for (let i = 1; i < cortes.length; i++) {
    const parte = P.filter(p => p.cy > cortes[i - 1] && p.cy <= cortes[i]);
    if (parte.filter(p => p.hora && !p.mudo).length >= 4) tablas.push(armarUna(parte, pasadas.length, vocabulario));
  }
  if (!tablas.length) throw error();
  return tablas;
}
/** Igual que armarTablas pero devuelve solo la primera planilla de la imagen. */
export const armarTabla = (entrada, opciones) => armarTablas(entrada, opciones)[0];

/** Parte de las celdas con algo que no quedó firme ni calza con el resto (0 = todo bien leído). */
export function flojas(tablas) {
  let con = 0, mal = 0;
  for (const t of tablas) for (const fila of t.celdas) for (const cel of fila) if (cel) { con++; if (!cel.t || !(cel.firme || cel.calza)) mal++; }
  return con ? mal / con : 1;
}

/** Rectángulo de una celda dentro de la imagen (para volver a leerla sola), sin pisar las líneas de la grilla. */
export function cajaDeCelda(tabla, f, c) {
  const { cols, filas, alto, ancho } = tabla;
  const medio = Math.max(...cols.map(k => k.x1 - k.x0), ancho) / 2 + ancho * 0.22;
  const izq = c ? (cols[c - 1].cx + cols[c].cx) / 2 + ancho * 0.04 : -Infinity, der = c < cols.length - 1 ? (cols[c].cx + cols[c + 1].cx) / 2 - ancho * 0.04 : Infinity;
  const arr = f ? (filas[f - 1].cy + filas[f].cy) / 2 + alto * 0.08 : -Infinity, aba = f < filas.length - 1 ? (filas[f].cy + filas[f + 1].cy) / 2 - alto * 0.08 : Infinity;
  const x0 = Math.max(cols[c].cx - medio, izq, 0), x1 = Math.min(cols[c].cx + medio, der);
  const y0 = Math.max(filas[f].cy - alto * 0.85, arr, 0), y1 = Math.min(filas[f].cy + alto * 0.85, aba);
  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}

/** ¿Esa hora entra en una celda vacía sin romper el orden de la fila ni de la columna? */
function encaja(tabla, f, c, hora) {
  const m = aMin(hora);
  const vecino = (df, dc) => {
    for (let ff = f + df, cc = c + dc, pasos = 1; ff >= 0 && cc >= 0 && ff < tabla.filas.length && cc < tabla.cols.length; ff += df, cc += dc, pasos++) {
      const x = tabla.celdas[ff][cc];
      if (x?.t) return { m: aMin(x.t), pasos };
    }
    return null;
  };
  // b viene después de a: en orden, o a es de la noche y b de la madrugada (pasó la medianoche)
  const enOrden = (a, b) => b >= a || (a >= 20 * 60 && b < 5 * 60);
  // entre columnas vecinas no puede haber más de media hora de viaje por columna
  const cerca = (a, b, pasos) => tramo(a, b) <= 30 * pasos;
  const izq = vecino(0, -1), der = vecino(0, 1), arr = vecino(-1, 0), aba = vecino(1, 0);
  return (!izq || (enOrden(izq.m, m) && cerca(izq.m, m, izq.pasos))) && (!der || (enOrden(m, der.m) && cerca(m, der.m, der.pasos)))
    && (!arr || enOrden(arr.m, m)) && (!aba || enOrden(m, aba.m));
}

/**
 * Segunda pasada: vuelve a leer celdas sueltas, de cerca (releer(caja) -> texto o lista de textos candidatos).
 * Cada relectura suma votos a la celda. Una celda vacía solo se completa si la hora encaja en su fila y su
 * columna, y queda marcada para confirmar. todas=false relee solo las vacías, ilegibles o que no quedaron firmes.
 */
export async function segundaPasada(tabla, releer, { todas = false, alAvanzar } = {}) {
  const lista = [];
  tabla.celdas.forEach((fila, f) => fila.forEach((cel, c) => { if (todas || !cel || !cel.t || !(cel.firme || cel.calza) || cel.choque) lista.push([f, c]); }));
  let hechas = 0;
  for (const [f, c] of lista) {
    const cel = tabla.celdas[f][c];
    const textos = [await releer(cajaDeCelda(tabla, f, c), { vacia: !cel })].flat().map(x => String(x || '').trim());
    const horas = textos.map(horaDeTexto).filter(Boolean);
    alAvanzar?.(++hechas, lista.length);
    if (!cel) {
      const h = horas.find(x => encaja(tabla, f, c, x));
      if (h) {
        const nueva = tabla.celdas[f][c] = { votos: new Map(), bruto: h, porPasada: new Map(), releida: true, notaFija: true, nota: 'apareció recién al mirar la celda de cerca: confirmala con la foto' };
        votar(nueva, h, 0); decidir(nueva, tabla.nPasadas);
      }
      continue;
    }
    const antes = cel.t;
    // si la celda era ilegible, solo acepto una hora que encaje en su fila y su columna
    for (const h of horas) if (antes || encaja(tabla, f, c, h)) votar(cel, h, 60);
    cel.releida = true;
    decidir(cel, tabla.nPasadas);
    if (!antes && cel.t) { cel.notaFija = true; cel.nota = `costó leerla (primero salió "${cel.bruto}"): confirmala con la foto`; }
  }
  afinar(tabla);
  return tabla;
}

/** Pasa la tabla al mismo formato que devuelve el lector por API (js/lector.js). */
export function resultadoDeTabla(tabla) {
  const dudas = [], sinFormato = [], filas = [];
  for (const fila of tabla.celdas) {
    if (!fila.some(c => c)) continue;
    const f = filas.length;
    // los minutos se calculan con la fila entera (para pasar bien la medianoche), como en el resto de la app
    let prev = null;
    filas.push(fila.map((cel, c) => {
      if (!cel) return null;
      if (!cel.t) { sinFormato.push({ fila: f, columna: c, texto: cel.bruto }); return null; } // ilegible: queda en rojo para corregir
      let m = aMin(cel.t);
      if (m == null) { sinFormato.push({ fila: f, columna: c, texto: cel.bruto }); return null; }
      if (prev != null && m < prev - 720) m += 1440;
      prev = m;
      if (cel.nota) dudas.push({ fila: f, columna: c, nota: cel.nota });
      return m;
    }));
  }
  return { linea: tabla.linea, tipo: tabla.tipo, titulo: tabla.titulo, vigencia: tabla.vigencia, nombres: tabla.nombres, filas, dudas, sinFormato };
}
