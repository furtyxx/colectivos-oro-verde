# Colectivos Oro Verde ⇄ Paraná

App web instalable (PWA) para saber **qué colectivo tomar** entre Oro Verde y Paraná (líneas 6, 15 y las demás interurbanas de ERSA) y **cuándo bajarse**.

- **Planear**: decís de dónde a dónde vas y a qué hora tenés que estar (por ejemplo, a qué hora sale tu micro de la Terminal). Te muestra el colectivo recomendado, el anterior y uno "muy justo", con la hora para estar en la parada, la hora de bajada y la caminata. Si no sabés si corre horario hábil o de domingo, te muestra las dos opciones.
- **En viaje**: pasos con cuenta regresiva, botón "Ya subí" que recalcula todo con la hora real, y aviso de bajada por GPS ("Preparate" → "Tocá el timbre" → "Bajate acá") con sonido, vibración y pantalla siempre prendida. Sin GPS, avisa por horario.
- **Líneas**: recorrido y paradas de cada línea, tomados de [Paraná Online](https://www.paranaonline.com.ar/colectivos-parana/).
- **Planillas**: horarios guardados en el teléfono. Se cargan a mano o **desde una foto** (la lee la API de Anthropic con tu propia clave) y se revisan antes de guardar: la app marca las celdas que no cierran con el resto de la planilla.
- Funciona **sin conexión** con lo que ya está guardado.

## Instalar en Android

1. Abrí la dirección de la app en Chrome.
2. Menú ⋮ → **Agregar a la pantalla principal** → **Instalar**.
3. La primera vez que actives los avisos, aceptá el permiso de ubicación.

## Cómo se mantienen los datos

- `data/lineas.json` (recorridos y paradas) se genera con `node tools/actualizar.mjs` a partir de las páginas de cada línea en Paraná Online y de su mapa. Una tarea automática de GitHub lo corre todos los días; si cambia un recorrido queda anotado en `data/cambios.json` y la app lo muestra en la pestaña Líneas.
- Los **horarios completos no están publicados** en esas páginas (solo la próxima hora), así que las planillas se cargan desde fotos o a mano. Vienen precargadas las de la línea 6 (hábiles desde 26/05/26 y domingo desde agosto 2026).
- `data/calles.json` son las calles de la zona según © colaboradores de OpenStreetMap (ODbL); se usan para ponerle nombre a las paradas y para buscar esquinas sin conexión. Se renuevan con `node tools/actualizar.mjs --calles`.

## Desarrollo

Sin dependencias ni paso de compilación (HTML, CSS y JS a secas).

```bash
node tools/servir.mjs     # http://localhost:8765
node tools/probar.mjs     # pruebas de la lógica del planificador
node tools/actualizar.mjs # vuelve a leer recorridos y paradas
```

Esta app no tiene relación con ERSA ni con Paraná Online. Los horarios dependen de la empresa: ante la duda, llegá antes a la parada.
