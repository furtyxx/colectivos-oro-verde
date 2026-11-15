// Lee una imagen de planilla en el propio teléfono: sin clave, sin costo y sin mandar la foto a ningún lado.
// Usa Tesseract (vendor/tesseract, se descarga la primera vez y queda guardado) y js/tabla.js para armar la tabla.
//
// Camino corto: una lectura de la imagen agrandada. Si sale limpia (planilla nítida), listo.
// Camino largo (imagen chica, borrosa o con marca de agua): se le quita el fondo a la imagen y se lee varias
// veces con distintos tamaños; cada lectura vota qué dice cada celda (ver js/tabla.js).
import { armarTablas, segundaPasada, resultadoDeTabla, flojas, vocabularioDe } from './tabla.js';

const DIR = new URL('../vendor/tesseract/', import.meta.url).href;
// módulo WebAssembly mínimo que solo valida si el procesador soporta SIMD (más rápido)
const PRUEBA_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const LADO_IDEAL = 2400, LADO_MAX = 4096;
const FLOJAS_ACEPTABLES = 0.03;      // hasta 3% de celdas dudosas se resuelven releyendo esas celdas; más que eso, camino largo
const ALTOS_DE_NUMERO = [14, 17.5, 21]; // tamaños (px) a los que se lleva el número para las lecturas del camino largo

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

function lienzo(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/** Imagen -> lienzo a tamaño original (achicado solo si es enorme), sobre blanco. */
async function aOriginal(archivo) {
  let bmp;
  try { bmp = await createImageBitmap(archivo); } catch { throw new Error('No pude abrir esa imagen. Probá con una captura de pantalla o una foto en JPG o PNG.'); }
  const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const c = lienzo(bmp.width * k, bmp.height * k), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Copia agrandada (o igual) de un lienzo. */
function escalar(origen, k) {
  const c = lienzo(origen.width * k, origen.height * k), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(origen, 0, 0, c.width, c.height);
  return c;
}

/** Máximo (o mínimo) de cada píxel con sus vecinos en una ventana de k, en horizontal y vertical. */
function filtro(src, w, h, k, max) {
  const r = k >> 1, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), mejor = max ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = src[y * w + x];
    for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) v = mejor(v, src[y * w + xx]); }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = tmp[y * w + x];
    for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) v = mejor(v, tmp[yy * w + x]); }
    out[y * w + x] = v;
  }
  return out;
}

/**
 * Quita el fondo: marcas de agua, sombras y celdas de color. El "fondo" es la imagen sin los trazos finos
 * (se borran con un máximo y se restaura con un mínimo); después cada píxel se divide por su fondo, así lo
 * que era gris parejo queda blanco y el texto y las líneas de la grilla quedan oscuros.
 * k = ancho de la ventana: tiene que ser mayor que el grosor de la letra y menor que el de la marca de agua.
 */
function sinFondo(origen, k, contraste) {
  const w = origen.width, h = origen.height;
  const img = origen.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h), d = img.data;
  const gris = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < gris.length; i += 4, j++) gris[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const fondo = filtro(filtro(gris, w, h, k, true), w, h, k, false);
  for (let i = 0, j = 0; j < gris.length; i += 4, j++) {
    let v = Math.min(255, Math.round(255 * gris[j] / Math.max(1, fondo[j])));
    if (contraste) v = v <= 70 ? 0 : v >= 215 ? 255 : Math.round((v - 70) * 255 / 145); // oscurece el texto gris
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  const c = lienzo(w, h);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

/** Recorta una celda a un lienzo chico con margen blanco (así el lector la mira sola, sin las líneas de la grilla). */
function recorte(lz, caja, escala, margen = 14) {
  const x = Math.max(0, Math.round(caja.left * escala)), y = Math.max(0, Math.round(caja.top * escala));
  const w = Math.max(4, Math.min(Math.round(caja.width * escala), lz.width - x)), h = Math.max(4, Math.min(Math.round(caja.height * escala), lz.height - y));
  const c = lienzo(w + margen * 2, h + margen * 2), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(lz, x, y, w, h, margen, margen, w, h);
  return c;
}

const impar = n => { const k = Math.max(3, Math.round(n)); return k % 2 ? k : k + 1; };

/**
 * Lee una imagen en el teléfono. Devuelve una lista (una por cada planilla que haya en la imagen) de
 * { linea, tipo, titulo, vigencia, nombres[], filas[][] (minutos), dudas[], sinFormato[], dificil }.
 * nombres: nombres de paradas y calles conocidos (para corregir encabezados mal leídos).
 * alAvanzar(texto) informa en qué anda.
 */
export async function leerPlanillaEnTelefono(archivo, { alAvanzar, nombres = [] } = {}) {
  const decir = t => alAvanzar?.(t);
  decir('preparando el lector…');
  const [T, original] = await Promise.all([cargarLibreria(), aOriginal(archivo)]);
  const vocabulario = vocabularioDe(nombres);
  const simd = (() => { try { return WebAssembly.validate(PRUEBA_SIMD); } catch { return false; } })();
  let leyendo = 'leyendo la planilla';
  const fallo = e => new Error('El lector no pudo arrancar (' + (e?.message || e) + '). Si es la primera vez, revisá la conexión.');
  const obrero = await new Promise((res, rej) => {
    T.createWorker('spa', 1, {
      workerPath: DIR + 'worker.min.js', workerBlobURL: false, // mismo origen: así el service worker lo guarda para usarlo sin conexión
      corePath: DIR + (simd ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
      langPath: DIR.replace(/\/$/, ''),
      logger: m => {
        if (m.status === 'recognizing text') { if (leyendo) decir(`${leyendo}… ${Math.round(m.progress * 100)}%`); }
        else if (/loading|initializ/.test(m.status)) decir('cargando el lector (la primera vez descarga unos 6 MB)…');
      },
      errorHandler: e => rej(fallo(e)),
    }).then(res, e => rej(fallo(e)));
  });
  let modo = '';
  /** Lee un lienzo entero buscando textos sueltos; devuelve las palabras en coordenadas de la imagen original. */
  const pasada = async (lz, escala) => {
    if (modo !== 'pagina') { await obrero.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '', user_defined_dpi: '150', preserve_interword_spaces: '1' }); modo = 'pagina'; }
    const { data } = await obrero.recognize(lz, {}, { blocks: true, text: false });
    const palabras = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || [])
      palabras.push({ t: w.text, c: Math.round(w.confidence), x0: w.bbox.x0 / escala, y0: w.bbox.y0 / escala, x1: w.bbox.x1 / escala, y1: w.bbox.y1 / escala });
    return palabras;
  };
  /** Lee un recorte de una sola celda, solo números. psm 8 = una palabra, 7 = una línea. */
  const celda = async (lz, psm) => {
    if (modo !== psm) { await obrero.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: '0123456789:', user_defined_dpi: '150' }); modo = psm; }
    return (await obrero.recognize(lz)).data.text;
  };
  const repasar = async (tablas, vistas, cada) => {
    leyendo = '';
    for (const tabla of tablas) await segundaPasada(tabla, async (caja, { vacia }) => {
      const textos = [];
      // una celda que quedó vacía se mira una sola vez (casi siempre está vacía de verdad)
      for (const v of vacia ? vistas.slice(0, 1) : vistas) {
        const lz = recorte(v.lienzo, caja, v.escala), uno = await celda(lz, '8');
        textos.push(uno.replace(/\D/g, '').length >= 3 ? uno : await celda(lz, '7'));
      }
      return textos;
    }, { alAvanzar: (n, total) => { if (n % cada === 0 || n === total) decir(`repasando celdas dudosas… ${n} de ${total}`); } });
  };

  try {
    // ---- camino corto: una lectura de la imagen agrandada ----
    const mayor = Math.max(original.width, original.height);
    const k1 = Math.min(3, Math.max(1, LADO_IDEAL / mayor), LADO_MAX / mayor);
    const simple = escalar(original, k1);
    const primera = await pasada(simple, k1);
    let tablas = null, dificil = false;
    try { tablas = armarTablas([primera], { vocabulario }); } catch { /* no se ve una tabla: pruebo el camino largo */ }
    if (tablas && flojas(tablas) <= FLOJAS_ACEPTABLES) {
      await repasar(tablas, [{ lienzo: simple, escala: k1 }], 5);
    } else {
      // ---- camino largo: sin fondo, varios tamaños, y votación ----
      dificil = true;
      const altoNumero = tablas ? Math.max(4, tablas[0].alto) : 8; // alto de los números en la imagen original
      const escalas = [...new Set(ALTOS_DE_NUMERO.map(a => Math.round(Math.min(4, Math.max(1, a / altoNumero), LADO_MAX / mayor) * 100) / 100))];
      const ventanas = [...new Set([impar(altoNumero * 0.7), impar(altoNumero)])];
      const planes = ventanas.flatMap(v => escalas.map(e => ({ v, e, contraste: false })));
      planes.push({ v: ventanas[0], e: escalas.at(-1), contraste: true }, { v: ventanas.at(-1), e: escalas[0], contraste: true });
      const limpios = new Map(); // "ventana,contraste" -> lienzo sin fondo a tamaño original
      const limpio = (v, contraste) => { const kk = v + ',' + contraste; if (!limpios.has(kk)) limpios.set(kk, sinFondo(original, v, contraste)); return limpios.get(kk); };
      const lecturas = [primera], vistas = [];
      for (let i = 0; i < planes.length; i++) {
        const p = planes[i];
        leyendo = `la imagen cuesta leerla: lectura ${i + 1} de ${planes.length}`;
        decir(leyendo + '…');
        const lz = escalar(limpio(p.v, p.contraste), p.e);
        lecturas.push(await pasada(lz, p.e));
        if (!p.contraste && p.v === ventanas.at(-1)) vistas.push({ lienzo: lz, escala: p.e });
      }
      // la primera lectura (sin limpiar) solo aporta título y encabezados: su letra gruesa se pierde al quitar el fondo
      tablas = armarTablas(lecturas, { vocabulario, soloTexto: [0] });
      await repasar(tablas, vistas, 3);
    }
    const res = tablas.map(t => ({ ...resultadoDeTabla(t), dificil })).filter(r => r.nombres.length >= 2 && r.filas.length);
    if (!res.length) throw new Error('No encontré una tabla de horarios en la imagen.');
    return res;
  } finally {
    obrero.terminate().catch(() => {});
  }
}
