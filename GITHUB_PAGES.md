# Desplegar Motor DDI en GitHub Pages

Guía completa para publicar la aplicación en GitHub Pages en 5 minutos.

---

## Opción 1: Crear repositorio nuevo (recomendado)

### 1. Crear el repositorio

1. Ve a [github.com](https://github.com) e inicia sesión
2. Haz clic en **+** (arriba a la derecha) → **New repository**
3. Llena los datos:
   - **Repository name:** `motor-ddi` (o el nombre que prefieras)
   - **Description:** (opcional) "Sistema de reabastecimiento por inventario DDI"
   - **Public** → ✓ (obligatorio para Pages gratis)
   - **Add a README.md** → no marques (usaremos el nuestro)
4. Haz clic en **Create repository**

### 2. Subir los archivos

#### Opción A: Por la interfaz web (sin Git)

1. En el repositorio vacío, haz clic en **uploading an existing file**
2. Carga los 5 archivos:
   ```
   index.html
   motor.js
   styles.css
   README.md
   templates/Plantilla_Motor_DDI.xlsx
   ```
   
   **Nota:** Para subir la carpeta `templates/`:
   - Primero sube `index.html`, `motor.js`, `styles.css`, `README.md`
   - Luego haz clic en **Add file** → **Create new file** → escribe `templates/Plantilla_Motor_DDI.xlsx`
   - Copia el contenido binario del archivo... 
   
   **Más fácil:** sigue la Opción B

#### Opción B: Desde terminal con Git (recomendado)

```bash
# 1. Clona el repo (reemplaza USERNAME y motor-ddi)
git clone https://github.com/USERNAME/motor-ddi.git
cd motor-ddi

# 2. Copia los archivos aquí
cp /ruta/a/index.html .
cp /ruta/a/motor.js .
cp /ruta/a/styles.css .
cp /ruta/a/README.md .
mkdir -p templates
cp /ruta/a/templates/Plantilla_Motor_DDI.xlsx templates/

# 3. Sube a GitHub
git add .
git commit -m "Initial commit: Motor DDI app"
git branch -M main
git push -u origin main
```

### 3. Activar GitHub Pages

1. En GitHub, ve a tu repositorio
2. **Settings** → **Pages** (en el menú izquierdo, bajo "Code and automation")
3. **Source:** selecciona **Deploy from a branch**
4. **Branch:** selecciona **main** / **root** (carpeta raíz)
5. Haz clic en **Save**

GitHub procesará en 30-60 segundos. Verás un mensaje: 
> "Your site is ready to be published at https://USERNAME.github.io/motor-ddi/"

### 4. Acceder a la app

Abre en tu navegador:
```
https://USERNAME.github.io/motor-ddi/
```

**Eso es todo.** La app estará funcionando completamente.

---

## Opción 2: Usar tu sitio personal

Si ya tienes un sitio en `https://USERNAME.github.io`:

1. Ve a tu repositorio `USERNAME.github.io`
2. Crea una carpeta `motor-ddi/` dentro
3. Sube los 5 archivos dentro de esa carpeta:
   ```
   USERNAME.github.io/
   └── motor-ddi/
       ├── index.html
       ├── motor.js
       ├── styles.css
       ├── README.md
       └── templates/
           └── Plantilla_Motor_DDI.xlsx
   ```
4. Accede a: `https://USERNAME.github.io/motor-ddi/`

---

## Estructura final en GitHub

```
motor-ddi/                          (tu repositorio)
├── index.html                      ← Abre aquí en el navegador
├── motor.js                        ← Motor de cálculo
├── styles.css                      ← Estilos
├── README.md                       ← Documentación
├── GITHUB_PAGES.md                 ← Este archivo (opcional)
├── templates/
│   └── Plantilla_Motor_DDI.xlsx    ← Plantilla Excel
└── .gitignore                      ← (opcional)
```

---

## Verificar que funciona

- ✅ Abre `https://USERNAME.github.io/motor-ddi/`
- ✅ Haz clic en **Plantillas** → **Plantilla Completa** → debería descargar
- ✅ Importa la plantilla de ejemplo: **Importar Excel** → la que acabas de descargar
- ✅ Ve al **Dashboard** → deberías ver datos de demo

Si todo aparece, ¡está funcionando perfecto!

---

## Solucionar problemas

### 📍 "Page not found" (404)

**Causa:** GitHub Pages aún no ha procesado los cambios.
- **Solución:** espera 2-3 minutos y recarga (Ctrl+Shift+R en Chrome)

### 📍 Página en blanco

**Causa:** archivo `index.html` no encontrado o rutas incorrectas.
- **Solución:** 
  - Verifica que `index.html` esté en la raíz del repositorio
  - Comprueba que las rutas sean relativas:
    ```html
    <script src="motor.js"></script>    ✓ Bien
    <script src="/motor.js"></script>   ✗ Mal
    ```

### 📍 SheetJS no carga

**Causa:** CDN no disponible o bloqueado.
- **Solución:** verifica en la consola (F12 → Console) si hay errores de CORS. Si es así, intenta con una CDN alternativa en `index.html`:
  ```html
  <!-- Reemplaza esta línea: -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  
  <!-- Con: -->
  <script src="https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  ```

### 📍 Plantilla Excel no descarga

**Causa:** ruta incorrecta a `templates/`
- **Solución:** verifica en DevTools (F12 → Network) si la descarga se intenta desde la URL correcta

### 📍 Los datos no persisten

**Causa:** localStorage bloqueado en modo privado/incógnito
- **Solución:** usa el navegador en modo normal, no privado

---

## Actualizar la app

Después de desplegar, si necesitas cambiar algo:

```bash
cd tu-repositorio-local
# Edita el archivo (ej: motor.js)
nano motor.js

# Sube el cambio
git add motor.js
git commit -m "Fix: mejorar cálculo de DDI"
git push
```

GitHub actualiza automáticamente en 30-60 segundos.

---

## Hacer el repo privado (después)

Si después quieres que sea privado, necesitas un plan GitHub Pro (pago) para Pages privadas. Los repositorios públicos en Pages son gratis.

---

## URLs de acceso

| Opción | URL |
|--------|-----|
| **Repositorio nuevo** | `https://USERNAME.github.io/motor-ddi/` |
| **Sitio personal** | `https://USERNAME.github.io/motor-ddi/` |
| **Repositorio directo** | `https://github.com/USERNAME/motor-ddi` |

---

¿Preguntas? Revisa las [docs oficiales de GitHub Pages](https://docs.github.com/en/pages).
