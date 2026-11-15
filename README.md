# Colectivos Oro Verde ⇄ Paraná

App web instalable (PWA) para saber **qué colectivo tomar** entre Oro Verde y Paraná (líneas 6, 15 y las demás interurbanas de ERSA) y **cuándo bajarse**.

- **Planear**: decís de dónde a dónde vas y a qué hora tenés que estar (por ejemplo, a qué hora sale tu micro de la Terminal). Te muestra el colectivo recomendado, el anterior y uno "muy justo", con la hora para estar en la parada, la hora de bajada y la caminata. Si no sabés si corre horario hábil o de domingo, te muestra las dos opciones.
- **En viaje**: pasos con cuenta regresiva, botón "Ya subí" que recalcula todo con la hora real, y aviso de bajada por GPS ("Preparate" → "Tocá el timbre" → "Bajate acá") con sonido, vibración y pantalla siempre prendida. Sin GPS, avisa por horario.
- **Líneas**: recorrido y paradas de cada línea, tomados de [Paraná Online](https://www.paranaonline.com.ar/colectivos-parana/).
- **Planillas**: horarios guardados en el teléfono. Se cargan **desde la imagen de la planilla** o a mano. La app lee la imagen en el propio teléfono (sin clave, sin costo y sin enviarla a ningún lado): reconoce la línea, el tipo de día, cada parada (columna) y cada horario, ubica las columnas en el recorrido y muestra la tabla para revisar antes de guardar, marcando las celdas que no cierran con el resto. Opcionalmente puede leerla la API de Anthropic con tu propia clave (útil para fotos torcidas o borrosas).
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

## Lectura de planillas desde imágenes

- `js/ocr.js` agranda la imagen y la pasa por Tesseract (en `vendor/tesseract/`, se descarga la primera vez que se usa, unos 6 MB, y queda guardado para usarlo sin conexión).
- `js/tabla.js` arma la tabla con las palabras reconocidas: agrupa los horarios en filas y columnas, toma los encabezados como nombres de parada, lee del título la línea, el tipo de día y la vigencia, y vuelve a mirar de cerca las celdas vacías o dudosas.
- `node tools/probar.mjs` lo prueba con lo reconocido de las dos planillas reales de la línea 6 (`tools/muestras/`): 516 y 215 horarios, todos iguales a la transcripción revisada a mano.
- Anda bien con la imagen original de la planilla. Con una foto torcida, con sombras o sacada a una pantalla puede fallar: las celdas dudosas quedan en amarillo y las ilegibles en rojo.

## Horarios: de dónde salen

- **Paraná Online (principal).** Cada media hora una tarea de GitHub (`.github/workflows/horarios.yml`, `tools/horarios.mjs`) lee en cada línea los colectivos que anuncia cada parada y los suma a `data/horarios/crudo/`. Con eso arma, en `data/horarios.json`, los servicios completos de cada línea y tipo de día (hábil, sábado, domingo).
  - Líneas **urbanas (A a S)**: la página trae el día completo, así que están completas desde la primera lectura.
  - Líneas **interurbanas** (Oro Verde, San Benito, Colonia Avellaneda…): el sitio solo muestra lo que pasa en las próximas ~2 horas, por eso el horario se va completando con las lecturas; un tipo de día queda completo cuando se leyó durante todo un día de ese tipo.
- **Planillas (de apoyo).** Las imágenes de las planillas oficiales quedan guardadas para consulta en la pestaña Planillas. Se usan para estimar un viaje solo donde Paraná Online todavía no tiene el horario (se puede apagar en Ajustes) y el viaje queda marcado como estimado.
- `tools/actualizar.mjs` (cada día): recorridos y paradas de las 9 líneas interurbanas y las 13 urbanas. `--lineas=a,f,6` lee solo algunas.

## En viaje

- El GPS marca por dónde vas sobre el recorrido (parada actual, próxima y cuánto falta para bajar) apenas abrís "En viaje".
- Los avisos de bajada son un recuadro chico arriba de la pantalla, con vibración; si la app no está a la vista se mandan como notificación. Android pausa el GPS de las apps que no están visibles: para que el aviso por distancia sea confiable, la app tiene que estar abierta (sirve ventana flotante o pantalla dividida).

## Buscar lugares

Esquinas y paradas (sin conexión), OpenStreetMap y, con una clave de Google (Places API New) cargada en Ajustes, Google Maps. Desde Google Maps también se puede usar Compartir → Cole OV (`share_target` del manifest).
