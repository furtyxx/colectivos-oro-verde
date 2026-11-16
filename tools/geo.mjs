// Geometría y búsqueda de calles compartidas por los generadores de datos (copiadas de actualizar.mjs).
// Puntos = [lat, lon]. indiceCalles(...).cruces(a, b) devuelve los puntos donde se cruzan dos calles por nombre.

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


/** Distancia (m) de un punto a un recorrido y metros desde su comienzo hasta el punto más cercano. */
function ubicarEnRecorrido(p, pts) {
  let acum = 0, mejor = null;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]), pr = proySeg(p, pts[i - 1], pts[i]);
    if (!mejor || pr.d < mejor.d) mejor = { d: pr.d, m: acum + pr.t * l };
    acum += l;
  }
  return mejor;
}

export { dist, proySeg, norm, tokens, coincide, indiceCalles, ubicarEnRecorrido, r5 };
