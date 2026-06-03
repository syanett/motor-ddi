# Changelog — Motor DDI

Historial completo de cambios por versión.

---

## v2.0 — Heatmap Semanal + Pedidos con Fechas

### Nuevas funcionalidades

#### Vista Heatmap Semanal
- Matriz visual SKU × Destino con 10 semanas proyectadas desde hoy
- Cada celda coloreada según escala DDI (rojo crítico → negro exceso)
- Punto blanco en la celda indica pedido que llega esa semana específica
- Tooltip interactivo al pasar el cursor: DDI, inventario, consumo, pedidos de la semana
- Filtros por destino y categoría
- La columna "Hoy" muestra el estado actual como referencia

#### Pedidos en Camino con fecha exacta (estructura `orders`)
- Nueva tabla `orders` en la DB: `{ id, skuId, destId, supplierId, qty, arrivalDate, notes }`
- Reemplaza el campo `incomingOrders` (número plano) por registros individuales con fecha
- CRUD completo desde la vista **Pedidos en Camino**
- Badge de días restantes con color semáforo (rojo ≤3d, naranja ≤7d, verde)
- Los pedidos se propagan automáticamente al heatmap y a los cálculos DDI

#### Proyección semanal en motor
- `Engine.calcWeeklyProjection(skuId, destId, semanas)` calcula semana a semana
- Acumula pedidos que llegan antes del domingo de cada semana
- Detecta y expone `firstRiskWeek` (DDI ≤ 7) y `firstCriticalWeek` (DDI ≤ 0)
- El resultado se incluye en cada fila de `Engine.calcAll()`

#### Dashboard actualizado
- Nuevo KPI: "Pedidos próximos 7 días"
- Tabla de próximos pedidos ordenada por fecha de llegada
- Alerta de primera semana en riesgo por SKU en el panel de alertas críticas
- Columna "Riesgo en" en la vista de Reabastecimiento

#### Utilidades de fecha (`DateUtils`)
- `today()`, `parse()`, `toISO()`, `toShort()`
- `diffDays()`, `weekStart()`, `addDays()`
- `getWeeks(n)` — genera array de N semanas desde hoy

#### Importación Excel — hoja `Pedidos`
- Nueva hoja en la plantilla con columnas: SKU, Destino, Proveedor, Cantidad, Fecha Llegada, Notas
- Acepta fechas en formato `YYYY-MM-DD` y `DD/MM/YYYY`
- Compatible con la plantilla completa `Plantilla_Motor_DDI_v2.xlsx`

#### Exportación mejorada
- Nueva hoja `Proyección Semanal` en el Excel exportado
- Columna `Semana Riesgo` en la hoja Resumen
- Hoja `Distribución` por proveedor con lead times

### Correcciones técnicas
- Motor encapsulado en IIFE `(function(){ ... })()` para evitar contaminación del scope global
- Eliminada redeclaración `let DB` en `index.html`; se usa `window.DB = M.DB` en su lugar
- `initializeApp()` con retry `setTimeout` para garantizar que `motor.js` carga antes de ejecutar UI
- Scripts al final del `<body>` en orden: SheetJS → motor.js → inline UI
- Clave de localStorage cambiada a `replenishment_db_v2` con migración automática desde v1

### Cambios en la estructura de datos
- Añadida tabla `orders` al schema de DB
- Campo `incomingOrders` en `inventory` mantenido por compatibilidad (legacy)
- `Engine.calcRow()` usa `getTotalIncoming()` que lee de `orders` en lugar de `inventory.incomingOrders`
- `DB_KEY` cambiado de `replenishment_db_v1` a `replenishment_db_v2`

### Cambios en la interfaz
- Sidebar: nueva sección "Pedidos en Camino" arriba de SKUs
- Sidebar: nueva vista "Heatmap Semanal" como segunda opción
- Vista de Reabastecimiento: nueva columna "Riesgo en"
- Filas críticas destacadas con borde izquierdo rojo/naranja
- Estilos CSS nuevos: `.heatmap-table`, `.heat-cell`, `.order-date-badge`, `.days-badge`, `.heat-tooltip`

---

## v1.1 — Correcciones de estabilidad

### Correcciones
- Error `Uncaught SyntaxError: Identifier 'DB' has already been declared`
  - Causa: `motor.js` declaraba `const DB` en scope global; `index.html` declaraba `let DB`
  - Solución: IIFE en motor.js + `window.DB` en index.html
- Error `navigateTo is not defined`
  - Causa: scripts en `<head>` o archivo truncado sin `</script>`
  - Solución: scripts al final de `<body>` + archivo completado correctamente
- Archivo `index.html` truncado por fallo del heredoc en bash
  - Solución: reconstrucción con Python para evitar problemas de caracteres especiales

---

## v1.0 — Lanzamiento inicial

### Funcionalidades
- Dashboard con KPIs globales y distribución DDI
- Vista de Reabastecimiento con filtros por destino y categoría
- Vista por Proveedor con distribución de compras
- Modal de detalle SKU+Destino con distribución de proveedores
- CRUD de SKUs, Destinos, Proveedores, Matriz SKU-Prov-Dest, Inventario
- Motor de cálculo DDI completo:
  - DDI actual, objetivo y proyectado
  - Inventario proyectado al momento de llegada
  - Compra sugerida redondeada al MOQ
  - Normalización de pesos de proveedores por destino
  - Lead time por SKU+Proveedor+Destino (no solo por SKU)
- Importación Excel (.xlsx / .xlsb) con validación por hoja
- Exportación Excel (Resumen + Distribución)
- 6 plantillas descargables
- Persistencia en localStorage
- Datos de demo con 6 SKUs × 2 destinos × 4 proveedores
- Diseño responsive con tema oscuro industrial
- Escala de 8 colores DDI con leyenda
- Toast notifications
- Modales de formulario genérico
- Sidebar con navegación y overlay móvil

---

## Roadmap sugerido (futuro)

- [ ] Gráfico de evolución histórica del DDI
- [ ] Alertas por email (requeriría backend)
- [ ] Múltiples escenarios de proyección (optimista / pesimista)
- [ ] Importación incremental (solo actualizar inventario, mantener pedidos)
- [ ] Vista de calendario de pedidos esperados
- [ ] Exportar heatmap como imagen PNG
- [ ] Modo claro / oscuro
- [ ] Autenticación básica con contraseña
- [ ] Sincronización entre navegadores vía Google Drive (requiere OAuth)
