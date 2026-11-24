/* =============================================================================
 *  Costos de insumos — Lucciano's (frontend)
 *  Vanilla JS, sin build. Habla con el Worker (window.COSTOS_API).
 *  1.5.0: #/tablero (tablero ejecutivo, en tablero.js) es la pantalla de inicio. Corrige rendimiento de recetas
 *         en el simulador, contenido de envases multipack ("6 x 1,15 kg"), controles al vincular y formato de moneda.
 *  Rutas: #/inicio, #/alertas, #/insumos, #/insumo/ID, #/vincular, #/facturas,
 *         #/admin, #/guia, #/cuenta
 *  Recetas de Shares (1.4.0): #/productos, #/bases, #/receta/TIPO/ID, #/mp, #/mp/ID, #/comparar,
 *         #/cambios, #/simulador (el código está al final del archivo)
 * ============================================================================= */
'use strict';

// ---------------------------------------------------------------------------
//  Estado y utilidades
// ---------------------------------------------------------------------------
const API = (() => {
  // ?api=http://localhost:8787 permite apuntar a otro Worker (pruebas)
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q) localStorage.setItem('costos_api', q);
    return (localStorage.getItem('costos_api') || window.COSTOS_API).replace(/\/$/, '');
  } catch { return String(window.COSTOS_API).replace(/\/$/, ''); }
})();

// Login único: la sesión viene del portal de Herramientas (Worker acceso-api)
const PORTAL = 'https://herramientas.luccianos.com.ar';
const ACCESO_API = 'https://acceso-api.lucciano-viaticos.workers.dev';
const ACCESO_APP = 'costos';
// Transición: mientras sea true se puede seguir entrando con la clave vieja de Costos. Al terminar, pasarlo a false.
const LOGIN_VIEJO = true;
const esTokenViejo = (t) => /^[a-f0-9]{64}$/i.test(t || '');

const S = { token: null, user: null, vista: null };
try { S.token = localStorage.getItem('costos_token'); } catch { /* sin storage */ }

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NIVEL = { consulta: 1, editor: 2, admin: 3 };
const puede = (rol) => S.user && NIVEL[S.user.rol] >= NIVEL[rol];

const fmtNum = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCant = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const $$m = (n) => { if (n === null || n === undefined || n === '') return '—'; const x = Number(n); return Number.isFinite(x) ? '$ ' + fmtNum.format(x) : '—'; };
// Importe con su moneda: pesos ($), dólares (US$), euros (€). Antes un importe en dólares se mostraba "DOL $ 32,88" y en ARS salía "ARS $".
const $$mon = (n, mon) => { const m = String(mon || 'PES').toUpperCase(); if (m === 'PES' || m === 'ARS') return $$m(n); const x = Number(n); if (!Number.isFinite(x)) return '—';
  return ({ DOL: 'US$ ', USD: 'US$ ', EUR: '€ ', '060': '€ ' }[m] || m + ' ') + fmtNum.format(x); };
const fmtF = (v) => {
  if (!v) return '—';
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  return s;
};
const fmtFH = (s) => {
  if (!s) return '—';
  const t = String(s);
  const d = new Date(t.replace(' ', 'T') + (/Z|[+-]\d{2}:?\d{2}$/.test(t) || !/\d{2}:\d{2}/.test(t) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? fmtF(t) : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
};
const fmtCuit = (c) => { c = String(c || ''); return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : (c || '—'); };
const TIPOS = { 1: 'FA', 2: 'ND A', 3: 'NC A', 6: 'FB', 7: 'ND B', 8: 'NC B', 11: 'FC', 12: 'ND C', 13: 'NC C', 51: 'FM', 201: 'FCE A', 206: 'FCE B', 211: 'FCE C', 17: 'LSP A', 18: 'LSP B', 81: 'TFA', 82: 'TFB', 83: 'Tique' };
const nroCbte = (f) => (f.pto_vta != null && f.numero != null) ? `${String(f.pto_vta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}` : '—';

// Unidades de medida de los insumos
const UNI = { kg: 'kg', l: 'litro', un: 'unidad' };
const UNI_C = { kg: 'kg', l: 'l', un: 'u.' };
// Precio por unidad base: "$ 2.296,91 /kg"
const fmtP = (p, u) => p === null || p === undefined || p === '' ? '—' : `${$$m(p)}<span class="por-u">/${esc(UNI_C[u] || u || '')}</span>`;
// Variación: ▲ sube (malo para costos) en rojo, ▼ baja en verde, casi igual en gris
const chipVar = (v, { titulo = '' } = {}) => {
  if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
  const x = Number(v);
  const cls = x >= 0.05 ? 'sube' : x <= -0.05 ? 'baja' : 'igual';
  const fl = x >= 0.05 ? '▲' : x <= -0.05 ? '▼' : '=';
  return `<span class="var ${cls}" ${titulo ? `title="${esc(titulo)}"` : ''}>${fl} ${Math.abs(x).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %</span>`;
};
const TIPO_ALERTA = {
  suba: ['Subió', 'b-critica'], baja: ['Bajó', 'b-ok'],
  sobre_promedio: ['Sobre el promedio', 'b-warn'], mas_caro: ['Otro proveedor más barato', 'b-warn'],
};
const icoAlerta = (t) => `<span class="al-ico al-${esc(t)}" aria-hidden="true">${t === 'baja' ? '▼' : t === 'suba' ? '▲' : t === 'mas_caro' ? '$' : '≈'}</span>`;
const badgeAlerta = (t) => `<span class="badge ${(TIPO_ALERTA[t] || [])[1] || ''}">${esc((TIPO_ALERTA[t] || [t])[0])}</span>`;
function textoAlerta(a) {
  const v = Math.abs(Number(a.variacion_pct) || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  if (a.tipo === 'suba') return `${a.proveedor || 'El proveedor'} lo subió ${v} % contra su compra anterior`;
  if (a.tipo === 'baja') return `${a.proveedor || 'El proveedor'} lo bajó ${v} % contra su compra anterior`;
  if (a.tipo === 'mas_caro') return `${a.proveedor || 'Este proveedor'} cobra ${v} % más que ${String(a.ref_detalle || 'otro').replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '')}`;
  if (a.tipo === 'sobre_promedio') return `Se pagó ${v} % por encima del promedio`;
  return a.tipo;
}
const LECTURAS = {
  espera: ['Esperando confirmación', 'b-aviso'], pendiente: ['En cola', 'b-recibida'], leyendo: ['Leyendo', 'b-recibida'],
  ok: ['Leída', 'b-ok'], revisar: ['No cierra', 'b-warn'], sin_renglones: ['Sin renglones', 'b-warn'], error: ['Error al leer', 'b-critica'], descartada: ['Descartada', 'b-aviso'],
  duplicada: ['Duplicada', 'b-aviso'],
};
const badgeLectura = (l) => `<span class="badge ${(LECTURAS[l] || [])[1] || ''}">${esc((LECTURAS[l] || [l])[0])}</span>`;
// ---- Unidades: siempre se compara por kg, litro o unidad, más allá de la presentación ----
// Unidad tal como viene en la factura → nombre legible
function unidadFact(u) {
  const t = normQ(u).replace(/[^a-z]/g, '');
  if (!t) return 'unidad';
  const M = [[/^(kg|kgs|kilo|kilos|kilogramo|kilogramos|k)$/, 'kg'], [/^(gr|grs|g|gramo|gramos)$/, 'gramo'], [/^(tn|ton|tonelada|toneladas)$/, 'tonelada'],
    [/^(l|lt|lts|litro|litros|ltr)$/, 'litro'], [/^(ml|cc|mililitro|mililitros)$/, 'ml'],
    [/^(u|un|uni|unid|unidad|unidades|ud|uds|c\/u|cu)$/, 'unidad'], [/^caj|^cja|^cj$/, 'caja'], [/^bul/, 'bulto'], [/^bol/, 'bolsa'], [/^bal/, 'balde'],
    [/^bid/, 'bidón'], [/^pa?q|^pack/, 'paquete'], [/^tam/, 'tambor'], [/^dis|^dsp/, 'display'], [/^bot/, 'botella'], [/^doc/, 'docena'], [/^fr/, 'frasco'], [/^lat/, 'lata'], [/^rol/, 'rollo']];
  for (const [rx, n] of M) if (rx.test(t)) return n;
  return String(u).toLowerCase();
}
// Si la unidad facturada ya es de peso/volumen/unidad, el factor sale solo (1 kg = 1 kg; 1 gramo = 0,001 kg; 1 docena = 12 u.)
function factorDirecto(uFact, base) {
  const n = unidadFact(uFact);
  const T = { kg: { kg: 1, gramo: 0.001, tonelada: 1000 }, l: { litro: 1, ml: 0.001 }, un: { unidad: 1, docena: 12 } };
  return (T[base] || {})[n] ?? null;
}
// Cuando la factura dice "unidad" pero el renglón es un envase ("BULTOX100U"), se nombra el envase de la descripción
function envaseDe(desc) {
  const t = normQ(desc);
  const M = [[/bulto/, 'bulto'], [/caj|cja\b/, 'caja'], [/bolsa/, 'bolsa'], [/balde/, 'balde'], [/bidon/, 'bidón'], [/pack|paq/, 'paquete'], [/tambor/, 'tambor'], [/display/, 'display']];
  for (const [rx, n] of M) if (rx.test(t)) return n;
  return 'envase';
}
// Unidad en la que se facturó, para mostrar: la de la factura, o el envase si dice "unidad" pero trae varias
function unidadMostrar(uFact, factor, base, desc) {
  const n = unidadFact(uFact);
  if (n === 'unidad' && Number(factor) > 1 && desc) return envaseDe(desc);
  return n;
}
// "1 caja = 15 kg" / "se compra por kg"
function textoEquivale(uFact, factor, base, desc) {
  if (!factor) return 'falta indicar cuánto trae';
  const n = unidadMostrar(uFact, factor, base, desc);
  if (factorDirecto(uFact, base) === Number(factor) && Number(factor) === 1) return `se compra por ${UNI[base]}`;
  return `1 ${n} = ${fmtCant.format(factor)} ${UNI_C[base]}`;
}
// Contenido declarado en la descripción: "BULTOX100U" → 100 u. · "CAJ X 15 KG" → 15 kg · "X 500 GR" → 0,5 kg · "X 5 LT" → 5 l
function contenidoEnDescripcion(desc, base) {
  const t = normQ(desc).toUpperCase();
  const n = (x) => Number(String(x).replace(',', '.'));
  let m;
  // Multipack: "CAJA X 6GRIP X 1,15KG" → 6 × 1,15 = 6,9 kg · "PACK 12X1LT" → 12 l · "X2LTS X6" → 12 l.
  // Va primero: si no, se toma solo el contenido de una unidad interna y el precio por kg sale multiplicado (bug 1.4.1).
  const UK = '(KG|KGS|K|KILOS?|GR|GRS|G|LT|LTS|L|LITROS?|ML|CC)';
  const aBase = (v, u) => { u = u.replace(/S$/, ''); const kg = /^(KG|K|KILO)$/.test(u), g = /^(GR|G)$/.test(u), l = /^(LT|L|LITRO)$/.test(u), ml = /^(ML|CC)$/.test(u);
    if (base === 'kg') return kg ? v : g ? v / 1000 : null;
    if (base === 'l') return l ? v : ml ? v / 1000 : null;
    return null; };
  if (base !== 'un') {
    if ((m = t.match(new RegExp(`(\\d+)\\s*(?:[A-Z]+\\s*)?X\\s*(\\d+(?:[.,]\\d+)?)\\s*${UK}\\b`)))) { const v = aBase(n(m[1]) * n(m[2]), m[3]); if (v) return v; }
    if ((m = t.match(new RegExp(`X?\\s*(\\d+(?:[.,]\\d+)?)\\s*${UK}\\s*X\\s*(\\d+)\\b(?!\\s*${UK})`)))) { const v = aBase(n(m[1]) * n(m[3]), m[2]); if (v) return v; }
  }
  if (base === 'un') {
    if ((m = t.match(/X\s*(\d+)\s*(?:U|UN|UNI|UNID|UNIDADES|UDS?|PZAS?|PIEZAS?)\b/))) return n(m[1]);
    if ((m = t.match(/(?:BULTO|CAJA|CAJ|CJA|PACK|PAQ|BOLSA)\s*X?\s*(\d+)\b(?!\s*(?:KG|GR|G|LT|L|ML|CC)\b)/))) return n(m[1]);
  }
  if (base === 'kg') {
    if ((m = t.match(/X\s*(\d+(?:[.,]\d+)?)\s*(?:KG|KGS|K|KILOS?)\b/))) return n(m[1]);
    if ((m = t.match(/X\s*(\d+(?:[.,]\d+)?)\s*(?:GR|GRS|G)\b/))) return n(m[1]) / 1000;
    if ((m = t.match(/(\d+)\s*\/\s*(\d+)\s*(?:KG|KGS)\b/))) return n(m[1]) / n(m[2]);   // "1/4KG" → 0,25
    if ((m = t.match(/(?<![\d\/])(\d+(?:[.,]\d+)?)\s*(?:KG|KGS)\b/))) return n(m[1]);
  }
  if (base === 'l') {
    if ((m = t.match(/X?\s*(\d+(?:[.,]\d+)?)\s*(?:LT|LTS|L|LITROS?)\b/))) return n(m[1]);
    if ((m = t.match(/X\s*(\d+(?:[.,]\d+)?)\s*(?:ML|CC)\b/))) return n(m[1]) / 1000;
  }
  return null;
}
// Factor sugerido para vincular. Si la factura dice explícitamente kg, litro, gramo, etc. → conversión directa.
// Si dice "unidad" (genérico) o un envase (caja, bulto, bolsa…) → lo que trae según la descripción o según la IA.
function factorSugerido(g, base) {
  const d = factorDirecto(g.unidad, base);
  const generica = ['unidad'].includes(unidadFact(g.unidad));
  if (d && !generica) return d;
  const enDesc = contenidoEnDescripcion(g.descripcion, base);
  if (enDesc && enDesc > 0) return enDesc;
  if (g.contenido && (!g.unidad_base || g.unidad_base === base)) return g.contenido;
  return d;
}
// Control de la equivalencia antes de vincular: si lo que la IA leyó como contenido del envase no coincide con el
// factor propuesto, o si el precio por kg/l/u queda muy lejos de la referencia (compras anteriores o Shares), no se
// confirma con un clic: hay que revisarlo. Devuelve el motivo, o null si está todo bien.
function chequeoFactor(g, base, factor, ref = null) {
  if (!factor) return null;
  const directo = factorDirecto(g.unidad, base);
  const generica = unidadFact(g.unidad) === 'unidad';
  // Solo cuando la IA dijo explícitamente la misma unidad base (sin eso, en un pote "1/4 kg" el 0,25 es la capacidad y no
  // cuántas unidades trae: daba falsos avisos). Un envase por unidad nunca trae menos de 1.
  if (g.contenido && g.unidad_base === base && !(base === 'un' && Number(g.contenido) < 1) && !(directo && !generica) && Math.abs(Number(g.contenido) / factor - 1) > 0.02)
    return `La IA leyó que cada ${unidadMostrar(g.unidad, factor, base, g.descripcion)} trae ${fmtCant.format(g.contenido)} ${UNI_C[base]}, no ${fmtCant.format(factor)}. Revisá cuál es el correcto en la factura.`;
  const pc = precioComparable(g.ult_unit_ars, factor);
  if (pc && ref && (pc / ref > 2 || pc / ref < 0.5)) return `Daría ${$$m(pc)} por ${UNI[base]} y la referencia es ${$$m(ref)}: más del doble o menos de la mitad.`;
  return null;
}
// Precio comparable: $ por kg / litro / unidad
const precioComparable = (unitArs, factor) => unitArs && factor ? unitArs / factor : null;

const RUBROS_BASE = ['Lácteos', 'Azúcares y endulzantes', 'Chocolates y cacao', 'Frutas', 'Frutos secos', 'Pastas y saborizantes', 'Estabilizantes y aditivos', 'Envases y packaging', 'Descartables', 'Otros'];


function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'ver' + (error ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, error ? 6000 : 3000);
}

async function api(path, { method = 'GET', body, raw = false } = {}) {
  // "Failed to fetch" = no llegó ninguna respuesta (corte de red, el Worker se reinició o se pasó de tiempo).
  // Las consultas (GET) se reintentan solas 2 veces; las que modifican datos no, para no duplicar nada.
  let res;
  for (let intento = 0; ; intento++) {
    try {
      res = await fetch(API + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      // 500 también: D1 a veces devuelve "D1_ERROR: internal error" transitorio (se vio en las pruebas). Un GET se puede repetir sin riesgo.
      if (method === 'GET' && [500, 502, 503, 504].includes(res.status) && intento < 2) throw new TypeError('HTTP ' + res.status);
      break;
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      if (method !== 'GET' || intento >= 2) throw new Error(method === 'GET' ? 'No hay conexión con el servidor. Probá de nuevo en unos segundos.' : 'Se cortó la conexión y no sé si se guardó. Recargá la factura antes de volver a intentar.');
      await new Promise(r => setTimeout(r, 700 * (intento + 1)));
    }
  }
  if (res.status === 401 && S.token && !path.startsWith('/api/login')) {
    salir(false);
    throw new Error('La sesión venció. Volvé a ingresar.');
  }
  if (raw) { if (!res.ok) throw new Error('HTTP ' + res.status); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

// Envuelve un botón: lo deshabilita con spinner mientras corre la acción
async function conBoton(btn, fn) {
  const txt = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="cargando"></span>'; }
  try { return await fn(); }
  catch (e) { toast(e.message, true); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = txt; } }
}

function modal(html, { ancho = false, alMontar } = {}) {
  const m = $('#modal');
  $('.modal-box', m).classList.toggle('ancho', ancho);
  $('.modal-cuerpo', m).innerHTML = html;
  m.hidden = false;
  const cerrar = () => { m.hidden = true; $('.modal-cuerpo', m).innerHTML = ''; };
  $('.modal-cerrar', m).onclick = cerrar;
  // Se cierra solo si el clic EMPEZÓ y TERMINÓ afuera: al seleccionar texto de un campo arrastrando el mouse
  // y soltar afuera del recuadro, no se cierra
  let abajoAfuera = false;
  m.onmousedown = (e) => { abajoAfuera = e.target === m; };
  m.onclick = (e) => { if (e.target === m && abajoAfuera) cerrar(); abajoAfuera = false; };
  if (alMontar) alMontar($('.modal-cuerpo', m), cerrar);
  const primero = $('input, textarea, select', m);
  if (primero) setTimeout(() => primero.focus(), 30);
  return cerrar;
}

// Confirmación propia (en vez de confirm() del navegador, que Chrome puede bloquear en silencio
// si alguna vez se tildó "no permitir más diálogos": ahí el botón parece no hacer nada)
function confirmar(texto, { boton = 'Sí, seguir', peligro = false } = {}) {
  return new Promise((resolve) => {
    let hecho = false;
    modal(`<h2 style="margin-bottom:6px">¿Confirmás?</h2><p class="muted" style="white-space:pre-line;margin:0 0 18px">${esc(texto)}</p>
      <div class="acciones" style="justify-content:flex-end"><button class="btn" data-no>Cancelar</button><button class="btn ${peligro ? 'btn-rojo' : 'btn-acento'}" data-si>${esc(boton)}</button></div>`, {
      alMontar: (el, cerrar) => {
        const fin = (v) => { if (hecho) return; hecho = true; cerrar(); resolve(v); };
        $('[data-si]', el).onclick = () => fin(true);
        $('[data-no]', el).onclick = () => fin(false);
        setTimeout(() => $('[data-si]', el)?.focus(), 0);
        const obs = new MutationObserver(() => { if ($('#modal').hidden) { obs.disconnect(); if (!hecho) { hecho = true; resolve(false); } } });
        obs.observe($('#modal'), { attributes: true });
      },
    });
  });
}

function pedirTexto({ titulo, ayuda = '', etiqueta = 'Comentario', boton = 'Confirmar', minimo = 5, valor = '' }) {
  return new Promise((resolve) => {
    let listo = false;
    modal(`<h2>${esc(titulo)}</h2>${ayuda ? `<p class="muted">${esc(ayuda)}</p>` : ''}
      <div class="campo"><label>${esc(etiqueta)}</label><textarea id="pt-txt">${esc(valor)}</textarea></div>
      <div class="acciones"><button class="btn btn-negro" id="pt-ok">${esc(boton)}</button><button class="btn" id="pt-no">Cancelar</button></div>`, {
      alMontar: (el, cerrar) => {
        $('#pt-ok', el).onclick = () => {
          const v = $('#pt-txt', el).value.trim();
          if (v.length < minimo) { toast(`Escribí al menos ${minimo} caracteres.`, true); return; }
          listo = true; cerrar(); resolve(v);
        };
        $('#pt-no', el).onclick = () => { cerrar(); resolve(null); };
        const obs = new MutationObserver(() => { if ($('#modal').hidden) { obs.disconnect(); if (!listo) resolve(null); } });
        obs.observe($('#modal'), { attributes: true });
      },
    });
  });
}


function descargarCsv(nombre, filas) {
  const csv = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
//  Sesión

// ---------------------------------------------------------------------------
//  Íconos, tema, actualizar e instalar (igual que las otras apps)
// ---------------------------------------------------------------------------
const svgI = (p) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICO = {
  home: svgI('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  inbox: svgI('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  doc: svgI('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  send: svgI('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>'),
  users: svgI('<path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="9" cy="8" r="4"/><path d="M17 11a3 3 0 1 0 0-6M21 21v-2a4 4 0 0 0-3-3.87"/>'),
  gear: svgI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  search: svgI('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  upload: svgI('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  refresh: svgI('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  logout: svgI('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  check: svgI('<path d="M20 6 9 17l-5-5"/>'),
  arrow: svgI('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: svgI('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  user: svgI('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
  copy: svgI('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  shield: svgI('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
  calc: svgI('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>'),
  x: svgI('<path d="M6 6l12 12M18 6 6 18"/>'),
  mail: svgI('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  sparkle: svgI('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  sun: svgI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svgI('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  info: svgI('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  alert: svgI('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  coin: svgI('<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.6 2.6 0 0 1-2.5-1.5M12 6.5V8M12 16v1.5"/>'),
  ojo: svgI('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  ojoNo: svgI('<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>'),
  clock: svgI('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  calendar: svgI('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'),
  chart: svgI('<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>'),
  chat: svgI('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>'),
  phone: svgI('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
  sliders: svgI('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  camara: svgI('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  tarjeta: svgI('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'),
  book: svgI('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
};
const COLORES_AV = ['#b0254a', '#2d5bba', '#1f7a45', '#a85a07', '#6b4bb8', '#0f7d86', '#7a4a2e', '#c0392b'];
const iniciales = (s) => String(s || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(SRL|SAS|S\.?A\.?|SA|SOCIEDAD|ANONIMA)$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || String(s || '?').slice(0, 1).toUpperCase();
const colorDe = (s) => COLORES_AV[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORES_AV.length];
const cuad = (s) => `<span class="cuad" style="background:${colorDe(s)}" aria-hidden="true">${esc(iniciales(s))}</span>`;
const nombreProv = (f) => f.razon_social_emisor || 'Sin identificar';
const $$corto = (n) => { n = Number(n) || 0; return Math.abs(n) >= 1e6 ? '$ ' + (n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M' : $$m(n); };

// Ojito para ver la contraseña: se agrega solo a cualquier campo de contraseña que aparezca (login, Mi cuenta, modales)
function ojosClave(root = document) {
  $$('input[type="password"]:not([data-ojo])', root).forEach(inp => {
    inp.dataset.ojo = '1';
    const caja = document.createElement('span');
    caja.className = 'clave-caja';
    inp.parentNode.insertBefore(caja, inp);
    caja.appendChild(inp);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'clave-ojo'; b.tabIndex = -1;
    b.setAttribute('aria-label', 'Mostrar contraseña'); b.title = 'Mostrar contraseña';
    b.innerHTML = ICO.ojo;
    b.onclick = () => {
      const ver = inp.type === 'password';
      inp.type = ver ? 'text' : 'password';
      b.innerHTML = ver ? ICO.ojoNo : ICO.ojo;
      const t = ver ? 'Ocultar contraseña' : 'Mostrar contraseña';
      b.setAttribute('aria-label', t); b.title = t;
      inp.focus();
    };
    caja.appendChild(b);
  });
}
new MutationObserver(() => ojosClave()).observe(document.documentElement, { childList: true, subtree: true });

// Tema claro/oscuro (lo inicializa index.html antes de pintar)
function temaActual() { const t = document.documentElement.dataset.theme; return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function alternarTema() {
  const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem('costos_tema', nuevo); } catch { }
  const b = $('#b-tema'); if (b) b.innerHTML = nuevo === 'dark' ? ICO.sun : ICO.moon;
}


// ---- Actualizar: trae datos frescos y, si hay una versión nueva de la app, la carga ----
async function actualizar() {
  const b = $('#b-actualizar');
  if (b) b.classList.add('girando');
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) {
      await reg.update().catch(() => null);
      if (reg.waiting || reg.installing) { location.reload(); return; }
    }
    S.cnt = null; S.cuentas = null;
    await router();
    toast('Actualizado');
  } finally { const x = $('#b-actualizar'); if (x) x.classList.remove('girando'); }
}

// ---- App instalable (celular) ----
const esStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.instalar = e; $$('[data-instalar]').forEach(x => pintarInstalar(x)); });
window.addEventListener('appinstalled', () => { S.instalar = null; toast('Listo: la app quedó en tu pantalla de inicio'); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => null));
}
// Tarjeta "Instalar en el celular" (Mi cuenta)
function pintarInstalar(el) {
  if (esStandalone()) { el.innerHTML = `<p class="con-ico">${ICO.check}Ya la estás usando como app instalada.</p>`; return; }
  if (S.instalar) {
    el.innerHTML = `<p class="muted">Queda con el logo de Lucciano's en tu pantalla de inicio y abre directo, sin el navegador.</p><button class="btn btn-acento" data-btn-instalar>${ICO.phone}Instalar la app</button>`;
    $('[data-btn-instalar]', el).onclick = async () => { const p = S.instalar; S.instalar = null; p.prompt(); await p.userChoice.catch(() => null); pintarInstalar(el); };
    return;
  }
  el.innerHTML = esIOS()
    ? `<p class="muted">En el iPhone, abrí la app en <b>Safari</b>, tocá el botón <b>Compartir</b> (el cuadrado con la flecha para arriba) y elegí <b>“Agregar a inicio”</b>.</p>`
    : `<p class="muted">Abrí la app en <b>Chrome</b> desde el celular, tocá el menú <b>⋮</b> y elegí <b>“Instalar app”</b> o <b>“Agregar a la pantalla principal”</b>.</p>`;
}
const bloqueInstalar = () => `<div class="panel panel-pad" style="max-width:560px"><h2 style="margin-bottom:8px">Instalar en el celular</h2><div data-instalar></div></div>`;
function montarInstalar(root = document) { $$('[data-instalar]', root).forEach(x => pintarInstalar(x)); }

// ---------------------------------------------------------------------------
//  Sesión
// ---------------------------------------------------------------------------
function guardarToken(t) { S.token = t; try { t ? localStorage.setItem('costos_token', t) : localStorage.removeItem('costos_token'); } catch { } }
async function salir(llamarApi = true) {
  const central = S.token && !esTokenViejo(S.token);
  if (llamarApi) {
    if (central) await fetch(ACCESO_API + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token } }).catch(() => null);
    else await api('/api/logout', { method: 'POST' }).catch(() => null);
  }
  guardarToken(null); S.user = null;
  if (central && llamarApi) { location.href = PORTAL; return; }
  location.hash = '';
  vistaLogin();
}

// Llegada desde el portal: si ya tiene sesión entra al instante; si no, el portal le consigue una y lo devuelve
async function canjearAcceso() {
  // #portal o #portal=<ruta>: llega desde Herramientas (con la ruta a abrir, si vino del buscador o de un pendiente)
  const mPortal = location.hash.match(/^#portal(?:=(.+))?$/);
  if (mPortal) {
    const destino = mPortal[1] ? decodeURIComponent(mPortal[1]) : '#/tablero';
    history.replaceState(null, '', location.pathname + location.search + destino);
    if (!S.token) { location.replace(PORTAL + '/#ir=' + ACCESO_APP); return 'redirigiendo'; }
    return;
  }
  const m = location.hash.match(/^#acceso=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search + '#/tablero');
  try {
    const res = await fetch(ACCESO_API + '/canjear', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: m[1], app: ACCESO_APP }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || 'No se pudo ingresar.');
    guardarToken(r.token);
  } catch (e) {
    setTimeout(() => toast(e.message.includes('fetch') ? 'No se pudo conectar para ingresar. Volvé a entrar desde el portal.' : e.message, true), 400);
  }
}
Object.assign(ICO, {
  bell: svgI('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  box: svgI('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  link: svgI('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  trend: svgI('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
  pencil: svgI('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  merge: svgI('<path d="M6 3v6a6 6 0 0 0 6 6h6"/><path d="M15 12l3 3-3 3M6 21v-6"/>'),
});

// Color de la barra del navegador en el celu (pistacho en el login, el normal adentro)
function colorBarra(c) {
  $$('meta[name="theme-color"]').forEach(m => { if (!m.dataset.orig) m.dataset.orig = m.content; m.content = c || m.dataset.orig; });
}

// ---------------------------------------------------------------------------
//  Login
// ---------------------------------------------------------------------------
async function vistaLogin() {
  let setup = false;
  try { setup = (await api('/api/estado')).setup_requerido; } catch (e) {
    $('#app').innerHTML = `<div class="login"><div class="login-arte"><img src="logo-negro.png" alt="Lucciano's"><div></div></div>
      <div class="login-form"><div class="caja"><h1>Sin conexión</h1><p>No pude conectar con el servidor. Probá de nuevo en unos segundos.</p><p class="small muted">Detalle técnico: ${esc(e.message)}</p><button class="btn btn-acento btn-grande" onclick="location.reload()">${ICO.refresh}Reintentar</button></div></div></div>`;
    return;
  }
  $('#app').innerHTML = `<div class="login">
    <div class="login-arte"><img src="logo-negro.png" alt="Lucciano's"><p class="login-sub">Costos de insumos</p>
      <div class="login-txt"><h2>Lo que te cobran, compra por compra.</h2><p>Los precios de las materias primas salen solos de las facturas de proveedores. Cada suba queda registrada y te avisa.</p></div>
      <div class="pasos"><span>${ICO.doc}Facturas</span><span>${ICO.sparkle}Se leen los renglones</span><span>${ICO.box}Precio por kg</span><span>${ICO.bell}Alertas</span></div></div>
    <div class="login-form"><form id="f-login">
      <h1>${setup ? 'Primer ingreso' : 'Ingresar'}</h1>
      <p>${setup ? 'Creá el usuario administrador.' : "Entrá desde el portal de Herramientas, con tu usuario de Lucciano's."}</p>
      ${setup ? '' : `<a class="btn btn-acento btn-grande" href="${PORTAL}/#ir=${ACCESO_APP}" style="text-decoration:none;justify-content:center">Ir al portal ${ICO.arrow}</a>`}
      ${setup ? '' : (LOGIN_VIEJO ? '<details class="login-viejo" style="margin-top:22px"><summary style="cursor:pointer;color:var(--muted,#777);font-size:13.5px">Ingresar con la clave anterior de Costos</summary><div style="margin-top:14px">' : '<div hidden>')}
      ${setup ? '<div class="campo"><label for="lg-n">Nombre</label><input id="lg-n" name="nombre" required autocomplete="name"></div>' : ''}
      <div class="campo"><label for="lg-u">Mail</label><input id="lg-u" name="email" type="email" required autocomplete="username"></div>
      <div class="campo"><label for="lg-p">Contraseña</label><input id="lg-p" name="password" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 10 : 1}"></div>
      <div class="campo hidden" id="c-totp"><label for="lg-t">Código de verificación</label><input id="lg-t" name="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" class="mono"></div>
      <button class="btn btn-acento btn-grande" type="submit">${setup ? 'Crear y entrar' : 'Entrar'} ${ICO.arrow}</button>
      ${setup ? '' : (LOGIN_VIEJO ? '</div></details>' : '</div>')}
    </form></div></div>`;
  colorBarra('#A8C686');
  $('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await conBoton($('button[type=submit]', e.target), async () => {
      const r = await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: fd });
      if (r.requiere_totp) { $('#c-totp').classList.remove('hidden'); $('#c-totp input').focus(); toast('Ingresá el código de tu app autenticadora.'); return; }
      guardarToken(r.token); S.user = r.usuario; colorBarra(null);
      if (!location.hash) location.hash = '#/tablero';
      iniciar();
    });
  };
}

// ---------------------------------------------------------------------------
//  Shell y router
// ---------------------------------------------------------------------------
const RUTAS = [
  { re: /^#\/tablero$/, v: (el) => vistaTablero(el), nav: 'tablero', miga: '<b>Tablero</b>' },
  { re: /^#\/inicio$/, v: vistaInicio, nav: 'inicio', miga: 'Seguimiento / <b>Novedades de compras</b>' },
  { re: /^#\/alertas$/, v: vistaAlertas, nav: 'alertas', miga: 'Seguimiento / <b>Alertas</b>' },
  { re: /^#\/insumos$/, v: vistaInsumos, nav: 'insumos', miga: 'Seguimiento / <b>Insumos</b>' },
  { re: /^#\/insumo\/(\d+)$/, v: vistaInsumo, nav: 'insumos', miga: 'Seguimiento / <a href="#/insumos">Insumos</a> / <b>Insumo</b>' },
  { re: /^#\/vincular$/, v: vistaVincular, nav: 'vincular', miga: 'Trabajo / <b>Para vincular</b>' },
  { re: /^#\/facturas$/, v: vistaFacturas, nav: 'facturas', miga: 'Trabajo / <b>Facturas leídas</b>' },
  { re: /^#\/factura\/(\d+)$/, v: vistaFactura, nav: 'facturas', miga: 'Trabajo / <a href="#/facturas">Facturas leídas</a> / <b>Factura</b>' },
  { re: /^#\/productos$/, v: (el) => vistaRecLista(el, 'PRODUCTO_TERMINADO'), nav: 'productos', miga: 'Recetas / <b>Productos terminados</b>' },
  { re: /^#\/bases$/, v: (el) => vistaRecLista(el, 'BASE'), nav: 'bases', miga: 'Recetas / <b>Bases</b>' },
  { re: /^#\/receta\/(PRODUCTO_TERMINADO|BASE)\/(\d+)$/, v: vistaRecItem, nav: '', miga: 'Recetas / <b>Receta</b>' },
  { re: /^#\/mp$/, v: vistaMPs, nav: 'mp', miga: 'Recetas / <b>Materias primas de Shares</b>' },
  { re: /^#\/mp\/(\d+)$/, v: vistaMP, nav: 'mp', miga: 'Recetas / <a href="#/mp">Materias primas de Shares</a> / <b>Materia prima</b>' },
  { re: /^#\/comparar$/, v: vistaComparar, nav: 'comparar', miga: 'Recetas / <b>Shares vs compras</b>' },
  { re: /^#\/cambios$/, v: vistaRecCambios, nav: 'cambios', miga: 'Recetas / <b>Cambios de costo</b>' },
  { re: /^#\/simulador$/, v: vistaSimulador, nav: 'simulador', miga: 'Recetas / <b>Simulador</b>' },
  { re: /^#\/admin$/, v: vistaAdmin, nav: 'admin', miga: 'Datos / <b>Configuración</b>' },
  { re: /^#\/guia$/, v: vistaGuia, nav: 'guia', miga: '<b>Guía de uso</b>' },
  { re: /^#\/cuenta$/, v: vistaMiCuenta, nav: '', miga: '<b>Mi cuenta</b>' },
];

function shell(ruta) {
  const a = ruta.nav;
  const it = (k, ic, t, cnt = '') => `<a href="#/${k}" class="${k === a ? 'activo' : ''}" ${k === a ? 'aria-current="page"' : ''}>${ICO[ic]}<span>${t}</span>${cnt}</a>`;
  const rol = { admin: 'Administrador', editor: 'Editor', consulta: 'Consulta' }[S.user.rol] || S.user.rol;
  return `<div class="app">
    <aside class="side">
      <a class="brand" href="#/tablero"><img src="logo-negro.png" alt="Lucciano's"><span>Costos de insumos</span></a>
      <nav class="nav" aria-label="Secciones">
        ${it('tablero', 'chart', 'Tablero')}
        <div class="grp-t">Seguimiento</div>
        ${it('inicio', 'home', 'Novedades de compras')}
        ${it('alertas', 'bell', 'Alertas', '<span class="cnt hot" data-cnt="alertas"></span>')}
        ${it('insumos', 'box', 'Insumos')}
        <div class="grp-t">Recetas (Shares)</div>
        ${it('productos', 'cono', 'Productos terminados')}
        ${it('bases', 'layers', 'Bases')}
        ${it('mp', 'flask', 'Materias primas')}
        ${it('comparar', 'balanza', 'Shares vs compras', '<span class="cnt hot" data-cnt="shares"></span>')}
        ${it('cambios', 'trend', 'Cambios de costo')}
        ${it('simulador', 'calc', 'Simulador')}
        <div class="grp-t">Trabajo</div>
        ${it('vincular', 'link', 'Para vincular', '<span class="cnt" data-cnt="vincular"></span>')}
        ${it('facturas', 'doc', 'Facturas leídas')}
        <div class="grp-t">Datos</div>
        ${puede('admin') ? it('admin', 'gear', 'Configuración') : ''}
        ${it('guia', 'book', 'Guía de uso')}
      </nav>
      <div class="me"><a class="av" href="#/cuenta" title="Mi cuenta">${esc(iniciales(S.user.nombre))}</a>
        <a class="who" href="#/cuenta"><b>${esc(S.user.nombre)}</b><small>${esc(rol)}</small></a>
        <div class="ibtns"><button class="ibtn" id="b-tema" title="Claro / oscuro" aria-label="Cambiar tema">${temaActual() === 'dark' ? ICO.sun : ICO.moon}</button><a class="ibtn" href="${PORTAL}" title="Volver al portal" aria-label="Volver al portal">${svgI('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')}</a></div></div>
    </aside>
    <div style="min-width:0">
      <header class="top"><img class="marca-m" src="logo-negro.png" alt="Lucciano's"><div class="crumbs">${ruta.miga}</div>
        <label class="buscar">${ICO.search}<input id="buscar-global" placeholder="Buscar insumo o proveedor…" aria-label="Buscar"><kbd>Ctrl K</kbd></label>
        <button class="ibtn" id="b-actualizar" title="Actualizar" aria-label="Actualizar">${ICO.refresh}</button></header>
      <main id="vista" class="entra"><div class="vacio"><span class="cargando"></span></div></main>
    </div></div>
    <nav class="mnav" aria-label="Secciones">
      <a href="#/tablero" class="${a === 'tablero' ? 'activo' : ''}">${ICO.chart}Tablero</a>
      <a href="#/alertas" class="${a === 'alertas' ? 'activo' : ''}">${ICO.bell}Alertas<span class="cnt hot" data-cnt="alertas"></span></a>
      <a href="#/insumos" class="${a === 'insumos' ? 'activo' : ''}">${ICO.box}Insumos</a>
      <a href="#/vincular" class="${a === 'vincular' ? 'activo' : ''}">${ICO.link}Vincular<span class="cnt" data-cnt="vincular"></span></a>
      <a href="#/productos" class="${['productos', 'bases', 'mp', 'comparar', 'cambios', 'simulador'].includes(a) ? 'activo' : ''}">${ICO.cono}Recetas</a>
    </nav>`;
}

async function contadores(t = null) {
  try {
    if (!t) {
      if (S.cnt && Date.now() - S.cnt.at < 60000) return pintarContadores(S.cnt);
      t = await api('/api/tablero');
    }
    S.cnt = { at: Date.now(), alertas: t.alertas_sin_ver, vincular: t.vincular_grupos, shares: t.shares?.desactualizados || 0 };
    pintarContadores(S.cnt);
  } catch { /* no es crítico */ }
}
function pintarContadores(c) { $$('[data-cnt]').forEach(x => { const n = c[x.dataset.cnt]; x.textContent = n ? n : ''; }); }

async function router() {
  if (!S.token) return vistaLogin();
  if (!S.user) return;   // todavía arrancando (iniciar() llama al router cuando sabe quién es el usuario)
  if (S.pdfUrl) { URL.revokeObjectURL(S.pdfUrl); S.pdfUrl = null; S.pdfBytes = null; }
  // Cada navegación tiene su número: si mientras carga una pantalla se navega a otra, la vieja no escribe su error
  // encima de la nueva (antes, al cambiar rápido de sección, aparecía "No se pudo cargar" en la pantalla que sí cargó)
  const nav = S.nav = (S.nav || 0) + 1;
  const h = location.hash || '#/tablero';
  const r = RUTAS.find(x => x.re.test(h)) || RUTAS[0];
  const m = h.match(r.re) || [];
  $('#app').innerHTML = shell(r);
  $('#b-tema').onclick = alternarTema;
  $('#b-actualizar').onclick = actualizar;
  const bg = $('#buscar-global');
  bg.onkeydown = (e) => {
    if (e.key !== 'Enter' || !bg.value.trim()) return;
    sessionStorage.setItem('ins_q', bg.value.trim());
    if (location.hash === '#/insumos') router(); else location.hash = '#/insumos';
  };
  window.scrollTo(0, 0);
  if (r.nav !== 'inicio') contadores();
  try { await r.v($('#vista'), ...m.slice(1)); }
  catch (e) { if (nav !== S.nav) return; if (S.token && $('#vista')) { $('#vista').innerHTML = `<div class="panel panel-pad"><h2>No se pudo cargar</h2><p class="muted">${esc(e.message)}</p><button class="btn btn-acento" id="b-reint">${ICO.refresh}Reintentar</button></div>`; $('#b-reint').onclick = router; } }
}

async function iniciar() {
  if (await canjearAcceso() === 'redirigiendo') return;
  if (!S.token) return vistaLogin();
  try { const r = await api('/api/yo'); S.user = r.usuario; } catch { return vistaLogin(); }
  await router();
}
window.addEventListener('hashchange', router);
document.addEventListener('DOMContentLoaded', iniciar);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { const b = $('#buscar-global'); if (b) { e.preventDefault(); b.focus(); b.select(); } }
});


// ---------------------------------------------------------------------------
//  Inicio
// ---------------------------------------------------------------------------
// Anillo pistacho: qué parte de las materias primas vinculadas tiene en Shares un costo parecido a la última compra
function anilloShares(sh) {
  const v = sh.vinculados || 0, mal = sh.desactualizados || 0, ok = Math.max(0, v - mal);
  const pct = v ? Math.round(ok / v * 100) : 0, r = 40, c = 2 * Math.PI * r;
  return `<a class="panel panel-pad anillo-shares" href="#/comparar" style="display:flex;align-items:center;gap:20px;text-decoration:none;color:inherit;background:#A8C686;border:0">
    <svg width="104" height="104" viewBox="0 0 100 100" role="img" aria-label="Costos de Shares al día: ${pct} por ciento">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="#dcebc6" stroke-width="12"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="#1d2f0d" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(pct / 100 * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)" style="transition:stroke-dasharray .8s cubic-bezier(.16,1,.3,1)"/>
      <text x="50" y="56" text-anchor="middle" font-family="Manrope, sans-serif" font-weight="800" font-size="20" fill="#1d2f0d">${pct}%</text>
    </svg>
    <div><div style="font:700 17px Manrope,sans-serif;color:#1d2f0d">Shares al día</div>
      <div style="font-size:14px;color:#2f4a17;margin-top:4px">${ok} de ${v} materias primas tienen en Shares un costo parecido a la última compra${mal ? ` · ${mal} para actualizar` : ''}.</div></div>
  </a>`;
}

async function vistaInicio(el) {
  const t = await api('/api/tablero');
  contadores(t);
  const hora = new Date().getHours();
  const saludo = hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const F = t.facturas || {};
  const leidas = (F.ok || 0) + (F.revisar || 0) + (F.sin_renglones || 0);
  const cola = (F.pendiente || 0) + (F.leyendo || 0);
  const total = leidas + cola + (F.error || 0);
  const filaIns = (i) => `<li data-ins="${i.id}" tabindex="0">${cuad(i.nombre)}<div style="min-width:0"><div class="t">${esc(i.nombre)}</div><div class="d">${esc(i.ult_proveedor || '')} · ${fmtF(i.ult_fecha)}</div></div>
    <div class="r"><b>${fmtP(i.ult_precio, i.unidad)}</b>${chipVar(i.var_ant, { titulo: 'Contra la compra anterior al mismo proveedor' })}</div></li>`;
  el.innerHTML = `<div class="encabezado"><div><h1>${saludo}, ${esc(String(S.user.nombre).split(' ')[0])}</h1><p>Precios de las materias primas, leídos de las facturas de proveedores.</p></div>
      ${puede('editor') ? `<div class="acciones"><button class="btn" id="b-sync">${ICO.refresh}Sincronizar ahora</button></div>` : ''}</div>
    ${cola ? `<div class="panel panel-pad progreso-lectura"><div class="pl-t"><b>${ICO.sparkle}Leyendo el historial de facturas</b><span class="muted small">${leidas} de ${total} leídas · ${cola} en cola · se leen solas, más rápido cuando Google no está cargado</span></div>
      <div class="pl-barra"><span style="width:${total ? Math.round(leidas / total * 100) : 0}%"></span></div></div>` : ''}
    <div class="kpis">
      <a class="kpi ${t.alertas_sin_ver ? 'alerta' : ''}" href="#/alertas"><div class="et">Alertas sin ver</div><div class="val">${t.alertas_sin_ver}</div><div class="sub">${t.alertas_por_tipo?.suba ? `${t.alertas_por_tipo.suba} suba(s)` : 'Sin subas nuevas'}${t.alertas_por_tipo?.mas_caro ? ` · ${t.alertas_por_tipo.mas_caro} más caro(s)` : ''}</div></a>
      <a class="kpi ${t.vincular_grupos ? 'aviso' : ''}" href="#/vincular"><div class="et">Para vincular</div><div class="val">${t.vincular_grupos}</div><div class="sub">${t.vincular_renglones} renglón(es) sin insumo</div></a>
      <a class="kpi" href="#/insumos"><div class="et">Insumos seguidos</div><div class="val">${t.insumos}</div><div class="sub">${t.insumos_con_precio || 0} con precio</div></a>
      <a class="kpi" href="#/facturas"><div class="et">Facturas leídas</div><div class="val">${leidas}</div><div class="sub">${F.revisar ? `${F.revisar} no cierran · ` : ''}${cola ? `${cola} en cola` : 'al día'}</div></a>
    </div>
    ${t.shares?.vinculados ? anilloShares(t.shares) : ''}
    ${t.shares?.desactualizados ? `<div class="panel"><div class="panel-titulo"><h2>${ICO.balanza} Shares desactualizado</h2><a class="btn btn-ghost btn-chico" href="#/comparar">Ver todos</a></div>
      <p class="small muted" style="margin:0;padding:0 18px 6px">${t.shares.desactualizados} materia${t.shares.desactualizados > 1 ? 's primas' : ' prima'} con la última compra ${t.shares.umbral} % o más lejos del costo que usa Shares. Los productos que las usan están mal costeados.</p>
      <ul class="feed">${t.shares.top.map(x => `<li data-href="#/mp/${x.codigo_shares}" tabindex="0">${cuad(x.nombre)}<div style="min-width:0"><div class="t">${esc(x.nombre)}</div><div class="d">Shares ${$$m(x.costo_shares)} · compra ${$$m(x.precio_real)} (${esc(x.ult_proveedor || '')}, ${fmtF(x.ult_fecha)})</div></div>
        <div class="r">${chipVar(x.dif_pct, { titulo: 'Última compra contra el costo de Shares' })}</div></li>`).join('')}</ul></div>` : ''}
    <div class="dos">
      <div class="panel"><div class="panel-titulo"><h2>Alertas nuevas</h2><a class="btn btn-ghost btn-chico" href="#/alertas">Ver todas</a></div>
        ${t.ultimas_alertas.length ? `<ul class="feed">${t.ultimas_alertas.map(a => `<li data-ins="${a.insumo_id}" tabindex="0">${cuad(a.insumo)}<div style="min-width:0"><div class="t">${esc(a.insumo)}</div><div class="d">${esc(textoAlerta(a))}</div></div>
          <div class="r">${chipVar(a.variacion_pct)}<small class="muted">${fmtF(a.fecha)}</small></div></li>`).join('')}</ul>`
        : `<div class="vacio"><span class="grande">Sin alertas nuevas</span>Cuando un proveedor suba un precio por encima del umbral, aparece acá.</div>`}</div>
      <div class="panel"><div class="panel-titulo"><h2>Mayores subas · 60 días</h2><a class="btn btn-ghost btn-chico" href="#/insumos">Ver insumos</a></div>
        ${t.subas.length ? `<ul class="feed">${t.subas.map(filaIns).join('')}</ul>` : '<div class="vacio">Todavía no hay subas para mostrar.</div>'}
        ${t.bajas.length ? `<div class="panel-titulo sub-tit"><h3>Bajaron</h3></div><ul class="feed">${t.bajas.map(filaIns).join('')}</ul>` : ''}</div>
    </div>
    <p class="small muted" style="margin-top:14px">Última sincronización con la app de facturas: ${t.ultima_sync ? fmtFH(t.ultima_sync + 'Z') : 'todavía no'} · Se actualiza sola cada 10 minutos.</p>`;
  $$('[data-ins]', el).forEach(li => { li.onclick = () => { location.hash = '#/insumo/' + li.dataset.ins; }; li.onkeydown = (e) => { if (e.key === 'Enter') li.click(); }; });
  $$('li[data-href]', el).forEach(li => { li.onclick = () => { location.hash = li.dataset.href; }; li.onkeydown = (e) => { if (e.key === 'Enter') li.click(); }; });
  const bs = $('#b-sync'); if (bs) bs.onclick = () => conBoton(bs, sincronizarAhora);
}
async function sincronizarAhora() {
  const r = await api('/api/sincronizar', { method: 'POST' });
  toast(r.mensaje || 'Sincronizado');
  S.cnt = null;
  setTimeout(router, 400);
}

// ---------------------------------------------------------------------------
//  Alertas
// ---------------------------------------------------------------------------
async function vistaAlertas(el) {
  let ver = sessionStorage.getItem('al_ver') || 'sin_ver', tipo = sessionStorage.getItem('al_tipo') || '';
  el.innerHTML = `<div class="encabezado"><div><h1>Alertas</h1><p>Subas de precio, compras por encima del promedio y proveedores más caros que otro por el mismo insumo.</p></div>
      <div class="acciones"><button class="btn" id="b-todas">${ICO.check}Marcar todas como vistas</button></div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q-al" placeholder="Insumo, rubro o proveedor"></label>
      <div class="seg" id="seg-ver" style="margin:0">${[['sin_ver', 'Sin ver'], ['todas', 'Todas']].map(([k, t]) => `<button data-v="${k}" class="${k === ver ? 'on' : ''}">${t}</button>`).join('')}</div>
      <select id="f-tipo" style="max-width:240px"><option value="">Todos los tipos</option>${Object.entries(TIPO_ALERTA).map(([k, v]) => `<option value="${k}" ${tipo === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      <div class="tabla-wrap"><table><thead><tr><th>Insumo</th><th>Qué pasó</th><th>Fecha</th><th class="num">Pagado</th><th class="num">Referencia</th><th class="num">Variación</th><th></th></tr></thead><tbody id="tb"><tr><td colspan="7" class="vacio"><span class="cargando"></span></td></tr></tbody></table></div></div>`;
  const cargar = async () => {
    const p = new URLSearchParams({ ver }); if (tipo) p.set('tipo', tipo);
    const r = await api('/api/alertas?' + p);
    const qa = normQ($('#q-al').value).trim();
    if (qa) r.alertas = r.alertas.filter(a => normQ(`${a.insumo} ${a.rubro || ''} ${textoAlerta(a)} ${a.ref_detalle || ''} ${a.proveedor || ''}`).includes(qa));
    $('#tb').innerHTML = r.alertas.length ? r.alertas.map(a => `<tr class="click ${a.vista ? 'vista' : ''}" data-ins="${a.insumo_id}">
        <td><div class="prov">${cuad(a.insumo)}<div><b>${esc(a.insumo)}</b><small>${esc(a.rubro || '')}</small></div></div></td>
        <td>${badgeAlerta(a.tipo)}<small class="sub-celda">${esc(textoAlerta(a))}</small></td>
        <td class="mono">${fmtF(a.fecha)}</td>
        <td class="num"><b>${fmtP(a.precio, a.unidad)}</b></td>
        <td class="num">${fmtP(a.precio_ref, a.unidad)}<small class="sub-celda">${esc(String(a.ref_detalle || '').replace(/\s*\((\d{4})-(\d{2})-(\d{2})\)$/, ' ($3/$2)').replace(/del (\d{4})-(\d{2})-(\d{2})/, 'del $3/$2'))}</small></td>
        <td class="num">${chipVar(a.variacion_pct)}</td>
        <td>${a.vista ? `<small class="muted">Vista</small>` : `<button class="btn btn-chico" data-vista="${a.id}" title="Marcar como vista">${ICO.check}Vista</button>`}</td></tr>`).join('')
      : `<tr><td colspan="7" class="vacio">${qa ? 'Ninguna alerta coincide con la búsqueda.' : ver === 'sin_ver' ? '<span class="grande">Nada nuevo</span>No hay alertas sin ver.' : 'No hay alertas.'}</td></tr>`;
    $$('#tb tr[data-ins]').forEach(tr => tr.onclick = (e) => { if (e.target.closest('button')) return; location.hash = '#/insumo/' + tr.dataset.ins; });
    $$('[data-vista]').forEach(b => b.onclick = () => conBoton(b, async () => { await api('/api/alertas/vistas', { method: 'POST', body: { ids: [Number(b.dataset.vista)] } }); S.cnt = null; contadores(); cargar(); }));
  };
  $$('#seg-ver button').forEach(b => b.onclick = () => { ver = b.dataset.v; sessionStorage.setItem('al_ver', ver); $$('#seg-ver button').forEach(x => x.classList.toggle('on', x === b)); cargar(); });
  let tq; $('#q-al').oninput = () => { clearTimeout(tq); tq = setTimeout(cargar, 250); };
  $('#f-tipo').onchange = () => { tipo = $('#f-tipo').value; sessionStorage.setItem('al_tipo', tipo); cargar(); };
  $('#b-todas').onclick = async () => { if (!await confirmar('¿Marcar todas las alertas como vistas?')) return; await conBoton($('#b-todas'), async () => { await api('/api/alertas/vistas', { method: 'POST', body: { todas: true } }); S.cnt = null; contadores(); cargar(); }); };
  await cargar();
}

// ---------------------------------------------------------------------------
//  Insumos
// ---------------------------------------------------------------------------
function sparkline(serie) {
  const pts = (serie || []).filter(p => p && p[1] > 0);
  if (pts.length < 2) return '<span class="muted small">—</span>';
  const W = 96, H = 28, pad = 3;
  const ys = pts.map(p => p[1]), mn = Math.min(...ys), mx = Math.max(...ys);
  const x = (i) => pad + i * (W - pad * 2) / (pts.length - 1);
  const y = (v) => mx === mn ? H / 2 : H - pad - (v - mn) / (mx - mn) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const ul = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/><circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(ul[1]).toFixed(1)}" r="2.6"/></svg>`;
}

async function vistaInsumos(el) {
  const q0 = sessionStorage.getItem('ins_q') || ''; sessionStorage.removeItem('ins_q');
  let rubro = sessionStorage.getItem('ins_rubro') || '', ver = sessionStorage.getItem('ins_ver') || '';
  const hace60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const pasa = (i) => !ver || (ver === 'sube' ? i.var_ant > 0.05 : ver === 'baja' ? i.var_ant < -0.05 : ver === 'alertas' ? i.alertas > 0 : ver === 'multi' ? i.proveedores > 1 : !i.ult_fecha || i.ult_fecha < hace60);
  const r = await api('/api/insumos');
  const rubros = [...new Set(r.insumos.map(i => i.rubro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  el.innerHTML = `<div class="encabezado"><div><h1>Insumos</h1><p>Último precio pagado por ${'kg, litro o unidad'} (neto, sin IVA) y cómo viene variando.</p></div>
      <div class="acciones"><button class="btn" id="b-csv">${ICO.doc}Exportar CSV</button>${puede('editor') ? `<button class="btn btn-negro" id="b-nuevo">${ICO.box}Nuevo insumo</button>` : ''}</div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Insumo o proveedor" value="${esc(q0)}"></label>
      <select id="f-rubro" style="max-width:220px"><option value="">Todos los rubros</option>${rubros.map(x => `<option ${x === rubro ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="f-ver">${[['', 'Todos los insumos'], ['sube', 'Subieron en la última compra'], ['baja', 'Bajaron en la última compra'], ['alertas', 'Con alertas sin ver'], ['multi', 'Comprados a más de un proveedor'], ['viejo', 'Sin compras hace más de 60 días']].map(([k, t]) => `<option value="${k}" ${k === ver ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="tabla-wrap"><table class="tabla-ins"><thead><tr><th>Insumo</th><th class="num">Último precio</th><th class="num">vs. anterior</th><th class="num">vs. promedio</th><th>Tendencia</th><th>Última compra</th><th class="num">Compras</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const pintar = () => {
    const q = normQ($('#q').value);
    const lista = r.insumos.filter(i => (!rubro || i.rubro === rubro) && pasa(i) && (!q || normQ(i.nombre + ' ' + (i.rubro || '') + ' ' + (i.ult_proveedor || '')).includes(q)));
    $('#tb').innerHTML = lista.length ? lista.map(i => `<tr class="click ${i.activo ? '' : 'inactivo'}" data-id="${i.id}">
        <td><div class="prov">${cuad(i.nombre)}<div><b>${esc(i.nombre)}</b><small>${i.alertas ? `<span class="txt-neg">${i.alertas} alerta${i.alertas > 1 ? 's' : ''}</span> · ` : ''}${esc(i.rubro || 'Sin rubro')} · por ${esc(UNI[i.unidad])}${i.activo ? '' : ' · inactivo'}</small></div></div></td>
        <td class="num" data-orden="${i.ult_precio ?? ''}"><b>${fmtP(i.ult_precio, i.unidad)}</b></td>
        <td class="num" data-orden="${i.var_ant ?? ''}">${chipVar(i.var_ant, { titulo: 'Contra la compra anterior al mismo proveedor' })}</td>
        <td class="num" data-orden="${i.var_prom ?? ''}">${chipVar(i.var_prom, { titulo: 'Contra el promedio ponderado del período' })}</td>
        <td title="Compras a ${esc(i.ult_proveedor || '')}">${sparkline(serieProv(i))}</td>
        <td data-orden="${(i.ult_fecha || '').replace(/-/g, '')}"><span class="mono">${fmtF(i.ult_fecha)}</span><small class="sub-celda">${esc(i.ult_proveedor || '')}</small></td>
        <td class="num">${i.compras || 0}${i.proveedores > 1 ? `<small class="sub-celda">${i.proveedores} proveedores</small>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="7" class="vacio">${r.insumos.length ? 'Ningún insumo coincide con el filtro.' : '<span class="grande">Todavía no hay insumos</span>Se crean al vincular los renglones de las facturas (en “Para vincular”) o con “Nuevo insumo”.'}</td></tr>`;
    $$('#tb tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/insumo/' + tr.dataset.id; });
  };
  $('#q').oninput = pintar;
  $('#f-rubro').onchange = () => { rubro = $('#f-rubro').value; sessionStorage.setItem('ins_rubro', rubro); pintar(); };
  $('#f-ver').onchange = () => { ver = $('#f-ver').value; sessionStorage.setItem('ins_ver', ver); pintar(); };
  $('#b-csv').onclick = () => descargarCsv(`insumos_${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Insumo', 'Rubro', 'Unidad', 'Último precio', 'Fecha', 'Proveedor', 'Precio anterior (mismo proveedor)', 'Var. vs anterior %', 'Promedio', 'Var. vs promedio %', 'Compras'],
    ...r.insumos.map(i => [i.nombre, i.rubro || '', i.unidad, dec(i.ult_precio), i.ult_fecha || '', i.ult_proveedor || '', dec(i.ant_precio), dec(i.var_ant), dec(i.prom_precio), dec(i.var_prom), i.compras || 0]),
  ]);
  const bn = $('#b-nuevo'); if (bn) bn.onclick = () => modalInsumo(null, (id) => { location.hash = '#/insumo/' + id; });
  pintar();
}
// Tendencia del proveedor de la última compra (mezclar proveedores da un serrucho que no dice nada)
const serieProv = (i) => { const s = safeJ(i.serie_json) || []; const p = s.filter(x => x[2] === i.ult_cuit); return p.length >= 2 ? p : s; };
const normQ = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const safeJ = (s) => { try { return JSON.parse(s); } catch { return null; } };
const dec = (n) => n === null || n === undefined || n === '' ? '' : String(Math.round(Number(n) * 100) / 100).replace('.', ',');

// ---- Buscador de insumos: reemplaza a un <select> (que queda oculto y sigue funcionando igual por detrás) ----
// Se escribe para filtrar; flechas + Enter para elegir; Esc para cerrar.
function comboSelect(sel, { placeholder = 'Escribí para buscar…' } = {}) {
  if (!sel || sel.dataset.combo) return;
  sel.dataset.combo = '1';
  sel.classList.add('hidden');
  const ops = [...sel.options].filter(o => o.value).map(o => ({ value: o.value, text: o.dataset.nombre || o.textContent, extra: o.dataset.extra || '' }));
  const wrap = document.createElement('div'); wrap.className = 'combo';
  wrap.innerHTML = `<input type="text" class="combo-in" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"><ul class="combo-lista" hidden role="listbox"></ul>`;
  sel.after(wrap);
  const inp = $('.combo-in', wrap), ul = $('.combo-lista', wrap);
  const actual = () => ops.find(o => o.value === sel.value);
  inp.value = actual()?.text || '';
  let vis = [], act = 0;
  const pintar = () => {
    const q = normQ(inp.value === actual()?.text ? '' : inp.value).split(/\s+/).filter(Boolean);
    vis = ops.filter(o => q.every(w => normQ(o.text + ' ' + o.extra).includes(w))).slice(0, 60);
    act = Math.max(0, Math.min(act, vis.length - 1));
    ul.innerHTML = vis.length ? vis.map((o, i) => `<li role="option" data-i="${i}" class="${i === act ? 'on' : ''} ${o.value === sel.value ? 'sel' : ''}"><span>${esc(o.text)}</span>${o.extra ? `<small>${esc(o.extra)}</small>` : ''}</li>`).join('')
      : '<li class="vacio-combo">Ningún insumo coincide. Si no existe, usá “Insumo nuevo”.</li>';
    ul.hidden = false;
    const on = $('li.on', ul); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const elegir = (o) => { if (!o) return; sel.value = o.value; inp.value = o.text; ul.hidden = true; sel.dispatchEvent(new Event('change')); };
  inp.addEventListener('focus', () => { inp.select(); act = 0; pintar(); });
  inp.addEventListener('input', () => { act = 0; pintar(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(act + 1, vis.length - 1); pintar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(act - 1, 0); pintar(); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(vis[act]); }
    else if (e.key === 'Escape') { e.stopPropagation(); ul.hidden = true; inp.value = actual()?.text || ''; }
  });
  ul.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); elegir(vis[Number(li.dataset.i)]); } });
  inp.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; if (inp.value !== (actual()?.text || '')) inp.value = actual()?.text || ''; }, 120));
}

// Alta / edición de un insumo
function modalInsumo(ins, alGuardar) {
  const rubros = [...new Set([...RUBROS_BASE, ...(S.rubros || [])])];
  modal(`<h2>${ins ? 'Editar insumo' : 'Nuevo insumo'}</h2><form id="f-ins">
    <div class="campo"><label>Nombre</label><input name="nombre" required value="${esc(ins?.nombre || '')}" placeholder="Ej: Crema de leche 35%"><div class="ayuda">Genérico, sin marca ni presentación: el mismo insumo puede venir de varios proveedores.</div></div>
    <div class="campo"><label>Rubro</label><input name="rubro" list="dl-rubros" value="${esc(ins?.rubro || '')}" placeholder="Lácteos, Frutas, Envases…"><datalist id="dl-rubros">${rubros.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <div class="campo"><label>Se mide por</label><div class="seg" id="seg-u">${Object.entries(UNI).map(([k, v]) => `<button type="button" data-u="${k}" class="${(ins?.unidad || 'kg') === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${ins ? '<div class="ayuda">Si cambiás la unidad, revisá cuánto trae cada descripción vinculada.</div>' : ''}</div>
    <div class="campo"><label>Umbral propio de suba (%)</label><input name="umbral_pct" type="number" min="0" step="0.5" value="${esc(ins?.umbral_pct ?? '')}" placeholder="Vacío = el general de Configuración"></div>
    ${ins ? `<div class="campo"><label>Nota</label><textarea name="nota">${esc(ins.nota || '')}</textarea></div>
      <label class="check" style="margin-bottom:14px"><input type="checkbox" name="activo" ${ins.activo ? 'checked' : ''}> Activo (los inactivos no generan alertas)</label>` : ''}
    <div class="acciones"><button class="btn btn-negro" type="submit">${ins ? 'Guardar' : 'Crear insumo'}</button></div></form>`, {
    alMontar: (m, cerrar) => {
      let u = ins?.unidad || 'kg';
      $$('#seg-u button', m).forEach(b => b.onclick = () => { u = b.dataset.u; $$('#seg-u button', m).forEach(x => x.classList.toggle('on', x === b)); });
      $('#f-ins', m).onsubmit = (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const body = { nombre: fd.nombre, rubro: fd.rubro, unidad: u, umbral_pct: fd.umbral_pct === '' ? null : Number(fd.umbral_pct) };
        if (ins) { body.nota = fd.nota; body.activo = !!fd.activo; }
        conBoton($('button[type=submit]', e.target), async () => {
          const r = await api(ins ? '/api/insumos/' + ins.id : '/api/insumos', { method: ins ? 'PUT' : 'POST', body });
          cerrar(); toast(ins ? 'Guardado' : 'Insumo creado'); alGuardar && alGuardar(ins ? ins.id : r.id);
        });
      };
    },
  });
}

// ---------------------------------------------------------------------------
//  Detalle de un insumo
// ---------------------------------------------------------------------------
async function vistaInsumo(el, id) {
  const d = await api('/api/insumos/' + id);
  const i = d.insumo, u = i.unidad;
  const cfg = S.cfg || (S.cfg = (await api('/api/config').catch(() => ({ config: {} }))).config);
  const dias = cfg.dias_promedio || 90;
  // Proveedores: último precio de cada uno
  const porProv = new Map();
  for (const c of [...d.compras].reverse()) {
    const p = porProv.get(c.cuit) || { cuit: c.cuit, proveedor: c.proveedor, ultimo: c, compras: 0, cantidad: 0 };
    p.compras++; p.cantidad += Number(c.cantidad) || 0; porProv.set(c.cuit, p);
  }
  const provs = [...porProv.values()].sort((a, b) => b.cantidad - a.cantidad);
  const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const vigentes = provs.filter(p => p.ultimo.fecha >= desde);
  const minVig = vigentes.length ? Math.min(...vigentes.map(p => p.ultimo.precio)) : null;
  el.innerHTML = `<div class="encabezado"><div><h1>${esc(i.nombre)}</h1><p>${esc(i.rubro || 'Sin rubro')} · precio por ${esc(UNI[u])}, neto sin IVA · ${i.compras || 0} compra(s)${i.activo ? '' : ' · <b>inactivo</b>'}</p></div>
      ${puede('editor') ? `<div class="acciones"><button class="btn" id="b-unir">${ICO.merge}Unir con otro</button><button class="btn btn-negro" id="b-edit">${ICO.pencil}Editar</button></div>` : ''}</div>
    <div class="kpis">
      <div class="kpi"><div class="et">Último precio</div><div class="val">${fmtP(i.ult_precio, u)}</div><div class="sub">${fmtF(i.ult_fecha)} · ${esc(i.ult_proveedor || '—')}</div></div>
      <div class="kpi"><div class="et">vs. compra anterior</div><div class="val">${chipVar(i.var_ant)}</div><div class="sub">${i.ant_precio ? `${fmtP(i.ant_precio, u)} el ${fmtF(i.ant_fecha)} (mismo proveedor)` : 'Sin compra anterior del mismo proveedor'}</div></div>
      <div class="kpi"><div class="et">vs. promedio ${dias} días</div><div class="val">${chipVar(i.var_prom)}</div><div class="sub">${i.prom_precio ? `Promedio ponderado ${fmtP(i.prom_precio, u)}` : 'Sin compras para promediar'}</div></div>
      <div class="kpi"><div class="et">Comprado · ${dias} días</div><div class="val">${i.cantidad_periodo ? fmtCant.format(i.cantidad_periodo) + ' ' + esc(UNI_C[u]) : '—'}</div><div class="sub">${i.proveedores || 0} proveedor(es) en el período</div></div>
    </div>
    <div id="sh-panel"></div>
    <div class="panel"><div class="panel-titulo"><h2>Precio por ${esc(UNI[u])} en el tiempo</h2><div class="leyenda" id="leyenda"></div></div>
      <div class="grafico" id="graf"></div></div>
    <div class="dos">
      <div class="panel"><div class="panel-titulo"><h2>Proveedores</h2></div>
        ${provs.length ? `<div class="tabla-wrap"><table><thead><tr><th>Proveedor</th><th class="num">Último precio</th><th>Fecha</th><th class="num">vs. más barato</th><th class="num">Compras</th></tr></thead><tbody>
        ${provs.map(p => `<tr><td><div class="prov">${cuad(p.proveedor)}<div><b>${esc(p.proveedor || fmtCuit(p.cuit))}</b><small class="mono">${fmtCuit(p.cuit)}</small></div></div></td>
          <td class="num"><b>${fmtP(p.ultimo.precio, u)}</b></td><td class="mono">${fmtF(p.ultimo.fecha)}${p.ultimo.fecha < desde ? '<small class="sub-celda">fuera del período</small>' : ''}</td>
          <td class="num">${minVig && p.ultimo.fecha >= desde ? (p.ultimo.precio <= minVig + 0.0001 ? '<span class="var baja">El más barato</span>' : chipVar((p.ultimo.precio / minVig - 1) * 100)) : '—'}</td>
          <td class="num">${p.compras}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vacio">Sin compras todavía.</div>'}</div>
      <div class="panel"><div class="panel-titulo"><h2>Alertas</h2></div>
        ${d.alertas.length ? `<ul class="feed">${d.alertas.slice(0, 12).map(a => `<li>${icoAlerta(a.tipo)}<div style="min-width:0"><div class="t t-multi">${esc(textoAlerta(a))}</div><div class="d">${esc((TIPO_ALERTA[a.tipo] || [a.tipo])[0])} · ${fmtF(a.fecha)} · ${fmtP(a.precio, u)} vs ${fmtP(a.precio_ref, u)}</div></div><div class="r">${chipVar(a.variacion_pct)}</div></li>`).join('')}</ul>`
        : '<div class="vacio">Sin alertas para este insumo.</div>'}</div>
    </div>
    <div class="panel"><div class="panel-titulo"><h2>Compras</h2><button class="btn btn-ghost btn-chico" id="b-csv">${ICO.doc}Exportar CSV</button></div>
      <div class="tabla-wrap tabla-scroll" style="max-height:70vh"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Descripción en la factura</th><th class="num">Cantidad</th><th>Equivale</th><th class="num">Precio facturado</th><th class="num">Por ${esc(UNI[u])}</th><th></th></tr></thead><tbody>
      ${d.renglones.length ? d.renglones.map(r => `<tr class="${r.ignorado ? 'inactivo' : ''}">
        <td class="mono">${fmtF(r.fecha)}</td><td>${esc(r.proveedor || '')}<small class="sub-celda"><a href="#" data-fac="${r.factura_id}">${esc(TIPOS[r.tipo] || '')} ${nroCbte(r)}</a></small></td>
        <td class="desc-fac">${esc(r.descripcion)}</td>
        <td class="num">${r.cantidad != null ? fmtCant.format(r.cantidad) : '—'} <small class="muted">${esc(unidadFact(r.unidad))}</small>${r.lectura_nota ? `<small class="sub-celda muted" title="Lo que la app corrigió al leer este renglón">${esc(r.lectura_nota)}</small>` : ''}</td>
        <td class="small">${esc(textoEquivale(r.unidad, r.factor, u, r.descripcion))}${(() => { const av = !r.ignorado && r.factor ? chequeoFactor({ unidad: r.unidad, unidad_base: r.unidad_base, contenido: r.contenido, descripcion: r.descripcion }, u, Number(r.factor)) : null;
          return av ? `<small class="sub-celda txt-neg con-ico-chico">${ICO.alert}${esc(av)}</small>` : ''; })()}</td>
        <td class="num">${$$mon(r.precio_unitario, r.moneda)}${r.bonif_pct ? `<small class="sub-celda">bonif. ${dec(r.bonif_pct)} %</small>` : ''}${r.desc_pct ? `<small class="sub-celda txt-pos">desc. general ${dec(r.desc_pct)} %</small>` : ''}</td>
        <td class="num"><b>${r.ignorado ? '<span class="muted">No cuenta</span>' : r.alerta_lectura ? `<span class="txt-neg con-ico-chico">${ICO.alert}No cuenta</span>` : r.precio_base == null ? `<span class="txt-neg con-ico-chico">${ICO.alert}No cuenta</span>` : fmtP(r.precio_base, u)}</b>${r.alerta_lectura ? `<small class="sub-celda txt-neg">${esc(r.alerta_lectura)}</small>` : r.precio_base == null && !r.ignorado ? '<small class="sub-celda txt-neg">La IA no leyó la cantidad: corregila en la factura</small>' : ''}</td>
        <td>${puede('editor') ? `<button class="btn btn-chico" data-ren="${r.id}" title="Corregir">${ICO.pencil}</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="8" class="vacio">Sin compras.</td></tr>'}</tbody></table></div></div>
    ${d.vinculos.length ? `<div class="panel"><div class="panel-titulo"><h2>Descripciones vinculadas</h2></div><div class="tabla-wrap"><table><thead><tr><th>Proveedor</th><th>Descripción</th><th>Equivale</th><th class="num">Compras</th></tr></thead><tbody>
      ${d.vinculos.map(v => `<tr><td>${esc(v.proveedor || fmtCuit(v.cuit))}</td><td class="desc-fac">${esc(v.descripcion || v.clave)}</td><td class="small">${v.factor ? esc(textoEquivale(d.renglones.find(r => r.cuit === v.cuit)?.unidad, v.factor, u, v.descripcion)) : '—'}</td><td class="num">${v.usos}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;

  graficoPrecios($('#graf'), $('#leyenda'), d.compras, u);
  $$('[data-fac]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); irFactura(a.dataset.fac); });
  $('#b-csv').onclick = () => descargarCsv(`${normQ(i.nombre).replace(/[^a-z0-9]+/g, '_')}_compras.csv`, [
    ['Fecha', 'Proveedor', 'Factura', 'Descripción', 'Cantidad', 'Unidad', 'Trae', 'Precio unitario', 'Moneda', 'Importe ARS', `Precio por ${UNI_C[u]}`],
    ...d.renglones.map(r => [r.fecha || '', r.proveedor || '', `${TIPOS[r.tipo] || ''} ${nroCbte(r)}`, r.descripcion, dec(r.cantidad), r.unidad || '', dec(r.factor), dec(r.precio_unitario), r.moneda || 'PES', dec(r.importe_ars), r.ignorado ? '' : dec(r.precio_base)]),
  ]);
  const be = $('#b-edit'); if (be) be.onclick = () => modalInsumo(i, () => router());
  const bu = $('#b-unir'); if (bu) bu.onclick = () => modalUnir(i);
  $$('[data-ren]', el).forEach(b => b.onclick = () => modalRenglon(d.renglones.find(r => String(r.id) === b.dataset.ren), i));
  panelSharesInsumo($('#sh-panel'), i);
}

function modalUnir(i) {
  api('/api/insumos').then(r => {
    const otros = r.insumos.filter(x => x.id !== i.id && x.unidad === i.unidad);
    if (!otros.length) { toast(`No hay otro insumo medido en ${UNI[i.unidad]} para unir.`, true); return; }
    modal(`<h2>Unir con otro insumo</h2><p class="muted">Usalo si creaste el mismo insumo dos veces. Las compras, descripciones y alertas de <b>${esc(i.nombre)}</b> pasan al insumo que elijas y este se borra.</p>
      <div class="campo"><label>Unir con</label><select id="u-dest">${otros.map(x => `<option value="${x.id}" data-nombre="${esc(x.nombre)}" data-extra="${esc(UNI_C[x.unidad])}${x.rubro ? ' · ' + esc(x.rubro) : ''}">${esc(x.nombre)}</option>`).join('')}</select></div>
      <div class="acciones"><button class="btn btn-rojo" id="u-ok">${ICO.merge}Unir</button></div>`, {
      alMontar: (m, cerrar) => { comboSelect($('#u-dest', m)); $('#u-ok', m).onclick = () => conBoton($('#u-ok', m), async () => { const x = await api(`/api/insumos/${i.id}/unir`, { method: 'POST', body: { destino_id: Number($('#u-dest', m).value) } }); cerrar(); toast('Unidos'); location.hash = '#/insumo/' + x.id; }); },
    });
  }).catch(e => toast(e.message, true));
}

// Corregir un renglón: cuánto trae, otro insumo o "no cuenta"
async function modalRenglon(r, ins) {
  const lista = (await api('/api/insumos')).insumos.filter(x => x.activo);
  modal(`<h2>Corregir compra</h2><p class="muted">${esc(r.proveedor || '')} · ${fmtF(r.fecha)}<br><span class="desc-fac">${esc(r.descripcion)}</span> · ${fmtCant.format(r.cantidad || 0)} ${esc(r.unidad || '')} a ${$$m(r.precio_unitario)}</p>
    <div class="campo"><label>Insumo</label><select id="r-ins">${lista.map(x => `<option value="${x.id}" data-u="${x.unidad}" data-nombre="${esc(x.nombre)}" data-extra="${esc(UNI_C[x.unidad])}${x.rubro ? ' · ' + esc(x.rubro) : ''}" ${x.id === ins.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>
    <div class="campo"><label>¿Cuánto trae cada ${esc(unidadFact(r.unidad))}?</label><div class="fila-eq"><span class="muted">1 ${esc(unidadFact(r.unidad))} =</span><input id="r-fac" type="number" min="0" step="any" value="${esc(r.factor ?? '')}" style="max-width:160px"><span class="muted" id="r-u">${esc(UNI_C[ins.unidad])}</span></div>
      <div class="ayuda" id="r-prev"></div></div>
    <label class="check"><input type="checkbox" id="r-todos" checked> Aplicar a todas las compras con esta descripción de este proveedor</label>
    <div class="acciones" style="margin-top:16px"><button class="btn btn-negro" id="r-ok">Guardar</button><button class="btn" id="r-ign">${r.ignorado ? 'Volver a contar' : 'No cuenta (no es este insumo)'}</button></div>`, {
    alMontar: (m, cerrar) => {
      const prev = () => {
        const sel = $('#r-ins', m).selectedOptions[0], f = Number($('#r-fac', m).value);
        $('#r-u', m).textContent = UNI_C[sel.dataset.u];
        const unit = r.cantidad ? r.importe_ars / r.cantidad : null;
        $('#r-prev', m).innerHTML = f > 0 && unit ? `Precio comparable: <b>${$$m(unit / f)}</b> por ${esc(UNI[sel.dataset.u])}.` : '';
      };
      comboSelect($('#r-ins', m));
      $('#r-ins', m).onchange = prev; $('#r-fac', m).oninput = prev; prev();
      const enviar = (body) => conBoton($('#r-ok', m), async () => { await api('/api/renglones/' + r.id, { method: 'PUT', body: { ...body, todos: $('#r-todos', m).checked } }); cerrar(); toast('Guardado'); router(); });
      $('#r-ok', m).onclick = () => enviar({ insumo_id: Number($('#r-ins', m).value), factor: Number($('#r-fac', m).value), ignorado: false });
      $('#r-ign', m).onclick = () => enviar(r.ignorado ? { insumo_id: Number($('#r-ins', m).value), factor: Number($('#r-fac', m).value), ignorado: false } : { ignorado: true });
    },
  });
}

// ---------------------------------------------------------------------------
//  Para vincular
// ---------------------------------------------------------------------------
async function vistaVincular(el) {
  const r = await api('/api/vincular');
  S.rubros = [...new Set((await api('/api/insumos').catch(() => ({ insumos: [] }))).insumos.map(x => x.rubro).filter(Boolean))];
  const insPorId = new Map(r.insumos.map(i => [i.id, i]));
  let prov = '';
  const ed = puede('editor');
  const sel = new Set();   // índices de r.grupos marcados para "no son insumos"
  const provs = [...new Set(r.grupos.map(g => g.proveedor))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  el.innerHTML = `<div class="encabezado"><div><h1>Para vincular</h1><p>Descripciones nuevas de las facturas. Decí una vez qué insumo es cada una y cuánto trae: después se reconocen solas.</p></div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Descripción o proveedor"></label>
      <select id="f-prov" style="max-width:260px"><option value="">Todos los proveedores</option>${provs.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
      ${ed ? `<div class="barra-sel" id="barra-sel" hidden><span id="sel-n"></span><button class="btn btn-chico" id="sel-limpiar">Desmarcar</button><button class="btn btn-rojo btn-chico" id="sel-ign">${ICO.x}No son insumos</button></div>` : ''}
      <div class="tabla-wrap"><table class="sin-orden tabla-vinc${ed ? ' con-sel' : ''}" id="t-vinc"><thead><tr><th>Producto en la factura</th><th class="num">Precio facturado</th><th>Es el insumo…</th><th class="num">Precio comparable</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const sugerencia = (g) => {
    const ins = g.sugerido_insumo_id ? insPorId.get(g.sugerido_insumo_id) : null;
    const nombre = ins ? ins.nombre : g.nombre_sugerido;
    if (!nombre) return null;
    const u = ins ? ins.unidad : (g.unidad_base || 'kg');
    return { ins, nombre, u, factor: factorSugerido(g, u), nuevo: !ins };
  };
  const pintar = () => {
    const q = normQ($('#q').value);
    const lista = r.grupos.filter(g => (!prov || g.proveedor === prov) && (!q || normQ(g.descripcion + ' ' + g.proveedor + ' ' + (g.codigo || '')).includes(q)));
    // Agrupado por proveedor (el que más se compró primero): el nombre del proveedor no se repite en cada renglón
    const porProv = new Map();
    for (const g of lista) { const x = porProv.get(g.cuit) || { cuit: g.cuit, proveedor: g.proveedor, items: [], total: 0 }; x.items.push(g); x.total += g.importe_ars || 0; porProv.set(g.cuit, x); }
    const fila = (g) => {
      const k = r.grupos.indexOf(g), s = sugerencia(g);
      const pc = s ? precioComparable(g.ult_unit_ars, s.factor) : null;
      // Control: si el insumo ya tiene precio y este queda muy lejos (más del doble o menos de la mitad), algo está mal leído
      const ref = s?.ins ? insPorId.get(s.ins.id)?.ult_precio : null;
      const motivo = s ? chequeoFactor(g, s.u, s.factor, ref) : null, raro = !!motivo;
      return `<tr class="click fila-vinc${sel.has(k) ? ' sel' : ''}" data-fac="${g.factura_id}" title="Tocá para ver la factura">
        <td><div class="vp-prod">${ed ? `<label class="ck" title="Marcar"><input type="checkbox" data-sel="${k}" ${sel.has(k) ? 'checked' : ''} aria-label="Marcar"><span class="ck-box"></span></label>` : ''}<div><div class="vp-desc">${esc(g.descripcion)}</div>
          <div class="vp-meta">${g.codigo ? `Cód. ${esc(g.codigo)} · ` : ''}${g.n} compra${g.n > 1 ? 's' : ''} · última ${fmtF(g.ultima_fecha)} · <a href="#/factura/${g.factura_id}" data-irfac="${g.factura_id}">ver factura</a></div></div></div></td>
        <td class="num"><b>${$$mon(g.precio_unitario, g.moneda)}</b><div class="vp-meta">por ${esc(s ? unidadMostrar(g.unidad, s.factor, s.u, g.descripcion) : unidadFact(g.unidad))}</div></td>
        <td>${s ? `<div class="vp-ins">${esc(s.nombre)}${s.nuevo ? '<span class="vp-nuevo">nuevo</span>' : ''}</div><div class="vp-meta">${esc(textoEquivale(g.unidad, s.factor, s.u, g.descripcion))}</div>` : '<span class="vp-meta">Sin sugerencia</span>'}</td>
        <td class="num">${pc ? `<b>${fmtP(pc, s.u)}</b>${raro ? `<div class="vp-meta txt-neg con-ico-chico">${ICO.alert}${esc(motivo)}</div>` : ''}` : '<span class="vp-meta">—</span>'}</td>
        <td class="acc-vinc"><div class="acc-in">${puede('editor') ? `${s && s.factor && !raro ? `<button class="btn btn-acento btn-chico" data-ok="${k}">${ICO.check}Confirmar</button>` : ''}<button class="btn btn-chico" data-v="${k}">${s && s.factor ? 'Cambiar' : 'Vincular'}</button><button class="ibtn ib-x" data-ign="${k}" title="No es insumo (flete, servicio, descuento…)" aria-label="No es insumo">${ICO.x}</button>` : ''}</div></td></tr>`;
    };
    const nCol = 5;
    const idxs = (p) => p.items.map(g => r.grupos.indexOf(g));
    $('#tb').innerHTML = lista.length ? [...porProv.values()].sort((a, b) => b.total - a.total).map(p => { const todas = idxs(p).every(k => sel.has(k)), algunas = !todas && idxs(p).some(k => sel.has(k));
      return `<tr class="grupo-vinc${todas ? ' sel' : ''}"><td colspan="${nCol}"><div class="prov">${ed ? `<label class="ck-av${todas ? ' on' : algunas ? ' parcial' : ''}" title="Marcar todas las de este proveedor">${cuad(p.proveedor)}<input type="checkbox" data-selprov="${esc(p.cuit)}" ${todas ? 'checked' : ''} aria-label="Marcar todas las de este proveedor"><span class="ck-box"></span></label>` : cuad(p.proveedor)}<div><b>${esc(p.proveedor)}</b><small class="mono">${fmtCuit(p.cuit)} · ${p.items.length > 1 ? p.items.length + ' descripciones' : '1 descripción'}</small></div></div></td></tr>${p.items.map(fila).join('')}`; }).join('')
      : `<tr><td colspan="${nCol}" class="vacio">${r.grupos.length ? 'Nada coincide con el filtro.' : '<span class="grande">Todo vinculado</span>Cada descripción de las facturas ya tiene su insumo.'}</td></tr>`;
    const barra = () => {
      if (!ed) return;
      $('#barra-sel').hidden = !sel.size;
      $('#sel-n').textContent = sel.size === 1 ? '1 descripción marcada' : `${sel.size} descripciones marcadas`;
    };
    $$('#tb [data-sel]').forEach(c => c.onchange = () => { const k = Number(c.dataset.sel); c.checked ? sel.add(k) : sel.delete(k); pintar(); });
    $$('#tb [data-selprov]').forEach(c => c.onchange = () => { const p = porProv.get(c.dataset.selprov); idxs(p).forEach(k => c.checked ? sel.add(k) : sel.delete(k)); pintar(); });
    $$('#tb .ck, #tb .ck-av').forEach(l => l.onclick = (e) => e.stopPropagation());
    $('#t-vinc').classList.toggle('seleccionando', sel.size > 0);
    barra();
    $$('#tb tr[data-fac]').forEach(tr => tr.onclick = (e) => { if (e.target.closest('button')) return; e.preventDefault(); irFactura(tr.dataset.fac); });
    $$('#tb [data-irfac]').forEach(a => a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); irFactura(a.dataset.irfac); });
    $$('[data-v]').forEach(b => b.onclick = () => modalVincular(r.grupos[b.dataset.v], r.insumos, () => router()));
    $$('[data-ok]').forEach(b => b.onclick = () => conBoton(b, async () => {
      const g = r.grupos[b.dataset.ok], s = sugerencia(g);
      await api('/api/vincular', { method: 'POST', body: { cuit: g.cuit, clave: g.clave, factor: s.factor, ...(s.ins ? { insumo_id: s.ins.id } : { nuevo: { nombre: s.nombre, unidad: s.u, rubro: '' } }) } });
      toast(`Vinculado a ${s.nombre}`); S.cnt = null; await vistaVincular(el);
    }));
    $$('[data-ign]').forEach(b => b.onclick = () => conBoton(b, async () => {
      const g = r.grupos[b.dataset.ign];
      await api('/api/vincular', { method: 'POST', body: { cuit: g.cuit, clave: g.clave, ignorar: true } });
      toast('Marcado como “no es insumo”'); S.cnt = null; await vistaVincular(el);
    }));
  };
  $('#q').oninput = pintar;
  $('#f-prov').onchange = () => { prov = $('#f-prov').value; pintar(); };
  if (ed) {
    $('#sel-limpiar').onclick = () => { sel.clear(); pintar(); };
    $('#sel-ign').onclick = () => conBoton($('#sel-ign'), async () => {
      const gs = [...sel].map(k => r.grupos[k]).filter(Boolean);
      await api('/api/vincular', { method: 'POST', body: { ignorar: true, grupos: gs.map(g => ({ cuit: g.cuit, clave: g.clave })) } });
      toast(gs.length === 1 ? 'Marcada como “no es insumo”' : `${gs.length} descripciones marcadas como “no es insumo”`); S.cnt = null; await vistaVincular(el);
    });
  }
  pintar();
  contadores();
}

function modalVincular(g, insumos, alTerminar) {
  const sugIns = g.sugerido_insumo_id ? insumos.find(i => i.id === g.sugerido_insumo_id) : null;
  const rubros = [...new Set([...RUBROS_BASE, ...(S.rubros || [])])];
  const unit = g.ult_unit_ars || (g.cantidad ? g.importe_ars / g.cantidad : null);   // $ por unidad facturada de la última compra (en pesos)
  modal(`<h2>Vincular descripción</h2>
    <p class="muted" style="margin-bottom:14px"><b>${esc(g.proveedor)}</b><br><span class="desc-fac">${esc(g.descripcion)}</span><br>${g.n} compra(s) · ${$$m(g.precio_unitario)} por ${esc(unidadMostrar(g.unidad, factorSugerido(g, sugIns?.unidad || g.unidad_base || 'kg'), null, g.descripcion))}${g.factura_id ? ` · <a href="#/factura/${g.factura_id}" data-irfac="${g.factura_id}">ver factura</a>` : ''}</p>
    <div class="seg" id="v-modo"><button type="button" data-m="existente" class="${sugIns || !g.nombre_sugerido ? 'on' : ''}">Insumo existente</button><button type="button" data-m="nuevo" class="${!sugIns && g.nombre_sugerido ? 'on' : ''}">Insumo nuevo</button></div>
    <div id="v-exist" class="campo"><label>Insumo</label><select id="v-ins"><option value="">Elegí…</option>${insumos.map(i => `<option value="${i.id}" data-u="${i.unidad}" data-nombre="${esc(i.nombre)}" data-extra="${esc(UNI_C[i.unidad])}${i.rubro ? ' · ' + esc(i.rubro) : ''}" ${sugIns?.id === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`).join('')}</select></div>
    <div id="v-nuevo" class="hidden"><div class="campo"><label>Nombre del insumo</label><input id="v-nom" value="${esc(g.nombre_sugerido || '')}" placeholder="Genérico, sin marca"></div>
      <div class="fila2"><div class="campo"><label>Rubro</label><input id="v-rub" list="dl-rub2" placeholder="Lácteos, Frutas…"><datalist id="dl-rub2">${rubros.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="campo"><label>Se mide por</label><div class="seg" id="v-u">${Object.entries(UNI).map(([k, v]) => `<button type="button" data-u="${k}" class="${(g.unidad_base || 'kg') === k ? 'on' : ''}">${v}</button>`).join('')}</div></div></div></div>
    <div class="campo" id="v-campo-fac"><label>¿Cuánto trae cada ${esc(unidadMostrar(g.unidad, 2, null, g.descripcion))}?</label><div class="fila-eq"><span class="muted">1 ${esc(unidadMostrar(g.unidad, 2, null, g.descripcion))} =</span><input id="v-fac" type="number" min="0" step="any" value="${esc(factorSugerido(g, sugIns?.unidad || g.unidad_base || 'kg') ?? '')}" style="max-width:140px"><span class="muted" id="v-ul"></span></div>
      <div class="ayuda" id="v-prev"></div></div>
    <div class="acciones" style="margin-top:6px"><button class="btn btn-negro" id="v-ok">${ICO.link}Vincular</button></div>`, {
    alMontar: (m, cerrar) => {
      let modo = $('#v-modo .on', m).dataset.m, uNuevo = g.unidad_base || 'kg';
      const unidad = () => modo === 'nuevo' ? uNuevo : ($('#v-ins', m).selectedOptions[0]?.dataset.u || 'kg');
      const prev = () => {
        $('#v-exist', m).classList.toggle('hidden', modo !== 'existente');
        $('#v-nuevo', m).classList.toggle('hidden', modo !== 'nuevo');
        $('#v-ul', m).textContent = UNI_C[unidad()];
        // Si se compra directamente en la unidad del insumo (kg por kg), no hay nada que convertir: se oculta la pregunta
        const directo = factorDirecto(g.unidad, unidad()) === 1;
        const directo2 = directo && !contenidoEnDescripcion(g.descripcion, unidad());
        $('#v-campo-fac label', m).textContent = directo2 ? `Se compra por ${UNI[unidad()]}: no hace falta convertir` : `¿Cuánto trae cada ${unidadMostrar(g.unidad, 2, null, g.descripcion)}?`;
        $('#v-campo-fac .fila-eq', m).classList.toggle('hidden', directo2);
        const f = Number($('#v-fac', m).value);
        const insSel = modo === 'existente' ? insumos.find(i => String(i.id) === $('#v-ins', m).value) : null;
        const aviso = chequeoFactor(g, unidad(), f, insSel?.ult_precio || null);
        $('#v-prev', m).innerHTML = (f > 0 && unit ? `Precio comparable: <b>${$$m(unit / f)}</b> por ${esc(UNI[unidad()])} (neto, sin IVA). Así se compara con cualquier otro proveedor, venga en la presentación que venga.` : 'Ej: bolsa × 25 kg → 25 · bidón de 5 litros → 5 · si ya se factura por kg → 1.')
          + (aviso ? `<div class="txt-neg con-ico-chico" style="margin-top:6px">${ICO.alert}${esc(aviso)}</div>` : '');
      };
      $$('#v-modo button', m).forEach(b => b.onclick = () => { modo = b.dataset.m; $$('#v-modo button', m).forEach(x => x.classList.toggle('on', x === b)); prev(); });
      $$('#v-u button', m).forEach(b => b.onclick = () => { uNuevo = b.dataset.u; $$('#v-u button', m).forEach(x => x.classList.toggle('on', x === b)); prev(); });
      // Al cambiar de insumo (o de unidad del nuevo), si la unidad facturada es directa se completa sola
      const reFactor = () => { $('#v-fac', m).value = factorSugerido({ ...g, unidad_base: g.unidad_base === unidad() ? g.unidad_base : null, contenido: g.unidad_base === unidad() ? g.contenido : null }, unidad()) ?? ''; prev(); };
      comboSelect($('#v-ins', m));
      $('#v-ins', m).onchange = reFactor; $('#v-fac', m).oninput = prev;
      $$('#v-u button', m).forEach(b => b.addEventListener('click', reFactor));
      $$('[data-irfac]', m).forEach(a => a.onclick = (e) => { e.preventDefault(); cerrar(); irFactura(a.dataset.irfac); });
      prev();
      $('#v-ok', m).onclick = () => conBoton($('#v-ok', m), async () => {
        const body = { cuit: g.cuit, clave: g.clave, factor: Number($('#v-fac', m).value) };
        if (modo === 'nuevo') body.nuevo = { nombre: $('#v-nom', m).value, rubro: $('#v-rub', m).value, unidad: uNuevo };
        else { body.insumo_id = Number($('#v-ins', m).value); if (!body.insumo_id) throw new Error('Elegí el insumo.'); }
        await api('/api/vincular', { method: 'POST', body });
        cerrar(); toast('Vinculado'); S.cnt = null; alTerminar && alTerminar();
      });
    },
  });
}

// ---------------------------------------------------------------------------
//  Facturas leídas
// ---------------------------------------------------------------------------
async function vistaFacturas(el) {
  let lectura = sessionStorage.getItem('fac_lect') || '', mes = sessionStorage.getItem('fac_mes') || '';
  el.innerHTML = `<div class="encabezado"><div><h1>Facturas leídas</h1><p>Facturas de materia prima traídas de la app de facturas de proveedores, con sus renglones.</p></div>
      ${puede('editor') ? `<div class="acciones"><button class="btn" id="b-sync">${ICO.refresh}Sincronizar ahora</button></div>` : ''}</div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Proveedor, CUIT, número o #id"></label>
      <select id="f-mes" aria-label="Mes">${[['', 'Todos los meses'], ...Array.from({ length: 12 }, (_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); const ym = d.toISOString().slice(0, 7); return [ym, d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase())]; })].map(([k, t]) => `<option value="${k}" ${k === mes ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="f-lect" aria-label="Estado de lectura">${[['', 'Todos los estados'], ['ok', 'Leídas'], ['revisar', 'No cierran'], ['pendiente', 'En cola'], ['error', 'Con error'], ['espera', 'Esperando'], ['duplicada', 'Duplicadas']].map(([k, t]) => `<option value="${k}" ${k === lectura ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="tabla-wrap"><table><thead><tr><th>Proveedor</th><th>Comprobante</th><th>Fecha</th><th class="num">Neto</th><th class="num">Renglones</th><th>Lectura</th></tr></thead><tbody id="tb"><tr><td colspan="6" class="vacio"><span class="cargando"></span></td></tr></tbody></table></div></div>`;
  const cargar = async () => {
    const p = new URLSearchParams(); if (lectura) p.set('lectura', lectura); if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    const r = await api('/api/facturas?' + p);
    if (mes) r.facturas = r.facturas.filter(f => String(f.fecha || '').startsWith(mes));
    $('#tb').innerHTML = r.facturas.length ? r.facturas.map(f => `<tr class="click" data-id="${f.id}">
        <td><div class="prov">${cuad(f.razon_social)}<div><b>${esc(f.razon_social || 'Sin identificar')}</b><small class="mono">${fmtCuit(f.cuit)} · #${f.id}</small></div></div></td>
        <td class="mono">${esc(TIPOS[f.tipo] || '')} ${nroCbte(f)}</td><td class="mono">${fmtF(f.fecha)}</td>
        <td class="num">${$$mon(f.neto, f.moneda)}${f.descuento_pct ? `<small class="sub-celda txt-pos">bonif. general ${dec(f.descuento_pct)} %</small>` : ''}</td>
        <td class="num">${f.n_renglones || '—'}${f.n_renglones ? `<small class="sub-celda">${f.n_vinculados === f.n_renglones ? 'todos vinculados' : `${f.n_renglones - f.n_vinculados} sin vincular`}</small>` : ''}</td>
        <td>${badgeLectura(f.lectura)}${f.lectura_motivo && f.lectura !== 'ok' ? `<small class="sub-celda motivo-rech">${esc(f.lectura_motivo)}</small>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="6" class="vacio">${lectura || mes || $('#q').value ? 'Nada coincide con el filtro.' : '<span class="grande">Todavía no hay facturas</span>Se traen solas de la app de facturas cada 10 minutos.'}</td></tr>`;
    $$('#tb tr[data-id]').forEach(tr => tr.onclick = () => irFactura(tr.dataset.id));
  };
  let t0; $('#q').oninput = () => { clearTimeout(t0); t0 = setTimeout(cargar, 300); };
  $('#f-mes').onchange = (e) => { mes = e.target.value; sessionStorage.setItem('fac_mes', mes); cargar(); };
  $('#f-lect').onchange = (e) => { lectura = e.target.value; sessionStorage.setItem('fac_lect', lectura); cargar(); };
  const bs = $('#b-sync'); if (bs) bs.onclick = () => conBoton(bs, sincronizarAhora);
  await cargar();
}

// ---------------------------------------------------------------------------
//  Detalle de una factura: el PDF a la izquierda y los renglones leídos a la derecha
// ---------------------------------------------------------------------------
// Abrir una factura recordando de dónde se vino (para el botón "volver")
function irFactura(id) {
  try { sessionStorage.setItem('fac_volver', location.hash || '#/facturas'); } catch { }
  location.hash = '#/factura/' + id;
}
const NOMBRE_VOLVER = (h) => /^#\/vincular/.test(h) ? 'Para vincular' : /^#\/insumo\//.test(h) ? 'Volver al insumo' : /^#\/alertas/.test(h) ? 'Alertas' : 'Facturas leídas';

async function vistaFactura(el, id) {
  const d = await api('/api/facturas/' + id);
  let volver = '#/facturas'; try { volver = sessionStorage.getItem('fac_volver') || '#/facturas'; } catch { }
  if (/^#\/factura\//.test(volver)) volver = '#/facturas';
  const f = d.factura;
  const dif = f.neto && f.suma_renglones != null ? f.suma_renglones - f.neto : null;
  const prods = d.renglones.filter(r => !r.es_descuento);
  const descs = d.renglones.filter(r => r.es_descuento);
  el.innerHTML = `<div class="encabezado" style="margin-bottom:16px"><div class="navfact"><a class="btn btn-ghost btn-chico" href="${esc(volver)}">${ICO.back}${esc(NOMBRE_VOLVER(volver))}</a><span class="tag mono">#${f.id}</span></div></div>
  <div class="detalle">
    <div class="visor" id="visor"><div class="vacio"><span><span class="cargando"></span> Cargando la factura…</span></div></div>
    <div class="lado">
      <section class="panel panel-pad ficha-fac">
        <div class="mf-h"><div><h2>${esc(f.razon_social || 'Factura')}</h2><p class="muted small">${fmtCuit(f.cuit)} · ${esc(TIPOS[f.tipo] || '')} ${nroCbte(f)} · ${fmtF(f.fecha)}${f.cuenta ? ` · cuenta ${f.cuenta} ${esc(f.cuenta_den || '')}` : ''}</p></div>${badgeLectura(f.lectura)}</div>
        ${f.lectura_motivo ? `<p class="aviso-lectura">${esc(f.lectura_motivo)}</p>` : ''}
        ${f.descuento_pct ? `<div class="aviso-desc">${ICO.check}<div><b>Bonificación general del ${dec(f.descuento_pct)} %</b> (${$$m(f.descuento_importe)}) sobre los productos. Ya está descontada en el precio de cada insumo de esta factura.</div></div>` : ''}
        <div class="cuadre-fac"><span>Suma de renglones <b>${$$m(f.suma_renglones)}</b></span><span>Neto de la factura <b>${$$m(f.neto)}</b></span>${dif !== null ? `<span class="${Math.abs(dif) > 1 ? 'txt-neg' : 'txt-pos'}">Diferencia <b>${$$m(dif)}</b></span>` : ''}</div>
        ${puede('editor') && !['espera', 'pendiente', 'leyendo'].includes(f.lectura) ? `<div class="acciones" style="margin-top:12px"><button class="btn btn-negro" id="mf-re">${ICO.sparkle}Volver a leer</button></div>` : ''}
      </section>
      <section class="panel">
        <div class="panel-titulo"><h2>Renglones leídos</h2><span class="small muted">${prods.length} renglón(es)</span></div>
        <div class="tabla-wrap"><table class="sin-orden tabla-ren"><thead><tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Importe</th></tr></thead><tbody>
        ${prods.length ? prods.map(r => `<tr class="${r.ignorado ? 'inactivo' : ''}">
          <td><span class="desc-fac">${esc(r.descripcion)}</span>${r.codigo ? `<small class="sub-celda mono">Cód. ${esc(r.codigo)}</small>` : ''}
            <small class="sub-celda">${r.insumo_id ? `<a href="#/insumo/${r.insumo_id}">${esc(r.insumo)}</a> · ${esc(textoEquivale(r.unidad, r.factor, r.insumo_unidad, r.descripcion))} · <b>${fmtP(r.precio_base, r.insumo_unidad)}</b>` : r.ignorado ? 'No es insumo' : `Sin vincular${puede('editor') ? ` · <button class="btn-link" data-vinc-ren="${r.id}">Vincular ahora</button>` : ''}`}</small></td>
          <td class="num">${r.cantidad != null ? fmtCant.format(r.cantidad) : '—'} <small class="muted">${esc(unidadMostrar(r.unidad, r.factor || contenidoEnDescripcion(r.descripcion, 'un') || contenidoEnDescripcion(r.descripcion, 'kg') || contenidoEnDescripcion(r.descripcion, 'l') || r.contenido, null, r.descripcion))}</small></td>
          <td class="num">${$$m(r.precio_unitario)}${r.bonif_pct ? `<small class="sub-celda">bonif. ${dec(r.bonif_pct)} %</small>` : ''}</td>
          <td class="num">${$$m(r.importe)}${r.desc_pct ? `<small class="sub-celda txt-pos">− ${dec(r.desc_pct)} % → ${$$m(r.importe * (1 - r.desc_pct / 100))}</small>` : ''}</td></tr>`).join('')
          : '<tr><td colspan="4" class="vacio">Sin renglones todavía.</td></tr>'}
        ${descs.map(r => `<tr class="fila-desc"><td><span class="desc-fac">${esc(r.descripcion)}</span><small class="sub-celda">Bonificación: se prorratea en los productos</small></td><td></td><td></td><td class="num txt-pos">− ${$$m(Math.abs(r.importe || 0))}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
    </div>
  </div>`;
  const br = $('#mf-re'); if (br) br.onclick = () => conBoton(br, async () => {
    const r = await api(`/api/facturas/${f.id}/releer`, { method: 'POST' });
    toast(`Leída de nuevo: ${r.renglones} renglón(es)`); router();
  });
  // Vincular un renglón sin salir de la factura (con el PDF a la vista)
  $$('[data-vinc-ren]', el).forEach(b => b.onclick = () => conBoton(b, async () => {
    const ren = d.renglones.find(r => String(r.id) === b.dataset.vincRen);
    const v = await api('/api/vincular');
    S.rubros = S.rubros || [];
    const g = v.grupos.find(x => x.cuit === ren.cuit && x.clave === ren.clave) || { cuit: ren.cuit, clave: ren.clave, proveedor: f.razon_social, descripcion: ren.descripcion, unidad: ren.unidad, n: 1,
      precio_unitario: ren.precio_unitario, ult_unit_ars: ren.cantidad ? ren.importe_ars / ren.cantidad : null, contenido: ren.contenido, unidad_base: ren.unidad_base, nombre_sugerido: ren.nombre_sugerido };
    g.factura_id = null;   // ya está en la factura
    modalVincular(g, v.insumos, async () => { const h = location.hash; await vistaFactura(el, id); if (location.hash !== h) location.hash = h; });
  }));
  cargarPdf(`/api/facturas/${f.id}/pdf`);
}

// ---- Visor del PDF (el mismo de la app de facturas) ----
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let _pdfjsCarga = null;
function cargarPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!_pdfjsCarga) _pdfjsCarga = new Promise((ok, mal) => {
    const sc = document.createElement('script');
    sc.src = PDFJS + 'pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    sc.onerror = () => { _pdfjsCarga = null; mal(new Error('no cargó pdf.js')); };
    document.head.appendChild(sc);
  });
  return _pdfjsCarga;
}
async function cargarPdf(ruta) {
  if (!$('#visor')) return;
  try {
    const res = await api(ruta, { raw: true });
    const blob = await res.blob();
    if (S.pdfUrl) URL.revokeObjectURL(S.pdfUrl);
    S.pdfUrl = URL.createObjectURL(blob);
    if (/^image\//.test(blob.type)) {   // facturas que llegaron como foto
      $('#visor').innerHTML = `<div class="pdf-barra"><span class="small" style="color:#d6d4cf">Foto de la factura</span><span style="flex:1"></span><a class="ibtn" href="${S.pdfUrl}" target="_blank" rel="noopener" title="Abrir en pestaña nueva">${svgI('<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>')}</a></div><div class="pdf-paginas"><img src="${S.pdfUrl}" alt="Factura" class="visor-img"></div>`;
      return;
    }
    S.pdfBytes = new Uint8Array(await blob.arrayBuffer());
    await mostrarPdf();
  } catch (e) {
    if ($('#visor')) $('#visor').innerHTML = `<div class="vacio" style="color:#d6d4cf">No se pudo cargar la factura: ${esc(e.message)}</div>`;
  }
}
async function mostrarPdf() {
  const visor = $('#visor');
  if (!visor || !S.pdfUrl) return;
  S.pdfZoom = S.pdfZoom || 1;
  visor.innerHTML = `<div class="pdf-barra">
      <button class="ibtn" data-z="-" title="Alejar" aria-label="Alejar">${svgI('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>')}</button>
      <span class="pdf-zoom">${Math.round(S.pdfZoom * 100)}%</span>
      <button class="ibtn" data-z="+" title="Acercar" aria-label="Acercar">${svgI('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>')}</button>
      <button class="ibtn" data-z="1" title="Ajustar al ancho" aria-label="Ajustar al ancho">${svgI('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>')}</button>
      <span style="flex:1"></span>
      <a class="ibtn" href="${S.pdfUrl}" target="_blank" rel="noopener" title="Abrir en pestaña nueva" aria-label="Abrir en pestaña nueva">${svgI('<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>')}</a>
      <a class="ibtn" href="${S.pdfUrl}" download="factura.pdf" title="Descargar" aria-label="Descargar">${svgI('<path d="M12 3v12M8 11l4 4 4-4M4 21h16"/>')}</a>
    </div><div class="pdf-paginas" id="pdf-paginas"><div class="vacio"><span><span class="cargando"></span> Abriendo PDF…</span></div></div>`;
  $$('[data-z]', visor).forEach(b => b.onclick = () => {
    S.pdfZoom = b.dataset.z === '1' ? 1 : Math.min(3, Math.max(0.5, S.pdfZoom + (b.dataset.z === '+' ? 0.25 : -0.25)));
    mostrarPdf();
  });
  const cont = $('#pdf-paginas', visor);
  let pdfjs;
  try { pdfjs = await cargarPdfjs(); }
  catch { cont.innerHTML = `<iframe src="${S.pdfUrl}#view=FitH&navpanes=0" title="PDF de la factura"></iframe>`; cont.classList.add('con-iframe'); return; }
  try {
    const doc = await pdfjs.getDocument({ data: S.pdfBytes.slice() }).promise;
    if (!cont.isConnected) return;
    cont.innerHTML = '';
    const ancho = Math.max(280, cont.clientWidth - 24) * S.pdfZoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (let n = 1; n <= doc.numPages; n++) {
      const pag = await doc.getPage(n);
      const base = pag.getViewport({ scale: 1 });
      const vp = pag.getViewport({ scale: (ancho / base.width) * dpr });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.style.width = Math.floor(vp.width / dpr) + 'px';
      cv.title = 'Doble clic: abrir en pestaña nueva';
      cv.ondblclick = () => window.open(S.pdfUrl, '_blank', 'noopener');
      if (!cont.isConnected) return;
      cont.appendChild(cv);
      await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
    if (doc.numPages > 1) cont.insertAdjacentHTML('beforeend', `<div class="pdf-pie">${doc.numPages} páginas</div>`);
  } catch (e) {
    cont.innerHTML = `<iframe src="${S.pdfUrl}#view=FitH&navpanes=0" title="PDF de la factura"></iframe>`; cont.classList.add('con-iframe');
  }
}

// ---------------------------------------------------------------------------
//  Gráfico de precios (SVG propio): una línea por proveedor, eje de tiempo real,
//  crosshair con tooltip y teclado. Hasta 3 proveedores con color; el resto en "Otros".
// ---------------------------------------------------------------------------
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const tFecha = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
function pasoLindo(rango, n = 4) {
  const bruto = rango / n, p = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const fmtEje = (v) => '$ ' + (v >= 100000 ? Math.round(v).toLocaleString('es-AR') : v.toLocaleString('es-AR', { maximumFractionDigits: v < 100 ? 2 : 0 }));

function graficoPrecios(cont, leyendaEl, compras, u) {
  const cs = (compras || []).filter(c => c.fecha && c.precio > 0);
  if (!cs.length) { cont.innerHTML = '<div class="vacio">Todavía no hay compras con precio para graficar.</div>'; return; }
  // Series por proveedor, ordenadas por cantidad comprada (el color sigue al proveedor, no al ranking del filtro)
  const porProv = new Map();
  for (const c of cs) { const s = porProv.get(c.cuit) || { cuit: c.cuit, nombre: c.proveedor || fmtCuit(c.cuit), pts: [], q: 0 }; s.pts.push(c); s.q += Number(c.cantidad) || 0; porProv.set(c.cuit, s); }
  let series = [...porProv.values()].sort((a, b) => b.q - a.q);
  if (series.length > 3) {
    const otros = { cuit: '_otros', nombre: `Otros (${series.length - 2})`, pts: series.slice(2).flatMap(s => s.pts).sort((a, b) => a.fecha.localeCompare(b.fecha)), q: 0, otros: true };
    series = [...series.slice(0, 2), otros];
  }
  series.forEach((s, k) => { s.color = s.otros ? 'var(--serie-otros)' : `var(--serie-${k + 1})`; s.pts.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.factura_id - b.factura_id); });
  leyendaEl.innerHTML = series.length > 1 ? series.map(s => `<span class="ley"><i style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join('') : '';

  const fechas = [...new Set(cs.map(c => c.fecha))].sort();
  const tip = document.createElement('div'); tip.className = 'graf-tip'; tip.hidden = true;
  let idx = fechas.length - 1, ro = null;

  const dibujar = () => {
    const W = Math.max(cont.clientWidth || 600, 280), movil = W < 560, H = movil ? 220 : 280;
    const M = { l: movil ? 64 : 78, r: 16, t: 16, b: 28 };
    let t0 = tFecha(fechas[0]), t1 = tFecha(fechas[fechas.length - 1]);
    if (t1 - t0 < 20 * 864e5) { t0 -= 15 * 864e5; t1 += 15 * 864e5; }
    const ys = cs.map(c => c.precio);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = Math.max((y1 - y0) * 0.12, y1 * 0.04);
    y0 = Math.max(0, y0 - pad); y1 = y1 + pad;
    const paso = pasoLindo(y1 - y0);
    y0 = Math.floor(y0 / paso) * paso; y1 = Math.ceil(y1 / paso) * paso;
    const X = (f) => M.l + (tFecha(f) - t0) / (t1 - t0) * (W - M.l - M.r);
    const XT = (t) => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r);
    const Y = (v) => H - M.b - (v - y0) / (y1 - y0) * (H - M.t - M.b);
    let g = '';
    for (let v = y0; v <= y1 + paso / 2; v += paso) g += `<line class="g-grid" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="g-eje" x="${M.l - 8}" y="${Y(v) + 4}" text-anchor="end">${fmtEje(v)}</text>`;
    // Meses del eje X (salteando si no entran)
    const d0 = new Date(t0), meses = [];
    for (let d = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); d <= t1; d = Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth() + 1, 1)) meses.push(d);
    const cada = Math.max(1, Math.ceil(meses.length / Math.floor((W - M.l - M.r) / 64)));
    meses.forEach((d, k) => { if (k % cada) return; const dt = new Date(d); g += `<text class="g-eje" x="${XT(d)}" y="${H - 8}" text-anchor="middle">${MESES_C[dt.getUTCMonth()]}${dt.getUTCMonth() === 0 || k === 0 ? ' ' + String(dt.getUTCFullYear()).slice(2) : ''}</text>`; });
    g += `<line class="g-base" x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}"/>`;
    for (const s of series) {
      if (s.pts.length > 1) g += `<path class="g-linea" style="stroke:${s.color}" d="${s.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.fecha).toFixed(1)},${Y(p.precio).toFixed(1)}`).join('')}"/>`;
      g += s.pts.map(p => `<circle class="g-pto" style="fill:${s.color}" cx="${X(p.fecha).toFixed(1)}" cy="${Y(p.precio).toFixed(1)}" r="4" data-f="${p.fecha}"/>`).join('');
    }
    // Etiqueta directa del último precio de cada proveedor (separadas para que no se pisen)
    const labs = series.map(s => { const p = s.pts[s.pts.length - 1]; return { s, x: X(p.fecha), y: Y(p.precio) - 10, v: p.precio }; }).sort((a, b) => a.y - b.y);
    for (let k = 1; k < labs.length; k++) if (labs[k].y - labs[k - 1].y < 15) labs[k].y = labs[k - 1].y + 15;
    g += labs.map(l => `<text class="g-lab" x="${Math.max(l.x - 6, M.l + 40)}" y="${Math.max(l.y, M.t + 8)}" text-anchor="end">${esc($$m(l.v))}</text>`).join('');
    g += `<line class="g-cruz" id="g-cruz" y1="${M.t}" y2="${H - M.b}" x1="${M.l}" x2="${M.l}" visibility="hidden"/>`;
    g += `<rect class="g-hit" x="${M.l}" y="0" width="${W - M.l - M.r}" height="${H}" tabindex="0" aria-label="Precio por ${esc(UNI[u])} en el tiempo. Usá las flechas para recorrer las compras."/>`;
    cont.innerHTML = `<svg class="graf-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${g}</svg>`;
    cont.appendChild(tip);
    const svg = $('svg', cont), hit = $('.g-hit', cont), cruz = $('#g-cruz', cont);
    const mostrar = (k) => {
      idx = Math.max(0, Math.min(fechas.length - 1, k));
      const f = fechas[idx], x = X(f);
      cruz.setAttribute('x1', x); cruz.setAttribute('x2', x); cruz.setAttribute('visibility', 'visible');
      $$('.g-pto', cont).forEach(c => c.classList.toggle('on', c.dataset.f === f));
      tip.textContent = '';
      const h = document.createElement('div'); h.className = 'gt-f'; h.textContent = fmtF(f); tip.appendChild(h);
      for (const s of series) {
        const prev = s.pts.filter(p => p.fecha <= f); if (!prev.length) continue;
        const p = prev[prev.length - 1];
        const fila = document.createElement('div'); fila.className = 'gt-r' + (p.fecha === f ? ' hoy' : '');
        const key = document.createElement('i'); key.style.background = s.color;
        const v = document.createElement('b'); v.textContent = $$m(p.precio) + ' /' + UNI_C[u];
        const n = document.createElement('span'); n.textContent = s.nombre + (p.fecha === f ? ' · compra' : ` · al ${fmtF(p.fecha)}`);
        fila.append(key, v, n); tip.appendChild(fila);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = (x + 12 + tw > W ? Math.max(4, x - tw - 12) : x + 12) + 'px';
      tip.style.top = M.t + 'px';
    };
    const cercano = (px) => { let best = 0, bd = Infinity; fechas.forEach((f, k) => { const d = Math.abs(X(f) - px); if (d < bd) { bd = d; best = k; } }); return best; };
    hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); mostrar(cercano((e.clientX - r.left) * (W / r.width))); });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; cruz.setAttribute('visibility', 'hidden'); $$('.g-pto.on', cont).forEach(c => c.classList.remove('on')); });
    hit.addEventListener('focus', () => mostrar(idx));
    hit.addEventListener('blur', () => { tip.hidden = true; });
    hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); mostrar(idx - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); mostrar(idx + 1); } });
  };
  dibujar();
  if (window.ResizeObserver) { let ancho = cont.clientWidth; ro = new ResizeObserver(() => { if (Math.abs(cont.clientWidth - ancho) > 8) { ancho = cont.clientWidth; dibujar(); } }); ro.observe(cont); }
}

// ---------------------------------------------------------------------------
//  Configuración
// ---------------------------------------------------------------------------
const DIAS_SEMANA = [];
const CFG_UI = [
  { t: 'Alertas', ico: 'bell', items: [
    { k: 'umbral_suba_pct', tipo: 'numero', step: 0.5, suf: '%', t: 'Suba contra la compra anterior', d: 'Avisa cuando un proveedor cobra un insumo este porcentaje más caro que en su compra anterior. Cada insumo puede tener su propio umbral.' },
    { k: 'umbral_promedio_pct', tipo: 'numero', step: 0.5, suf: '%', t: 'Por encima del promedio', d: 'Avisa cuando una compra queda este porcentaje arriba del promedio ponderado del período (todos los proveedores).' },
    { k: 'umbral_proveedor_pct', tipo: 'numero', step: 0.5, suf: '%', t: 'Otro proveedor más barato', d: 'Avisa cuando otro proveedor vendió el mismo insumo este porcentaje más barato dentro del período.' },
    { k: 'alertar_bajas', tipo: 'switch', t: 'Avisar también las bajas', d: 'Cuando un proveedor baja el precio por encima del umbral de suba.', si: 'Sí', no: 'No' },
    { k: 'dias_alerta', tipo: 'numero', suf: 'días', t: 'Antigüedad máxima para alertar', d: 'Las compras más viejas que esto entran al historial pero no generan alertas (evita una lluvia de avisos al leer el historial).' },
  ] },
  { t: 'Precios', ico: 'chart', items: [
    { k: 'dias_promedio', tipo: 'numero', suf: 'días', t: 'Período del promedio', d: 'Ventana del promedio ponderado y de la comparación entre proveedores.' },
    { k: 'umbral_shares_pct', tipo: 'numero', step: 0.5, suf: '%', t: 'Shares desactualizado', d: 'Marca una materia prima cuando la última compra queda este porcentaje (o más) lejos del costo que usa Shares en las recetas.' },
  ] },
  { t: 'Lectura de facturas', ico: 'sparkle', items: [
    { k: 'lecturas_por_corrida', tipo: 'numero', suf: 'facturas', t: 'Facturas por corrida', d: 'Máximo de facturas que se leen en cada corrida (cada 10 minutos; si Google corta, la app espera y sigue). Hasta 60.' },
    { k: 'tolerancia_cierre_pct', tipo: 'numero', step: 0.5, suf: '%', t: 'Tolerancia del control', d: 'Diferencia aceptada entre la suma de los renglones y el neto de la factura antes de marcarla como “No cierra”.' },
    { k: 'leer_historial', tipo: 'switch', t: 'Leer el historial', d: 'En la primera sincronización trae también las facturas que ya estaban en la app de facturas. Después no tiene efecto.', si: 'Sí', no: 'Solo nuevas' },
  ] },
];

async function vistaAdmin(el) {
  if (!puede('admin')) throw new Error('Necesitás rol admin.');
  el.innerHTML = `<div class="encabezado"><div><h1>Configuración</h1><p>Conexiones, usuarios, umbrales de alertas y auditoría.</p></div></div>
    <div class="panel"><div class="tabs" id="atabs">${['Salud', 'Usuarios', 'Ajustes', 'Auditoría'].map((t, i) => `<button class="${i ? '' : 'activo'}" data-t="${i}">${t}</button>`).join('')}</div><div id="acont" class="panel-pad"></div></div>`;
  const tabs = [adminSalud, adminUsuarios, async (c) => { await adminConfig(c); S.cfg = null; }, adminAuditoria];
  const ir = async (i) => {
    $$('#atabs button').forEach(b => b.classList.toggle('activo', b.dataset.t === String(i)));
    $('#acont').innerHTML = '<span class="cargando"></span>';
    try { await tabs[i]($('#acont')); } catch (e) { $('#acont').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  };
  $$('#atabs button').forEach(b => b.onclick = () => ir(Number(b.dataset.t)));
  ir(0);
}
async function adminSalud(el) {
  const s = await api('/api/salud');
  const rc0 = s.recetas || {};
  const fila = (ok, t, det, prueba, accion = '') => `<tr><td>${ok ? '<span class="badge b-ok">OK</span>' : '<span class="badge b-critica">Falta</span>'}</td><td><b>${t}</b><div class="small muted">${det}</div></td><td>${accion || (prueba ? `<button class="btn btn-chico" data-probar="${prueba}">Probar</button>` : '')}</td></tr>`;
  el.innerHTML = `<table class="sin-orden tabla-salud"><tbody>
    ${fila(s.gemini, 'Gemini (lectura de renglones)', `GEMINI_KEY · modelos ${esc(s.gemini_modelos.join(', '))}${s.gemini_saturado ? ` · <span class="txt-neg">Google estuvo saturado a las ${esc(fmtFH(s.gemini_saturado + 'Z'))}: la lectura se reintenta sola cada 10 minutos</span>` : ''}`, 'gemini')}
    ${fila(s.facturas_binding && s.costos_secret, 'App de facturas de proveedores', `Service binding FACTURAS ${s.facturas_binding ? 'cargado' : 'falta'} · COSTOS_SECRET ${s.costos_secret ? 'cargado' : 'falta'}`, 'facturas')}
    ${fila(!!s.ultima_sync, 'Sincronización', s.ultima_sync ? `Última: ${fmtFH(s.ultima_sync + 'Z')} · hasta la factura #${esc(s.cursor || 0)}` : 'Todavía no corrió. Corre sola cada 10 minutos (Cron Trigger).')}
    ${fila(true, 'Datos', `${s.insumos} insumo(s) · ${s.vinculos} descripción(es) vinculada(s) · ${s.renglones} renglón(es) leído(s)`)}
    ${(() => { const rc = s.recetas || {}, pt = rc.PRODUCTO_TERMINADO, bs = rc.BASE, er = rc.error;
      const ok = rc.shares && pt && bs && (!er || er.at < (pt.at > bs.at ? pt.at : bs.at));
      return fila(rc.shares, 'Shares (recetas)', `${esc(rc.url || '')}${rc.shares ? '' : ' · faltan SHARES_USERNAME y SHARES_PASSWORD en el Worker'}`, 'shares')
        + fila(ok, 'Recetas de Shares', `${pt ? `Productos: ${fmtFH(pt.at)} (${pt.cantidad})` : 'Productos: todavía no'} · ${bs ? `Bases: ${fmtFH(bs.at)} (${bs.cantidad})` : 'Bases: todavía no'} · ${rc.materias_primas || 0} materias primas${rc.costos_distintos ? ` · <b>${rc.costos_distintos} con costos distintos en distintas recetas</b>` : ''}${[pt, bs].filter(x => x?.recibidos != null && x.recibidos !== x.cantidad).map(x => `<br><span class="txt-neg">${x.tipo === 'BASE' ? 'Bases' : 'Productos'}: Shares mandó ${x.recibidos} y se guardaron ${x.cantidad} (sin código ${x.descartados?.sin_id || 0}, repetidos ${x.descartados?.repetidos || 0}, de otro tipo ${x.descartados?.otro_tipo || 0})</span>`).join('')}${er && (!pt || er.at > pt.at) ? `<br><span class="txt-neg">Último error (${fmtFH(er.at)}): ${esc(er.error)}</span>` : ''} · se traen solas a las 6`, null, puede('editor') ? `<button class="btn btn-chico" id="b-rec">${ICO.refresh}Traer ahora</button>` : '');
    })()}
    ${puede('admin') && rc0.shares ? fila(true, 'Control contra Shares', 'Le pregunta a Shares las recetas de varias formas y compara costos, recetas y cantidades con lo que tiene la app. Solo lee: no cambia nada.', null, `<button class="btn btn-chico" id="b-ctrl">${ICO.check}Controlar</button>`) : ''}
  </tbody></table><p class="small muted">Versión ${esc(s.version)}</p>`;
  const bct = $('#b-ctrl', el); if (bct) bct.onclick = () => controlShares();
  const brc = $('#b-rec', el); if (brc) brc.onclick = () => traerRecetas(brc, puede('admin'));
  $$('[data-probar]', el).forEach(b => b.onclick = () => conBoton(b, async () => { const r = await api('/api/probar/' + b.dataset.probar, { method: 'POST' }); toast(r.mensaje); }));
}

// ---- Control contra Shares: cada consulta es un pedido aparte al Worker (una por vez, para no pasar el tiempo
// de procesador del plan gratuito). Solo lee. Compara cantidades, costos y recetas, y prueba si Shares pagina.
const NOMBRE_VARIANTE = { base: 'Consulta normal', sin_tipo: 'Sin filtrar por tipo', pagina_2: 'Página 2 (page=2)', pagina_2_pn: 'Página 2 (pageNumber=2)', tamano_grande: 'Página de 5000',
  limite: 'Límite 5000', desplazado: 'Salteando las primeras 100', inactivas: 'Pidiendo también inactivas', tipo_minuscula: 'Tipo en minúscula' };
const CLAVES_PAGINA = /total|count|page|pagina|next|siguiente|more|offset|limit|cursor|links|meta/i;
async function controlShares() {
  const { variantes } = await api('/api/recetas/control/variantes');
  const pasos = [];
  for (const tipo of ['PRODUCTO_TERMINADO', 'BASE']) for (const v of variantes) if (!(v === 'sin_tipo' && tipo === 'BASE')) pasos.push([tipo, v]);
  const res = [];
  modal(`<h2>Control contra Shares</h2><p class="muted" id="ct-est">Consultando Shares… 0 de ${pasos.length}</p><div class="barra-prog"><span id="ct-bar" style="width:0%"></span></div><div id="ct-res"></div>`, {
    ancho: true,
    alMontar: async (m, cerrar) => {
      for (const [k, [tipo, v]] of pasos.entries()) {
        if (!$('#ct-est', m)) return;   // se cerró la ventana: no se sigue consultando
        $('#ct-est', m).textContent = `Consultando Shares… ${k + 1} de ${pasos.length}: ${tipo === 'BASE' ? 'bases' : 'productos'}, ${NOMBRE_VARIANTE[v] || v}`;
        try { res.push(await api(`/api/recetas/control?tipo=${tipo}&v=${v}`)); }
        catch (e) { res.push({ tipo, variante: v, error: e.message }); }
        $('#ct-bar', m).style.width = `${(k + 1) / pasos.length * 100}%`;
      }
      if (!$('#ct-est', m)) return;
      $('#ct-est', m).textContent = `Listo: ${pasos.length} consultas a Shares.`;
      $('#ct-res', m).innerHTML = informeControl(res);
      const bx = $('#ct-xls', m); if (bx) bx.onclick = () => excelControl(res);
    },
  });
}
function informeControl(res) {
  const porTipo = ['PRODUCTO_TERMINADO', 'BASE'].map(tipo => {
    const base = res.find(r => r.tipo === tipo && r.variante === 'base');
    const otras = res.filter(r => r.tipo === tipo && r.variante !== 'base');
    const ids = new Set(base?.ids || []);
    const filas = otras.map(r => { const nuevos = (r.ids || []).filter(i => !ids.has(i)); return { r, nuevos }; });
    const pag = (base?.claves || []).filter(k => k !== 'data' && CLAVES_PAGINA.test(k));
    const problemas = [];
    if (!base || base.error) problemas.push(`no se pudo consultar (${esc(base?.error || 'sin respuesta')})`);
    else {
      if (base.faltan_en_app.n) problemas.push(`${base.faltan_en_app.n} en Shares que no están en la app`);
      if (base.sobran_en_app.n) problemas.push(`${base.sobran_en_app.n} en la app que Shares ya no manda`);
      if (base.costos_distintos.n) problemas.push(`${base.costos_distintos.n} con costo distinto`);
      if (base.recetas_distintas.n) problemas.push(`${base.recetas_distintas.n} con receta distinta`);
      if (base.sin_id || base.repetidos) problemas.push(`${base.sin_id} sin código y ${base.repetidos} repetidas en la respuesta`);
      if (pag.length) problemas.push(`la respuesta trae campos de paginación (${pag.map(esc).join(', ')})`);
      for (const { r, nuevos } of filas) if (nuevos.filter(i => r.tipo === tipo).length && r.variante !== 'sin_tipo') problemas.push(`"${NOMBRE_VARIANTE[r.variante]}" trae ${nuevos.length} que la consulta normal no trae`);
    }
    const nombre = tipo === 'BASE' ? 'Bases' : 'Productos terminados';
    const det = (t, o) => o?.n ? `<details class="defs"><summary>${t} (${o.n})</summary><ul class="small">${o.ej.map(x => `<li>${esc(x.join(' · '))}</li>`).join('')}</ul></details>` : '';
    return `<section class="panel panel-pad" style="margin-top:14px"><h3 style="margin:0 0 6px">${nombre}: ${problemas.length ? `<span class="txt-neg">${problemas.length} cosa${problemas.length > 1 ? 's' : ''} para revisar</span>` : '<span class="txt-pos">coincide todo</span>'}</h3>
      ${base && !base.error ? `<p class="small" style="margin:0 0 8px">Shares mandó <b>${base.n}</b> · la app tiene <b>${base.guardadas_activas}</b> activas · última sincronización ${base.ultima_sync ? fmtFH(base.ultima_sync) : '—'} · respuesta en ${(base.ms / 1000).toFixed(1)} s, ${Math.round(base.bytes / 1024)} KB</p>
        <p class="small muted" style="margin:0 0 8px">La respuesta trae: ${(base.claves || []).map(k => `<code>${esc(k)}</code>${base.meta?.[k] ? ` = ${esc(base.meta[k])}` : ''}`).join(' · ')}</p>
        ${Object.keys(base.estados || {}).length ? `<p class="small muted" style="margin:0 0 8px">Campos de estado en cada receta: ${Object.entries(base.estados).map(([k, v]) => `<code>${esc(k)}</code> ${Object.entries(v).map(([a, b]) => `${esc(a)}: ${b}`).join(', ')}`).join(' · ')}</p>` : '<p class="small muted" style="margin:0 0 8px">Las recetas no traen ningún campo de activo / inactivo.</p>'}` : ''}
      ${problemas.length ? `<ul class="small txt-neg" style="margin:0 0 8px">${problemas.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
      ${base?.solo_orden?.n ? `<p class="small muted" style="margin:0 0 8px">${base.solo_orden.n} receta${base.solo_orden.n > 1 ? 's' : ''} llegaron con los mismos renglones en otro orden (Shares no siempre los manda igual): no cambia nada.</p>` : ''}
      ${det('Están en Shares y no en la app', base?.faltan_en_app)}${det('Están en la app y Shares ya no las manda', base?.sobran_en_app)}${det('Costo distinto', base?.costos_distintos)}${det('Receta distinta', base?.recetas_distintas)}
      <div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Otra forma de pedir</th><th>HTTP</th><th class="num">Recetas</th><th class="num">Nuevas</th><th>Qué devolvió</th></tr></thead><tbody>
        ${filas.map(({ r, nuevos }) => `<tr><td>${esc(NOMBRE_VARIANTE[r.variante] || r.variante)}<small class="sub-celda mono">${esc(r.ruta || '')}</small></td><td>${r.error ? '—' : r.status}</td><td class="num">${r.n ?? '—'}</td>
          <td class="num ${nuevos.length && r.variante !== 'sin_tipo' ? 'txt-neg' : ''}">${r.ids && r.variante !== 'sin_tipo' ? nuevos.length : '—'}</td><td class="small">${r.error ? esc(r.error) : r.n == null ? esc(r.texto || r.data_tipo || '') : r.variante === 'sin_tipo' ? `tipos: ${Object.entries(r.tipos || {}).map(([a, b]) => `${esc(a)} ${b}`).join(', ')}` : sameIds(r.ids, base?.ids) ? 'las mismas que la normal' : 'distinto a la normal'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  });
  return porTipo.join('') + `<div class="acciones" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="ct-xls">${ICO.download}Descargar detalle</button></div>`;
}
const sameIds = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
function excelControl(res) {
  const filas = [['Tipo', 'Forma de pedir', 'Ruta', 'HTTP', 'Recetas', 'Sin código', 'Repetidas', 'Campos de la respuesta', 'Error']];
  for (const r of res) filas.push([r.tipo, NOMBRE_VARIANTE[r.variante] || r.variante, r.ruta || '', r.status ?? '', r.n ?? '', r.sin_id ?? '', r.repetidos ?? '', (r.claves || []).join(', '), r.error || '']);
  const dif = [['Tipo', 'Qué', 'Código', 'Nombre', 'Detalle']];
  for (const r of res.filter(x => x.variante === 'base' && !x.error)) for (const [k, t] of [['faltan_en_app', 'En Shares, no en la app'], ['sobran_en_app', 'En la app, no en Shares'], ['costos_distintos', 'Costo distinto'], ['recetas_distintas', 'Receta distinta']]) for (const e of r[k].ej) dif.push([r.tipo, t, e[0], e[1], e[2] || '']);
  descargarXlsx(`control-shares-${new Date().toISOString().slice(0, 10)}.xlsx`, [['Consultas', filas, [20, 26, 60, 8, 10, 10, 10, 40, 40]], ['Diferencias', dif, [20, 24, 10, 40, 50]]]);
}

// ---------------------------------------------------------------------------
//  Guía de uso
// ---------------------------------------------------------------------------
const PASOS_GUIA_C = [
  ['doc', 'Llegan las facturas', 'Cada 10 minutos la app trae de Facturas de proveedores las facturas de materia prima ya confirmadas (listas o cargadas en Shares).'],
  ['sparkle', 'Se leen los renglones', 'Gemini lee cada renglón: descripción, cantidad, unidad, precio, bonificación e importe. Todo neto, sin IVA.'],
  ['link', 'Vinculás una vez', 'La primera vez que aparece una descripción de un proveedor decís qué insumo es y cuánto trae. Después se reconoce sola.'],
  ['chart', 'Precio y alertas', 'Cada compra queda como $ por kg, litro o unidad. Si un proveedor sube, se paga más que el promedio u otro vende más barato, hay alerta.'],
  ['balanza', 'Contra Shares', 'Una vez por día se traen las recetas de Shares. Cada insumo unido compara el costo que usa Shares con lo que realmente se pagó.'],
];
async function vistaGuia(el) {
  const tarjeta = (ico, t, d) => `<div class="guia-al">${ico}<div><div class="t">${t}</div><p>${d}</p></div></div>`;
  el.innerHTML = `<div class="encabezado"><div><h1>Guía de uso</h1><p>De dónde salen los precios, qué hay que hacer y cómo leer cada pantalla.</p></div></div>
    <div class="panel"><div class="panel-titulo"><h2>Cómo funciona</h2></div>
      <ol class="pasos-guia">${PASOS_GUIA_C.map(([ic, t, d], i) => `<li><span class="num-paso">${ICO[ic]}<b>${i + 1}</b></span><div><div class="t">${esc(t)}</div><p>${esc(d)}</p></div></li>`).join('')}</ol></div>

    <div class="dos" style="margin-top:16px">
      <div class="panel"><div class="panel-titulo"><h2>Lo único que hay que hacer</h2></div><div class="panel-pad guia-txt">
        <p><b>Vincular</b> (en <a href="#/vincular">Para vincular</a>): cada descripción nueva de un proveedor, por ejemplo “CREMA 35% BIDON 5 LTS”. Casi siempre alcanza con tocar <b>Confirmar</b> sobre la sugerencia.</p>
        <p><b>Insumo:</b> el nombre genérico, sin marca ni presentación. La crema de dos proveedores es el mismo insumo: así se comparan.</p>
        <p><b>Cuánto trae:</b> lleva el precio a $ por kg, litro o unidad. Bolsa × 25 kg → 25. Si ya se factura por kg → 1.</p>
        <p><b>No es insumo:</b> fletes, servicios y descuentos se ignoran.</p>
        <p><b>Unir con Shares</b> (en <a href="#/comparar">Shares vs compras</a>): una sola vez por insumo, para compararlo con su materia prima de Shares.</p></div></div>
      <div class="panel"><div class="panel-titulo"><h2>Cómo leer los precios</h2></div><div class="panel-pad guia-txt">
        <p><b>Netos y sin IVA</b>, en pesos. Las facturas en dólares se pasan con la cotización de la factura.</p>
        <p><b>Con las bonificaciones descontadas:</b> la de cada renglón y también la general al pie (“Bonificación 20 %”), que se reparte entre los productos. Se muestra en verde.</p>
        <p><b>vs. anterior:</b> contra la compra anterior <b>al mismo proveedor</b>.</p>
        <p><b>vs. promedio:</b> contra el promedio ponderado por cantidad del período, de todos los proveedores.</p>
        <p><span class="var sube">▲ rojo</span> subió · <span class="var baja">▼ verde</span> bajó.</p></div></div>
    </div>

    <div class="panel"><div class="panel-titulo"><h2>Alertas</h2><span class="small muted">Los umbrales se cambian en Configuración → Ajustes</span></div>
      <div class="panel-pad guia-alertas">
        ${tarjeta('<span class="al-ico al-suba">▲</span>', 'Subió', 'El proveedor lo cobró más caro que en su compra anterior, por encima del umbral. Cada insumo puede tener su propio umbral.')}
        ${tarjeta('<span class="al-ico al-baja">▼</span>', 'Bajó', 'El proveedor lo cobró más barato que en su compra anterior (se puede apagar en Ajustes).')}
        ${tarjeta('<span class="al-ico al-sobre_promedio">≈</span>', 'Sobre el promedio', 'Se pagó por encima del promedio del período, contando todos los proveedores.')}
        ${tarjeta('<span class="al-ico al-mas_caro">$</span>', 'Otro proveedor más barato', 'Otro proveedor vendió el mismo insumo más barato en el período.')}
        ${tarjeta(`<span class="al-ico al-sobre_promedio">${ICO.balanza}</span>`, 'Shares desactualizado', 'La última compra quedó lejos del costo que usa Shares en las recetas: los productos que la usan están mal costeados.')}
      </div></div>

    <div class="dos">
      <div class="panel"><div class="panel-titulo"><h2>Recetas de Shares</h2></div><div class="panel-pad guia-txt">
        <p><b>Se traen solas</b> una vez por día, desde las 6 de la mañana. Si necesitás lo último: Configuración → Salud → <b>Traer ahora</b>.</p>
        <p><b>Costo total</b> = materia prima y bases + costo indirecto del rubro + packaging, por unidad del producto, como lo calcula Shares.</p>
        <p><b>Abierto a materia prima:</b> Shares informa una base como un insumo más. La app la abre en sus materias primas (y las bases de esas bases) para ver el peso real de cada una.</p>
        <p><b>Evolución:</b> Shares solo da el costo de hoy. La app guarda un registro cada vez que cambia, desde el primer día que se trajeron las recetas.</p></div></div>
      <div class="panel"><div class="panel-titulo"><h2>Shares vs compras</h2></div><div class="panel-pad guia-txt">
        <p><b>Compara</b> el costo de cada materia prima en Shares con el precio de la última compra del insumo unido.</p>
        <p><b>Si la compra está por encima</b>, Shares está costeando de menos: los productos que la usan están <b>subcosteados</b>.</p>
        <p><b>Equivalencia:</b> casi siempre 1 (los dos miden por kg o litro). Si Shares mide por caja o por gramo, se indica cuánto es en la unidad del insumo.</p>
        <p><b>Simulador:</b> cambiá una o varias materias primas, poné una suba general o tocá <b>Usar precios de la última compra</b> para ver cuánto cuesta cada producto de verdad. No toca nada en Shares.</p></div></div>
    </div>

    <div class="dos">
      <div class="panel"><div class="panel-titulo"><h2>Si algo no cierra</h2></div><div class="panel-pad guia-txt">
        <p><b>Factura “No cierra”:</b> la suma de los renglones no da el neto de la factura. Abrila desde <a href="#/facturas">Facturas leídas</a>, mirá el PDF y tocá <b>Volver a leer</b>.</p>
        <p><b>Una compra con otra presentación</b> (un bulto en vez de una unidad): corregila desde la ficha del insumo, con el lápiz del renglón.</p>
        <p><b>El mismo insumo creado dos veces:</b> en la ficha de uno, <b>Unir con otro</b>.</p></div></div>
      <div class="panel"><div class="panel-titulo"><h2>Atajos</h2></div><div class="panel-pad">
        <dl class="kv atajos guia-atajos"><dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Buscar un insumo o proveedor desde cualquier pantalla.</dd><dt><kbd>Esc</kbd></dt><dd>Cerrar una ventana.</dd><dt><kbd>Enter</kbd></dt><dd>En un buscador de insumos, elegir el resaltado.</dd></dl></div></div>
    </div>`;
}


// ---------------------------------------------------------------------------
//  Usuarios, ajustes y auditoría
// ---------------------------------------------------------------------------
async function adminUsuarios(el) {
  const aviso = `<div class="panel panel-pad" style="margin-bottom:14px"><h2 style="margin-bottom:6px">Los usuarios se administran desde el portal</h2>
    <p class="muted" style="margin:0 0 12px">Ahí se da acceso a Costos y se elige el rol de cada persona (consulta, editor o admin). Vale para todas las herramientas.</p>
    <a class="btn btn-negro" href="${PORTAL}" style="text-decoration:none">Abrir el portal</a></div>`;
  if (!LOGIN_VIEJO) { el.innerHTML = aviso; return; }
  await adminUsuariosViejo(el);
  el.insertAdjacentHTML('afterbegin', aviso + '<h3 style="margin:0 0 10px">Claves anteriores de Costos (se dejan de usar al terminar la migración)</h3>');
}

async function adminUsuariosViejo(el) {
  const r = await api('/api/usuarios');
  el.innerHTML = `<div class="acciones" style="margin-bottom:12px"><button class="btn btn-negro" id="b-nu">Nuevo usuario</button></div>
    <table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>2FA</th><th>Estado</th><th></th></tr></thead><tbody>
    ${r.usuarios.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td>
      <td><select data-rol="${u.id}">${['consulta', 'editor', 'admin'].map(x => `<option ${u.rol === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td>${u.totp_activo ? '<span class="badge b-ok">activo</span>' : '<span class="badge b-aviso">no</span>'}</td>
      <td>${u.activo ? 'Activo' : '<span class="muted">Inactivo</span>'}</td>
      <td class="acciones"><button class="btn btn-chico" data-pass="${u.id}">Resetear clave</button>${u.totp_activo ? `<button class="btn btn-chico" data-totp="${u.id}">Resetear 2FA</button>` : ''}<button class="btn btn-chico" data-act="${u.id}" data-v="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')}
    </tbody></table><p class="small muted">Roles: <b>consulta</b> ve precios y alertas · <b>editor</b> además vincula descripciones, crea y edita insumos y vuelve a leer facturas · <b>admin</b> todo, incluida la configuración.</p>`;
  const put = (id, body) => api('/api/usuarios/' + id, { method: 'PUT', body }).then(() => { toast('Guardado'); adminUsuarios(el); }).catch(e => toast(e.message, true));
  $$('[data-rol]', el).forEach(s => s.onchange = () => put(s.dataset.rol, { rol: s.value }));
  $$('[data-act]', el).forEach(b => b.onclick = () => put(b.dataset.act, { activo: b.dataset.v === '1' }));
  $$('[data-totp]', el).forEach(b => b.onclick = async () => await confirmar('¿Resetear el doble factor de este usuario?') && put(b.dataset.totp, { reset_totp: true }));
  $$('[data-pass]', el).forEach(b => b.onclick = async () => { const p = await pedirTexto({ titulo: 'Nueva contraseña', etiqueta: 'Contraseña (mínimo 10 caracteres)', boton: 'Guardar', minimo: 10 }); if (p) put(b.dataset.pass, { password: p }); });
  $('#b-nu', el).onclick = () => modal(`<h2>Nuevo usuario</h2><form id="f-nu">
      <div class="campo"><label>Nombre</label><input name="nombre" required></div>
      <div class="campo"><label>Email</label><input name="email" type="email" required></div>
      <div class="campo"><label>Rol</label><select name="rol"><option>consulta</option><option selected>editor</option><option>admin</option></select></div>
      <div class="campo"><label>Contraseña inicial</label><input name="password" type="text" minlength="10" required><div class="ayuda">Pasásela por un canal seguro; la puede cambiar en “Mi cuenta”.</div></div>
      <button class="btn btn-negro" type="submit">Crear</button></form>`, {
    alMontar: (m, cerrar) => { $('#f-nu', m).onsubmit = (e) => { e.preventDefault(); conBoton($('button', e.target), async () => { await api('/api/usuarios', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); cerrar(); toast('Usuario creado'); adminUsuarios(el); }); }; },
  });
}


async function adminConfig(el) {
  const r = await api('/api/config');
  const cfg = r.config, def = r.defaults;
  const igual = (k) => JSON.stringify(cfg[k]) === JSON.stringify(def[k]);
  const guardar = async (k, valor, { silencio = false } = {}) => {
    const x = await api('/api/config', { method: 'PUT', body: { clave: k, valor } });
    Object.assign(cfg, x.config);
    if (!silencio) toast(valor === null ? 'Volvió al valor original' : 'Guardado');
    return x;
  };
  const control = (it) => {
    const v = cfg[it.k];
    if (it.tipo === 'switch') return `<label class="switch"><input type="checkbox" data-sw="${it.k}" ${v ? 'checked' : ''} aria-label="${esc(it.t)}"><span></span></label><span class="sw-txt cfg-suf" data-swtxt="${it.k}">${esc(v ? (it.si || 'Activado') : (it.no || 'Apagado'))}</span>`;
    if (it.tipo === 'numero') return `${it.pre ? `<span class="muted">${it.pre}</span>` : ''}<input type="number" data-num="${it.k}" value="${esc(v)}" min="0" step="${it.step || 1}" inputmode="decimal"><span class="cfg-suf muted">${it.suf || ''}</span>`;
    if (it.tipo === 'opciones') return `<div class="seg" data-op="${it.k}">${it.ops.map(([val, txt]) => `<button type="button" data-v="${val}" class="${v === val ? 'on' : ''}">${txt}</button>`).join('')}</div>`;
    if (it.tipo === 'dia') return `<div class="seg" data-op="${it.k}" data-numerico="1">${DIAS_SEMANA.map(([val, txt]) => `<button type="button" data-v="${val}" class="${String(v) === val ? 'on' : ''}">${txt}</button>`).join('')}</div>`;
    if (it.tipo === 'tel') return `<span class="muted">${ICO.phone}</span><input data-tel="${it.k}" value="${esc(v || '')}" placeholder="5492235123456" inputmode="tel" style="width:190px"><button class="btn btn-chico" data-tel-ok="${it.k}">Guardar</button>`;
    return '';
  };
  const fila = (it) => `<div class="cfg-row" data-fila="${it.k}"><div><div class="t">${esc(it.t)} ${igual(it.k) || it.tipo === 'switch' ? '' : `<button class="btn-link small" data-reset="${it.k}">volver al original</button>`}</div><div class="d">${esc(it.d)}</div></div>
    <div class="cfg-ctrl">${control(it)}</div></div>`;
  el.innerHTML = `${CFG_UI.map(sec => `<section class="cfg-sec"><h3 class="cfg-h">${ICO[sec.ico]}${esc(sec.t)}</h3><div class="panel">${sec.items.map(fila).join('')}</div></section>`).join('')}
    <p class="small muted" style="margin-top:14px">Los cambios se guardan solos y quedan en Auditoría. Los mapeos técnicos de Shares no se tocan desde acá: se cambian con una versión nueva de la app.</p>`;
  const recargar = () => adminConfig(el);

  $$('[data-sw]', el).forEach(c => c.onchange = async () => {
    const it = CFG_UI.flatMap(x => x.items).find(x => x.k === c.dataset.sw);
    const msg = c.checked ? it.confirmarSi : it.confirmarNo;
    if (msg && !await confirmar(msg)) { c.checked = !c.checked; return; }
    try { await guardar(it.k, c.checked); $(`[data-swtxt="${it.k}"]`, el).textContent = c.checked ? (it.si || 'Activado') : (it.no || 'Apagado'); }
    catch (e) { c.checked = !c.checked; toast(e.message, true); }
  });
  $$('[data-num]', el).forEach(i => i.onchange = async () => {
    try { await guardar(i.dataset.num, Number(String(i.value).replace(',', '.'))); }
    catch (e) { i.value = cfg[i.dataset.num]; toast(e.message, true); }
  });
  $$('[data-op]', el).forEach(g => $$('button', g).forEach(b => b.onclick = async () => {
    const val = g.dataset.numerico ? Number(b.dataset.v) : b.dataset.v;
    try { await guardar(g.dataset.op, val); $$('button', g).forEach(x => x.classList.toggle('on', x === b)); }
    catch (e) { toast(e.message, true); }
  }));
  $$('[data-tel-ok]', el).forEach(b => b.onclick = () => conBoton(b, async () => { const i = $(`[data-tel="${b.dataset.telOk}"]`, el); const x = await guardar(b.dataset.telOk, i.value); i.value = x.config[b.dataset.telOk] || ''; }));
  $$('[data-reset]', el).forEach(b => b.onclick = async () => await confirmar('¿Volver al valor original?') && conBoton(b, async () => { await guardar(b.dataset.reset, null); recargar(); }));
}


async function adminAuditoria(el) {
  const r = await api('/api/auditoria');
  el.innerHTML = `<div class="tabla-wrap tabla-scroll" style="max-height:65vh"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Entidad</th><th>Acción</th><th>Campo</th><th>Antes → Después</th></tr></thead><tbody>
    ${r.auditoria.map(a => `<tr><td class="small mono">${fmtFH(a.ts)}</td><td class="small">${esc(a.usuario)}</td><td class="small">${a.entidad === 'insumo' ? `<a href="#/insumo/${esc(a.entidad_id)}">insumo #${esc(a.entidad_id)}</a>` : esc([a.entidad, a.entidad_id].filter(x => x != null && x !== '').join(' ') || '—')}</td><td class="small">${esc(a.accion)}</td><td class="small mono">${esc(a.campo || '')}</td><td class="small mono">${esc(String(a.valor_anterior ?? '').slice(0, 80))} → ${esc(String(a.valor_nuevo ?? '').slice(0, 80))}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------------------
//  Mi cuenta: contraseña y doble factor
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  Mi cuenta: contraseña y doble factor
// ---------------------------------------------------------------------------
async function vistaMiCuenta(el) {
  if (S.user.central) {
    el.innerHTML = `<div class="encabezado"><div><h1>Mi cuenta</h1><p>${esc(S.user.email)} · rol ${esc(S.user.rol)}</p></div></div>
      ${bloqueInstalar()}
      <div class="panel panel-pad" style="max-width:560px"><h2 style="margin-bottom:12px">Usuario y contraseña</h2>
        <p class="muted">Usás el mismo usuario en todas las herramientas de Lucciano's. La contraseña y los permisos se manejan desde el portal.</p>
        <a class="btn btn-negro" href="${PORTAL}" style="text-decoration:none">Ir al portal</a></div>`;
    montarInstalar(el);
    return;
  }
  el.innerHTML = `<div class="encabezado"><div><h1>Mi cuenta</h1><p>${esc(S.user.email)} · rol ${esc(S.user.rol)}</p></div></div>
    ${bloqueInstalar()}
    <div class="panel panel-pad" style="max-width:560px"><h2 style="margin-bottom:12px">Doble factor</h2>
      ${S.user.totp_activo ? '<p><span class="badge b-ok">Activo</span> Te vamos a pedir el código de tu app autenticadora al ingresar.</p>'
      : '<p class="muted">Usá Google Authenticator, Microsoft Authenticator o similar.</p><button class="btn btn-negro" id="b-2fa">Activar doble factor</button><div id="c-2fa"></div>'}
    </div>
    <form class="panel panel-pad" style="max-width:560px" id="f-pass"><h2 style="margin-bottom:12px">Cambiar contraseña</h2>
      <div class="campo"><label>Actual</label><input type="password" name="actual" required autocomplete="current-password"></div>
      <div class="campo"><label>Nueva (mínimo 10 caracteres)</label><input type="password" name="nueva" minlength="10" required autocomplete="new-password"></div>
      <button class="btn btn-negro" type="submit">Cambiar</button></form>`;
  $('#f-pass').onsubmit = (e) => { e.preventDefault(); conBoton($('button', e.target), async () => { await api('/api/yo/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Contraseña cambiada'); }); };
  montarInstalar(el);
  const b = $('#b-2fa');
  if (b) b.onclick = () => conBoton(b, async () => {
    const r = await api('/api/yo/totp/iniciar', { method: 'POST' });
    $('#c-2fa').innerHTML = `<p>1. Escaneá este QR con la app:</p><div id="qr" style="background:#fff;padding:12px;display:inline-block;border-radius:8px"></div>
      <p class="small muted">o cargá la clave a mano: <span class="mono">${esc(r.secret)}</span></p>
      <p>2. Escribí el código de 6 dígitos que muestra la app:</p><div class="fila"><input id="code" inputmode="numeric" maxlength="6" class="mono"><button class="btn btn-negro" id="b-conf">Confirmar</button></div>`;
    if (window.QRCode) new QRCode($('#qr'), { text: r.otpauth, width: 180, height: 180 });
    else $('#qr').textContent = r.otpauth;
    b.remove();
    $('#b-conf').onclick = () => conBoton($('#b-conf'), async () => { await api('/api/yo/totp/confirmar', { method: 'POST', body: { code: $('#code').value } }); S.user.totp_activo = true; toast('Doble factor activado'); vistaMiCuenta(el); });
  });
}



// ---------------------------------------------------------------------------
//  Ordenar cualquier tabla tocando el título de la columna (en toda la app).
//  Un toque: de mayor a menor (fechas e importes) o A→Z (texto). Otro toque: al revés.
//  Detecta solo si la columna es fecha, importe/número o texto. Se recuerda por pantalla.
// ---------------------------------------------------------------------------
const ORDEN = {
  // Una sola columna ordenada por tabla (la última que se tocó), recordada por pantalla
  clave: (th) => `orden:${location.hash.split('?')[0]}:${[...th.closest('table').querySelectorAll('thead th')].map(h => h.textContent.trim()).join('|')}`,
  valor(td) {
    if (!td) return { t: 'x', v: '' };
    if (td.dataset.orden != null) { const n = Number(td.dataset.orden); return isNaN(n) ? { t: 's', v: td.dataset.orden } : { t: 'n', v: n }; }
    // En celdas con avatar + nombre (proveedor) se usa el nombre, no las iniciales
    const base = td.querySelector('.prov b, b') || td;
    const txt = (base.innerText || base.textContent || '').trim().split('\n')[0].trim();
    let m = txt.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (m) { const a = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : '0000'; return { t: 'n', v: Number(a + m[2].padStart(2, '0') + m[1].padStart(2, '0')) }; }
    m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { t: 'n', v: Number(m[1] + m[2] + m[3]) };
    m = txt.replace(/\s/g, '').match(/^(-)?(?:US\$|U\$S|USD|DOL|EUR|\$)?(-)?([\d.]+(?:,\d+)?)(\s*[MK])?/i);
    if (m && /\d/.test(m[3]) && !/^\d{11}$/.test(m[3]) && !/^\d{2}-\d{8}-\d$/.test(txt)) {
      let v = Number(m[3].replace(/\./g, '').replace(',', '.'));
      if (/M/i.test(m[4] || '')) v *= 1e6; else if (/K/i.test(m[4] || '')) v *= 1e3;
      if (m[1] || m[2]) v = -v;
      if (isFinite(v)) return { t: 'n', v };
    }
    return { t: 's', v: txt.toLowerCase() };
  },
  aplicar(th, dir) {
    const tabla = th.closest('table'); const tb = tabla && tabla.tBodies[0]; if (!tb) return;
    const i = [...th.parentElement.children].indexOf(th);
    const filas = [...tb.rows].filter(r => r.cells.length > 1);
    if (filas.length < 2) return;
    const vals = filas.map(r => ({ r, k: ORDEN.valor(r.cells[i]) }));
    const num = vals.filter(x => x.k.t === 'n').length >= vals.filter(x => x.k.t === 's' && x.k.v).length;
    vals.sort((a, b) => {
      let c;
      if (num) c = (a.k.t === 'n' ? a.k.v : -Infinity) - (b.k.t === 'n' ? b.k.v : -Infinity);
      else c = String(a.k.v).localeCompare(String(b.k.v), 'es', { numeric: true });
      return dir === 'asc' ? c : -c;
    });
    vals.forEach(x => tb.appendChild(x.r));
    tabla.querySelectorAll('thead th').forEach(h => h.removeAttribute('data-dir'));
    th.dataset.dir = dir;
  },
  // Primer toque: fechas/importes de mayor a menor; texto de la A a la Z
  primero(th) {
    const tb = th.closest('table')?.tBodies[0]; if (!tb) return 'desc';
    const i = [...th.parentElement.children].indexOf(th);
    const ks = [...tb.rows].slice(0, 15).map(r => ORDEN.valor(r.cells[i]));
    return ks.filter(k => k.t === 'n').length >= ks.filter(k => k.t === 's' && k.v).length ? 'desc' : 'asc';
  },
  // No se ordenan las tablas agrupadas (filas de grupo con colspan): se desarmarían los grupos
  ordenable: (th) => th && th.closest('thead') && !th.querySelector('input,button,select') && th.textContent.trim() && th.closest('table')?.tBodies[0] && !th.closest('table').querySelector('tbody tr.grupo-prov, tbody td[colspan]:not(.vacio)') && !th.closest('table').classList.contains('sin-orden'),
};
document.addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!ORDEN.ordenable(th) || e.target.closest('input,button,select,a')) return;
  const dir = th.dataset.dir ? (th.dataset.dir === 'asc' ? 'desc' : 'asc') : ORDEN.primero(th);
  ORDEN.aplicar(th, dir);
  try { sessionStorage.setItem(ORDEN.clave(th), JSON.stringify({ i: [...th.parentElement.children].indexOf(th), dir })); } catch { }
});
// Las tablas que se dibujan de nuevo vuelven a quedar con el orden elegido
new MutationObserver(() => {
  clearTimeout(ORDEN._t);
  ORDEN._t = setTimeout(() => {
    document.querySelectorAll('table thead th').forEach(th => { if (ORDEN.ordenable(th)) th.classList.add('ordenable'); });
    document.querySelectorAll('table thead tr').forEach(tr => {
      const th0 = tr.querySelector('th.ordenable'); if (!th0) return;
      let g = null; try { g = JSON.parse(sessionStorage.getItem(ORDEN.clave(th0)) || 'null'); } catch { }
      const th = g && tr.children[g.i];
      if (th && ORDEN.ordenable(th) && th.dataset.dir !== g.dir) ORDEN.aplicar(th, g.dir);
    });
  }, 60);
}).observe(document.documentElement, { childList: true, subtree: true });



// =============================================================================
//  RECETAS DE SHARES (1.4.0)
//  El servidor guarda las recetas que trae de Shares una vez por día y su historial. Acá se hacen los
//  cálculos con el catálogo completo en memoria:
//   · explotarR(item): abre las bases de un producto hasta la última materia prima (Shares no lo hace).
//   · usosR(): en qué productos y bases se usa cada materia prima (directo o dentro de una base).
//   · simularR(item, cambios, general): costo nuevo si cambian los costos de materias primas.
//  Y el cruce con lo que ya hacía esta app: cada insumo se une con su materia prima de Shares para comparar
//  el costo que usa Shares con el precio real de la última compra.
// =============================================================================
Object.assign(ICO, {
  layers: svgI('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  flask: svgI('<path d="M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3"/><path d="M7 15h10"/>'),
  cono: svgI('<path d="M7 11a5 5 0 0 1 10 0"/><path d="M6 11h12l-6 11z"/>'),
  balanza: svgI('<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>'),
  download: svgI('<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  trash: svgI('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
});

const R = { cat: null, porKey: new Map(), mp: new Map(), ins: [], insPorMp: new Map(), expl: new Map(), usos: null, cambios: null };
const kItem = (tipo, id) => `${tipo}:${id}`;
const TIPO_TXT = { PRODUCTO_TERMINADO: 'Producto terminado', BASE: 'Base' };
const esLineaBaseR = (l) => /BASE/i.test(l.categoria || '') && R.porKey.has(kItem('BASE', l.id));
const recItems = (tipo) => (R.cat?.items || []).filter(i => !tipo || i.tipo === tipo);

// Formatos
const fmt4R = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const fmt6R = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
const $$u = (n) => { const x = Number(n); if (n === null || n === undefined || !Number.isFinite(x)) return '—'; return '$ ' + (Math.abs(x) >= 1 || x === 0 ? fmtNum.format(x) : fmt4R.format(x)); };
const fmtCantR = (n) => { const x = Number(n) || 0; return Math.abs(x) < 0.001 && x !== 0 ? fmt6R.format(x) : fmt4R.format(x); };
const pctTxt = (v, total) => total ? (v / total * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' %' : '—';
const varPctR = (antes, ahora) => (antes && Number(antes) ? (ahora - antes) / antes * 100 : null);
const chipVarR = (antes, ahora, titulo = '') => { const p = varPctR(antes, ahora); return p === null ? '<span class="muted">—</span>' : chipVar(p, { titulo: titulo || `Antes ${$$u(antes)}` }); };
const kpiR = (et, val, sub = '', { href = '', clase = '' } = {}) => href
  ? `<a class="kpi ${clase}" href="${href}"><div class="et">${et}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</a>`
  : `<div class="kpi ${clase}"><div class="et">${et}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
function descargarXlsx(nombre, hojas) {
  if (!window.XLSX) { toast('No cargó la librería de Excel. Revisá la conexión.', true); return; }
  const wb = XLSX.utils.book_new();
  for (const [titulo, filas, anchos] of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(filas);
    if (anchos) ws['!cols'] = anchos.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 31));
  }
  XLSX.writeFile(wb, nombre);
}
const irA = (el) => $$('tr[data-href], li[data-href]', el).forEach(x => { x.onclick = () => { location.hash = x.dataset.href; }; });

async function cargarRecetas(forzar = false) {
  if (R.cat && !forzar) return R.cat;
  const c = await api('/api/recetas/catalogo');
  R.cat = c;
  R.porKey = new Map(c.items.map(i => [kItem(i.tipo, i.id), i]));
  R.mp = new Map(c.mp.map(m => [m.id, m]));
  R.ins = c.insumos;
  R.insPorMp = new Map();
  for (const i of c.insumos) if (i.codigo_shares) { const k = Number(i.codigo_shares); R.insPorMp.set(k, [...(R.insPorMp.get(k) || []), i]); }
  R.expl = new Map(); R.usos = null; R.cambios = null;
  return c;
}

function explotarR(item, pila = new Set()) {
  const k = kItem(item.tipo, item.id);
  if (R.expl.has(k)) return R.expl.get(k);
  if (pila.has(k)) return { mp: new Map(), indirectoBases: 0, ajuste: 0 };
  pila.add(k);
  const mp = new Map();
  let indirectoBases = 0, ajuste = 0;
  const sumar = (id, den, categoria, cant, costo, origen) => {
    const e = mp.get(id) || { id, denominacion: den, categoria, cantidad: 0, costo: 0, origenes: new Set() };
    e.cantidad += cant; e.costo += costo; e.origenes.add(origen); mp.set(id, e);
  };
  // Rendimiento: Shares a veces carga la receta para un lote (ej. 1,2 kg de avella → 6 frascos) y en la cabecera
  // informa el costo POR UNIDAD (costoReceta = Σ renglones / 6), pero la API no manda el rendimiento. Se deduce:
  // escala = costoReceta / Σ(cantidad × costo), aplicada a cantidades y costos de la receta (no al packaging, que
  // Shares ya da por unidad). Así la apertura a materia prima siempre suma exactamente el costo de Shares. Sin esto, el
  // simulador y la "apertura a materia prima" salían multiplicados (Avella Pistacchio frasco: +10 % general daba +45 %).
  // Si la diferencia es de más de 0,5 % se trata como receta cargada por lote (se avisa); si es menor, es redondeo de Shares.
  const sumaLineas = (item.receta || []).reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);
  const escala = item.costoReceta > 0 && sumaLineas > 0 ? item.costoReceta / sumaLineas : 1;
  const lote = Math.abs(escala - 1) > 0.005;
  for (const l of item.receta || []) {
    const q = l.cantidad * escala;
    if (esLineaBaseR(l)) {
      const base = R.porKey.get(kItem('BASE', l.id));
      const sub = explotarR(base, pila);
      for (const e of sub.mp.values()) sumar(e.id, e.denominacion, e.categoria, e.cantidad * q, e.costo * q, 'base');
      const ind = (base.costoIndirecto + sub.indirectoBases) * q;
      indirectoBases += ind;
      const explotado = [...sub.mp.values()].reduce((s, e) => s + e.costo, 0) * q + ind;
      // q·costo de la línea − lo explotado ya incluye el ajuste propio de la base (antes se sumaba dos veces)
      ajuste += q * l.costo - explotado;
    } else sumar(l.id, l.denominacion, l.categoria, q, q * l.costo, 'directo');
  }
  for (const l of item.packaging || []) sumar(l.id, l.denominacion, 'PACKAGING', l.cantidad, l.cantidad * l.costo, 'directo');
  pila.delete(k);
  const r = { mp, indirectoBases, ajuste, escala, lote, rendimiento: lote ? 1 / escala : 1 };
  R.expl.set(k, r);
  return r;
}
function usosR() {
  if (R.usos) return R.usos;
  const mp = new Map(), bases = new Map();
  for (const it of recItems()) {
    for (const e of explotarR(it).mp.values()) {
      const l = mp.get(e.id) || [];
      l.push({ item: it, cantidad: e.cantidad, costo: e.costo, directo: e.origenes.has('directo'), viaBase: e.origenes.has('base') });
      mp.set(e.id, l);
    }
    const esc_ = explotarR(it).escala || 1;
    for (const l of it.receta || []) if (esLineaBaseR(l)) { const u = bases.get(l.id) || []; u.push({ item: it, cantidad: l.cantidad * esc_, costo: l.cantidad * l.costo * esc_ }); bases.set(l.id, u); }
  }
  R.usos = { mp, bases };
  return R.usos;
}
// La variación de cada materia prima se aplica sobre lo que ESA materia prima cuesta DENTRO de esta receta (e.costo),
// no sobre su costo "habitual" en Shares: hay materias primas que Shares valúa distinto en distintas recetas (otra
// unidad: kg en una, gramo en otra). Un costo nuevo cargado en $ se toma como variación % contra el costo habitual.
// Así, una suba general del 3% nunca puede mover un producto más de 3%.
function simularR(item, cambios, general = 0) {
  let delta = 0;
  for (const e of explotarR(item).mp.values()) {
    const m = R.mp.get(e.id);
    let factor = 1 + general / 100;
    if (cambios.has(e.id)) {
      const nuevo = cambios.get(e.id);
      if (m && m.costo > 0) factor = nuevo / m.costo;
      else { delta += e.cantidad * nuevo - e.costo; continue; }   // sin costo de referencia: se reemplaza el precio
    }
    delta += e.costo * (factor - 1);
  }
  return { actual: item.costoTotal, nuevo: item.costoTotal + delta, delta, pct: item.costoTotal ? delta / item.costoTotal * 100 : 0 };
}
async function cargarCambiosR(dias = 30) {
  const desde = new Date(Date.now() - 3 * 3600e3 - dias * 864e5).toISOString().slice(0, 10);
  if (R.cambios?.desde === desde) return R.cambios;
  const r = await api('/api/recetas/cambios?desde=' + desde);
  R.cambios = { desde, historial_desde: r.historial_desde, items: new Map(r.items.map(x => [kItem(x.tipo, x.id), x])), mp: new Map(r.mp.map(x => [x.id, x])) };
  return R.cambios;
}

// Precio real (última compra) de una materia prima de Shares, en la unidad de Shares
function precioRealMp(mpId) {
  const ins = (R.insPorMp.get(Number(mpId)) || []).filter(i => i.ult_precio);
  if (!ins.length) return null;
  const i = ins.sort((a, b) => String(b.ult_fecha || '').localeCompare(String(a.ult_fecha || '')))[0];
  return { insumo: i, precio: i.ult_precio * (Number(i.shares_factor) || 1) };
}

// Parecido entre dos nombres (para sugerir la unión insumo ↔ materia prima de Shares)
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'con', 'sin', 'por', 'para', 'kg', 'kgs', 'lt', 'lts', 'gr', 'grs', 'x', 'un', 'unid', 'bolsa', 'caja', 'bidon', 'pack']);
const palabras = (s) => new Set(normQ(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w)));
function parecido(a, b) {
  const A = palabras(a), B = palabras(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w) || [...B].some(x => x.length >= 5 && w.length >= 5 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))))) n++;
  return n / Math.max(A.size, B.size);
}
function sugerenciasMp(nombre, n = 6) {
  return [...R.mp.values()].map(m => ({ m, s: parecido(nombre, m.denominacion) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n);
}

// Graficos y piezas
function graficoLineaR(puntos, { alto = 180 } = {}) {
  if (!puntos.length) return '<div class="vacio">Sin historial todavía.</div>';
  const hoy = new Date().toISOString().slice(0, 10);
  const pts = puntos.map(p => ({ t: Date.parse(p.fecha + 'T12:00:00Z'), v: Number(p.valor) || 0, fecha: p.fecha }));
  if (pts[pts.length - 1].fecha < hoy) pts.push({ t: Date.parse(hoy + 'T12:00:00Z'), v: pts[pts.length - 1].v, fecha: hoy, fin: true });
  if (pts.length === 1) pts.push({ ...pts[0], t: pts[0].t + 864e5, fin: true });
  const W = 640, H = alto, pl = 74, pr = 14, pt = 14, pb = 26;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let v0 = Math.min(...pts.map(p => p.v)), v1 = Math.max(...pts.map(p => p.v));
  if (v0 === v1) { v0 = v0 * 0.95; v1 = v1 * 1.05 || 1; }
  const pad = (v1 - v0) * 0.12; v0 -= pad; v1 += pad;
  const X = (t) => pl + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - v0) / (v1 - v0)) * (H - pt - pb);
  let d = `M${X(pts[0].t)},${Y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].t)} V${Y(pts[i].v)}`;
  const marcas = pts.filter(p => !p.fin).map(p => `<circle cx="${X(p.t)}" cy="${Y(p.v)}" r="3.5" fill="var(--accent)"><title>${fmtF(p.fecha)}: ${$$u(p.v)}</title></circle>`).join('');
  const ejeY = [v0 + pad, (v0 + v1) / 2, v1 - pad].map(v => `<text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc($$u(v))}</text><line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolución del costo" style="display:block;max-width:100%">${ejeY}<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>${marcas}
    <text x="${pl}" y="${H - 6}" font-size="11" fill="var(--muted)">${fmtF(pts[0].fecha)}</text><text x="${W - pr}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="end">hoy</text></svg>`;
}
// Composición del costo. El "costo de receta" de Shares incluye el costo indirecto de las bases que usa: se separa,
// para que el % de materia prima no salga inflado.
const sumaLineasR = (it) => (it.receta || []).reduce((s, l) => s + l.cantidad * l.costo, 0);
function barraComposicionR(it, ex = explotarR(it)) {
  const tot = it.costoTotal || 0, indB = ex.indirectoBases || 0;
  const partes = [['Materia prima', it.costoReceta - indB, 'var(--accent)'], ['Indirecto de las bases', indB, 'var(--warn-2, #d9a441)'], ['Costo indirecto', it.costoIndirecto, 'var(--warn)'], ['Packaging', it.costoPackaging, 'var(--ink)']].filter(p => p[1] > 0.005);
  if (!tot) return '';
  return `<div style="display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--surface-2)">${partes.map(p => `<span title="${p[0]}" style="width:${p[1] / tot * 100}%;background:${p[2]}"></span>`).join('')}</div>
    <div class="chips" style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">${partes.map(p => `<span class="small"><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${p[2]};margin-right:5px"></i>${p[0]} ${pctTxt(p[1], tot)}</span>`).join('')}</div>`;
}
const PERIODOS_R = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [365, '1 año']];
const selPeriodo = (id, dias) => `<select id="${id}" aria-label="Período">${PERIODOS_R.map(([d, t]) => `<option value="${d}" ${d === dias ? 'selected' : ''}>Variación: últimos ${t}</option>`).join('')}</select>`;
const avisoHistorialR = (ch) => ch.historial_desde && ch.historial_desde > ch.desde
  ? `<p class="aviso-linea">${ICO.info}<span>Las variaciones se miden desde el ${fmtF(ch.historial_desde)}, la primera vez que se trajeron las recetas de Shares.</span></p>` : '';

function sinRecetas(el, titulo) {
  const s = R.cat?.sync || {};
  el.innerHTML = `<div class="encabezado"><div><h1>${titulo}</h1></div></div><div class="panel panel-pad"><h2 style="margin-bottom:6px">Todavía no hay recetas de Shares</h2>
    <p class="muted" style="margin:0 0 12px">${s.shares ? 'La app trae las recetas sola una vez por día, desde las 6 de la mañana. Si querés verlas ya, traelas a mano.' : 'Falta cargar SHARES_USERNAME y SHARES_PASSWORD en el Worker de costos (Cloudflare → Settings → Variables and Secrets).'}</p>
    ${s.shares && puede('editor') ? `<button class="btn btn-acento" id="b-traer">${ICO.download}Traer recetas desde Shares</button>` : ''}</div>`;
  const b = $('#b-traer', el); if (b) b.onclick = () => traerRecetas(b);
}
// Trae de Shares los dos tipos, de a uno (cada pedido trae un tipo: así no se pasa del tiempo de procesador del plan gratuito)
async function traerRecetas(boton, forzar = false) {
  await conBoton(boton, async () => {
    toast('Trayendo recetas desde Shares…');
    const r1 = await api('/api/recetas/sincronizar', { method: 'POST', body: { tipo: 'PRODUCTO_TERMINADO', forzar } });
    const r2 = await api('/api/recetas/sincronizar', { method: 'POST', body: { tipo: 'BASE', forzar } });
    await cargarRecetas(true);
    if (r1.salteada && r2.salteada) toast('Ya estaba actualizado (hace menos de 5 minutos).');
    else toast(`✓ ${r1.cantidad} productos y ${r2.cantidad} bases${r1.primera ? '' : ` · ${(r1.cambios || 0) + (r2.cambios || 0)} cambios de costo`}`);
    await router();
  });
}

// ---------------------------------------------------------------------------
//  Productos terminados y bases
// ---------------------------------------------------------------------------
async function vistaRecLista(el, tipo) {
  await cargarRecetas();
  const esPT = tipo === 'PRODUCTO_TERMINADO', titulo = esPT ? 'Productos terminados' : 'Bases';
  const lista = recItems(tipo);
  if (!lista.length) return sinRecetas(el, titulo);
  const rubros = [...new Set(lista.map(i => i.rubro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  let q = '', qmp = '', rubro = sessionStorage.getItem('rubro_' + tipo) || '', dias = Number(sessionStorage.getItem('rec_periodo')) || 30, ch;
  // Productos que llevan alguna materia prima cuyo nombre contiene el texto (directa o dentro de una base)
  const conMp = (txt) => { const t = normQ(txt).trim(); if (!t) return null; const set = new Set(); for (const [id, us] of usosR().mp) { const m = R.mp.get(id); if (m && normQ(m.denominacion).includes(t)) for (const x of us) set.add(x.item); } return set; };
  el.innerHTML = `<div class="encabezado"><div><h1>${titulo}</h1><p>${esPT ? 'Costo de cada producto según Shares: materia prima y bases, costo indirecto del rubro y packaging.' : 'Recetas intermedias que se usan dentro de los productos (y a veces dentro de otras bases).'} Tocá uno para ver su receta.</p></div>
    <div class="acciones"><button class="btn" id="b-exp">${ICO.download}Descargar Excel</button></div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Nombre o código"></label>
      <label class="campo-buscar campo-mp" title="Muestra solo los que llevan esa materia prima, directa o dentro de una base">${ICO.layers}<input id="q-mp" placeholder="Que lleve… (ej. pistacho)" list="dl-mp"></label><datalist id="dl-mp">${[...usosR().mp.keys()].map(id => R.mp.get(id)).filter(Boolean).sort((a, b) => a.denominacion.localeCompare(b.denominacion, 'es')).map(m => `<option value="${esc(m.denominacion)}">`).join('')}</datalist>
      <select id="f-r"><option value="">Todos los rubros</option>${rubros.map(r => `<option ${r === rubro ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>${selPeriodo('f-p', dias)}</div>
      <div class="tabla-wrap"><table><thead><tr><th>Código</th><th>${esPT ? 'Producto' : 'Base'}</th><th>Rubro</th><th class="num">Costo total</th><th class="num">Materia prima</th><th class="num">Indirecto</th>${esPT ? '<th class="num">Packaging</th>' : ''}<th class="num">Variación</th></tr></thead><tbody id="tb"></tbody></table></div>
      <div class="paginacion" id="pag"></div></div>`;
  const pintar = async () => {
    ch = await cargarCambiosR(dias);
    const qq = normQ(q);
    const lleva = conMp(qmp);
    const f = lista.filter(i => (!rubro || i.rubro === rubro) && (!lleva || lleva.has(i)) && (!qq || normQ(i.denominacion).includes(qq) || String(i.id) === qq.trim()));
    $('#tb').innerHTML = f.map(i => { const a = ch.items.get(kItem(i.tipo, i.id)); const p = varPctR(a?.costoTotal, i.costoTotal);
      return `<tr class="click" data-href="#/receta/${i.tipo}/${i.id}"><td class="mono">${i.id}</td><td>${esc(i.denominacion)}</td><td class="small">${esc(i.rubro || '—')}</td>
        <td class="num" data-orden="${i.costoTotal}"><b>${$$m(i.costoTotal)}</b></td><td class="num" data-orden="${i.costoReceta}">${$$m(i.costoReceta)}</td><td class="num" data-orden="${i.costoIndirecto}">${$$m(i.costoIndirecto)}</td>
        ${esPT ? `<td class="num" data-orden="${i.costoPackaging}">${$$m(i.costoPackaging)}</td>` : ''}<td class="num" data-orden="${p ?? ''}">${chipVarR(a?.costoTotal, i.costoTotal)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="vacio">Nada con ese filtro.</td></tr>';
    $('#pag').innerHTML = `<span>${f.length} de ${lista.length}</span>${ch.historial_desde && ch.historial_desde > ch.desde ? `<span class="small muted">Variación desde el ${fmtF(ch.historial_desde)} (inicio del historial)</span>` : ''}`;
    irA($('#tb'));
  };
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; pintar(); }, 200); };
  $('#q-mp').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { qmp = e.target.value; pintar(); }, 250); };
  $('#f-r').onchange = (e) => { rubro = e.target.value; sessionStorage.setItem('rubro_' + tipo, rubro); pintar(); };
  $('#f-p').onchange = (e) => { dias = Number(e.target.value); sessionStorage.setItem('rec_periodo', dias); pintar(); };
  $('#b-exp').onclick = () => {
    const filas = [['Código', esPT ? 'Producto' : 'Base', 'Rubro', 'Costo total', 'Materia prima y bases', 'Costo indirecto', ...(esPT ? ['Packaging'] : []), `Costo hace ${dias} días`, 'Variación %']];
    for (const i of lista) { const a = ch.items.get(kItem(i.tipo, i.id)); const p = varPctR(a?.costoTotal, i.costoTotal);
      filas.push([i.id, i.denominacion, i.rubro, i.costoTotal, i.costoReceta, i.costoIndirecto, ...(esPT ? [i.costoPackaging] : []), a?.costoTotal ?? '', p == null ? '' : Math.round(p * 100) / 100]); }
    descargarXlsx(`${esPT ? 'productos' : 'bases'}-costos.xlsx`, [[titulo, filas, [8, 40, 18, 14, 16, 14, 14, 14, 12]]]);
  };
  await pintar();
}

async function vistaRecItem(el, tipo, id) {
  await cargarRecetas();
  const it = R.porKey.get(kItem(tipo, Number(id)));
  if (!it) { el.innerHTML = '<div class="panel panel-pad">No existe (o ya no figura en Shares).</div>'; return; }
  const esPT = tipo === 'PRODUCTO_TERMINADO', ex = explotarR(it), tot = it.costoTotal || 0;
  const tieneBases = (it.receta || []).some(esLineaBaseR);
  const usadoEn = !esPT ? (usosR().bases.get(it.id) || []) : [];
  // Costo con precios reales: las materias primas unidas a un insumo, al precio de su última compra
  const reales = new Map();
  for (const e of ex.mp.values()) { const pr = precioRealMp(e.id); if (pr) reales.set(e.id, pr.precio); }
  const sReal = reales.size ? simularR(it, reales) : null;
  // Cobertura: qué parte del costo de materia prima tiene precio de compra real (el resto sigue con el costo de Shares)
  const costoMpTot = [...ex.mp.values()].reduce((s, e) => s + e.costo, 0);
  const cobertura = costoMpTot ? [...ex.mp.values()].filter(e => reales.has(e.id)).reduce((s, e) => s + e.costo, 0) / costoMpTot * 100 : 0;
  const filaLinea = (l, pack = false) => {
    const base = !pack && esLineaBaseR(l), sub = l.cantidad * l.costo * (pack ? 1 : ex.escala);
    const pr = !base ? precioRealMp(l.id) : null;
    return `<tr class="click" data-href="${base ? `#/receta/BASE/${l.id}` : `#/mp/${l.id}`}"><td class="mono">${l.id}</td><td>${esc(l.denominacion)}${base ? ' <span class="badge b-warn">base</span>' : ''}</td>
      <td class="num mono">${fmtCantR(l.cantidad * (pack ? 1 : ex.escala))}${!pack && ex.lote ? `<small class="sub-celda muted">${fmtCantR(l.cantidad)} por lote</small>` : ''}</td><td class="num">${$$u(l.costo)}${pr ? `<small class="sub-celda" title="Última compra de ${esc(pr.insumo.nombre)}">compra ${$$u(pr.precio)} ${chipVarR(l.costo, pr.precio)}</small>` : ''}</td>
      <td class="num"><b>${$$m(sub)}</b></td><td class="num">${pctTxt(sub, tot)}</td></tr>`;
  };
  const cab = '<thead><tr><th>Código</th><th>Insumo</th><th class="num">Cantidad</th><th class="num">Costo unitario</th><th class="num">Subtotal</th><th class="num">% del costo</th></tr></thead>';
  el.innerHTML = `<div class="encabezado"><div><a class="btn btn-ghost btn-chico" href="#/${esPT ? 'productos' : 'bases'}">${ICO.back}${esPT ? 'Productos terminados' : 'Bases'}</a>
      <h1 style="margin-top:6px">${esc(it.denominacion)}</h1><p>${TIPO_TXT[tipo]} ${it.id} · rubro ${esc(it.rubro || '—')} · costos según Shares</p></div>
    <div class="acciones"><button class="btn" id="b-exp">${ICO.download}Descargar receta</button><a class="btn" href="#/simulador" id="b-sim">${ICO.calc}Simular</a></div></div>
    <div class="kpis">
      ${kpiR('Costo total (Shares)', $$m(tot), esPT ? 'Por unidad del producto' : 'Por kg o unidad de la base')}
      ${kpiR('Materia prima y bases', $$m(it.costoReceta), pctTxt(it.costoReceta, tot) + ' del total')}
      ${kpiR('Costo indirecto', $$m(it.costoIndirecto), pctTxt(it.costoIndirecto, tot) + ' · del rubro')}
      ${sReal ? kpiR(cobertura >= 80 ? 'Con precios de compra' : 'Con precios de compra (parcial)', $$m(sReal.nuevo), `${chipVar(sReal.pct)} · ${reales.size} de ${ex.mp.size} materias primas con compra, ${fmtCant.format(Math.round(cobertura))} % del costo de materia prima`, { clase: Math.abs(sReal.pct) >= 5 ? 'alerta' : cobertura < 80 ? 'aviso' : '' })
        : esPT ? kpiR('Packaging', $$m(it.costoPackaging), pctTxt(it.costoPackaging, tot) + ' del total') : kpiR('Se usa en', usadoEn.length, 'productos o bases')}
    </div>
    ${ex.lote ? `<div class="panel panel-pad aviso-panel" style="margin-bottom:16px"><b class="con-ico-chico">${ICO.info}En Shares esta receta está cargada para un lote de ${fmtCant.format(Math.round(ex.rendimiento * 100) / 100)} unidades.</b>
      <div class="small muted">La suma de los renglones da ${$$m(sumaLineasR(it))} y Shares informa ${$$m(it.costoReceta)} por unidad. Las cantidades y subtotales de abajo ya están divididos por el lote. ${ex.rendimiento % 1 > 0.01 && ex.rendimiento % 1 < 0.99 ? 'El lote no es un número entero: conviene revisar la receta en Shares.' : ''}</div></div>` : ''}
    <div class="panel panel-pad" style="margin-bottom:16px">${barraComposicionR(it, ex)}</div>
    <div class="panel"><div class="panel-titulo"><h2>Receta</h2><span class="small muted">Tal como está en Shares · debajo del costo, la última compra si la materia prima está unida a un insumo</span></div>
      <div class="tabla-wrap"><table>${cab}<tbody>${(it.receta || []).map(l => filaLinea(l)).join('') || '<tr><td colspan="6" class="vacio">Sin renglones.</td></tr>'}</tbody></table></div></div>
    ${(it.packaging || []).length ? `<div class="panel"><div class="panel-titulo"><h2>Packaging</h2></div><div class="tabla-wrap"><table>${cab}<tbody>${it.packaging.map(l => filaLinea(l, true)).join('')}</tbody></table></div></div>` : ''}
    ${tieneBases ? `<div class="panel"><div class="panel-titulo"><h2>Abierto a materia prima</h2><span class="small muted">Las bases se abren en sus insumos, para ver cuánto pesa cada materia prima</span></div>
      <div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Materia prima</th><th class="num">Cantidad total</th><th class="num">Costo unitario</th><th class="num">Subtotal</th><th class="num">% del costo</th></tr></thead><tbody>
      ${[...ex.mp.values()].sort((a, b) => b.costo - a.costo).map(e => `<tr class="click" data-href="#/mp/${e.id}"><td class="mono">${e.id}</td><td>${esc(e.denominacion)}${e.categoria === 'PACKAGING' ? ' <span class="badge">packaging</span>' : ''}</td><td class="num mono">${fmtCantR(e.cantidad)}</td><td class="num">${$$u(e.cantidad ? e.costo / e.cantidad : 0)}</td><td class="num"><b>${$$m(e.costo)}</b></td><td class="num">${pctTxt(e.costo, tot)}</td></tr>`).join('')}
      ${ex.indirectoBases ? `<tr><td></td><td><i>Costo indirecto de las bases</i></td><td></td><td></td><td class="num">${$$m(ex.indirectoBases)}</td><td class="num">${pctTxt(ex.indirectoBases, tot)}</td></tr>` : ''}
      <tr><td></td><td><i>Costo indirecto del producto</i></td><td></td><td></td><td class="num">${$$m(it.costoIndirecto)}</td><td class="num">${pctTxt(it.costoIndirecto, tot)}</td></tr>
      ${Math.abs(ex.ajuste) >= 0.01 ? `<tr><td></td><td><i title="Diferencia entre el costo de la base que figura en esta receta y su costo actual en Shares">Ajuste por costo de bases</i></td><td></td><td></td><td class="num">${$$m(ex.ajuste)}</td><td class="num">${pctTxt(ex.ajuste, tot)}</td></tr>` : ''}
      </tbody></table></div></div>` : ''}
    ${!esPT ? `<div class="panel"><div class="panel-titulo"><h2>Dónde se usa esta base</h2></div>${usadoEn.length ? `<div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Producto / base</th><th class="num">Cantidad</th><th class="num">Costo en la receta</th><th class="num">% de su costo</th></tr></thead><tbody>
      ${usadoEn.sort((a, b) => b.costo - a.costo).map(u => `<tr class="click" data-href="#/receta/${u.item.tipo}/${u.item.id}"><td class="mono">${u.item.id}</td><td>${esc(u.item.denominacion)}<small class="sub-celda">${TIPO_TXT[u.item.tipo]}</small></td><td class="num mono">${fmtCantR(u.cantidad)}</td><td class="num">${$$m(u.costo)}</td><td class="num">${pctTxt(u.costo, u.item.costoTotal)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vacio">Ningún producto activo usa esta base.</div>'}</div>` : ''}
    <div class="panel"><div class="panel-titulo"><h2>Evolución del costo en Shares</h2><span class="small muted" id="h-ayuda"></span></div><div class="panel-pad" id="hist"><span class="cargando"></span></div></div>`;
  irA(el);
  $('#b-sim').onclick = () => sessionStorage.setItem('sim_filtro', it.denominacion);
  $('#b-exp').onclick = () => {
    const filas = [[`${TIPO_TXT[tipo]} ${it.id}`, it.denominacion], ['Rubro', it.rubro], ['Costo total', tot], ['Materia prima y bases', it.costoReceta], ['Costo indirecto', it.costoIndirecto], ['Packaging', it.costoPackaging], [],
      ['Sección', 'Código', 'Insumo', 'Categoría', 'Cantidad', 'Costo unitario', 'Subtotal', '% del costo']];
    for (const l of it.receta || []) { const q = l.cantidad * ex.escala; filas.push(['Receta', l.id, l.denominacion, l.categoria, q, l.costo, q * l.costo, tot ? q * l.costo / tot : '']); }
    if (ex.lote) filas.push([], ['Nota', `Shares carga la receta para un lote de ${Math.round(ex.rendimiento * 100) / 100} unidades; las cantidades están divididas por el lote.`]);
    for (const l of it.packaging || []) filas.push(['Packaging', l.id, l.denominacion, l.categoria, l.cantidad, l.costo, l.cantidad * l.costo, tot ? l.cantidad * l.costo / tot : '']);
    const hojas = [['Receta', filas, [14, 9, 40, 22, 12, 14, 14, 10]]];
    if (tieneBases) hojas.push(['Abierto a materia prima', [['Código', 'Materia prima', 'Cantidad total', 'Costo unitario', 'Subtotal', '% del costo'],
      ...[...ex.mp.values()].map(e => [e.id, e.denominacion, e.cantidad, e.cantidad ? e.costo / e.cantidad : 0, e.costo, tot ? e.costo / tot : '']),
      ['', 'Costo indirecto de las bases', '', '', ex.indirectoBases, ''], ['', 'Costo indirecto del producto', '', '', it.costoIndirecto, ''], ['', 'Ajuste por costo de bases', '', '', ex.ajuste, '']], [9, 40, 14, 14, 14, 10]]);
    descargarXlsx(`receta-${it.id}-${it.denominacion.slice(0, 40).replace(/[\\/:*?"<>|]/g, '')}.xlsx`, hojas);
  };
  const h = (await api(`/api/recetas/historial/${tipo}/${it.id}`)).historial;
  $('#hist').innerHTML = graficoLineaR(h.map(x => ({ fecha: x.fecha, valor: x.costo_total }))) + (h.length > 1 ? `<div class="tabla-wrap" style="margin-top:12px"><table class="sin-orden"><thead><tr><th>Desde</th><th class="num">Costo total</th><th class="num">Materia prima</th><th class="num">Indirecto</th>${esPT ? '<th class="num">Packaging</th>' : ''}<th class="num">Variación</th></tr></thead><tbody>
    ${h.map((x, i) => `<tr><td class="mono">${fmtF(x.fecha)}</td><td class="num">${$$m(x.costo_total)}</td><td class="num">${$$m(x.costo_receta)}</td><td class="num">${$$m(x.costo_indirecto)}</td>${esPT ? `<td class="num">${$$m(x.costo_packaging)}</td>` : ''}<td class="num">${i ? chipVarR(h[i - 1].costo_total, x.costo_total) : '<span class="muted">inicio</span>'}</td></tr>`).reverse().join('')}</tbody></table></div>` : '');
  $('#h-ayuda').textContent = h.length ? `Registrado desde el ${fmtF(h[0].fecha)}` : '';
}

// ---------------------------------------------------------------------------
//  Materias primas de Shares
// ---------------------------------------------------------------------------
async function vistaMPs(el) {
  await cargarRecetas();
  if (!R.cat.items.length) return sinRecetas(el, 'Materias primas de Shares');
  const u = usosR();
  const activas = [...R.mp.values()].filter(m => u.mp.has(m.id));
  let q = '', dias = Number(sessionStorage.getItem('rec_periodo')) || 30, solo = sessionStorage.getItem('mp_solo') || '', cat = sessionStorage.getItem('mp_cat') || '', ch;
  const cats = [...new Set(activas.map(m => m.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const umbral = S.cfg?.umbral_shares_pct || (S.cfg = (await api('/api/config').catch(() => ({ config: {} }))).config).umbral_shares_pct || 10;
  const lejos = (m) => { const pr = precioRealMp(m.id); return !!pr && Math.abs(varPctR(m.costo, pr.precio) ?? 0) >= umbral; };
  const nPT = (id) => (u.mp.get(id) || []).filter(x => x.item.tipo === 'PRODUCTO_TERMINADO').length;
  el.innerHTML = `<div class="encabezado"><div><h1>Materias primas de Shares</h1><p>El costo unitario que usa Shares en las recetas, en cuántos productos pesa y, si está unida a un insumo de esta app, el precio de la última compra.</p></div>
    <div class="acciones"><button class="btn" id="b-exp">${ICO.download}Descargar Excel</button></div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Nombre o código"></label>
      ${cats.length > 1 ? `<select id="f-cat"><option value="">Todas las categorías</option>${cats.map(x => `<option ${x === cat ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
      <select id="f-s"><option value="">Unidas y sin unir</option><option value="unidas" ${solo === 'unidas' ? 'selected' : ''}>Unidas a un insumo</option><option value="sin" ${solo === 'sin' ? 'selected' : ''}>Sin unir</option><option value="lejos" ${solo === 'lejos' ? 'selected' : ''}>Compra lejos de Shares (${umbral} % o más)</option></select>${selPeriodo('f-p', dias)}</div>
      <div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Materia prima</th><th class="num">Costo en Shares</th><th class="num">Última compra</th><th class="num">Compra vs Shares</th><th class="num">Productos</th><th class="num">Variación en Shares</th></tr></thead><tbody id="tb"></tbody></table></div>
      <div class="paginacion" id="pag"></div></div>`;
  const pintar = async () => {
    ch = await cargarCambiosR(dias);
    const qq = normQ(q);
    const f = activas.filter(m => (!qq || normQ(m.denominacion).includes(qq) || String(m.id) === qq.trim()) && (!cat || m.categoria === cat)
      && (!solo || (solo === 'lejos' ? lejos(m) : (solo === 'unidas') === R.insPorMp.has(m.id))));
    $('#tb').innerHTML = f.map(m => { const a = ch.mp.get(m.id), pr = precioRealMp(m.id), n = nPT(m.id), dif = pr ? varPctR(m.costo, pr.precio) : null;
      return `<tr class="click" data-href="#/mp/${m.id}"><td class="mono">${m.id}</td><td>${esc(m.denominacion)}${m.costos_distintos > 1 ? ' <span class="badge b-warn" title="Shares la valúa distinto según la receta">costos distintos</span>' : ''}${R.insPorMp.has(m.id) ? `<small class="sub-celda">${ICO.link} ${esc(R.insPorMp.get(m.id).map(i => i.nombre).join(', '))}</small>` : ''}</td>
        <td class="num" data-orden="${m.costo}"><b>${$$u(m.costo)}</b></td><td class="num" data-orden="${pr?.precio ?? ''}">${pr ? `${$$u(pr.precio)}<small class="sub-celda">${fmtF(pr.insumo.ult_fecha)}</small>` : '<span class="muted">—</span>'}</td>
        <td class="num" data-orden="${dif ?? ''}">${dif === null ? '<span class="muted">—</span>' : chipVar(dif, { titulo: 'Última compra contra el costo que usa Shares' })}</td>
        <td class="num" data-orden="${n}">${n || '<span class="muted">—</span>'}</td><td class="num" data-orden="${varPctR(a?.costo, m.costo) ?? ''}">${chipVarR(a?.costo, m.costo)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="vacio">Nada con ese filtro.</td></tr>';
    $('#pag').innerHTML = `<span>${f.length} de ${activas.length}</span>`;
    irA($('#tb'));
  };
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; pintar(); }, 200); };
  $('#f-s').onchange = (e) => { solo = e.target.value; sessionStorage.setItem('mp_solo', solo); pintar(); };
  if (cats.length < 2) cat = '';
  if ($('#f-cat')) $('#f-cat').onchange = (e) => { cat = e.target.value; sessionStorage.setItem('mp_cat', cat); pintar(); };
  $('#f-p').onchange = (e) => { dias = Number(e.target.value); sessionStorage.setItem('rec_periodo', dias); pintar(); };
  $('#b-exp').onclick = () => descargarXlsx('materias-primas-shares.xlsx', [['Materias primas', [['Código', 'Materia prima', 'Costo en Shares', 'Insumo unido', 'Última compra (unidad de Shares)', 'Fecha compra', 'Compra vs Shares %', 'Productos que la usan', `Costo Shares hace ${dias} días`],
    ...activas.map(m => { const a = ch.mp.get(m.id), pr = precioRealMp(m.id); return [m.id, m.denominacion, m.costo, pr?.insumo.nombre || '', pr?.precio ?? '', pr?.insumo.ult_fecha || '', pr ? Math.round(varPctR(m.costo, pr.precio) * 100) / 100 : '', nPT(m.id), a?.costo ?? '']; })], [9, 40, 14, 26, 16, 12, 12, 10, 14]]]);
  await pintar();
}

async function vistaMP(el, id) {
  await cargarRecetas();
  const m = R.mp.get(Number(id));
  if (!m) { el.innerHTML = '<div class="panel panel-pad">No existe (o ya no figura en ninguna receta).</div>'; return; }
  const lista = (usosR().mp.get(m.id) || []).sort((a, b) => (b.costo / (b.item.costoTotal || 1)) - (a.costo / (a.item.costoTotal || 1)));
  const pts = lista.filter(x => x.item.tipo === 'PRODUCTO_TERMINADO');
  const unidos = R.insPorMp.get(m.id) || [], pr = precioRealMp(m.id);
  el.innerHTML = `<div class="encabezado"><div><a class="btn btn-ghost btn-chico" href="#/mp">${ICO.back}Materias primas de Shares</a>
      <h1 style="margin-top:6px">${esc(m.denominacion)}</h1><p>Materia prima ${m.id} de Shares · ${esc(m.categoria || '')}</p></div>
    ${puede('editor') ? `<div class="acciones"><button class="btn btn-negro" id="b-unir">${ICO.link}${unidos.length ? 'Cambiar insumo unido' : 'Unir con un insumo'}</button></div>` : ''}</div>
    <div class="kpis">
      ${kpiR('Costo en Shares', $$u(m.costo), m.costos_distintos > 1 ? `<span class="txt-neg">Figura con ${m.costos_distintos} costos distintos según la receta (ver abajo)</span>` : 'Costo unitario de las recetas', m.costos_distintos > 1 ? { clase: 'aviso' } : {})}
      ${kpiR('Última compra', pr ? $$u(pr.precio) : '—', pr ? `${esc(pr.insumo.nombre)} · ${fmtF(pr.insumo.ult_fecha)} · ${esc(pr.insumo.ult_proveedor || '')}` : (unidos.length ? 'Sin compras todavía' : 'No está unida a un insumo'), pr ? { href: '#/insumo/' + pr.insumo.id } : {})}
      ${kpiR('Compra vs Shares', pr ? chipVar(varPctR(m.costo, pr.precio)) : '—', pr ? 'Si es positivo, Shares costea por debajo de lo que se paga' : '', pr && Math.abs(varPctR(m.costo, pr.precio)) >= (S.cfg?.umbral_shares_pct || 10) ? { clase: 'alerta' } : {})}
      ${kpiR('Productos que la usan', pts.length, `${lista.length - pts.length} bases`)}
    </div>
    <div class="panel panel-pad" style="margin-bottom:16px"><h2 style="margin-bottom:10px">¿Y si cambia el costo?</h2>
      <div class="fila" style="align-items:end;display:flex;gap:12px;flex-wrap:wrap"><div class="campo"><label for="s-pct">Variación %</label><input id="s-pct" type="number" step="0.1" placeholder="Ej. 10"></div>
        <div class="campo"><label for="s-nuevo">o costo nuevo</label><input id="s-nuevo" type="number" step="0.01" placeholder="${esc(String(m.costo))}"></div>
        ${pr ? `<div class="campo"><button class="btn" id="s-real">Usar la última compra (${esc($$u(pr.precio))})</button></div>` : ''}</div>
      <p class="small muted" id="s-res" style="margin:4px 0 0">Escribí un porcentaje o un costo nuevo y la tabla muestra cómo queda cada producto.</p></div>
    <div class="panel"><div class="panel-titulo"><h2>Dónde se usa</h2><span class="small muted">Directo en la receta o dentro de una base</span></div>
      ${lista.length ? `<div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Producto / base</th><th>Cómo</th><th class="num">Cantidad</th><th class="num">Costo unitario en la receta</th><th class="num">Costo en el producto</th><th class="num">% de su costo</th><th class="num">Costo nuevo</th><th class="num">Impacto</th></tr></thead><tbody>
      ${lista.map((u, i) => `<tr class="click" data-href="#/receta/${u.item.tipo}/${u.item.id}"><td class="mono">${u.item.id}</td><td>${esc(u.item.denominacion)}<small class="sub-celda">${TIPO_TXT[u.item.tipo]}</small></td>
        <td class="small">${u.directo && u.viaBase ? 'directo y en bases' : u.directo ? 'directo' : 'dentro de una base'}</td><td class="num mono">${fmtCantR(u.cantidad)}</td><td class="num">${(() => { const cu = u.cantidad ? u.costo / u.cantidad : 0, dist = m.costo && Math.abs(cu / m.costo - 1) > 0.02;
          return `${$$u(cu)}${dist ? `<small class="sub-celda txt-neg" title="Shares valúa esta materia prima distinto en esta receta (puede ser otra unidad: gramo en vez de kg). Conviene revisarlo en Shares.">distinto al habitual</small>` : ''}`; })()}</td><td class="num">${$$m(u.costo)}</td>
        <td class="num">${pctTxt(u.costo, u.item.costoTotal)}</td><td class="num" data-n="${i}">—</td><td class="num" data-p="${i}">—</td></tr>`).join('')}</tbody></table></div>` : '<div class="vacio">No figura en ninguna receta activa.</div>'}</div>
    <div class="panel"><div class="panel-titulo"><h2>Evolución del costo en Shares</h2></div><div class="panel-pad" id="hist"><span class="cargando"></span></div></div>`;
  irA(el);
  const recalcular = (nuevoForzado = null) => {
    const pct = parseFloat($('#s-pct').value), nt = parseFloat($('#s-nuevo').value);
    const nuevo = nuevoForzado ?? (Number.isFinite(nt) ? nt : (Number.isFinite(pct) ? m.costo * (1 + pct / 100) : null));
    lista.forEach((u, i) => {
      const n = $(`[data-n="${i}"]`), p = $(`[data-p="${i}"]`);
      if (nuevo == null) { n.textContent = '—'; p.textContent = '—'; return; }
      const s = simularR(u.item, new Map([[m.id, nuevo]]));
      n.textContent = $$m(s.nuevo); p.innerHTML = chipVar(s.pct);
    });
    $('#s-res').innerHTML = nuevo == null ? 'Escribí un porcentaje o un costo nuevo y la tabla muestra cómo queda cada producto.' : `Con la materia prima a <b>${$$u(nuevo)}</b> (${chipVar(varPctR(m.costo, nuevo))}). Solo cambia esta materia prima.`;
  };
  $('#s-pct').oninput = () => { $('#s-nuevo').value = ''; recalcular(); };
  $('#s-nuevo').oninput = () => { $('#s-pct').value = ''; recalcular(); };
  const br = $('#s-real'); if (br) br.onclick = () => { $('#s-pct').value = ''; $('#s-nuevo').value = Math.round(pr.precio * 100) / 100; recalcular(pr.precio); };
  const bu = $('#b-unir'); if (bu) bu.onclick = () => modalUnirDesdeMp(m);
  const h = (await api('/api/recetas/historial-mp/' + m.id)).historial;
  $('#hist').innerHTML = graficoLineaR(h.map(x => ({ fecha: x.fecha, valor: x.costo })));
}

// ---------------------------------------------------------------------------
//  Unir insumo ↔ materia prima de Shares
// ---------------------------------------------------------------------------
function formEquivalencia(ins, m, factor) {
  return `<div class="campo"><label>Equivalencia</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">1 unidad de Shares de <b>${esc(m?.denominacion || 'la materia prima')}</b> = <input name="shares_factor" type="number" step="any" min="0" value="${esc(factor ?? 1)}" style="width:110px"> ${esc(UNI[ins?.unidad] || 'kg')} de <b>${esc(ins?.nombre || 'el insumo')}</b></div>
    <div class="ayuda">Casi siempre es 1 (Shares y esta app miden por kg o litro). Si Shares mide por caja, bolsa o gramo, poné cuánto es en ${esc(UNI_C[ins?.unidad] || 'kg')}: así se compara el mismo peso.</div></div>`;
}
async function guardarUnion(insId, codigo, factor) {
  await api('/api/insumos/' + insId, { method: 'PUT', body: { codigo_shares: codigo, shares_factor: codigo ? (Number(factor) || 1) : null } });
  await cargarRecetas(true);
}
async function modalUnirDesdeInsumo(ins) {
  await cargarRecetas();
  if (!R.mp.size) { toast('Todavía no hay recetas de Shares: traelas desde Configuración → Salud.', true); return; }
  const sug = sugerenciasMp(ins.nombre);
  const ops = [...R.mp.values()].filter(m => usosR().mp.has(m.id)).sort((a, b) => a.denominacion.localeCompare(b.denominacion, 'es'));
  const actual = ins.codigo_shares ? Number(ins.codigo_shares) : (sug[0]?.m.id || '');
  modal(`<h2>Unir con Shares</h2><p class="muted" style="margin-top:-6px">¿Qué materia prima de Shares es <b>${esc(ins.nombre)}</b>? Así se compara el costo que usa Shares con el precio de la última compra.</p>
    <form id="f-us">${sug.length ? `<div class="campo"><label>Sugerencias por nombre</label><div class="chips" style="display:flex;gap:6px;flex-wrap:wrap">${sug.map(x => `<button type="button" class="btn btn-chico" data-sug="${x.m.id}">${esc(x.m.denominacion)} · ${$$u(x.m.costo)}</button>`).join('')}</div></div>` : ''}
    <div class="campo"><label>Materia prima de Shares</label><select id="us-mp">${ops.map(m => `<option value="${m.id}" data-nombre="${esc(m.denominacion)}" data-extra="${m.id} · ${esc($$u(m.costo))}" ${m.id === actual ? 'selected' : ''}>${esc(m.denominacion)}</option>`).join('')}</select></div>
    ${formEquivalencia(ins, null, ins.shares_factor || 1)}
    <div class="acciones" style="justify-content:space-between">${ins.codigo_shares ? '<button type="button" class="btn btn-rojo" id="us-quitar">Quitar la unión</button>' : '<span></span>'}<button class="btn btn-negro" type="submit">Unir</button></div></form>`, {
    ancho: true,
    alMontar: (el, cerrar) => {
      const sel = $('#us-mp', el); comboSelect(sel, { placeholder: 'Escribí para buscar la materia prima…' });
      $$('[data-sug]', el).forEach(b => b.onclick = () => { sel.value = b.dataset.sug; const c = $('.combo-in', el); if (c) c.value = R.mp.get(Number(b.dataset.sug))?.denominacion || ''; });
      $('#f-us', el).onsubmit = (e) => { e.preventDefault(); conBoton($('button[type=submit]', e.target), async () => { await guardarUnion(ins.id, sel.value, e.target.elements.shares_factor.value); cerrar(); toast('Unido con Shares'); router(); }); };
      const q = $('#us-quitar', el); if (q) q.onclick = () => conBoton(q, async () => { await guardarUnion(ins.id, null, null); cerrar(); toast('Unión quitada'); router(); });
    },
  });
}
async function modalUnirDesdeMp(m) {
  const r = await api('/api/insumos');
  const ins = r.insumos.filter(i => i.activo);
  const sug = ins.map(i => ({ i, s: parecido(m.denominacion, i.nombre) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6);
  const actual = (R.insPorMp.get(m.id) || [])[0]?.id || sug[0]?.i.id || '';
  modal(`<h2>Unir con un insumo</h2><p class="muted" style="margin-top:-6px">¿Qué insumo de esta app es <b>${esc(m.denominacion)}</b> de Shares? Sus compras se comparan con el costo que usa Shares.</p>
    <form id="f-um">${sug.length ? `<div class="campo"><label>Sugerencias por nombre</label><div class="chips" style="display:flex;gap:6px;flex-wrap:wrap">${sug.map(x => `<button type="button" class="btn btn-chico" data-sug="${x.i.id}">${esc(x.i.nombre)}${x.i.ult_precio ? ' · ' + esc($$u(x.i.ult_precio)) : ''}</button>`).join('')}</div></div>` : ''}
    <div class="campo"><label>Insumo</label><select id="um-ins">${ins.map(i => `<option value="${i.id}" data-nombre="${esc(i.nombre)}" data-extra="${esc(UNI_C[i.unidad])}${i.rubro ? ' · ' + esc(i.rubro) : ''}" ${i.id === actual ? 'selected' : ''}>${esc(i.nombre)}</option>`).join('')}</select></div>
    <div id="um-eq"></div>
    <div class="acciones"><button class="btn btn-negro" type="submit">Unir</button></div></form>`, {
    ancho: true,
    alMontar: (el, cerrar) => {
      const sel = $('#um-ins', el); comboSelect(sel, { placeholder: 'Escribí para buscar el insumo…' });
      const eq = () => { const i = ins.find(x => String(x.id) === sel.value); $('#um-eq', el).innerHTML = formEquivalencia(i, m, i?.codigo_shares === String(m.id) ? i.shares_factor : 1); };
      sel.addEventListener('change', eq); eq();
      $$('[data-sug]', el).forEach(b => b.onclick = () => { sel.value = b.dataset.sug; const c = $('.combo-in', el); if (c) c.value = ins.find(x => String(x.id) === b.dataset.sug)?.nombre || ''; eq(); });
      $('#f-um', el).onsubmit = (e) => {
        e.preventDefault();
        const i = ins.find(x => String(x.id) === sel.value);
        conBoton($('button[type=submit]', e.target), async () => {
          if (i.codigo_shares && i.codigo_shares !== String(m.id) && !await confirmar(`${i.nombre} ya está unido a otra materia prima de Shares (${R.mp.get(Number(i.codigo_shares))?.denominacion || i.codigo_shares}). ¿Cambiarlo por esta?`)) return;
          await guardarUnion(i.id, m.id, e.target.elements.shares_factor.value); cerrar(); toast('Unido'); router();
        });
      };
    },
  });
}

// Panel "Costo en Shares" dentro de la ficha de un insumo de esta app
async function panelSharesInsumo(cont, ins) {
  try { await cargarRecetas(); } catch { cont.innerHTML = ''; return; }
  if (!R.cat.items.length) { cont.innerHTML = ''; return; }
  const m = ins.codigo_shares ? R.mp.get(Number(ins.codigo_shares)) : null;
  const umbral = S.cfg?.umbral_shares_pct || 10;
  if (!m) {
    const sug = sugerenciasMp(ins.nombre, 3);
    cont.innerHTML = `<div class="panel panel-pad" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">${ICO.balanza}<div style="flex:1;min-width:220px"><b>Sin unir con Shares</b>
      <div class="small muted">Unilo con su materia prima de Shares para comparar el costo que usa Shares con lo que se paga${sug.length ? ` (¿${esc(sug[0].m.denominacion)}?)` : ''}.</div></div>
      ${puede('editor') ? `<button class="btn" id="b-us">${ICO.link}Unir con Shares</button>` : ''}</div>`;
  } else {
    const real = ins.ult_precio ? ins.ult_precio * (Number(ins.shares_factor) || 1) : null, dif = real ? varPctR(m.costo, real) : null;
    const n = (usosR().mp.get(m.id) || []).filter(x => x.item.tipo === 'PRODUCTO_TERMINADO').length;
    cont.innerHTML = `<div class="panel panel-pad" style="margin-bottom:16px;${dif !== null && Math.abs(dif) >= umbral ? 'border-color:var(--warn)' : ''}"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${ICO.balanza}
      <div style="flex:1;min-width:220px"><b>En Shares: <a href="#/mp/${m.id}">${esc(m.denominacion)}</a></b><div class="small muted">Costo en Shares ${$$u(m.costo)}${Number(ins.shares_factor) !== 1 && ins.shares_factor ? ` · 1 unidad de Shares = ${fmtCantR(ins.shares_factor)} ${esc(UNI_C[ins.unidad])}` : ''} · se usa en ${n} producto${n === 1 ? '' : 's'}</div></div>
      <div style="text-align:right"><div class="small muted">Última compra vs Shares</div><div style="font:700 18px var(--display)">${dif === null ? '—' : chipVar(dif)}</div></div>
      ${puede('editor') ? `<button class="btn btn-chico" id="b-us">${ICO.pencil}Cambiar</button>` : ''}</div>
      ${dif !== null && Math.abs(dif) >= umbral ? `<p class="small" style="margin:10px 0 0">${dif > 0 ? `<b>Shares está costeando por debajo de lo que se paga.</b> ${n === 1 ? 'El producto que la usa está subcosteado.' : `Los ${n} productos que la usan están subcosteados.`}` : '<b>Shares está costeando por encima de lo que se paga.</b>'} <a href="#/mp/${m.id}">Ver el impacto en cada producto</a></p>` : ''}</div>`;
  }
  const b = $('#b-us', cont); if (b) b.onclick = () => modalUnirDesdeInsumo(ins);
}

// ---------------------------------------------------------------------------
//  Shares vs compras: ¿Shares costea con el precio real?
// ---------------------------------------------------------------------------
async function vistaComparar(el) {
  await cargarRecetas();
  if (!R.cat.items.length) return sinRecetas(el, 'Shares vs compras');
  const umbral = S.cfg?.umbral_shares_pct || (S.cfg = (await api('/api/config').catch(() => ({ config: {} }))).config).umbral_shares_pct || 10;
  const u = usosR();
  const unidos = R.ins.filter(i => i.codigo_shares && R.mp.has(Number(i.codigo_shares))).map(i => {
    const m = R.mp.get(Number(i.codigo_shares)), real = i.ult_precio ? i.ult_precio * (Number(i.shares_factor) || 1) : null;
    const usos = (u.mp.get(m.id) || []).filter(x => x.item.tipo === 'PRODUCTO_TERMINADO');
    const imp = real ? usos.map(x => simularR(x.item, new Map([[m.id, real]])).pct) : [];
    return { i, m, real, dif: real ? varPctR(m.costo, real) : null, productos: usos.length, impMax: imp.length ? Math.max(...imp.map(Math.abs)) * Math.sign(imp.find(v => Math.abs(v) === Math.max(...imp.map(Math.abs))) || 1) : null };
  }).sort((a, b) => Math.abs(b.dif ?? 0) - Math.abs(a.dif ?? 0));
  const desact = unidos.filter(x => x.dif !== null && Math.abs(x.dif) >= umbral);
  const sinUnir = R.ins.filter(i => i.ult_precio && !i.codigo_shares).map(i => ({ i, sug: sugerenciasMp(i.nombre, 1)[0] })).sort((a, b) => (b.sug?.s || 0) - (a.sug?.s || 0));
  const mpUsadas = [...R.mp.values()].filter(m => u.mp.has(m.id));
  el.innerHTML = `<div class="encabezado"><div><h1>Shares vs compras</h1><p>¿Shares costea con el precio real? Para cada insumo unido a su materia prima de Shares, el costo que usa Shares contra lo que se pagó en la última compra.</p></div>
    <div class="acciones">${unidos.some(x => x.real) ? `<button class="btn btn-acento" id="b-simreal">${ICO.calc}Costear todo con precios de compra</button>` : ''}</div></div>
    <div class="kpis">
      ${kpiR('Unidos con Shares', unidos.length, `de ${mpUsadas.length} materias primas de Shares`)}
      ${kpiR('Shares desactualizado', desact.length, `diferencia de ${umbral} % o más`, { clase: desact.length ? 'alerta' : '' })}
      ${kpiR('Shares por debajo', desact.filter(x => x.dif > 0).length, 'Productos subcosteados')}
      ${kpiR('Insumos sin unir', sinUnir.length, 'Con compras pero sin materia prima de Shares', { clase: sinUnir.length ? 'aviso' : '' })}
    </div>
    <div class="panel"><div class="panel-titulo"><h2>Insumos unidos</h2><span class="small muted">Ordenados por diferencia</span></div>
      ${unidos.length ? `<div class="tabla-wrap"><table><thead><tr><th>Insumo</th><th>En Shares</th><th class="num">Costo Shares</th><th class="num">Última compra</th><th class="num">Diferencia</th><th class="num">Productos</th><th class="num">Mayor impacto</th></tr></thead><tbody>
      ${unidos.map(x => `<tr class="click" data-href="#/mp/${x.m.id}"><td><b>${esc(x.i.nombre)}</b><small class="sub-celda">${esc(x.i.ult_proveedor || '')}</small></td><td class="small">${esc(x.m.denominacion)}</td>
        <td class="num">${$$u(x.m.costo)}</td><td class="num">${x.real ? `${$$u(x.real)}<small class="sub-celda">${fmtF(x.i.ult_fecha)}</small>` : '<span class="muted">sin compras</span>'}</td>
        <td class="num" data-orden="${x.dif ?? ''}">${x.dif === null ? '—' : chipVar(x.dif)}</td><td class="num">${x.productos || '—'}</td>
        <td class="num" data-orden="${x.impMax ?? ''}" title="Cuánto cambia el costo del producto más afectado si Shares usara el precio de compra">${x.impMax === null ? '—' : chipVar(x.impMax)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="vacio"><span class="grande">Todavía no hay insumos unidos</span>Unilos desde la lista de abajo, desde la ficha de cada insumo o desde “Materias primas de Shares”.</div>'}</div>
    ${sinUnir.length ? `<div class="panel"><div class="panel-titulo"><h2>Insumos con compras sin unir</h2><span class="small muted">Con una sugerencia por nombre: revisala antes de confirmar</span></div>
      <div class="tabla-wrap"><table><thead><tr><th>Insumo</th><th class="num">Última compra</th><th>Sugerencia en Shares</th><th class="num">Costo Shares</th><th></th></tr></thead><tbody>
      ${sinUnir.map(x => `<tr><td><a href="#/insumo/${x.i.id}"><b>${esc(x.i.nombre)}</b></a><small class="sub-celda">${esc(x.i.rubro || '')}</small></td><td class="num">${fmtP(x.i.ult_precio, x.i.unidad)}</td>
        <td class="small">${x.sug ? esc(x.sug.m.denominacion) : '<span class="muted">sin sugerencia</span>'}</td><td class="num">${x.sug ? $$u(x.sug.m.costo) : '—'}</td>
        <td class="acciones">${puede('editor') ? `${x.sug ? `<button class="btn btn-chico btn-negro" data-ok="${x.i.id}" data-mp="${x.sug.m.id}">Confirmar</button>` : ''}<button class="btn btn-chico" data-elegir="${x.i.id}">Elegir</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  irA(el);
  $$('[data-ok]', el).forEach(b => b.onclick = () => conBoton(b, async () => { await guardarUnion(Number(b.dataset.ok), b.dataset.mp, 1); toast('Unido'); vistaComparar(el); }));
  $$('[data-elegir]', el).forEach(b => b.onclick = () => modalUnirDesdeInsumo(R.ins.find(i => String(i.id) === b.dataset.elegir)));
  const bs = $('#b-simreal'); if (bs) bs.onclick = () => { sessionStorage.setItem('sim_cambios', JSON.stringify(cambiosPreciosReales())); sessionStorage.setItem('sim_general', ''); location.hash = '#/simulador'; };
}
// Todas las materias primas unidas, al precio de su última compra
const cambiosPreciosReales = () => [...R.insPorMp.keys()].map(id => [id, precioRealMp(id)?.precio]).filter(([id, p]) => p && R.mp.has(id));

// ---------------------------------------------------------------------------
//  Cambios de costo en Shares
// ---------------------------------------------------------------------------
async function vistaRecCambios(el) {
  await cargarRecetas();
  if (!R.cat.items.length) return sinRecetas(el, 'Cambios de costo');
  let dias = Number(sessionStorage.getItem('rec_periodo')) || 30, datos;
  el.innerHTML = `<div class="encabezado"><div><h1>Cambios de costo en Shares</h1><p>Productos, bases y materias primas que cambiaron de costo en Shares en el período.</p></div>
    <div class="acciones">${selPeriodo('f-p', dias)}<button class="btn" id="b-exp">${ICO.download}Descargar Excel</button></div></div><div id="cont"></div>`;
  const pintar = async () => {
    const ch = await cargarCambiosR(dias);
    const its = recItems().map(i => { const a = ch.items.get(kItem(i.tipo, i.id)); return { i, a, p: varPctR(a?.costoTotal, i.costoTotal) }; }).filter(x => x.p != null && Math.abs(x.p) >= 0.05).sort((a, b) => b.p - a.p);
    const mps = [...R.mp.values()].map(m => { const a = ch.mp.get(m.id); return { m, a, p: varPctR(a?.costo, m.costo) }; }).filter(x => x.p != null && Math.abs(x.p) >= 0.05).sort((a, b) => b.p - a.p);
    datos = { its, mps };
    const ptc = its.filter(x => x.i.tipo === 'PRODUCTO_TERMINADO'), prom = (l) => l.length ? l.reduce((s, x) => s + x.p, 0) / l.length : null;
    $('#cont').innerHTML = `${avisoHistorialR(ch)}<div class="kpis">
        ${kpiR('Productos con cambios', ptc.length, ptc.length ? `Promedio ${chipVar(prom(ptc))}` : 'Ninguno')}
        ${kpiR('Bases con cambios', its.length - ptc.length, '')}
        ${kpiR('Materias primas con cambios', mps.length, mps.length ? `Promedio ${chipVar(prom(mps))}` : 'Ninguna')}
        ${kpiR('Período', `${dias} días`, `Desde el ${fmtF(ch.historial_desde && ch.historial_desde > ch.desde ? ch.historial_desde : ch.desde)}`)}</div>
      <div class="panel"><div class="panel-titulo"><h2>Productos y bases</h2></div>${its.length ? `<div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Producto / base</th><th class="num">Antes</th><th class="num">Ahora</th><th class="num">Diferencia</th><th class="num">Variación</th></tr></thead><tbody>
        ${its.map(x => `<tr class="click" data-href="#/receta/${x.i.tipo}/${x.i.id}"><td class="mono">${x.i.id}</td><td>${esc(x.i.denominacion)}<small class="sub-celda">${TIPO_TXT[x.i.tipo]} · ${esc(x.i.rubro || '')}</small></td><td class="num">${$$m(x.a.costoTotal)}<small class="sub-celda">${fmtF(x.a.fecha)}</small></td><td class="num"><b>${$$m(x.i.costoTotal)}</b></td><td class="num">${$$m(x.i.costoTotal - x.a.costoTotal)}</td><td class="num" data-orden="${x.p}">${chipVar(x.p)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vacio">Sin cambios en el período.</div>'}</div>
      <div class="panel"><div class="panel-titulo"><h2>Materias primas</h2></div>${mps.length ? `<div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Materia prima</th><th class="num">Antes</th><th class="num">Ahora</th><th class="num">Variación</th></tr></thead><tbody>
        ${mps.map(x => `<tr class="click" data-href="#/mp/${x.m.id}"><td class="mono">${x.m.id}</td><td>${esc(x.m.denominacion)}</td><td class="num">${$$u(x.a.costo)}<small class="sub-celda">${fmtF(x.a.fecha)}</small></td><td class="num"><b>${$$u(x.m.costo)}</b></td><td class="num" data-orden="${x.p}">${chipVar(x.p)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vacio">Sin cambios en el período.</div>'}</div>`;
    irA($('#cont'));
  };
  $('#f-p').onchange = (e) => { dias = Number(e.target.value); sessionStorage.setItem('rec_periodo', dias); pintar(); };
  $('#b-exp').onclick = () => descargarXlsx(`cambios-de-costo-shares-${dias}-dias.xlsx`, [
    ['Productos y bases', [['Tipo', 'Código', 'Denominación', 'Rubro', 'Costo antes', 'Fecha antes', 'Costo ahora', 'Diferencia', 'Variación %'], ...datos.its.map(x => [TIPO_TXT[x.i.tipo], x.i.id, x.i.denominacion, x.i.rubro, x.a.costoTotal, fmtF(x.a.fecha), x.i.costoTotal, x.i.costoTotal - x.a.costoTotal, Math.round(x.p * 100) / 100])], [18, 9, 40, 16, 14, 12, 14, 14, 12]],
    ['Materias primas', [['Código', 'Materia prima', 'Costo antes', 'Fecha antes', 'Costo ahora', 'Variación %'], ...datos.mps.map(x => [x.m.id, x.m.denominacion, x.a.costo, fmtF(x.a.fecha), x.m.costo, Math.round(x.p * 100) / 100])], [9, 44, 14, 12, 14, 12]]]);
  await pintar();
}

// ---------------------------------------------------------------------------
//  Simulador
// ---------------------------------------------------------------------------
async function vistaSimulador(el) {
  await cargarRecetas();
  if (!R.cat.items.length) return sinRecetas(el, 'Simulador');
  const cambios = new Map(JSON.parse(sessionStorage.getItem('sim_cambios') || '[]'));
  let general = Number(sessionStorage.getItem('sim_general')) || 0, verBases = false;
  const filtro0 = sessionStorage.getItem('sim_filtro') || ''; sessionStorage.removeItem('sim_filtro');
  const mpsUsadas = [...R.mp.values()].filter(m => usosR().mp.has(m.id));
  el.innerHTML = `<div class="encabezado"><div><h1>Simulador</h1><p>¿Qué pasa con el costo de cada producto si cambian las materias primas? Cargá uno o varios cambios, una suba general, o costeá todo con los precios de la última compra.</p></div>
    <div class="acciones"><button class="btn" id="b-limpiar">Limpiar</button><button class="btn" id="b-exp">${ICO.download}Descargar Excel</button></div></div>
    <div class="dos">
      <div class="panel panel-pad"><h2 style="margin-bottom:10px">Cambios a simular</h2>
        ${R.insPorMp.size ? `<button class="btn btn-acento" id="b-reales" style="margin-bottom:12px">${ICO.balanza}Usar precios de la última compra (${R.insPorMp.size} materias primas unidas)</button>` : ''}
        <div class="campo"><label for="s-gen">Suba general de las demás materias primas (%)</label><input id="s-gen" type="number" step="0.1" value="${general || ''}" placeholder="Ej. 3 (inflación del mes)"></div>
        <div class="campo"><label for="s-ins">Agregar una materia prima puntual</label><input id="s-ins" list="dl-mp" placeholder="Escribí el nombre o el código" autocomplete="off"><datalist id="dl-mp">${mpsUsadas.map(m => `<option value="${esc(m.denominacion)} · ${m.id}">`).join('')}</datalist></div>
        <div id="s-lista"></div></div>
      <div class="panel panel-pad"><h2 style="margin-bottom:10px">Resultado</h2><div id="s-kpis"></div>
        <label class="check"><input type="checkbox" id="s-bases"> Mostrar también las bases</label>
        <div class="campo" style="margin-top:8px"><label for="s-filtro">Filtrar productos</label><input id="s-filtro" placeholder="Nombre o rubro" value="${esc(filtro0)}"></div></div>
    </div>
    <div class="panel"><div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Rubro</th><th class="num">Costo actual</th><th class="num">Costo simulado</th><th class="num">Diferencia</th><th class="num">Variación</th></tr></thead><tbody id="tb"></tbody></table></div><div class="paginacion" id="pag"></div></div>`;
  const guardar = () => { sessionStorage.setItem('sim_cambios', JSON.stringify([...cambios])); sessionStorage.setItem('sim_general', general || ''); };
  let filas = [];
  const pintarLista = () => {
    $('#s-lista').innerHTML = cambios.size ? `<div class="tabla-wrap tabla-scroll" style="max-height:320px"><table class="sin-orden"><tbody>${[...cambios].map(([id, nuevo]) => { const m = R.mp.get(id); return `<tr><td>${esc(m?.denominacion || id)}<small class="sub-celda">Shares ${$$u(m?.costo)}</small></td>
      <td style="width:95px"><input type="number" step="0.1" data-pct="${id}" value="${m?.costo ? Math.round((nuevo / m.costo - 1) * 10000) / 100 : ''}" aria-label="Variación %" title="Variación %"></td><td class="small muted">%</td>
      <td style="width:120px"><input type="number" step="0.01" data-nuevo="${id}" value="${Math.round(nuevo * 10000) / 10000}" aria-label="Costo nuevo" title="Costo nuevo"></td><td><button class="ibtn" data-quitar="${id}" aria-label="Quitar">${ICO.trash}</button></td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="small muted" style="margin:0">Sin materias primas puntuales. Las que agregues pisan la suba general.</p>';
    $$('[data-pct]').forEach(x => x.onchange = () => { const id = Number(x.dataset.pct), m = R.mp.get(id); cambios.set(id, m.costo * (1 + (parseFloat(x.value) || 0) / 100)); guardar(); pintarLista(); calcular(); });
    $$('[data-nuevo]').forEach(x => x.onchange = () => { cambios.set(Number(x.dataset.nuevo), parseFloat(x.value) || 0); guardar(); pintarLista(); calcular(); });
    $$('[data-quitar]').forEach(b => b.onclick = () => { cambios.delete(Number(b.dataset.quitar)); guardar(); pintarLista(); calcular(); });
  };
  const calcular = () => {
    const q = normQ($('#s-filtro').value);
    filas = recItems(verBases ? null : 'PRODUCTO_TERMINADO').map(i => ({ i, s: simularR(i, cambios, general) }))
      .filter(x => !q || normQ(x.i.denominacion + ' ' + x.i.rubro).includes(q)).sort((a, b) => b.s.pct - a.s.pct);
    const pts = filas.filter(x => x.i.tipo === 'PRODUCTO_TERMINADO'), af = pts.filter(x => Math.abs(x.s.pct) >= 0.005);
    const prom = af.length ? af.reduce((s, x) => s + x.s.pct, 0) / af.length : 0;
    $('#s-kpis').innerHTML = `<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">${kpiR('Productos afectados', af.length, `de ${pts.length}`)}${kpiR('Variación promedio', af.length ? chipVar(prom) : '—', af.length ? `máxima ${chipVar(Math.max(...af.map(x => x.s.pct)))}` : 'Cargá un cambio')}</div>`;
    $('#tb').innerHTML = filas.slice(0, 600).map(x => `<tr class="click" data-href="#/receta/${x.i.tipo}/${x.i.id}"><td class="mono">${x.i.id}</td><td>${esc(x.i.denominacion)}${x.i.tipo === 'BASE' ? ' <span class="badge b-warn">base</span>' : ''}</td><td class="small">${esc(x.i.rubro || '')}</td>
      <td class="num">${$$m(x.s.actual)}</td><td class="num"><b>${$$m(x.s.nuevo)}</b></td><td class="num" data-orden="${x.s.delta}">${Math.abs(x.s.delta) >= 0.005 ? $$m(x.s.delta) : '<span class="muted">—</span>'}</td><td class="num" data-orden="${x.s.pct}">${Math.abs(x.s.pct) >= 0.005 ? chipVar(x.s.pct) : '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Nada con ese filtro.</td></tr>';
    $('#pag').innerHTML = `<span>${filas.length} ${verBases ? 'productos y bases' : 'productos'}</span><span class="small muted">El costo indirecto no cambia: es el del rubro.</span>`;
    irA($('#tb'));
  };
  const ins = $('#s-ins');
  ins.oninput = () => {
    const mm = ins.value.match(/·\s*(\d+)$/); if (!mm) return;
    const id = Number(mm[1]), m = R.mp.get(id);
    if (m && !cambios.has(id)) { cambios.set(id, m.costo * (1 + (general || 10) / 100)); guardar(); }
    ins.value = ''; pintarLista(); calcular(); $(`[data-pct="${id}"]`)?.focus();
  };
  const br = $('#b-reales'); if (br) br.onclick = () => { for (const [id, p] of cambiosPreciosReales()) cambios.set(id, p); guardar(); pintarLista(); calcular(); toast(`${cambiosPreciosReales().length} materias primas a precio de última compra`); };
  $('#s-gen').oninput = (e) => { general = parseFloat(e.target.value) || 0; guardar(); calcular(); };
  $('#s-bases').onchange = (e) => { verBases = e.target.checked; calcular(); };
  $('#s-filtro').oninput = calcular;
  $('#b-limpiar').onclick = () => { cambios.clear(); general = 0; $('#s-gen').value = ''; $('#s-filtro').value = ''; guardar(); pintarLista(); calcular(); };
  $('#b-exp').onclick = () => descargarXlsx('simulacion-costos.xlsx', [
    ['Resultado', [['Tipo', 'Código', 'Producto', 'Rubro', 'Costo actual (Shares)', 'Costo simulado', 'Diferencia', 'Variación %'], ...filas.map(x => [TIPO_TXT[x.i.tipo], x.i.id, x.i.denominacion, x.i.rubro, x.s.actual, x.s.nuevo, x.s.delta, Math.round(x.s.pct * 100) / 100])], [18, 9, 40, 16, 16, 14, 14, 12]],
    ['Supuestos', [['Suba general de las demás materias primas %', general || 0], [], ['Código', 'Materia prima', 'Costo Shares', 'Costo simulado', 'Variación %'],
      ...[...cambios].map(([id, n]) => { const m = R.mp.get(id); return [id, m?.denominacion, m?.costo, n, m?.costo ? Math.round((n / m.costo - 1) * 10000) / 100 : '']; })], [40, 40, 14, 14, 12]]]);
  pintarLista(); calcular();
}
