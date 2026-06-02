(function () {
'use strict';

/**
 * motor.js — Motor de Reabastecimiento DDI
 * Supply Replenishment Engine
 * Versión 1.0
 */

// ═══════════════════════════════════════════════════════════
// CONSTANTES DE CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════

const DDI_COLORS = [
  { max: 0,   color: '#dc2626', label: 'Crítico',      bg: '#fef2f2' },
  { max: 7,   color: '#ea580c', label: 'Muy Bajo',     bg: '#fff7ed' },
  { max: 14,  color: '#ca8a04', label: 'Bajo',         bg: '#fefce8' },
  { max: 21,  color: '#16a34a', label: 'Normal',       bg: '#f0fdf4' },
  { max: 30,  color: '#2563eb', label: 'Adecuado',     bg: '#eff6ff' },
  { max: 45,  color: '#0284c7', label: 'Bueno',        bg: '#f0f9ff' },
  { max: 60,  color: '#65a30d', label: 'Exceso Leve',  bg: '#f7fee7' },
  { max: Infinity, color: '#1c1917', label: 'Exceso',  bg: '#f5f5f4' }
];

const DB_KEY = 'replenishment_db_v1';

// ═══════════════════════════════════════════════════════════
// BASE DE DATOS LOCAL (LocalStorage)
// ═══════════════════════════════════════════════════════════

const DB = {
  _data: null,

  _defaultData() {
    return {
      skus: [],
      destinations: [
        { id: 'galapa',  name: 'Galapa',  active: true },
        { id: 'bogota',  name: 'Bogotá',  active: true }
      ],
      suppliers: [],
      // Matriz SKU-Proveedor-Destino: { skuId, supplierId, destId, leadTime, weight, active }
      matrix: [],
      // Parámetros operativos por SKU+Destino
      params: [],
      // Inventario actual por SKU+Destino
      inventory: [],
      meta: { lastImport: null, version: '1.0' }
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this._data = raw ? JSON.parse(raw) : this._defaultData();
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
// MOTOR DE CÁLCULO DDI
// ═══════════════════════════════════════════════════════════

const Engine = {

  /**
   * Obtiene el color DDI según el valor
   */
  getDDIColor(ddi) {
    if (ddi === null || ddi === undefined || isNaN(ddi)) {
      return { color: '#94a3b8', label: 'Sin datos', bg: '#f8fafc' };
    }
    for (const band of DDI_COLORS) {
      if (ddi <= band.max) return band;
    }
    return DDI_COLORS[DDI_COLORS.length - 1];
  },

  /**
   * Calcula DDI actual
   * DDI = Inventario / Demanda Diaria
   */
  calcDDI(inventory, dailyDemand) {
    if (!dailyDemand || dailyDemand === 0) return null;
    return inventory / dailyDemand;
  },

  /**
   * Inventario objetivo
   * TargetInventory = DailyDemand × TargetDDI
   */
  calcTargetInventory(dailyDemand, targetDDI) {
    return dailyDemand * targetDDI;
  },

  /**
   * Inventario proyectado al momento de llegada
   * ProjectedInventory = CurrentInventory - (DailyDemand × LeadTime) + IncomingOrders
   */
  calcProjectedInventory(currentInventory, dailyDemand, leadTime, incomingOrders) {
    return currentInventory - (dailyDemand * leadTime) + incomingOrders;
  },

  /**
   * Compra sugerida
   * Purchase = TargetInventory - ProjectedInventory
   * Si < 0, = 0; siempre redondear hacia arriba al MOQ
   */
  calcSuggestedPurchase(targetInventory, projectedInventory, moq) {
    const raw = targetInventory - projectedInventory;
    if (raw <= 0) return 0;
    const mq = moq || 1;
    return Math.ceil(raw / mq) * mq;
  },

  /**
   * Normaliza pesos de proveedores para un destino específico
   * Solo incluye proveedores activos para ese destino
   */
  normalizeSupplierWeights(skuId, destId) {
    const db = DB.get();
    const validEntries = db.matrix.filter(m =>
      m.skuId === skuId &&
      m.destId === destId &&
      m.active
    );
    if (!validEntries.length) return [];

    const totalWeight = validEntries.reduce((sum, m) => sum + (m.weight || 0), 0);
    if (!totalWeight) return validEntries.map(m => ({ ...m, normalizedWeight: 1 / validEntries.length }));

    return validEntries.map(m => ({
      ...m,
      normalizedWeight: (m.weight || 0) / totalWeight
    }));
  },

  /**
   * Calcula la distribución de compra por proveedor
   */
  calcSupplierDistribution(skuId, destId, totalPurchase) {
    const normalizedSuppliers = this.normalizeSupplierWeights(skuId, destId);
    const db = DB.get();

    return normalizedSuppliers.map(entry => {
      const supplier = db.suppliers.find(s => s.id === entry.supplierId);
      const qty = Math.ceil(totalPurchase * entry.normalizedWeight);
      return {
        supplierId: entry.supplierId,
        supplierName: supplier?.name || entry.supplierId,
        leadTime: entry.leadTime || 0,
        weight: entry.weight || 0,
        normalizedWeight: entry.normalizedWeight,
        quantity: qty
      };
    });
  },

  /**
   * Calcula el DDI proyectado tras la compra
   */
  calcProjectedDDI(currentInventory, dailyDemand, leadTime, incomingOrders, purchase) {
    if (!dailyDemand) return null;
    const projected = currentInventory - (dailyDemand * leadTime) + incomingOrders + purchase;
    return projected / dailyDemand;
  },

  /**
   * Calcula todos los resultados para una fila SKU+Destino
   */
  calcRow(skuId, destId) {
    const db = DB.get();
    const sku = db.skus.find(s => s.id === skuId);
    const dest = db.destinations.find(d => d.id === destId);
    if (!sku || !dest) return null;

    // Obtener parámetros operativos
    const param = db.params.find(p => p.skuId === skuId && p.destId === destId) || {};
    const inv = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};

    const dailyDemand    = inv.dailyDemand    || param.dailyDemand    || 0;
    const currentInv     = inv.inventory      || 0;
    const committedInv   = inv.committedInv   || 0;
    const incomingOrders = inv.incomingOrders  || 0;
    const projectedSales = inv.projectedSales  || 0;
    const ird            = inv.ird             || param.ird            || 0;
    const targetDDI      = param.targetDDI     || sku.targetDDI        || 30;
    const moq            = param.moq           || sku.moq              || 1;

    // Calcular lead time (promedio ponderado de proveedores activos)
    const suppliers = this.normalizeSupplierWeights(skuId, destId);
    const avgLeadTime = suppliers.length
      ? suppliers.reduce((sum, s) => sum + (s.leadTime * s.normalizedWeight), 0)
      : (param.leadTime || 0);

    const availableInventory = currentInv - committedInv;
    const currentDDI    = this.calcDDI(availableInventory, dailyDemand);
    const targetInv     = this.calcTargetInventory(dailyDemand, targetDDI);
    const projectedInv  = this.calcProjectedInventory(currentInv, dailyDemand, avgLeadTime, incomingOrders);
    const suggestedQty  = this.calcSuggestedPurchase(targetInv, projectedInv, moq);
    const projectedDDI  = this.calcProjectedDDI(currentInv, dailyDemand, avgLeadTime, incomingOrders, suggestedQty);
    const ddiColor      = this.getDDIColor(currentDDI);

    const distribution  = suggestedQty > 0
      ? this.calcSupplierDistribution(skuId, destId, suggestedQty)
      : [];

    return {
      skuId, destId,
      skuName:       sku.name,
      skuCode:       sku.code,
      description:   sku.description,
      category:      sku.category,
      destName:      dest.name,
      dailyDemand,
      currentInv,
      committedInv,
      availableInventory,
      incomingOrders,
      projectedSales,
      ird,
      targetDDI,
      moq,
      avgLeadTime,
      currentDDI,
      targetInv,
      projectedInv,
      suggestedQty,
      projectedDDI,
      ddiColor,
      distribution
    };
  },

  /**
   * Calcula todos los resultados del sistema
   */
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

  /**
   * Lee un archivo Excel y devuelve un objeto con las hojas
   */
  async readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheets = {};
          for (const name of workbook.SheetNames) {
            sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
              defval: null,
              raw: false
            });
          }
          resolve({ workbook, sheets, sheetNames: workbook.SheetNames });
        } catch(err) {
          reject(new Error('Error leyendo el archivo Excel: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Error leyendo el archivo'));
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * Valida y normaliza la hoja de inventarios
   */
  processInventory(rows) {
    const required = ['SKU', 'Destino'];
    const errors = [];
    const processed = [];

    rows.forEach((row, i) => {
      const missing = required.filter(k => !row[k]);
      if (missing.length) {
        errors.push(`Fila ${i+2}: faltan columnas ${missing.join(', ')}`);
        return;
      }
      processed.push({
        skuId:         String(row['SKU']).trim().toLowerCase().replace(/\s+/g, '_'),
        destId:        String(row['Destino']).trim().toLowerCase().replace(/\s+/g, '_'),
        inventory:     parseFloat(row['Inventario']) || 0,
        committedInv:  parseFloat(row['Inventario Comprometido']) || 0,
        incomingOrders:parseFloat(row['Pedidos en Camino']) || 0,
        projectedSales:parseFloat(row['Ventas Proyectadas']) || 0,
        dailyDemand:   parseFloat(row['Demanda Diaria']) || 0,
        ird:           parseFloat(row['IRD']) || 0,
      });
    });
    return { processed, errors };
  },

  /**
   * Valida y normaliza la hoja de SKUs
   */
  processSKUs(rows) {
    const errors = [];
    const processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU']) { errors.push(`Fila ${i+2}: SKU requerido`); return; }
      const id = String(row['SKU']).trim().toLowerCase().replace(/\s+/g, '_');
      processed.push({
        id,
        code:        String(row['SKU']).trim(),
        name:        String(row['Nombre'] || row['SKU']).trim(),
        description: String(row['Descripción'] || '').trim(),
        category:    String(row['Categoría'] || '').trim(),
        targetDDI:   parseFloat(row['DDI Objetivo']) || 30,
        moq:         parseFloat(row['MOQ']) || 1,
        ird:         parseFloat(row['IRD']) || 0,
        active:      true
      });
    });
    return { processed, errors };
  },

  /**
   * Valida y normaliza la hoja de proveedores
   */
  processSuppliers(rows) {
    const errors = [];
    const processed = [];
    rows.forEach((row, i) => {
      if (!row['Proveedor']) { errors.push(`Fila ${i+2}: Proveedor requerido`); return; }
      const id = String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g, '_');
      processed.push({
        id,
        name:    String(row['Proveedor']).trim(),
        contact: String(row['Contacto'] || '').trim(),
        email:   String(row['Email'] || '').trim(),
        active:  true
      });
    });
    return { processed, errors };
  },

  /**
   * Valida y normaliza la matriz SKU-Proveedor-Destino
   */
  processMatrix(rows) {
    const errors = [];
    const processed = [];
    rows.forEach((row, i) => {
      const req = ['SKU', 'Proveedor', 'Destino'];
      const missing = req.filter(k => !row[k]);
      if (missing.length) { errors.push(`Fila ${i+2}: faltan ${missing.join(', ')}`); return; }
      processed.push({
        skuId:      String(row['SKU']).trim().toLowerCase().replace(/\s+/g, '_'),
        supplierId: String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g, '_'),
        destId:     String(row['Destino']).trim().toLowerCase().replace(/\s+/g, '_'),
        leadTime:   parseFloat(row['Lead Time (días)']) || 0,
        weight:     parseFloat(row['Peso (%)']) || 25,
        active:     String(row['Activo'] || 'SI').toUpperCase() !== 'NO'
      });
    });
    return { processed, errors };
  },

  /**
   * Importa un archivo completo y actualiza la DB
   */
  async importFile(file) {
    const result = { success: false, errors: [], warnings: [], imported: {} };
    try {
      const { sheets } = await this.readFile(file);
      const db = DB.get();

      // Procesar cada hoja disponible
      const processors = {
        'SKUs':         () => { const r = this.processSKUs(sheets['SKUs'] || []); db.skus = r.processed; return r; },
        'Inventario':   () => { const r = this.processInventory(sheets['Inventario'] || []); db.inventory = r.processed; return r; },
        'Proveedores':  () => { const r = this.processSuppliers(sheets['Proveedores'] || []); db.suppliers = r.processed; return r; },
        'Matriz':       () => { const r = this.processMatrix(sheets['Matriz'] || []); db.matrix = r.processed; return r; },
      };

      let totalErrors = 0;
      for (const [sheetName, processor] of Object.entries(processors)) {
        if (sheets[sheetName]) {
          const { processed, errors } = processor();
          result.imported[sheetName] = processed.length;
          if (errors.length) {
            result.errors.push(...errors.map(e => `[${sheetName}] ${e}`));
            totalErrors += errors.length;
          }
        } else {
          result.warnings.push(`Hoja "${sheetName}" no encontrada`);
        }
      }

      db.meta.lastImport = new Date().toISOString();
      DB.save();
      result.success = totalErrors === 0;
      if (totalErrors > 0) result.success = result.errors.length < 5; // partial success

    } catch(e) {
      result.errors.push(e.message);
    }
    return result;
  }
};

// ═══════════════════════════════════════════════════════════
// EXPORTADOR EXCEL
// ═══════════════════════════════════════════════════════════

const Exporter = {

  /**
   * Exporta los resultados de reabastecimiento a Excel
   */
  exportResults(results) {
    const wb = XLSX.utils.book_new();

    // Hoja principal: Resumen
    const summary = results.map(r => ({
      'SKU':                r.skuCode,
      'Descripción':        r.description,
      'Destino':            r.destName,
      'Inventario':         r.currentInv,
      'Inv. Disponible':    r.availableInventory,
      'Inv. Comprometido':  r.committedInv,
      'Pedidos en Camino':  r.incomingOrders,
      'Demanda Diaria':     Number(r.dailyDemand.toFixed(2)),
      'IRD':                Number((r.ird || 0).toFixed(4)),
      'DDI Actual':         r.currentDDI !== null ? Number(r.currentDDI.toFixed(1)) : '',
      'DDI Objetivo':       r.targetDDI,
      'Lead Time Prom.':    Number(r.avgLeadTime.toFixed(1)),
      'Inv. Proyectado':    Number(r.projectedInv.toFixed(0)),
      'Compra Sugerida':    r.suggestedQty,
      'DDI Proyectado':     r.projectedDDI !== null ? Number(r.projectedDDI.toFixed(1)) : '',
      'Estado DDI':         r.ddiColor.label
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen');

    // Hoja de distribución por proveedor
    const distRows = [];
    for (const r of results) {
      for (const d of (r.distribution || [])) {
        distRows.push({
          'SKU':                r.skuCode,
          'Destino':            r.destName,
          'Proveedor':          d.supplierName,
          'Lead Time (días)':   d.leadTime,
          'Peso Global (%)':    Number((d.weight).toFixed(1)),
          'Peso Normalizado (%)':Number((d.normalizedWeight * 100).toFixed(1)),
          'Cantidad a Comprar': d.quantity
        });
      }
    }
    if (distRows.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(distRows), 'Distribución');
    }

    XLSX.writeFile(wb, `reabastecimiento_${new Date().toISOString().slice(0,10)}.xlsx`);
  },

  /**
   * Genera plantillas Excel descargables
   */
  generateTemplate(type) {
    const wb = XLSX.utils.book_new();

    const templates = {
      inventario: {
        name: 'Plantilla_Inventario.xlsx',
        headers: ['SKU','Nombre','Destino','Inventario','Inventario Comprometido','Pedidos en Camino','Ventas Proyectadas','Demanda Diaria','IRD'],
        example: ['TEND001','Tendidos','Galapa','500','50','100','30','15','0.03']
      },
      skus: {
        name: 'Plantilla_SKUs.xlsx',
        headers: ['SKU','Nombre','Descripción','Categoría','DDI Objetivo','MOQ','IRD'],
        example: ['TEND001','Tendidos','Tendidos doble plaza','Cama',30,1,0.03]
      },
      proveedores: {
        name: 'Plantilla_Proveedores.xlsx',
        headers: ['Proveedor','Nombre','Contacto','Email'],
        example: ['PROV_A','Proveedor A','Juan García','juan@proveedora.com']
      },
      matriz: {
        name: 'Plantilla_Matriz.xlsx',
        headers: ['SKU','Proveedor','Destino','Lead Time (días)','Peso (%)','Activo'],
        example: ['TEND001','PROV_A','Galapa',5,25,'SI']
      },
      completo: {
        name: 'Plantilla_Completa.xlsx',
        sheets: true
      }
    };

    if (type === 'completo') {
      // Generar libro completo con todas las hojas
      const allTemplates = ['inventario','skus','proveedores','matriz'];
      for (const t of allTemplates) {
        const cfg = templates[t];
        const ws = XLSX.utils.aoa_to_sheet([cfg.headers, cfg.example]);
        this._styleHeader(ws, cfg.headers.length);
        XLSX.utils.book_append_sheet(wb, ws, cfg.headers[0] === 'SKU' && t === 'skus' ? 'SKUs' : t === 'inventario' ? 'Inventario' : t === 'proveedores' ? 'Proveedores' : 'Matriz');
      }
      XLSX.writeFile(wb, templates.completo.name);
      return;
    }

    const cfg = templates[type];
    if (!cfg) return;
    const ws = XLSX.utils.aoa_to_sheet([cfg.headers, cfg.example]);
    this._styleHeader(ws, cfg.headers.length);
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    XLSX.writeFile(wb, cfg.name);
  },

  _styleHeader(ws, cols) {
    for (let c = 0; c < cols; c++) {
      const cell = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[cell]) {
        ws[cell].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1e3a5f' } },
          alignment: { horizontal: 'center' }
        };
      }
    }
    if (!ws['!cols']) ws['!cols'] = [];
    for (let i = 0; i < cols; i++) ws['!cols'].push({ wch: 22 });
  }
};

// ═══════════════════════════════════════════════════════════
// ADMINISTRACIÓN: CRUD DE ENTIDADES
// ═══════════════════════════════════════════════════════════

const Admin = {

  // — SKUs —
  saveSKU(sku) {
    const db = DB.get();
    const id = sku.id || sku.code.toLowerCase().replace(/\s+/g, '_');
    const existing = db.skus.findIndex(s => s.id === id);
    const record = { ...sku, id };
    if (existing >= 0) db.skus[existing] = record;
    else db.skus.push(record);
    DB.save();
    return record;
  },

  deleteSKU(id) {
    const db = DB.get();
    db.skus = db.skus.filter(s => s.id !== id);
    db.inventory = db.inventory.filter(i => i.skuId !== id);
    db.params    = db.params.filter(p => p.skuId !== id);
    db.matrix    = db.matrix.filter(m => m.skuId !== id);
    DB.save();
  },

  // — Destinos —
  saveDestination(dest) {
    const db = DB.get();
    const id = dest.id || dest.name.toLowerCase().replace(/\s+/g, '_');
    const existing = db.destinations.findIndex(d => d.id === id);
    const record = { ...dest, id };
    if (existing >= 0) db.destinations[existing] = record;
    else db.destinations.push(record);
    DB.save();
    return record;
  },

  deleteDestination(id) {
    const db = DB.get();
    db.destinations  = db.destinations.filter(d => d.id !== id);
    db.inventory     = db.inventory.filter(i => i.destId !== id);
    db.params        = db.params.filter(p => p.destId !== id);
    db.matrix        = db.matrix.filter(m => m.destId !== id);
    DB.save();
  },

  // — Proveedores —
  saveSupplier(supplier) {
    const db = DB.get();
    const id = supplier.id || supplier.name.toLowerCase().replace(/\s+/g, '_');
    const existing = db.suppliers.findIndex(s => s.id === id);
    const record = { ...supplier, id };
    if (existing >= 0) db.suppliers[existing] = record;
    else db.suppliers.push(record);
    DB.save();
    return record;
  },

  deleteSupplier(id) {
    const db = DB.get();
    db.suppliers = db.suppliers.filter(s => s.id !== id);
    db.matrix    = db.matrix.filter(m => m.supplierId !== id);
    DB.save();
  },

  // — Matriz SKU-Proveedor-Destino —
  saveMatrixEntry(entry) {
    const db = DB.get();
    const idx = db.matrix.findIndex(m =>
      m.skuId === entry.skuId &&
      m.supplierId === entry.supplierId &&
      m.destId === entry.destId
    );
    if (idx >= 0) db.matrix[idx] = entry;
    else db.matrix.push(entry);
    DB.save();
  },

  deleteMatrixEntry(skuId, supplierId, destId) {
    const db = DB.get();
    db.matrix = db.matrix.filter(m =>
      !(m.skuId === skuId && m.supplierId === supplierId && m.destId === destId)
    );
    DB.save();
  },

  // — Parámetros operativos —
  saveParams(params) {
    const db = DB.get();
    const idx = db.params.findIndex(p => p.skuId === params.skuId && p.destId === params.destId);
    if (idx >= 0) db.params[idx] = params;
    else db.params.push(params);
    DB.save();
  },

  // — Inventario —
  saveInventory(inv) {
    const db = DB.get();
    const idx = db.inventory.findIndex(i => i.skuId === inv.skuId && i.destId === inv.destId);
    if (idx >= 0) db.inventory[idx] = inv;
    else db.inventory.push(inv);
    DB.save();
  }
};

// ═══════════════════════════════════════════════════════════
// CARGA DE DATOS DEMO
// ═══════════════════════════════════════════════════════════

function loadDemoData() {
  const db = DB.get();

  db.skus = [
    { id: 'tendidos',    code: 'TEND001', name: 'Tendidos',       description: 'Tendidos doble plaza',        category: 'Ropa de Cama',  targetDDI: 30, moq: 10, active: true },
    { id: 'almohadas',   code: 'ALMO001', name: 'Almohadas',      description: 'Almohada estándar',           category: 'Ropa de Cama',  targetDDI: 21, moq: 12, active: true },
    { id: 'sabanas',     code: 'SABA001', name: 'Sábanas',        description: 'Juego de sábanas king',       category: 'Ropa de Cama',  targetDDI: 30, moq: 6,  active: true },
    { id: 'cobijas',     code: 'COBJ001', name: 'Cobijas',        description: 'Cobija polar doble',          category: 'Ropa de Cama',  targetDDI: 45, moq: 5,  active: true },
    { id: 'colchones',   code: 'COLC001', name: 'Colchones',      description: 'Colchón ortopédico 140x190',  category: 'Colchones',     targetDDI: 21, moq: 1,  active: true },
    { id: 'cojines',     code: 'COJI001', name: 'Cojines Deco',   description: 'Cojín decorativo 45x45',      category: 'Decoración',    targetDDI: 30, moq: 24, active: true },
  ];

  db.suppliers = [
    { id: 'prov_a', name: 'Textilería Andina',   contact: 'Ana López',    email: 'ana@textileria.co',  active: true },
    { id: 'prov_b', name: 'Manufacturas del Sur', contact: 'Carlos Ruiz',  email: 'carlos@msur.co',     active: true },
    { id: 'prov_c', name: 'Importaciones Global', contact: 'María Peña',   email: 'maria@iglobal.co',   active: true },
    { id: 'prov_d', name: 'Distribuidora Norte',  contact: 'Pedro Gómez',  email: 'pedro@dnorte.co',    active: true },
  ];

  db.destinations = [
    { id: 'galapa', name: 'Galapa',  active: true },
    { id: 'bogota', name: 'Bogotá',  active: true },
  ];

  // Matriz: algunos proveedores solo sirven ciertos destinos
  db.matrix = [
    // Tendidos
    { skuId: 'tendidos', supplierId: 'prov_a', destId: 'galapa', leadTime: 5,  weight: 25, active: true },
    { skuId: 'tendidos', supplierId: 'prov_b', destId: 'galapa', leadTime: 7,  weight: 25, active: true },
    { skuId: 'tendidos', supplierId: 'prov_c', destId: 'galapa', leadTime: 10, weight: 25, active: true },
    { skuId: 'tendidos', supplierId: 'prov_c', destId: 'bogota', leadTime: 9,  weight: 50, active: true },
    { skuId: 'tendidos', supplierId: 'prov_d', destId: 'bogota', leadTime: 14, weight: 50, active: true },
    // Almohadas
    { skuId: 'almohadas', supplierId: 'prov_a', destId: 'galapa', leadTime: 3,  weight: 50, active: true },
    { skuId: 'almohadas', supplierId: 'prov_b', destId: 'galapa', leadTime: 5,  weight: 50, active: true },
    { skuId: 'almohadas', supplierId: 'prov_c', destId: 'bogota', leadTime: 8,  weight: 60, active: true },
    { skuId: 'almohadas', supplierId: 'prov_d', destId: 'bogota', leadTime: 12, weight: 40, active: true },
    // Sábanas
    { skuId: 'sabanas', supplierId: 'prov_a', destId: 'galapa', leadTime: 4,  weight: 40, active: true },
    { skuId: 'sabanas', supplierId: 'prov_c', destId: 'galapa', leadTime: 8,  weight: 60, active: true },
    { skuId: 'sabanas', supplierId: 'prov_b', destId: 'bogota', leadTime: 10, weight: 100,active: true },
    // Cobijas
    { skuId: 'cobijas', supplierId: 'prov_b', destId: 'galapa', leadTime: 6,  weight: 100,active: true },
    { skuId: 'cobijas', supplierId: 'prov_c', destId: 'bogota', leadTime: 11, weight: 50, active: true },
    { skuId: 'cobijas', supplierId: 'prov_d', destId: 'bogota', leadTime: 15, weight: 50, active: true },
    // Colchones
    { skuId: 'colchones', supplierId: 'prov_d', destId: 'galapa', leadTime: 7,  weight: 100,active: true },
    { skuId: 'colchones', supplierId: 'prov_d', destId: 'bogota', leadTime: 14, weight: 100,active: true },
    // Cojines
    { skuId: 'cojines', supplierId: 'prov_a', destId: 'galapa', leadTime: 4,  weight: 50, active: true },
    { skuId: 'cojines', supplierId: 'prov_b', destId: 'galapa', leadTime: 6,  weight: 50, active: true },
    { skuId: 'cojines', supplierId: 'prov_c', destId: 'bogota', leadTime: 9,  weight: 100,active: true },
  ];

  db.inventory = [
    // Galapa
    { skuId: 'tendidos',  destId: 'galapa', inventory: 120, committedInv: 20, incomingOrders: 50,  projectedSales: 300, dailyDemand: 10,  ird: 0.033 },
    { skuId: 'almohadas', destId: 'galapa', inventory: 80,  committedInv: 10, incomingOrders: 0,   projectedSales: 200, dailyDemand: 8,   ird: 0.04  },
    { skuId: 'sabanas',   destId: 'galapa', inventory: 45,  committedInv: 5,  incomingOrders: 20,  projectedSales: 100, dailyDemand: 5,   ird: 0.05  },
    { skuId: 'cobijas',   destId: 'galapa', inventory: 200, committedInv: 0,  incomingOrders: 0,   projectedSales: 60,  dailyDemand: 2,   ird: 0.01  },
    { skuId: 'colchones', destId: 'galapa', inventory: 3,   committedInv: 1,  incomingOrders: 5,   projectedSales: 15,  dailyDemand: 0.5, ird: 0.167 },
    { skuId: 'cojines',   destId: 'galapa', inventory: 360, committedInv: 48, incomingOrders: 0,   projectedSales: 240, dailyDemand: 12,  ird: 0.033 },
    // Bogotá
    { skuId: 'tendidos',  destId: 'bogota', inventory: 60,  committedInv: 10, incomingOrders: 30,  projectedSales: 450, dailyDemand: 15,  ird: 0.033 },
    { skuId: 'almohadas', destId: 'bogota', inventory: 30,  committedInv: 5,  incomingOrders: 0,   projectedSales: 300, dailyDemand: 12,  ird: 0.04  },
    { skuId: 'sabanas',   destId: 'bogota', inventory: 20,  committedInv: 0,  incomingOrders: 0,   projectedSales: 150, dailyDemand: 7,   ird: 0.047 },
    { skuId: 'cobijas',   destId: 'bogota', inventory: 90,  committedInv: 15, incomingOrders: 50,  projectedSales: 90,  dailyDemand: 3,   ird: 0.033 },
    { skuId: 'colchones', destId: 'bogota', inventory: 8,   committedInv: 2,  incomingOrders: 10,  projectedSales: 30,  dailyDemand: 1,   ird: 0.1   },
    { skuId: 'cojines',   destId: 'bogota', inventory: 144, committedInv: 24, incomingOrders: 0,   projectedSales: 360, dailyDemand: 18,  ird: 0.05  },
  ];

  db.params = [];
  db.meta.lastImport = new Date().toISOString();
  DB.save();
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR AL SCOPE GLOBAL
// ═══════════════════════════════════════════════════════════

window.MotorReabastecimiento = {
  DB, Engine, Importer, Exporter, Admin,
  loadDemoData, DDI_COLORS
};
})(); // end IIFE
