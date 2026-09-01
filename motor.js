(function () {
'use strict';
/**
 * Asistente de Compra — motor.js v6.0
 *
 * Fórmulas (usuario):
 *   DS   = día semana actual (Lun=1…Dom=7)
 *   DDSMj= días de la semana en mes j
 *   IRDj = IRD del mes j  (monthlyIrds si existe, else IRDR)
 *   IRDR = IRD real (campo inventory.ird, obligatorio)
 *
 *   DDI                = Inventario / IRDR
 *   WeeklyDemand(sem)  = Σ(IRDj × DDSMj)
 *   InventarioObjetivo = (WeeklyDemand_proxSem / 7) × DDI_objetivo
 *   Ventas             = WeeklyDemand_semActual × (7−DS)/7
 *   InvProyectado      = Inventario − Ventas + pedidos ≤ fin semana actual
 *   CompraBruta        = InventarioObjetivo − InvProyectado
 *   CompraFinal        = MAX(0, TECHO(CompraBruta/MOQ)×MOQ)
 *   DDI_proy           = (InvProyectado + CompraFinal) / IRDR
 *
 * Heatmap (semana k, iterativo):
 *   sem0: demand = WeeklyDemand_k × (7−DS)/7
 *   semk: demand = WeeklyDemand_k
 *   projInv_k = projInv_{k-1} − demand_k + pedidos en semana k
 *   DDI_k = projInv_k / IRDR
 */

// ══════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════
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

// Clave estable — nunca cambia para no perder datos del usuario
const DB_KEY = 'asistente_compra_db';
// Claves antiguas a migrar automáticamente
const OLD_KEYS = ['replenishment_db_v1','replenishment_db_v2','replenishment_db_v3',
                  'replenishment_db_v4','replenishment_db_v5'];

// ══════════════════════════════════════════════════════
// BASE DE DATOS LOCAL
// ══════════════════════════════════════════════════════
const DB = {
  _data: null,

  _defaultData() {
    return {
      skus: [], suppliers: [],
      destinations: [
        { id:'galapa', name:'Galapa', active:true },
        { id:'bogota', name:'Bogotá', active:true }
      ],
      matrix: [],
      params: [],
      // inventory: { skuId, destId, inventory, ird }
      //   ird = IRDR (demanda diaria real, obligatorio)
      inventory: [],
      orders: [],
      // IRDs teóricos mensuales: { skuId, destId, year, month, ird }
      // Se usan en WeeklyDemand en lugar de IRDR para el mes correspondiente
      monthlyIrds: [],
      meta: { lastImport: null, version: '6.0' }
    };
  },

  load() {
    // ── BÚSQUEDA UNIVERSAL: escanea TODOS los keys del localStorage ──
    // No depende de una lista fija; funciona aunque cambie el nombre en futuras versiones
    let foundRaw  = null;
    let foundKey  = null;

    // 1. Primero intentar la clave estable actual
    foundRaw = localStorage.getItem(DB_KEY);
    if (foundRaw) foundKey = DB_KEY;

    // 2. Si no, escanear todas las claves buscando datos de la app
    if (!foundRaw) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        // Cualquier clave que haya sido nuestra
        if (key === DB_KEY ||
            key.startsWith('replenishment_db_') ||
            key.startsWith('asistente_compra')) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            // Solo aceptar si tiene estructura de nuestra app
            if (Array.isArray(parsed.skus) || Array.isArray(parsed.inventory)) {
              foundRaw = raw;
              foundKey = key;
              break;
            }
          } catch(e) {}
        }
      }
      // Migrar a clave estable para el futuro
      if (foundRaw && foundKey && foundKey !== DB_KEY) {
        try {
          localStorage.setItem(DB_KEY, foundRaw);
          localStorage.removeItem(foundKey);
        } catch(e) {}
      }
    }

    try {
      this._data = foundRaw ? JSON.parse(foundRaw) : this._defaultData();
      if (!this._data.orders)      this._data.orders      = [];
      if (!this._data.monthlyIrds) this._data.monthlyIrds = [];
      delete this._data.settings; // modo dual eliminado
      // Normalizar fechas de pedidos ya guardados con formato incorrecto
      this._data.orders.forEach(o => {
        if (o.arrivalDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.arrivalDate))) {
          const d = DateUtils.parse(o.arrivalDate);
          if (d) o.arrivalDate = DateUtils.toISO(d);
        }
      });
    } catch(e) {
      console.error('Error cargando DB:', e);
      this._data = this._defaultData();
    }
    return this._data;
  },

  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(this._data)); } catch(e) {
      console.error('Error guardando DB:', e);
    }
  },

  get()  { if (!this._data) this.load(); return this._data; },
  reset(){ this._data = this._defaultData(); this.save(); }
};

// ══════════════════════════════════════════════════════
// UTILIDADES DE FECHA
// ══════════════════════════════════════════════════════
const DateUtils = {
  today() { const d = new Date(); d.setHours(0,0,0,0); return d; },
  parse(str) {
    if (!str) return null;
    const s = String(str).trim();
    let y, mo, d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      [y, mo, d] = s.split('-').map(Number);
    } else {
      // Fallback: intenta parsear cualquier formato con barras
      const sl = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (sl) {
        let [, a, b, yy] = sl.map(Number);
        if (yy < 100) yy += 2000;
        if (b > 12)      { mo = a; d = b; y = yy; }
        else if (a > 12) { mo = b; d = a; y = yy; }
        else             { mo = a; d = b; y = yy; }
      } else {
        return null; // formato irreconocible
      }
    }
    const date = new Date(y, mo - 1, d);
    return isNaN(date.getTime()) ? null : date; // nunca retorna Invalid Date
  },
  toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },
  toShort(d) {
    const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return `${d.getDate()}-${M[d.getMonth()]}`;
  },
  monthName(m) {
    return ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
            'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][m-1];
  },
  diffDays(a,b) { return Math.round((b - a) / 86400000); },
  weekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0,0,0,0);
    return d;
  },
  addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; },
  /** DS = día de semana, Lun=1 … Dom=7 */
  dayOfWeek(date) { const d = date.getDay(); return d === 0 ? 7 : d; },
  getWeeks(n = 10) {
    const start = this.weekStart(this.today());
    return Array.from({ length: n }, (_, i) => {
      const ws = this.addDays(start, i * 7);
      const we = this.addDays(ws, 6);
      return { weekStart: ws, weekEnd: we,
               label: this.toShort(we),
               labelFull: `${this.toShort(ws)}-${this.toShort(we)}` };
    });
  },
  /**
   * Desglose de días de una semana por mes.
   * Retorna [{ year, month, days }] — suma siempre 7
   */
  getDDSM(weekStart, weekEnd) {
    const map = {};
    let d = new Date(weekStart);
    while (d <= weekEnd) {
      const key = `${d.getFullYear()}-${d.getMonth()+1}`;
      map[key] = (map[key] || 0) + 1;
      d = this.addDays(d, 1);
    }
    return Object.entries(map).map(([k, days]) => {
      const [year, month] = k.split('-').map(Number);
      return { year, month, days };
    });
  },
  getMonthsCovered(weeks) {
    const seen = new Set(), months = [];
    for (const w of weeks) {
      let d = new Date(w.weekStart);
      while (d <= w.weekEnd) {
        const key = `${d.getFullYear()}-${d.getMonth()+1}`;
        if (!seen.has(key)) {
          seen.add(key);
          months.push({ year: d.getFullYear(), month: d.getMonth()+1, name: this.monthName(d.getMonth()+1) });
        }
        d = this.addDays(d, 1);
      }
    }
    return months;
  }
};

// ══════════════════════════════════════════════════════
// MOTOR DE CÁLCULO
// ══════════════════════════════════════════════════════
const Engine = {

  getDDIColor(ddi) {
    if (ddi === null || ddi === undefined || isNaN(ddi))
      return { color: '#94a3b8', label: 'Sin datos', bg: '#f8fafc' };
    for (const b of DDI_COLORS) if (ddi <= b.max) return b;
    return DDI_COLORS[DDI_COLORS.length - 1];
  },

  /**
   * IRD para un mes específico.
   * Usa IRD teórico mensual si existe, fallback a IRDR.
   * No hay modo — siempre comprueba monthlyIrds.
   */
  getIrdForMonth(skuId, destId, year, month) {
    const db    = DB.get();
    const inv   = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};
    const irdr  = inv.ird || 0;
    const entry = db.monthlyIrds.find(m =>
      m.skuId === skuId && m.destId === destId && m.year === year && m.month === month
    );
    return entry !== undefined ? entry.ird : irdr;
  },

  /**
   * WeeklyDemand = Σ(IRDj × DDSMj)
   * Retorna { total, ddsm: [{year,month,days,ird,demand,name}] }
   */
  calcWeeklyWeightedDemand(skuId, destId, weekStart, weekEnd) {
    const ddsm  = DateUtils.getDDSM(weekStart, weekEnd);
    let total   = 0;
    const detail = ddsm.map(({ year, month, days }) => {
      const ird    = this.getIrdForMonth(skuId, destId, year, month);
      const demand = ird * days;
      total += demand;
      return { year, month, days, ird, demand, name: DateUtils.monthName(month) };
    });
    return { total, ddsm: detail };
  },

  getTotalIncoming(skuId, destId) {
    const today = DateUtils.today();
    return DB.get().orders
      .filter(o => o.skuId === skuId && o.destId === destId)
      .filter(o => { const a = DateUtils.parse(o.arrivalDate); return a && a >= today; })
      .reduce((s, o) => s + (o.qty || 0), 0);
  },

  getOrdersInRange(skuId, destId, from, to) {
    return DB.get().orders
      .filter(o => o.skuId === skuId && o.destId === destId)
      .filter(o => { const a = DateUtils.parse(o.arrivalDate); return a && a >= from && a <= to; });
  },

  normalizeSupplierWeights(skuId, destId) {
    const valid = DB.get().matrix.filter(m => m.skuId === skuId && m.destId === destId && m.active);
    if (!valid.length) return [];
    const total = valid.reduce((s, m) => s + (m.weight || 0), 0);
    return valid.map(m => ({ ...m, normalizedWeight: total ? (m.weight || 0) / total : 1 / valid.length }));
  },

  /**
   * Calcula la fecha exacta de quiebre de stock (inventario ≤ 0),
   * iterando día a día y contando los pedidos en camino que llegan.
   * Retorna Date o null si no hay quiebre en 2 años.
   */
  calcStockOutDate(skuId, destId) {
    const db  = DB.get();
    const inv = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};
    const irdr = inv.ird || 0;
    if (irdr <= 0) return null;

    const today  = DateUtils.today();
    const orders = db.orders
      .filter(o => o.skuId === skuId && o.destId === destId)
      .filter(o => { const a = DateUtils.parse(o.arrivalDate); return a && a >= today; });

    let runningInv = inv.inventory || 0;
    let date = new Date(today);

    for (let day = 0; day < 730; day++) {
      // Recibir pedidos que llegan hoy
      const iso = DateUtils.toISO(date);
      runningInv += orders
        .filter(o => DateUtils.toISO(DateUtils.parse(o.arrivalDate)) === iso)
        .reduce((s, o) => s + (o.qty || 0), 0);
      // Consumir demanda diaria
      runningInv -= irdr;
      if (runningInv <= 0) return new Date(date);
      date = DateUtils.addDays(date, 1);
    }
    return null;
  },

  /**
   * Distribuye la compra entre proveedores con fechas de entrega escalonadas.
   * - Ordena proveedores por lead time ascendente
   * - Asigna arrivalDate = hoy + leadTime por proveedor
   * - Resuelve conflictos: ningún proveedor entrega el mismo día que otro del mismo SKU
   *   Si dos coinciden, el segundo se desplaza +1 día (y así sucesivamente)
   */
  /** Redondea hacia arriba a la decena más cercana (preferencia de compra en decenas) */
  roundToTen(qty) {
    return qty % 10 === 0 ? qty : Math.ceil(qty / 10) * 10;
  },

  /**
   * Calcula las cantidades por proveedor para un SKU (SIN fecha de entrega).
   * Aplica redondeo a MOQ y luego a la decena más cercana (hacia arriba).
   * Las fechas se asignan después, globalmente, vía scheduleDeliveries().
   */
  calcSupplierQuantities(skuId, destId, qtyNeeded) {
    if (qtyNeeded <= 0) return [];
    const suppliers = this.normalizeSupplierWeights(skuId, destId);
    if (!suppliers.length) return [];
    const db = DB.get();
    return suppliers.map(e => {
      const sup = db.suppliers.find(s => s.id === e.supplierId);
      // Cantidad CRUDA por referencia. El MOQ NO se aplica aquí: se valida
      // sobre la suma consolidada de todas las referencias del proveedor
      // para un mismo día de entrega (ver scheduleDeliveries).
      const raw = qtyNeeded * e.normalizedWeight;
      return {
        supplierId: e.supplierId, supplierName: sup?.name || e.supplierId,
        leadTime: e.leadTime || 0, weight: e.weight || 0,
        normalizedWeight: e.normalizedWeight,
        moq: e.moq || 1,
        quantity: this.roundToTen(Math.ceil(raw))
      };
    });
  },

  /**
   * Programa las entregas de TODAS las compras pendientes de forma consolidada.
   *
   * Unidad de programación = ENTREGA CONSOLIDADA de un proveedor:
   *   (proveedor × categoría × destino) agrupa todas sus referencias.
   *
   * Reglas:
   *  1. MOQ CONSOLIDADO: el mínimo se valida sobre la SUMA de todas las referencias
   *     del proveedor en la entrega, no por referencia individual.
   *  2. CONSOLIDACIÓN: se entrega todo lo posible en un mismo día (hasta 500 u).
   *     Solo se abre un nuevo día cuando se agota la capacidad diaria.
   *  3. EXCLUSIVIDAD DE DÍA: dentro de una misma categoría + destino, un día de
   *     entrega pertenece a UN SOLO proveedor. Dos proveedores de la misma
   *     categoría nunca coinciden en la misma fecha.
   *  4. Entregas sucesivas del mismo proveedor se separan una semana (2-3 al mes).
   *  5. Holgura de ±3 días para encontrar un día libre.
   *
   * Retorna Map key=`${skuId}|${destId}|${supplierId}` -> [{ qty, date }]
   */
  scheduleDeliveries(pendingLines) {
    const DAILY_CAP = 500;
    const SLACK     = 3;
    const today     = DateUtils.today();

    // Reserva de días: `${categoria}::${destId}::${iso}` -> supplierId dueño del día
    const dayOwner = {};

    // Agrupar por proveedor × categoría × destino (entrega consolidada)
    const groups = {};
    for (const line of pendingLines) {
      const key = `${line.supplierId}::${line.category || ''}::${line.destId}`;
      if (!groups[key]) {
        groups[key] = {
          supplierId: line.supplierId, category: line.category || '',
          destId: line.destId, moq: line.moq || 1, lines: []
        };
      }
      const g = groups[key];
      g.moq = Math.max(g.moq, line.moq || 1);
      g.lines.push(line);
    }

    const resultMap = new Map();
    const pushShipment = (line, qty, date) => {
      const k = `${line.skuId}|${line.destId}|${line.supplierId}`;
      if (!resultMap.has(k)) resultMap.set(k, []);
      resultMap.get(k).push({ qty, date: new Date(date) });
    };

    // La fecha nominal del grupo respeta el lead time más largo de sus referencias
    const groupList = Object.values(groups).map(g => {
      g.nominalDate = new Date(Math.max(...g.lines.map(l => l.nominalDate.getTime())));
      return g;
    }).sort((a, b) => a.nominalDate - b.nominalDate);

    for (const g of groupList) {
      // ── 1. Cantidad por referencia (decenas) ──
      const items = g.lines
        .map(l => ({ line: l, qty: this.roundToTen(Math.ceil(l.quantity)) }))
        .filter(it => it.qty > 0)
        .sort((a, b) => b.qty - a.qty);
      if (!items.length) continue;

      // ── 2. MOQ CONSOLIDADO sobre la suma de referencias ──
      let total = items.reduce((s, it) => s + it.qty, 0);
      if (total < g.moq) {
        const falta = this.roundToTen(g.moq - total);
        items[0].qty += falta;   // se completa con la referencia de mayor necesidad
        total += falta;
      }

      // ── 3. Empaquetar referencias en días (todo lo posible por día) ──
      const deliveries = [];
      let cur = { items: [], total: 0 };
      for (const it of items) {
        let remaining = it.qty;
        while (remaining > 0) {
          const space = DAILY_CAP - cur.total;
          if (space <= 0) { deliveries.push(cur); cur = { items: [], total: 0 }; continue; }
          const take = Math.min(remaining, space);
          cur.items.push({ line: it.line, qty: take });
          cur.total += take;
          remaining -= take;
        }
      }
      if (cur.items.length) deliveries.push(cur);

      // ── 4. Asignar fecha exclusiva a cada entrega, separadas por semana ──
      const usedByGroup = new Set();
      for (let di = 0; di < deliveries.length; di++) {
        const base = DateUtils.addDays(g.nominalDate, di * 7);
        const offsets = [0];
        for (let o = 1; o <= SLACK; o++) { offsets.push(o); offsets.push(-o); }

        let chosen = null;
        for (let wk = 0; wk < 16 && !chosen; wk++) {
          for (const off of offsets) {
            const d = DateUtils.addDays(base, wk * 7 + off);
            if (d < today) continue;
            const iso = DateUtils.toISO(d);
            if (usedByGroup.has(iso)) continue;                 // no repetir día del grupo
            const owner = dayOwner[`${g.category}::${g.destId}::${iso}`];
            if (owner && owner !== g.supplierId) continue;       // día tomado por otro proveedor
            chosen = d; break;
          }
        }
        if (!chosen) chosen = DateUtils.addDays(base, di);       // último recurso

        const isoChosen = DateUtils.toISO(chosen);
        dayOwner[`${g.category}::${g.destId}::${isoChosen}`] = g.supplierId;
        usedByGroup.add(isoChosen);

        for (const it of deliveries[di].items) pushShipment(it.line, it.qty, chosen);
      }
    }

    return resultMap;
  },

  /**
   * Proyección semanal (heatmap).
   * Semana 0 (actual, parcial): demand = WeeklyDemand × (7−DS)/7
   * Semana k (completa):        demand = WeeklyDemand_k
   * projInv iterativo; DDI = projInv / IRDR siempre.
   */
  calcWeeklyProjection(skuId, destId, weeksAhead = 10) {
    const db      = DB.get();
    const inv     = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};
    const sku     = db.skus.find(s => s.id === skuId);
    const today   = DateUtils.today();
    const DS      = DateUtils.dayOfWeek(today);

    const irdr      = inv.ird || 0;
    const currentInv= inv.inventory || 0;
    const targetDDI = (db.params.find(p => p.skuId === skuId && p.destId === destId) || {}).targetDDI
                      || sku?.targetDDI || 30;
    const weeks     = DateUtils.getWeeks(weeksAhead);
    let   prevInv   = currentInv;

    return weeks.map((week, wi) => {
      const wd            = this.calcWeeklyWeightedDemand(skuId, destId, week.weekStart, week.weekEnd);
      const weeklyDemand  = wd.total;
      const demandConsumed= wi === 0
        ? weeklyDemand * (7 - DS) / 7   // semana actual: fracción restante
        : weeklyDemand;                  // semanas futuras: completa

      const ordersThisWeek = this.getOrdersInRange(skuId, destId, week.weekStart, week.weekEnd);
      const ordersQty      = ordersThisWeek.reduce((s, o) => s + (o.qty || 0), 0);

      const projInv  = prevInv - demandConsumed + ordersQty;
      const projDDI  = irdr > 0 ? projInv / irdr : null;
      const ddiColor = this.getDDIColor(projDDI);
      prevInv        = projInv;

      return {
        ...week,
        weeklyDemand: Math.round(weeklyDemand),
        demandConsumed: Math.round(demandConsumed),
        projInv: Math.round(projInv),
        projDDI, ddiColor,
        isAtRisk:    projDDI !== null && projDDI <= 7,
        isCritical:  projDDI !== null && projDDI <= 0,
        targetDDI, ordersThisWeek, ordersQty,
        ddsm: wd.ddsm
      };
    });
  },

  /**
   * Fase 1: calcula todos los indicadores de un SKU+Destino EXCEPTO las fechas
   * de entrega de la compra sugerida (esas se asignan globalmente en calcAll,
   * después de conocer las necesidades de TODOS los SKUs).
   */
  calcRowBase(skuId, destId) {
    const db   = DB.get();
    const sku  = db.skus.find(s => s.id === skuId);
    const dest = db.destinations.find(d => d.id === destId);
    if (!sku || !dest) return null;

    const param = db.params.find(p => p.skuId === skuId && p.destId === destId) || {};
    const inv   = db.inventory.find(i => i.skuId === skuId && i.destId === destId) || {};

    const irdr      = inv.ird || param.ird || 0;   // IRDR siempre para DDI
    const currentInv= inv.inventory || 0;
    const targetDDI = param.targetDDI || sku.targetDDI || 30;
    const today     = DateUtils.today();
    const DS        = DateUtils.dayOfWeek(today);

    // Semana actual (para Ventas e InvProyectado)
    const curWS  = DateUtils.weekStart(today);
    const curWE  = DateUtils.addDays(curWS, 6);
    const wdCur  = this.calcWeeklyWeightedDemand(skuId, destId, curWS, curWE);

    // Semana próxima (para InventarioObjetivo)
    const nxtWS  = DateUtils.addDays(curWS, 7);
    const nxtWE  = DateUtils.addDays(nxtWS, 6);
    const wdNxt  = this.calcWeeklyWeightedDemand(skuId, destId, nxtWS, nxtWE);

    // Ventas = WeeklyDemand_actual × (7−DS)/7
    const ventas = wdCur.total * (7 - DS) / 7;

    // Pedidos que llegan hasta fin de semana actual
    const ordersWeek = this.getOrdersInRange(skuId, destId, today, curWE);
    const ordersWeekQty = ordersWeek.reduce((s, o) => s + (o.qty || 0), 0);

    // InvProyectado al fin de semana actual
    const projectedInv = currentInv - ventas + ordersWeekQty;

    // InventarioObjetivo basado en demanda semana próxima
    const targetInv = (wdNxt.total / 7) * targetDDI;

    const compraBruta = targetInv - projectedInv;
    const stockOutDate = this.calcStockOutDate(skuId, destId);

    // Cantidades por proveedor (sin fecha aún) + líneas pendientes para el programador global
    const supplierQtys = this.calcSupplierQuantities(skuId, destId, Math.max(0, compraBruta));
    const pendingLines = supplierQtys
      .filter(sq => sq.quantity > 0)
      .map(sq => ({
        skuId, destId, category: sku.category,
        supplierId: sq.supplierId, supplierName: sq.supplierName,
        leadTime: sq.leadTime, moq: sq.moq, quantity: sq.quantity,
        nominalDate: DateUtils.addDays(today, sq.leadTime)
      }));

    const suggestedQty = supplierQtys.length
      ? supplierQtys.reduce((s, sq) => s + sq.quantity, 0)
      : (compraBruta > 0 ? this.roundToTen(Math.ceil(compraBruta)) : 0);

    const suppliers   = this.normalizeSupplierWeights(skuId, destId);
    const avgLeadTime = suppliers.length
      ? suppliers.reduce((s, e) => s + e.leadTime * e.normalizedWeight, 0)
      : (param.leadTime || 0);

    const currentDDI   = irdr > 0 ? currentInv / irdr : null;
    const projectedDDI = irdr > 0 ? (projectedInv + suggestedQty) / irdr : null;
    const ddiColor     = this.getDDIColor(currentDDI);

    const weeklyProjection  = this.calcWeeklyProjection(skuId, destId, 10);
    const firstRiskWeek     = weeklyProjection.find(w => w.isAtRisk);
    const firstCriticalWeek = weeklyProjection.find(w => w.isCritical);

    // Meses cubiertos por sem próxima (para info en modal)
    const nxtMonths = wdNxt.ddsm.map(m => `${m.name}: ${m.days}d × ${m.ird.toFixed(1)} = ${m.demand.toFixed(1)}`).join(' | ');

    return {
      skuId, destId,
      skuName: sku.name, skuCode: sku.code,
      description: sku.description, category: sku.category, destName: dest.name,
      irdr,
      currentInv, ventas: Math.round(ventas), ordersWeekQty,
      weeklyDemandCur: Math.round(wdCur.total),
      weeklyDemandNxt: Math.round(wdNxt.total),
      incomingOrders: this.getTotalIncoming(skuId, destId),
      targetDDI, avgLeadTime,
      projectedInv: Math.round(projectedInv),
      targetInv: Math.round(targetInv),
      compraBruta: Math.round(compraBruta),
      suggestedQty, projectedDDI,
      currentDDI, ddiColor,
      distribution: [], // se completa en fase 3 (calcAll)
      _supplierQtys: supplierQtys,
      _pendingLines: pendingLines,
      weeklyProjection, firstRiskWeek, firstCriticalWeek,
      nxtMonths,
      stockOutDate,
      curDDSM: wdCur.ddsm, nxtDDSM: wdNxt.ddsm
    };
  },

  calcAll() {
    const db = DB.get();
    const rows = [];
    const allPendingLines = [];

    // Fase 1: calcular todos los indicadores excepto fechas de entrega
    for (const sku of db.skus) {
      for (const dest of db.destinations.filter(d => d.active)) {
        const row = this.calcRowBase(sku.id, dest.id);
        if (!row) continue;
        allPendingLines.push(...row._pendingLines);
        rows.push(row);
      }
    }

    // Fase 2: programar entregas globalmente (tope 500u/día por proveedor+categoría,
    // holgura ±3 días, preferencia de repartir en 2-3 semanas)
    const shipmentsMap = this.scheduleDeliveries(allPendingLines);

    // Fase 3: ensamblar distribution final con fechas y orderByDate por envío
    for (const row of rows) {
      row.distribution = row._supplierQtys.map(sq => {
        const key = `${row.skuId}|${row.destId}|${sq.supplierId}`;
        const rawShipments = shipmentsMap.get(key) || [];
        const shipments = rawShipments.map(sh => ({
          qty: sh.qty,
          arrivalDate: sh.date,
          orderByDate: DateUtils.addDays(sh.date, -sq.leadTime)
        }));
        // La cantidad real del proveedor es la suma de sus envíos programados
        // (puede diferir del cálculo previo por el MOQ consolidado)
        const scheduledQty = shipments.reduce((s, sh) => s + sh.qty, 0);
        return {
          supplierId: sq.supplierId, supplierName: sq.supplierName,
          leadTime: sq.leadTime, weight: sq.weight, normalizedWeight: sq.normalizedWeight,
          moq: sq.moq,
          quantity: scheduledQty || sq.quantity,
          shipments
        };
      });

      // Recalcular la compra total y el DDI proyectado con las cantidades ya programadas
      const totalScheduled = row.distribution.reduce((s, d) => s + d.quantity, 0);
      if (totalScheduled > 0) {
        row.suggestedQty = totalScheduled;
        row.projectedDDI = row.irdr > 0
          ? (row.projectedInv + totalScheduled) / row.irdr
          : null;
      }

      delete row._supplierQtys;
      delete row._pendingLines;
    }

    return rows;
  }
};

// ══════════════════════════════════════════════════════
// IMPORTADOR
// ══════════════════════════════════════════════════════
const Importer = {
  async readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:true });
          const sheets = {};
          for (const name of wb.SheetNames)
            sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval:null, raw:false, dateNF:'yyyy-mm-dd' });
          resolve({ sheets });
        } catch(err) { reject(new Error('Error leyendo Excel: ' + err.message)); }
      };
      reader.onerror = () => reject(new Error('Error leyendo archivo'));
      reader.readAsArrayBuffer(file);
    });
  },
  processInventory(rows) {
    const errors = [], processed = [], monthlyIrds = [];
    const today = DateUtils.today();
    rows.forEach((row, i) => {
      if (!row['SKU'] || !row['Destino']) { errors.push(`Fila ${i+2}: SKU y Destino requeridos`); return; }
      // IRD Real (acepta varios encabezados por compatibilidad)
      const ird = parseFloat(row['IRD Real'] || row['IRD'] || row['IRD (Dem. Diaria u/dia)']);
      if (isNaN(ird) || ird < 0) { errors.push(`Fila ${i+2}: IRD Real debe ser número ≥ 0`); return; }
      const skuId  = String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_');
      const destId = String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({ skuId, destId, inventory: parseFloat(row['Inventario']) || 0, ird });

      // Columnas de IRD teórico mensual: "IRD T mes", "IRD T mes+1", ...
      // El offset N indica el mes (mes actual + N)
      for (const key of Object.keys(row)) {
        const mtch = /^IRD\s*T\s*mes\s*(?:\+\s*(\d+))?/i.exec(key);
        if (!mtch) continue;
        const offset = mtch[1] ? parseInt(mtch[1]) : 0;
        const val = parseFloat(row[key]);
        if (isNaN(val) || val < 0) continue; // vacío = usa IRD real
        const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
        monthlyIrds.push({ skuId, destId, year: d.getFullYear(), month: d.getMonth() + 1, ird: val });
      }
    });
    return { processed, errors, monthlyIrds };
  },
  processSKUs(rows) {
    const errors = [], processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU']) { errors.push(`Fila ${i+2}: SKU requerido`); return; }
      const id = String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({ id, code: String(row['SKU']).trim(),
        name: String(row['Nombre'] || row['SKU']).trim(),
        description: String(row['Descripcion'] || row['Descripción'] || '').trim(),
        category: String(row['Categoria'] || row['Categoría'] || '').trim(),
        targetDDI: parseFloat(row['DDI Objetivo']) || 30, active: true });
    });
    return { processed, errors };
  },
  processSuppliers(rows) {
    const errors = [], processed = [];
    rows.forEach((row, i) => {
      if (!row['Proveedor']) { errors.push(`Fila ${i+2}: Proveedor requerido`); return; }
      const id = String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({ id, name: String(row['Nombre'] || row['Proveedor']).trim(),
        contact: String(row['Contacto'] || '').trim(),
        email: String(row['Email'] || '').trim(), active: true });
    });
    return { processed, errors };
  },
  processMatrix(rows) {
    const errors = [], processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU'] || !row['Proveedor'] || !row['Destino']) { errors.push(`Fila ${i+2}: faltan campos`); return; }
      processed.push({
        skuId:      String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        supplierId: String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId:     String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        leadTime: parseFloat(row['Lead Time (dias)'] || row['Lead Time (días)']) || 0,
        weight:   parseFloat(row['Peso (%)']) || 25,
        moq:      parseFloat(row['MOQ']) || 1,
        active:   String(row['Activo'] || 'SI').toUpperCase() !== 'NO'
      });
    });
    return { processed, errors };
  },
  processOrders(rows) {
    const errors = [], processed = [];
    rows.forEach((row, i) => {
      if (!row['SKU'] || !row['Destino'] || !row['Fecha Llegada'] || !row['Cantidad']) {
        errors.push(`Fila ${i+2}: faltan campos`); return;
      }
      // Parseo robusto — SheetJS puede retornar Date, YYYY-MM-DD, M/D/YY, DD/MM/YYYY
      const rawDate = row['Fecha Llegada'];
      let ds = '';
      if (rawDate instanceof Date && !isNaN(rawDate)) {
        // Objeto Date de SheetJS con raw:true
        ds = `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,'0')}-${String(rawDate.getDate()).padStart(2,'0')}`;
      } else {
        ds = String(rawDate || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
          // Formatos con barra: M/D/YY, M/D/YYYY, DD/MM/YYYY
          const slashMatch = ds.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          if (slashMatch) {
            let [, a, b, y] = slashMatch.map(Number);
            if (y < 100) y += 2000;
            // Determinar cuál es día y cuál mes
            let month, day;
            if (b > 12)      { month = a; day = b; }   // M/D/... (US, SheetJS default)
            else if (a > 12) { month = b; day = a; }   // DD/MM/... (EU/CO)
            else             { month = a; day = b; }   // Ambiguo → asumir M/D (SheetJS default)
            ds = `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          }
        }
      }
      if (!ds || ds.length < 10) {
        errors.push(`Fila ${i+2}: Fecha Llegada inválida ("${rawDate}")`); return;
      }
      processed.push({ id: `ord_${Date.now()}_${i}`,
        skuId:     String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId:    String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        supplierId:String(row['Proveedor'] || '').trim().toLowerCase().replace(/\s+/g,'_'),
        qty: parseFloat(row['Cantidad']) || 0, arrivalDate: ds,
        notes: String(row['Notas'] || '').trim()
      });
    });
    return { processed, errors };
  },

  /**
   * Lee la Herramienta SAP (.xlsb) y devuelve una VISTA PREVIA de los cambios,
   * sin aplicar nada. El usuario confirma después con applyHerramientaUpdate().
   *
   * opts: { destBog, destGal, destOrders }
   * Retorna: { success, errors, warnings, preview, skipped, monthsInfo }
   *   preview.inventory: [{ skuId, skuCode, destId, destName, oldInv, newInv, oldIrd, newIrd }]
   *   preview.monthly:   [{ skuId, skuCode, destId, destName, year, month, monthName, oldIrd, newIrd }]
   *   preview.orders:    [{ skuId, skuCode, destName, qty, arrivalDate }]
   */
  async parseHerramientaFile(file, opts = {}) {
    const destBog    = opts.destBog    || 'bogota';
    const destGal    = opts.destGal    || 'galapa';
    const destOrders = opts.destOrders || 'galapa';
    const result = {
      success: false, errors: [], warnings: [], skipped: 0,
      preview: { inventory: [], monthly: [], orders: [] },
      monthsInfo: '',
      _opts: { destBog, destGal, destOrders }
    };

    try {
      const ab = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = e => res(e.target.result);
        reader.onerror = () => rej(new Error('Error leyendo archivo'));
        reader.readAsArrayBuffer(file);
      });

      const wb = XLSX.read(new Uint8Array(ab), { type: 'array', cellDates: false, raw: true });
      const db = DB.get();

      const skuMap = {};
      for (const sku of db.skus) {
        skuMap[sku.code.toLowerCase().replace(/\s+/g,'_')] = sku.id;
        skuMap[String(sku.code).trim().toLowerCase()]      = sku.id;
        skuMap[sku.id]                                      = sku.id;
      }
      const skuById   = id => db.skus.find(s => s.id === id);
      const destName  = id => (db.destinations.find(d => d.id === id)||{}).name || id;
      const hasBog    = !!db.destinations.find(d => d.id === destBog && d.active);
      const hasGal    = !!db.destinations.find(d => d.id === destGal && d.active);

      const MESES = {'ENE':1,'FEB':2,'MAR':3,'ABR':4,'MAY':5,'JUN':6,
                     'JUL':7,'AGO':8,'SEP':9,'OCT':10,'NOV':11,'DIC':12};
      const MNAME = m => ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][m-1];

      const serialToISO = s => {
        if (!s || typeof s !== 'number') return null;
        const d = new Date(Math.round((s - 25569) * 86400000));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      };

      // ─── HOJA HERRAMIENTA ───
      if (!wb.Sheets['HERRAMIENTA']) {
        result.warnings.push('Hoja "HERRAMIENTA" no encontrada');
      } else {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['HERRAMIENTA'], { header: 1, defval: null, raw: true });
        const hdr  = rows[4] || [];
        const today  = DateUtils.today();
        const curYear= today.getFullYear(), curMo = today.getMonth() + 1;
        const labelT = String(hdr[19] || '').trim().toUpperCase().slice(0,3);
        const labelU = String(hdr[20] || '').trim().toUpperCase().slice(0,3);
        const moT = MESES[labelT] || curMo;
        const moU = MESES[labelU] || (curMo === 12 ? 1 : curMo + 1);
        const yrT = curYear;
        const yrU = moU < moT ? curYear + 1 : curYear;
        result.monthsInfo = `IRD teórico: ${MNAME(moT)} ${yrT} (col T) y ${MNAME(moU)} ${yrU} (col U)`;

        for (let i = 5; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;
          const rawCode = String(row[7] ?? '').trim();
          if (!rawCode || rawCode === 'Código') continue;
          const skuId = skuMap[rawCode.toLowerCase()];
          if (!skuId) { result.skipped++; continue; }

          const sku    = skuById(skuId);
          const invBog = parseFloat(row[12]);
          const irdBog = parseFloat(row[15]);
          const irdGal = parseFloat(row[17]);
          const irdTm  = parseFloat(row[19]);
          const irdTn  = parseFloat(row[20]);
          const invGal = parseFloat(row[30]);

          if (hasBog && !isNaN(invBog) && !isNaN(irdBog)) {
            const ex = db.inventory.find(x => x.skuId===skuId && x.destId===destBog) || {};
            result.preview.inventory.push({
              skuId, skuCode: sku.code, skuName: sku.name, destId: destBog, destName: destName(destBog),
              oldInv: ex.inventory ?? null, newInv: invBog,
              oldIrd: ex.ird ?? null,       newIrd: irdBog
            });
          }
          if (hasGal && !isNaN(invGal) && !isNaN(irdGal)) {
            const ex = db.inventory.find(x => x.skuId===skuId && x.destId===destGal) || {};
            result.preview.inventory.push({
              skuId, skuCode: sku.code, skuName: sku.name, destId: destGal, destName: destName(destGal),
              oldInv: ex.inventory ?? null, newInv: invGal,
              oldIrd: ex.ird ?? null,       newIrd: irdGal
            });
          }
          // IRD teórico mes en curso — SOLO Galapa (Bogotá no tiene IRD teórico)
          if (!isNaN(irdTm) && hasGal) {
            const ex = db.monthlyIrds.find(x => x.skuId===skuId && x.destId===destGal && x.year===yrT && x.month===moT);
            result.preview.monthly.push({
              skuId, skuCode: sku.code, skuName: sku.name, destId: destGal, destName: destName(destGal),
              year: yrT, month: moT, monthName: MNAME(moT),
              oldIrd: ex ? ex.ird : null, newIrd: irdTm
            });
          }
          // IRD teórico mes siguiente — SOLO Galapa
          if (!isNaN(irdTn) && hasGal) {
            const ex = db.monthlyIrds.find(x => x.skuId===skuId && x.destId===destGal && x.year===yrU && x.month===moU);
            result.preview.monthly.push({
              skuId, skuCode: sku.code, skuName: sku.name, destId: destGal, destName: destName(destGal),
              year: yrU, month: moU, monthName: MNAME(moU),
              oldIrd: ex ? ex.ird : null, newIrd: irdTn
            });
          }
        }
      }

      // ─── HOJA ME80AN REPARTO ───
      if (!wb.Sheets['ME80AN Reparto']) {
        result.warnings.push('Hoja "ME80AN Reparto" no encontrada');
      } else {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['ME80AN Reparto'], { header: 1, defval: null, raw: true });
        // Mapa centro SAP → destino de la app
        const centroMap = { '1000': destGal, '1001': destBog };
        for (let i = 2; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;
          const rawCode = String(row[7] ?? '').trim();
          if (!rawCode || rawCode === 'Material') continue;
          const skuId = skuMap[rawCode.toLowerCase()];
          if (!skuId) continue;
          const qty = parseFloat(row[9]);
          if (!qty || qty <= 0) continue;
          const arrivalDate = serialToISO(row[12]);
          if (!arrivalDate) {
            result.errors.push(`ME80AN fila ${i+1}: fecha inválida para SKU ${rawCode}`);
            continue;
          }
          // Centro desde columna O (índice 14): 1000=Galapa, 1001=Bogotá
          const centro = String(row[14] ?? '').trim();
          const dId = centroMap[centro];
          if (!dId) {
            result.warnings.push(`ME80AN fila ${i+1}: centro "${centro}" no reconocido (SKU ${rawCode})`);
            continue;
          }
          if (!db.destinations.find(d => d.id === dId && d.active)) continue;
          const sku = skuById(skuId);
          result.preview.orders.push({
            skuId, skuCode: sku.code, skuName: sku.name, destId: dId, destName: destName(dId),
            qty, arrivalDate
          });
        }
      }

      result.success = true;
    } catch(e) {
      result.errors.push(e.message);
      console.error('parseHerramientaFile error:', e);
    }
    return result;
  },

  /**
   * Aplica los cambios previamente leídos por parseHerramientaFile.
   * preview = el objeto result.preview; opts = result._opts
   */
  applyHerramientaUpdate(preview, opts = {}) {
    const db = DB.get();
    const destOrders = opts.destOrders || 'galapa';
    const counts = { inventory: 0, monthly: 0, orders: 0 };

    // Inventario
    for (const p of preview.inventory) {
      const ex = db.inventory.find(x => x.skuId===p.skuId && x.destId===p.destId) || {};
      Admin.saveInventory({ ...ex, skuId: p.skuId, destId: p.destId, inventory: p.newInv, ird: p.newIrd });
      counts.inventory++;
    }
    // IRDs teóricos
    for (const p of preview.monthly) {
      Admin.saveMonthlyIrd({ skuId: p.skuId, destId: p.destId, year: p.year, month: p.month, ird: p.newIrd });
      counts.monthly++;
    }
    // Pedidos: reemplazar SAP anteriores + dedup contra cualquier pedido idéntico
    if (preview.orders.length) {
      const matchedSKUs = new Set(preview.orders.map(o => o.skuId));
      // Clave de coincidencia exacta: SKU + fecha + cantidad
      const orderKey = o => `${o.skuId}|${o.arrivalDate}|${o.qty}`;
      const incomingKeys = new Set(preview.orders.map(orderKey));

      db.orders = db.orders.filter(o => {
        // Eliminar SAP anteriores de los SKUs que vienen en la herramienta
        if (matchedSKUs.has(o.skuId) && o.notes === 'SAP ME80AN') return false;
        // Eliminar cualquier pedido (manual o no) que coincida exactamente con uno entrante
        // → el de la herramienta lo reemplaza, evitando duplicados
        if (incomingKeys.has(orderKey(o))) return false;
        return true;
      });

      preview.orders.forEach((o, i) => {
        db.orders.push({
          id: `sap_${o.skuId}_${i}_${Date.now()}`,
          skuId: o.skuId, destId: o.destId, supplierId: '',
          qty: o.qty, arrivalDate: o.arrivalDate, notes: 'SAP ME80AN'
        });
        counts.orders++;
      });
    }
    DB.save();
    return counts;
  },

  async importFile(file) {
    const result = { success: false, errors: [], warnings: [], imported: {} };
    try {
      const { sheets } = await this.readFile(file);
      const db = DB.get();
      const run = (name, fn, target) => {
        if (!sheets[name]) { result.warnings.push(`Hoja "${name}" no encontrada`); return; }
        const r = fn(sheets[name]); db[target] = r.processed;
        result.imported[name] = r.processed.length;
        result.errors.push(...r.errors.map(e => `[${name}] ${e}`));
        // La hoja Inventario también trae los IRD teóricos mensuales
        if (name === 'Inventario' && r.monthlyIrds) {
          db.monthlyIrds = r.monthlyIrds;
          if (r.monthlyIrds.length) result.imported['IRDs Teóricos'] = r.monthlyIrds.length;
        }
      };
      run('SKUs',          this.processSKUs.bind(this),          'skus');
      run('Inventario',    this.processInventory.bind(this),     'inventory');
      run('Proveedores',   this.processSuppliers.bind(this),     'suppliers');
      run('Matriz',        this.processMatrix.bind(this),        'matrix');
      run('Pedidos',       this.processOrders.bind(this),        'orders');
      db.meta.lastImport = new Date().toISOString();
      DB.save();
      result.success = result.errors.length === 0;
    } catch(e) { result.errors.push(e.message); }
    return result;
  }
};

// ══════════════════════════════════════════════════════
// EXPORTADOR
// ══════════════════════════════════════════════════════
const Exporter = {
  /**
   * Exporta las órdenes de compra al formato SAP de programación de pedidos.
   * - Una hoja por categoría (+ destino para diferenciar)
   * - Dentro de cada hoja, un bloque por proveedor:
   *     fila "COD: / PROV:", encabezados, filas de SKU con cantidad y fecha
   * - Columnas "VACÍO" quedan en blanco
   * - Fechas con puntos: DD.MM.YYYY
   */
  exportResults(results) {
    const wb = XLSX.utils.book_new();
    const db = DB.get();

    // Fecha con puntos
    const dotDate = iso => {
      const d = DateUtils.parse(iso);
      if (!d) return '';
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    };

    // Solo SKUs con compra sugerida
    const withPurchase = results.filter(r => r.suggestedQty > 0);

    // Agrupar por categoría + destino
    const groups = {};
    for (const r of withPurchase) {
      const cat  = r.category || 'SIN CATEGORIA';
      const key  = `${cat} - ${r.destName}`;
      (groups[key] = groups[key] || []).push(r);
    }

    if (!Object.keys(groups).length) {
      // Nada que exportar: hoja informativa
      const ws = XLSX.utils.aoa_to_sheet([['Sin órdenes de compra pendientes']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Sin pedidos');
      XLSX.writeFile(wb, `OC_${new Date().toISOString().slice(0,10)}.xlsx`);
      return;
    }

    const HDR = ['Código','Nombre','Cantidad','VACÍO','VACÍO','Fecha entrega','VACÍO','VACÍO','VACÍO','VACÍO','VACÍO','Centro'];
    // Centro SAP por nombre de destino
    const centroFor = destName => /galapa/i.test(destName) ? '1000' : /bogot/i.test(destName) ? '1001' : '';

    for (const [groupKey, rows] of Object.entries(groups)) {
      const aoa = [];

      // Reagrupar por proveedor dentro de la categoría
      const bySupplier = {};
      for (const r of rows) {
        for (const d of r.distribution) {
          const sid = d.supplierId || '_sin_prov';
          (bySupplier[sid] = bySupplier[sid] || { name: d.supplierName, code: d.supplierId || '', items: [] });
          const ships = d.shipments && d.shipments.length ? d.shipments : [{ qty: d.quantity, arrivalDate: null }];
          for (const sh of ships) {
            bySupplier[sid].items.push({
              code: r.skuCode, name: r.skuName,
              qty: sh.qty,
              date: dotDate(sh.arrivalDate ? DateUtils.toISO(sh.arrivalDate) : null),
              centro: centroFor(r.destName)
            });
          }
        }
        // Si no hay distribución (sin proveedores), incluir el total bajo "sin proveedor"
        if (!r.distribution.length) {
          const sid = '_sin_prov';
          (bySupplier[sid] = bySupplier[sid] || { name: '(sin proveedor)', code: '', items: [] });
          bySupplier[sid].items.push({
            code: r.skuCode, name: r.skuName, qty: r.suggestedQty,
            date: '', centro: centroFor(r.destName)
          });
        }
      }

      // Construir bloques por proveedor
      let first = true;
      for (const sid of Object.keys(bySupplier)) {
        const sup = bySupplier[sid];
        if (!first) aoa.push([]); // separación entre bloques
        first = false;
        // Fila COD: / PROV:
        aoa.push(['COD:', sup.code, 'PROV:', sup.name, '', '', '', '', '', '', '', '']);
        aoa.push([]); // fila vacía
        aoa.push([...HDR]); // encabezados
        for (const it of sup.items) {
          aoa.push([it.code, it.name, it.qty, '', '', it.date, '', '', '', '', '', it.centro]);
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{wch:14},{wch:22},{wch:10},{wch:8},{wch:8},{wch:14},{wch:8},{wch:8},{wch:8},{wch:8},{wch:8},{wch:10}];
      // Nombre de hoja: máx 31 chars, sin caracteres inválidos
      let sheetName = groupKey.toUpperCase().replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      // Evitar nombres de hoja duplicados (Excel no lo permite)
      let uniqueName = sheetName, suffix = 1;
      while (wb.SheetNames.includes(uniqueName)) {
        const tag = ` (${++suffix})`;
        uniqueName = sheetName.slice(0, 31 - tag.length) + tag;
      }
      sheetName = uniqueName;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    XLSX.writeFile(wb, `OC_Programacion_${new Date().toISOString().slice(0,10)}.xlsx`);
  },

  generateTemplate(type) {
    const wb = XLSX.utils.book_new();
    const col = n => Array(n).fill({ wch: 22 });
    if (type === 'completo' || type === 'skus')
      XLSX.utils.book_append_sheet(wb, Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Nombre','Descripcion','Categoria','DDI Objetivo'],
        ['TEND001','Tendidos','Tendidos doble plaza','Ropa de Cama',30]
      ]), { '!cols': col(5) }), 'SKUs');
    if (type === 'completo' || type === 'inventario') {
      const t = DateUtils.today();
      // Encabezados con los próximos 4 meses (actual + 3)
      const monthLabels = [0,1,2,3].map(off => {
        const d = new Date(t.getFullYear(), t.getMonth() + off, 1);
        const tag = off === 0 ? 'mes' : `mes+${off}`;
        return `IRD T ${tag} (${DateUtils.monthName(d.getMonth()+1).slice(0,3)})`;
      });
      const hdr = ['SKU','Destino','Inventario','IRD Real', ...monthLabels];
      XLSX.utils.book_append_sheet(wb, Object.assign(XLSX.utils.aoa_to_sheet([
        hdr,
        ['TEND001','Galapa',500,10,10,11,12,10],
        ['TEND001','Bogota',200,15,15,16,14,15]
      ]), { '!cols': col(hdr.length) }), 'Inventario');
    }
    if (type === 'completo' || type === 'proveedores')
      XLSX.utils.book_append_sheet(wb, Object.assign(XLSX.utils.aoa_to_sheet([
        ['Proveedor','Nombre','Contacto','Email'],
        ['PROV_A','Textileria Andina','Ana Lopez','ana@textileria.co']
      ]), { '!cols': col(4) }), 'Proveedores');
    if (type === 'completo' || type === 'matriz')
      XLSX.utils.book_append_sheet(wb, Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Proveedor','Destino','Lead Time (dias)','Peso (%)','MOQ','Activo'],
        ['TEND001','PROV_A','Galapa',5,25,50,'SI']
      ]), { '!cols': col(7) }), 'Matriz');
    if (type === 'completo' || type === 'pedidos') {
      const t = DateUtils.today();
      XLSX.utils.book_append_sheet(wb, Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Destino','Proveedor','Cantidad','Fecha Llegada','Notas'],
        ['TEND001','Galapa','PROV_A',200,DateUtils.toISO(DateUtils.addDays(t,7)),'OC-001']
      ]), { '!cols': col(6) }), 'Pedidos');
    }
    XLSX.writeFile(wb, type === 'completo' ? 'Plantilla_AsistenteCompra.xlsx' : `Plantilla_${type}.xlsx`);
  }
};

// ══════════════════════════════════════════════════════
// ADMIN CRUD
// ══════════════════════════════════════════════════════
const Admin = {
  saveSKU(s){const db=DB.get();const id=s.id||s.code.toLowerCase().replace(/\s+/g,'_');const i=db.skus.findIndex(x=>x.id===id);const r={...s,id};if(i>=0)db.skus[i]=r;else db.skus.push(r);DB.save();return r;},
  deleteSKU(id){const db=DB.get();db.skus=db.skus.filter(x=>x.id!==id);['inventory','params','matrix','orders','monthlyIrds'].forEach(k=>db[k]=db[k].filter(x=>x.skuId!==id));DB.save();},
  saveDestination(d){const db=DB.get();const id=d.id||d.name.toLowerCase().replace(/\s+/g,'_');const i=db.destinations.findIndex(x=>x.id===id);const r={...d,id};if(i>=0)db.destinations[i]=r;else db.destinations.push(r);DB.save();return r;},
  deleteDestination(id){const db=DB.get();db.destinations=db.destinations.filter(x=>x.id!==id);['inventory','params','matrix','orders','monthlyIrds'].forEach(k=>db[k]=db[k].filter(x=>x.destId!==id));DB.save();},
  saveSupplier(s){const db=DB.get();const id=s.id||s.name.toLowerCase().replace(/\s+/g,'_');const i=db.suppliers.findIndex(x=>x.id===id);const r={...s,id};if(i>=0)db.suppliers[i]=r;else db.suppliers.push(r);DB.save();return r;},
  deleteSupplier(id){const db=DB.get();db.suppliers=db.suppliers.filter(x=>x.id!==id);db.matrix=db.matrix.filter(x=>x.supplierId!==id);DB.save();},
  saveMatrixEntry(e){const db=DB.get();const i=db.matrix.findIndex(m=>m.skuId===e.skuId&&m.supplierId===e.supplierId&&m.destId===e.destId);if(i>=0)db.matrix[i]=e;else db.matrix.push(e);DB.save();},
  deleteMatrixEntry(skuId,supplierId,destId){const db=DB.get();db.matrix=db.matrix.filter(m=>!(m.skuId===skuId&&m.supplierId===supplierId&&m.destId===destId));DB.save();},
  saveInventory(inv){const db=DB.get();const i=db.inventory.findIndex(x=>x.skuId===inv.skuId&&x.destId===inv.destId);if(i>=0)db.inventory[i]=inv;else db.inventory.push(inv);DB.save();},
  saveOrder(o){const db=DB.get();const id=o.id||`ord_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;const r={...o,id};const i=db.orders.findIndex(x=>x.id===id);if(i>=0)db.orders[i]=r;else db.orders.push(r);DB.save();return r;},
  deleteOrder(id){const db=DB.get();db.orders=db.orders.filter(x=>x.id!==id);DB.save();},
  getOrdersFor(skuId,destId){return DB.get().orders.filter(o=>o.skuId===skuId&&o.destId===destId);},
  saveMonthlyIrd(e){const db=DB.get();const i=db.monthlyIrds.findIndex(m=>m.skuId===e.skuId&&m.destId===e.destId&&m.year===e.year&&m.month===e.month);if(i>=0)db.monthlyIrds[i]=e;else db.monthlyIrds.push(e);DB.save();},
  deleteMonthlyIrdsFor(skuId,destId){const db=DB.get();db.monthlyIrds=db.monthlyIrds.filter(m=>!(m.skuId===skuId&&m.destId===destId));DB.save();}
};

// ══════════════════════════════════════════════════════
// DATOS DEMO
// ══════════════════════════════════════════════════════
function loadDemoData() {
  const db = DB.get();
  const t = DateUtils.today();
  const d = n => DateUtils.toISO(DateUtils.addDays(t, n));
  db.skus = [
    {id:'tendidos', code:'TEND001',name:'Tendidos',    description:'Tendidos doble plaza',    category:'Ropa de Cama',targetDDI:30,active:true},
    {id:'almohadas',code:'ALMO001',name:'Almohadas',   description:'Almohada estandar',        category:'Ropa de Cama',targetDDI:21,active:true},
    {id:'sabanas',  code:'SABA001',name:'Sabanas',     description:'Juego de sabanas king',    category:'Ropa de Cama',targetDDI:30,active:true},
    {id:'cobijas',  code:'COBJ001',name:'Cobijas',     description:'Cobija polar doble',       category:'Ropa de Cama',targetDDI:45,active:true},
    {id:'colchones',code:'COLC001',name:'Colchones',   description:'Colchon ortopedico',       category:'Colchones',   targetDDI:21,active:true},
    {id:'cojines',  code:'COJI001',name:'Cojines Deco',description:'Cojin decorativo 45x45',  category:'Decoracion',  targetDDI:30,active:true},
  ];
  db.suppliers = [
    {id:'prov_a',name:'Textileria Andina',   contact:'Ana Lopez',  email:'ana@textileria.co', active:true},
    {id:'prov_b',name:'Manufacturas del Sur',contact:'Carlos Ruiz',email:'carlos@msur.co',    active:true},
    {id:'prov_c',name:'Importaciones Global',contact:'Maria Pena', email:'maria@iglobal.co',  active:true},
    {id:'prov_d',name:'Distribuidora Norte', contact:'Pedro Gomez',email:'pedro@dnorte.co',   active:true},
  ];
  db.destinations = [{id:'galapa',name:'Galapa',active:true},{id:'bogota',name:'Bogotá',active:true}];
  db.matrix = [
    {skuId:'tendidos', supplierId:'prov_a',destId:'galapa',leadTime:5, weight:25,moq:50, active:true},
    {skuId:'tendidos', supplierId:'prov_b',destId:'galapa',leadTime:7, weight:25,moq:30, active:true},
    {skuId:'tendidos', supplierId:'prov_c',destId:'galapa',leadTime:10,weight:25,moq:50, active:true},
    {skuId:'tendidos', supplierId:'prov_c',destId:'bogota',leadTime:9, weight:50,moq:50, active:true},
    {skuId:'tendidos', supplierId:'prov_d',destId:'bogota',leadTime:14,weight:50,moq:100,active:true},
    {skuId:'almohadas',supplierId:'prov_a',destId:'galapa',leadTime:3, weight:50,moq:24, active:true},
    {skuId:'almohadas',supplierId:'prov_b',destId:'galapa',leadTime:5, weight:50,moq:12, active:true},
    {skuId:'almohadas',supplierId:'prov_c',destId:'bogota',leadTime:8, weight:60,moq:24, active:true},
    {skuId:'almohadas',supplierId:'prov_d',destId:'bogota',leadTime:12,weight:40,moq:12, active:true},
    {skuId:'sabanas',  supplierId:'prov_a',destId:'galapa',leadTime:4, weight:40,moq:6,  active:true},
    {skuId:'sabanas',  supplierId:'prov_c',destId:'galapa',leadTime:8, weight:60,moq:6,  active:true},
    {skuId:'sabanas',  supplierId:'prov_b',destId:'bogota',leadTime:10,weight:100,moq:6, active:true},
    {skuId:'cobijas',  supplierId:'prov_b',destId:'galapa',leadTime:6, weight:100,moq:5, active:true},
    {skuId:'cobijas',  supplierId:'prov_c',destId:'bogota',leadTime:11,weight:50, moq:5, active:true},
    {skuId:'cobijas',  supplierId:'prov_d',destId:'bogota',leadTime:15,weight:50, moq:10,active:true},
    {skuId:'colchones',supplierId:'prov_d',destId:'galapa',leadTime:7, weight:100,moq:1, active:true},
    {skuId:'colchones',supplierId:'prov_d',destId:'bogota',leadTime:14,weight:100,moq:1, active:true},
    {skuId:'cojines',  supplierId:'prov_a',destId:'galapa',leadTime:4, weight:50, moq:24,active:true},
    {skuId:'cojines',  supplierId:'prov_b',destId:'galapa',leadTime:6, weight:50, moq:48,active:true},
    {skuId:'cojines',  supplierId:'prov_c',destId:'bogota',leadTime:9, weight:100,moq:24,active:true},
  ];
  db.inventory = [
    {skuId:'tendidos', destId:'galapa',inventory:120,ird:10  },
    {skuId:'almohadas',destId:'galapa',inventory:80, ird:8   },
    {skuId:'sabanas',  destId:'galapa',inventory:45, ird:5   },
    {skuId:'cobijas',  destId:'galapa',inventory:200,ird:2   },
    {skuId:'colchones',destId:'galapa',inventory:3,  ird:0.5 },
    {skuId:'cojines',  destId:'galapa',inventory:360,ird:12  },
    {skuId:'tendidos', destId:'bogota',inventory:60, ird:15  },
    {skuId:'almohadas',destId:'bogota',inventory:30, ird:12  },
    {skuId:'sabanas',  destId:'bogota',inventory:20, ird:7   },
    {skuId:'cobijas',  destId:'bogota',inventory:90, ird:3   },
    {skuId:'colchones',destId:'bogota',inventory:8,  ird:1   },
    {skuId:'cojines',  destId:'bogota',inventory:144,ird:18  },
  ];
  db.orders = [
    {id:'o1', skuId:'tendidos', destId:'galapa',supplierId:'prov_a',qty:200,arrivalDate:d(5), notes:'OC-001'},
    {id:'o2', skuId:'tendidos', destId:'galapa',supplierId:'prov_b',qty:150,arrivalDate:d(12),notes:'OC-002'},
    {id:'o3', skuId:'almohadas',destId:'galapa',supplierId:'prov_a',qty:96, arrivalDate:d(3), notes:'OC-003'},
    {id:'o4', skuId:'sabanas',  destId:'galapa',supplierId:'prov_c',qty:60, arrivalDate:d(8), notes:'OC-004'},
    {id:'o5', skuId:'colchones',destId:'galapa',supplierId:'prov_d',qty:10, arrivalDate:d(7), notes:'OC-005'},
    {id:'o6', skuId:'cojines',  destId:'galapa',supplierId:'prov_a',qty:288,arrivalDate:d(4), notes:'OC-006'},
    {id:'o7', skuId:'cojines',  destId:'galapa',supplierId:'prov_b',qty:144,arrivalDate:d(18),notes:'OC-007'},
    {id:'o8', skuId:'tendidos', destId:'bogota',supplierId:'prov_c',qty:300,arrivalDate:d(9), notes:'OC-008'},
    {id:'o9', skuId:'tendidos', destId:'bogota',supplierId:'prov_d',qty:150,arrivalDate:d(21),notes:'OC-009'},
    {id:'o10',skuId:'almohadas',destId:'bogota',supplierId:'prov_c',qty:144,arrivalDate:d(8), notes:'OC-010'},
    {id:'o11',skuId:'sabanas',  destId:'bogota',supplierId:'prov_b',qty:84, arrivalDate:d(10),notes:'OC-011'},
    {id:'o12',skuId:'cobijas',  destId:'bogota',supplierId:'prov_d',qty:90, arrivalDate:d(15),notes:'OC-012'},
    {id:'o13',skuId:'colchones',destId:'bogota',supplierId:'prov_d',qty:20, arrivalDate:d(14),notes:'OC-013'},
    {id:'o14',skuId:'cojines',  destId:'bogota',supplierId:'prov_c',qty:360,arrivalDate:d(9), notes:'OC-014'},
  ];
  db.monthlyIrds = [];
  db.params = [];
  db.meta.lastImport = new Date().toISOString();
  DB.save();
}

window.MotorReabastecimiento = { DB, Engine, Importer, Exporter, Admin, loadDemoData, DDI_COLORS, DateUtils };
})();
