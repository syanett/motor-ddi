# ❓ Preguntas Frecuentes — Motor DDI v2

---

## Heatmap Semanal

### ¿Qué significa el punto blanco en una celda?
Indica que hay uno o más pedidos en camino que **llegan durante esa semana específica**. Pasa el cursor sobre la celda para ver el detalle de los pedidos.

### ¿El heatmap muestra días exactos o semanas completas?
**Semanas completas.** Cada columna representa del lunes al domingo de esa semana. El inventario mostrado es el proyectado al final del domingo (fin de semana).

### Una celda es verde pero tiene punto blanco. ¿Está bien?
Sí, significa que incluso sin el pedido el inventario estaría bien, y el pedido es un refuerzo adicional. Si la celda fuera roja con punto blanco, el pedido llega cuando ya hay quiebre.

### ¿Por qué la primera columna ("Hoy") es diferente?
Muestra el **DDI e inventario actuales** (sin proyección), sirve como punto de partida para leer la evolución semanal de izquierda a derecha.

### ¿Cuántas semanas muestra el heatmap?
10 semanas desde la semana actual. Las semanas empiezan el lunes.

### ¿Cómo identifico el momento exacto de quiebre?
Busca la primera celda roja en cada fila. En el tooltip verás el DDI exacto. También puedes usar la vista **Reabastecimiento** que muestra la columna "Riesgo en" con la semana exacta.

---

## Pedidos en Camino

### ¿Qué diferencia hay entre v1 y v2 en pedidos?
- **v1:** un número plano (`incomingOrders: 150`) — no se sabía cuándo llegaba
- **v2:** registros individuales con fecha (`arrivalDate: "2026-06-15"`) — se ve en qué semana impacta el inventario

### ¿Puedo tener varios pedidos del mismo SKU+Destino?
Sí. Puedes tener múltiples pedidos del mismo SKU+Destino con fechas distintas. Todos se suman correctamente en la proyección semanal.

### ¿Qué pasa si un pedido ya llegó?
Los pedidos con `arrivalDate < hoy` no se incluyen en los cálculos. Puedes eliminarlos manualmente desde **Pedidos en Camino** o simplemente dejarlos (no afectan los números).

### ¿Puedo importar los pedidos desde Excel?
Sí. Usa la hoja `Pedidos` de la Plantilla Completa v2 con columnas:
```
SKU | Destino | Proveedor | Cantidad | Fecha Llegada | Notas
```
La fecha debe estar en formato `YYYY-MM-DD` o `DD/MM/YYYY`.

### El badge de días muestra un número negativo. ¿Por qué?
Significa que el pedido tiene fecha en el pasado. El sistema lo excluye del cálculo automáticamente. Puedes actualizar la fecha o eliminar el pedido.

---

## Cálculos DDI

### ¿Por qué la compra sugerida es 0 si tengo DDI bajo?
Puede ocurrir si el **inventario proyectado** (considerando pedidos en camino) ya cubre el objetivo. Revisa la columna "Pedidos en Camino" y "Inv. Proyectado" en la vista Reabastecimiento.

### ¿Qué es el lead time promedio?
Es el promedio ponderado de los lead times de los proveedores activos para ese SKU+Destino, usando los pesos normalizados. Si el proveedor A tiene LT=5d con peso 60% y B tiene LT=10d con peso 40%, el LT promedio es `5×0.6 + 10×0.4 = 7 días`.

### ¿Por qué el DDI proyectado puede ser diferente al DDI de la semana de llegada en el heatmap?
- **DDI proyectado** (tabla Reabastecimiento): usa el lead time promedio como días hasta la llegada
- **Heatmap**: usa fechas exactas de los pedidos registrados en la tabla `orders`

Si los pedidos están cargados correctamente, ambos deberían ser similares.

### ¿Qué es el IRD?
**Índice de Rotación Diaria.** Es un indicador de qué fracción del inventario se vende cada día: `IRD = Demanda Diaria / Inventario`. Actualmente se almacena como dato informativo y se muestra en las tablas, pero no entra directamente en los cálculos de reabastecimiento.

### ¿Qué pasa si la demanda diaria es 0?
El DDI muestra `—` (sin datos). La compra sugerida será 0. Actualiza la demanda desde **Administrar → Inventario**.

---

## Proveedores y Pesos

### ¿Cómo funciona la normalización de pesos?
Los pesos son **relativos** por destino. Solo se consideran los proveedores marcados como `Activo = Sí` en la Matriz para ese destino específico.

```
Ejemplo global:   A=25%, B=25%, C=25%, D=25%
Bogotá solo C y D activos:
  C normalizado = 25 / (25+25) = 50%
  D normalizado = 25 / (25+25) = 50%
```

### ¿Puedo asignar el 100% a un solo proveedor?
Sí. Pon el proveedor con `Peso = 100` y todos los demás con `Activo = No`, o simplemente crea solo una entrada en la Matriz para ese SKU+Destino.

### ¿Qué pasa si todos los proveedores de un SKU+Destino están inactivos?
La compra sugerida se calcula igual, pero la distribución estará vacía. Se mostrará "Sin proveedores activos" en el detalle.

---

## Importación y Plantillas

### ¿Puedo importar solo una hoja y no todas?
Sí. Si el archivo solo tiene la hoja `Inventario`, solo se actualizan los inventarios. El resto de datos se conserva.

### Los IDs de mi Excel no coinciden con los de la app. ¿Qué hago?
Los IDs se generan normalizando el texto: minúsculas, espacios → guiones bajos.
- `"TEND001"` → ID `tend001`
- `"Proveedor A"` → ID `proveedor_a`
- `"Bogotá"` → ID `bogotá` (con tilde)

Para evitar problemas, usa códigos sin tildes y sin espacios: `TEND001`, `PROV_A`, `GALAPA`.

### El Excel se importa pero no aparecen los cálculos.
Revisa que:
1. La hoja `SKUs` tiene datos
2. La hoja `Inventario` tiene datos con columna `Demanda Diaria` > 0
3. La Matriz tiene entradas activas para los SKUs y destinos

Sin demanda diaria no hay DDI. Sin matriz no hay lead time.

---

## Datos y Persistencia

### ¿Mis datos se pierden si actualizo la app?
**No.** Los datos están en `localStorage` del navegador, no en los archivos de GitHub. Actualizar `index.html` o `motor.js` no borra los datos.

### ¿Cómo hago backup?
Ve a cualquier vista → botón **↓ Exportar**. Descarga el Excel con todos los indicadores y la proyección semanal. Guárdalo como respaldo.

### ¿Cómo comparto los datos con un colega?
1. Exporta el Excel desde tu navegador
2. Tu colega lo importa desde la misma URL de la app
3. Sus datos locales se actualizarán

La app no sincroniza en tiempo real entre usuarios — cada uno tiene su copia local.

### ¿Cuánto espacio ocupa en localStorage?
Con 200 SKUs × 2 destinos, pedidos y matriz completa: aproximadamente 200–400 KB. El límite típico es 5–10 MB.

Para verificar:
```js
// En F12 → Console:
new Blob(Object.values(localStorage)).size
```

### ¿Cómo reseteo todos los datos?
```js
// En F12 → Console:
localStorage.removeItem('replenishment_db_v2');
location.reload();
```

---

## GitHub Pages

### ¿La app requiere internet para funcionar?
Parcialmente. Necesita internet para:
- Cargar SheetJS desde CDN (importar/exportar Excel)
- La primera carga de la página

Una vez cargada, funciona sin conexión (los datos son locales).

### ¿Puedo usar un dominio personalizado?
Sí. En **Settings → Pages → Custom domain** de tu repositorio. Requiere configurar los DNS de tu dominio.

### ¿Funciona en móvil?
Sí. El diseño es responsive. La experiencia es mejor en pantalla ancha (tablet o desktop) por el heatmap, pero todas las vistas se adaptan a móvil.

### ¿Puedo tener múltiples instancias para diferentes empresas?
Sí. Crea un repositorio diferente para cada instancia:
- `empresa-a.github.io/motor-ddi-col/`
- `empresa-b.github.io/motor-ddi-mex/`

Los `localStorage` son independientes por URL.

---

## Errores conocidos

### `Uncaught SyntaxError: Identifier 'DB' has already been declared`
El `motor.js` antiguo declaraba variables globales que colisionaban con `index.html`. La v2 soluciona esto con IIFE. Asegúrate de usar los archivos más recientes.

### `navigateTo is not defined`
El archivo `index.html` estaba truncado (sin `</script>` de cierre). Descarga el archivo más reciente.

### El heatmap no muestra las semanas correctas
Verifica que la fecha de tu sistema está correcta. El heatmap usa `new Date()` para determinar "hoy".
