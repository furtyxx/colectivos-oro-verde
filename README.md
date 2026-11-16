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

- **Paraná Online (principal).** Para cada parada, su página muestra solo los colectivos desde ahora hasta unas 2 horas adelante (medido: siete lecturas con un minuto de diferencia; los horarios no se mueven, son los programados, y solo van entrando horarios nuevos al final). Un trabajo de GitHub (`.github/workflows/horarios.yml` → `tools/horarios.mjs --bucle`) corre casi 6 horas seguidas leyendo las líneas interurbanas cada 5 minutos y las urbanas cada hora, y se vuelve a lanzar solo al terminar. Suma lo que ve a `data/horarios/crudo/`, arma los servicios en `data/horarios.json` y cada hora sube todo a GitHub.
  - Líneas **urbanas (A a S)**: la página trae el día completo, así que quedan completas desde la primera lectura.
  - Líneas **interurbanas**: el horario de un tipo de día (hábil, sábado, domingo) queda completo cuando se lee durante un día entero de ese tipo.
- **Historial.** Cada día queda `data/historial/AAAA-MM-DD.json` (los servicios con la hora de paso por cada parada) y `data/historial/resumen.json` (por día y línea: cantidad de servicios, primer y último horario, intervalo medio) para ver tendencias. Se ve en la pestaña Líneas.
- **Planillas (de apoyo).** Las imágenes de las planillas oficiales quedan guardadas para consulta en la pestaña Planillas. Se usan para estimar un viaje solo donde Paraná Online todavía no tiene el horario (se puede apagar en Ajustes) y el viaje queda marcado como estimado.
- `tools/actualizar.mjs` (una vez por día, desde el mismo trabajo): recorridos y paradas de las 9 líneas interurbanas y las 13 urbanas. `--lineas=a,f,6` lee solo algunas.

## Viajes con trasbordo y colectivos en el mapa

- Si no hay línea directa (o conviene combinar), `rutasConTrasbordo` busca hasta 3 colectivos de líneas distintas con paradas de cambio a ≤ 300 m, y `planificarRutas` encadena los horarios (el siguiente sale después de que llegás). No se ofrece un trasbordo si en directo salís después y llegás antes.
- La pestaña Líneas → "En vivo" dibuja dónde estaría cada colectivo ahora (interpolando entre paradas con horario), con un color para los de ida (celeste) y otro para los de vuelta (violeta). Son estimaciones con el horario programado, no el GPS real de los coches.
- Los mapas dibujan las calles de OpenStreetMap (`data/calles.json`), se mueven arrastrando y se acercan con ＋/－ o pellizcando.

## En viaje

- El GPS marca por dónde vas sobre el recorrido (parada actual, próxima y cuánto falta para bajar) apenas abrís "En viaje".
- Los avisos de bajada son un recuadro chico arriba de la pantalla, con vibración; si la app no está a la vista se mandan como notificación. Android pausa el GPS de las apps que no están visibles: para que el aviso por distancia sea confiable, la app tiene que estar abierta (sirve ventana flotante o pantalla dividida).

## Buscar lugares

Esquinas y paradas (sin conexión), OpenStreetMap y, con una clave de Google (Places API New) cargada en Ajustes, Google Maps. Desde Google Maps también se puede usar Compartir → Cole OV (`share_target` del manifest).

## Arribos (estilo "Cuándo llega", con datos de Paraná Online)

La pestaña Arribos muestra, para un lugar (o "cerca mío"), qué colectivos van a pasar por las paradas cercanas y cuánto falta, usando los horarios por parada de Paraná Online. "Cuándo llega" (cuandollega.smartmovepro.net) pide un token anti-falsificación y tiene límite de consultas del lado del servidor (responde 429: "se excedió el límite de consultas"), y el navegador no deja que esta app lo consulte directo; por eso la app no depende de él y deja el enlace como consulta aparte.
