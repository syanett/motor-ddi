# Motor DDI v2.0 — Sistema de Reabastecimiento por Inventario

Aplicación web 100 % estática para gestión de reabastecimiento basada en **Días de Inventario (DDI)** con proyección semanal visual tipo heatmap. Sin servidor, sin backend, sin instalación. Deployable en GitHub Pages.

---

## Estructura del proyecto

```
motor-ddi/
├── index.html          ← Aplicación completa (UI + controlador)
├── motor.js            ← Motor de cálculo, DB, importador, exportador
├── styles.css          ← Estilos y tema visual
├── templates/
│   └── Plantilla_Motor_DDI_v2.xlsx
├── README.md
├── GITHUB_RAPIDO.md
├── CHANGELOG.md
├── FAQ.md
└── CHECKLIST.md
```

---

## Vistas de la aplicación

| Vista | Descripción |
|-------|-------------|
| **Dashboard** | KPIs globales, distribución DDI, alertas críticas, próximos pedidos |
| **Heatmap Semanal** | Matriz SKU × Destino coloreada por DDI en 10 semanas futuras |
| **Reabastecimiento** | Tabla completa con compras sugeridas y semana de primer riesgo |
| **Por Proveedor** | Consolidado de pedidos agrupados por proveedor |
| **Pedidos en Camino** | CRUD de pedidos con fecha exacta de llegada |
| **SKUs** | CRUD de productos |
| **Destinos** | CRUD de bodegas / centros de distribución |
| **Proveedores** | CRUD de proveedores |
| **Matriz SKU-Prov-Dest** | Lead times, pesos y rutas de abastecimiento |
| **Inventario** | Niveles de inventario y demanda por SKU+Destino |
| **Importar Excel** | Carga masiva desde .xlsx / .xlsb |
| **Plantillas** | Descarga de plantillas oficiales |

---

## Fórmulas del motor

### DDI Actual
```
Inventario Disponible = Inventario − Comprometido
DDI = Inventario Disponible / Demanda Diaria
```

### Inventario Objetivo
```
Inventario Objetivo = Demanda Diaria × DDI Objetivo
```

### Inventario Proyectado (al momento de llegada)
```
Inventario Proyectado = Inventario Disponible
                      − (Demanda Diaria × Lead Time)
                      + Pedidos que llegan antes del corte
```

### Compra Sugerida
```
Compra Bruta = Inventario Objetivo − Inventario Proyectado
Compra Final = MAX(0, TECHO(Compra Bruta / MOQ) × MOQ)
```

### Proyección Semanal (por semana k)
```
Pedidos acumulados(k) = Σ pedidos con fecha ≤ fin de semana k
Inventario final(k)   = Inv. Disponible
                       − (Demanda Diaria × días hasta fin semana k)
                       + Pedidos acumulados(k)
DDI proyectado(k)     = Inventario final(k) / Demanda Diaria
```

### Normalización de pesos por destino
```
Peso normalizado(Prov_i, Dest) =
    Peso(Prov_i) / Σ Pesos(proveedores activos para ese destino)
```

**Ejemplo:**
- Global: A=25%, B=25%, C=25%, D=25%
- Para Bogotá solo están activos C y D
- Normalizado: C=50%, D=50%

---

## Escala de colores DDI

| Rango | Color | Estado |
|-------|-------|--------|
| DDI < 0 | 🔴 Rojo `#dc2626` | Crítico — quiebre de stock |
| 0 – 7 días | 🟠 Naranja `#ea580c` | Muy Bajo — riesgo inmediato |
| 7 – 14 días | 🟡 Amarillo `#ca8a04` | Bajo |
| 14 – 21 días | 🟢 Verde claro `#16a34a` | Normal |
| 21 – 30 días | 🔵 Azul `#2563eb` | Adecuado |
| 30 – 45 días | 🩵 Celeste `#0284c7` | Bueno |
| 45 – 60 días | 🫒 Verde oliva `#65a30d` | Exceso leve |
| > 60 días | ⚫ Negro `#292524` | Exceso |

Estos colores se usan en: heatmap, badges DDI, barras de progreso, filas de tabla.

---

## Estructura de datos (localStorage)

Clave: `replenishment_db_v2`

```json
{
  "skus": [
    {
      "id": "tend001",
      "code": "TEND001",
      "name": "Tendidos",
      "description": "Tendidos doble plaza",
      "category": "Ropa de Cama",
      "targetDDI": 30,
      "moq": 10,
      "active": true
    }
  ],
  "destinations": [
    { "id": "galapa", "name": "Galapa", "active": true },
    { "id": "bogota", "name": "Bogotá", "active": true }
  ],
  "suppliers": [
    {
      "id": "prov_a",
      "name": "Textilería Andina",
      "contact": "Ana López",
      "email": "ana@textileria.co",
      "active": true
    }
  ],
  "matrix": [
    {
      "skuId": "tend001",
      "supplierId": "prov_a",
      "destId": "galapa",
      "leadTime": 5,
      "weight": 25,
      "active": true
    }
  ],
  "inventory": [
    {
      "skuId": "tend001",
      "destId": "galapa",
      "inventory": 500,
      "committedInv": 50,
      "dailyDemand": 15,
      "ird": 0.033
    }
  ],
  "orders": [
    {
      "id": "ord_abc123",
      "skuId": "tend001",
      "destId": "galapa",
      "supplierId": "prov_a",
      "qty": 200,
      "arrivalDate": "2026-06-15",
      "notes": "OC-2026-001"
    }
  ],
  "params": [],
  "meta": {
    "lastImport": "2026-06-03T10:00:00.000Z",
    "version": "2.0"
  }
}
```

---

## API del motor (`motor.js`)

### `DB` — Base de datos local

| Método | Descripción |
|--------|-------------|
| `DB.load()` | Carga datos de localStorage |
| `DB.save()` | Persiste datos en localStorage |
| `DB.get()` | Retorna el objeto de datos actual |
| `DB.reset()` | Borra todos los datos y restaura defaults |

### `DateUtils` — Utilidades de fecha

| Método | Retorna | Descripción |
|--------|---------|-------------|
| `DateUtils.today()` | `Date` | Hoy al inicio del día |
| `DateUtils.parse('YYYY-MM-DD')` | `Date` | Parsea string a Date |
| `DateUtils.toISO(date)` | `string` | Formatea Date a `YYYY-MM-DD` |
| `DateUtils.toShort(date)` | `string` | Formatea Date a `dd-mmm` |
| `DateUtils.diffDays(a, b)` | `number` | Días entre dos fechas |
| `DateUtils.weekStart(date)` | `Date` | Lunes de la semana de una fecha |
| `DateUtils.addDays(date, n)` | `Date` | Suma N días a una fecha |
| `DateUtils.getWeeks(n)` | `Array` | Próximas N semanas desde hoy |

### `Engine` — Motor de cálculo DDI

| Método | Descripción |
|--------|-------------|
| `getDDIColor(ddi)` | Retorna `{color, label, bg}` según el valor DDI |
| `calcDDI(inv, demand)` | DDI = inventario / demanda diaria |
| `calcTargetInventory(demand, targetDDI)` | Inventario objetivo |
| `getTotalIncoming(skuId, destId)` | Suma de pedidos futuros en camino |
| `calcProjectedAtDays(skuId, destId, days)` | Inventario proyectado en N días |
| `calcWeeklyProjection(skuId, destId, weeks)` | **Array de proyección semanal** |
| `normalizeSupplierWeights(skuId, destId)` | Pesos normalizados por destino |
| `calcSupplierDistribution(skuId, destId, qty)` | Distribución de compra por proveedor |
| `calcProjectedDDI(inv, demand, lt, inc, purchase)` | DDI tras recibir la compra |
| `calcRow(skuId, destId)` | Todos los indicadores para un SKU+Destino |
| `calcAll()` | Calcula todas las combinaciones activas |

**`calcWeeklyProjection` retorna por cada semana:**
```js
{
  weekStart, weekEnd,       // Date objects
  label,                    // "14-jun"
  labelFull,                // "9-jun – 15-jun"
  daysToEnd,                // días desde hoy hasta el domingo
  projInv,                  // inventario al final del domingo
  projDDI,                  // DDI proyectado
  ddiColor,                 // { color, label, bg }
  isAtRisk,                 // projDDI <= 7
  isCritical,               // projDDI <= 0
  targetDDI,
  ordersThisWeek,           // pedidos que llegan esta semana
  ordersAccumulated,        // total acumulado hasta esta semana
  weeklyConsumption         // demanda semanal en unidades
}
```

### `Importer` — Importador Excel

| Método | Descripción |
|--------|-------------|
| `readFile(file)` | Lee archivo .xlsx/.xlsb y retorna hojas como JSON |
| `processSKUs(rows)` | Valida y normaliza hoja SKUs |
| `processInventory(rows)` | Valida y normaliza hoja Inventario |
| `processSuppliers(rows)` | Valida y normaliza hoja Proveedores |
| `processMatrix(rows)` | Valida y normaliza hoja Matriz |
| `processOrders(rows)` | **Valida y normaliza hoja Pedidos** (v2) |
| `importFile(file)` | Importa el archivo completo y actualiza DB |

### `Exporter` — Exportador Excel

| Método | Descripción |
|--------|-------------|
| `exportResults(results)` | Exporta resumen + proyección semanal + distribución |
| `generateTemplate(type)` | Genera plantilla descargable |

Tipos de plantilla: `'completo'`, `'skus'`, `'inventario'`, `'proveedores'`, `'matriz'`, `'pedidos'`

### `Admin` — CRUD de entidades

| Método | Descripción |
|--------|-------------|
| `saveSKU(sku)` / `deleteSKU(id)` | Crear o eliminar SKU |
| `saveDestination(dest)` / `deleteDestination(id)` | Crear o eliminar destino |
| `saveSupplier(s)` / `deleteSupplier(id)` | Crear o eliminar proveedor |
| `saveMatrixEntry(e)` / `deleteMatrixEntry(sku,sup,dest)` | Gestionar matriz |
| `saveInventory(inv)` | Guardar inventario por SKU+Destino |
| `saveParams(p)` | Guardar parámetros operativos |
| `saveOrder(order)` / `deleteOrder(id)` | **Gestionar pedidos con fecha** (v2) |
| `getOrdersFor(skuId, destId)` | Pedidos de un SKU+Destino específico |

---

## Importación Excel

### Hojas soportadas

| Hoja | Columnas requeridas | Columnas opcionales |
|------|---------------------|---------------------|
| `SKUs` | SKU, Nombre | Descripción, Categoría, DDI Objetivo, MOQ, IRD |
| `Inventario` | SKU, Destino | Inventario, Comprometido, Demanda Diaria, IRD |
| `Proveedores` | Proveedor | Nombre, Contacto, Email |
| `Matriz` | SKU, Proveedor, Destino | Lead Time (días), Peso (%), Activo |
| `Pedidos` | SKU, Destino, Cantidad, Fecha Llegada | Proveedor, Notas |

### Formato de fechas en la hoja Pedidos
- Formato preferido: `YYYY-MM-DD` → `2026-06-15`
- También acepta: `DD/MM/YYYY` → `15/06/2026`

### Comportamiento de importación
- Se pueden importar hojas parciales (las no incluidas mantienen sus datos actuales)
- Los IDs se generan normalizando el texto a minúsculas con guiones bajos
- Los pesos de la Matriz son relativos y se normalizan por destino automáticamente
- Solo `.xlsx` y `.xlsb` son aceptados

---

## Heatmap semanal

La vista más importante de la aplicación v2:

- **Filas** = cada combinación SKU × Destino
- **Columnas** = 10 semanas a partir de hoy (con inicio el lunes)
- **Columna "Hoy"** = DDI e inventario disponible actual
- **Cada celda** = DDI proyectado al final del domingo de esa semana
- **Color** = escala DDI (rojo crítico → negro exceso)
- **Punto blanco** = hay uno o más pedidos que llegan en esa semana
- **Tooltip** al pasar el cursor = detalle completo de la semana

### Lectura del heatmap
1. Escanea de izquierda a derecha en cada fila
2. Una celda que cambia de verde/azul a naranja/rojo indica la semana de riesgo
3. Un punto blanco en una semana roja significa que hay un pedido que llega justo a tiempo (o tarde)
4. Haz clic en el SKU (columna izquierda) para ver el desglose completo

---

## Pedidos en camino (v2)

A diferencia de v1 (donde era un número total), en v2 cada pedido tiene:

```
SKU + Destino + Proveedor + Cantidad + Fecha exacta de llegada + Notas
```

Esto permite:
- Saber exactamente en qué semana llega cada pedido
- Ver el impacto de cada pedido en el heatmap (punto blanco)
- Detectar si un pedido llega demasiado tarde (semana ya en rojo antes de la llegada)
- Calcular el DDI proyectado con precisión diaria

---

## Exportación

El botón **↓ Exportar** genera un Excel con tres hojas:

| Hoja | Contenido |
|------|-----------|
| `Resumen` | Todos los indicadores por SKU+Destino incluyendo semana de riesgo |
| `Proyección Semanal` | Inventario y DDI de cada SKU+Destino para las próximas 10 semanas |
| `Distribución` | Cantidades a pedir por proveedor con lead times y pesos |

---

## Persistencia y backup

Los datos viven en `localStorage` del navegador bajo la clave `replenishment_db_v2`.

**Para hacer backup:**
```
Exportar → descarga el Excel con proyección semanal
```

**Para resetear todo:**
```js
// En la consola del navegador (F12):
localStorage.removeItem('replenishment_db_v2');
location.reload();
```

**Para migrar entre navegadores o equipos:**
1. Exportar desde el equipo origen
2. Importar el Excel en el equipo destino

---

## Tecnologías

| Tecnología | Versión | Uso |
|------------|---------|-----|
| HTML5 | — | Estructura |
| CSS3 | — | Estilos y animaciones |
| JavaScript ES2020+ | — | Motor, UI, lógica |
| [SheetJS (xlsx)](https://sheetjs.com/) | 0.18.5 | Importar/exportar Excel |
| localStorage | — | Persistencia de datos |

**Dependencias externas:** solo SheetJS vía CDN. Sin frameworks, sin Node.js, sin build steps.

---

## Despliegue en GitHub Pages

Ver `GITHUB_RAPIDO.md` para instrucciones paso a paso.

**URL de producción:** `https://TU_USUARIO.github.io/motor-ddi/`

---

*Motor DDI v2.0 — Proyección semanal + Heatmap + Pedidos con fechas*
