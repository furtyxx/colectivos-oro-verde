#!/usr/bin/env node
// Genera los íconos PNG de la app sin dependencias:  node tools/iconos.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
fs.mkdirSync(DIR, { recursive: true });

// Dibujo en coordenadas 0..1 con formas simples (distancia a rectángulo redondeado / círculo).
const rr = (x, y, cx, cy, w, h, r) => { const dx = Math.max(Math.abs(x - cx) - w / 2 + r, 0), dy = Math.max(Math.abs(y - cy) - h / 2 + r, 0); return Math.hypot(dx, dy) - r; };
const circ = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const VERDE = [20, 83, 45], CLARO = [34, 139, 74], BLANCO = [255, 255, 255], ORO = [251, 191, 36], OSCURO = [15, 40, 24], VIDRIO = [187, 232, 205];

function pixel(x, y, s, fondoRadio) {
  // s = escala del dibujo (1 normal, <1 para "maskable" con margen de seguridad)
  const u = (x - 0.5) / s + 0.5, v = (y - 0.5) / s + 0.5;
  const capas = [];
  if (rr(x, y, 0.5, 0.5, 1, 1, fondoRadio) <= 0) capas.push(y < 0.62 ? VERDE : CLARO); else return null;
  if (rr(u, v, 0.5, 0.80, 1.4, 0.10, 0) <= 0) capas.push(OSCURO);                           // calle
  if (circ(u, v, 0.33, 0.715, 0.062) <= 0 || circ(u, v, 0.67, 0.715, 0.062) <= 0) capas.push(OSCURO); // ruedas
  if (rr(u, v, 0.5, 0.50, 0.62, 0.40, 0.07) <= 0) capas.push(BLANCO);                       // carrocería
  if (rr(u, v, 0.5, 0.435, 0.52, 0.15, 0.025) <= 0) capas.push(VIDRIO);                     // ventanas
  if (rr(u, v, 0.413, 0.435, 0.014, 0.15, 0) <= 0 || rr(u, v, 0.587, 0.435, 0.014, 0.15, 0) <= 0) capas.push(BLANCO);
  if (rr(u, v, 0.5, 0.585, 0.62, 0.035, 0) <= 0 && rr(u, v, 0.5, 0.50, 0.62, 0.40, 0.07) <= 0) capas.push(ORO); // franja
  if (circ(u, v, 0.33, 0.715, 0.028) <= 0 || circ(u, v, 0.67, 0.715, 0.028) <= 0) capas.push(BLANCO);
  return capas[capas.length - 1];
}

function png(n, escala, fondoRadio) {
  const SS = 3, fila = n * 4 + 1, crudo = Buffer.alloc(fila * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const c = pixel((i + (si + 0.5) / SS) / n, (j + (sj + 0.5) / SS) / n, escala, fondoRadio);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = j * fila + 1 + i * 4;
    if (a) { crudo[o] = r / a; crudo[o + 1] = g / a; crudo[o + 2] = b / a; crudo[o + 3] = Math.round(255 * a / (SS * SS)); }
  }
  const crc = buf => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const trozo = (tipo, datos) => { const t = Buffer.concat([Buffer.from(tipo), datos]), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(datos.length); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo, { level: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

fs.writeFileSync(path.join(DIR, 'icon-192.png'), png(192, 1, 0.2));
fs.writeFileSync(path.join(DIR, 'icon-512.png'), png(512, 1, 0.2));
fs.writeFileSync(path.join(DIR, 'icon-maskable-512.png'), png(512, 0.74, 0));
fs.writeFileSync(path.join(DIR, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="20" fill="#14532d"/><rect y="62" width="100" height="38" rx="0" fill="#228b4a"/><rect width="100" height="100" rx="20" fill="none"/>
<rect y="75" width="100" height="10" fill="#0f2818"/><circle cx="33" cy="71.5" r="6.2" fill="#0f2818"/><circle cx="67" cy="71.5" r="6.2" fill="#0f2818"/>
<rect x="19" y="30" width="62" height="40" rx="7" fill="#fff"/><rect x="24" y="36" width="52" height="15" rx="2.5" fill="#bbe8cd"/>
<rect x="40.6" y="36" width="1.4" height="15" fill="#fff"/><rect x="58" y="36" width="1.4" height="15" fill="#fff"/><rect x="19" y="56.7" width="62" height="3.5" fill="#fbbf24"/>
<circle cx="33" cy="71.5" r="2.8" fill="#fff"/><circle cx="67" cy="71.5" r="2.8" fill="#fff"/></svg>
`);
console.log('Íconos generados en', DIR);
