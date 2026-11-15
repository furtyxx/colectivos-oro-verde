// Pestaña "Planillas": ver, editar, cargar a mano o leer desde una foto.
import { h, dialogo, toast, confirmar, poner } from './ui.js';
import { E, D, guardar, linea } from './estado.js';
import { aMin, aHora, filaAMin, validarPlanilla, resolverColumnas, dondeVuelve, NOMBRE_TIPO } from './motor.js';
import { leerPlanilla } from './lector.js';

const TIPOS = ['habil', 'sabado', 'domingo'];
const tituloDe = (lin, tipo) => `Línea ${lin} · ${{ habil: 'Hábiles', sabado: 'Sábado', domingo: 'Domingo' }[tipo]}`;
const nuevoId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// ---------- editor ----------
function editor(raiz, original, { nueva = false, foto = null, dudasModelo = [], textos = [], alTerminar }) {
  const w = structuredClone(original);
  w.anclas = { ...(w.anclas || {}) };
  let txt = w.filas.map(f => w.nombres.map((_, c) => (f[c] == null ? '' : aHora(f[c]))));
  for (const x of textos) if (txt[x.fila]?.[x.columna] === '') txt[x.fila][x.columna] = x.texto;
  const notaModelo = new Map(dudasModelo.map(d => [d.fila + ',' + d.columna, d.nota || 'el lector no estaba seguro']));
  const volver = () => { if (foto) URL.revokeObjectURL(foto); alTerminar(); };

  const cols = () => {
    const c = resolverColumnas(linea(w.linea), w.nombres, w.vueltaDesde);
    for (const [i, n] of Object.entries(w.anclas)) if (c[i]) { c[i].parada = n || null; c[i].manual = true; }
    return c;
  };
  const aviso = h('div', {});
  const tabla = h('table', { class: 'grilla' });

  function revisar() { // pinta celdas con error o dudosas sin perder el foco
    const mins = txt.map(f => filaAMin(f.map(c => c.trim() || null)));
    const dudas = validarPlanilla(mins);
    let errores = 0, nDudas = 0;
    tabla.querySelectorAll('td[data-f]').forEach(td => {
      const f = +td.dataset.f, c = +td.dataset.c, k = f + ',' + c, t = txt[f][c].trim();
      const mal = t && aMin(t) == null, por = dudas.get(k) || notaModelo.get(k);
      td.className = (mal ? 'error ' : por ? 'duda ' : '') + (c >= w.vueltaDesde ? 'vuelta' : '');
      td.title = mal ? 'No es una hora válida (H:MM)' : por || '';
      if (mal) errores++; else if (por) nDudas++;
    });
    poner(aviso, 
      errores ? h('p', { class: 'nota mal' }, `${errores} celda(s) en rojo no son una hora válida.`) : null,
      nDudas ? h('p', { class: 'nota ojo' }, `${nDudas} celda(s) en amarillo se salen del patrón de la planilla` + (foto ? ': comparalas con la foto antes de guardar.' : '. Mantené apretada la celda para ver el motivo.'))
        : (!errores ? h('p', { class: 'nota bien' }, 'Los horarios son coherentes entre sí (crecen de izquierda a derecha y de arriba hacia abajo, con tramos parejos).') : null));
    return { mins, errores };
  }

  function elegirParada(i) {
    const c = cols()[i], S = linea(w.linea)?.sentidos[c.sentido];
    if (!S) return toast('Esa línea no tiene recorrido cargado');
    const set = n => { if (n === 'auto') delete w.anclas[i]; else w.anclas[i] = n; dl.cerrar(); pintarTabla(); };
    const dl = dialogo(`¿Dónde queda "${w.nombres[i]}"?`, [
      h('p', { class: 'suave' }, `Sirve para calcular a qué hora pasa por las paradas intermedias (sentido ${c.sentido}).`),
      h('div', { class: 'fila' }, h('button', { class: 'btn mini', onclick: () => set('auto') }, 'Automático'), h('button', { class: 'btn mini', onclick: () => set(0) }, 'Sin ubicar')),
      h('ol', { class: 'lista' }, S.paradas.map(s => h('li', {}, h('button', { onclick: () => set(s.n) }, h('span', { class: 'n' }, s.n), h('span', {}, s.nombre), h('span', {}, c.parada === s.n ? '✓' : ''))))),
    ]);
  }

  function pintarTabla() {
    const C = cols(), L = linea(w.linea);
    poner(tabla, 
      h('thead', {}, h('tr', {}, w.nombres.map((n, i) => {
        const s = C[i].parada ? L?.sentidos[C[i].sentido]?.paradas[C[i].parada - 1] : null;
        return h('th', { class: i >= w.vueltaDesde ? 'vuelta' : '' },
          h('input', { value: n, 'aria-label': `Nombre de la columna ${i + 1}`, onchange: e => { w.nombres[i] = e.target.value.trim(); pintarTabla(); } }),
          h('button', { class: 'btn mini', style: 'min-height:26px;padding:2px 6px;border:0;background:none', onclick: () => elegirParada(i) },
            h('small', {}, (i >= w.vueltaDesde ? '↩ ' : '→ ') + (s ? `${s.n}. ${s.nombre}` : 'sin ubicar') + (C[i].aprox ? ' (aprox.)' : ''))));
      }), h('th', {}, ''))),
      h('tbody', {}, txt.map((fila, f) => h('tr', {}, fila.map((v, c) => h('td', { 'data-f': f, 'data-c': c },
        h('input', { value: v, inputMode: 'numeric', autocomplete: 'off', 'aria-label': `${w.nombres[c]}, fila ${f + 1}`,
          oninput: e => { txt[f][c] = e.target.value; },
          onchange: e => { let t = e.target.value.trim(); if (/^\d{3,4}$/.test(t)) t = t.slice(0, -2) + ':' + t.slice(-2); txt[f][c] = e.target.value = t; notaModelo.delete(f + ',' + c); revisar(); } }))),
        h('td', { class: 'borra' }, h('button', { title: 'Borrar fila', 'aria-label': `Borrar fila ${f + 1}`, onclick: () => { txt.splice(f, 1); notaModelo.clear(); pintarTabla(); } }, '✕'))))));
    poner(selVuelta, ...w.nombres.map((n, i) => i ? h('option', { value: i, selected: i === w.vueltaDesde }, `${i + 1}. ${n}`) : null).filter(Boolean),
      h('option', { value: w.nombres.length, selected: w.vueltaDesde >= w.nombres.length }, 'No tiene vuelta'));
    revisar();
  }

  async function guardarPlanilla() {
    const { mins, errores } = revisar();
    if (errores) return toast('Corregí las celdas en rojo antes de guardar');
    const filas = mins.filter(f => f.some(x => x != null));
    if (!filas.length) return toast('La planilla no tiene horarios');
    const orden = f => f.find(x => x != null);
    filas.sort((a, b) => orden(a) - orden(b));
    const otra = E.planillas.find(p => p.id !== w.id && p.linea === w.linea && p.tipo === w.tipo);
    if (otra && !(await confirmar(`Ya hay una planilla de la línea ${w.linea} para ${NOMBRE_TIPO[w.tipo]} ("${otra.nombre}"). ¿La reemplazo por esta?`, 'Reemplazar'))) return;
    if (otra) { E.planillas.splice(E.planillas.indexOf(otra), 1); if (otra.fuente === 'precargada') E.borradas.push(otra.id); }
    const lista = { ...w, filas, editada: true, actualizada: new Date().toISOString() };
    const i = E.planillas.findIndex(p => p.id === w.id);
    if (i >= 0) E.planillas[i] = lista; else E.planillas.push(lista);
    guardar(); toast('Planilla guardada'); volver();
  }

  const selVuelta = h('select', { onchange: e => { w.vueltaDesde = +e.target.value; pintarTabla(); } });
  const nombre = h('input', { value: w.nombre, onchange: e => { w.nombre = e.target.value.trim() || tituloDe(w.linea, w.tipo); } });
  if (w.vueltaDesde == null) w.vueltaDesde = dondeVuelve(w.nombres);
  poner(raiz, 
    h('div', { class: 'fila' }, h('button', { class: 'btn', onclick: volver }, nueva ? '‹ Descartar' : '‹ Volver'), h('h2', { class: 'crece' }, nueva ? 'Revisar y guardar' : 'Editar planilla')),
    foto && h('details', { class: 'panel', open: true }, h('summary', {}, 'Foto original (comparala con la tabla)'), h('a', { href: foto, target: '_blank' }, h('img', { class: 'foto', src: foto, alt: 'Foto de la planilla' }))),
    h('section', { class: 'panel' },
      h('div', { class: 'dos' },
        h('label', { class: 'campo' }, 'Línea', h('select', { onchange: e => { w.linea = e.target.value; w.anclas = {}; if (nueva) nombre.value = w.nombre = tituloDe(w.linea, w.tipo); pintarTabla(); } }, D.lineas.map(l => h('option', { value: l.id, selected: l.id === w.linea }, l.nombre)))),
        h('label', { class: 'campo' }, 'Tipo de día', h('select', { onchange: e => { w.tipo = e.target.value; if (nueva) nombre.value = w.nombre = tituloDe(w.linea, w.tipo); } }, TIPOS.map(t => h('option', { value: t, selected: t === w.tipo }, NOMBRE_TIPO[t]))))),
      h('label', { class: 'campo' }, 'Nombre', nombre),
      h('label', { class: 'campo' }, 'Vigencia (opcional)', h('input', { value: w.vigencia || '', placeholder: 'ej. desde 26/05/26', onchange: e => { w.vigencia = e.target.value.trim(); } })),
      h('label', { class: 'campo' }, 'La vuelta empieza en la columna', selVuelta)),
    aviso,
    h('div', { class: 'grilla-scroll' }, tabla),
    h('div', { class: 'fila' },
      h('button', { class: 'btn mini', onclick: () => { txt.push(w.nombres.map(() => '')); pintarTabla(); } }, '＋ fila'),
      h('button', { class: 'btn mini', onclick: () => { w.nombres.push('Columna ' + (w.nombres.length + 1)); txt.forEach(f => f.push('')); pintarTabla(); } }, '＋ columna'),
      h('button', { class: 'btn mini', disabled: w.nombres.length <= 1, onclick: async () => { if (!(await confirmar(`¿Borrar la última columna ("${w.nombres.at(-1)}")?`, 'Borrar'))) return; w.nombres.pop(); txt.forEach(f => f.pop()); delete w.anclas[w.nombres.length]; w.vueltaDesde = Math.min(w.vueltaDesde, w.nombres.length); pintarTabla(); } }, '− última columna')),
    h('p', { class: 'suave chico' }, 'Horas en formato 13:42 (también podés tipear 1342). Celda vacía = el servicio no pasa por ahí. Debajo de cada encabezado figura a qué parada del mapa corresponde; tocá para cambiarla.'),
    h('button', { class: 'btn pri grande', onclick: guardarPlanilla }, 'Guardar planilla'));
  pintarTabla();
}

// ---------- alta a mano ----------
function nuevaAMano(raiz, alTerminar) {
  const selL = h('select', {}, D.lineas.map(l => h('option', { value: l.id }, l.nombre)));
  const selT = h('select', {}, TIPOS.map(t => h('option', { value: t }, NOMBRE_TIPO[t])));
  const pares = h('textarea', { placeholder: '5:10-5:46 5:40-6:17 6:00-6:37 …' });
  const dl = dialogo('Nueva planilla a mano', [
    h('div', { class: 'dos' }, h('label', { class: 'campo' }, 'Línea', selL), h('label', { class: 'campo' }, 'Tipo de día', selT)),
    h('label', { class: 'campo' }, 'Pares "salida – llegada a Américas y Cruz Sur" (opcional; podés completar después en la tabla)', pares),
    h('button', { class: 'btn pri', onclick: () => {
      const filas = [...pares.value.matchAll(/(\d{1,2}[:.]\d{2})\s*[-–—a]\s*(\d{1,2}[:.]\d{2})/g)].map(m => filaAMin([m[1], m[2]]));
      const L = linea(selL.value), ida = L?.sentidos.ida;
      const sale = ida?.puntos?.facultad ? 'Facultad' : ida?.paradas[0]?.nombre || 'Salida';
      dl.cerrar();
      editor(raiz, { id: nuevoId(), linea: selL.value, tipo: selT.value, nombre: tituloDe(selL.value, selT.value), vigencia: '', fuente: 'manual',
        nombres: [sale, 'Américas y Cruz Sur'], vueltaDesde: 2, filas: filas.length ? filas : [[null, null], [null, null], [null, null]] }, { nueva: true, alTerminar });
    } }, 'Continuar'),
  ]);
}

// ---------- desde foto ----------
async function desdeFotos(raiz, archivos, alTerminar) {
  if (!E.cfg.apiKey) {
    dialogo('Falta la API key', [
      h('p', {}, 'Para leer fotos la app usa la API de Anthropic con tu propia clave. Se guarda solo en este teléfono y cada lectura se cobra en tu cuenta de Anthropic (unos centavos de dólar por foto).'),
      h('a', { class: 'btn pri', href: '#ajustes', onclick: e => e.target.closest('dialog').close() }, 'Ir a Ajustes para pegarla')]);
    return;
  }
  const cola = [...archivos];
  const estado = h('p', {}, ''), panel = h('section', { class: 'panel' }, h('h2', {}, 'Leyendo foto…'), estado, h('p', { class: 'suave chico' }, 'Puede tardar hasta un par de minutos por foto. No cierres la app.'));
  const siguiente = async () => {
    const archivo = cola.shift();
    if (!archivo) return alTerminar();
    poner(raiz, panel);
    const total = archivos.length, n = total - cola.length;
    estado.textContent = `Foto ${n} de ${total}: enviando…`;
    try {
      const r = await leerPlanilla(archivo, { apiKey: E.cfg.apiKey, modelo: E.cfg.modelo, alAvanzar: c => { estado.textContent = `Foto ${n} de ${total}: leyendo… (${c} caracteres)`; } });
      const lin = D.lineas.some(l => l.id === r.linea) ? r.linea : (D.lineas[0]?.id || '6');
      const tipo = r.tipo || 'habil';
      const avisos = [
        r.linea && lin !== r.linea ? `la foto dice línea "${r.linea}", que no está en los recorridos` : '',
        !r.tipo ? 'no pude saber si es hábil, sábado o domingo: elegilo vos' : '',
        r.sinFormato.length ? `${r.sinFormato.length} celda(s) no son una hora válida: quedaron en rojo para que las corrijas` : '',
      ].filter(Boolean);
      if (avisos.length) toast('Ojo: ' + avisos.join('; '), 7000);
      editor(raiz, { id: nuevoId(), linea: lin, tipo, nombre: tituloDe(lin, tipo), vigencia: r.vigencia, fuente: 'foto', nombres: r.nombres, vueltaDesde: dondeVuelve(r.nombres), filas: r.filas },
        { nueva: true, foto: URL.createObjectURL(archivo), dudasModelo: r.dudas, textos: r.sinFormato, alTerminar: siguiente });
    } catch (e) {
      poner(raiz, h('section', { class: 'panel' }, h('h2', {}, `No pude leer la foto ${n}`), h('p', { class: 'nota mal' }, e.message || String(e)),
        h('div', { class: 'fila' }, h('button', { class: 'btn', onclick: alTerminar }, 'Volver'),
          cola.length ? h('button', { class: 'btn pri', onclick: siguiente }, 'Seguir con la próxima foto') : h('button', { class: 'btn pri', onclick: () => { cola.unshift(archivo); siguiente(); } }, 'Reintentar'))));
    }
  };
  siguiente();
}

// ---------- listado ----------
function soloLectura(pl) {
  const cols = resolverColumnas(linea(pl.linea), pl.nombres, pl.vueltaDesde);
  return h('div', { class: 'grilla-scroll' }, h('table', { class: 'grilla' },
    h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.sentido === 'vuelta' ? 'vuelta' : '' }, c.nombre)))),
    h('tbody', {}, pl.filas.map(f => h('tr', {}, cols.map((c, i) => h('td', { class: 'ro ' + (c.sentido === 'vuelta' ? 'vuelta' : '') }, f[i] == null ? '' : aHora(f[i]))))))));
}

export function vistaPlanillas(raiz) {
  const repintar = () => vistaPlanillas(raiz);
  const fotos = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { if (e.target.files.length) desdeFotos(raiz, [...e.target.files], repintar); } });
  const importar = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
    try {
      const lista = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(lista) || !lista.every(p => p.linea && p.tipo && Array.isArray(p.nombres) && Array.isArray(p.filas))) throw new Error();
      for (const p of lista) { const i = E.planillas.findIndex(x => x.id === p.id); if (i >= 0) E.planillas[i] = p; else E.planillas.push(p); }
      guardar(); toast(`${lista.length} planilla(s) importadas`); repintar();
    } catch { toast('Ese archivo no es una copia de planillas válida'); }
  } });
  const exportar = () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(E.planillas)], { type: 'application/json' })), download: 'planillas-colectivos.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const orden = [...E.planillas].sort((a, b) => a.linea.localeCompare(b.linea, 'es', { numeric: true }) || TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo));

  poner(raiz, 
    h('section', { class: 'panel' },
      h('h2', {}, 'Cargar horarios'),
      h('button', { class: 'btn pri grande', onclick: () => fotos.click() }, '📷 Leer planilla desde foto'),
      h('p', { class: 'suave chico' }, 'Podés elegir varias fotos juntas (por ejemplo hábiles y domingo): se leen una por una y te las muestro para revisar antes de guardar.'),
      h('button', { class: 'btn', onclick: () => nuevaAMano(raiz, repintar) }, '＋ Nueva planilla a mano'), fotos, importar),
    h('h2', { class: 'sec' }, `Planillas guardadas (${orden.length})`),
    ...orden.map(pl => h('section', { class: 'panel' },
      h('div', { class: 'fila' }, h('span', { class: 'lin' }, 'Línea ' + pl.linea), h('strong', { class: 'crece' }, pl.nombre)),
      h('p', { class: 'suave' }, `${NOMBRE_TIPO[pl.tipo]} · ${pl.filas.length} servicios` + (pl.vigencia ? ` · vigencia ${pl.vigencia}` : '') +
        ` · ${{ precargada: 'precargada', manual: 'cargada a mano', foto: 'leída de una foto' }[pl.fuente] || ''}` + (pl.editada && pl.fuente === 'precargada' ? ' (editada)' : '')),
      h('details', {}, h('summary', {}, 'Ver horarios'), soloLectura(pl)),
      h('div', { class: 'fila' },
        h('button', { class: 'btn mini', onclick: () => editor(raiz, pl, { alTerminar: repintar }) }, 'Editar'),
        h('button', { class: 'btn mini peligro', onclick: async () => {
          if (!(await confirmar(`¿Borrar "${pl.nombre}"? No se puede deshacer.`, 'Borrar'))) return;
          E.planillas.splice(E.planillas.indexOf(pl), 1); if (pl.fuente === 'precargada') E.borradas.push(pl.id);
          guardar(); repintar();
        } }, 'Borrar')))),
    !orden.length && h('p', { class: 'nota' }, 'No hay planillas. Cargá una foto o creá una a mano.'),
    h('details', { class: 'panel' }, h('summary', {}, 'Copia de seguridad'),
      h('p', { class: 'suave chico' }, 'Las planillas viven solo en este teléfono. Exportalas para no perderlas si borrás los datos del navegador.'),
      h('div', { class: 'fila' }, h('button', { class: 'btn mini', onclick: exportar }, 'Exportar'), h('button', { class: 'btn mini', onclick: () => importar.click() }, 'Importar'))));
}
