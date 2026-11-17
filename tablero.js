/* =============================================================================
 *  Tablero — Lucciano's (1.6.0)
 *  Pantalla de inicio para dirección. Solo datos reales:
 *   · Costos de recetas: Shares, explotados con explotarR / simularR de app.js (el mismo motor de toda la app).
 *   · Precios de compra: facturas de proveedores leídas por la app (/api/insumos, /api/facturas, /api/tablero).
 *   · IPC: INDEC (tabla de abajo; se actualiza desde el propio tablero).
 *   · Precios de venta: solo si se cargan (Excel). Sin precios no se muestra ningún margen: nada inventado.
 *  Las preferencias del tablero (margen objetivo, precios cargados, IPC) se guardan en el navegador.
 * ============================================================================= */
'use strict';

// IPC nacional INDEC, variación mensual %. Fuente: INDEC (el de octubre 2026 se publicó el 12/11/2026).
const IPC_INDEC = { '2026-01': 2.9, '2026-02': 2.9, '2026-03': 3.4, '2026-04': 2.6, '2026-05': 2.1, '2026-06': 1.9, '2026-07': 2.1, '2026-08': 1.7, '2026-09': 1.9, '2026-10': 2.2 };
const TB_DEF = { margenObjetivo: 60, umbralSuba: 5, dias: 90, ipc: IPC_INDEC, precios: {}, grupos: null };
// Potes del local: kg de helado por envase (por definición del producto) y el insumo de esta app que es su envase
const POTES = [{ nombre: 'Pote 1/4 kg', kg: 0.25, rx: /1\/4/ }, { nombre: 'Pote 1/2 kg', kg: 0.5, rx: /1\/2/ }, { nombre: 'Pote 1 kg', kg: 1, rx: /\b1 ?kg\b/i }];

function cfgTB() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('costos_tablero') || '{}') || {}; } catch { c = {}; }
  return { ...TB_DEF, ...c, ipc: { ...IPC_INDEC, ...(c.ipc || {}) }, precios: c.precios || {} };
}
function guardarCfgTB(c) {
  const { demo, markupDemo, ventas, ...limpio } = c;   // 1.6.0: sin DEMO (se borra lo que haya quedado de la 1.5.0)
  try { localStorage.setItem('costos_tablero', JSON.stringify(limpio)); } catch { toast('El navegador no deja guardar la configuración (modo privado).', true); }
}

const pct1 = (v) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const pp1 = (v) => v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
const mesTxt = (ym, largo = false) => { const [y, m] = ym.split('-'); const n = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(m) - 1]; return largo ? n : n.slice(0, 3) + ' ' + y.slice(2); };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mediana = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
Object.assign(ICO, {
  printer: svgI('<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8" rx="1"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>'),
  chevron: svgI('<path d="m9 6 6 6-6 6"/>'),
});

// Sabores de helado: rubro SABORES de Shares, sin los toppings y semielaborados que Shares también guarda ahí
// (granella de pistacho, scraps de alfajor, crumble, brownie…), que distorsionan el costo "por kg de helado"
const esSaborHelado = (i) => /^SABORES$/i.test(i.rubro || '') && i.costoTotal > 0 && !/SCRAP|GRANELLA|CRUMBLE|BROWNIE|CARAMELIZAD|SEMIELABORADO|TOPPING|SALSA|VARIEGATO|BA[NÑ]O/i.test(normQ(i.denominacion).toUpperCase());
// Costo variable directo: materia prima + packaging, sin indirectos (ni los de las bases)
const costoDirecto = (it, ex) => (it.costoReceta - (ex.indirectoBases || 0)) + (it.costoPackaging || 0);
const precioCargado = (c, it) => { const p = Number(c.precios[kItem(it.tipo, it.id)]); return p > 0 ? p : null; };

// ---------------------------------------------------------------------------
//  Cálculos
// ---------------------------------------------------------------------------
// Inflación de la canasta de compras, mes a mes: por insumo, mediana del mes / mediana del mes anterior AL MISMO
// proveedor (un cambio de proveedor no es inflación); promedio ponderado por lo comprado.
function inflacionCanasta(insumos) {
  const porMes = new Map();
  for (const i of insumos) {
    const s = safeJ(i.serie_json) || [];
    const peso = (Number(i.cantidad_periodo) || 0) * (Number(i.ult_precio) || 0) || Number(i.ult_precio) || 0;
    const prov = new Map();
    for (const [f, p, cuit] of s) { if (!(p > 0) || !f) continue; const ym = f.slice(0, 7); const m = prov.get(cuit) || new Map(); m.set(ym, [...(m.get(ym) || []), p]); prov.set(cuit, m); }
    const vars = new Map();
    for (const m of prov.values()) {
      const meses = [...m.keys()].sort();
      for (let k = 1; k < meses.length; k++) {
        const [ya, ma] = meses[k - 1].split('-').map(Number), [yb, mb] = meses[k].split('-').map(Number);
        if ((yb * 12 + mb) - (ya * 12 + ma) !== 1) continue;
        vars.set(meses[k], [...(vars.get(meses[k]) || []), mediana(m.get(meses[k])) / mediana(m.get(meses[k - 1])) - 1]);
      }
    }
    for (const [ym, vs] of vars) { const x = porMes.get(ym) || { suma: 0, peso: 0, n: 0 }; x.suma += peso * (vs.reduce((a, v) => a + v, 0) / vs.length); x.peso += peso; x.n++; porMes.set(ym, x); }
  }
  return [...porMes.entries()].sort().map(([ym, x]) => ({ ym, pct: x.peso ? x.suma / x.peso * 100 : null, n: x.n }));
}
// Compras por proveedor (neto en $, dólares a la cotización de la factura), sin facturas repetidas; NC restan
function comprasPorProveedor(facturas, desde) {
  const vistas = new Set(), m = new Map();
  for (const f of facturas) {
    if (f.fecha < desde || ['descartada', 'duplicada'].includes(f.lectura)) continue;
    const k = [f.cuit, f.tipo, f.pto_vta, f.numero].join('|');
    if (vistas.has(k)) continue;
    vistas.add(k);
    const sign = [3, 8, 13, 53].includes(Number(f.tipo)) ? -1 : 1;
    const ars = (Number(f.neto) || 0) * (['PES', 'ARS'].includes(String(f.moneda || 'PES').toUpperCase()) ? 1 : (Number(f.cotizacion) || 0)) * sign;
    const x = m.get(f.cuit) || { cuit: f.cuit, nombre: f.razon_social || fmtCuit(f.cuit), ars: 0, n: 0 };
    x.ars += ars; x.n++; m.set(f.cuit, x);
  }
  return [...m.values()].sort((a, b) => b.ars - a.ars);
}
// Grupos de materias primas de Shares para el "¿y si sube…?" (sugeridos por nombre; se pueden ajustar)
const RX_PACK = /ESTUCHE|CAJA|ETIQUETA|BOBINA|FAJA|TAPA|POTE|FRASCO|PALITO|BOLSA|ENVASE|FILM|PAPEL/;
const RX_GRUPOS = {
  leche: /^LECHE |LECHE EN POLVO|CREMA (DE )?LECHE|BUTTER|SUERO|DULCE DE LECHE|\bMANTECA\b(?! DE CACAO)/,
  dolar: /BARRY|CALLEBAUT|CACAO|PISTACC|AVELLAN|NUEZ|ALMENDRA|AROMITALIA|VAINILL|PALSGAARD|CREMODAN|DANISCO|LIOFILIZ|PGPR|ANTIOXIDANTE|COLORANTE/,
};
const NOMBRE_GRUPO = { leche: 'Lácteos', dolar: 'Importadas (dólar)' };
function gruposMp(c) {
  const usadas = [...R.mp.values()].filter(m => usosR().mp.has(m.id));
  const g = {};
  for (const k of Object.keys(RX_GRUPOS)) g[k] = new Set(c.grupos?.[k] || usadas.filter(m => { const n = normQ(m.denominacion).toUpperCase(); return RX_GRUPOS[k].test(n) && !RX_PACK.test(n) && !/PACKAGING/i.test(m.categoria || '') && !(k === 'leche' && /AROMITALIA|NEUTRO|AROMA|COCO/.test(n)) && !(k === 'dolar' && /GALLETITA/.test(n)); }).map(m => m.id));
  return g;
}

// ---------------------------------------------------------------------------
//  Vista
// ---------------------------------------------------------------------------
async function vistaTablero(el) {
  el.innerHTML = '<div class="vacio"><span class="cargando"></span></div>';
  let c = cfgTB();
  const [, tab, insR, facR] = await Promise.all([cargarRecetas().catch(() => null), api('/api/tablero'), api('/api/insumos'), api('/api/facturas')]);
  contadores(tab);
  const insumos = insR.insumos.filter(i => i.activo !== 0), facturas = facR.facturas;
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), mesActual = hoy.slice(0, 7);
  const hayRecetas = !!R.cat?.items?.length;
  const pts = hayRecetas ? recItems('PRODUCTO_TERMINADO') : [];
  const ex = new Map(pts.map(it => [it, explotarR(it)]));
  const sabores = pts.filter(esSaborHelado);
  const kgMp = mediana(sabores.map(i => i.costoReceta - (ex.get(i).indirectoBases || 0)));
  const kgTot = mediana(sabores.map(i => i.costoTotal));
  const infl = inflacionCanasta(insumos);
  const cerrados = infl.filter(x => x.ym < mesActual);
  const ult = cerrados.at(-1) || null;
  // Respaldo: costo de materia prima de las recetas cuyas MP tienen precio de factura (insumo unido con compras)
  let mpTot = 0, mpFac = 0;
  for (const it of pts) for (const e of ex.get(it).mp.values()) { mpTot += e.costo; if (precioRealMp(e.id)) mpFac += e.costo; }
  const respaldo = mpTot ? mpFac / mpTot * 100 : 0;
  const potes = POTES.map(p => { const env = insumos.find(i => i.unidad === 'un' && /pote|envase/i.test(i.nombre) && p.rx.test(i.nombre) && i.ult_precio > 0); return { ...p, env, costo: kgTot != null && env ? kgTot * p.kg + env.ult_precio : null }; });
  const est = { vista: 'sabores', q: '', mostrar: 10, sim: { leche: 0, dolar: 0, resto: 0 } };

  // ---- "Para mirar hoy": solo excepciones, de la más importante a la menos ----
  const F = tab.facturas || {};
  const atencion = [];
  const subas = insumos.filter(i => Number(i.var_ant) >= c.umbralSuba).sort((a, b) => b.var_ant - a.var_ant);
  for (const i of subas.slice(0, 3)) atencion.push({ n: 'neg', href: `#/insumo/${i.id}`, html: `<b>${esc(i.nombre)}</b> subió <b>${pct1(i.var_ant)}</b> contra la compra anterior <span class="muted">· ${esc(i.ult_proveedor || '')}, ${fmtF(i.ult_fecha)}</span>` });
  if (subas.length > 3) atencion.push({ n: 'neg', href: '#/alertas', html: `Y <b>${subas.length - 3}</b> insumo${subas.length - 3 > 1 ? 's' : ''} más con subas de ${pct1(c.umbralSuba)} o más` });
  if (ult && ult.n >= 10 && c.ipc[ult.ym] != null && ult.pct > c.ipc[ult.ym]) atencion.push({ n: 'warn', href: '#tb-infl', html: `En ${mesTxt(ult.ym, true)} las compras subieron <b>${pct1(ult.pct)}</b>, por encima del IPC (${pct1(c.ipc[ult.ym])})` });
  if (F.revisar || F.error) atencion.push({ n: 'warn', href: '#/facturas', html: `<b>${(F.revisar || 0) + (F.error || 0)} factura${(F.revisar || 0) + (F.error || 0) > 1 ? 's' : ''}</b> no se pudieron leer bien y no suman a los precios` });
  if (tab.vincular_grupos) atencion.push({ n: 'warn', href: '#/vincular', html: `<b>${tab.vincular_grupos}</b> productos de facturas todavía no están asignados a un insumo` });
  if (hayRecetas && respaldo < 50) atencion.push({ n: 'info', href: '#/comparar', html: respaldo < 0.5 ? 'Ningún costo de receta está respaldado por una factura: todos salen del costo cargado en Shares' : `Solo el <b>${pct1(respaldo)}</b> del costo de las recetas está respaldado por facturas` });
  if (tab.shares?.desactualizados) atencion.push({ n: 'warn', href: '#/comparar', html: `<b>${tab.shares.desactualizados}</b> materia${tab.shares.desactualizados > 1 ? 's primas tienen' : ' prima tiene'} en Shares un costo ${tab.shares.umbral} % o más lejos de la última compra` });

  const pintar = () => {
    c = cfgTB();
    const conPrecios = pts.some(it => precioCargado(c, it));
    const mo = Math.min(95, Math.max(0, c.margenObjetivo)) / 100;
    const desde = new Date(Date.now() - 3 * 3600e3 - c.dias * 864e5).toISOString().slice(0, 10);
    const provs = comprasPorProveedor(facturas, desde), totC = provs.reduce((s, x) => s + x.ars, 0);
    let acum = 0, n80 = 0; for (const p of provs) { if (acum >= totC * 0.8) break; acum += p.ars; n80++; }

    // Margen real (solo con precios cargados)
    const conP = pts.map(it => ({ it, p: precioCargado(c, it) })).filter(x => x.p);
    const sumP = conP.reduce((s, x) => s + x.p, 0);
    const margen = sumP ? conP.reduce((s, x) => s + (x.p - x.it.costoTotal), 0) / sumP * 100 : null;

    // Lista de costo por producto
    const filas = est.vista === 'potes' ? [] : (est.vista === 'sabores' ? sabores : pts)
      .filter(it => !est.q || normQ(`${it.denominacion} ${it.rubro} ${it.id}`).includes(normQ(est.q)))
      .sort((a, b) => b.costoTotal - a.costoTotal);

    // ¿Y si sube…?
    const G = hayRecetas ? gruposMp(c) : { leche: new Set(), dolar: new Set() };
    const cambios = new Map();
    for (const k of ['leche', 'dolar']) if (est.sim[k]) for (const id of G[k]) { const m = R.mp.get(id); if (m?.costo > 0) cambios.set(id, (cambios.get(id) ?? m.costo) * (1 + est.sim[k] / 100)); }
    const haySim = Object.values(est.sim).some(Boolean);
    const sim = haySim ? sabores.map(it => ({ it, s: simularR(it, cambios, est.sim.resto) })).sort((a, b) => b.s.pct - a.s.pct) : [];
    const simProm = sim.length ? mediana(sim.map(x => x.s.pct)) : null;

    const tile = (href, et, val, sub, clase = '') => `<a class="kpi tb-kpi ${clase}" href="${href}"><div class="et">${et}</div><div class="val">${val}</div><div class="sub">${sub}</div></a>`;
    const maxP = provs[0]?.ars || 1;
    const vals = infl.flatMap(x => [Math.abs(x.pct || 0), Math.abs(c.ipc[x.ym] || 0)]), maxI = Math.max(1, ...vals);

    el.innerHTML = `<div class="encabezado tb-enc"><div><h1>Tablero</h1><p>Datos al ${fmtF(hoy)}${R.cat?.sync?.PRODUCTO_TERMINADO?.at ? ` · recetas de Shares del ${fmtFH(R.cat.sync.PRODUCTO_TERMINADO.at)}` : ''}</p></div>
      <div class="acciones no-print"><button class="btn btn-chico" id="tb-xls">${ICO.download}Excel</button><button class="btn btn-chico" id="tb-pdf">${ICO.printer}Imprimir</button></div></div>

      <section class="panel tb-hoy" aria-labelledby="tb-hoy-t"><div class="panel-titulo"><h2 id="tb-hoy-t">Para mirar hoy</h2></div>
        ${atencion.length ? `<ul class="tb-lista">${atencion.map(a => `<li><a href="${a.href}"><span class="tb-punto ${a.n}" aria-hidden="true"></span><span class="tb-txt">${a.html}</span>${ICO.chevron}</a></li>`).join('')}</ul>`
          : `<div class="vacio">${ICO.check} Nada fuera de lo normal: sin subas sobre el ${pct1(c.umbralSuba)} y todas las facturas leídas.</div>`}</section>

      <div class="kpis tb-kpis">
        ${tile('#tb-prod', 'Kilo de helado', kgTot != null ? $$m(kgTot) : '—', kgMp != null ? `${$$m(kgMp)} de materia prima · mediana de ${sabores.length} sabores` : 'Faltan las recetas de Shares')}
        ${tile('#tb-infl', ult ? `Compras en ${mesTxt(ult.ym, true)}` : 'Inflación de compras', ult ? pct1(ult.pct) : '—', ult ? `IPC ${pct1(c.ipc[ult.ym])}${ult.n < 10 ? ` · solo ${ult.n} insumos comparables` : ''}` : 'Hace falta más de un mes de compras', ult && ult.n >= 10 && ult.pct > (c.ipc[ult.ym] ?? 99) ? 'alerta' : '')}
        ${margen != null ? tile('#tb-prod', 'Margen bruto', pct1(margen), `${conP.length} productos con precio · objetivo ${pct1(c.margenObjetivo)}`, margen < c.margenObjetivo ? 'alerta' : 'ok')
          : tile('#tb-plata', `Compras · ${c.dias} días`, $$corto(totC), provs[0] ? `${esc(provs[0].nombre)}: ${pct1(provs[0].ars / totC * 100)}` : 'Sin facturas en el período')}
        ${tile('#/comparar', 'Respaldado por facturas', pct1(respaldo), 'del costo de materia prima de las recetas', respaldo < 50 ? 'alerta' : '')}
      </div>

      <section class="panel" id="tb-prod" aria-labelledby="tb-prod-t"><div class="panel-titulo tb-tit-wrap"><h2 id="tb-prod-t">Costo por producto</h2>
          <div class="tb-ctrl no-print"><div class="seg" role="tablist">${[['sabores', 'Sabores'], ['potes', 'Potes del local'], ['todos', 'Todo']].map(([k, t]) => `<button role="tab" aria-selected="${est.vista === k}" data-v="${k}" class="${est.vista === k ? 'on' : ''}">${t}</button>`).join('')}</div>
            ${est.vista !== 'potes' ? `<label class="campo-buscar">${ICO.search}<input id="tb-q" placeholder="Buscar" value="${esc(est.q)}" aria-label="Buscar producto"></label>` : ''}</div></div>
        <div class="tb-objetivo"><label for="tb-mo">Precio sugerido para un margen de</label><span class="tb-pct"><input id="tb-mo" type="number" min="0" max="95" step="1" value="${c.margenObjetivo}"><span>%</span></span>
          <span class="muted small">${conPrecios ? `${conP.length} productos con precio de venta cargado.` : 'Cargá la lista de precios para ver el margen real de cada producto.'}</span>
          <button class="btn btn-ghost btn-chico no-print" id="tb-precios">${ICO.upload}${conPrecios ? 'Precios de venta' : 'Cargar precios de venta'}</button></div>
        <div class="tabla-wrap"><table class="tb-tabla"><thead><tr><th>Producto</th><th class="num tb-mp">Materia prima${est.vista === 'potes' ? '' : ' y packaging'}</th><th class="num">Costo total</th><th class="num">Precio sugerido</th>${conPrecios ? '<th class="num">Precio actual</th><th class="num">Margen</th>' : ''}</tr></thead><tbody>
        ${est.vista === 'potes' ? potes.map(p => `<tr><td><b>${esc(p.nombre)}</b><small class="sub-celda">${fmtCant.format(p.kg)} kg de helado + ${p.env ? esc(p.env.nombre) : 'envase sin precio'}</small></td>
            <td class="num tb-mp">${p.env && kgMp != null ? $$m(kgMp * p.kg + p.env.ult_precio) : '—'}</td><td class="num"><b>${p.costo != null ? $$m(p.costo) : '—'}</b></td><td class="num">${p.costo != null && mo < 1 ? $$m(p.costo / (1 - mo)) : '—'}</td>${conPrecios ? '<td class="num">—</td><td class="num">—</td>' : ''}</tr>`).join('')
          : filas.slice(0, est.mostrar).map(it => { const e = ex.get(it), p = precioCargado(c, it), m = p ? (p - it.costoTotal) / p * 100 : null;
            return `<tr class="click" data-href="#/receta/${it.tipo}/${it.id}"><td><b>${esc(it.denominacion)}</b><small class="sub-celda">${esc(it.rubro || '')}${e.lote ? ' · receta por lote' : ''}</small></td>
              <td class="num tb-mp">${$$m(costoDirecto(it, e))}</td><td class="num"><b>${$$m(it.costoTotal)}</b></td><td class="num">${mo < 1 ? $$m(it.costoTotal / (1 - mo)) : '—'}</td>
              ${conPrecios ? `<td class="num">${p ? $$m(p) : '<span class="muted">—</span>'}</td><td class="num ${m != null && m < c.margenObjetivo ? 'txt-neg' : ''}">${m != null ? pct1(m) : '—'}</td>` : ''}</tr>`; }).join('') || `<tr><td colspan="6" class="vacio">${hayRecetas ? 'Nada con esa búsqueda.' : 'Faltan las recetas de Shares.'}</td></tr>`}
        </tbody></table></div>
        <p class="small muted tb-pie">${est.vista === 'potes' ? `Helado al costo mediano de los sabores (${kgTot != null ? $$m(kgTot) : '—'} el kg, con indirectos) más el último precio pagado por el pote.`
          : `${filas.length > est.mostrar ? `Mostrando ${est.mostrar} de ${filas.length}. <button class="btn-link" id="tb-mas">Ver todos</button> · ` : ''}Costos de Shares por unidad (los sabores, por kg), netos de IVA. Precio sugerido = costo total ÷ (1 − margen).`}</p>
      </section>

      <div class="dos">
        <section class="panel" id="tb-infl" aria-labelledby="tb-infl-t"><div class="panel-titulo"><h2 id="tb-infl-t">Compras vs IPC</h2><button class="btn btn-ghost btn-chico no-print" id="tb-ipc">Actualizar IPC</button></div>
          <div class="panel-pad">${infl.length ? `<div class="tb-meses">${infl.map(x => { const ipc = c.ipc[x.ym]; return `<div class="tb-mes"><div class="tb-mes-n">${mesTxt(x.ym)}${x.ym === mesActual ? '<small>en curso</small>' : ''}</div>
              <div class="tb-par"><span class="tb-bar compras" style="width:${Math.max(2, Math.abs(x.pct || 0) / maxI * 100)}%"></span><b>${pct1(x.pct)}</b><span class="muted small">compras · ${x.n} insumo${x.n > 1 ? 's' : ''}</span></div>
              <div class="tb-par">${ipc != null ? `<span class="tb-bar ipc" style="width:${Math.max(2, Math.abs(ipc) / maxI * 100)}%"></span><b>${pct1(ipc)}</b><span class="muted small">IPC</span>` : '<span class="muted small">IPC sin publicar</span>'}</div></div>`; }).join('')}</div>
            <p class="small muted" style="margin:12px 0 0">Cada insumo contra su precio del mes anterior al mismo proveedor, ponderado por lo comprado. ${cerrados.some(x => x.n < 10) ? 'Con menos de 10 insumos por mes el dato todavía es indicativo.' : ''}</p>`
            : '<div class="vacio">Hace falta más de un mes de facturas para comparar.</div>'}</div></section>

        <section class="panel" id="tb-plata" aria-labelledby="tb-plata-t"><div class="panel-titulo"><h2 id="tb-plata-t">En quién se va la plata</h2>
            <select id="tb-dias" class="no-print" aria-label="Período">${[30, 90, 180, 365].map(x => `<option value="${x}" ${x === c.dias ? 'selected' : ''}>${x} días</option>`).join('')}</select></div>
          <div class="panel-pad">${provs.length ? `<p class="tb-frase"><b>${n80} de ${provs.length}</b> proveedores explican el 80 % de los ${$$corto(totC)} comprados.</p>
            <ol class="tb-barras">${provs.slice(0, 8).map(p => `<li><span class="tb-bn">${esc(p.nombre)}</span><span class="tb-bt"><span style="width:${p.ars / maxP * 100}%"></span></span><span class="tb-bv">${$$corto(p.ars)}</span><span class="tb-bp muted">${pct1(p.ars / totC * 100)}</span></li>`).join('')}</ol>`
            : '<div class="vacio">Sin facturas en el período.</div>'}</div></section>
      </div>

      <div class="dos">
        <section class="panel" id="tb-sim" aria-labelledby="tb-sim-t"><div class="panel-titulo"><h2 id="tb-sim-t">¿Y si sube…?</h2>${haySim ? '<button class="btn btn-ghost btn-chico no-print" id="tb-sim-0">Limpiar</button>' : ''}</div>
          <div class="panel-pad"><div class="tb-sim-in no-print">
            ${[['leche', 'Lácteos'], ['dolar', 'Dólar'], ['resto', 'Resto de la materia prima']].map(([k, t]) => `<label class="tb-sim-c"><span>${t}${k !== 'resto' ? ` <button class="btn-link small" data-grupo="${k}" title="Ver qué materias primas entran">${G[k].size} MP</button>` : ''}</span><span class="tb-pct"><input id="sim-${k}" type="number" step="1" value="${est.sim[k] || ''}" placeholder="0" inputmode="decimal"><span>%</span></span></label>`).join('')}</div>
            ${haySim ? `<p class="tb-frase">El kilo de helado sube <b>${pct1(simProm)}</b> en la mediana de los sabores${conPrecios ? '' : ''}.</p>
              <ul class="tb-top">${sim.slice(0, 5).map(x => `<li data-href="#/receta/${x.it.tipo}/${x.it.id}" tabindex="0"><span>${esc(x.it.denominacion)}</span><b>+${pct1(x.s.pct)}</b><span class="muted small">${$$m(x.s.actual)} → ${$$m(x.s.nuevo)}</span></li>`).join('')}</ul>`
            : '<p class="small muted" style="margin:10px 0 0">Poné cuánto podría subir cada grupo y te muestro cuánto pega en el costo de cada sabor. Los costos indirectos quedan fijos.</p>'}</div></section>

        <section class="panel" id="tb-prov" aria-labelledby="tb-prov-t"><div class="panel-titulo"><h2 id="tb-prov-t">Mismo insumo, otro proveedor</h2></div>
          <div id="tb-prov-c"><div class="vacio"><span class="cargando"></span></div></div></section>
      </div>
      <p class="small muted tb-pie-pag"><button class="btn-link" id="tb-defs">Cómo se calcula cada número</button></p>`;

    // ---- eventos ----
    irA(el);
    $$('.tb-top li[data-href]', el).forEach(li => { li.onclick = () => { location.hash = li.dataset.href; }; li.onkeydown = (e) => { if (e.key === 'Enter') li.click(); }; });
    $$('a[href^="#tb-"]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); $(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $$('[data-v]', el).forEach(b => b.onclick = () => { est.vista = b.dataset.v; est.mostrar = 10; pintar(); });
    const q = $('#tb-q'); let tq;
    if (q) q.oninput = () => { clearTimeout(tq); tq = setTimeout(() => { est.q = q.value; pintar(); const i = $('#tb-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    const mas = $('#tb-mas'); if (mas) mas.onclick = () => { est.mostrar = 10000; pintar(); };
    $('#tb-mo').onchange = (e) => { const x = cfgTB(); x.margenObjetivo = Math.min(95, Math.max(0, Number(e.target.value) || 0)); guardarCfgTB(x); pintar(); };
    $('#tb-dias').onchange = (e) => { const x = cfgTB(); x.dias = Number(e.target.value); guardarCfgTB(x); pintar(); };
    for (const k of Object.keys(est.sim)) { const i = $('#sim-' + k); i.onchange = () => { est.sim[k] = parseFloat(String(i.value).replace(',', '.')) || 0; pintar(); $('#tb-sim')?.scrollIntoView({ block: 'nearest' }); }; }
    const s0 = $('#tb-sim-0'); if (s0) s0.onclick = () => { est.sim = { leche: 0, dolar: 0, resto: 0 }; pintar(); };
    $$('[data-grupo]', el).forEach(b => b.onclick = (e) => { e.preventDefault(); modalGrupoMp(b.dataset.grupo, G, pintar); });
    $('#tb-precios').onclick = () => modalPrecios(pintar);
    $('#tb-ipc').onclick = () => modalIpc(infl, pintar);
    $('#tb-defs').onclick = () => modal(`<h2>Cómo se calcula cada número</h2><div class="tabla-wrap"><table class="sin-orden"><thead><tr><th>Número</th><th>Cálculo</th><th>De dónde sale</th></tr></thead><tbody>${DEFS_KPI.map(x => `<tr><td><b>${esc(x[0])}</b></td><td class="small">${esc(x[1])}</td><td class="small">${esc(x[2])}</td></tr>`).join('')}</tbody></table></div>`, { ancho: true });
    $('#tb-pdf').onclick = () => window.print();
    $('#tb-xls').onclick = () => exportarTablero({ c, pts, ex, potes, kgMp, infl, provs, subas, sim, est, conPrecios });
    pintarProveedores(insumos);
  };
  pintar();
}

// Mismo insumo comprado a más de un proveedor: último precio de cada uno contra el más barato
let provCache = null;
async function pintarProveedores(insumos) {
  const cont = $('#tb-prov-c'); if (!cont) return;
  if (!provCache) {
    const multi = insumos.filter(i => i.proveedores > 1 || (safeJ(i.serie_json) || []).some(x => x[2] && x[2] !== i.ult_cuit)).slice(0, 12);
    const det = await Promise.all(multi.map(i => api('/api/insumos/' + i.id).catch(() => null)));
    provCache = multi.map((i, k) => { const por = new Map(); for (const x of det[k]?.compras || []) { const p = por.get(x.cuit); if (!p || x.fecha > p.fecha) por.set(x.cuit, x); }
      return { i, ps: [...por.values()].filter(x => x.precio > 0).sort((a, b) => a.precio - b.precio) }; }).filter(x => x.ps.length > 1)
      .sort((a, b) => (b.ps.at(-1).precio / b.ps[0].precio) - (a.ps.at(-1).precio / a.ps[0].precio));
    setTimeout(() => { provCache = null; }, 5 * 60e3);
  }
  const c2 = $('#tb-prov-c'); if (!c2) return;
  c2.innerHTML = provCache.length ? `<ul class="feed">${provCache.map(({ i, ps }) => { const caro = ps.at(-1), barato = ps[0];
    return `<li data-href="#/insumo/${i.id}" tabindex="0">${cuad(i.nombre)}<div style="min-width:0"><div class="t">${esc(i.nombre)}</div><div class="d">Más barato: ${esc(barato.proveedor || fmtCuit(barato.cuit))} ${fmtP(barato.precio, i.unidad)} · más caro: ${esc(caro.proveedor || fmtCuit(caro.cuit))}</div></div>
      <div class="r">${chipVar((caro.precio / barato.precio - 1) * 100, { titulo: 'El más caro contra el más barato' })}</div></li>`; }).join('')}</ul>`
    : '<div class="vacio">Todavía no hay insumos comprados a más de un proveedor.</div>';
  $$('li[data-href]', c2).forEach(li => { li.onclick = () => { location.hash = li.dataset.href; }; li.onkeydown = (e) => { if (e.key === 'Enter') li.click(); }; });
}

function modalGrupoMp(k, G, alCerrar) {
  const usadas = [...R.mp.values()].filter(m => usosR().mp.has(m.id)).sort((a, b) => (G[k].has(b.id) - G[k].has(a.id)) || a.denominacion.localeCompare(b.denominacion, 'es'));
  modal(`<h2>${esc(NOMBRE_GRUPO[k])}</h2><p class="muted">Las materias primas de Shares que suben juntas en el cálculo. ${k === 'dolar' ? 'Son las importadas o con precio en dólares: revisalo con Compras.' : ''}</p>
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

function modalPrecios(alCerrar) {
  const c = cfgTB(), n = Object.keys(c.precios).length;
  modal(`<h2>Precios de venta</h2><p class="muted">Un Excel o CSV con el código del producto de Shares en la primera columna y el precio neto de IVA en la última. ${n ? `Hay ${n} cargados.` : 'Todavía no hay ninguno.'} Se guardan en este navegador.</p>
    <div class="acciones" style="margin-top:14px"><label class="btn btn-negro">${ICO.upload}Subir archivo<input type="file" id="c-file" accept=".xlsx,.xls,.csv" hidden></label><button class="btn" id="c-plant">${ICO.download}Bajar plantilla</button>${n ? '<button class="btn btn-rojo" id="c-borrar">Borrar precios</button>' : ''}</div>`, {
    alMontar: (m, cerrar) => {
      $('#c-plant', m).onclick = () => descargarXlsx('plantilla-precios-venta.xlsx', [['Precios', [['codigo', 'producto', 'precio_neto'], ...recItems('PRODUCTO_TERMINADO').map(i => [i.id, i.denominacion, cfgTB().precios[kItem(i.tipo, i.id)] ?? ''])], [10, 50, 14]]]);
      const b = $('#c-borrar', m); if (b) b.onclick = async () => { if (!await confirmar('Se borran los precios de venta cargados en este navegador.')) return; const x = cfgTB(); x.precios = {}; guardarCfgTB(x); cerrar(); toast('Precios borrados'); alCerrar(); };
      $('#c-file', m).onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          if (!window.XLSX) throw new Error('No cargó la librería de Excel.');
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
          const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
          const x = cfgTB(); let ok = 0, malas = 0;
          for (const r of filas) {
            const cod = Number(String(r[0] ?? '').trim()); let p = r[r.length - 1];
            if (typeof p === 'string') p = Number(p.replace(/\$|\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));   // "12.345,67" → 12345.67
            if (!Number.isInteger(cod) || !cod) continue;   // encabezado o renglón vacío
            if (!R.porKey.has(kItem('PRODUCTO_TERMINADO', cod)) || !(p > 0)) { malas++; continue; }
            x.precios[kItem('PRODUCTO_TERMINADO', cod)] = p; ok++;
          }
          guardarCfgTB(x); toast(`${ok} precios cargados${malas ? ` · ${malas} renglones con código inexistente o precio inválido` : ''}`); cerrar(); alCerrar();
        } catch (err) { toast('No pude leer el archivo: ' + err.message, true); }
      };
    },
  });
}

function modalIpc(infl, alCerrar) {
  const c = cfgTB();
  const meses = [...new Set([...Object.keys(c.ipc), ...infl.map(x => x.ym)])].sort().slice(-12);
  modal(`<h2>IPC del INDEC</h2><p class="muted">Variación mensual del nivel general. Se completa cuando el INDEC publica cada mes.</p>
    <div class="tb-ipc-grid">${meses.map(ym => `<label>${mesTxt(ym)}<span class="tb-pct"><input data-ipc="${ym}" type="number" step="0.1" value="${c.ipc[ym] ?? ''}"><span>%</span></span></label>`).join('')}</div>
    <div class="acciones" style="margin-top:16px;justify-content:flex-end"><button class="btn btn-negro" id="i-ok">Guardar</button></div>`, {
    alMontar: (m, cerrar) => {
      $('#i-ok', m).onclick = () => { const x = cfgTB(); $$('[data-ipc]', m).forEach(i => { const v = parseFloat(String(i.value).replace(',', '.')); if (Number.isFinite(v)) x.ipc[i.dataset.ipc] = v; else delete x.ipc[i.dataset.ipc]; }); guardarCfgTB(x); cerrar(); alCerrar(); };
    },
  });
}

function exportarTablero({ c, pts, ex, potes, kgMp, infl, provs, subas, sim, est, conPrecios }) {
  const mo = c.margenObjetivo / 100;
  const hojas = [
    ['Costo por producto', [['Código', 'Producto', 'Rubro', 'Materia prima y packaging', 'Costo total (Shares)', `Precio sugerido (margen ${c.margenObjetivo} %)`, ...(conPrecios ? ['Precio actual', 'Margen %'] : []), 'Receta por lote'],
      ...pts.map(it => { const e = ex.get(it), p = precioCargado(c, it); return [it.id, it.denominacion, it.rubro, r2(costoDirecto(it, e)), r2(it.costoTotal), mo < 1 ? r2(it.costoTotal / (1 - mo)) : '', ...(conPrecios ? [p ?? '', p ? r2((p - it.costoTotal) / p * 100) : ''] : []), e.lote ? `sí (${r2(e.rendimiento)} u.)` : '']; })], [9, 44, 18, 16, 16, 18, 12, 10, 14]],
    ['Potes del local', [['Producto', 'kg de helado', 'Envase', 'Precio del envase', 'Costo total', `Precio sugerido (margen ${c.margenObjetivo} %)`], ...potes.map(p => [p.nombre, p.kg, p.env?.nombre ?? '', p.env?.ult_precio ?? '', p.costo != null ? r2(p.costo) : '', p.costo != null && mo < 1 ? r2(p.costo / (1 - mo)) : ''])], [16, 12, 26, 16, 14, 18]],
    ['Compras vs IPC', [['Mes', 'Compras %', 'IPC INDEC %', 'Insumos comparables'], ...infl.map(x => [x.ym, x.pct != null ? r2(x.pct) : '', c.ipc[x.ym] ?? '', x.n])], [10, 12, 12, 18]],
    ['Proveedores', [['Proveedor', 'CUIT', 'Neto $', '% del total', '% acumulado'], ...(() => { const t = provs.reduce((s, p) => s + p.ars, 0); let a = 0; return provs.map(p => { a += p.ars; return [p.nombre, p.cuit, r2(p.ars), r2(p.ars / t * 100), r2(a / t * 100)]; }); })()], [40, 14, 16, 10, 12]],
    ['Subas', [['Insumo', 'Proveedor', 'Fecha', 'Precio anterior', 'Precio actual', 'Variación %'], ...subas.map(i => [i.nombre, i.ult_proveedor, i.ult_fecha, r2(i.ant_precio), r2(i.ult_precio), r2(i.var_ant)])], [30, 30, 12, 14, 14, 12]],
  ];
  if (sim.length) hojas.push(['Y si sube', [['Supuestos', `Lácteos ${est.sim.leche} % · Dólar ${est.sim.dolar} % · Resto ${est.sim.resto} %`], [], ['Sabor', 'Costo hoy', 'Costo simulado', 'Suba %'], ...sim.map(x => [x.it.denominacion, r2(x.s.actual), r2(x.s.nuevo), r2(x.s.pct)])], [44, 14, 14, 10]]);
  hojas.push(['Cómo se calcula', [['Número', 'Cálculo', 'De dónde sale'], ...DEFS_KPI], [26, 70, 30]]);
  descargarXlsx(`tablero-costos-${new Date().toISOString().slice(0, 10)}.xlsx`, hojas);
}

const DEFS_KPI = [
  ['Kilo de helado', 'Mediana del costo total de Shares de los sabores de helado (rubro SABORES sin toppings ni semielaborados). Debajo, la mediana de la materia prima sola (sin indirectos de fábrica ni de las bases).', 'Recetas de Shares'],
  ['Compras del mes vs IPC', 'Para cada insumo, el precio mediano del mes contra el del mes anterior, al mismo proveedor; promedio ponderado por lo comprado. Con menos de 10 insumos comparables se aclara.', 'Facturas leídas · INDEC'],
  ['Compras del período', 'Neto de las facturas de materia prima del período; dólares a la cotización de cada factura, notas de crédito restan, facturas repetidas una sola vez.', 'Facturas'],
  ['Respaldado por facturas', 'Parte del costo de materia prima de todas las recetas cuyas materias primas están unidas a un insumo con compras.', 'Shares + facturas'],
  ['Margen bruto', 'Solo con precios cargados: Σ (precio neto − costo total) / Σ precio neto.', 'Shares + lista de precios'],
  ['Precio sugerido', 'Costo total / (1 − margen objetivo). Neto de IVA.', 'Recetas de Shares'],
  ['Potes del local', 'kg de helado del pote × costo mediano del kg de helado + último precio pagado por el envase.', 'Shares + facturas'],
  ['¿Y si sube…?', 'Cada materia prima del grupo × (1 + suba); el resto × (1 + suba del resto). Indirectos fijos. Respeta las recetas cargadas por lote.', 'Recetas de Shares'],
  ['Mismo insumo, otro proveedor', 'Último precio de cada proveedor del insumo contra el más barato.', 'Facturas'],
];
