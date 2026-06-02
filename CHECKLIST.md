# ✓ Checklist de Despliegue

Antes de publicar en GitHub, verifica que todo esté listo.

---

## Archivos locales

- ☐ `index.html` (1319 líneas) — aplicación completa
- ☐ `motor.js` (759 líneas) — motor de cálculo
- ☐ `styles.css` (898 líneas) — estilos
- ☐ `README.md` — documentación
- ☐ `.gitignore` — archivo de configuración
- ☐ `templates/Plantilla_Motor_DDI.xlsx` — plantilla Excel

**Total esperado:** 6 items

---

## Validar archivos

- ☐ Abre `index.html` en navegador local → debe mostrar Dashboard
- ☐ Busca en DevTools (F12 → Console) → no hay errores rojos
- ☐ Haz clic en **Plantillas** → se descarga `Plantilla_Motor_DDI.xlsx`
- ☐ Importa la plantilla descargada → aparecen datos de demo

---

## Verificar rutas relativas

En `index.html`, busca:
- ☐ `<script src="motor.js"></script>` ✓ relativo
- ☐ `<link rel="stylesheet" href="styles.css">` ✓ relativo
- ☐ NO hay rutas como `/motor.js` ✗ evitar

En `motor.js`, busca:
- ☐ No hay rutas hardcodeadas
- ☐ DB se guarda en localStorage ✓

---

## Estructura de carpetas (local)

```
tu-carpeta-local/
├── index.html           ☐
├── motor.js             ☐
├── styles.css           ☐
├── README.md            ☐
├── .gitignore           ☐
├── FAQ.md               ☐ (opcional)
├── GITHUB_RAPIDO.md     ☐ (opcional)
└── templates/           ☐
    └── Plantilla_Motor_DDI.xlsx
```

---

## GitHub

- ☐ Tienes cuenta en [github.com](https://github.com)
- ☐ Puedes crear repositorios
- ☐ Tienes acceso a Settings → Pages

---

## Crear repositorio

- ☐ Nombre: `motor-ddi` (o tu nombre preferido)
- ☐ Visibility: **Public** (obligatorio para Pages gratis)
- ☐ Sin marcar "Add README" (usarás el tuyo)
- ☐ Repositorio creado

---

## Subir archivos

### Opción A: Terminal (recomendado)

```bash
git init                                    ☐
git add .                                   ☐
git commit -m "Initial commit"              ☐
git branch -M main                          ☐
git remote add origin https://github.com/USERNAME/motor-ddi.git  ☐
git push -u origin main                     ☐
```

### Opción B: Interfaz web

- ☐ **Add file** → **Upload files**
- ☐ Arrastra los 6 archivos
- ☐ **Commit changes** → rama `main`

---

## Activar Pages

1. ☐ En tu repositorio GitHub
2. ☐ **Settings** (pestaña de arriba)
3. ☐ **Pages** (menú izquierdo)
4. ☐ **Source** → **Deploy from a branch**
5. ☐ **Branch** → **main**
6. ☐ **Folder** → **(root)**
7. ☐ Haz clic en **Save**

---

## Validar en GitHub

- ☐ Todos los archivos están en el repositorio
- ☐ La rama es `main` (o `master`)
- ☐ Settings → Pages muestra el mensaje verde: "Your site is live at..."
- ☐ La URL es: `https://USERNAME.github.io/motor-ddi/`

---

## Prueba final

- ☐ Abre la URL en el navegador
- ☐ Espera 30-60 segundos si es la primera vez
- ☐ Recarga si ves página en blanco (Ctrl+Shift+R)
- ☐ Dashboard aparece con datos de demo
- ☐ Botones funcionan (Reabastecimiento, Admin, Importar, etc.)
- ☐ Descargas plantilla: **Plantillas** → **Plantilla Completa** → ✓ descarga
- ☐ Importas Excel: **Importar Excel** → carga archivo → ✓ importa

---

## Post-deployment

- ☐ Guarda la URL de tu app en un lugar seguro
- ☐ Comparte con tu equipo: `https://USERNAME.github.io/motor-ddi/`
- ☐ Lee `FAQ.md` para responder preguntas comunes
- ☐ Configura un .gitignore si planeas hacer commits frecuentes

---

## Problemas comunes

Si algo falla:

| Síntoma | Solución |
|---------|----------|
| **404 Not Found** | Espera 3 min, recarga Ctrl+Shift+R, verifica Settings → Pages |
| **Página en blanco** | F12 → Console, busca errores, verifica archivos en GitHub |
| **Plantilla no descarga** | Recarga página, verifica que `templates/` existe en GitHub |
| **Importar no funciona** | Usa plantilla descargada como referencia de columnas |

---

## Configuración futura (opcional)

- ☐ Dominio personalizado (Settings → Pages → Custom domain)
- ☐ SSL/HTTPS (automático en GitHub Pages)
- ☐ Comentarios (no necesita backend para esta app)
- ☐ Analytics (Google Analytics, opcional)

---

## ✅ Listo para ir en vivo

Cuando todas las casillas estén marcadas, tu app está lista en GitHub Pages.

**URL de producción:** `https://USERNAME.github.io/motor-ddi/`

---

**¡Felicidades! Tu Sistema de Reabastecimiento DDI está en vivo.** 🚀
