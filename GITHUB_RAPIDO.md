# ⚡ Inicio Rápido — GitHub Pages (5 minutos)

## Paso 1: Crear el repositorio en GitHub

**En [github.com](https://github.com):**

1. Haz clic en **+** (arriba a la derecha)
2. **New repository**
3. Nombre: `motor-ddi`
4. ☑ **Public**
5. **Create repository**

**Copiarás esta URL:** `https://github.com/TU_USUARIO/motor-ddi`

---

## Paso 2: Subir los archivos

Tienes **2 opciones:**

### Opción A: Sin terminal (más fácil)

En la página del repositorio vacío, haz clic en **uploading an existing file** y:

1. Sube estos archivos al raíz:
   - `index.html`
   - `motor.js`
   - `styles.css`
   - `README.md`
   - `.gitignore`

2. Luego crea la carpeta `templates/`:
   - Haz clic en **Add file** → **Create new file**
   - Escribe: `templates/Plantilla_Motor_DDI.xlsx`
   - En DevTools, copia el contenido binario...
   
   **O mejor:** sigue la Opción B

### Opción B: Con terminal (más rápido)

Abre tu terminal y ejecuta:

```bash
# 1. Ir a la carpeta donde están tus archivos
cd /path/a/motor-ddi

# 2. Inicializar Git
git init

# 3. Configurar usuario (primera vez)
git config user.name "Tu Nombre"
git config user.email "tu@email.com"

# 4. Agregar todos los archivos
git add .

# 5. Hacer commit
git commit -m "Initial commit: Motor DDI app"

# 6. Cambiar rama a main
git branch -M main

# 7. Conectar con GitHub (reemplaza TU_USUARIO)
git remote add origin https://github.com/TU_USUARIO/motor-ddi.git

# 8. Subir a GitHub
git push -u origin main
```

---

## Paso 3: Activar GitHub Pages

**En tu repositorio de GitHub:**

1. **Settings** (pestaña de arriba)
2. **Pages** (menú izquierdo, bajo "Code and automation")
3. **Source** → **Deploy from a branch**
4. **Branch** → selecciona **main** → **root**
5. **Save**

Espera 30-60 segundos. Verás:
> ✅ Your site is live at `https://TU_USUARIO.github.io/motor-ddi/`

---

## ✅ ¡Listo!

Abre en tu navegador:
```
https://TU_USUARIO.github.io/motor-ddi/
```

Deberías ver:
- Dashboard con 6 SKUs de demo
- Todas las vistas funcionando
- Botón para descargar plantillas
- Posibilidad de importar Excel

---

## Archivos necesarios en el repositorio

```
motor-ddi/
├── index.html                    ← APP
├── motor.js                      ← Motor
├── styles.css                    ← Estilos
├── README.md                     ← Doc
├── .gitignore                    ← Opcional
└── templates/
    └── Plantilla_Motor_DDI.xlsx  ← Plantilla
```

---

## Solucionar problemas

| Problema | Solución |
|----------|----------|
| **"Page not found"** | Espera 2-3 min, recarga con Ctrl+Shift+R |
| **Página en blanco** | Asegúrate de que `index.html` está en la raíz |
| **Plantilla no descarga** | Verifica que `templates/Plantilla_Motor_DDI.xlsx` existe |
| **Datos no persisten** | No uses modo privado/incógnito en el navegador |

---

## Actualizar después

Cuando hagas cambios:

```bash
cd /path/a/motor-ddi
git add .
git commit -m "Tu mensaje"
git push
```

GitHub actualiza automáticamente en 30-60 segundos.

---

## 🎯 Eso es todo

- ✅ App estática (100% navegador)
- ✅ Sin servidor ni backend
- ✅ Gratis en GitHub Pages
- ✅ Funciona offline (los datos quedan en localStorage)

**¡Disfruta!**
