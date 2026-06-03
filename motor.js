(function () {
'use strict';

/**
 * motor.js — Motor de Reabastecimiento DDI v2.0
 * Añadido: proyección semanal + pedidos con fecha de llegada
 */

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

const DDI_COLORS = [
  { max: 0,        color: '#dc2626', label: 'Crítico',     bg: '#fef2f2' },
  { max: 7,        color: '#ea580c', label: 'Muy Bajo',    bg: '#fff7ed' },
  { max: 14,       color: '#ca8a04', label: 'Bajo',        bg: '#fefce8' },
  { max: 21,       color: '#16a34a', label: 'Normal',      bg: '#f0fdf4' },
  { max: 30,       color: '#2563eb', label: 'Adecuado',    bg: '#eff6ff' },
  { max: 45,       color: '#0284c7', label: 'Bueno',       bg: '#f0f9ff' },
  { max: 60,       color: '#65a30d', label: 'Exceso Leve', bg: '#f7fee7' },
  { max: Infinity, color: '#292524', label: 'Exceso',      bg: '#f5f5f4' }
];

const DB_KEY = 'replenishment_db_v2';

// ═══════════════════════════════════════════════════════════
// BASE DE DATOS LOCAL
// ═══════════════════════════════════════════════════════════

const DB = {
  _data: null,

  _defaultData() {
    return {
      skus: [],
      destinations: [
        { id: 'galapa', name: 'Galapa', active: true },
        { id: 'bogota', name: 'Bogotá', active: true }
      ],
      suppliers: [],
      matrix: [],
      params: [],
      inventory: [],
      // NUEVO v2: pedidos en camino con fecha exacta de llegada
      // { id, skuId, destId, supplierId, qty, arrivalDate (YYYY-MM-DD), notes }
      orders: [],
      meta: { lastImport: null, version: '2.0' }
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this._data = raw ? JSON.parse(raw) : this._defaultData();
      // Migración v1 → v2: añadir campo orders si no existe
      if (!this._data.orders) this._data.orders = [];
    } catch(e) {
      console.error('Error cargando DB:', e);
      this._data = this._defaultData();
    }
    return this._data;
  },

  save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this._data));
    } catch(e) {
      console.error('Error guardando DB:', e);
    }
  },

  get() {
    if (!this._data) this.load();
    return this._data;
  },

  reset() {
    this._data = this._defaultData();
    this.save();
  }
};

// ═══════════════════════════════════════════════════════════
// UTILIDADES DE FECHA
// ═══════════════════════════════════════════════════════════

const DateUtils = {
  /** Hoy al inicio del día (sin hora) */
  today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },

  /** Parsea YYYY-MM-DD a Date */
  parse(str) {
    if (!str) return null;
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  /** Formatea Date a YYYY-MM-DD */
  toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  /** Formatea Date a "dd-mmm" en español */
  toShort(date) {
    const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return `${date.getDate()}-${months[date.getMonth()]}`;
  },

  /** Diferencia en días entre dos fechas */
  diffDays(a, b) {
    return Math.round((b - a) / 86400000);
  },

  /** Inicio de semana (lunes) de una fecha dada */
  weekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=dom, 1=lun...
    const diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  /** Añadir días a una fecha */
  addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  },

  /**
   * Genera array de semanas desde hoy hasta N semanas adelante
   * Cada semana: { weekStart, weekEnd, label }
   */
  getWeeks(weeksAhead = 10) {
    const today = this.today();
    const start = this.weekStart(today);
    const weeks = [];
    for (let i = 0; i < weeksAhead; i++) {
      const ws = this.addDays(start, i * 7);
      const we = this.addDays(ws, 6);
      weeks.push({
        weekStart: ws,
        weekEnd:   we,
        label:     this.toShort(we),  // etiqueta = fin de semana (domingo)
        labelFull: `${this.toShort(ws)} – ${this.toShort(we)}`
      });
    }
    return weeks;
  }
};

// ═══════════════════════════════════════════════════════════
// MOTOR DE CÁLCULO DDI
// ═══════════════════════════════════════════════════════════

const Engine = {

  getDDIColor(ddi) {
    if (ddi === null || ddi === undefined || isNaN(ddi)) {
      return { color: '#94a3b8', label: 'Sin datos', bg: '#f8fafc' };
    }
    for (const band of DDI_COLORS) {
      if (ddi <= band.max) return band;
    }
    return DDI_COLORS[DDI_COLORS.length - 1];
  },

  calcDDI(inventory, dailyDemand) {
    if (!dailyDemand || dailyDemand === 0) return null;
    return inventory / dailyDemand;
  },

  calcTargetInventory(dailyDemand, targetDDI) {
    return dailyDemand * targetDDI;
  },

  /** Total de pedidos en camino (suma de orders) para un SKU+Destino */
  getTotalIncoming(skuId, destId) {
    const db = DB.get();
    const today = DateUtils.today();
    return db.orders
      .filter(o => o.skuId === skuId && o.destId === destId)
      .filter(o => {
        const arr = DateUtils.parse(o.arrivalDate);
        return arr && arr >= today; // Solo pedidos que aún no han llegado
      })
      .reduce((sum, o) => sum + (o.qty || 0), 0);
  },

  /**
   * Proyección de inventario al final de N días desde hoy,
   * descontando demanda y sumando pedidos que llegan en ese lapso.
   */
  calcProjectedAtDays(skuId, destId, days) {
    const db = DB.get();
    const inv = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};
    const currentInv   = inv.inventory    || 0;
    const committedInv = inv.committedInv || 0;
    const dailyDemand  = inv.dailyDemand  || 0;

    const today   = DateUtils.today();
    const cutoff  = DateUtils.addDays(today, days);

    // Pedidos que llegan ANTES o EN el día de corte
    const incoming = db.orders
      .filter(o => o.skuId === skuId && o.destId === destId)
      .filter(o => {
        const arr = DateUtils.parse(o.arrivalDate);
        return arr && arr >= today && arr <= cutoff;
      })
      .reduce((sum, o) => sum + (o.qty || 0), 0);

    const available = currentInv - committedInv;
    return available - (dailyDemand * days) + incoming;
  },

  /**
   * NUEVO: Proyección semanal completa para un SKU+Destino
   * Devuelve array de semanas con disponibilidad proyectada y DDI
   */
  calcWeeklyProjection(skuId, destId, weeksAhead = 10) {
    const db = DB.get();
    const inv = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};
    const sku  = db.skus.find(s => s.id === skuId);
    const dest = db.destinations.find(d => d.id === destId);

    const dailyDemand  = inv.dailyDemand  || 0;
    const currentInv   = inv.inventory    || 0;
    const committedInv = inv.committedInv || 0;
    const targetDDI    = (db.params.find(p => p.skuId === skuId && p.destId === destId) || {}).targetDDI
                         || sku?.targetDDI || 30;

    const today = DateUtils.today();
    const weeks = DateUtils.getWeeks(weeksAhead);

    // Pedidos futuros ordenados por fecha
    const futureOrders = db.orders
      .filter(o => o.skuId === skuId && o.destId === destId)
      .filter(o => {
        const arr = DateUtils.parse(o.arrivalDate);
        return arr && arr >= today;
      })
      .sort((a, b) => new Date(a.arrivalDate) - new Date(b.arrivalDate));

    const baseAvailable = currentInv - committedInv;

    return weeks.map(week => {
      const daysToEnd = DateUtils.diffDays(today, week.weekEnd);
      const daysToStart = DateUtils.diffDays(today, week.weekStart);

      // Pedidos que llegan durante esta semana específica
      const ordersThisWeek = futureOrders.filter(o => {
        const arr = DateUtils.parse(o.arrivalDate);
        return arr >= week.weekStart && arr <= week.weekEnd;
      });

      // Pedidos que llegan hasta el final de esta semana (acumulado)
      const ordersAccumulated = futureOrders
        .filter(o => {
          const arr = DateUtils.parse(o.arrivalDate);
          return arr >= today && arr <= week.weekEnd;
        })
        .reduce((sum, o) => sum + (o.qty || 0), 0);

      // Inventario al final del domingo de esta semana
      const projInv = Math.max(
        baseAvailable - (dailyDemand * Math.max(daysToEnd, 0)) + ordersAccumulated,
        baseAvailable - (dailyDemand * Math.max(daysToEnd, 0)) + ordersAccumulated  // sin floor
      );

      const projDDI   = dailyDemand > 0 ? projInv / dailyDemand : null;
      const ddiColor  = this.getDDIColor(projDDI);
      const isAtRisk  = projDDI !== null && projDDI <= 7;
      const isCritical= projDDI !== null && projDDI <= 0;

      return {
        ...week,
        daysToEnd,
        projInv:   Math.round(projInv),
        projDDI,
        ddiColor,
        isAtRisk,
        isCritical,
        targetDDI,
        ordersThisWeek,               // pedidos que llegan esta semana
        ordersAccumulated,            // acumulado hasta esta semana
        weeklyConsumption: Math.round(dailyDemand * 7)
      };
    });
  },

  normalizeSupplierWeights(skuId, destId) {
    const db = DB.get();
    const validEntries = db.matrix.filter(m =>
      m.skuId === skuId && m.destId === destId && m.active
    );
    if (!validEntries.length) return [];
    const totalWeight = validEntries.reduce((sum, m) => sum + (m.weight || 0), 0);
    if (!totalWeight) return validEntries.map(m => ({ ...m, normalizedWeight: 1 / validEntries.length }));
    return validEntries.map(m => ({ ...m, normalizedWeight: (m.weight || 0) / totalWeight }));
  },

  calcSupplierDistribution(skuId, destId, totalPurchase) {
    const normalizedSuppliers = this.normalizeSupplierWeights(skuId, destId);
    const db = DB.get();
    return normalizedSuppliers.map(entry => {
      const supplier = db.suppliers.find(s => s.id === entry.supplierId);
      return {
        supplierId:      entry.supplierId,
        supplierName:    supplier?.name || entry.supplierId,
        leadTime:        entry.leadTime || 0,
        weight:          entry.weight || 0,
        normalizedWeight:entry.normalizedWeight,
        quantity:        Math.ceil(totalPurchase * entry.normalizedWeight)
      };
    });
  },

  calcProjectedDDI(currentInventory, dailyDemand, leadTime, incomingOrders, purchase) {
    if (!dailyDemand) return null;
    const projected = currentInventory - (dailyDemand * leadTime) + incomingOrders + purchase;
    return projected / dailyDemand;
  },

  calcRow(skuId, destId) {
    const db = DB.get();
    const sku  = db.skus.find(s => s.id === skuId);
    const dest = db.destinations.find(d => d.id === destId);
    if (!sku || !dest) return null;

    const param = db.params.find(p => p.skuId === skuId && p.destId === destId) || {};
    const inv   = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};

    const dailyDemand    = inv.dailyDemand  || param.dailyDemand || 0;
    const currentInv     = inv.inventory    || 0;
    const committedInv   = inv.committedInv || 0;
    const projectedSales = inv.projectedSales || 0;
    const ird            = inv.ird || param.ird || 0;
    const targetDDI      = param.targetDDI || sku.targetDDI || 30;
    const moq            = param.moq || sku.moq || 1;

    // Total de pedidos en camino (de la tabla orders)
    const incomingOrders = this.getTotalIncoming(skuId, destId);

    const suppliers    = this.normalizeSupplierWeights(skuId, destId);
    const avgLeadTime  = suppliers.length
      ? suppliers.reduce((sum, s) => sum + (s.leadTime * s.normalizedWeight), 0)
      : (param.leadTime || 0);

    const availableInventory = currentInv - committedInv;
    const currentDDI   = this.calcDDI(availableInventory, dailyDemand);
    const targetInv    = this.calcTargetInventory(dailyDemand, targetDDI);
    const projectedInv = availableInventory - (dailyDemand * avgLeadTime) + incomingOrders;
    const suggestedQty = (() => {
      const raw = targetInv - projectedInv;
      if (raw <= 0) return 0;
      return Math.ceil(raw / moq) * moq;
    })();
    const projectedDDI = dailyDemand > 0
      ? (projectedInv + suggestedQty) / dailyDemand
      : null;
    const ddiColor = this.getDDIColor(currentDDI);
    const distribution = suggestedQty > 0
      ? this.calcSupplierDistribution(skuId, destId, suggestedQty)
      : [];

    // Proyección semanal incluida en el row
    const weeklyProjection = this.calcWeeklyProjection(skuId, destId, 10);
    // Semana en que PRIMERO cae a riesgo (DDI ≤ 7)
    const firstRiskWeek = weeklyProjection.find(w => w.isAtRisk);
    const firstCriticalWeek = weeklyProjection.find(w => w.isCritical);

    return {
      skuId, destId,
      skuName:       sku.name,
      skuCode:       sku.code,
      description:   sku.description,
      category:      sku.category,
      destName:      dest.name,
      dailyDemand, currentInv, committedInv, availableInventory,
      incomingOrders, projectedSales, ird, targetDDI, moq, avgLeadTime,
      currentDDI, targetInv, projectedInv, suggestedQty, projectedDDI,
      ddiColor, distribution,
      weeklyProjection,
      firstRiskWeek,
      firstCriticalWeek
    };
  },

  calcAll() {
    const db = DB.get();
    const results = [];
    for (const sku of db.skus) {
      for (const dest of db.destinations.filter(d => d.active)) {
        const row = this.calcRow(sku.id, dest.id);
        if (row) results.push(row);
      }
    }
    return results;
  }
};

// ═══════════════════════════════════════════════════════════
// IMPORTADOR EXCEL
// ═══════════════════════════════════════════════════════════

const Importer = {

  async readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const sheets = {};
          for (const name of workbook.SheetNames) {
            sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null, raw: false });
          }
          resolve({ workbook, sheets, sheetNames: workbook.SheetNames });
        } catch(err) { reject(new Error('Error leyendo el archivo Excel: ' + err.message)); }
      };
      reader.onerror = () => reject(new Error('Error leyendo el archivo'));
      reader.readAsArrayBuffer(file);
    });
  },

  processInventory(rows) {
    const errors = []; const processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU'] || !row['Destino']) { errors.push(`Fila ${i+2}: SKU y Destino requeridos`); return; }
      processed.push({
        skuId:         String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId:        String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        inventory:     parseFloat(row['Inventario']) || 0,
        committedInv:  parseFloat(row['Inventario Comprometido']) || 0,
        incomingOrders:parseFloat(row['Pedidos en Camino']) || 0, // legacy
        projectedSales:parseFloat(row['Ventas Proyectadas']) || 0,
        dailyDemand:   parseFloat(row['Demanda Diaria']) || 0,
        ird:           parseFloat(row['IRD']) || 0
      });
    });
    return { processed, errors };
  },

  processSKUs(rows) {
    const errors = []; const processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU']) { errors.push(`Fila ${i+2}: SKU requerido`); return; }
      const id = String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({ id, code: String(row['SKU']).trim(), name: String(row['Nombre']||row['SKU']).trim(), description: String(row['Descripción']||'').trim(), category: String(row['Categoría']||'').trim(), targetDDI: parseFloat(row['DDI Objetivo'])||30, moq: parseFloat(row['MOQ'])||1, ird: parseFloat(row['IRD'])||0, active: true });
    });
    return { processed, errors };
  },

  processSuppliers(rows) {
    const errors = []; const processed = [];
    rows.forEach((row, i) => {
      if (!row['Proveedor']) { errors.push(`Fila ${i+2}: Proveedor requerido`); return; }
      const id = String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({ id, name: String(row['Proveedor']).trim(), contact: String(row['Contacto']||'').trim(), email: String(row['Email']||'').trim(), active: true });
    });
    return { processed, errors };
  },

  processMatrix(rows) {
    const errors = []; const processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU']||!row['Proveedor']||!row['Destino']) { errors.push(`Fila ${i+2}: SKU, Proveedor y Destino requeridos`); return; }
      processed.push({ skuId: String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'), supplierId: String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g,'_'), destId: String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'), leadTime: parseFloat(row['Lead Time (días)'])||0, weight: parseFloat(row['Peso (%)'])||25, active: String(row['Activo']||'SI').toUpperCase()!=='NO' });
    });
    return { processed, errors };
  },

  /** NUEVO v2: procesa hoja de Pedidos con fechas */
  processOrders(rows) {
    const errors = []; const processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU']||!row['Destino']||!row['Fecha Llegada']||!row['Cantidad']) {
        errors.push(`Fila ${i+2}: SKU, Destino, Cantidad y Fecha Llegada requeridos`); return;
      }
      // Normalizar fecha: puede venir como string o como Date de Excel
      let dateStr = String(row['Fecha Llegada']).trim();
      // Si viene como dd/mm/yyyy, convertir
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const [d, m, y] = dateStr.split('/');
        dateStr = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      }
      processed.push({
        id:          `ord_${Date.now()}_${i}`,
        skuId:       String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId:      String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        supplierId:  String(row['Proveedor']||'').trim().toLowerCase().replace(/\s+/g,'_'),
        qty:         parseFloat(row['Cantidad'])||0,
        arrivalDate: dateStr,
        notes:       String(row['Notas']||'').trim()
      });
    });
    return { processed, errors };
  },

  async importFile(file) {
    const result = { success: false, errors: [], warnings: [], imported: {} };
    try {
      const { sheets } = await this.readFile(file);
      const db = DB.get();

      if (sheets['SKUs'])        { const r = this.processSKUs(sheets['SKUs']);       db.skus      = r.processed; result.imported['SKUs']        = r.processed.length; result.errors.push(...r.errors.map(e=>`[SKUs] ${e}`)); }
      if (sheets['Inventario'])  { const r = this.processInventory(sheets['Inventario']); db.inventory = r.processed; result.imported['Inventario']  = r.processed.length; result.errors.push(...r.errors.map(e=>`[Inventario] ${e}`)); }
      if (sheets['Proveedores']) { const r = this.processSuppliers(sheets['Proveedores']); db.suppliers = r.processed; result.imported['Proveedores'] = r.processed.length; result.errors.push(...r.errors.map(e=>`[Proveedores] ${e}`)); }
      if (sheets['Matriz'])      { const r = this.processMatrix(sheets['Matriz']);    db.matrix    = r.processed; result.imported['Matriz']      = r.processed.length; result.errors.push(...r.errors.map(e=>`[Matriz] ${e}`)); }
      if (sheets['Pedidos'])     { const r = this.processOrders(sheets['Pedidos']);   db.orders    = r.processed; result.imported['Pedidos']     = r.processed.length; result.errors.push(...r.errors.map(e=>`[Pedidos] ${e}`)); }

      ['SKUs','Inventario','Proveedores','Matriz','Pedidos'].forEach(s => { if (!sheets[s]) result.warnings.push(`Hoja "${s}" no encontrada`); });
      db.meta.lastImport = new Date().toISOString();
      DB.save();
      result.success = result.errors.length === 0;
    } catch(e) { result.errors.push(e.message); }
    return result;
  }
};

// ═══════════════════════════════════════════════════════════
// EXPORTADOR EXCEL
// ═══════════════════════════════════════════════════════════

const Exporter = {

  exportResults(results) {
    const wb = XLSX.utils.book_new();

    const summary = results.map(r => ({
      'SKU': r.skuCode, 'Descripción': r.description, 'Destino': r.destName,
      'Inventario': r.currentInv, 'Inv. Disponible': r.availableInventory,
      'Inv. Comprometido': r.committedInv, 'Pedidos en Camino': r.incomingOrders,
      'Demanda Diaria': Number(r.dailyDemand.toFixed(2)), 'IRD': Number((r.ird||0).toFixed(4)),
      'DDI Actual': r.currentDDI !== null ? Number(r.currentDDI.toFixed(1)) : '',
      'DDI Objetivo': r.targetDDI, 'Lead Time Prom.': Number(r.avgLeadTime.toFixed(1)),
      'Inv. Proyectado': Number(r.projectedInv.toFixed(0)), 'Compra Sugerida': r.suggestedQty,
      'DDI Proyectado': r.projectedDDI !== null ? Number(r.projectedDDI.toFixed(1)) : '',
      'Estado DDI': r.ddiColor.label,
      'Semana Riesgo': r.firstRiskWeek ? r.firstRiskWeek.labelFull : 'Sin riesgo'
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen');

    // Hoja de proyección semanal
    const heatRows = [];
    for (const r of results) {
      if (!r.weeklyProjection?.length) continue;
      const base = { 'SKU': r.skuCode, 'Destino': r.destName, 'Demanda Diaria': r.dailyDemand };
      r.weeklyProjection.forEach(w => { base[`Disp ${w.label}`] = w.projInv; base[`DDI ${w.label}`] = w.projDDI !== null ? Number(w.projDDI.toFixed(1)) : ''; });
      heatRows.push(base);
    }
    if (heatRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(heatRows), 'Proyección Semanal');

    const distRows = [];
    for (const r of results) {
      for (const d of (r.distribution || [])) {
        distRows.push({ 'SKU': r.skuCode, 'Destino': r.destName, 'Proveedor': d.supplierName, 'Lead Time (días)': d.leadTime, 'Peso Global (%)': Number(d.weight.toFixed(1)), 'Peso Normalizado (%)': Number((d.normalizedWeight*100).toFixed(1)), 'Cantidad a Comprar': d.quantity });
      }
    }
    if (distRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(distRows), 'Distribución');

    XLSX.writeFile(wb, `reabastecimiento_${new Date().toISOString().slice(0,10)}.xlsx`);
  },

  generateTemplate(type) {
    const wb = XLSX.utils.book_new();

    if (type === 'completo' || type === 'skus') {
      const ws = XLSX.utils.aoa_to_sheet([['SKU','Nombre','Descripción','Categoría','DDI Objetivo','MOQ','IRD'],['TEND001','Tendidos','Tendidos doble plaza','Ropa de Cama',30,10,0.033]]);
      ws['!cols'] = Array(7).fill({wch:20}); XLSX.utils.book_append_sheet(wb, ws, 'SKUs');
    }
    if (type === 'completo' || type === 'inventario') {
      const ws = XLSX.utils.aoa_to_sheet([['SKU','Nombre','Destino','Inventario','Inventario Comprometido','Demanda Diaria','IRD'],['TEND001','Tendidos','Galapa',500,50,15,0.033]]);
      ws['!cols'] = Array(7).fill({wch:22}); XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    }
    if (type === 'completo' || type === 'proveedores') {
      const ws = XLSX.utils.aoa_to_sheet([['Proveedor','Nombre','Contacto','Email'],['PROV_A','Textilería Andina','Ana López','ana@textileria.co']]);
      ws['!cols'] = Array(4).fill({wch:24}); XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
    }
    if (type === 'completo' || type === 'matriz') {
      const ws = XLSX.utils.aoa_to_sheet([['SKU','Proveedor','Destino','Lead Time (días)','Peso (%)','Activo'],['TEND001','PROV_A','Galapa',5,25,'SI']]);
      ws['!cols'] = Array(6).fill({wch:20}); XLSX.utils.book_append_sheet(wb, ws, 'Matriz');
    }
    if (type === 'completo' || type === 'pedidos') {
      const today = DateUtils.today();
      const ex1 = DateUtils.toISO(DateUtils.addDays(today, 7));
      const ex2 = DateUtils.toISO(DateUtils.addDays(today, 14));
      const ws = XLSX.utils.aoa_to_sheet([
        ['SKU','Destino','Proveedor','Cantidad','Fecha Llegada','Notas'],
        ['TEND001','Galapa','PROV_A',200,ex1,'OC-2026-001'],
        ['TEND001','Bogotá','PROV_C',150,ex2,'OC-2026-002']
      ]);
      ws['!cols'] = Array(6).fill({wch:22}); XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
    }
    XLSX.writeFile(wb, type === 'completo' ? 'Plantilla_Motor_DDI_v2.xlsx' : `Plantilla_${type}.xlsx`);
  }
};

// ═══════════════════════════════════════════════════════════
// ADMINISTRACIÓN CRUD
// ═══════════════════════════════════════════════════════════

const Admin = {
  saveSKU(sku) { const db=DB.get(); const id=sku.id||sku.code.toLowerCase().replace(/\s+/g,'_'); const i=db.skus.findIndex(s=>s.id===id); const r={...sku,id}; if(i>=0) db.skus[i]=r; else db.skus.push(r); DB.save(); return r; },
  deleteSKU(id) { const db=DB.get(); db.skus=db.skus.filter(s=>s.id!==id); db.inventory=db.inventory.filter(i=>i.skuId!==id); db.params=db.params.filter(p=>p.skuId!==id); db.matrix=db.matrix.filter(m=>m.skuId!==id); db.orders=db.orders.filter(o=>o.skuId!==id); DB.save(); },
  saveDestination(dest) { const db=DB.get(); const id=dest.id||dest.name.toLowerCase().replace(/\s+/g,'_'); const i=db.destinations.findIndex(d=>d.id===id); const r={...dest,id}; if(i>=0) db.destinations[i]=r; else db.destinations.push(r); DB.save(); return r; },
  deleteDestination(id) { const db=DB.get(); db.destinations=db.destinations.filter(d=>d.id!==id); db.inventory=db.inventory.filter(i=>i.destId!==id); db.params=db.params.filter(p=>p.destId!==id); db.matrix=db.matrix.filter(m=>m.destId!==id); db.orders=db.orders.filter(o=>o.destId!==id); DB.save(); },
  saveSupplier(s) { const db=DB.get(); const id=s.id||s.name.toLowerCase().replace(/\s+/g,'_'); const i=db.suppliers.findIndex(x=>x.id===id); const r={...s,id}; if(i>=0) db.suppliers[i]=r; else db.suppliers.push(r); DB.save(); return r; },
  deleteSupplier(id) { const db=DB.get(); db.suppliers=db.suppliers.filter(s=>s.id!==id); db.matrix=db.matrix.filter(m=>m.supplierId!==id); DB.save(); },
  saveMatrixEntry(e) { const db=DB.get(); const i=db.matrix.findIndex(m=>m.skuId===e.skuId&&m.supplierId===e.supplierId&&m.destId===e.destId); if(i>=0) db.matrix[i]=e; else db.matrix.push(e); DB.save(); },
  deleteMatrixEntry(skuId,supplierId,destId) { const db=DB.get(); db.matrix=db.matrix.filter(m=>!(m.skuId===skuId&&m.supplierId===supplierId&&m.destId===destId)); DB.save(); },
  saveParams(p) { const db=DB.get(); const i=db.params.findIndex(x=>x.skuId===p.skuId&&x.destId===p.destId); if(i>=0) db.params[i]=p; else db.params.push(p); DB.save(); },
  saveInventory(inv) { const db=DB.get(); const i=db.inventory.findIndex(x=>x.skuId===inv.skuId&&x.destId===inv.destId); if(i>=0) db.inventory[i]=inv; else db.inventory.push(inv); DB.save(); },

  // NUEVO v2: gestión de pedidos con fecha
  saveOrder(order) {
    const db = DB.get();
    const id = order.id || `ord_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const record = { ...order, id };
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx >= 0) db.orders[idx] = record; else db.orders.push(record);
    DB.save(); return record;
  },
  deleteOrder(id) { const db=DB.get(); db.orders=db.orders.filter(o=>o.id!==id); DB.save(); },
  getOrdersFor(skuId, destId) { const db=DB.get(); return db.orders.filter(o=>o.skuId===skuId&&o.destId===destId); }
};

// ═══════════════════════════════════════════════════════════
// DATOS DE DEMO (v2 — con pedidos fechados)
// ═══════════════════════════════════════════════════════════

function loadDemoData() {
  const db = DB.get();
  const today = DateUtils.today();
  const d = (n) => DateUtils.toISO(DateUtils.addDays(today, n));

  db.skus = [
    { id:'tendidos',  code:'TEND001', name:'Tendidos',     description:'Tendidos doble plaza',       category:'Ropa de Cama', targetDDI:30, moq:10, active:true },
    { id:'almohadas', code:'ALMO001', name:'Almohadas',    description:'Almohada estándar',           category:'Ropa de Cama', targetDDI:21, moq:12, active:true },
    { id:'sabanas',   code:'SABA001', name:'Sábanas',      description:'Juego de sábanas king',       category:'Ropa de Cama', targetDDI:30, moq:6,  active:true },
    { id:'cobijas',   code:'COBJ001', name:'Cobijas',      description:'Cobija polar doble',          category:'Ropa de Cama', targetDDI:45, moq:5,  active:true },
    { id:'colchones', code:'COLC001', name:'Colchones',    description:'Colchón ortopédico 140x190',  category:'Colchones',    targetDDI:21, moq:1,  active:true },
    { id:'cojines',   code:'COJI001', name:'Cojines Deco', description:'Cojín decorativo 45x45',      category:'Decoración',   targetDDI:30, moq:24, active:true },
  ];

  db.suppliers = [
    { id:'prov_a', name:'Textilería Andina',    contact:'Ana López',   email:'ana@textileria.co',  active:true },
    { id:'prov_b', name:'Manufacturas del Sur', contact:'Carlos Ruiz', email:'carlos@msur.co',     active:true },
    { id:'prov_c', name:'Importaciones Global', contact:'María Peña',  email:'maria@iglobal.co',   active:true },
    { id:'prov_d', name:'Distribuidora Norte',  contact:'Pedro Gómez', email:'pedro@dnorte.co',    active:true },
  ];

  db.destinations = [
    { id:'galapa', name:'Galapa', active:true },
    { id:'bogota', name:'Bogotá', active:true },
  ];

  db.matrix = [
    { skuId:'tendidos',  supplierId:'prov_a', destId:'galapa', leadTime:5,  weight:25, active:true },
    { skuId:'tendidos',  supplierId:'prov_b', destId:'galapa', leadTime:7,  weight:25, active:true },
    { skuId:'tendidos',  supplierId:'prov_c', destId:'galapa', leadTime:10, weight:25, active:true },
    { skuId:'tendidos',  supplierId:'prov_c', destId:'bogota', leadTime:9,  weight:50, active:true },
    { skuId:'tendidos',  supplierId:'prov_d', destId:'bogota', leadTime:14, weight:50, active:true },
    { skuId:'almohadas', supplierId:'prov_a', destId:'galapa', leadTime:3,  weight:50, active:true },
    { skuId:'almohadas', supplierId:'prov_b', destId:'galapa', leadTime:5,  weight:50, active:true },
    { skuId:'almohadas', supplierId:'prov_c', destId:'bogota', leadTime:8,  weight:60, active:true },
    { skuId:'almohadas', supplierId:'prov_d', destId:'bogota', leadTime:12, weight:40, active:true },
    { skuId:'sabanas',   supplierId:'prov_a', destId:'galapa', leadTime:4,  weight:40, active:true },
    { skuId:'sabanas',   supplierId:'prov_c', destId:'galapa', leadTime:8,  weight:60, active:true },
    { skuId:'sabanas',   supplierId:'prov_b', destId:'bogota', leadTime:10, weight:100,active:true },
    { skuId:'cobijas',   supplierId:'prov_b', destId:'galapa', leadTime:6,  weight:100,active:true },
    { skuId:'cobijas',   supplierId:'prov_c', destId:'bogota', leadTime:11, weight:50, active:true },
    { skuId:'cobijas',   supplierId:'prov_d', destId:'bogota', leadTime:15, weight:50, active:true },
    { skuId:'colchones', supplierId:'prov_d', destId:'galapa', leadTime:7,  weight:100,active:true },
    { skuId:'colchones', supplierId:'prov_d', destId:'bogota', leadTime:14, weight:100,active:true },
    { skuId:'cojines',   supplierId:'prov_a', destId:'galapa', leadTime:4,  weight:50, active:true },
    { skuId:'cojines',   supplierId:'prov_b', destId:'galapa', leadTime:6,  weight:50, active:true },
    { skuId:'cojines',   supplierId:'prov_c', destId:'bogota', leadTime:9,  weight:100,active:true },
  ];

  db.inventory = [
    { skuId:'tendidos',  destId:'galapa', inventory:120, committedInv:20, projectedSales:300, dailyDemand:10,  ird:0.033 },
    { skuId:'almohadas', destId:'galapa', inventory:80,  committedInv:10, projectedSales:200, dailyDemand:8,   ird:0.04  },
    { skuId:'sabanas',   destId:'galapa', inventory:45,  committedInv:5,  projectedSales:100, dailyDemand:5,   ird:0.05  },
    { skuId:'cobijas',   destId:'galapa', inventory:200, committedInv:0,  projectedSales:60,  dailyDemand:2,   ird:0.01  },
    { skuId:'colchones', destId:'galapa', inventory:3,   committedInv:1,  projectedSales:15,  dailyDemand:0.5, ird:0.167 },
    { skuId:'cojines',   destId:'galapa', inventory:360, committedInv:48, projectedSales:240, dailyDemand:12,  ird:0.033 },
    { skuId:'tendidos',  destId:'bogota', inventory:60,  committedInv:10, projectedSales:450, dailyDemand:15,  ird:0.033 },
    { skuId:'almohadas', destId:'bogota', inventory:30,  committedInv:5,  projectedSales:300, dailyDemand:12,  ird:0.04  },
    { skuId:'sabanas',   destId:'bogota', inventory:20,  committedInv:0,  projectedSales:150, dailyDemand:7,   ird:0.047 },
    { skuId:'cobijas',   destId:'bogota', inventory:90,  committedInv:15, projectedSales:90,  dailyDemand:3,   ird:0.033 },
    { skuId:'colchones', destId:'bogota', inventory:8,   committedInv:2,  projectedSales:30,  dailyDemand:1,   ird:0.1   },
    { skuId:'cojines',   destId:'bogota', inventory:144, committedInv:24, projectedSales:360, dailyDemand:18,  ird:0.05  },
  ];

  // NUEVO v2: pedidos con fechas reales
  db.orders = [
    // Galapa
    { id:'o1',  skuId:'tendidos',  destId:'galapa', supplierId:'prov_a', qty:200, arrivalDate:d(5),  notes:'OC-001' },
    { id:'o2',  skuId:'tendidos',  destId:'galapa', supplierId:'prov_b', qty:150, arrivalDate:d(12), notes:'OC-002' },
    { id:'o3',  skuId:'almohadas', destId:'galapa', supplierId:'prov_a', qty:96,  arrivalDate:d(3),  notes:'OC-003' },
    { id:'o4',  skuId:'sabanas',   destId:'galapa', supplierId:'prov_c', qty:60,  arrivalDate:d(8),  notes:'OC-004' },
    { id:'o5',  skuId:'colchones', destId:'galapa', supplierId:'prov_d', qty:10,  arrivalDate:d(7),  notes:'OC-005' },
    { id:'o6',  skuId:'cojines',   destId:'galapa', supplierId:'prov_a', qty:288, arrivalDate:d(4),  notes:'OC-006' },
    { id:'o7',  skuId:'cojines',   destId:'galapa', supplierId:'prov_b', qty:144, arrivalDate:d(18), notes:'OC-007' },
    // Bogotá
    { id:'o8',  skuId:'tendidos',  destId:'bogota', supplierId:'prov_c', qty:300, arrivalDate:d(9),  notes:'OC-008' },
    { id:'o9',  skuId:'tendidos',  destId:'bogota', supplierId:'prov_d', qty:150, arrivalDate:d(21), notes:'OC-009' },
    { id:'o10', skuId:'almohadas', destId:'bogota', supplierId:'prov_c', qty:144, arrivalDate:d(8),  notes:'OC-010' },
    { id:'o11', skuId:'sabanas',   destId:'bogota', supplierId:'prov_b', qty:84,  arrivalDate:d(10), notes:'OC-011' },
    { id:'o12', skuId:'cobijas',   destId:'bogota', supplierId:'prov_d', qty:90,  arrivalDate:d(15), notes:'OC-012' },
    { id:'o13', skuId:'colchones', destId:'bogota', supplierId:'prov_d', qty:20,  arrivalDate:d(14), notes:'OC-013' },
    { id:'o14', skuId:'cojines',   destId:'bogota', supplierId:'prov_c', qty:360, arrivalDate:d(9),  notes:'OC-014' },
  ];

  db.params = [];
  db.meta.lastImport = new Date().toISOString();
  DB.save();
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR
// ═══════════════════════════════════════════════════════════

window.MotorReabastecimiento = {
  DB, Engine, Importer, Exporter, Admin,
  loadDemoData, DDI_COLORS, DateUtils
};

})(); // end IIFE
