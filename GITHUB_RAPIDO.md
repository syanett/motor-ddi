# ⚡ Inicio Rápido — Motor DDI en GitHub Pages

Tiempo estimado: **5 minutos**

---

## Archivos a subir (obligatorios)

```
motor-ddi/
├── index.html          ← La app entera
├── motor.js            ← Motor de cálculo
├── styles.css          ← Estilos
├── templates/
│   └── Plantilla_Motor_DDI_v2.xlsx
└── README.md           ← (recomendado)
```

---

## Paso 1 — Crear el repositorio

1. Ve a **[github.com/new](https://github.com/new)**
2. **Repository name:** `motor-ddi`
3. **Visibility:** ☑ `Public` (obligatorio para Pages gratis)
4. **NO** marques "Add a README"
5. Clic en **Create repository**

---

## Paso 2 — Subir los archivos

### Opción A: Con terminal (recomendado)

```bash
# 1. Clona el repo vacío
git clone https://github.com/TU_USUARIO/motor-ddi.git
cd motor-ddi

# 2. Copia los archivos en esta carpeta
#    (index.html, motor.js, styles.css, README.md)
#    y la carpeta templates/

# 3. Sube todo
git add .
git commit -m "Motor DDI v2.0 — Heatmap semanal"
git push -u origin main
```

### Opción B: Por la interfaz web

1. En la página del repo vacío → **uploading an existing file**
2. Arrastra los 4 archivos sueltos + la carpeta `templates/`
3. Clic en **Commit changes**

> **Para la carpeta `templates/`:** haz clic en "Add file" → "Create new file" → escribe `templates/` en el nombre y sube el `.xlsx`

---

## Paso 3 — Activar GitHub Pages

1. En tu repositorio → **Settings**
2. Menú izquierdo → **Pages**
3. **Source** → `Deploy from a branch`
4. **Branch** → `main` / `root`
5. Clic en **Save**

Espera **30–60 segundos**. Aparecerá:
> ✅ *Your site is live at* `https://TU_USUARIO.github.io/motor-ddi/`

---

## Paso 4 — Verificar

Abre en el navegador:
```
https://TU_USUARIO.github.io/motor-ddi/
```

Deberías ver el **Dashboard** con datos de demo. Navega a **Heatmap Semanal** para ver la proyección de 10 semanas con colores DDI.

---

## Actualizar la app

Cada vez que descargues una nueva versión de `index.html` o `motor.js`:

```bash
cd motor-ddi
# copia los archivos nuevos aquí
git add .
git commit -m "Actualización vX.X"
git push
```

GitHub actualiza en 30–60 segundos. **Los datos en localStorage no se pierden.**

---

## Solución rápida de errores

| Síntoma | Solución |
|---------|----------|
| 404 Not Found | Espera 2 min + Ctrl+Shift+R |
| Página en blanco | F12 → Console → busca errores rojos |
| Heatmap no aparece | Verifica que `motor.js` está en la raíz del repo |
| Plantilla no descarga | Verifica conexión a internet (SheetJS es CDN) |
| Datos se pierden | No uses modo incógnito |

Para más detalles consulta `FAQ.md`.

---

## URL final

```
https://TU_USUARIO.github.io/motor-ddi/
```
