// Ayudas de interfaz: crear nodos, diálogos, avisos y el mapita SVG.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

/** h('div', {class:'x', onclick: f}, hijos…) */
export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const x of hijos.flat(Infinity)) if (x != null && x !== false) el.append(x.nodeType ? x : String(x));
  return el;
}

/** Reemplaza el contenido de un nodo ignorando null/false (para poder escribir "cond && nodo"). */
export function poner(el, ...hijos) {
  el.replaceChildren(...hijos.flat(Infinity).filter(x => x != null && x !== false));
}

let tToast;
export function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(tToast); tToast = setTimeout(() => { t.hidden = true; }, ms);
}

/** Abre un <dialog> modal con el contenido dado. Devuelve { cerrar }. */
export function dialogo(titulo, contenido, { alCerrar } = {}) {
  const d = h('dialog', {}, h('div', { class: 'cuerpo' },
    h('div', { class: 'fila' }, h('h2', { class: 'crece' }, titulo), h('button', { class: 'btn mini', onclick: () => d.close() }, 'Cerrar')),
    contenido));
  d.addEventListener('close', () => { d.remove(); alCerrar?.(); });
  document.body.append(d);
  d.showModal();
  return { cerrar: () => d.close(), el: d };
}

export function confirmar(texto, etiqueta = 'Sí') {
  return new Promise(res => {
    let r = false;
    const dl = dialogo('Confirmar', h('div', { class: 'cuerpo', style: 'padding:0' },
      h('p', {}, texto),
      h('div', { class: 'fila' },
        h('button', { class: 'btn crece', onclick: () => dl.cerrar() }, 'Cancelar'),
        h('button', { class: 'btn pri crece', onclick: () => { r = true; dl.cerrar(); } }, etiqueta))), { alCerrar: () => res(r) });
  });
}

export const fmtM = m => m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m / 10) * 10 + ' m';
export const hoyISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export function fechaLinda(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}
export const gmaps = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
export const gmapsAPie = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;

/**
 * Mapa esquemático sin conexión: recorridos (listas de [lat, lon]), paradas y marcas.
 * marcas: [{lat, lon, color, texto}]
 */
export function mapa({ rutas = [], paradas = [], marcas = [] }) {
  const pts = [...rutas.flat(), ...paradas.map(p => [p.lat, p.lon]), ...marcas.map(p => [p.lat, p.lon])];
  if (!pts.length) return h('div');
  const k = Math.cos(pts[0][0] * Math.PI / 180);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [la, lo] of pts) { x0 = Math.min(x0, lo * k); x1 = Math.max(x1, lo * k); y0 = Math.min(y0, -la); y1 = Math.max(y1, -la); }
  const W = 320, M = 16, ancho = Math.max(x1 - x0, 1e-4), alto = Math.max(y1 - y0, 1e-4);
  const esc = Math.min((W - 2 * M) / ancho, 420 / alto), H = Math.round(alto * esc + 2 * M);
  const ox = (W - ancho * esc) / 2;
  const X = lo => (ox + (lo * k - x0) * esc).toFixed(1), Y = la => (M + (-la - y0) * esc).toFixed(1);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'mapa'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Mapa del recorrido');
  const add = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const [a, v] of Object.entries(at)) e.setAttribute(a, v); if (txt) e.textContent = txt; svg.append(e); return e; };
  rutas.forEach((r, i) => add('polyline', { points: r.map(p => X(p[1]) + ',' + Y(p[0])).join(' '), fill: 'none', stroke: i ? '#2563eb' : '#16a34a', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: i ? .6 : 1 }));
  for (const p of paradas) add('circle', { cx: X(p.lon), cy: Y(p.lat), r: 2.2, fill: '#fff', stroke: '#166534', 'stroke-width': 1 });
  for (const m of marcas) {
    add('circle', { cx: X(m.lon), cy: Y(m.lat), r: 7, fill: m.color || '#dc2626', stroke: '#fff', 'stroke-width': 2 });
    if (m.texto) {
      const der = +X(m.lon) < W * 0.6;
      add('text', { x: +X(m.lon) + (der ? 10 : -10), y: +Y(m.lat) + 4, 'font-size': 11, 'font-weight': 700, fill: 'currentColor', 'text-anchor': der ? 'start' : 'end', stroke: 'var(--fondo)', 'stroke-width': 3, 'paint-order': 'stroke' }, m.texto);
    }
  }
  return svg;
}
