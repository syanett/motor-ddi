# Motor DDI — Sistema de Reabastecimiento por Inventario

## Descripción

Motor DDI es una aplicación web 100% estática para gestión de reabastecimiento basado en **Días de Inventario (DDI)**. Funciona completamente en el navegador sin necesidad de servidor, backend ni base de datos externa. Deployable en GitHub Pages.

---

## Estructura del Proyecto

```
/
├── index.html          ← Aplicación completa (UI + lógica de interfaz)
├── styles.css          ← Estilos y tema visual
├── motor.js            ← Motor de cálculo, DB, importador y exportador
├── templates/
│   └── Plantilla_Motor_DDI.xlsx   ← Plantilla Excel oficial
├── assets/             ← Recursos estáticos adicionales
└── README.md           ← Este archivo
```

---

## Instalación y Despliegue

### Local
Simplemente abre `index.html` en cualquier navegador moderno.  
No requiere servidor, npm, ni instalación alguna.

### GitHub Pages
1. Sube todos los archivos a un repositorio GitHub
2. Ve a Settings → Pages → Source: main branch / root
3. Accede a `https://tu-usuario.github.io/nombre-repo/`

---

## Fórmulas del Motor

### DDI Actual
```
DDI = Inventario Disponible / Demanda Diaria
Inventario Disponible = Inventario - Inventario Comprometido
```

### Inventario Objetivo
```
Inventario Objetivo = Demanda Diaria × DDI Objetivo
```

### Inventario Proyectado (al momento de llegada)
```
Inventario Proyectado = Inventario Actual
                      - (Demanda Diaria × Lead Time)
                      + Pedidos en Camino
```

### Compra Sugerida
```
Compra Bruta = Inventario Objetivo - Inventario Proyectado
Compra Sugerida = MAX(0, TECHO(Compra Bruta / MOQ) × MOQ)
```

### Normalización de Pesos de Proveedores
Los pesos se definen a nivel global pero se normalizan por destino:
```
Peso Normalizado(Prov_i, Dest) = Peso(Prov_i) / Σ Pesos(proveedores activos para Dest)
```

**Ejemplo:**
- Configuración global: A=25%, B=25%, C=25%, D=25%
- Para Bogotá solo sirven C y D (activos)
- Normalizado: C=50%, D=50%

---

## Escala de Colores DDI

| Rango        | Color       | Estado       |
|-------------|-------------|--------------|
| DDI < 0      | 🔴 Rojo     | Crítico      |
| 0 – 7 días   | 🟠 Naranja  | Muy Bajo     |
| 7 – 14 días  | 🟡 Amarillo | Bajo         |
| 14 – 21 días | 🟢 Verde    | Normal       |
| 21 – 30 días | 🔵 Azul     | Adecuado     |
| 30 – 45 días | 🔵 Celeste  | Bueno        |
| 45 – 60 días | 🫒 Oliva    | Exceso Leve  |
| > 60 días    | ⚫ Negro    | Exceso       |

---

## Importación Excel

### Hojas soportadas

| Hoja        | Columnas requeridas                                                      |
|-------------|--------------------------------------------------------------------------|
| `SKUs`      | SKU, Nombre, Descripción, Categoría, DDI Objetivo, MOQ, IRD             |
| `Inventario`| SKU, Destino, Inventario, Inv. Comprometido, Pedidos en Camino, Demanda Diaria |
| `Proveedores` | Proveedor, Nombre, Contacto, Email                                    |
| `Matriz`    | SKU, Proveedor, Destino, Lead Time (días), Peso (%), Activo             |

### Notas importantes
- Solo se aceptan archivos `.xlsx` o `.xlsb`
- Los IDs se generan automáticamente normalizando el texto a minúsculas
- Puedes importar hojas parciales (los datos existentes se conservan para hojas no incluidas)
- Los pesos de la Matriz son relativos y se normalizan automáticamente por destino

---

## Vistas de la Aplicación

| Vista                  | Descripción                                              |
|------------------------|----------------------------------------------------------|
| **Dashboard**          | KPIs globales, distribución DDI, alertas críticas        |
| **Reabastecimiento**   | Tabla completa con compras sugeridas y filtros           |
| **Por Proveedor**      | Resumen de pedidos agrupados por proveedor               |
| **Administrar SKUs**   | CRUD de productos                                        |
| **Administrar Destinos** | CRUD de bodegas/centros de distribución               |
| **Administrar Proveedores** | CRUD de proveedores                               |
| **Matriz SKU-Prov-Dest** | Gestión de lead times, pesos y rutas                  |
| **Inventario**         | Edición manual de niveles de inventario y demanda        |
| **Importar Excel**     | Carga masiva desde archivo .xlsx                         |
| **Plantillas**         | Descarga de plantillas oficiales                         |

---

## Persistencia de Datos

Los datos se almacenan en `localStorage` del navegador bajo la clave `replenishment_db_v1`.

**Estructura:**
```json
{
  "skus":        [...],
  "destinations":[...],
  "suppliers":   [...],
  "matrix":      [...],
  "inventory":   [...],
  "params":      [...],
  "meta":        { "lastImport": "...", "version": "1.0" }
}
```

Para resetear todos los datos: abre la consola del navegador y ejecuta:
```javascript
localStorage.removeItem('replenishment_db_v1'); location.reload();
```

---

## Exportación

El botón **↓ Exportar** genera un archivo Excel con:
- **Hoja Resumen**: todos los indicadores por SKU+Destino
- **Hoja Distribución**: cantidades por proveedor con lead times y pesos

---

## Tecnologías

| Tecnología | Uso |
|------------|-----|
| HTML5      | Estructura de la aplicación |
| CSS3       | Estilos y tema visual |
| JavaScript (ES6+) | Motor de cálculo, UI y lógica |
| [SheetJS (xlsx)](https://sheetjs.com/) | Importación y exportación Excel |
| LocalStorage | Persistencia de datos |

---

## Datos de Demo

Al abrir la app por primera vez, se cargan automáticamente datos de demostración con:
- 6 SKUs (Tendidos, Almohadas, Sábanas, Cobijas, Colchones, Cojines)
- 2 destinos (Galapa, Bogotá)
- 4 proveedores con diferentes rutas y lead times
- Inventarios realistas para explorar todos los estados DDI

---

## Flujo de Trabajo Recomendado

1. **Primera configuración:**
   - Descarga la plantilla Excel completa desde *Plantillas*
   - Rellena las hojas SKUs, Proveedores, Inventario y Matriz
   - Importa desde *Importar Excel*

2. **Operación diaria:**
   - Actualiza los inventarios desde *Administrar → Inventario* o re-importando la hoja Inventario
   - Revisa el *Dashboard* para alertas críticas
   - Consulta *Reabastecimiento* para las órdenes de compra sugeridas
   - Exporta el archivo para enviarlo a compras

3. **Mantenimiento:**
   - Gestiona proveedores, destinos y SKUs desde las vistas Admin
   - Ajusta los pesos y lead times en la Matriz según condiciones actuales

---

*Motor DDI v1.0 — Desarrollado como aplicación web estática*
