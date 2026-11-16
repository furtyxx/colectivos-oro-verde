// Estado guardado en el dispositivo (localStorage) y datos de recorridos.
import { CFG_DEFECTO, LUGARES_DEFECTO, PRECARGADAS } from './datos.js';
import { resolverColumnas, tipoDeDia, busesEnVivo } from './motor.js';
import { hoyISO } from './ui.js';

const CLAVE = 'ov.estado.v1';

/** Lo que se guarda: ajustes, lugares, planillas, viaje en curso y último plan. */
export const E = { cfg: {}, lugares: [], planillas: [], borradas: [], viaje: null, plan: {}, arribos: { lugar: 'casa', radio: 300 } };
/** Datos de solo lectura generados por tools/actualizar.mjs */
export const D = { lineas: [], generado: null, cambios: null, calles: null, horarios: null, resumen: undefined };

export function cargarEstado() {
  let g = {};
  try { g = JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch { /* estado roto: arranco limpio */ }
  E.cfg = { ...structuredClone(CFG_DEFECTO), ...(g.cfg || {}) };
  E.lugares = g.lugares?.length ? g.lugares : structuredClone(LUGARES_DEFECTO);
  E.planillas = g.planillas || [];
  E.borradas = g.borradas || [];
  for (const p of PRECARGADAS) {
    const i = E.planillas.findIndex(x => x.id === p.id);
    if (i < 0) { if (!E.borradas.includes(p.id)) E.planillas.push(structuredClone(p)); }
    else if (!E.planillas[i].editada && (E.planillas[i].ver || 0) < p.ver) E.planillas[i] = structuredClone(p);
  }
  E.viaje = g.viaje || null;
  E.arribos = { lugar: 'casa', radio: 300, ...(g.arribos || {}) };
  E.plan = { origen: 'casa', destino: 'terminal', modo: 'llegar', tipo: 'auto', hora: '', fecha: '', ...(g.plan || {}) };
}

export function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(E)); } catch { /* sin espacio o modo privado */ }
}

export async function cargarDatos() {
  const j = await (await fetch('data/lineas.json')).json();
  D.lineas = j.lineas; D.generado = j.generado;
  // primero las que más uso
  const pref = ['6', '15'];
  D.lineas.sort((a, b) => (pref.indexOf(a.id) + 1 || 99) - (pref.indexOf(b.id) + 1 || 99));
  try { D.cambios = await (await fetch('data/cambios.json')).json(); } catch { D.cambios = null; }
  try { D.horarios = await (await fetch('data/horarios.json')).json(); } catch { D.horarios = null; }
}

export const calleListas = new EventTarget(); // avisa cuando terminaron de cargar las calles (para repintar los mapas)
export async function cargarCalles() {
  if (!D.calles) { D.calles = (await (await fetch('data/calles.json')).json()).calles; calleListas.dispatchEvent(new Event('listas')); }
  return D.calles;
}

export const linea = id => D.lineas.find(l => l.id === id);
export const lugar = id => E.lugares.find(l => l.id === id);

/** Columnas de una planilla ya ubicadas en el recorrido (con las correcciones manuales). */
export function columnasDe(pl) {
  const cols = resolverColumnas(linea(pl.linea), pl.nombres, pl.vueltaDesde ?? undefined);
  for (const [i, n] of Object.entries(pl.anclas || {})) if (cols[i]) { cols[i].parada = n || null; cols[i].aprox = cols[i].dudoso = false; cols[i].manual = true; }
  return cols;
}
export const planillasListas = () => E.planillas.map(p => ({ ...p, columnas: columnasDe(p) }));

/** Agrega un lugar elegido en el buscador a "recientes" (o lo reusa). */
export function recordarLugar(p) {
  const ya = E.lugares.find(l => Math.abs(l.lat - p.lat) < 2e-4 && Math.abs(l.lon - p.lon) < 2e-4);
  if (ya) return ya;
  const nuevo = { id: 'l' + Date.now().toString(36), nombre: p.nombre, lat: p.lat, lon: p.lon, reciente: true };
  E.lugares.push(nuevo);
  const rec = E.lugares.filter(l => l.reciente);
  if (rec.length > 8) E.lugares.splice(E.lugares.indexOf(rec[0]), 1);
  guardar();
  return nuevo;
}

export const cuandoLlega = 'https://cuandollega.smartmovepro.net/parana';

/** De dónde sale cada horario. Hoy la app NO usa "Cuándo llega": todo sale de Paraná Online o, si falta, de las planillas. */
export const FUENTES = { sitio: 'Paraná Online', planilla: 'planilla (estimado)', cuandollega: 'Cuándo llega (tiempo real)' };
export const fuenteTxt = f => FUENTES[f] || FUENTES.planilla;

/** Qué horario corre en una fecha: lo que mostraba Paraná Online ese día o, si no, el calendario. */
export function tipoAuto(fecha) {
  const web = D.cambios?.tipoHoy;
  if (web?.fecha === fecha && web.tipo) {
    const t = /dom/i.test(web.tipo) ? 'domingo' : /s[aá]b/i.test(web.tipo) ? 'sabado' : /h[aá]b|sem|lun/i.test(web.tipo) ? 'habil' : null;
    if (t) return { tipo: t, motivo: 'es lo que mostraba Paraná Online hoy' };
  }
  return tipoDeDia(fecha);
}

// ---------- colectivos estimados en el mapa ----------
export const COLOR_BUS = { ida: '#0ea5e9', vuelta: '#a855f7' };   // celeste = ida, violeta = vuelta
export const LEYENDA_BUS = [['Ida (celeste)', COLOR_BUS.ida], ['Vuelta (violeta)', COLOR_BUS.vuelta]];

/** Colectivos que estarían circulando ahora (estimados con los horarios por parada). ids = solo esas líneas. */
export function busesAhora(ids = null) {
  if (!D.horarios) return [];
  const d = new Date(), ahora = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return busesEnVivo({ lineas: D.lineas, horarios: D.horarios.lineas, tipo: tipoAuto(hoyISO()).tipo, ahora, ids });
}
/** Para dibujarlos en el mapa: un círculo con el número de línea, del color del sentido. */
export const busesParaMapa = lista => lista.map(b => ({ lat: b.lat, lon: b.lon, color: b.ida ? COLOR_BUS.ida : COLOR_BUS.vuelta, texto: b.linea.id.replace('-', '') }));

/** Vuelve a bajar los horarios (los junta una tarea de GitHub cada hora). */
export async function refrescarHorarios() {
  try { const r = await fetch('data/horarios.json', { cache: 'no-cache' }); if (r.ok) D.horarios = await r.json(); } catch { /* sin conexión: quedan los que había */ }
  return D.horarios;
}
/** Resumen por día de cada línea (cuántos servicios, primer y último horario, intervalo medio) para ver tendencias. */
export async function cargarResumen() {
  if (D.resumen === undefined) { try { D.resumen = await (await fetch('data/historial/resumen.json', { cache: 'no-cache' })).json(); } catch { D.resumen = null; } }
  return D.resumen;
}
