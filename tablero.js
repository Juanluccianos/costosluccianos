/* =============================================================================
 *  Tablero ejecutivo — Lucciano's (1.5.0)
 *  Pantalla de inicio para dirección (CEO / CFO). Usa los mismos datos y cálculos que el resto de la app:
 *   · Costos de recetas: Shares (catálogo traído por el Worker), explotados con explotarR / simularR de app.js.
 *   · Precios de compra: facturas de proveedores leídas con IA (/api/insumos, /api/facturas).
 *   · IPC: INDEC, tabla editable (Configuración del tablero).
 *  Lo que no existe como dato real (precios de venta, composición de productos de venta, MP dolarizadas) se
 *  muestra como DEMO, rotulado, y se apaga con el interruptor "Datos DEMO". Nada DEMO se guarda en el servidor:
 *  la configuración vive en el navegador (localStorage) y no toca datos productivos.
 * ============================================================================= */
'use strict';

// IPC nacional INDEC, variación mensual %. Fuente: INDEC, informes IPC 2026 (publicado el 12/11/2026 el de octubre).
const IPC_INDEC = { '2026-01': 2.9, '2026-02': 2.9, '2026-03': 3.4, '2026-04': 2.6, '2026-05': 2.1, '2026-06': 1.9, '2026-07': 2.1, '2026-08': 1.7, '2026-09': 1.9, '2026-10': 2.2 };

const TB_DEF = {
  demo: true,                // datos DEMO visibles (precios de venta y productos de venta de ejemplo)
  markupDemo: 2.6,           // precio DEMO = costo total × 2,6 (solo para mostrar cómo se ve el tablero)
  margenObjetivo: 60,        // % margen bruto objetivo para el precio sugerido
  umbralSuba: 5,             // % suba contra la compra anterior para marcar alerta
  dias: 90,                  // período de análisis de compras
  ipc: IPC_INDEC,
  precios: {},               // precios de venta REALES cargados por el usuario: { 'PRODUCTO_TERMINADO:26': 12345 }
  grupos: null,              // ids de MP de Shares por grupo del what-if (null = sugerencia por nombre)
  ventas: [                  // productos de venta (local): kg de helado + envase (insumo de esta app). DEMO hasta que se confirme.
    { nombre: 'Pote 1/4 kg', kg: 0.25, envase: 5, extra: 0, precio: null },
    { nombre: 'Pote 1/2 kg', kg: 0.5, envase: 4, extra: 0, precio: null },
    { nombre: 'Pote 1 kg', kg: 1, envase: 3, extra: 0, precio: null },
    { nombre: 'Cucurucho 2 sabores', kg: 0.15, envase: null, extra: null, precio: null },
  ],
};
function cfgTB() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('costos_tablero') || '{}') || {}; } catch { c = {}; }
  return { ...TB_DEF, ...c, ipc: { ...IPC_INDEC, ...(c.ipc || {}) }, ventas: c.ventas || TB_DEF.ventas.map(v => ({ ...v })), precios: c.precios || {} };
}
function guardarCfgTB(c) { try { localStorage.setItem('costos_tablero', JSON.stringify(c)); } catch { toast('El navegador no deja guardar la configuración (modo privado).', true); } }

const pct1 = (v) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const pp1 = (v) => v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
const tagDemo = (on = true) => on ? '<span class="tag-demo" title="Dato de ejemplo: no es real. Se apaga con el interruptor Datos DEMO.">DEMO</span>' : '';
const tagFuente = (t) => `<span class="tag-fuente">${esc(t)}</span>`;
const mesTxt = (ym) => { const [y, m] = ym.split('-'); return ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1] + ' ' + y.slice(2); };
Object.assign(ICO, {
  printer: svgI('<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8" rx="1"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>'),
  target: svgI('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  pareto: svgI('<path d="M3 21h18"/><rect x="4" y="6" width="3" height="12"/><rect x="9" y="10" width="3" height="8"/><rect x="14" y="13" width="3" height="5"/><path d="M5 5c5 0 9 2 15 9"/>'),
});

// ---------------------------------------------------------------------------
//  Datos
// ---------------------------------------------------------------------------
async function datosTablero(c) {
  const [cat, ins, fac, vin] = await Promise.all([
    cargarRecetas().catch(() => null),
    api('/api/insumos'),
    api('/api/facturas'),
    api('/api/vincular').catch(() => ({ grupos: [] })),
  ]);
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const desde = new Date(Date.now() - 3 * 3600e3 - c.dias * 864e5).toISOString().slice(0, 10);
  return { cat, insumos: ins.insumos, facturas: fac.facturas, grupos: vin.grupos || [], hoy, desde };
}

// Precio de venta de un producto: real (cargado) o DEMO (si está prendido). Devuelve { precio, demo } o null.
function precioVenta(c, it) {
  const k = kItem(it.tipo, it.id);
  if (c.precios[k] > 0) return { precio: Number(c.precios[k]), demo: false };
  if (c.demo && it.costoTotal > 0) return { precio: Math.round(it.costoTotal * c.markupDemo / 50) * 50, demo: true };
  return null;
}
const esSaborHelado = (i) => /^SABORES$/i.test(i.rubro || '') && i.costoTotal > 0 && !/SCRAP|GRANELLA|CRUMBLE|BROWNIE|CARAMELIZAD|SEMIELABORADO|TOPPING|SALSA|VARIEGATO|BA[NÑ]O/i.test(normQ(i.denominacion).toUpperCase());
const mediana = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
// Food cost = costo variable directo (materia prima + packaging, sin indirectos) / precio neto
function foodCost(it, ex) { return (it.costoReceta - (ex.indirectoBases || 0)) + (it.costoPackaging || 0); }

// Inflación propia de la canasta de compras, mes a mes. Para cada insumo: precio mediano del mes al MISMO proveedor;
// variación contra el mes anterior al mismo proveedor; promedio ponderado por lo comprado en el período ($).
function inflacionCanasta(insumos) {
  const porMes = new Map();   // ym → { suma, peso, n }
  const med = (a) => { a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  for (const i of insumos) {
    const s = safeJ(i.serie_json) || [];
    const peso = (Number(i.cantidad_periodo) || 0) * (Number(i.ult_precio) || 0) || Number(i.ult_precio) || 0;
    const prov = new Map();   // cuit → ym → [precios]
    for (const [f, p, cuit] of s) { if (!(p > 0) || !f) continue; const ym = f.slice(0, 7); const m = prov.get(cuit) || new Map(); m.set(ym, [...(m.get(ym) || []), p]); prov.set(cuit, m); }
    const vars = new Map();   // ym → [variaciones]
    for (const m of prov.values()) {
      const meses = [...m.keys()].sort();
      for (let k = 1; k < meses.length; k++) {
        const a = meses[k - 1], b = meses[k];
        const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
        if ((yb * 12 + mb) - (ya * 12 + ma) !== 1) continue;   // solo meses consecutivos
        vars.set(b, [...(vars.get(b) || []), med(m.get(b)) / med(m.get(a)) - 1]);
      }
    }
    for (const [ym, vs] of vars) { const x = porMes.get(ym) || { suma: 0, peso: 0, n: 0 }; x.suma += peso * (vs.reduce((s, v) => s + v, 0) / vs.length); x.peso += peso; x.n++; porMes.set(ym, x); }
  }
  return [...porMes.entries()].sort().map(([ym, x]) => ({ ym, pct: x.peso ? x.suma / x.peso * 100 : null, n: x.n }));
}

// Compras por proveedor (neto en $, dólares a la cotización de la factura), sin duplicados
function comprasPorProveedor(facturas, desde) {
  const vistas = new Set(), m = new Map();
  for (const f of facturas) {
    if (f.fecha < desde || ['descartada'].includes(f.lectura)) continue;
    const k = [f.cuit, f.tipo, f.pto_vta, f.numero].join('|');
    if (vistas.has(k)) continue;   // la app de facturas a veces manda la misma factura dos veces (lista + excepción)
    vistas.add(k);
    const sign = [3, 8, 13, 53].includes(Number(f.tipo)) ? -1 : 1;   // notas de crédito restan
    const ars = (Number(f.neto) || 0) * (['PES', 'ARS'].includes(String(f.moneda || 'PES').toUpperCase()) ? 1 : (Number(f.cotizacion) || 0)) * sign;
    const x = m.get(f.cuit) || { cuit: f.cuit, nombre: f.razon_social || fmtCuit(f.cuit), ars: 0, n: 0 };
    x.ars += ars; x.n++; m.set(f.cuit, x);
  }
  return [...m.values()].sort((a, b) => b.ars - a.ars);
}

// Grupos de materias primas de Shares para el what-if (sugeridos por nombre; el usuario los edita)
// Packaging (estuches, cajas, etiquetas…) nunca entra en un grupo aunque su nombre diga "leche" o "almendras"
const RX_PACK = /ESTUCHE|CAJA|ETIQUETA|BOBINA|FAJA|TAPA|POTE|FRASCO|PALITO|BOLSA|ENVASE|FILM|PAPEL/;
const RX_GRUPOS = {
  leche: /^LECHE |LECHE EN POLVO|CREMA (DE )?LECHE|BUTTER|SUERO|DULCE DE LECHE|\bMANTECA\b(?! DE CACAO)/,
  azucar: /AZUCAR|DEXTROSA|CERELOSE|GLUCOSA|FRUCTOSOFT|MALTODEXTRINA/,
  dolar: /BARRY|CALLEBAUT|CACAO|PISTACC|AVELLAN|NUEZ|ALMENDRA|AROMITALIA|VAINILL|PALSGAARD|CREMODAN|DANISCO|LIOFILIZ|PGPR|ANTIOXIDANTE|COLORANTE/,
};
function gruposMp(c) {
  const usadas = [...R.mp.values()].filter(m => usosR().mp.has(m.id));
  const g = {};
  for (const k of Object.keys(RX_GRUPOS)) g[k] = new Set(c.grupos?.[k] || usadas.filter(m => { const n = normQ(m.denominacion).toUpperCase(); return RX_GRUPOS[k].test(n) && !RX_PACK.test(n) && !/PACKAGING/i.test(m.categoria || '') && !(k === 'leche' && /AROMITALIA|NEUTRO|AROMA|COCO/.test(n)) && !(k === 'dolar' && /GALLETITA/.test(n)); }).map(m => m.id));
  return g;
}

// ---------------------------------------------------------------------------
//  Gráficos simples (SVG, colores del sistema)
// ---------------------------------------------------------------------------
function barrasDobles(filas, { alto = 190 } = {}) {
  // filas: [{ et, a, b }] → barra a (canasta) y b (IPC), en %
  if (!filas.length) return '<div class="vacio">Todavía no hay meses completos para comparar.</div>';
  const W = 620, H = alto, pl = 40, pr = 10, pt = 14, pb = 28;
  const vals = filas.flatMap(f => [f.a, f.b]).filter(v => v !== null && Number.isFinite(v));
  const mx = Math.max(1, ...vals.map(Math.abs)) * 1.2, mn = Math.min(0, ...vals) * 1.2;
  const Y = (v) => pt + (mx - v) / (mx - mn) * (H - pt - pb);
  const bw = (W - pl - pr) / filas.length;
  const barra = (x, v, col, t) => v === null || !Number.isFinite(v) ? '' : `<rect x="${x.toFixed(1)}" y="${Math.min(Y(v), Y(0)).toFixed(1)}" width="${(bw * 0.3).toFixed(1)}" height="${Math.abs(Y(v) - Y(0)).toFixed(1)}" rx="3" fill="${col}"><title>${esc(t)}: ${pct1(v)}</title></rect>
    <text x="${(x + bw * 0.15).toFixed(1)}" y="${(v >= 0 ? Y(v) - 4 : Y(v) + 12).toFixed(1)}" font-size="10.5" text-anchor="middle" fill="var(--muted)">${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Inflación propia vs IPC" style="display:block;max-width:100%">
    <line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line-strong)"/>
    ${filas.map((f, i) => { const x0 = pl + i * bw + bw * 0.18; return barra(x0, f.a, 'var(--accent)', 'Canasta propia') + barra(x0 + bw * 0.34, f.b, 'var(--info)', 'IPC INDEC')
      + `<text x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="var(--muted)">${esc(f.et)}</text>`; }).join('')}
  </svg>`;
}
function paretoSvg(lista, { alto = 210, n = 15 } = {}) {
  // lista: [{ nombre, v }] ordenada de mayor a menor
  const tot = lista.reduce((s, x) => s + Math.max(0, x.v), 0);
  if (!tot) return '<div class="vacio">Sin datos en el período.</div>';
  const L = lista.slice(0, n), W = 620, H = alto, pl = 8, pr = 34, pt = 12, pb = 18;
  const bw = (W - pl - pr) / L.length, mx = Math.max(...L.map(x => x.v));
  let acum = 0;
  const pts = L.map((x, i) => { acum += Math.max(0, x.v); return [pl + i * bw + bw / 2, pt + (1 - acum / tot) * (H - pt - pb)]; });
  const y80 = pt + 0.2 * (H - pt - pb);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pareto" style="display:block;max-width:100%">
    <line x1="${pl}" x2="${W - pr}" y1="${y80}" y2="${y80}" stroke="var(--neg)" stroke-dasharray="4 4"/><text x="${W - pr + 4}" y="${y80 + 4}" font-size="10.5" fill="var(--neg)">80 %</text>
    ${L.map((x, i) => `<rect x="${(pl + i * bw + bw * 0.12).toFixed(1)}" y="${(H - pb - Math.max(0, x.v) / mx * (H - pt - pb) * 0.95).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${(Math.max(0, x.v) / mx * (H - pt - pb) * 0.95).toFixed(1)}" rx="3" fill="var(--accent)" opacity=".85"><title>${esc(x.nombre)}: ${$$corto(x.v)}</title></rect>`).join('')}
    <polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="2"/>
    ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="var(--ink)"/>`).join('')}
    <text x="${W - pr + 4}" y="${pt + 4}" font-size="10.5" fill="var(--muted)">100 %</text></svg>`;
}

// ---------------------------------------------------------------------------
//  Vista
// ---------------------------------------------------------------------------
async function vistaTablero(el) {
  let c = cfgTB();
  el.innerHTML = '<div class="vacio"><span class="cargando"></span></div>';
  const d = await datosTablero(c);
  const hayRecetas = !!R.cat?.items?.length;
  const pts = hayRecetas ? recItems('PRODUCTO_TERMINADO') : [];
  // Sabores de helado: rubro SABORES de Shares, sin los semielaborados y toppings que Shares también guarda ahí
  // (granella de pistacho, scraps de alfajor, crumble, brownie…), que distorsionan el costo "por kg de helado".
  const sabores = pts.filter(esSaborHelado);
  const insPorId = new Map(d.insumos.map(i => [i.id, i]));
  const estado = { verProd: 'sabores', q: '', sim: { leche: 0, dolar: 0, azucar: 0, general: 0 } };

  const pintar = () => {
    c = cfgTB();
    // ---- KPIs ----
    const filasProd = pts.map(it => { const ex = explotarR(it); const pv = precioVenta(c, it); const fc = foodCost(it, ex);
      return { it, ex, pv, fc, fcPct: pv ? fc / pv.precio * 100 : null, margen: pv ? (pv.precio - it.costoTotal) / pv.precio * 100 : null }; });
    const conPrecio = filasProd.filter(f => f.pv);
    const demoEnUso = conPrecio.some(f => f.pv.demo);
    const sumP = conPrecio.reduce((s, f) => s + f.pv.precio, 0);
    const fcPond = sumP ? conPrecio.reduce((s, f) => s + f.fc, 0) / sumP * 100 : null;
    const mgPond = sumP ? conPrecio.reduce((s, f) => s + (f.pv.precio - f.it.costoTotal), 0) / sumP * 100 : null;
    const costoMpKg = mediana(sabores.map(i => i.costoReceta - (explotarR(i).indirectoBases || 0)));
    const costoTotKg = mediana(sabores.map(i => i.costoTotal));
    const infl = inflacionCanasta(d.insumos);
    const mesActual = d.hoy.slice(0, 7);
    const cerrados = infl.filter(x => x.ym < mesActual);
    const ultimo = cerrados[cerrados.length - 1] || null;
    const subas = d.insumos.filter(i => i.activo && Number(i.var_ant) >= c.umbralSuba).sort((a, b) => b.var_ant - a.var_ant);
    // Trazabilidad: qué % del costo de materia prima de todas las recetas tiene precio de factura (insumo unido)
    let mpTot = 0, mpFac = 0;
    for (const it of pts) for (const e of explotarR(it).mp.values()) { mpTot += e.costo; if (R.insPorMp.has(Number(e.id)) && precioRealMp(e.id)) mpFac += e.costo; }
    const trazPct = mpTot ? mpFac / mpTot * 100 : 0;
    const provs = comprasPorProveedor(d.facturas, d.desde);
    const totCompras = provs.reduce((s, x) => s + x.ars, 0);

    const kpi = (et, val, sub, { href = '', clase = '', fuente = '', demo = false } = {}) => `<${href ? `a href="${href}"` : 'div'} class="kpi kpi-ej ${clase}">
      <div class="et">${et}${demo ? tagDemo() : ''}</div><div class="val">${val}</div><div class="sub">${sub}</div>${fuente ? `<div class="fuente">${fuente}</div>` : ''}</${href ? 'a' : 'div'}>`;

    // ---- What-if ----
    const G = hayRecetas ? gruposMp(c) : { leche: new Set(), azucar: new Set(), dolar: new Set() };
    const cambios = new Map();
    const aplicar = (ids, p) => { if (!p) return; for (const id of ids) { const m = R.mp.get(id); if (m?.costo > 0) cambios.set(id, (cambios.get(id) ?? m.costo) * (1 + p / 100)); } };
    aplicar(G.leche, estado.sim.leche); aplicar(G.azucar, estado.sim.azucar); aplicar(G.dolar, estado.sim.dolar);
    const haySim = Object.values(estado.sim).some(v => v);
    const simFilas = haySim ? filasProd.filter(f => f.pv).map(f => { const s = simularR(f.it, cambios, estado.sim.general); const mg2 = (f.pv.precio - s.nuevo) / f.pv.precio * 100; return { ...f, s, mg2, caida: mg2 - f.margen }; }).sort((a, b) => a.caida - b.caida) : [];

    // ---- Productos (costo por kg / producto, margen, precio sugerido) ----
    const lista = (estado.verProd === 'sabores' ? filasProd.filter(f => /^SABORES$/i.test(f.it.rubro || '')) : filasProd)
      .filter(f => !estado.q || normQ(f.it.denominacion + ' ' + f.it.rubro + ' ' + f.it.id).includes(normQ(estado.q)))
      .sort((a, b) => b.it.costoTotal - a.it.costoTotal);
    const mo = c.margenObjetivo / 100;
    const sugerido = (it) => mo < 1 ? it.costoTotal / (1 - mo) : null;

    // ---- Productos de venta (local) ----
    const envP = (id) => id ? insPorId.get(Number(id))?.ult_precio ?? null : null;
    const ventas = c.ventas.map(v => { const env = v.envase ? envP(v.envase) : null; const faltan = [];
      if (costoTotKg == null) faltan.push('costo del helado');
      if (v.envase && env == null) faltan.push('precio del envase'); if (!v.envase && v.extra == null) faltan.push('costo del cono / envase');
      const costo = (costoTotKg || 0) * v.kg + (env || 0) + (Number(v.extra) || 0);
      const precio = v.precio > 0 ? { precio: Number(v.precio), demo: false } : c.demo && !faltan.length ? { precio: Math.round(costo * c.markupDemo / 100) * 100, demo: true } : null;
      // Si falta un componente del costo no se informa margen: sería un margen inflado
      return { ...v, env, costo, faltan, precio, margen: precio && !faltan.length ? (precio.precio - costo) / precio.precio * 100 : null }; });

    // ---- Proveedores con más de una fuente para el mismo insumo ----
    const multi = d.insumos.filter(i => i.proveedores > 1 || (safeJ(i.serie_json) || []).some(x => x[2] !== i.ult_cuit));

    el.innerHTML = `<div class="encabezado"><div><h1>Tablero ejecutivo</h1><p>Costos, márgenes y precios de materias primas. Tocá cualquier número para ver el detalle.</p></div>
      <div class="acciones no-print">
        <label class="switch" title="Muestra u oculta los datos de ejemplo (precios de venta y productos de venta)"><input type="checkbox" id="tb-demo" ${c.demo ? 'checked' : ''}><span></span>Datos DEMO</label>
        <select id="tb-dias" aria-label="Período">${[30, 90, 180, 365].map(x => `<option value="${x}" ${x === c.dias ? 'selected' : ''}>Compras: últimos ${x} días</option>`).join('')}</select>
        <button class="btn" id="tb-cfg">${ICO.sliders}Configurar</button><button class="btn" id="tb-xls">${ICO.download}Excel</button><button class="btn" id="tb-pdf">${ICO.printer}PDF</button></div></div>
      ${demoEnUso || (c.demo && ventas.some(v => v.precio?.demo)) ? `<div class="aviso-demo">${ICO.info}<div><b>Hay datos DEMO en pantalla.</b> Los precios de venta marcados como DEMO son de ejemplo (costo × ${String(c.markupDemo).replace('.', ',')}) para mostrar cómo funciona el tablero; no son precios de Lucciano's. Cargá los reales en <a href="#" id="tb-cfg2">Configurar → Precios de venta</a> o apagá “Datos DEMO”.</div></div>` : ''}
      ${!hayRecetas ? `<div class="panel panel-pad aviso-panel">${ICO.alert} Todavía no hay recetas de Shares: los costos por producto no se pueden calcular. Traelas desde <a href="#/productos">Productos terminados</a>.</div>` : ''}
      <div class="kpis kpis-6">
        ${kpi('Costo materia prima por kg', costoMpKg != null ? $$m(costoMpKg) : '—', costoMpKg != null ? `Mediana de ${sabores.length} sabores de helado · con indirectos ${$$m(costoTotKg)}` : 'Sin recetas', { href: '#tb-productos', fuente: 'Shares' })}
        ${kpi('Food cost', fcPond != null ? pct1(fcPond) : '—', fcPond != null ? `Materia prima + packaging / precio neto · ${conPrecio.length} productos` : 'Faltan precios de venta', { href: '#tb-productos', demo: demoEnUso, fuente: demoEnUso ? 'Shares + precios DEMO' : 'Shares + precios cargados', clase: fcPond > 35 ? 'alerta' : '' })}
        ${kpi('Margen bruto teórico', mgPond != null ? pct1(mgPond) : '—', mgPond != null ? `(Precio − costo total) / precio · objetivo ${pct1(c.margenObjetivo)}` : 'Faltan precios de venta', { href: '#tb-productos', demo: demoEnUso, fuente: demoEnUso ? 'Shares + precios DEMO' : 'Shares + precios cargados', clase: mgPond != null && mgPond < c.margenObjetivo ? 'alerta' : '' })}
        ${kpi(`Inflación de compras ${ultimo ? mesTxt(ultimo.ym) : ''}`, ultimo ? pct1(ultimo.pct) : '—', ultimo ? `IPC INDEC ${pct1(c.ipc[ultimo.ym])} · ${ultimo.n < 10 ? `<span class="txt-neg">muestra chica: ${ultimo.n} insumos</span>` : `${ultimo.n} insumos comparables`}` : 'Hace falta más de un mes de compras', { href: '#tb-inflacion', fuente: 'Facturas + INDEC', clase: !ultimo ? '' : ultimo.n < 10 ? 'aviso' : c.ipc[ultimo.ym] != null && ultimo.pct > c.ipc[ultimo.ym] ? 'alerta' : '' })}
        ${kpi('Subas sobre el umbral', subas.length, subas.length ? `${esc(subas[0].nombre)} ${pct1(subas[0].var_ant)} · umbral ${pct1(c.umbralSuba)}` : `Ninguna suba de ${pct1(c.umbralSuba)} o más`, { href: '#tb-alertas', fuente: 'Facturas', clase: subas.length ? 'alerta' : 'ok' })}
        ${kpi('Costo trazable a factura', pct1(trazPct), trazPct < 50 ? `<span class="txt-neg">El ${pct1(100 - trazPct)} del costo de recetas sale de Shares sin respaldo de factura</span>` : 'del costo de materia prima de las recetas', { href: '#/comparar', fuente: 'Shares + facturas', clase: trazPct < 50 ? 'alerta' : trazPct < 80 ? 'aviso' : 'ok' })}
      </div>

      <div class="panel" id="tb-productos"><div class="panel-titulo"><h2>Costo y margen por producto</h2>
        <div class="acciones no-print"><div class="seg" style="margin:0">${[['sabores', 'Sabores (por kg)'], ['todos', 'Todos los productos']].map(([k, t]) => `<button data-vp="${k}" class="${estado.verProd === k ? 'on' : ''}">${t}</button>`).join('')}</div>
          <label class="campo-buscar">${ICO.search}<input id="tb-q" placeholder="Buscar" value="${esc(estado.q)}"></label>
          <label class="small muted">Margen objetivo <input id="tb-mo" type="number" min="0" max="95" step="1" value="${c.margenObjetivo}" style="width:64px"> %</label></div></div>
        <div class="tabla-wrap tabla-scroll" style="max-height:460px"><table><thead><tr><th>Producto</th><th class="num">Materia prima + pack.</th><th class="num">Costo total</th><th class="num">Precio neto</th><th class="num">Food cost</th><th class="num">Margen bruto</th><th class="num">Precio sugerido</th></tr></thead><tbody>
        ${lista.slice(0, 300).map(f => { const sg = sugerido(f.it); return `<tr class="click" data-href="#/receta/${f.it.tipo}/${f.it.id}"><td><b>${esc(f.it.denominacion)}</b><small class="sub-celda">${f.it.id} · ${esc(f.it.rubro || '')}${f.ex.lote ? ' · receta por lote' : ''}</small></td>
          <td class="num">${$$m(f.fc)}</td><td class="num"><b>${$$m(f.it.costoTotal)}</b></td>
          <td class="num">${f.pv ? `${$$m(f.pv.precio)}${tagDemo(f.pv.demo)}` : '<span class="muted">sin precio</span>'}</td>
          <td class="num">${f.fcPct != null ? pct1(f.fcPct) : '—'}</td><td class="num ${f.margen != null && f.margen < c.margenObjetivo ? 'txt-neg' : ''}">${f.margen != null ? pct1(f.margen) : '—'}</td>
          <td class="num" title="Costo total / (1 − margen objetivo), neto de IVA">${sg ? $$m(sg) : '—'}${f.pv && sg ? `<small class="sub-celda">${chipVar((sg / f.pv.precio - 1) * 100, { titulo: 'Contra el precio actual' })}</small>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7" class="vacio">Nada con ese filtro.</td></tr>'}
        </tbody></table></div><p class="small muted nota-panel">Costos por unidad de Shares (sabores: por kg). Precio sugerido = costo total ÷ (1 − margen objetivo), neto de IVA. ${lista.length > 300 ? `Se muestran 300 de ${lista.length}; usá el buscador o el Excel.` : ''}</p></div>

      <div class="dos">
        <div class="panel" id="tb-venta"><div class="panel-titulo"><h2>Productos de venta en el local</h2>${tagDemo(c.demo && ventas.some(v => v.precio?.demo))}</div>
          <div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Producto</th><th class="num">Helado</th><th class="num">Envase</th><th class="num">Costo</th><th class="num">Precio neto</th><th class="num">Margen</th></tr></thead><tbody>
          ${ventas.map(v => `<tr><td><b>${esc(v.nombre)}</b>${v.faltan.length ? `<small class="sub-celda txt-neg">Falta: ${esc(v.faltan.join(', '))}</small>` : ''}</td><td class="num">${fmtCant.format(v.kg)} kg</td>
            <td class="num">${v.envase ? (v.env != null ? $$m(v.env) : '—') : v.extra != null ? $$m(v.extra) : '—'}<small class="sub-celda">${v.envase ? esc(insPorId.get(Number(v.envase))?.nombre || '') : 'cono / otro'}</small></td>
            <td class="num"><b>${$$m(v.costo)}</b>${v.faltan.length ? '<small class="sub-celda txt-neg">incompleto</small>' : ''}</td><td class="num">${v.precio ? `${$$m(v.precio.precio)}${tagDemo(v.precio.demo)}` : '<span class="muted">sin precio</span>'}</td><td class="num">${v.margen != null ? pct1(v.margen) : '—'}</td></tr>`).join('')}
          </tbody></table></div><p class="small muted nota-panel">Helado al costo total mediano de los sabores de helado (Shares, ${costoTotKg != null ? $$m(costoTotKg) : '—'} por kg) + envase al último precio de factura. Los gramos por producto y el costo del cono son supuestos editables en Configurar.</p></div>

        <div class="panel" id="tb-inflacion"><div class="panel-titulo"><h2>Inflación propia vs IPC</h2><span class="leyenda-ej"><i style="background:var(--accent)"></i>Canasta de compras <i style="background:var(--info)"></i>IPC INDEC</span></div>
          <div class="panel-pad">${barrasDobles(infl.map(x => ({ et: mesTxt(x.ym) + (x.ym === mesActual ? '*' : ''), a: x.pct, b: c.ipc[x.ym] ?? null })))}
          <div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Mes</th><th class="num">Canasta propia</th><th class="num">IPC</th><th class="num">Diferencia</th><th class="num">Insumos</th></tr></thead><tbody>
          ${(() => { let aC = 1, aI = 1; return infl.map(x => { const ipc = c.ipc[x.ym]; if (x.ym < mesActual) { aC *= 1 + (x.pct || 0) / 100; if (ipc != null) aI *= 1 + ipc / 100; }
            return `<tr><td>${mesTxt(x.ym)}${x.ym === mesActual ? ' <small class="muted">(en curso)</small>' : ''}</td><td class="num">${pct1(x.pct)}</td><td class="num">${ipc != null ? pct1(ipc) : '<span class="muted">sin publicar</span>'}</td><td class="num">${ipc != null && x.pct != null ? pp1(x.pct - ipc) : '—'}</td><td class="num">${x.n}</td></tr>`; }).join('')
            + (infl.filter(x => x.ym < mesActual).length > 1 ? `<tr class="fila-total"><td>Acumulado meses cerrados</td><td class="num">${pct1((aC - 1) * 100)}</td><td class="num">${pct1((aI - 1) * 100)}</td><td class="num">${pp1(((aC - 1) - (aI - 1)) * 100)}</td><td></td></tr>` : ''); })()}
          </tbody></table></div>
          <p class="small muted">Variación del precio de cada insumo contra el mes anterior, al mismo proveedor, ponderada por lo comprado. ${infl.length < 3 ? 'Hay pocos meses de historial: el dato se vuelve más firme a medida que se leen más facturas.' : ''} IPC: INDEC (editable en Configurar).</p></div></div>
      </div>

      <div class="dos">
        <div class="panel" id="tb-pareto"><div class="panel-titulo"><h2>Pareto de compras por proveedor</h2><span class="small muted">${c.dias} días · ${$$corto(totCompras)} neto</span></div>
          <div class="panel-pad">${paretoSvg(provs.map(p => ({ nombre: p.nombre, v: p.ars })))}
          ${(() => { let a = 0; const top = []; for (const p of provs) { if (a / totCompras >= 0.8) break; a += p.ars; top.push(p); }
            return `<p class="small"><b>${top.length} de ${provs.length} proveedores</b> explican el ${pct1(totCompras ? a / totCompras * 100 : 0)} de lo comprado.</p><div class="tabla-wrap"><table class="sin-orden"><tbody>${top.map(p => `<tr><td>${cuad(p.nombre)} ${esc(p.nombre)}</td><td class="num">${$$corto(p.ars)}</td><td class="num">${pct1(p.ars / totCompras * 100)}</td></tr>`).join('')}</tbody></table></div>`; })()}</div></div>
        <div class="panel" id="tb-alertas"><div class="panel-titulo"><h2>Subas de ${pct1(c.umbralSuba)} o más</h2><label class="small muted no-print">Umbral <input id="tb-um" type="number" min="0" step="0.5" value="${c.umbralSuba}" style="width:64px"> %</label></div>
          ${subas.length ? `<ul class="feed">${subas.slice(0, 12).map(i => { const imp = (Number(i.ult_precio) - Number(i.ant_precio)) * (Number(i.cantidad_periodo) || 0);
            return `<li data-href="#/insumo/${i.id}" tabindex="0">${cuad(i.nombre)}<div style="min-width:0"><div class="t">${esc(i.nombre)}</div><div class="d">${esc(i.ult_proveedor || '')} · ${fmtF(i.ult_fecha)} · ${fmtP(i.ant_precio, i.unidad)} → ${fmtP(i.ult_precio, i.unidad)}${imp > 0 ? ` · impacto ${$$corto(imp)} en lo comprado` : ''}</div></div><div class="r">${chipVar(i.var_ant)}</div></li>`; }).join('')}</ul>`
            : `<div class="vacio">Ningún insumo subió ${pct1(c.umbralSuba)} o más contra su compra anterior.</div>`}</div>
      </div>

      <div class="panel" id="tb-sim"><div class="panel-titulo"><h2>¿Y si…? Impacto en el margen</h2><span class="small muted">Sobre los costos de Shares${demoEnUso ? ' y precios DEMO' : ''}</span></div>
        <div class="panel-pad"><div class="sim-grid no-print">
          ${[['leche', 'Lácteos (leche, crema, suero)'], ['dolar', 'Dólar (MP importadas)'], ['azucar', 'Azúcares'], ['general', 'Resto de la MP']].map(([k, t]) => `<div class="campo"><label for="sim-${k}">${t} %</label><input id="sim-${k}" type="number" step="0.5" value="${estado.sim[k] || ''}" placeholder="0">
            ${k !== 'general' ? `<small class="muted"><a href="#" data-grupo="${k}">${G[k].size} materias primas</a>${k === 'dolar' ? ' · supuesto' : ''}</small>` : ''}</div>`).join('')}</div>
          ${haySim ? (() => { const caidaProm = simFilas.reduce((s, f) => s + f.caida * f.pv.precio, 0) / (simFilas.reduce((s, f) => s + f.pv.precio, 0) || 1);
            return `<div class="kpis" style="margin-top:6px">${kpiR('Caída promedio del margen', pp1(caidaProm), 'ponderada por precio')}${kpiR('Productos afectados', simFilas.filter(f => Math.abs(f.s.pct) >= 0.005).length, `de ${simFilas.length} con precio`)}${kpiR('Peor caso', simFilas[0] ? pp1(simFilas[0].caida) : '—', simFilas[0] ? esc(simFilas[0].it.denominacion) : '')}</div>
            <div class="tabla-wrap tabla-scroll" style="max-height:360px"><table><thead><tr><th>Producto</th><th class="num">Costo hoy</th><th class="num">Costo simulado</th><th class="num">Margen hoy</th><th class="num">Margen simulado</th><th class="num">Caída</th></tr></thead><tbody>
            ${simFilas.slice(0, 150).map(f => `<tr class="click" data-href="#/receta/${f.it.tipo}/${f.it.id}"><td>${esc(f.it.denominacion)}<small class="sub-celda">${esc(f.it.rubro || '')}</small></td><td class="num">${$$m(f.s.actual)}</td><td class="num"><b>${$$m(f.s.nuevo)}</b></td><td class="num">${pct1(f.margen)}</td><td class="num">${pct1(f.mg2)}</td><td class="num txt-neg">${pp1(f.caida)}</td></tr>`).join('')}</tbody></table></div>`; })()
            : '<p class="small muted" style="margin:0">Cargá una o más variaciones (ej.: lácteos 15, dólar 10). El costo indirecto queda fijo. La lista de materias primas de cada grupo se puede revisar tocando el número.</p>'}</div></div>

      <div class="dos">
        <div class="panel" id="tb-prov"><div class="panel-titulo"><h2>Mismo insumo, distintos proveedores</h2></div>
          ${multi.length ? `<div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Insumo</th><th>Proveedor</th><th class="num">Último precio</th><th class="num">vs. más barato</th></tr></thead><tbody id="tb-prov-b"><tr><td colspan="4" class="vacio"><span class="cargando"></span></td></tr></tbody></table></div>`
            : '<div class="vacio">Ningún insumo tiene compras a más de un proveedor todavía.</div>'}</div>
        <div class="panel"><div class="panel-titulo"><h2>Costo teórico vs. real</h2></div><div class="panel-pad">
          <p style="margin-top:0"><b>No disponible todavía.</b> Para compararlo hace falta el consumo real de materia prima de la fábrica (partes de producción o salidas de depósito por orden) y los kilos producidos de cada sabor. Hoy la app solo tiene recetas (teórico) y compras.</p>
          <p class="small muted" style="margin-bottom:0">Cuando Shares exponga las órdenes de producción por API, el cálculo es: costo real = consumo de cada MP × precio de factura; desvío = real − (kg producidos × costo teórico por kg). No se muestra nada simulado acá a propósito.</p></div></div>
      </div>

      <details class="panel defs" id="tb-defs"><summary class="panel-titulo"><h2>Cómo se calcula cada indicador</h2></summary><div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Indicador</th><th>Fórmula</th><th>Fuente</th><th>Para decidir…</th></tr></thead><tbody>
        ${DEFS_KPI.map(x => `<tr><td><b>${esc(x[0])}</b></td><td class="small">${esc(x[1])}</td><td class="small">${esc(x[2])}</td><td class="small">${esc(x[3])}</td></tr>`).join('')}</tbody></table></div></details>
      <p class="small muted">Recetas de Shares: ${R.cat?.sync?.PRODUCTO_TERMINADO?.at ? fmtFH(R.cat.sync.PRODUCTO_TERMINADO.at) : '—'} · Facturas: ${d.facturas.length} leídas · Hoy ${fmtF(d.hoy)}</p>`;

    // ---- eventos ----
    irA(el);
    $$('li[data-href]', el).forEach(li => { li.onclick = () => { location.hash = li.dataset.href; }; li.onkeydown = (e) => { if (e.key === 'Enter') li.click(); }; });
    $$('a.kpi[href^="#tb-"]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); $(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#tb-demo').onchange = (e) => { const x = cfgTB(); x.demo = e.target.checked; guardarCfgTB(x); pintar(); };
    $('#tb-dias').onchange = async (e) => { const x = cfgTB(); x.dias = Number(e.target.value); guardarCfgTB(x); vistaTablero(el); };
    $('#tb-mo').onchange = (e) => { const x = cfgTB(); x.margenObjetivo = Math.min(95, Math.max(0, Number(e.target.value) || 0)); guardarCfgTB(x); pintar(); };
    $('#tb-um').onchange = (e) => { const x = cfgTB(); x.umbralSuba = Math.max(0, Number(e.target.value) || 0); guardarCfgTB(x); pintar(); };
    let tq; $('#tb-q').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { estado.q = e.target.value; pintar(); $('#tb-q')?.focus(); const i = $('#tb-q'); if (i) i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $$('[data-vp]', el).forEach(b => b.onclick = () => { estado.verProd = b.dataset.vp; pintar(); });
    for (const k of Object.keys(estado.sim)) { const i = $('#sim-' + k); if (i) i.onchange = () => { estado.sim[k] = parseFloat(i.value) || 0; pintar(); $('#tb-sim')?.scrollIntoView({ block: 'start' }); }; }
    $$('[data-grupo]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); modalGrupoMp(a.dataset.grupo, G, () => pintar()); });
    $('#tb-cfg').onclick = () => modalCfgTablero(d, pintar);
    const c2 = $('#tb-cfg2'); if (c2) c2.onclick = (e) => { e.preventDefault(); modalCfgTablero(d, pintar); };
    $('#tb-pdf').onclick = () => { $$('details.defs', el).forEach(x => { x.open = true; }); window.print(); };
    $('#tb-xls').onclick = () => exportarTablero({ c, filasProd, infl, provs, subas, simFilas, ventas, haySim, estado });
    if (multi.length) pintarProveedores(multi);
  };
  pintar();
}

// Comparación de proveedores: trae el detalle solo de los insumos con más de un proveedor
async function pintarProveedores(multi) {
  const tb = $('#tb-prov-b'); if (!tb) return;
  const filas = [];
  for (const i of multi.slice(0, 15)) {
    try {
      const d = await api('/api/insumos/' + i.id);
      const por = new Map(); for (const c of d.compras) { const p = por.get(c.cuit); if (!p || c.fecha > p.fecha) por.set(c.cuit, c); }
      const ps = [...por.values()].filter(c => c.precio > 0).sort((a, b) => a.precio - b.precio);
      if (ps.length < 2) continue;
      ps.forEach((c, k) => filas.push(`<tr class="click" data-href="#/insumo/${i.id}"><td>${k ? '' : `<b>${esc(i.nombre)}</b>`}</td><td>${esc(c.proveedor || fmtCuit(c.cuit))}<small class="sub-celda">${fmtF(c.fecha)}</small></td><td class="num">${fmtP(c.precio, i.unidad)}</td><td class="num">${k ? chipVar((c.precio / ps[0].precio - 1) * 100) : '<span class="var baja">El más barato</span>'}</td></tr>`));
    } catch { /* un insumo que no carga no frena el resto */ }
  }
  if ($('#tb-prov-b')) { $('#tb-prov-b').innerHTML = filas.join('') || '<tr><td colspan="4" class="vacio">Sin comparaciones disponibles.</td></tr>'; irA($('#tb-prov-b')); }
}

function modalGrupoMp(k, G, alCerrar) {
  const nombres = { leche: 'Lácteos', azucar: 'Azúcares', dolar: 'Materias primas dolarizadas (supuesto)' };
  const usadas = [...R.mp.values()].filter(m => usosR().mp.has(m.id)).sort((a, b) => (G[k].has(b.id) - G[k].has(a.id)) || a.denominacion.localeCompare(b.denominacion, 'es'));
  modal(`<h2>${esc(nombres[k])}</h2><p class="muted">Marcá qué materias primas de Shares entran en este grupo. ${k === 'dolar' ? 'Es un supuesto: las importadas o que se pagan a precio dólar. Revisalo con Compras.' : ''}</p>
    <label class="campo-buscar" style="margin-bottom:8px">${ICO.search}<input id="g-q" placeholder="Filtrar"></label>
    <div class="tabla-wrap tabla-scroll" style="max-height:50vh"><table class="sin-orden"><tbody id="g-tb">${usadas.map(m => `<tr data-n="${esc(normQ(m.denominacion))}"><td><label class="check"><input type="checkbox" value="${m.id}" ${G[k].has(m.id) ? 'checked' : ''}> ${esc(m.denominacion)}</label></td><td class="num small">${$$u(m.costo)}</td></tr>`).join('')}</tbody></table></div>
    <div class="acciones" style="margin-top:12px;justify-content:space-between"><button class="btn" id="g-def">Volver a la sugerencia</button><button class="btn btn-negro" id="g-ok">Guardar</button></div>`, {
    ancho: true,
    alMontar: (m, cerrar) => {
      $('#g-q', m).oninput = (e) => { const q = normQ(e.target.value); $$('#g-tb tr', m).forEach(tr => { tr.hidden = q && !tr.dataset.n.includes(q); }); };
      $('#g-ok', m).onclick = () => { const x = cfgTB(); x.grupos = { ...(x.grupos || {}), [k]: $$('#g-tb input:checked', m).map(i => Number(i.value)) }; guardarCfgTB(x); cerrar(); alCerrar(); };
      $('#g-def', m).onclick = () => { const x = cfgTB(); if (x.grupos) delete x.grupos[k]; guardarCfgTB(x); cerrar(); alCerrar(); };
    },
  });
}

function modalCfgTablero(d, alCerrar) {
  const c = cfgTB();
  const meses = [...new Set([...Object.keys(c.ipc), ...inflacionCanasta(d.insumos).map(x => x.ym)])].sort();
  const envases = d.insumos.filter(i => i.unidad === 'un').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  modal(`<h2>Configurar el tablero</h2><p class="muted">Se guarda en este navegador. No modifica datos de la app.</p>
    <h3 style="margin:14px 0 6px">Precios de venta (netos de IVA)</h3>
    <p class="small muted" style="margin:0 0 8px">Subí un Excel o CSV con dos columnas: <b>código</b> del producto de Shares y <b>precio</b>. Hay ${Object.keys(c.precios).length} cargados.</p>
    <div class="acciones"><label class="btn">${ICO.upload}Subir precios<input type="file" id="c-file" accept=".xlsx,.xls,.csv" hidden></label><button class="btn" id="c-plant">${ICO.download}Plantilla</button>${Object.keys(c.precios).length ? '<button class="btn btn-rojo" id="c-borrar">Borrar precios</button>' : ''}</div>
    <div class="fila2" style="margin-top:12px"><div class="campo"><label>Markup de los precios DEMO</label><input id="c-mk" type="number" step="0.1" min="1" value="${c.markupDemo}"></div><div class="campo"><label>Período de compras (días)</label><input id="c-dias" type="number" min="7" value="${c.dias}"></div></div>
    <h3 style="margin:14px 0 6px">Productos de venta</h3>
    <div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Nombre</th><th>kg de helado</th><th>Envase (insumo)</th><th>Otro costo $</th><th>Precio neto $</th></tr></thead><tbody id="c-vtas">
      ${c.ventas.map((v, k) => `<tr><td><input data-k="${k}" data-f="nombre" value="${esc(v.nombre)}"></td><td><input data-k="${k}" data-f="kg" type="number" step="0.01" value="${v.kg}" style="width:80px"></td>
        <td><select data-k="${k}" data-f="envase"><option value="">—</option>${envases.map(i => `<option value="${i.id}" ${Number(v.envase) === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`).join('')}</select></td>
        <td><input data-k="${k}" data-f="extra" type="number" step="0.01" value="${v.extra ?? ''}" style="width:90px" placeholder="cono, cuchara…"></td><td><input data-k="${k}" data-f="precio" type="number" step="1" value="${v.precio ?? ''}" style="width:100px" placeholder="vacío = DEMO"></td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin:14px 0 6px">IPC INDEC (variación mensual %)</h3>
    <div class="ipc-grid">${meses.map(ym => `<label class="small">${mesTxt(ym)}<input data-ipc="${ym}" type="number" step="0.1" value="${c.ipc[ym] ?? ''}"></label>`).join('')}</div>
    <div class="acciones" style="margin-top:16px;justify-content:space-between"><button class="btn" id="c-reset">Volver a los valores de fábrica</button><button class="btn btn-negro" id="c-ok">Guardar</button></div>`, {
    ancho: true,
    alMontar: (m, cerrar) => {
      $('#c-ok', m).onclick = () => {
        const x = cfgTB();
        x.markupDemo = Math.max(1, parseFloat($('#c-mk', m).value) || TB_DEF.markupDemo);
        x.dias = Math.max(7, parseInt($('#c-dias', m).value) || 90);
        $$('[data-ipc]', m).forEach(i => { const v = parseFloat(i.value); if (Number.isFinite(v)) x.ipc[i.dataset.ipc] = v; else delete x.ipc[i.dataset.ipc]; });
        x.ventas = x.ventas.map((v, k) => { const g = (f) => $(`[data-k="${k}"][data-f="${f}"]`, m)?.value;
          return { nombre: g('nombre') || v.nombre, kg: parseFloat(g('kg')) || 0, envase: g('envase') ? Number(g('envase')) : null, extra: g('extra') === '' ? null : parseFloat(g('extra')), precio: g('precio') === '' ? null : parseFloat(g('precio')) }; });
        guardarCfgTB(x); cerrar(); toast('Configuración guardada'); alCerrar();
      };
      $('#c-reset', m).onclick = async () => { if (!await confirmar('Se borran los precios cargados y la configuración del tablero en este navegador.')) return; try { localStorage.removeItem('costos_tablero'); } catch { } toast('Listo'); alCerrar(); };
      const b = $('#c-borrar', m); if (b) b.onclick = () => { const x = cfgTB(); x.precios = {}; guardarCfgTB(x); cerrar(); toast('Precios borrados'); alCerrar(); };
      $('#c-plant', m).onclick = () => descargarXlsx('plantilla-precios-venta.xlsx', [['Precios', [['codigo', 'producto', 'precio_neto'], ...recItems('PRODUCTO_TERMINADO').map(i => [i.id, i.denominacion, cfgTB().precios[kItem(i.tipo, i.id)] ?? ''])], [10, 50, 14]]]);
      $('#c-file', m).onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          if (!window.XLSX) throw new Error('No cargó la librería de Excel.');
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
          const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
          const x = cfgTB(); let n = 0, malas = 0;
          for (const r of filas) {
            const cod = Number(String(r[0] ?? '').trim()); let p = r[r.length - 1];
            if (typeof p === 'string') p = Number(p.replace(/\$|\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));   // "12.345,67" → 12345.67
            if (!Number.isInteger(cod) || !R.porKey.has(kItem('PRODUCTO_TERMINADO', cod))) { if (r.length && Number.isFinite(cod) && cod) malas++; continue; }
            if (!(p > 0)) { malas++; continue; }
            x.precios[kItem('PRODUCTO_TERMINADO', cod)] = p; n++;
          }
          guardarCfgTB(x); toast(`${n} precios cargados${malas ? ` · ${malas} renglones ignorados (código inexistente o precio inválido)` : ''}`); cerrar(); alCerrar();
        } catch (err) { toast('No pude leer el archivo: ' + err.message, true); }
      };
    },
  });
}

function exportarTablero({ c, filasProd, infl, provs, subas, simFilas, ventas, haySim, estado }) {
  const demo = (x) => x ? 'DEMO' : '';
  const hojas = [
    ['Productos', [['Código', 'Producto', 'Rubro', 'Materia prima + packaging', 'Costo total (Shares)', 'Precio neto', 'Precio DEMO', 'Food cost %', 'Margen bruto %', `Precio sugerido (margen ${c.margenObjetivo} %)`, 'Receta por lote'],
      ...filasProd.map(f => [f.it.id, f.it.denominacion, f.it.rubro, r2(f.fc), r2(f.it.costoTotal), f.pv ? f.pv.precio : '', demo(f.pv?.demo), f.fcPct != null ? r2(f.fcPct) : '', f.margen != null ? r2(f.margen) : '', c.margenObjetivo < 100 ? r2(f.it.costoTotal / (1 - c.margenObjetivo / 100)) : '', f.ex.lote ? `sí (${r2(f.ex.rendimiento)})` : ''])], [9, 44, 18, 14, 14, 12, 8, 10, 10, 16, 12]],
    ['Productos de venta', [['Producto', 'kg helado', 'Envase $', 'Otro costo $', 'Costo $', 'Precio neto $', 'Precio DEMO', 'Margen %', 'Faltan datos'], ...ventas.map(v => [v.nombre, v.kg, v.env ?? '', v.extra ?? '', r2(v.costo), v.precio?.precio ?? '', demo(v.precio?.demo), v.margen != null ? r2(v.margen) : '', v.faltan.join(', ')])], [24, 10, 10, 10, 12, 12, 8, 10, 30]],
    ['Inflación vs IPC', [['Mes', 'Canasta propia %', 'IPC INDEC %', 'Insumos comparables'], ...infl.map(x => [x.ym, x.pct != null ? r2(x.pct) : '', c.ipc[x.ym] ?? '', x.n])], [10, 16, 14, 18]],
    ['Pareto proveedores', [['Proveedor', 'CUIT', 'Neto $', '% del total', '% acumulado'], ...(() => { const t = provs.reduce((s, p) => s + p.ars, 0); let a = 0; return provs.map(p => { a += p.ars; return [p.nombre, p.cuit, r2(p.ars), r2(p.ars / t * 100), r2(a / t * 100)]; }); })()], [40, 14, 16, 10, 12]],
    ['Subas', [['Insumo', 'Proveedor', 'Fecha', 'Precio anterior', 'Precio actual', 'Variación %'], ...subas.map(i => [i.nombre, i.ult_proveedor, i.ult_fecha, r2(i.ant_precio), r2(i.ult_precio), r2(i.var_ant)])], [30, 30, 12, 14, 14, 12]],
  ];
  if (haySim) hojas.push(['What-if', [['Supuestos', `Lácteos ${estado.sim.leche} % · Dólar ${estado.sim.dolar} % · Azúcares ${estado.sim.azucar} % · Resto ${estado.sim.general} %`], [], ['Producto', 'Costo hoy', 'Costo simulado', 'Margen hoy %', 'Margen simulado %', 'Caída pp', 'Precio DEMO'],
    ...simFilas.map(f => [f.it.denominacion, r2(f.s.actual), r2(f.s.nuevo), r2(f.margen), r2(f.mg2), r2(f.caida), demo(f.pv.demo)])], [44, 14, 14, 12, 14, 10, 10]]);
  hojas.push(['Definiciones', [['Indicador', 'Fórmula', 'Fuente', 'Para decidir'], ...DEFS_KPI], [26, 60, 30, 40]]);
  descargarXlsx(`tablero-costos-${new Date().toISOString().slice(0, 10)}.xlsx`, hojas);
}
const r2 = (n) => Math.round(Number(n) * 100) / 100;

const DEFS_KPI = [
  ['Costo materia prima por kg', 'Mediana, sobre los sabores de helado (rubro SABORES sin toppings ni semielaborados), de (costo de receta de Shares − indirecto de las bases). Por kg de helado.', 'Shares (recetas)', 'Si el helado se encarece; base para precios y para negociar con proveedores.'],
  ['Food cost %', 'Σ (materia prima + packaging) / Σ precio de venta neto, de los productos con precio.', 'Shares + precios de venta', 'Si los precios acompañan al costo directo. Referencia de heladería: 25–35 %.'],
  ['Margen bruto teórico %', 'Σ (precio neto − costo total de Shares) / Σ precio neto. El costo total incluye el indirecto de fábrica.', 'Shares + precios de venta', 'Qué productos no llegan al margen objetivo y hay que repreciar o reformular.'],
  ['Precio sugerido', 'Costo total / (1 − margen objetivo). Neto de IVA.', 'Shares', 'Precio mínimo para sostener el margen objetivo.'],
  ['Inflación propia de compras', 'Por insumo: precio mediano del mes / precio mediano del mes anterior, al mismo proveedor. Promedio ponderado por lo comprado. Acumulado = producto de (1 + variación).', 'Facturas leídas', 'Si los insumos suben más o menos que la inflación general; cuándo ajustar precios.'],
  ['IPC', 'Variación mensual del nivel general, INDEC.', 'INDEC (editable)', 'Referencia contra la que se compara la canasta propia.'],
  ['Pareto de compras', 'Proveedores ordenados por neto comprado en el período (dólares a la cotización de cada factura, notas de crédito restan, facturas repetidas una sola vez).', 'Facturas', 'Con quién negociar primero: pocos proveedores explican la mayor parte del gasto.'],
  ['Subas sobre umbral', 'Insumos cuyo último precio supera al de la compra anterior al mismo proveedor en el umbral o más.', 'Facturas', 'Qué reclamar o cotizar con otro proveedor.'],
  ['What-if', 'Cada MP del grupo × (1 + variación); si una MP está en dos grupos se aplican las dos; el resto × (1 + suba general). Costo nuevo con el simulador de recetas (respeta el rendimiento); indirecto fijo. Caída = margen simulado − margen actual.', 'Shares + supuestos', 'Cuánto margen se pierde ante una suba de leche o del dólar y qué productos repreciar primero.'],
  ['Costo trazable a factura', 'Costo de MP de las recetas cuyas materias primas están unidas a un insumo con compras / costo total de MP.', 'Shares + facturas', 'Cuánto del costeo está respaldado por precios reales. Debería tender a 100 %.'],
  ['Costo teórico vs real', 'Consumo real × precio de factura − kg producidos × costo teórico por kg.', 'Requiere partes de producción', 'Mermas, desvíos de receta y robos. No disponible todavía.'],
];
