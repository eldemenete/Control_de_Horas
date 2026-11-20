# Control de Horas · Práctica Profesional (360h)

Aplicación web móvil (PWA) con backend en Node.js + Express y base de datos **PostgreSQL en la nube** para llevar el control de las 360 horas de práctica profesional desde el celular.

## Funcionalidades

- **Progreso hacia las 360 horas**: porcentaje completado, horas acumuladas, horas restantes y total de jornadas.
- **Fichar entrada y salida en vivo**: la jornada activa se guarda en el servidor/base de datos, así que puedes cerrar el navegador o cambiar de dispositivo y el cronómetro sigue corriendo con exactitud.
- **Registro manual**: carga días anteriores por horario (`entrada - salida - colación`) o por horas/minutos directos.
- **Historial editable y exportación CSV**: edita, elimina o descarga un respaldo en Excel/CSV.
- **Instalable en celular (PWA)**: se agrega a la pantalla de inicio en Android o iOS como una app nativa.
- **PIN opcional**: protege tu app pública en internet configurando la variable de entorno `APP_PIN`.

---

## Despliegue en la nube (Render - Recomendado)

Este proyecto incluye `render.yaml` para crear automáticamente el servidor web y la base de datos PostgreSQL.

1. Sube esta carpeta a un repositorio en **GitHub**:
   ```bash
   git init
   git add .
   git commit -m "App control de horas practica"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/control-horas-practica.git
   git push -u origin main
   ```
2. Entra a [render.com](https://render.com) e inicia sesión con GitHub.
3. Haz clic en **New +** → **Blueprint**.
4. Selecciona tu repositorio `control-horas-practica`.
5. Render detectará `render.yaml` y creará automáticamente:
   - El servicio web `control-horas-practica`
   - La base de datos PostgreSQL `control-horas-db` conectada mediante `DATABASE_URL`
6. *(Opcional)* Cuando te pida el valor de `APP_PIN`, escribe un PIN numérico (ej. `1234`) para que solo tú puedas entrar, o déjalo vacío.
7. Haz clic en **Apply** y espera ~2 minutos. Al terminar tendrás una URL `https://control-horas-practica.onrender.com`.

> **Nota sobre el plan gratuito de Render:** las bases de datos PostgreSQL gratuitas en Render expiran a los 30 días. Si tu práctica dura varios meses, puedes usar **Neon.tech** o **Supabase** (PostgreSQL gratuito sin vencimiento) y pegar su `DATABASE_URL` en las variables de entorno de Render, o usar **Railway**.

---

## Despliegue en Railway

1. Sube el proyecto a GitHub.
2. En [railway.app](https://railway.app), crea un nuevo proyecto → **Deploy from GitHub repo**.
3. En el mismo proyecto haz clic en **+ New** → **Database** → **Add PostgreSQL**.
4. En tu servicio web, ve a **Variables** y agrega:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `GOAL_HOURS` = `360`
   - `APP_PIN` = *(opcional, tu clave)*
5. En **Settings → Networking**, genera un dominio público.

---

## Instalar en tu celular

- **Android (Chrome):** abre la URL de tu app → menú `⋮` → **Instalar aplicación** o **Añadir a pantalla de inicio**.
- **iPhone (Safari):** abre la URL → botón **Compartir** (`↑`) → **Añadir a pantalla de inicio**.

---

## Prueba local rápida (opcional)

```bash
npm install
npm start
```
Luego abre `http://localhost:3000`. Si no defines `DATABASE_URL`, usará un archivo temporal `data.local.json` solo para pruebas locales.
