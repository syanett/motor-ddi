# ❓ Preguntas Frecuentes

## Configuración y Despliegue

### ¿Necesito tener Git instalado?

**No es obligatorio.** Puedes subir los archivos directamente desde GitHub sin terminal:

1. Ve a tu repositorio
2. Haz clic en **Add file** → **Upload files**
3. Arrastra los 5 archivos

Git es más rápido para actualizaciones futuras, pero no es necesario inicialmente.

---

### ¿Puedo usar mi propio dominio personalizado?

**Sí.** En **Settings → Pages → Custom domain**, escribe tu dominio (ej: `motor-ddi.miempresa.com`).

Necesitas apuntar los registros DNS de tu dominio a GitHub. [Docs completas](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).

---

### ¿La app funciona sin internet?

**Parcialmente.** Después de que se carga por primera vez, los datos se guardan en **localStorage** del navegador, así que sí funciona sin internet **mientras tengas datos cargados**.

Sin embargo, necesitas internet para:
- Cargar SheetJS (para importar Excel)
- Descargar plantillas

**Solución:** descarga la plantilla una vez, desconéctate, y usa la app normalmente.

---

### ¿Puedo tener múltiples repos de Motor DDI en GitHub?

**Sí.** Cada uno tendría su URL:
- `motor-ddi-galapa` → `https://usuario.github.io/motor-ddi-galapa/`
- `motor-ddi-bogota` → `https://usuario.github.io/motor-ddi-bogota/`

Los datos de cada uno son independientes (localStorage separado).

---

## Datos y Persistencia

### ¿Dónde se guardan los datos?

En **localStorage** del navegador local. NO se sincronizan a GitHub automáticamente.

Si necesitas backup:
- Ve a **Exportar** → descarga el Excel con los resultados actuales
- Re-importa en otra máquina

---

### ¿Puedo perder mis datos?

**Riesgos:**
- Limpiar caché/cookies del navegador → pierdes los datos
- Cambiar de navegador → datos no siguen (Chrome ≠ Firefox)
- Cambiar de PC → datos no siguen
- Usar modo privado/incógnito → datos se pierden al cerrar

**Solución:** exporta regularmente a Excel como backup.

---

### ¿Cómo hago backup de mis datos?

1. Ve a **Reabastecimiento** o **Dashboard**
2. Haz clic en **↓ Exportar**
3. Se descarga `reabastecimiento_YYYY-MM-DD.xlsx`

Guarda este archivo en un lugar seguro.

---

### ¿Cómo restauro datos desde backup?

1. Ve a **Importar Excel**
2. Carga el archivo que exportaste
3. El sistema recalcula automáticamente

---

## Operación y Uso

### ¿Puedo editar directamente desde la tabla?

**No.** Pero puedes:
- Editar desde **Administrar → Inventario** (edición individual)
- Importar una hoja de Excel actualizada (edición masiva)

---

### ¿Cuántos SKUs puedo tener?

**Teoricamente ilimitados** (hasta llenar localStorage, que típicamente es 5-10 MB).

Realísticamente, la UI funciona bien con 100-200 SKUs. Con 1000+ podrías notar lentitud en los filtros.

---

### ¿Cuántos proveedores puedo asignar a un SKU?

**Ilimitados.** Pero la normalización de pesos funciona mejor con 2-4 proveedores por destino.

---

### ¿Qué pasa si desactivo un proveedor en la Matriz?

El sistema automáticamente:
- Lo excluye de los cálculos de distribución
- Normaliza los pesos entre los activos restantes
- No genera órdenes de compra para ese proveedor

---

## Troubleshooting Técnico

### La página dice "404 Not Found"

**Causa 1:** GitHub Pages aún no ha procesado
- **Solución:** espera 2-3 minutos, recarga con Ctrl+Shift+R

**Causa 2:** archivo `index.html` no está en la raíz
- **Solución:** asegúrate de que `index.html` está en la carpeta raíz del repositorio, no en una subcarpeta

**Causa 3:** rama equivocada
- **Solución:** verifica en **Settings → Pages** que apunta a la rama correcta (ej: `main`)

---

### La página está en blanco

**Causa 1:** error en JavaScript
- **Solución:** abre F12 (DevTools) → **Console** → busca errores rojos

**Causa 2:** `motor.js` no carga
- **Solución:** verifica que el archivo exista en GitHub y que en `index.html` la ruta sea:
  ```html
  <script src="motor.js"></script>
  ```
  (relativa, no absoluta)

**Causa 3:** SheetJS CDN bloqueado
- **Solución:** en `index.html`, cambia la línea:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  ```
  por:
  ```html
  <script src="https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  ```

---

### Botón "Descargar Plantilla" no funciona

**Causa:** SheetJS no está disponible
- **Solución:** 
  - Abre F12 → **Console** → busca errores
  - Comprueba que tienes conexión a internet (SheetJS es un CDN)
  - Intenta otro navegador

---

### Importar Excel no funciona

**Causa 1:** formato equivocado
- **Solución:** asegúrate de que es `.xlsx` o `.xlsb`, no `.xls` antiguo

**Causa 2:** hojas con nombres equivocados
- **Solución:** descarga la plantilla oficial y cópiala estructura exactamente:
  - `SKUs`
  - `Inventario`
  - `Proveedores`
  - `Matriz`

**Causa 3:** columnas equivocadas
- **Solución:** usa la plantilla descargable como referencia

---

### Los datos no se guardan

**Causa 1:** localStorage está deshabilitado
- **Solución:** 
  - Si usas navegador privado/incógnito → cambia a modo normal
  - Si tienes localStorage deshabilitado en configuración → habilítalo

**Causa 2:** navegador en modo privado
- **Solución:** usa modo normal

Verifica:
```javascript
// En F12 → Console, escribe:
localStorage.setItem('test', 'prueba');
localStorage.getItem('test');
```

Si devuelve 'prueba', localStorage está funcionando.

---

### Cambié algo en motor.js pero no aparece

**Solución:** recarga con Ctrl+Shift+R (vaciado duro de caché)

En algunos navegadores:
- Chrome: Ctrl+Shift+R
- Firefox: Ctrl+Shift+R
- Safari: Cmd+Shift+R

---

## Privacidad y Seguridad

### ¿Mi repositorio necesita ser público?

**Sí.** GitHub Pages gratuito requiere repositorio público.

Con plan **GitHub Pro** ($4/mes) puedes hacer Pages privadas.

---

### ¿Alguien puede ver mis datos?

**No.** Los datos se guardan SOLO en tu navegador (localStorage), no se envían a GitHub ni a servidores externos.

GitHub solo almacena el código HTML/CSS/JS, no los datos.

---

### ¿Puedo compartir la URL con compañeros?

**Sí, pero con precaución:**
- La app no tiene autenticación
- Cualquiera que tenga la URL puede abrir la app
- Pero los datos se guardan localmente en cada navegador
- No es una solución colaborativa en tiempo real

**Para verdadera colaboración:** considera agregar autenticación y un backend (más complejo, no cubierto aquí).

---

## Performance y Limites

### ¿Cuántos SKUs × destinos puedo tener antes de que sea lento?

- **100 combinaciones:** instant
- **500 combinaciones:** muy rápido
- **1000+ combinaciones:** aceptable pero noticeable al filtrar
- **5000+:** considera dividir en múltiples instancias

---

### ¿localStorage tiene límite?

**Típicamente:** 5-10 MB por sitio

Con Motor DDI caben fácilmente 100-200 SKUs con todos sus parámetros.

Para verificar:
```javascript
// En F12 → Console:
new Blob(Object.values(localStorage)).size
```

---

## Actualizar la Aplicación

### ¿Cómo actualizo a una versión nueva?

1. Descarga los nuevos archivos
2. Sube a tu repositorio:
   ```bash
   cd tu-repo
   git add .
   git commit -m "Update: v2.0"
   git push
   ```
3. GitHub actualiza en 30-60 segundos
4. Los datos locales se preservan (localStorage intacto)

---

### ¿Mis datos se pierden al actualizar?

**No.** Los datos están en localStorage del navegador, no en los archivos de GitHub.

Actualizar el código no afecta los datos guardados.

---

## Soporte

Si algo no funciona:

1. **Lee esta FAQ** (arriba)
2. **Revisa la consola** (F12 → Console) para errores
3. **Verifica la estructura** de carpetas y archivos
4. **Borra caché** (Ctrl+Shift+R)
5. **Prueba otro navegador**

---

**¿Algo más?** Revisa el `README.md` o `GITHUB_RAPIDO.md` en tu repositorio.
