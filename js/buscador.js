// Buscador de lugares: mis lugares, paradas, esquinas (sin conexión) y OpenStreetMap (con conexión).
import { h, dialogo, toast, fmtM, poner } from './ui.js';
import { E, D, cargarCalles } from './estado.js';
import { buscarParadas, buscarEsquinas, buscarCalles, coordsEnTexto, contiene, dist } from './motor.js';

const ZONA = '-60.60,-31.69,-60.44,-31.87'; // Paraná + Oro Verde (izq, arriba, der, abajo)
// zona donde priorizar resultados de Google: Paraná, Oro Verde, San Benito, Colonia Avellaneda, Sauce Montrull…
const ZONA_GOOGLE = { rectangle: { low: { latitude: -31.95, longitude: -60.70 }, high: { latitude: -31.60, longitude: -60.30 } } };

/** Busca como en Google Maps (Places API nueva) con la clave del usuario. */
export async function buscarGoogle(q, clave) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': clave, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify({ textQuery: q, languageCode: 'es', regionCode: 'AR', locationBias: ZONA_GOOGLE, maxResultCount: 8 }),
  });
  if (!r.ok) {
    let det = ''; try { det = (await r.json()).error?.message || ''; } catch { /* sin detalle */ }
    throw new Error(r.status === 400 || r.status === 403 ? 'Google rechazó la clave (' + (det || r.status) + '). Revisá que esté habilitada "Places API (New)".' : 'Google no respondió (' + r.status + ').');
  }
  return ((await r.json()).places || []).map(p => ({
    nombre: (p.displayName?.text || '') + (p.formattedAddress ? ' — ' + p.formattedAddress.replace(/, Entre Ríos.*$/, '').replace(/, Argentina$/, '') : ''),
    lat: p.location.latitude, lon: p.location.longitude, tipo: 'google',
  }));
}

/**
 * Lugar a partir de lo que "comparte" Google Maps (nombre, dirección y link corto) o de cualquier texto pegado.
 * Orden: coordenadas dentro del texto → Google (si hay clave) → OpenStreetMap con el nombre.
 */
export async function lugarDeTextoCompartido(txt) {
  const consulta = txt.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const c = coordsEnTexto(txt);
  if (c) return [{ nombre: consulta.slice(0, 80) || `Punto ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, ...c, tipo: 'coord' }];
  if (!consulta) return [];
  const clave = E.cfg.googleKey;
  if (clave) { try { const g = await buscarGoogle(consulta, clave); if (g.length) return g; } catch { /* pruebo con OpenStreetMap */ } }
  return buscarOnline(consulta + (/paran[aá]|oro verde/i.test(consulta) ? '' : ', Paraná'));
}

async function buscarOnline(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ar&bounded=1&viewbox=' + ZONA + '&accept-language=es&q=' + encodeURIComponent(q);
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).map(x => ({ nombre: x.display_name.split(',').slice(0, 3).join(','), lat: +x.lat, lon: +x.lon, tipo: 'mapa' }));
}

export function miUbicacion() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Este dispositivo no tiene GPS disponible'));
    navigator.geolocation.getCurrentPosition(
      p => res({ id: '__gps', nombre: 'Mi ubicación actual', lat: p.coords.latitude, lon: p.coords.longitude }),
      e => rej(new Error(e.code === 1 ? 'No diste permiso de ubicación' : 'No pude obtener la ubicación')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

/** Abre el buscador y llama alElegir({nombre, lat, lon}). */
export function abrirBuscador(titulo, alElegir) {
  const entrada = h('input', { type: 'search', placeholder: 'Ej.: Urquiza y Corrientes, Hospital San Martín…', autocomplete: 'off', enterkeyhint: 'search' });
  const lista = h('ul', { class: 'lista' });
  const pie = h('p', { class: 'suave' }, 'Escribí una esquina ("calle y calle"), una parada, un lugar, o pegá un link de Google Maps. Tip: en Google Maps tocá Compartir → Cole OV y el lugar llega solo.');
  const hayGoogle = !!E.cfg.googleKey;
  const btnOnline = h('button', { class: 'btn', disabled: true, onclick: online }, hayGoogle ? 'Buscar en Google Maps (con internet)' : 'Buscar en OpenStreetMap (con internet)');
  const btnGps = h('button', { class: 'btn', onclick: async () => { try { elegir(await miUbicacion()); } catch (e) { toast(e.message); } } }, '📍 Usar mi ubicación actual');
  const dl = dialogo(titulo, [entrada, lista, pie, h('div', { class: 'fila' }, btnOnline, btnGps)]);
  const ETQ = { lugar: 'Mis lugares', parada: 'Parada', esquina: 'Esquina', calle: 'Calle', mapa: 'OpenStreetMap', google: 'Google Maps', coord: 'Coordenadas' };

  function elegir(p) { dl.cerrar(); alElegir(p); }
  function pintar(res) {
    poner(lista, ...res.map(p => h('li', {}, h('button', { onclick: () => elegir(p) },
      h('span', { class: 'n' }, p.tipo === 'parada' ? '🚏' : p.tipo === 'lugar' ? '⭐' : '📌'),
      h('span', {}, p.nombre, h('small', {}, ETQ[p.tipo] + (p.lineas ? ' · línea ' + p.lineas.join(', ') : ''))),
      h('span', { class: 'suave chico' }, p.lejos != null ? fmtM(p.lejos) : '')))));
  }
  let turno = 0, locales = [];
  async function local() {
    const q = entrada.value.trim(), yo = ++turno;
    btnOnline.disabled = q.length < 3;
    if (!q) { locales = E.lugares.map(l => ({ ...l, tipo: 'lugar' })); return pintar(locales); }
    const res = [];
    const c = coordsEnTexto(q);
    if (c) res.push({ nombre: `Punto ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, ...c, tipo: 'coord' });
    res.push(...E.lugares.filter(l => contiene(l.nombre, q)).map(l => ({ ...l, tipo: 'lugar' })));
    if (q.length >= 3 && !c) {
      const partes = q.split(/\s+(?:y|e|esq\.?|esquina|&|\/)\s+/i);
      try {
        const calles = await cargarCalles();
        if (yo !== turno) return;
        if (partes.length === 2 && partes[1].length >= 2) res.push(...buscarEsquinas(calles, partes[0], partes[1]));
        res.push(...buscarParadas(D.lineas, q));
        if (partes.length === 1) res.push(...buscarCalles(calles, q, 4));
      } catch { res.push(...buscarParadas(D.lineas, q)); }
    }
    locales = res;
    pintar(res);
    pie.textContent = res.length ? '' : (q.length < 3 ? 'Seguí escribiendo…' : 'No encontré nada guardado en el teléfono. Probá con "Buscar en OpenStreetMap".');
  }
  async function online() {
    const q = entrada.value.trim();
    if (!navigator.onLine) return toast('Sin conexión: solo puedo buscar esquinas y paradas guardadas');
    btnOnline.disabled = true; pie.textContent = 'Buscando en OpenStreetMap…';
    try {
      const r = (hayGoogle ? await buscarGoogle(q, E.cfg.googleKey) : await buscarOnline(q + (/paran[aá]|oro verde/i.test(q) ? '' : ', Paraná'))).filter(p => !locales.some(l => dist(l, p) < 60));
      pintar([...r, ...locales]);
      pie.textContent = r.length ? (hayGoogle ? 'Resultados de Google Maps.' : 'Resultados de © OpenStreetMap.') : (hayGoogle ? 'Google no encontró nada con ese texto.' : 'OpenStreetMap tampoco lo encontró. Probá con la esquina más cercana o con Google Maps (clave en Ajustes).');
    } catch (e) { pie.textContent = hayGoogle ? e.message : 'No pude consultar OpenStreetMap ahora.'; }
    btnOnline.disabled = false;
  }
  let t;
  entrada.addEventListener('input', () => { clearTimeout(t); t = setTimeout(local, 220); });
  entrada.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (hayGoogle && entrada.value.trim().length >= 3 && !coordsEnTexto(entrada.value)) online(); else local(); } });
  local();
  entrada.focus();
}
