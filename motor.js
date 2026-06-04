(function () {
'use strict';
/**
 * motor.js — Asistente de Compra v4.0
 * - MOQ por SKU x Proveedor
 * - Inventario = disponible inmediato
 * - IRD = demanda diaria real
 * - Modo dual: IRD real vs IRD teórico mensual
 * - Proyección semanal con demanda ponderada por días de cada mes
 */

// ═══ CONSTANTES ═══════════════════════════════════════════
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
const DB_KEY = 'replenishment_db_v4';

// ═══ BASE DE DATOS ═════════════════════════════════════════
const DB = {
  _data: null,
  _defaultData() {
    return {
      skus: [], suppliers: [],
      destinations: [
        { id:'galapa', name:'Galapa', active:true },
        { id:'bogota', name:'Bogotá', active:true }
      ],
      matrix: [],   // { skuId, supplierId, destId, leadTime, weight, moq, active }
      params: [],
      inventory: [], // { skuId, destId, inventory, ird }
      orders: [],    // { id, skuId, destId, supplierId, qty, arrivalDate, notes }
      // NUEVO v4: IRDs teóricos mensuales por SKU+Destino
      monthlyIrds: [], // { skuId, destId, year, month, ird }
      // NUEVO v4: configuración global
      settings: { irdMode: 'real' }, // 'real' | 'teorico'
      meta: { lastImport: null, version: '4.0' }
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this._data = raw ? JSON.parse(raw) : this._defaultData();
      if (!this._data.orders)      this._data.orders      = [];
      if (!this._data.monthlyIrds) this._data.monthlyIrds = [];
      if (!this._data.settings)    this._data.settings    = { irdMode: 'real' };
    } catch(e) {
      console.error('Error cargando DB:', e);
      this._data = this._defaultData();
    }
    return this._data;
  },
  save() { try { localStorage.setItem(DB_KEY, JSON.stringify(this._data)); } catch(e) { console.error(e); } },
  get()  { if (!this._data) this.load(); return this._data; },
  reset(){ this._data = this._defaultData(); this.save(); }
};

// ═══ UTILIDADES DE FECHA ══════════════════════════════════
const DateUtils = {
  today() { const d=new Date(); d.setHours(0,0,0,0); return d; },
  parse(str) { if(!str) return null; const [y,m,d]=String(str).split('-').map(Number); return new Date(y,m-1,d); },
  toISO(d)   { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  toShort(d) { const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${d.getDate()}-${M[d.getMonth()]}`; },
  monthName(m){ return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][m-1]; },
  diffDays(a,b) { return Math.round((b-a)/86400000); },
  weekStart(date) { const d=new Date(date); const day=d.getDay(); d.setDate(d.getDate()+((day===0)?-6:1-day)); d.setHours(0,0,0,0); return d; },
  addDays(date,days) { const d=new Date(date); d.setDate(d.getDate()+days); return d; },
  getWeeks(n=10) {
    const start=this.weekStart(this.today());
    return Array.from({length:n},(_,i)=>{
      const ws=this.addDays(start,i*7);
      const we=this.addDays(ws,6);
      return { weekStart:ws, weekEnd:we, label:this.toShort(we), labelFull:`${this.toShort(ws)}-${this.toShort(we)}` };
    });
  },
  /** Months covered by a set of weeks, as { year, month, name } */
  getMonthsCovered(weeks) {
    const seen = new Set();
    const months = [];
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

// ═══ MOTOR DE CÁLCULO ═════════════════════════════════════
const Engine = {

  getDDIColor(ddi) {
    if (ddi===null||ddi===undefined||isNaN(ddi)) return { color:'#94a3b8', label:'Sin datos', bg:'#f8fafc' };
    for (const b of DDI_COLORS) if (ddi<=b.max) return b;
    return DDI_COLORS[DDI_COLORS.length-1];
  },

  /**
   * Obtiene el IRD para una fecha específica según el modo activo.
   * Modo 'real': usa inv.ird siempre.
   * Modo 'teorico': usa monthlyIrds si existe, fallback a inv.ird.
   */
  getIrdForDate(skuId, destId, date) {
    const db  = DB.get();
    const inv = db.inventory.find(i=>i.skuId===skuId&&i.destId===destId) || {};
    const realIrd = inv.ird || 0;
    if ((db.settings||{}).irdMode !== 'teorico') return realIrd;
    const year  = date.getFullYear();
    const month = date.getMonth()+1;
    const entry = db.monthlyIrds.find(m=>m.skuId===skuId&&m.destId===destId&&m.year===year&&m.month===month);
    return entry?.ird ?? realIrd;
  },

  /**
   * Calcula la demanda acumulada desde hoy hasta una fecha de corte,
   * iterando día a día para soportar el modo teórico.
   */
  calcCumulativeDemand(skuId, destId, fromDate, toDate) {
    let total = 0;
    let d = new Date(fromDate);
    while (d <= toDate) {
      total += this.getIrdForDate(skuId, destId, d);
      d = DateUtils.addDays(d, 1);
    }
    return total;
  },

  /**
   * Demanda semanal para una semana específica (suma de IRD diario de cada día).
   * Retorna { total, byDay: [{date, ird}] }
   */
  calcWeeklyDemand(skuId, destId, weekStart, weekEnd) {
    const byDay = [];
    let d = new Date(weekStart);
    while (d <= weekEnd) {
      byDay.push({ date: new Date(d), ird: this.getIrdForDate(skuId, destId, d) });
      d = DateUtils.addDays(d, 1);
    }
    return { total: byDay.reduce((s,x)=>s+x.ird,0), byDay };
  },

  getDailyDemand(ird) { return ird || 0; },
  calcDDI(inv, dailyDemand) { return dailyDemand ? inv/dailyDemand : null; },
  calcTargetInventory(dailyDemand, targetDDI) { return dailyDemand * targetDDI; },

  getTotalIncoming(skuId, destId) {
    const today = DateUtils.today();
    return DB.get().orders
      .filter(o=>o.skuId===skuId&&o.destId===destId)
      .filter(o=>{ const a=DateUtils.parse(o.arrivalDate); return a&&a>=today; })
      .reduce((s,o)=>s+(o.qty||0),0);
  },

  normalizeSupplierWeights(skuId, destId) {
    const valid = DB.get().matrix.filter(m=>m.skuId===skuId&&m.destId===destId&&m.active);
    if (!valid.length) return [];
    const total = valid.reduce((s,m)=>s+(m.weight||0),0);
    return valid.map(m=>({...m, normalizedWeight: total?(m.weight||0)/total:1/valid.length}));
  },

  calcSupplierDistribution(skuId, destId, qtyNeeded) {
    if (qtyNeeded<=0) return [];
    const suppliers = this.normalizeSupplierWeights(skuId, destId);
    if (!suppliers.length) return [];
    const db = DB.get();
    return suppliers.map(e=>{
      const sup = db.suppliers.find(s=>s.id===e.supplierId);
      const moq = e.moq||1;
      return {
        supplierId: e.supplierId, supplierName: sup?.name||e.supplierId,
        leadTime: e.leadTime||0, weight: e.weight||0,
        normalizedWeight: e.normalizedWeight, moq,
        quantity: Math.ceil(qtyNeeded*e.normalizedWeight/moq)*moq
      };
    });
  },

  /**
   * Proyección semanal completa.
   * Usa demanda día a día para soportar IRDs teóricos mensuales.
   * Cada semana incluye: projInv, projDDI, weeklyDemand, dailyDemandAvg, ordersThisWeek.
   */
  calcWeeklyProjection(skuId, destId, weeksAhead=10) {
    const db    = DB.get();
    const inv   = db.inventory.find(i=>i.skuId===skuId&&i.destId===destId)||{};
    const sku   = db.skus.find(s=>s.id===skuId);
    const today = DateUtils.today();

    const currentInv = inv.inventory||0;
    const realIrd    = inv.ird||0;
    const targetDDI  = (db.params.find(p=>p.skuId===skuId&&p.destId===destId)||{}).targetDDI||sku?.targetDDI||30;

    const weeks = DateUtils.getWeeks(weeksAhead);
    const future = db.orders
      .filter(o=>o.skuId===skuId&&o.destId===destId)
      .filter(o=>{ const a=DateUtils.parse(o.arrivalDate); return a&&a>=today; })
      .sort((a,b)=>new Date(a.arrivalDate)-new Date(b.arrivalDate));

    return weeks.map(week=>{
      // Weekly demand: sum IRD for each day of this week
      const wd = this.calcWeeklyDemand(skuId, destId, week.weekStart, week.weekEnd);
      const weeklyDemand    = wd.total;
      const dailyDemandAvg  = weeklyDemand/7;

      // Cumulative consumption from today to end of this week
      const endYesterday = DateUtils.addDays(week.weekEnd, 0);
      const cumulDemand  = this.calcCumulativeDemand(skuId, destId, today, endYesterday);

      // Orders accumulated until end of this week
      const ordersThisWeek = future.filter(o=>{
        const a=DateUtils.parse(o.arrivalDate);
        return a>=week.weekStart&&a<=week.weekEnd;
      });
      const ordersAccumulated = future
        .filter(o=>{ const a=DateUtils.parse(o.arrivalDate); return a>=today&&a<=week.weekEnd; })
        .reduce((s,o)=>s+(o.qty||0),0);

      const projInv  = currentInv - cumulDemand + ordersAccumulated;
      const projDDI  = dailyDemandAvg>0 ? projInv/dailyDemandAvg : null;
      const ddiColor = this.getDDIColor(projDDI);

      // Month breakdown for tooltip (how many days each month contributes)
      const monthBreakdown = {};
      wd.byDay.forEach(({date,ird})=>{
        const k = `${DateUtils.monthName(date.getMonth()+1)}`;
        if(!monthBreakdown[k]) monthBreakdown[k]={days:0,demand:0};
        monthBreakdown[k].days++;
        monthBreakdown[k].demand+=ird;
      });

      return {
        ...week,
        weeklyDemand: Math.round(weeklyDemand),
        dailyDemandAvg,
        cumulDemand: Math.round(cumulDemand),
        projInv: Math.round(projInv),
        projDDI, ddiColor,
        isAtRisk:    projDDI!==null&&projDDI<=7,
        isCritical:  projDDI!==null&&projDDI<=0,
        targetDDI, ordersThisWeek, ordersAccumulated,
        monthBreakdown
      };
    });
  },

  calcRow(skuId, destId) {
    const db   = DB.get();
    const sku  = db.skus.find(s=>s.id===skuId);
    const dest = db.destinations.find(d=>d.id===destId);
    if (!sku||!dest) return null;

    const param = db.params.find(p=>p.skuId===skuId&&p.destId===destId)||{};
    const inv   = db.inventory.find(i=>i.skuId===skuId&&i.destId===destId)||{};

    const ird         = inv.ird||param.ird||0;
    const dailyDemand = ird; // IRD = demanda diaria real
    const weeklyDemand= dailyDemand*7;
    const currentInv  = inv.inventory||0;
    const targetDDI   = param.targetDDI||sku.targetDDI||30;
    const incomingOrders = this.getTotalIncoming(skuId, destId);

    const suppliers   = this.normalizeSupplierWeights(skuId, destId);
    const avgLeadTime = suppliers.length
      ? suppliers.reduce((s,e)=>s+e.leadTime*e.normalizedWeight,0)
      : (param.leadTime||0);

    const currentDDI  = this.calcDDI(currentInv, dailyDemand);
    const targetInv   = this.calcTargetInventory(dailyDemand, targetDDI);
    const projectedInv = currentInv - (dailyDemand*avgLeadTime) + incomingOrders;
    const qtyNeeded   = Math.max(0, targetInv-projectedInv);
    const distribution= this.calcSupplierDistribution(skuId, destId, qtyNeeded);
    const suggestedQty= distribution.length
      ? distribution.reduce((s,d)=>s+d.quantity,0)
      : Math.ceil(qtyNeeded);
    const projectedDDI= dailyDemand>0?(projectedInv+suggestedQty)/dailyDemand:null;
    const ddiColor    = this.getDDIColor(currentDDI);

    const weeklyProjection  = this.calcWeeklyProjection(skuId, destId, 10);
    const firstRiskWeek     = weeklyProjection.find(w=>w.isAtRisk);
    const firstCriticalWeek = weeklyProjection.find(w=>w.isCritical);

    return {
      skuId, destId, skuName:sku.name, skuCode:sku.code,
      description:sku.description, category:sku.category, destName:dest.name,
      ird, dailyDemand, weeklyDemand,
      currentInv, incomingOrders, targetDDI, avgLeadTime,
      currentDDI, targetInv, projectedInv, suggestedQty, qtyNeeded, projectedDDI,
      ddiColor, distribution, weeklyProjection, firstRiskWeek, firstCriticalWeek
    };
  },

  calcAll() {
    const db = DB.get();
    const results = [];
    for (const sku of db.skus)
      for (const dest of db.destinations.filter(d=>d.active)) {
        const row = this.calcRow(sku.id, dest.id);
        if (row) results.push(row);
      }
    return results;
  }
};

// ═══ IMPORTADOR ═══════════════════════════════════════════
const Importer = {
  async readFile(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=e=>{
        try {
          const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true});
          const sheets={};
          for(const name of wb.SheetNames)
            sheets[name]=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:null,raw:false});
          resolve({sheets,sheetNames:wb.SheetNames});
        } catch(err){reject(new Error('Error leyendo Excel: '+err.message));}
      };
      reader.onerror=()=>reject(new Error('Error leyendo archivo'));
      reader.readAsArrayBuffer(file);
    });
  },
  processInventory(rows) {
    const errors=[],processed=[];
    rows.forEach((row,i)=>{
      if(!row['SKU']||!row['Destino']){errors.push(`Fila ${i+2}: SKU y Destino requeridos`);return;}
      processed.push({
        skuId:  String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId: String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        inventory: parseFloat(row['Inventario'])||0,
        ird: parseFloat(row['IRD']||row['IRD (Dem. Diaria u/dia)'])||0
      });
    });
    return {processed,errors};
  },
  processSKUs(rows) {
    const errors=[],processed=[];
    rows.forEach((row,i)=>{
      if(!row['SKU']){errors.push(`Fila ${i+2}: SKU requerido`);return;}
      const id=String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({id,code:String(row['SKU']).trim(),
        name:        String(row['Nombre']||row['SKU']).trim(),
        description: String(row['Descripcion']||row['Descripción']||'').trim(),
        category:    String(row['Categoria']||row['Categoría']||'').trim(),
        targetDDI:   parseFloat(row['DDI Objetivo'])||30, active:true});
    });
    return {processed,errors};
  },
  processSuppliers(rows) {
    const errors=[],processed=[];
    rows.forEach((row,i)=>{
      if(!row['Proveedor']){errors.push(`Fila ${i+2}: Proveedor requerido`);return;}
      const id=String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g,'_');
      processed.push({id,
        name:    String(row['Nombre']||row['Proveedor']).trim(),
        contact: String(row['Contacto']||'').trim(),
        email:   String(row['Email']||'').trim(), active:true});
    });
    return {processed,errors};
  },
  processMatrix(rows) {
    const errors=[],processed=[];
    rows.forEach((row,i)=>{
      if(!row['SKU']||!row['Proveedor']||!row['Destino']){errors.push(`Fila ${i+2}: faltan campos`);return;}
      processed.push({
        skuId:      String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        supplierId: String(row['Proveedor']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId:     String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        leadTime:   parseFloat(row['Lead Time (dias)']||row['Lead Time (días)'])||0,
        weight:     parseFloat(row['Peso (%)'])||25,
        moq:        parseFloat(row['MOQ'])||1,
        active:     String(row['Activo']||'SI').toUpperCase()!=='NO'
      });
    });
    return {processed,errors};
  },
  processOrders(rows) {
    const errors=[],processed=[];
    rows.forEach((row,i)=>{
      if(!row['SKU']||!row['Destino']||!row['Fecha Llegada']||!row['Cantidad']){
        errors.push(`Fila ${i+2}: faltan campos`);return;
      }
      let ds=String(row['Fecha Llegada']).trim();
      if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ds)){const[d,m,y]=ds.split('/');ds=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
      processed.push({
        id:`ord_${Date.now()}_${i}`,
        skuId:       String(row['SKU']).trim().toLowerCase().replace(/\s+/g,'_'),
        destId:      String(row['Destino']).trim().toLowerCase().replace(/\s+/g,'_'),
        supplierId:  String(row['Proveedor']||'').trim().toLowerCase().replace(/\s+/g,'_'),
        qty: parseFloat(row['Cantidad'])||0, arrivalDate:ds,
        notes:String(row['Notas']||'').trim()
      });
    });
    return {processed,errors};
  },
  async importFile(file) {
    const result={success:false,errors:[],warnings:[],imported:{}};
    try {
      const {sheets}=await this.readFile(file);
      const db=DB.get();
      const run=(name,fn,target)=>{
        if(!sheets[name]){result.warnings.push(`Hoja "${name}" no encontrada`);return;}
        const r=fn(sheets[name]); db[target]=r.processed;
        result.imported[name]=r.processed.length;
        result.errors.push(...r.errors.map(e=>`[${name}] ${e}`));
      };
      run('SKUs',        this.processSKUs.bind(this),      'skus');
      run('Inventario',  this.processInventory.bind(this), 'inventory');
      run('Proveedores', this.processSuppliers.bind(this), 'suppliers');
      run('Matriz',      this.processMatrix.bind(this),    'matrix');
      run('Pedidos',     this.processOrders.bind(this),    'orders');
      db.meta.lastImport=new Date().toISOString();
      DB.save(); result.success=result.errors.length===0;
    } catch(e){result.errors.push(e.message);}
    return result;
  }
};

// ═══ EXPORTADOR ═══════════════════════════════════════════
const Exporter = {
  exportResults(results) {
    const wb=XLSX.utils.book_new();
    const col=n=>Array(n).fill({wch:22});
    const summary=results.map(r=>({
      'SKU':r.skuCode,'Descripcion':r.description,'Destino':r.destName,
      'Inventario':r.currentInv,
      'IRD (u/dia)':Number(r.ird.toFixed(2)),
      'Dem. Diaria':Number(r.dailyDemand.toFixed(2)),
      'Dem. Semanal':Math.round(r.weeklyDemand),
      'Dem. Mensual':Math.round(r.dailyDemand*30),
      'Pedidos en Camino':r.incomingOrders,
      'DDI Actual':r.currentDDI!==null?Number(r.currentDDI.toFixed(1)):'',
      'DDI Objetivo':r.targetDDI,
      'Lead Time':Number(r.avgLeadTime.toFixed(1)),
      'Inv. Proyectado':Number(r.projectedInv.toFixed(0)),
      'Compra Sugerida':r.suggestedQty,
      'DDI Proyectado':r.projectedDDI!==null?Number(r.projectedDDI.toFixed(1)):'',
      'Estado':r.ddiColor.label,
      'Semana Riesgo':r.firstCriticalWeek?r.firstCriticalWeek.labelFull:r.firstRiskWeek?r.firstRiskWeek.labelFull:'Sin riesgo'
    }));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'Resumen');
    const heatRows=[];
    for(const r of results){
      if(!r.weeklyProjection?.length) continue;
      const base={'SKU':r.skuCode,'Destino':r.destName,'IRD':r.ird,'Dem. Diaria':r.dailyDemand};
      r.weeklyProjection.forEach(w=>{
        base[`Disp ${w.label}`]=w.projInv;
        base[`DDI ${w.label}`]=w.projDDI!==null?Number(w.projDDI.toFixed(1)):'';
        base[`Dem.Sem ${w.label}`]=w.weeklyDemand;
      });
      heatRows.push(base);
    }
    if(heatRows.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(heatRows),'Proyeccion Semanal');
    const distRows=[];
    for(const r of results)
      for(const d of(r.distribution||[]))
        distRows.push({'SKU':r.skuCode,'Destino':r.destName,'Proveedor':d.supplierName,'LT':d.leadTime,'Peso%':Number((d.normalizedWeight*100).toFixed(1)),'MOQ':d.moq,'Cantidad':d.quantity});
    if(distRows.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(distRows),'Distribucion');
    XLSX.writeFile(wb,`asistente_compra_${new Date().toISOString().slice(0,10)}.xlsx`);
  },
  generateTemplate(type) {
    const wb=XLSX.utils.book_new();
    const col=n=>Array(n).fill({wch:22});
    if(type==='completo'||type==='skus')
      XLSX.utils.book_append_sheet(wb,Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Nombre','Descripcion','Categoria','DDI Objetivo'],
        ['TEND001','Tendidos','Tendidos doble plaza','Ropa de Cama',30]
      ]),{'!cols':col(5)}),'SKUs');
    if(type==='completo'||type==='inventario')
      XLSX.utils.book_append_sheet(wb,Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Destino','Inventario','IRD (Dem. Diaria u/dia)'],
        ['TEND001','Galapa',500,10]
      ]),{'!cols':col(4)}),'Inventario');
    if(type==='completo'||type==='proveedores')
      XLSX.utils.book_append_sheet(wb,Object.assign(XLSX.utils.aoa_to_sheet([
        ['Proveedor','Nombre','Contacto','Email'],
        ['PROV_A','Textileria Andina','Ana Lopez','ana@textileria.co']
      ]),{'!cols':col(4)}),'Proveedores');
    if(type==='completo'||type==='matriz')
      XLSX.utils.book_append_sheet(wb,Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Proveedor','Destino','Lead Time (dias)','Peso (%)','MOQ','Activo'],
        ['TEND001','PROV_A','Galapa',5,25,50,'SI'],
        ['TEND001','PROV_B','Galapa',7,25,30,'SI']
      ]),{'!cols':col(7)}),'Matriz');
    if(type==='completo'||type==='pedidos'){
      const t=DateUtils.today();
      const d1=DateUtils.toISO(DateUtils.addDays(t,7));
      const d2=DateUtils.toISO(DateUtils.addDays(t,14));
      XLSX.utils.book_append_sheet(wb,Object.assign(XLSX.utils.aoa_to_sheet([
        ['SKU','Destino','Proveedor','Cantidad','Fecha Llegada','Notas'],
        ['TEND001','Galapa','PROV_A',200,d1,'OC-2026-001'],
        ['TEND001','Bogota','PROV_B',150,d2,'OC-2026-002']
      ]),{'!cols':col(6)}),'Pedidos');
    }
    XLSX.writeFile(wb,type==='completo'?'Plantilla_AsistenteCompra.xlsx':`Plantilla_${type}.xlsx`);
  }
};

// ═══ ADMIN CRUD ════════════════════════════════════════════
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
  /** Guarda un IRD teórico mensual */
  saveMonthlyIrd(entry){
    const db=DB.get();
    const i=db.monthlyIrds.findIndex(m=>m.skuId===entry.skuId&&m.destId===entry.destId&&m.year===entry.year&&m.month===entry.month);
    if(i>=0) db.monthlyIrds[i]=entry; else db.monthlyIrds.push(entry);
    DB.save();
  },
  /** Actualiza la configuración global */
  saveSettings(settings){
    const db=DB.get();
    db.settings={...(db.settings||{}), ...settings};
    DB.save();
  }
};

// ═══ DATOS DEMO ════════════════════════════════════════════
function loadDemoData() {
  const db=DB.get();
  const t=DateUtils.today();
  const d=n=>DateUtils.toISO(DateUtils.addDays(t,n));

  db.skus=[
    {id:'tendidos',  code:'TEND001',name:'Tendidos',    description:'Tendidos doble plaza',      category:'Ropa de Cama',targetDDI:30,active:true},
    {id:'almohadas', code:'ALMO001',name:'Almohadas',   description:'Almohada estandar',          category:'Ropa de Cama',targetDDI:21,active:true},
    {id:'sabanas',   code:'SABA001',name:'Sabanas',     description:'Juego de sabanas king',      category:'Ropa de Cama',targetDDI:30,active:true},
    {id:'cobijas',   code:'COBJ001',name:'Cobijas',     description:'Cobija polar doble',         category:'Ropa de Cama',targetDDI:45,active:true},
    {id:'colchones', code:'COLC001',name:'Colchones',   description:'Colchon ortopedico 140x190', category:'Colchones',   targetDDI:21,active:true},
    {id:'cojines',   code:'COJI001',name:'Cojines Deco',description:'Cojin decorativo 45x45',     category:'Decoracion',  targetDDI:30,active:true},
  ];
  db.suppliers=[
    {id:'prov_a',name:'Textileria Andina',   contact:'Ana Lopez',  email:'ana@textileria.co', active:true},
    {id:'prov_b',name:'Manufacturas del Sur',contact:'Carlos Ruiz',email:'carlos@msur.co',    active:true},
    {id:'prov_c',name:'Importaciones Global',contact:'Maria Pena', email:'maria@iglobal.co',  active:true},
    {id:'prov_d',name:'Distribuidora Norte', contact:'Pedro Gomez',email:'pedro@dnorte.co',   active:true},
  ];
  db.destinations=[{id:'galapa',name:'Galapa',active:true},{id:'bogota',name:'Bogotá',active:true}];
  db.matrix=[
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
  db.inventory=[
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
  db.orders=[
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
  db.monthlyIrds=[];
  db.settings={irdMode:'real'};
  db.params=[];
  db.meta.lastImport=new Date().toISOString();
  DB.save();
}

window.MotorReabastecimiento={DB,Engine,Importer,Exporter,Admin,loadDemoData,DDI_COLORS,DateUtils};
})(); // end IIFE
