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

// ---------- mapa ----------
// Mapa SVG propio (sin servidores de mapas): calles de OpenStreetMap guardadas en data/calles.json, recorrido,
// paradas, buses estimados y tu posición. Se mueve arrastrando y se acerca con +/− o pellizcando.
const R_TIERRA = 111195, NS = 'http://www.w3.org/2000/svg';
const vistas = new Map();        // clave -> { cx, cy, esc } lo que el usuario movió o acercó (se conserva al repintar)
const cajas = new WeakMap();     // calle -> caja que la contiene (en metros)

/** Dibuja un mapa. Devuelve un nodo (contenedor con el SVG y los botones). clave = para recordar el zoom entre repintados. */
export function mapa({ clave = 'mapa', rutas = [], paradas = [], marcas = [], calles = null, buses = [], alto = 380, leyenda = null }) {
  const todos = [...rutas.flat(), ...paradas.map(p => [p.lat, p.lon]), ...marcas.map(p => [p.lat, p.lon]), ...buses.map(p => [p.lat, p.lon])];
  if (!todos.length) return h('div');
  const k = Math.cos(todos[0][0] * Math.PI / 180);
  const X = lo => lo * k * R_TIERRA, Y = la => -la * R_TIERRA;     // metros
  const W = 340, H = alto;
  // vista que encuadra todo
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [la, lo] of todos) { x0 = Math.min(x0, X(lo)); x1 = Math.max(x1, X(lo)); y0 = Math.min(y0, Y(la)); y1 = Math.max(y1, Y(la)); }
  const ajustada = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, esc: Math.min((W - 36) / Math.max(x1 - x0, 50), (H - 36) / Math.max(y1 - y0, 50)) };
  const ESC_MIN = ajustada.esc / 3, ESC_MAX = 0.6;               // píxeles por metro
  let v = vistas.get(clave) || { ...ajustada };

  const cont = h('div', { class: 'mapa-caja' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'mapa'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mapa del recorrido'); svg.style.touchAction = 'none';
  svg.style.aspectRatio = `${W} / ${H}`;
  const add = (padre, tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const [a, val] of Object.entries(at)) e.setAttribute(a, val); if (txt != null) e.textContent = txt; padre.append(e); return e; };

  const px = lo => (W / 2 + (X(lo) - v.cx) * v.esc), py = la => (H / 2 + (Y(la) - v.cy) * v.esc);

  function dibujar() {
    svg.replaceChildren();
    const g = add(svg, 'g', {});
    const dentro = (lo, la) => { const a = px(lo), b = py(la); return a > -20 && a < W + 20 && b > -20 && b < H + 20; };
    // calles (decimadas: un punto cada ~1,5 px para no cargar el teléfono)
    if (calles) {
      const etiquetas = [];
      const trazo = { fill: 'none', style: 'stroke: var(--calle)', 'stroke-width': v.esc > 0.12 ? 2.4 : v.esc > 0.04 ? 1.6 : 1, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
      let dCalles = '';   // todas las calles en un solo trazo: un único nodo en vez de miles
      for (const c of calles) {
        let b = cajas.get(c);
        if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; for (const t of c.t) for (const [la, lo] of t) { b[0] = Math.min(b[0], X(lo)); b[1] = Math.min(b[1], Y(la)); b[2] = Math.max(b[2], X(lo)); b[3] = Math.max(b[3], Y(la)); } cajas.set(c, b); }
        const ax = W / 2 + (b[0] - v.cx) * v.esc, ay = H / 2 + (b[1] - v.cy) * v.esc, bx = W / 2 + (b[2] - v.cx) * v.esc, by = H / 2 + (b[3] - v.cy) * v.esc;
        if (bx < -20 || ax > W + 20 || by < -20 || ay > H + 20) continue;
        let mejor = null;
        for (const t of c.t) {
          const ps = []; let ux = -1e9, uy = -1e9, largo = 0, ult = null;
          for (const [la, lo] of t) {
            const a = px(lo), bb = py(la);
            if (Math.abs(a - ux) < 1.5 && Math.abs(bb - uy) < 1.5) continue;
            ps.push(a.toFixed(1) + ',' + bb.toFixed(1)); if (ult) largo += Math.hypot(a - ult[0], bb - ult[1]); ult = [a, bb]; ux = a; uy = bb;
          }
          if (ps.length < 2) continue;
          dCalles += 'M' + ps.join('L');
          if (!mejor || largo > mejor.largo) mejor = { largo, t };
        }
        if (mejor && v.esc > 0.05 && mejor.largo > 70) etiquetas.push({ nombre: c.n, t: mejor.t, largo: mejor.largo });
      }
      if (dCalles) add(g, 'path', { d: dCalles, ...trazo });
      // nombres de calle (solo con zoom, y sin que se pisen)
      if (etiquetas.length) {
        etiquetas.sort((a, b) => b.largo - a.largo);
        const puestas = [];
        for (const e of etiquetas) {
          if (puestas.length >= 22) break;
          const pts = e.t.map(([la, lo]) => [px(lo), py(la)]).filter(([a, b]) => a > 6 && a < W - 6 && b > 6 && b < H - 6);
          if (pts.length < 2) continue;
          let i = Math.floor(pts.length / 2); if (i < 1) i = 1;
          const [ax, ay] = pts[i - 1], [bx, by] = pts[i], mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (puestas.some(([a, b]) => Math.hypot(a - mx, b - my) < 55)) continue;
          let ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
          add(g, 'text', { x: mx, y: my, transform: `rotate(${ang.toFixed(0)} ${mx.toFixed(1)} ${my.toFixed(1)})`, 'font-size': 7.5, 'text-anchor': 'middle', style: 'fill: var(--suave)', stroke: 'var(--fondo)', 'stroke-width': 2, 'paint-order': 'stroke', 'pointer-events': 'none' }, e.nombre);
          puestas.push([mx, my]);
        }
      }
    }
    // recorrido(s)
    rutas.forEach((r, i) => add(g, 'polyline', { points: r.map(p => px(p[1]).toFixed(1) + ',' + py(p[0]).toFixed(1)).join(' '), fill: 'none', stroke: i ? '#2563eb' : '#16a34a', 'stroke-width': 3.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: i ? .65 : .95 }));
    for (const p of paradas) if (dentro(p.lon, p.lat)) add(g, 'circle', { cx: px(p.lon).toFixed(1), cy: py(p.lat).toFixed(1), r: v.esc > 0.06 ? 3.2 : 2.2, fill: '#fff', stroke: '#166534', 'stroke-width': 1 });
    // buses estimados: círculo del color del sentido con el número de línea
    for (const b of buses) {
      if (!dentro(b.lon, b.lat)) continue;
      const a = px(b.lon), c = py(b.lat);
      add(g, 'circle', { cx: a.toFixed(1), cy: c.toFixed(1), r: 9, fill: b.color, stroke: '#fff', 'stroke-width': 2 });
      add(g, 'text', { x: a.toFixed(1), y: (c + 3.3).toFixed(1), 'font-size': String(b.texto.length > 2 ? 7 : 8.5), 'font-weight': 800, 'text-anchor': 'middle', fill: '#fff', 'pointer-events': 'none' }, b.texto);
    }
    for (const m of marcas) {
      if (!dentro(m.lon, m.lat)) continue;
      const a = px(m.lon), c = py(m.lat);
      add(g, 'circle', { cx: a.toFixed(1), cy: c.toFixed(1), r: 7, fill: m.color || '#dc2626', stroke: '#fff', 'stroke-width': 2 });
      if (m.texto) {
        const der = a < W * 0.6;
        add(g, 'text', { x: (a + (der ? 10 : -10)).toFixed(1), y: (c + 4).toFixed(1), 'font-size': 11, 'font-weight': 700, fill: 'currentColor', 'text-anchor': der ? 'start' : 'end', stroke: 'var(--fondo)', 'stroke-width': 3, 'paint-order': 'stroke', 'pointer-events': 'none' }, m.texto);
      }
    }
    return g;
  }

  let g = dibujar();
  const guardar = () => vistas.set(clave, { ...v });
  const zoom = (f, ancla = [W / 2, H / 2]) => {
    const e = Math.min(ESC_MAX, Math.max(ESC_MIN, v.esc * f));
    // el punto bajo el dedo (ancla) se queda quieto
    v = { cx: v.cx + (ancla[0] - W / 2) * (1 / v.esc - 1 / e), cy: v.cy + (ancla[1] - H / 2) * (1 / v.esc - 1 / e), esc: e };
    guardar(); g = dibujar();
  };
  const aSvg = ev => { const r = svg.getBoundingClientRect(); return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height]; };

  // arrastrar y pellizcar: mientras el dedo se mueve se mueve el dibujo; al soltar se vuelve a dibujar bien
  const punteros = new Map();
  let ini = null;
  svg.addEventListener('pointerdown', ev => { svg.setPointerCapture(ev.pointerId); punteros.set(ev.pointerId, aSvg(ev)); ini = { pts: [...punteros.values()], v: { ...v } }; });
  svg.addEventListener('pointermove', ev => {
    if (!punteros.has(ev.pointerId) || !ini) return;
    punteros.set(ev.pointerId, aSvg(ev));
    const ps = [...punteros.values()];
    if (ps.length === 1 && ini.pts.length === 1) {
      const dx = ps[0][0] - ini.pts[0][0], dy = ps[0][1] - ini.pts[0][1];
      g.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`); ini.dx = dx; ini.dy = dy;
    } else if (ps.length >= 2 && ini.pts.length >= 2) {
      const d0 = Math.hypot(ini.pts[0][0] - ini.pts[1][0], ini.pts[0][1] - ini.pts[1][1]) || 1, d1 = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]);
      const f = d1 / d0, mx = (ini.pts[0][0] + ini.pts[1][0]) / 2, my = (ini.pts[0][1] + ini.pts[1][1]) / 2;
      g.setAttribute('transform', `translate(${(mx - mx * f).toFixed(1)} ${(my - my * f).toFixed(1)}) scale(${f.toFixed(3)})`); ini.f = f; ini.m = [mx, my];
    }
  });
  const soltar = ev => {
    if (!punteros.has(ev.pointerId)) return;
    punteros.delete(ev.pointerId);
    if (ini?.dx != null && !ini.f) { v = { ...ini.v, cx: ini.v.cx - ini.dx / ini.v.esc, cy: ini.v.cy - ini.dy / ini.v.esc }; guardar(); g = dibujar(); }
    else if (ini?.f) { v = { ...ini.v }; zoom(ini.f, ini.m); }
    ini = punteros.size ? { pts: [...punteros.values()], v: { ...v } } : null;
  };
  svg.addEventListener('pointerup', soltar); svg.addEventListener('pointercancel', soltar);
  svg.addEventListener('wheel', ev => { ev.preventDefault(); zoom(ev.deltaY < 0 ? 1.35 : 1 / 1.35, aSvg(ev)); }, { passive: false });

  const yo = marcas.find(m => m.texto === 'Vos');
  const botones = h('div', { class: 'mapa-botones' },
    h('button', { 'aria-label': 'Acercar', onclick: () => zoom(1.5) }, '＋'),
    h('button', { 'aria-label': 'Alejar', onclick: () => zoom(1 / 1.5) }, '－'),
    h('button', { 'aria-label': 'Ver todo el recorrido', title: 'Ver todo', onclick: () => { v = { ...ajustada }; guardar(); g = dibujar(); } }, '⤢'),
    yo && h('button', { 'aria-label': 'Centrar en mi posición', title: 'Centrar en mí', onclick: () => { v = { cx: X(yo.lon), cy: Y(yo.lat), esc: Math.max(v.esc, 0.09) }; guardar(); g = dibujar(); } }, '◎'));
  cont.append(svg, botones);
  if (leyenda) cont.append(h('div', { class: 'mapa-leyenda' }, leyenda));
  return cont;
}
