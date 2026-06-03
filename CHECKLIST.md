# ✓ Checklist de Despliegue — Motor DDI v2

Marca cada paso antes de publicar.

---

## Archivos locales

- ☐ `index.html` — aplicación completa (~593 líneas)
- ☐ `motor.js` — motor de cálculo (~740 líneas)
- ☐ `styles.css` — estilos (~898 líneas)
- ☐ `templates/Plantilla_Motor_DDI_v2.xlsx`
- ☐ `README.md`
- ☐ `CHANGELOG.md`
- ☐ `FAQ.md`
- ☐ `GITHUB_RAPIDO.md`
- ☐ `CHECKLIST.md`
- ☐ `.gitignore`

---

## Validación local (antes de subir)

Abre `index.html` directamente en Chrome/Firefox:

- ☐ Dashboard carga con 6 SKUs de demo
- ☐ **Heatmap Semanal** muestra 10 columnas de semanas con colores DDI
- ☐ Pasar cursor sobre celda del heatmap muestra tooltip con detalle
- ☐ Punto blanco visible en celdas con pedidos programados
- ☐ Vista **Pedidos en Camino** muestra los pedidos con fechas y badges de días
- ☐ Crear un pedido nuevo → aparece en heatmap al recalcular
- ☐ Botón **↓ Exportar** descarga Excel con 3 hojas (Resumen, Proyección, Distribución)
- ☐ **Plantillas** → Descargar Plantilla Completa v2 → se descarga correctamente
- ☐ F12 → Console → **sin errores rojos**
- ☐ F12 → Console → sin `navigateTo is not defined`
- ☐ F12 → Console → sin `Identifier 'DB' already declared`

---

## Verificar archivos críticos

```bash
# Verificar que motor.js tiene IIFE
head -1 motor.js
# debe mostrar: (function () {
tail -1 motor.js
# debe mostrar: })(); // end IIFE

# Verificar que index.html está completo
grep -c "</script>" index.html
# debe ser 3

grep -c "</body>" index.html
# debe ser 1
```

---

## GitHub

### Repositorio
- ☐ Cuenta en [github.com](https://github.com) activa
- ☐ Repositorio `motor-ddi` creado como **Public**
- ☐ Sin README predeterminado de GitHub (usamos el nuestro)

### Subir archivos
- ☐ Todos los archivos en la **raíz del repositorio** (no en subcarpeta)
- ☐ Carpeta `templates/` con `Plantilla_Motor_DDI_v2.xlsx` dentro
- ☐ Commit realizado a la rama `main`

```
motor-ddi/ (raíz del repo)
├── index.html        ✓
├── motor.js          ✓
├── styles.css        ✓
├── README.md         ✓
├── CHANGELOG.md      ✓
├── FAQ.md            ✓
├── GITHUB_RAPIDO.md  ✓
├── CHECKLIST.md      ✓
├── .gitignore        ✓
└── templates/
    └── Plantilla_Motor_DDI_v2.xlsx  ✓
```

### GitHub Pages
- ☐ Settings → Pages → Source: **Deploy from a branch**
- ☐ Branch: **main** / **root**
- ☐ Guardado con **Save**
- ☐ Mensaje verde: *"Your site is live at..."*

---

## Prueba en producción

URL: `https://TU_USUARIO.github.io/motor-ddi/`

- ☐ La URL abre la app (espera 30–60s tras el primer deploy)
- ☐ Dashboard muestra datos de demo
- ☐ **Heatmap Semanal** funciona con colores y tooltips
- ☐ **Pedidos en Camino** permite crear/editar/eliminar
- ☐ Los pedidos creados aparecen en el heatmap (punto blanco)
- ☐ **Importar Excel** → cargar la plantilla descargada → importa correctamente
- ☐ **↓ Exportar** → descarga Excel con proyección semanal
- ☐ La app funciona en móvil (responsive)
- ☐ Los datos persisten al recargar la página (F5)

---

## Post-despliegue

- ☐ Guarda la URL en favoritos y compártela con el equipo
- ☐ Descarga la plantilla desde la app en producción y rellena con datos reales
- ☐ Importa los datos reales: SKUs, Inventario, Proveedores, Matriz, Pedidos
- ☐ Verifica que el heatmap refleja la situación real de inventario
- ☐ Revisa las alertas críticas en el Dashboard
- ☐ Establece un proceso de actualización semanal del inventario

---

## Errores y soluciones rápidas

| Error en consola | Causa | Solución |
|------------------|-------|----------|
| `navigateTo is not defined` | index.html truncado | Sube la versión correcta |
| `Identifier 'DB' already declared` | motor.js sin IIFE | Sube motor.js v2 con IIFE |
| `XLSX is not defined` | SheetJS CDN no cargó | Verifica conexión a internet |
| `Cannot read properties of undefined` | Motor no cargó antes que UI | Verifica orden de scripts en index.html |

| Síntoma visual | Causa | Solución |
|----------------|-------|----------|
| 404 al abrir la URL | Pages no procesado aún | Espera 2 min + Ctrl+Shift+R |
| Página en blanco | Script roto | F12 → Console → busca error |
| Heatmap sin colores | DDI todos nulos | Verifica que `Demanda Diaria > 0` |
| Sin puntos blancos | Sin pedidos registrados | Crea pedidos en **Pedidos en Camino** |
| Datos perdidos | Modo incógnito | Usa navegador normal |

---

## Actualizaciones futuras

Cuando haya una nueva versión de los archivos:

```bash
cd motor-ddi
# Reemplaza los archivos actualizados
git add index.html motor.js  # o los archivos que cambiaron
git commit -m "Actualización v2.1"
git push
```

Los datos en localStorage **no se pierden** al actualizar los archivos.
