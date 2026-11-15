// Pestaña "Ajustes".
import { h, toast, confirmar, hoyISO, poner } from './ui.js';
import { E, D, guardar } from './estado.js';
import { CFG_DEFECTO, LUGARES_DEFECTO, PRECARGADAS } from './datos.js';
import { probarSonido } from './vista-vivo.js';
import { abrirBuscador } from './buscador.js';

let instalar = null; // evento beforeinstallprompt
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; });

export function vistaAjustes(raiz) {
  const repintar = () => vistaAjustes(raiz);
  const c = E.cfg;
  const num = (clave, etiqueta, min, max) => h('label', { class: 'campo' }, etiqueta,
    h('input', { type: 'number', inputMode: 'numeric', min, max, value: c[clave], onchange: e => { const v = +e.target.value; c[clave] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : CFG_DEFECTO[clave]; e.target.value = c[clave]; guardar(); } }));
  const instalada = matchMedia('(display-mode: standalone)').matches;

  poner(raiz, 
    h('section', { class: 'panel' }, h('h2', {}, 'Horarios'),
      num('adelanto', 'El colectivo puede pasar hasta … minutos antes', 0, 30),
      num('margen', 'Margen por defecto antes del micro (min)', 0, 180),
      h('h2', { style: 'margin-top:6px' }, 'Horarios que conozco'),
      h('p', { class: 'suave chico' }, 'Valen más que el cálculo automático entre puntos de la planilla.'),
      ...c.reglas.map(r => h('label', { class: 'campo' }, `${r.nombre || 'Parada'} (línea ${r.linea}, ${r.sentido}): minutos después de "${{ facultad: 'Facultad', cruzsur: 'Américas y Cruz Sur' }[r.punto] || r.punto}"`,
        h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 60, value: r.mas, onchange: e => { r.mas = Math.max(0, +e.target.value || 0); guardar(); } })))),

    h('section', { class: 'panel' }, h('h2', {}, 'Caminata'),
      num('radioOrigen', 'Hasta cuántos metros camino para tomar el colectivo', 100, 3000),
      num('radioDestino', 'Hasta cuántos metros camino al bajar', 100, 3000),
      num('pasoMin', 'Mi paso (metros por minuto; 72 ≈ 4,3 km/h)', 40, 120)),

    h('section', { class: 'panel' }, h('h2', {}, 'Aviso de bajada por GPS'),
      num('gpsPreparate', '"Preparate" a … metros de la parada', 300, 5000),
      num('gpsTimbre', '"Tocá el timbre" a … metros', 150, 2000),
      num('gpsBajar', '"Bajate acá" a … metros', 30, 400),
      h('label', { class: 'fila' }, h('input', { type: 'checkbox', checked: !!c.sonido, onchange: e => { c.sonido = e.target.checked; guardar(); } }), h('span', {}, 'Además de vibrar, hacer sonido')),
      h('button', { class: 'btn', onclick: probarSonido }, '📳 Probar el aviso'),
      h('p', { class: 'suave chico' }, 'Los avisos solo vibran, sin sonido. Para que vibre, la app tiene que quedar abierta en pantalla (se mantiene prendida sola) y el teléfono no puede estar en "No molestar" sin vibración.')),

    h('section', { class: 'panel' }, h('h2', {}, 'Mis lugares'),
      h('ul', { class: 'lista' }, E.lugares.map(l => h('li', {}, h('div', { class: 'fila', style: 'padding:6px 0' },
        h('input', { class: 'crece', value: l.nombre, 'aria-label': 'Nombre del lugar', onchange: e => { l.nombre = e.target.value.trim() || l.nombre; delete l.reciente; guardar(); } }),
        h('button', { class: 'btn mini peligro', disabled: E.lugares.length <= 2, 'aria-label': `Borrar ${l.nombre}`, onclick: () => { E.lugares.splice(E.lugares.indexOf(l), 1); guardar(); repintar(); } }, 'Borrar'))))),
      h('button', { class: 'btn', onclick: () => abrirBuscador('Agregar lugar', p => {
        if (p.id === '__gps') p = { ...p, nombre: 'Lugar guardado ' + hoyISO() };
        if (!E.lugares.some(l => l.id === p.id)) E.lugares.push({ id: 'l' + Date.now().toString(36), nombre: p.nombre, lat: p.lat, lon: p.lon });
        guardar(); repintar();
      }) }, '＋ Agregar lugar'),
      h('p', { class: 'suave chico' }, '"Mi parada" es la esquina donde tomás el colectivo. Para cambiarla, agregá el lugar nuevo y borrá el viejo.')),

    h('section', { class: 'panel' }, h('h2', {}, 'Leer planillas desde fotos'),
      h('p', { class: 'suave chico' }, 'La app lee las planillas en este teléfono: gratis, sin clave y sin enviar la foto a ningún lado. Anda muy bien con la imagen original de la planilla (la que circula por WhatsApp). Si una foto sale torcida o borrosa y se lee mal, podés usar la lectura con Anthropic, que necesita una API key tuya.'),
      h('label', { class: 'campo' }, 'Cómo leer las fotos', h('select', { onchange: e => { c.lector = e.target.value; guardar(); if (c.lector === 'api' && !c.apiKey) toast('Pegá la API key acá abajo; mientras tanto se lee en el teléfono'); } },
        h('option', { value: 'telefono', selected: c.lector !== 'api' }, 'En el teléfono (gratis, sin clave)'),
        h('option', { value: 'api', selected: c.lector === 'api' }, 'Con Anthropic (necesita API key)'))),
      h('label', { class: 'campo' }, 'API key de Anthropic, opcional (se guarda solo en este teléfono)',
        h('input', { type: 'password', autocomplete: 'off', value: c.apiKey, placeholder: 'sk-ant-…', onchange: e => { c.apiKey = e.target.value.trim(); guardar(); toast(c.apiKey ? 'Clave guardada en este dispositivo' : 'Clave borrada'); } })),
      h('label', { class: 'campo' }, 'Modelo', h('input', { value: c.modelo, autocomplete: 'off', onchange: e => { c.modelo = e.target.value.trim() || CFG_DEFECTO.modelo; e.target.value = c.modelo; guardar(); } })),
      h('p', { class: 'suave chico' }, 'La clave se crea en console.anthropic.com. Solo si elegís "Con Anthropic" la foto se envía a Anthropic al tocar "Leer planilla desde foto", y cada lectura se cobra en tu cuenta.')),

    h('section', { class: 'panel' }, h('h2', {}, 'Instalar en el teléfono'),
      instalada ? h('p', { class: 'nota bien' }, 'Ya la estás usando como app instalada.')
        : instalar ? h('button', { class: 'btn pri', onclick: async () => { instalar.prompt(); await instalar.userChoice; instalar = null; repintar(); } }, 'Instalar la app')
          : h('p', { class: 'suave' }, 'En Chrome para Android: menú ⋮ → "Agregar a la pantalla principal" → "Instalar". Después funciona sin conexión con las planillas guardadas.')),

    h('section', { class: 'panel' }, h('h2', {}, 'Datos'),
      h('p', { class: 'suave chico' }, `Recorridos: ${D.lineas.length} líneas de Paraná Online (${D.lineas.map(l => l.id).join(', ')}). Calles: © colaboradores de OpenStreetMap. Lectura de fotos: Tesseract.js (Apache 2.0). Paraná Online y ERSA no tienen relación con esta app.`),
      h('div', { class: 'fila' },
        h('button', { class: 'btn mini', onclick: async () => {
          if (!(await confirmar('¿Volver a poner las planillas precargadas (líneas 6 y 15) como vinieron? Se pierden los cambios que les hayas hecho.', 'Restaurar'))) return;
          E.planillas = E.planillas.filter(p => !PRECARGADAS.some(x => x.id === p.id || (p.linea === x.linea && p.tipo === x.tipo)));
          E.planillas.push(...structuredClone(PRECARGADAS)); E.borradas = []; guardar(); toast('Planillas restauradas');
        } }, 'Restaurar planillas precargadas'),
        h('button', { class: 'btn mini peligro', onclick: async () => {
          if (!(await confirmar('¿Borrar todos los ajustes, lugares y planillas guardados en este teléfono?', 'Borrar todo'))) return;
          localStorage.clear(); location.reload();
        } }, 'Borrar todo'))));
  void LUGARES_DEFECTO;
}
