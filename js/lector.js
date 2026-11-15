// Lee una foto de planilla con la API de Anthropic (la API key queda solo en este dispositivo).
import { filaAMin } from './motor.js';

const URL_API = 'https://api.anthropic.com/v1/messages';
const LADO_MAX = 2576; // resolución máxima útil para los modelos actuales

const ESQUEMA = {
  type: 'object', additionalProperties: false,
  required: ['linea', 'tipo_dia', 'titulo', 'vigencia', 'columnas', 'filas', 'dudas'],
  properties: {
    linea: { type: 'string', description: 'Número de línea tal como figura en el título (ej. "6", "15"). Vacío si no figura.' },
    tipo_dia: { type: 'string', enum: ['habil', 'sabado', 'domingo', 'desconocido'] },
    titulo: { type: 'string', description: 'Título de la planilla tal como está escrito.' },
    vigencia: { type: 'string', description: 'Fecha o período de vigencia si figura (ej. "26/05/26"). Vacío si no.' },
    columnas: { type: 'array', items: { type: 'string' }, description: 'Encabezados de izquierda a derecha, uno por columna, incluyendo los repetidos.' },
    filas: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Una lista por fila; cada celda "H:MM" o "" si está vacía.' },
    dudas: {
      type: 'array', description: 'Celdas que no se leen con seguridad.',
      items: { type: 'object', additionalProperties: false, required: ['fila', 'columna', 'nota'], properties: { fila: { type: 'integer' }, columna: { type: 'integer' }, nota: { type: 'string' } } },
    },
  },
};

const SISTEMA = `Transcribís planillas de horarios de colectivos interurbanos de Paraná (Argentina, empresa ERSA) a partir de fotos o capturas de pantalla. La transcripción alimenta una app que le dice a una persona a qué hora salir para no perder un micro, así que un solo dígito mal leído puede hacerle perder el viaje: la fidelidad a la imagen importa más que cualquier otra cosa.

Cómo son estas planillas: una tabla donde cada fila es un servicio y cada columna un punto del recorrido. Las columnas de la izquierda son la ida (por ejemplo Facultad, KM 5 1/2, La Virgen, Américas y Cruz Sur, Plaza Alberdi, Laprida y Córdoba) y las de la derecha la vuelta, con los mismos puntos en orden inverso; por eso hay encabezados repetidos y suele haber dos columnas "Laprida y Córdoba" seguidas con la misma hora. Hay celdas vacías (servicios que no pasan por ese punto) y deben quedar vacías.

Qué devolver:
- "columnas": todos los encabezados de izquierda a derecha, uno por columna de la tabla, sin fusionar los repetidos. Si un encabezado está cortado en varias líneas ("Faculta" / "d"), unilo en una sola palabra correcta ("Facultad").
- "filas": todas las filas de arriba hacia abajo. Cada fila tiene exactamente tantas celdas como columnas. Cada celda es la hora tal como figura, en formato H:MM de 24 horas, o "" si la celda está vacía.
- No completes ni corrijas nada por deducción: si una celda está vacía va "", aunque el patrón sugiera una hora. Si un número no se lee bien, poné tu mejor lectura y anotá la celda en "dudas" (fila y columna empezando en 0) explicando la duda.
- "tipo_dia": habil si dice hábiles / lunes a viernes; sabado; domingo si dice domingo o domingos y feriados; desconocido si no lo dice.

Antes de responder, verificá fila por fila que las horas crezcan de izquierda a derecha y que cada columna crezca hacia abajo; si algo no cierra, volvé a mirar esa celda en la imagen antes de decidir.`;

const PEDIDO = 'Transcribí completa la planilla de horarios de esta imagen.';

async function prepararImagen(archivo) {
  const bmp = await createImageBitmap(archivo);
  const mayor = Math.max(bmp.width, bmp.height), esc = Math.min(1, LADO_MAX / mayor);
  let blob = archivo;
  const directo = esc === 1 && archivo.size < 4.5e6 && /^image\/(png|jpeg|webp|gif)$/.test(archivo.type);
  if (!directo) {
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  }
  bmp.close?.();
  const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('No pude leer el archivo')); fr.readAsDataURL(blob); });
  return { tipo: blob.type || 'image/jpeg', b64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

class ErrorApi extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function pedir(cuerpo, apiKey, conExtras, alAvanzar) {
  const cab = {
    'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (conExtras) cab['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  const r = await fetch(URL_API, { method: 'POST', headers: cab, body: JSON.stringify(cuerpo) });
  if (!r.ok) {
    let det = ''; try { det = (await r.json()).error?.message || ''; } catch { /* sin detalle */ }
    const msg = r.status === 401 ? 'La API key no es válida (revisala en Ajustes).'
      : r.status === 403 ? 'La API key no tiene permiso para este modelo.'
      : r.status === 404 ? 'El modelo configurado no existe (revisalo en Ajustes).'
      : r.status === 429 ? 'Se alcanzó el límite de uso de la API. Probá en un rato.'
      : r.status >= 500 ? 'El servicio de Anthropic está saturado. Probá de nuevo en un minuto.'
      : 'La API rechazó el pedido: ' + det;
    throw new ErrorApi(msg + (det && r.status !== 400 ? ` (${det})` : ''), r.status);
  }
  // respuesta en streaming (SSE)
  const lector = r.body.getReader(), dec = new TextDecoder();
  let buf = '', texto = '', motivo = null;
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const lineaTxt = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!lineaTxt.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(lineaTxt.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { texto += ev.delta.text; alAvanzar?.(texto.length); }
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason) motivo = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new ErrorApi('La API cortó la respuesta: ' + (ev.error?.message || 'error'), 500);
    }
  }
  if (motivo === 'refusal') throw new ErrorApi('El modelo se negó a leer esta imagen.', 200);
  if (motivo === 'max_tokens') throw new ErrorApi('La planilla es demasiado larga para una sola foto: sacá dos fotos (mitad de arriba y mitad de abajo).', 200);
  const a = texto.indexOf('{'), b = texto.lastIndexOf('}');
  if (a < 0 || b < a) throw new ErrorApi('La respuesta no vino en el formato esperado. Probá de nuevo.', 200);
  return JSON.parse(texto.slice(a, b + 1));
}

/**
 * Lee una foto. Devuelve { linea, tipo, titulo, vigencia, nombres[], filas[][] (minutos), dudas[], sinFormato[] }.
 */
export async function leerPlanilla(archivo, { apiKey, modelo, alAvanzar }) {
  if (!apiKey) throw new Error('Falta la API key de Anthropic (Ajustes).');
  const img = await prepararImagen(archivo);
  const base = {
    model: modelo || 'claude-opus-5-5', max_tokens: 32000, stream: true, system: SISTEMA,
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: img.tipo, data: img.b64 } }, { type: 'text', text: PEDIDO }] }],
  };
  let j;
  try {
    j = await pedir({ ...base, output_config: { effort: 'high', format: { type: 'json_schema', schema: ESQUEMA } }, fallbacks: 'default' }, apiKey, true, alAvanzar);
  } catch (e) {
    if (e.status !== 400) throw e;
    // Algún parámetro opcional no es aceptado por este modelo/cuenta: reintento con el pedido mínimo.
    j = await pedir({ ...base, system: SISTEMA + '\n\nRespondé únicamente con un objeto JSON con las claves linea, tipo_dia, titulo, vigencia, columnas, filas y dudas ({fila, columna, nota}).' }, apiKey, false, alAvanzar);
  }
  const nombres = (j.columnas || []).map(c => String(c).replace(/\s+/g, ' ').trim());
  const sinFormato = [];
  const filas = (j.filas || []).map((f, fi) => {
    const celdas = Array.from({ length: nombres.length }, (_, c) => String(f[c] ?? '').trim());
    const mins = filaAMin(celdas.map(c => c || null));
    mins.forEach((m, c) => { if (m == null && celdas[c] && !/^[-–—.]+$/.test(celdas[c])) sinFormato.push({ fila: fi, columna: c, texto: celdas[c] }); });
    return mins;
  }).filter(f => f.some(x => x != null));
  if (!nombres.length || !filas.length) throw new Error('No encontré una tabla de horarios en la imagen.');
  return {
    linea: String(j.linea || '').replace(/[^0-9a-z]/gi, '').toUpperCase(),
    tipo: ['habil', 'sabado', 'domingo'].includes(j.tipo_dia) ? j.tipo_dia : null,
    titulo: j.titulo || '', vigencia: j.vigencia || '', nombres, filas,
    dudas: Array.isArray(j.dudas) ? j.dudas : [], sinFormato,
  };
}
