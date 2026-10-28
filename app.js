/* =============================================================================
 *  Costos de insumos — Lucciano's (frontend)
 *  Vanilla JS, sin build. Habla con el Worker (window.COSTOS_API).
 *  Rutas: #/inicio, #/alertas, #/insumos, #/insumo/ID, #/vincular, #/facturas,
 *         #/admin, #/guia, #/cuenta
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
// "1 caja = 15 kg" / "se compra por kg"
function textoEquivale(uFact, factor, base) {
  if (!factor) return 'falta indicar cuánto trae';
  const n = unidadFact(uFact);
  if (factorDirecto(uFact, base) === Number(factor) && Number(factor) === 1) return `se compra por ${UNI_C[base] === 'u.' ? 'unidad' : UNI_C[base]}`;
  return `1 ${n} = ${fmtCant.format(factor)} ${UNI_C[base]}`;
}
// Factor sugerido para vincular: el directo por unidad, o lo que propuso la IA si está en la misma unidad base
function factorSugerido(g, base) {
  const d = factorDirecto(g.unidad, base);
  if (d) return d;
  if (g.contenido && (!g.unidad_base || g.unidad_base === base)) return g.contenido;
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
      if (method === 'GET' && [502, 503, 504].includes(res.status) && intento < 2) throw new TypeError('HTTP ' + res.status);
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
  m.onclick = (e) => { if (e.target === m) cerrar(); };
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
  if (llamarApi) await api('/api/logout', { method: 'POST' }).catch(() => null);
  guardarToken(null); S.user = null;
  location.hash = '';
  vistaLogin();
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
      <div class="login-form"><div class="caja"><h1>Sin conexión</h1><p>No pude conectar con el servidor (${esc(API)}).<br>${esc(e.message)}</p><button class="btn btn-acento btn-grande" onclick="location.reload()">${ICO.refresh}Reintentar</button></div></div></div>`;
    return;
  }
  $('#app').innerHTML = `<div class="login">
    <div class="login-arte"><img src="logo-negro.png" alt="Lucciano's"><p class="login-sub">Costos de insumos</p>
      <div class="login-txt"><h2>Lo que te cobran, compra por compra.</h2><p>Los precios de las materias primas salen solos de las facturas de proveedores. Cada suba queda registrada y te avisa.</p></div>
      <div class="pasos"><span>${ICO.doc}Facturas</span><span>${ICO.sparkle}Se leen los renglones</span><span>${ICO.box}Precio por kg</span><span>${ICO.bell}Alertas</span></div></div>
    <div class="login-form"><form id="f-login">
      <h1>${setup ? 'Primer ingreso' : 'Ingresar'}</h1>
      <p>${setup ? 'Creá el usuario administrador.' : "Usá tu mail de Lucciano's."}</p>
      ${setup ? '<div class="campo"><label for="lg-n">Nombre</label><input id="lg-n" name="nombre" required autocomplete="name"></div>' : ''}
      <div class="campo"><label for="lg-u">Mail</label><input id="lg-u" name="email" type="email" required autocomplete="username"></div>
      <div class="campo"><label for="lg-p">Contraseña</label><input id="lg-p" name="password" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 10 : 1}"></div>
      <div class="campo hidden" id="c-totp"><label for="lg-t">Código de verificación</label><input id="lg-t" name="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" class="mono"></div>
      <button class="btn btn-acento btn-grande" type="submit">${setup ? 'Crear y entrar' : 'Entrar'} ${ICO.arrow}</button>
    </form></div></div>`;
  colorBarra('#A8C686');
  $('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await conBoton($('button[type=submit]', e.target), async () => {
      const r = await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: fd });
      if (r.requiere_totp) { $('#c-totp').classList.remove('hidden'); $('#c-totp input').focus(); toast('Ingresá el código de tu app autenticadora.'); return; }
      guardarToken(r.token); S.user = r.usuario; colorBarra(null);
      if (!location.hash) location.hash = '#/inicio';
      iniciar();
    });
  };
}

// ---------------------------------------------------------------------------
//  Shell y router
// ---------------------------------------------------------------------------
const RUTAS = [
  { re: /^#\/inicio$/, v: vistaInicio, nav: 'inicio', miga: '<b>Inicio</b>' },
  { re: /^#\/alertas$/, v: vistaAlertas, nav: 'alertas', miga: 'Seguimiento / <b>Alertas</b>' },
  { re: /^#\/insumos$/, v: vistaInsumos, nav: 'insumos', miga: 'Seguimiento / <b>Insumos</b>' },
  { re: /^#\/insumo\/(\d+)$/, v: vistaInsumo, nav: 'insumos', miga: 'Seguimiento / <a href="#/insumos">Insumos</a> / <b>Insumo</b>' },
  { re: /^#\/vincular$/, v: vistaVincular, nav: 'vincular', miga: 'Trabajo / <b>Para vincular</b>' },
  { re: /^#\/facturas$/, v: vistaFacturas, nav: 'facturas', miga: 'Trabajo / <b>Facturas leídas</b>' },
  { re: /^#\/factura\/(\d+)$/, v: vistaFactura, nav: 'facturas', miga: 'Trabajo / <a href="#/facturas">Facturas leídas</a> / <b>Factura</b>' },
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
      <a class="brand" href="#/inicio"><img src="logo-negro.png" alt="Lucciano's"><span>Costos de insumos</span></a>
      <nav class="nav" aria-label="Secciones">
        ${it('inicio', 'home', 'Inicio')}
        <div class="grp-t">Seguimiento</div>
        ${it('alertas', 'bell', 'Alertas', '<span class="cnt hot" data-cnt="alertas"></span>')}
        ${it('insumos', 'box', 'Insumos')}
        <div class="grp-t">Trabajo</div>
        ${it('vincular', 'link', 'Para vincular', '<span class="cnt" data-cnt="vincular"></span>')}
        ${it('facturas', 'doc', 'Facturas leídas')}
        <div class="grp-t">Datos</div>
        ${puede('admin') ? it('admin', 'gear', 'Configuración') : ''}
        ${it('guia', 'book', 'Guía de uso')}
      </nav>
      <div class="me"><a class="av" href="#/cuenta" title="Mi cuenta">${esc(iniciales(S.user.nombre))}</a>
        <a class="who" href="#/cuenta"><b>${esc(S.user.nombre)}</b><small>${esc(rol)}</small></a>
        <div class="ibtns"><button class="ibtn" id="b-tema" title="Claro / oscuro" aria-label="Cambiar tema">${temaActual() === 'dark' ? ICO.sun : ICO.moon}</button><button class="ibtn" id="b-salir" title="Salir" aria-label="Salir">${ICO.logout}</button></div></div>
    </aside>
    <div style="min-width:0">
      <header class="top"><img class="marca-m" src="logo-negro.png" alt="Lucciano's"><div class="crumbs">${ruta.miga}</div>
        <label class="buscar">${ICO.search}<input id="buscar-global" placeholder="Buscar insumo o proveedor…" aria-label="Buscar"><kbd>Ctrl K</kbd></label>
        <button class="ibtn" id="b-actualizar" title="Actualizar" aria-label="Actualizar">${ICO.refresh}</button></header>
      <main id="vista" class="entra"><div class="vacio"><span class="cargando"></span></div></main>
    </div></div>
    <nav class="mnav" aria-label="Secciones">
      <a href="#/inicio" class="${a === 'inicio' ? 'activo' : ''}">${ICO.home}Inicio</a>
      <a href="#/alertas" class="${a === 'alertas' ? 'activo' : ''}">${ICO.bell}Alertas<span class="cnt hot" data-cnt="alertas"></span></a>
      <a href="#/insumos" class="${a === 'insumos' ? 'activo' : ''}">${ICO.box}Insumos</a>
      <a href="#/vincular" class="${a === 'vincular' ? 'activo' : ''}">${ICO.link}Vincular<span class="cnt" data-cnt="vincular"></span></a>
      <a href="#/facturas" class="${a === 'facturas' ? 'activo' : ''}">${ICO.doc}Facturas</a>
    </nav>`;
}

async function contadores(t = null) {
  try {
    if (!t) {
      if (S.cnt && Date.now() - S.cnt.at < 60000) return pintarContadores(S.cnt);
      t = await api('/api/tablero');
    }
    S.cnt = { at: Date.now(), alertas: t.alertas_sin_ver, vincular: t.vincular_grupos };
    pintarContadores(S.cnt);
  } catch { /* no es crítico */ }
}
function pintarContadores(c) { $$('[data-cnt]').forEach(x => { const n = c[x.dataset.cnt]; x.textContent = n ? n : ''; }); }

async function router() {
  if (!S.token) return vistaLogin();
  if (S.pdfUrl) { URL.revokeObjectURL(S.pdfUrl); S.pdfUrl = null; S.pdfBytes = null; }
  const h = location.hash || '#/inicio';
  const r = RUTAS.find(x => x.re.test(h)) || RUTAS[0];
  const m = h.match(r.re) || [];
  $('#app').innerHTML = shell(r);
  $('#b-salir').onclick = () => salir();
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
  catch (e) { if (S.token && $('#vista')) { $('#vista').innerHTML = `<div class="panel panel-pad"><h2>No se pudo cargar</h2><p class="muted">${esc(e.message)}</p><button class="btn btn-acento" id="b-reint">${ICO.refresh}Reintentar</button></div>`; $('#b-reint').onclick = router; } }
}

async function iniciar() {
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
    ${cola ? `<div class="panel panel-pad progreso-lectura"><div class="pl-t"><b>${ICO.sparkle}Leyendo el historial de facturas</b><span class="muted small">${leidas} de ${total} leídas · ${cola} en cola · se leen solas de a ${'unas pocas'} cada 10 minutos</span></div>
      <div class="pl-barra"><span style="width:${total ? Math.round(leidas / total * 100) : 0}%"></span></div></div>` : ''}
    <div class="kpis">
      <a class="kpi ${t.alertas_sin_ver ? 'alerta' : ''}" href="#/alertas"><div class="et">Alertas sin ver</div><div class="val">${t.alertas_sin_ver}</div><div class="sub">${t.alertas_por_tipo?.suba ? `${t.alertas_por_tipo.suba} suba(s)` : 'Sin subas nuevas'}${t.alertas_por_tipo?.mas_caro ? ` · ${t.alertas_por_tipo.mas_caro} más caro(s)` : ''}</div></a>
      <a class="kpi ${t.vincular_grupos ? 'aviso' : ''}" href="#/vincular"><div class="et">Para vincular</div><div class="val">${t.vincular_grupos}</div><div class="sub">${t.vincular_renglones} renglón(es) sin insumo</div></a>
      <a class="kpi" href="#/insumos"><div class="et">Insumos seguidos</div><div class="val">${t.insumos}</div><div class="sub">${t.insumos_con_precio || 0} con precio</div></a>
      <a class="kpi" href="#/facturas"><div class="et">Facturas leídas</div><div class="val">${leidas}</div><div class="sub">${F.revisar ? `${F.revisar} no cierran · ` : ''}${cola ? `${cola} en cola` : 'al día'}</div></a>
    </div>
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
    <div class="panel"><div class="cola-bar">
      <div class="seg" id="seg-ver" style="margin:0">${[['sin_ver', 'Sin ver'], ['todas', 'Todas']].map(([k, t]) => `<button data-v="${k}" class="${k === ver ? 'on' : ''}">${t}</button>`).join('')}</div>
      <select id="f-tipo" style="max-width:240px"><option value="">Todos los tipos</option>${Object.entries(TIPO_ALERTA).map(([k, v]) => `<option value="${k}" ${tipo === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      <div class="tabla-wrap"><table><thead><tr><th>Insumo</th><th>Qué pasó</th><th>Fecha</th><th class="num">Pagado</th><th class="num">Referencia</th><th class="num">Variación</th><th></th></tr></thead><tbody id="tb"><tr><td colspan="7" class="vacio"><span class="cargando"></span></td></tr></tbody></table></div></div>`;
  const cargar = async () => {
    const p = new URLSearchParams({ ver }); if (tipo) p.set('tipo', tipo);
    const r = await api('/api/alertas?' + p);
    $('#tb').innerHTML = r.alertas.length ? r.alertas.map(a => `<tr class="click ${a.vista ? 'vista' : ''}" data-ins="${a.insumo_id}">
        <td><div class="prov">${cuad(a.insumo)}<div><b>${esc(a.insumo)}</b><small>${esc(a.rubro || '')}</small></div></div></td>
        <td>${badgeAlerta(a.tipo)}<small class="sub-celda">${esc(textoAlerta(a))}</small></td>
        <td class="mono">${fmtF(a.fecha)}</td>
        <td class="num"><b>${fmtP(a.precio, a.unidad)}</b></td>
        <td class="num">${fmtP(a.precio_ref, a.unidad)}<small class="sub-celda">${esc(String(a.ref_detalle || '').replace(/\s*\((\d{4})-(\d{2})-(\d{2})\)$/, ' ($3/$2)').replace(/del (\d{4})-(\d{2})-(\d{2})/, 'del $3/$2'))}</small></td>
        <td class="num">${chipVar(a.variacion_pct)}</td>
        <td>${a.vista ? `<small class="muted">Vista</small>` : `<button class="btn btn-chico" data-vista="${a.id}" title="Marcar como vista">${ICO.check}Vista</button>`}</td></tr>`).join('')
      : `<tr><td colspan="7" class="vacio">${ver === 'sin_ver' ? '<span class="grande">Nada nuevo</span>No hay alertas sin ver.' : 'No hay alertas.'}</td></tr>`;
    $$('#tb tr[data-ins]').forEach(tr => tr.onclick = (e) => { if (e.target.closest('button')) return; location.hash = '#/insumo/' + tr.dataset.ins; });
    $$('[data-vista]').forEach(b => b.onclick = () => conBoton(b, async () => { await api('/api/alertas/vistas', { method: 'POST', body: { ids: [Number(b.dataset.vista)] } }); S.cnt = null; contadores(); cargar(); }));
  };
  $$('#seg-ver button').forEach(b => b.onclick = () => { ver = b.dataset.v; sessionStorage.setItem('al_ver', ver); $$('#seg-ver button').forEach(x => x.classList.toggle('on', x === b)); cargar(); });
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
  let rubro = sessionStorage.getItem('ins_rubro') || '', soloAlertas = false;
  const r = await api('/api/insumos');
  const rubros = [...new Set(r.insumos.map(i => i.rubro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  el.innerHTML = `<div class="encabezado"><div><h1>Insumos</h1><p>Último precio pagado por ${'kg, litro o unidad'} (neto, sin IVA) y cómo viene variando.</p></div>
      <div class="acciones"><button class="btn" id="b-csv">${ICO.doc}Exportar CSV</button>${puede('editor') ? `<button class="btn btn-negro" id="b-nuevo">${ICO.box}Nuevo insumo</button>` : ''}</div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Insumo o proveedor" value="${esc(q0)}"></label>
      <select id="f-rubro" style="max-width:220px"><option value="">Todos los rubros</option>${rubros.map(x => `<option ${x === rubro ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="f-al"> Con alertas sin ver</label></div>
      <div class="tabla-wrap"><table class="tabla-ins"><thead><tr><th>Insumo</th><th class="num">Último precio</th><th class="num">vs. anterior</th><th class="num">vs. promedio</th><th>Tendencia</th><th>Última compra</th><th class="num">Compras</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const pintar = () => {
    const q = normQ($('#q').value);
    const lista = r.insumos.filter(i => (!rubro || i.rubro === rubro) && (!soloAlertas || i.alertas) && (!q || normQ(i.nombre + ' ' + (i.rubro || '') + ' ' + (i.ult_proveedor || '')).includes(q)));
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
  $('#f-al').onchange = () => { soloAlertas = $('#f-al').checked; pintar(); };
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
        <td class="num">${r.cantidad != null ? fmtCant.format(r.cantidad) : '—'} <small class="muted">${esc(unidadFact(r.unidad))}</small></td>
        <td class="small">${esc(textoEquivale(r.unidad, r.factor, u))}</td>
        <td class="num">${r.moneda && r.moneda !== 'PES' ? esc(r.moneda) + ' ' : ''}${$$m(r.precio_unitario)}${r.bonif_pct ? `<small class="sub-celda">bonif. ${dec(r.bonif_pct)} %</small>` : ''}${r.desc_pct ? `<small class="sub-celda txt-pos">desc. general ${dec(r.desc_pct)} %</small>` : ''}</td>
        <td class="num"><b>${r.ignorado ? '<span class="muted">No cuenta</span>' : fmtP(r.precio_base, u)}</b></td>
        <td>${puede('editor') ? `<button class="btn btn-chico" data-ren="${r.id}" title="Corregir">${ICO.pencil}</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="8" class="vacio">Sin compras.</td></tr>'}</tbody></table></div></div>
    ${d.vinculos.length ? `<div class="panel"><div class="panel-titulo"><h2>Descripciones vinculadas</h2></div><div class="tabla-wrap"><table><thead><tr><th>Proveedor</th><th>Descripción</th><th>Equivale</th><th class="num">Compras</th></tr></thead><tbody>
      ${d.vinculos.map(v => `<tr><td>${esc(v.proveedor || fmtCuit(v.cuit))}</td><td class="desc-fac">${esc(v.descripcion || v.clave)}</td><td class="small">${v.factor ? esc(textoEquivale(d.renglones.find(r => r.cuit === v.cuit)?.unidad, v.factor, u)) : '—'}</td><td class="num">${v.usos}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;

  graficoPrecios($('#graf'), $('#leyenda'), d.compras, u);
  $$('[data-fac]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); irFactura(a.dataset.fac); });
  $('#b-csv').onclick = () => descargarCsv(`${normQ(i.nombre).replace(/[^a-z0-9]+/g, '_')}_compras.csv`, [
    ['Fecha', 'Proveedor', 'Factura', 'Descripción', 'Cantidad', 'Unidad', 'Trae', 'Precio unitario', 'Moneda', 'Importe ARS', `Precio por ${UNI_C[u]}`],
    ...d.renglones.map(r => [r.fecha || '', r.proveedor || '', `${TIPOS[r.tipo] || ''} ${nroCbte(r)}`, r.descripcion, dec(r.cantidad), r.unidad || '', dec(r.factor), dec(r.precio_unitario), r.moneda || 'PES', dec(r.importe_ars), r.ignorado ? '' : dec(r.precio_base)]),
  ]);
  const be = $('#b-edit'); if (be) be.onclick = () => modalInsumo(i, () => router());
  const bu = $('#b-unir'); if (bu) bu.onclick = () => modalUnir(i);
  $$('[data-ren]', el).forEach(b => b.onclick = () => modalRenglon(d.renglones.find(r => String(r.id) === b.dataset.ren), i));
}

function modalUnir(i) {
  api('/api/insumos').then(r => {
    const otros = r.insumos.filter(x => x.id !== i.id && x.unidad === i.unidad);
    if (!otros.length) { toast(`No hay otro insumo medido en ${UNI[i.unidad]} para unir.`, true); return; }
    modal(`<h2>Unir con otro insumo</h2><p class="muted">Usalo si creaste el mismo insumo dos veces. Las compras, descripciones y alertas de <b>${esc(i.nombre)}</b> pasan al insumo que elijas y este se borra.</p>
      <div class="campo"><label>Unir con</label><select id="u-dest">${otros.map(x => `<option value="${x.id}">${esc(x.nombre)}${x.rubro ? ' · ' + esc(x.rubro) : ''}</option>`).join('')}</select></div>
      <div class="acciones"><button class="btn btn-rojo" id="u-ok">${ICO.merge}Unir</button></div>`, {
      alMontar: (m, cerrar) => { $('#u-ok', m).onclick = () => conBoton($('#u-ok', m), async () => { const x = await api(`/api/insumos/${i.id}/unir`, { method: 'POST', body: { destino_id: Number($('#u-dest', m).value) } }); cerrar(); toast('Unidos'); location.hash = '#/insumo/' + x.id; }); },
    });
  }).catch(e => toast(e.message, true));
}

// Corregir un renglón: cuánto trae, otro insumo o "no cuenta"
async function modalRenglon(r, ins) {
  const lista = (await api('/api/insumos')).insumos.filter(x => x.activo);
  modal(`<h2>Corregir compra</h2><p class="muted">${esc(r.proveedor || '')} · ${fmtF(r.fecha)}<br><span class="desc-fac">${esc(r.descripcion)}</span> · ${fmtCant.format(r.cantidad || 0)} ${esc(r.unidad || '')} a ${$$m(r.precio_unitario)}</p>
    <div class="campo"><label>Insumo</label><select id="r-ins">${lista.map(x => `<option value="${x.id}" data-u="${x.unidad}" ${x.id === ins.id ? 'selected' : ''}>${esc(x.nombre)} (${esc(UNI_C[x.unidad])})</option>`).join('')}</select></div>
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
  const provs = [...new Set(r.grupos.map(g => g.proveedor))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  el.innerHTML = `<div class="encabezado"><div><h1>Para vincular</h1><p>Descripciones nuevas de las facturas. Decí una vez qué insumo es cada una y cuánto trae: después se reconocen solas.</p></div></div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Descripción o proveedor"></label>
      <select id="f-prov" style="max-width:260px"><option value="">Todos los proveedores</option>${provs.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
      <div class="tabla-wrap"><table class="sin-orden tabla-vinc"><thead><tr><th>Producto en la factura</th><th class="num">Precio facturado</th><th>Es el insumo…</th><th class="num">Precio comparable</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
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
      return `<tr class="click fila-vinc" data-fac="${g.factura_id}" title="Tocá para ver la factura">
        <td><div class="vp-desc">${esc(g.descripcion)}</div>
          <div class="vp-meta">${g.codigo ? `Cód. ${esc(g.codigo)} · ` : ''}${g.n} compra${g.n > 1 ? 's' : ''} · última ${fmtF(g.ultima_fecha)} · <a href="#/factura/${g.factura_id}" data-irfac="${g.factura_id}">ver factura</a></div></td>
        <td class="num"><b>${g.moneda && g.moneda !== 'PES' ? esc(g.moneda) + ' ' : ''}${$$m(g.precio_unitario)}</b><div class="vp-meta">por ${esc(unidadFact(g.unidad))}</div></td>
        <td>${s ? `<div class="vp-ins">${esc(s.nombre)}${s.nuevo ? '<span class="vp-nuevo">nuevo</span>' : ''}</div><div class="vp-meta">${esc(textoEquivale(g.unidad, s.factor, s.u))}</div>` : '<span class="vp-meta">Sin sugerencia</span>'}</td>
        <td class="num">${pc ? `<b>${fmtP(pc, s.u)}</b>` : '<span class="vp-meta">—</span>'}</td>
        <td class="acc-vinc"><div class="acc-in">${puede('editor') ? `${s && s.factor ? `<button class="btn btn-acento btn-chico" data-ok="${k}">${ICO.check}Confirmar</button>` : ''}<button class="btn btn-chico" data-v="${k}">${s && s.factor ? 'Cambiar' : 'Vincular'}</button><button class="ibtn ib-x" data-ign="${k}" title="No es insumo (flete, servicio, descuento…)" aria-label="No es insumo">${ICO.x}</button>` : ''}</div></td></tr>`;
    };
    $('#tb').innerHTML = lista.length ? [...porProv.values()].sort((a, b) => b.total - a.total).map(p => `<tr class="grupo-vinc"><td colspan="5"><div class="prov">${cuad(p.proveedor)}<div><b>${esc(p.proveedor)}</b><small class="mono">${fmtCuit(p.cuit)} · ${p.items.length > 1 ? p.items.length + ' descripciones' : '1 descripción'}</small></div></div></td></tr>${p.items.map(fila).join('')}`).join('')
      : `<tr><td colspan="5" class="vacio">${r.grupos.length ? 'Nada coincide con el filtro.' : '<span class="grande">Todo vinculado</span>Cada descripción de las facturas ya tiene su insumo.'}</td></tr>`;
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
  pintar();
  contadores();
}

function modalVincular(g, insumos, alTerminar) {
  const sugIns = g.sugerido_insumo_id ? insumos.find(i => i.id === g.sugerido_insumo_id) : null;
  const rubros = [...new Set([...RUBROS_BASE, ...(S.rubros || [])])];
  const unit = g.ult_unit_ars || (g.cantidad ? g.importe_ars / g.cantidad : null);   // $ por unidad facturada de la última compra (en pesos)
  modal(`<h2>Vincular descripción</h2>
    <p class="muted" style="margin-bottom:14px"><b>${esc(g.proveedor)}</b><br><span class="desc-fac">${esc(g.descripcion)}</span><br>${g.n} compra(s) · ${$$m(g.precio_unitario)} por ${esc(unidadFact(g.unidad))}${g.factura_id ? ` · <a href="#/factura/${g.factura_id}" data-irfac="${g.factura_id}">ver factura</a>` : ''}</p>
    <div class="seg" id="v-modo"><button type="button" data-m="existente" class="${sugIns || !g.nombre_sugerido ? 'on' : ''}">Insumo existente</button><button type="button" data-m="nuevo" class="${!sugIns && g.nombre_sugerido ? 'on' : ''}">Insumo nuevo</button></div>
    <div id="v-exist" class="campo"><label>Insumo</label><select id="v-ins"><option value="">Elegí…</option>${insumos.map(i => `<option value="${i.id}" data-u="${i.unidad}" ${sugIns?.id === i.id ? 'selected' : ''}>${esc(i.nombre)} (${esc(UNI_C[i.unidad])})</option>`).join('')}</select></div>
    <div id="v-nuevo" class="hidden"><div class="campo"><label>Nombre del insumo</label><input id="v-nom" value="${esc(g.nombre_sugerido || '')}" placeholder="Genérico, sin marca"></div>
      <div class="fila2"><div class="campo"><label>Rubro</label><input id="v-rub" list="dl-rub2" placeholder="Lácteos, Frutas…"><datalist id="dl-rub2">${rubros.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="campo"><label>Se mide por</label><div class="seg" id="v-u">${Object.entries(UNI).map(([k, v]) => `<button type="button" data-u="${k}" class="${(g.unidad_base || 'kg') === k ? 'on' : ''}">${v}</button>`).join('')}</div></div></div></div>
    <div class="campo"><label>¿Cuánto trae cada ${esc(unidadFact(g.unidad))}?</label><div class="fila-eq"><span class="muted">1 ${esc(unidadFact(g.unidad))} =</span><input id="v-fac" type="number" min="0" step="any" value="${esc(factorSugerido(g, sugIns?.unidad || g.unidad_base || 'kg') ?? '')}" style="max-width:140px"><span class="muted" id="v-ul"></span></div>
      <div class="ayuda" id="v-prev"></div></div>
    <div class="acciones" style="margin-top:6px"><button class="btn btn-negro" id="v-ok">${ICO.link}Vincular</button></div>`, {
    alMontar: (m, cerrar) => {
      let modo = $('#v-modo .on', m).dataset.m, uNuevo = g.unidad_base || 'kg';
      const unidad = () => modo === 'nuevo' ? uNuevo : ($('#v-ins', m).selectedOptions[0]?.dataset.u || 'kg');
      const prev = () => {
        $('#v-exist', m).classList.toggle('hidden', modo !== 'existente');
        $('#v-nuevo', m).classList.toggle('hidden', modo !== 'nuevo');
        $('#v-ul', m).textContent = UNI_C[unidad()];
        const f = Number($('#v-fac', m).value);
        $('#v-prev', m).innerHTML = f > 0 && unit ? `Precio comparable: <b>${$$m(unit / f)}</b> por ${esc(UNI[unidad()])} (neto, sin IVA). Así se compara con cualquier otro proveedor, venga en la presentación que venga.` : 'Ej: bolsa × 25 kg → 25 · bidón de 5 litros → 5 · si ya se factura por kg → 1.';
      };
      $$('#v-modo button', m).forEach(b => b.onclick = () => { modo = b.dataset.m; $$('#v-modo button', m).forEach(x => x.classList.toggle('on', x === b)); prev(); });
      $$('#v-u button', m).forEach(b => b.onclick = () => { uNuevo = b.dataset.u; $$('#v-u button', m).forEach(x => x.classList.toggle('on', x === b)); prev(); });
      // Al cambiar de insumo (o de unidad del nuevo), si la unidad facturada es directa se completa sola
      const reFactor = () => { const d = factorDirecto(g.unidad, unidad()); if (d) $('#v-fac', m).value = d; else if (g.unidad_base && g.unidad_base !== unidad()) $('#v-fac', m).value = ''; else if (g.contenido) $('#v-fac', m).value = g.contenido; prev(); };
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
  let lectura = sessionStorage.getItem('fac_lect') || '';
  el.innerHTML = `<div class="encabezado"><div><h1>Facturas leídas</h1><p>Facturas de materia prima traídas de la app de facturas de proveedores, con sus renglones.</p></div>
      ${puede('editor') ? `<div class="acciones"><button class="btn" id="b-sync">${ICO.refresh}Sincronizar ahora</button></div>` : ''}</div>
    <div class="panel"><div class="cola-bar"><label class="campo-buscar">${ICO.search}<input id="q" placeholder="Proveedor, CUIT, número o #id"></label>
      <div class="seg" id="seg-l" style="margin:0">${[['', 'Todas'], ['ok', 'Leídas'], ['revisar', 'No cierran'], ['pendiente', 'En cola'], ['error', 'Con error'], ['espera', 'Esperando']].map(([k, t]) => `<button data-l="${k}" class="${k === lectura ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div class="tabla-wrap"><table><thead><tr><th>Proveedor</th><th>Comprobante</th><th>Fecha</th><th class="num">Neto</th><th class="num">Renglones</th><th>Lectura</th></tr></thead><tbody id="tb"><tr><td colspan="6" class="vacio"><span class="cargando"></span></td></tr></tbody></table></div></div>`;
  const cargar = async () => {
    const p = new URLSearchParams(); if (lectura) p.set('lectura', lectura); if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    const r = await api('/api/facturas?' + p);
    $('#tb').innerHTML = r.facturas.length ? r.facturas.map(f => `<tr class="click" data-id="${f.id}">
        <td><div class="prov">${cuad(f.razon_social)}<div><b>${esc(f.razon_social || 'Sin identificar')}</b><small class="mono">${fmtCuit(f.cuit)} · #${f.id}</small></div></div></td>
        <td class="mono">${esc(TIPOS[f.tipo] || '')} ${nroCbte(f)}</td><td class="mono">${fmtF(f.fecha)}</td>
        <td class="num">${f.moneda && f.moneda !== 'PES' ? esc(f.moneda) + ' ' : ''}${$$m(f.neto)}${f.descuento_pct ? `<small class="sub-celda txt-pos">bonif. general ${dec(f.descuento_pct)} %</small>` : ''}</td>
        <td class="num">${f.n_renglones || '—'}${f.n_renglones ? `<small class="sub-celda">${f.n_vinculados === f.n_renglones ? 'todos vinculados' : `${f.n_renglones - f.n_vinculados} sin vincular`}</small>` : ''}</td>
        <td>${badgeLectura(f.lectura)}${f.lectura_motivo && f.lectura !== 'ok' ? `<small class="sub-celda motivo-rech">${esc(f.lectura_motivo)}</small>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="6" class="vacio">${lectura || $('#q').value ? 'Nada coincide con el filtro.' : '<span class="grande">Todavía no hay facturas</span>Se traen solas de la app de facturas cada 10 minutos.'}</td></tr>`;
    $$('#tb tr[data-id]').forEach(tr => tr.onclick = () => irFactura(tr.dataset.id));
  };
  let t0; $('#q').oninput = () => { clearTimeout(t0); t0 = setTimeout(cargar, 300); };
  $$('#seg-l button').forEach(b => b.onclick = () => { lectura = b.dataset.l; sessionStorage.setItem('fac_lect', lectura); $$('#seg-l button').forEach(x => x.classList.toggle('on', x === b)); cargar(); });
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
            <small class="sub-celda">${r.insumo_id ? `<a href="#/insumo/${r.insumo_id}">${esc(r.insumo)}</a> · ${esc(textoEquivale(r.unidad, r.factor, r.insumo_unidad))} · <b>${fmtP(r.precio_base, r.insumo_unidad)}</b>` : r.ignorado ? 'No es insumo' : `Sin vincular${puede('editor') ? ` · <button class="btn-link" data-vinc-ren="${r.id}">Vincular ahora</button>` : ''}`}</small></td>
          <td class="num">${r.cantidad != null ? fmtCant.format(r.cantidad) : '—'} <small class="muted">${esc(unidadFact(r.unidad))}</small></td>
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
  ] },
  { t: 'Lectura de facturas', ico: 'sparkle', items: [
    { k: 'lecturas_por_corrida', tipo: 'numero', suf: 'facturas', t: 'Facturas por corrida', d: 'Cuántas facturas se leen con Gemini cada 10 minutos (máximo 12).' },
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
  const fila = (ok, t, det, prueba) => `<tr><td>${ok ? '<span class="badge b-ok">OK</span>' : '<span class="badge b-critica">Falta</span>'}</td><td><b>${t}</b><div class="small muted">${det}</div></td><td>${prueba ? `<button class="btn btn-chico" data-probar="${prueba}">Probar</button>` : ''}</td></tr>`;
  el.innerHTML = `<table class="sin-orden"><tbody>
    ${fila(s.gemini, 'Gemini (lectura de renglones)', `GEMINI_KEY · modelos ${esc(s.gemini_modelos.join(', '))}${s.gemini_saturado ? ` · <span class="txt-neg">Google estuvo saturado a las ${esc(fmtFH(s.gemini_saturado + 'Z'))}: la lectura se reintenta sola cada 10 minutos</span>` : ''}`, 'gemini')}
    ${fila(s.facturas_binding && s.costos_secret, 'App de facturas de proveedores', `Service binding FACTURAS ${s.facturas_binding ? 'cargado' : 'falta'} · COSTOS_SECRET ${s.costos_secret ? 'cargado' : 'falta'}`, 'facturas')}
    ${fila(!!s.ultima_sync, 'Sincronización', s.ultima_sync ? `Última: ${fmtFH(s.ultima_sync + 'Z')} · hasta la factura #${esc(s.cursor || 0)}` : 'Todavía no corrió. Corre sola cada 10 minutos (Cron Trigger).')}
    ${fila(true, 'Datos', `${s.insumos} insumo(s) · ${s.vinculos} descripción(es) vinculada(s) · ${s.renglones} renglón(es) leído(s)`)}
  </tbody></table><p class="small muted">Versión ${esc(s.version)}</p>`;
  $$('[data-probar]', el).forEach(b => b.onclick = () => conBoton(b, async () => { const r = await api('/api/probar/' + b.dataset.probar, { method: 'POST' }); toast(r.mensaje); }));
}

// ---------------------------------------------------------------------------
//  Guía de uso
// ---------------------------------------------------------------------------
async function vistaGuia(el) {
  el.innerHTML = `<div class="encabezado"><div><h1>Guía de uso</h1><p>Cómo funciona y qué hay que hacer.</p></div></div>
    <div class="panel panel-pad guia-txt" style="max-width:820px">
      <h2>De dónde salen los precios</h2>
      <p>Cada 10 minutos la app trae de <b>Facturas de proveedores</b> las facturas imputadas a cuentas de <b>materia prima</b> que ya están confirmadas (listas o cargadas en Shares). Gemini lee los renglones: descripción, cantidad, unidad, precio unitario, bonificación e importe. Las notas de crédito y las facturas rechazadas no cuentan.</p>
      <h2>Lo único que hay que hacer: vincular</h2>
      <p>La primera vez que aparece una descripción de un proveedor (por ejemplo “CREMA 35% BIDON 5 LTS”), va a <b>Para vincular</b>. Ahí decís qué insumo es y cuánto trae cada unidad facturada (5 litros). Casi siempre alcanza con tocar <b>Confirmar</b> sobre la sugerencia. Desde ese momento, todas las compras con esa descripción se reconocen solas.</p>
      <ul><li><b>Insumo</b>: el nombre genérico, sin marca ni presentación. La crema de dos proveedores distintos es el mismo insumo: así se comparan.</li>
        <li><b>Cuánto trae</b>: lleva el precio a $ por kg, litro o unidad. Bolsa × 25 kg → 25. Si ya se factura por kg → 1.</li>
        <li><b>No es insumo</b>: fletes, servicios, descuentos. Se ignoran.</li></ul>
      <h2>Los precios</h2>
      <p>Todos los precios son <b>netos, sin IVA</b>, en pesos (las facturas en dólares se pasan con la cotización de la factura) y con las bonificaciones ya descontadas: la de cada renglón y también la <b>bonificación general al pie</b> (por ejemplo, “Bonificación 20 %” sobre el total), que se reparte entre los productos de la factura. Las facturas con bonificación general lo muestran en verde.</p>
      <ul><li><b>vs. anterior</b>: contra la compra anterior <b>al mismo proveedor</b>.</li>
        <li><b>vs. promedio</b>: contra el promedio ponderado por cantidad del período (todos los proveedores).</li></ul>
      <h2>Alertas</h2>
      <ul><li><b>Subió / Bajó</b>: el proveedor cambió el precio más que el umbral contra su compra anterior.</li>
        <li><b>Sobre el promedio</b>: se pagó por encima del promedio del período.</li>
        <li><b>Otro proveedor más barato</b>: otro proveedor vendió lo mismo más barato en el período.</li></ul>
      <p>Los umbrales se cambian en <b>Configuración → Ajustes</b>, y cada insumo puede tener el suyo.</p>
      <h2>Si algo no cierra</h2>
      <p>En <b>Facturas leídas</b>, las marcadas “No cierra” tienen una suma de renglones distinta del neto de la factura. Abrila, mirá la factura y tocá <b>Volver a leer</b>. Si una compra quedó mal (otra presentación), corregila desde el insumo con el lápiz.</p>
    </div>`;
}


// ---------------------------------------------------------------------------
//  Usuarios, ajustes y auditoría
// ---------------------------------------------------------------------------
async function adminUsuarios(el) {
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
    if (it.tipo === 'switch') return `<label class="switch"><input type="checkbox" data-sw="${it.k}" ${v ? 'checked' : ''} aria-label="${esc(it.t)}"><span></span></label><span class="sw-txt" data-swtxt="${it.k}">${esc(v ? (it.si || 'Activado') : (it.no || 'Apagado'))}</span>`;
    if (it.tipo === 'numero') return `${it.pre ? `<span class="muted">${it.pre}</span>` : ''}<input type="number" data-num="${it.k}" value="${esc(v)}" min="0" step="${it.step || 1}" inputmode="decimal">${it.suf ? `<span class="muted">${it.suf}</span>` : ''}`;
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

