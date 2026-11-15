// Arma la tabla de una planilla a partir de las palabras que reconoce el lector del teléfono (OCR).
// Lógica pura: no toca el DOM, así se puede probar con node (tools/probar.mjs).
import { aMin, sinAcentos, claveDePunto } from './motor.js';

/** Nombre prolijo de los puntos que ya conozco, para no guardar encabezados cortados ("Faculta d"). */
const NOMBRE_PUNTO = {
  facultad: 'Facultad', escalberdi: 'Esc Alberdi', inta: 'INTA', km5: 'KM 5 1/2', virgen: 'La Virgen',
  terminal: 'Terminal', cruzsur: 'Américas y Cruz Sur', plazaalberdi: 'Plaza Alberdi',
  lapridacordoba: 'Laprida y Córdoba', '25mayo9julio': '25 de Mayo y 9 de Julio',
};

const mediana = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const RUIDO = /^[\s|_—–\-.,:;'"`~^*°!¡()[\]{}\\/]*$/;

/** Texto reconocido -> "H:MM" si es una hora (tolera las confusiones típicas del OCR), o null. */
export function horaDeTexto(texto) {
  let s = String(texto ?? '').trim().replace(/^[|[\]!¡]+|[|[\]!¡]+$/g, '');
  if (!/\d/.test(s) || s.length > 6) return null;
  if ((s.match(/\d/g) || []).length >= 2) s = s.replace(/[oOQD]/g, '0').replace(/[lIi]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/[Zz]/g, '2');
  const m = /^(\d{1,2})\s*[:.;,'’·]\s*(\d{2})$/.exec(s) || /^(\d{1,2})(\d{2})$/.exec(s);
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

function nombreDeColumna(pals, altoLetra) {
  if (!pals.length) return '';
  const lineas = grupos(pals, p => p.cy, altoLetra * 0.6).map(l => l.sort((a, b) => a.x0 - b.x0).map(p => p.t));
  const crudo = lineas.map(l => l.join(' ')).join(' ').replace(/\s+/g, ' ').trim();
  const clave = claveDePunto(crudo);
  if (clave && NOMBRE_PUNTO[clave]) return NOMBRE_PUNTO[clave];
  // encabezado desconocido: pego los pedacitos de palabra cortada ("Hospit" + "al")
  const partes = [];
  for (const l of lineas) {
    if (partes.length && l.length === 1 && /^\p{Ll}{1,2}$/u.test(l[0]) && !/^[yeao]$/.test(l[0]) && /\p{L}$/u.test(partes.at(-1))) partes[partes.length - 1] += l[0];
    else partes.push(...l);
  }
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

function leerTitulo(titulo) {
  const n = sinAcentos(titulo);
  const lin = /linea\s*(\d+\s?[a-z]?\b)/.exec(n);
  const tipos = [[/habil|lunes|viernes/, 'habil'], [/sabado/, 'sabado'], [/domingo|feriado/, 'domingo']].filter(([re]) => re.test(n)).map(x => x[1]);
  const vig = /\(([^)]+)\)/.exec(titulo) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.exec(titulo);
  return {
    linea: lin ? lin[1].replace(/\s/g, '').toUpperCase() : '',
    tipo: tipos.length === 1 ? tipos[0] : null,
    vigencia: vig ? (vig[1] || vig[0]).trim().replace(/[),.;]+$/, '') : '',
  };
}

/**
 * palabras: [{ t, c (confianza 0-100), x0, y0, x1, y1 }]
 * Devuelve { titulo, linea, tipo, vigencia, nombres[], cols[], filas[], celdas[fila][col] }
 * donde cada celda es null (vacía) o { t: "H:MM" | null, bruto, c }.
 */
export function armarTabla(palabras) {
  const P = palabras.filter(p => p.t && !RUIDO.test(p.t)).map(p => ({ ...p, cx: (p.x0 + p.x1) / 2, cy: (p.y0 + p.y1) / 2, hora: horaDeTexto(p.t) }));
  const H = P.filter(p => p.hora);
  if (H.length < 4) throw new Error('No encontré una tabla de horarios en la imagen. Probá con una foto más derecha y con mejor luz, o con la captura original.');
  const alto = mediana(H.map(p => p.y1 - p.y0)), ancho = mediana(H.map(p => p.x1 - p.x0));

  const borde = (g, k0, k1) => ({ a: Math.min(...g.map(p => p[k0])), b: Math.max(...g.map(p => p[k1])) });
  let filas = grupos(H, p => p.cy, alto * 0.6).map(g => ({ cy: mediana(g.map(p => p.cy)), y0: borde(g, 'y0', 'y1').a, y1: borde(g, 'y0', 'y1').b, n: g.length }));
  const cols = grupos(H, p => p.cx, ancho * 0.45).map(g => ({ cx: mediana(g.map(p => p.cx)), x0: borde(g, 'x0', 'x1').a, x1: borde(g, 'x0', 'x1').b, n: g.length }));
  // una "fila" suelta de un solo número muy arriba suele ser parte del título (un año, una fecha)
  while (filas.length > 2 && filas[0].n === 1 && filas[1].cy - filas[0].cy > alto * 2.5) filas.shift();

  const masCerca = (lista, v, k) => { let mejor = 0; lista.forEach((x, i) => { if (Math.abs(x[k] - v) < Math.abs(lista[mejor][k] - v)) mejor = i; }); return mejor; };
  const celdas = filas.map(() => cols.map(() => null));
  const arriba = filas[0].y0 - alto * 0.3;
  for (const p of P) {
    if (p.cy < arriba) continue;
    const f = masCerca(filas, p.cy, 'cy'), c = masCerca(cols, p.cx, 'cx');
    if (Math.abs(filas[f].cy - p.cy) > alto * 0.8) continue;
    const ya = celdas[f][c], nueva = { t: p.hora, bruto: p.t, c: p.c };
    if (!ya || (!ya.t && nueva.t) || (!!ya.t === !!nueva.t && nueva.c > ya.c)) celdas[f][c] = ya ? { ...nueva, choque: true } : nueva;
    else ya.choque = true;
  }

  // encabezados y título: todo lo que está por encima de la primera fila de horarios
  const cab = P.filter(p => p.cy < arriba && !p.hora);
  const altoLetra = mediana(cab.filter(p => /\p{L}{3,}/u.test(p.t)).map(p => p.y1 - p.y0)) || alto;
  const ancla = cab.find(p => /^l[ií]nea$/i.test(p.t)) || cab.find(p => /^horarios?$/i.test(p.t));
  const deTitulo = ancla ? cab.filter(p => Math.abs(p.cy - ancla.cy) < altoLetra * 0.7) : [];
  const titulo = deTitulo.sort((a, b) => a.x0 - b.x0).map(p => p.t).join(' ');
  const limite = i => [i ? (cols[i - 1].cx + cols[i].cx) / 2 : -Infinity, i < cols.length - 1 ? (cols[i].cx + cols[i + 1].cx) / 2 : Infinity];
  const nombres = cols.map((_, i) => {
    const [a, b] = limite(i);
    return nombreDeColumna(cab.filter(p => !deTitulo.includes(p) && p.cx >= a && p.cx < b && p.cy > (ancla ? ancla.cy + altoLetra * 0.4 : -Infinity)), altoLetra) || `Columna ${i + 1}`;
  });

  return { titulo, ...leerTitulo(titulo), nombres, cols, filas, celdas, alto, ancho };
}

/** Rectángulo de una celda dentro de la imagen (para volver a leerla sola), sin pisar las líneas de la grilla. */
export function cajaDeCelda(tabla, f, c) {
  const { cols, filas, alto, ancho } = tabla;
  const medio = Math.max(...cols.map(k => k.x1 - k.x0), ancho) / 2 + ancho * 0.22;
  const izq = c ? (cols[c - 1].cx + cols[c].cx) / 2 + 3 : -Infinity, der = c < cols.length - 1 ? (cols[c].cx + cols[c + 1].cx) / 2 - 3 : Infinity;
  const arr = f ? (filas[f - 1].cy + filas[f].cy) / 2 + 2 : -Infinity, aba = f < filas.length - 1 ? (filas[f].cy + filas[f + 1].cy) / 2 - 2 : Infinity;
  const x0 = Math.max(cols[c].cx - medio, izq, 0), x1 = Math.min(cols[c].cx + medio, der);
  const y0 = Math.max(filas[f].cy - alto * 0.85, arr, 0), y1 = Math.min(filas[f].cy + alto * 0.85, aba);
  return { left: Math.round(x0), top: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}

/** ¿Esa hora entra en la celda sin romper el orden de la fila ni de la columna? */
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
  const cerca = (a, b, pasos) => ((b - a + 1440) % 1440) <= 30 * pasos;
  const izq = vecino(0, -1), der = vecino(0, 1), arr = vecino(-1, 0), aba = vecino(1, 0);
  return (!izq || (enOrden(izq.m, m) && cerca(izq.m, m, izq.pasos))) && (!der || (enOrden(m, der.m) && cerca(m, der.m, der.pasos)))
    && (!arr || enOrden(arr.m, m)) && (!aba || enOrden(m, aba.m));
}

/**
 * Segunda pasada: vuelve a leer celdas sueltas, de cerca (releer(caja) -> texto o lista de textos candidatos).
 * - celda vacía que ahora da una hora que encaja en su fila y su columna: se completa y queda en duda;
 * - celda ilegible que ahora da una hora: se completa y queda en duda;
 * - celda donde las dos lecturas no coinciden: queda en duda con las dos versiones.
 * todas=false relee solo las vacías, ilegibles o con poca confianza.
 */
export async function segundaPasada(tabla, releer, { todas = false, alAvanzar } = {}) {
  const lista = [];
  tabla.celdas.forEach((fila, f) => fila.forEach((cel, c) => { if (todas || !cel || !cel.t || cel.c < 75 || cel.choque) lista.push([f, c]); }));
  let hechas = 0;
  for (const [f, c] of lista) {
    const cel = tabla.celdas[f][c];
    const textos = [await releer(cajaDeCelda(tabla, f, c))].flat().map(x => String(x || '').trim());
    const horas = textos.map(horaDeTexto).filter(Boolean), hora = horas[0] || null, queEncaja = horas.find(x => encaja(tabla, f, c, x));
    alAvanzar?.(++hechas, lista.length);
    if (!cel) {
      if (queEncaja) tabla.celdas[f][c] = { t: queEncaja, bruto: queEncaja, c: 0, nota: 'apareció recién al mirar la celda de cerca: confirmala con la foto' };
    } else if (!cel.t) {
      if (queEncaja) Object.assign(cel, { t: queEncaja, nota: `costó leerla (primero salió "${cel.bruto}"): confirmala con la foto` });
    } else if (hora && !horas.includes(cel.t)) cel.nota = `las dos lecturas no coinciden: ${cel.t} o ${hora}`;
    else if (!hora && cel.c < 75) cel.nota = 'se lee con poca seguridad';
  }
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
      if (cel.nota || cel.choque) dudas.push({ fila: f, columna: c, nota: cel.nota || 'había dos textos en la misma celda' });
      return m;
    }));
  }
  return { linea: tabla.linea, tipo: tabla.tipo, titulo: tabla.titulo, vigencia: tabla.vigencia, nombres: tabla.nombres, filas, dudas, sinFormato };
}
