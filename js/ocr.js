// Lee una foto de planilla en el propio teléfono: sin clave, sin costo y sin mandar la foto a ningún lado.
// Usa Tesseract (vendor/tesseract, se descarga la primera vez y queda guardado) y js/tabla.js para armar la tabla.
import { armarTabla, segundaPasada, resultadoDeTabla } from './tabla.js';

const DIR = new URL('../vendor/tesseract/', import.meta.url).href;
// módulo WebAssembly mínimo que solo valida si el procesador soporta SIMD (más rápido)
const PRUEBA_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const LADO_IDEAL = 2400, LADO_MAX = 4096;

let libreria = null;
function cargarLibreria() {
  libreria ||= new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement('script');
    s.src = DIR + 'tesseract.min.js';
    s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('El lector no se cargó bien.')));
    s.onerror = () => { libreria = null; s.remove(); rej(new Error('No pude descargar el lector de planillas. La primera vez hace falta conexión; después funciona sin internet.')); };
    document.head.append(s);
  });
  return libreria;
}

/** Foto -> lienzo agrandado (las capturas de WhatsApp vienen chicas y el lector necesita letras grandes). */
async function aLienzo(archivo) {
  let bmp;
  try { bmp = await createImageBitmap(archivo); } catch { throw new Error('No pude abrir esa imagen. Probá con una captura de pantalla o una foto en JPG o PNG.'); }
  const mayor = Math.max(bmp.width, bmp.height);
  const k = mayor > LADO_MAX ? LADO_MAX / mayor : Math.min(3, Math.max(1, LADO_IDEAL / mayor));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Recorta una celda a un lienzo chico con margen blanco (así el lector la mira sola, sin las líneas de la grilla). */
function recorte(lienzo, caja, margen = 14) {
  const w = Math.max(4, Math.min(caja.width, lienzo.width - caja.left)), h = Math.max(4, Math.min(caja.height, lienzo.height - caja.top));
  const c = document.createElement('canvas');
  c.width = w + margen * 2; c.height = h + margen * 2;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(lienzo, caja.left, caja.top, w, h, margen, margen, w, h);
  return c;
}

/**
 * Lee una foto en el teléfono. Devuelve lo mismo que el lector por API (js/lector.js):
 * { linea, tipo, titulo, vigencia, nombres[], filas[][] (minutos), dudas[], sinFormato[] }.
 * alAvanzar(texto) informa en qué anda.
 */
export async function leerPlanillaEnTelefono(archivo, { alAvanzar } = {}) {
  const decir = t => alAvanzar?.(t);
  decir('preparando el lector…');
  const [T, lienzo] = await Promise.all([cargarLibreria(), aLienzo(archivo)]);
  const simd = (() => { try { return WebAssembly.validate(PRUEBA_SIMD); } catch { return false; } })();
  let leyendo = 'leyendo la planilla';
  const obrero = await new Promise((res, rej) => {
    T.createWorker('spa', 1, {
      workerPath: DIR + 'worker.min.js', workerBlobURL: false, // mismo origen: así el service worker lo guarda para usarlo sin conexión
      corePath: DIR + (simd ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
      langPath: DIR.replace(/\/$/, ''),
      logger: m => {
        if (m.status === 'recognizing text') { if (leyendo) decir(`${leyendo}… ${Math.round(m.progress * 100)}%`); }
        else if (/loading|initializ/.test(m.status)) decir('cargando el lector (la primera vez descarga unos 6 MB)…');
      },
      errorHandler: e => rej(new Error('El lector no pudo arrancar (' + (e?.message || e) + '). Si es la primera vez, revisá la conexión.')),
    }).then(res, e => rej(new Error('El lector no pudo arrancar (' + (e?.message || e) + '). Si es la primera vez, revisá la conexión.')));
  });
  try {
    // 1ª pasada: toda la imagen, buscando textos sueltos (cada celda es un texto suelto)
    await obrero.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '150', preserve_interword_spaces: '1' });
    const { data } = await obrero.recognize(lienzo, {}, { blocks: true, text: false });
    const palabras = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || [])
      palabras.push({ t: w.text, c: Math.round(w.confidence), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
    const tabla = armarTabla(palabras);

    // 2ª pasada: celdas vacías, ilegibles o dudosas, una por una y solo con números
    leyendo = ''; // de acá en más el avance lo informa la segunda pasada
    let modo = '';
    const mirar = async (lz, psm) => {
      if (modo !== psm) { await obrero.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: '0123456789:', user_defined_dpi: '150' }); modo = psm; }
      return (await obrero.recognize(lz)).data.text;
    };
    await segundaPasada(tabla, async caja => {
      const lz = recorte(lienzo, caja), uno = await mirar(lz, '8'); // 8 = una sola palabra
      return (uno.replace(/\D/g, '').length >= 3) ? [uno] : [uno, await mirar(lz, '7')]; // 7 = una sola línea
    }, { alAvanzar: (n, total) => decir(`repasando celdas dudosas… ${n} de ${total}`) });

    const r = resultadoDeTabla(tabla);
    if (r.nombres.length < 2 || !r.filas.length) throw new Error('No encontré una tabla de horarios en la imagen.');
    return r;
  } finally {
    obrero.terminate().catch(() => {});
  }
}
