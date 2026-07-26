# Metromecanica — App de Documentos por Área

## 1. Instalación local (para probar antes de desplegar)

```bash
npm install
cp .env.example .env
```

Edita `.env` con tus valores reales:
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`: los mismos que usa MetroTrack (Project Settings → API en Supabase).
- `VITE_N8N_UPLOAD_WEBHOOK_URL`: la URL del nuevo webhook de n8n (ver sección 3 abajo).

```bash
npm run dev
```

## 2. Antes de usarla: correr el SQL

Corre `00_setup.sql` en el SQL Editor de Supabase (agrega la columna `area` a `profiles` y protege la tabla `documentos` con RLS).

Luego, en el Table Editor de Supabase, abre la tabla `profiles` y asigna manualmente el campo `area` a cada usuario real:
- `laboratorio`, `contabilidad`, `comercial`, `logistica`, o `gerencia`.

## 3. Falta construir: el workflow de subida en n8n

La app manda el archivo a un webhook de n8n (multipart/form-data) con estos campos:
- `file` (el archivo binario)
- `ot_number` (ej. "OT-2026-4444")
- `area` (ej. "laboratorio")
- `tipo_documento` (ej. "certificado")
- `subcarpeta` (ej. "Certificados")
- `nombre_archivo` (nombre final del archivo)
- `subido_por` (uuid del usuario de Supabase)

El workflow en n8n debe:
1. **Webhook** (POST) — recibe el archivo binario.
2. **Set** — arma el path completo: `{{ $json.body.ot_number }}/{{ AREA_CAPITALIZADA }}/{{ $json.body.subcarpeta }}/{{ $json.body.nombre_archivo }}`
3. **S3** (nodo nativo de n8n) — operación "Upload", bucket `metromecanica-docs`, key = el path armado, usando las credenciales de MinIO.
4. **Postgres** (nodo nativo, conectado a tu Supabase) — Insert en la tabla `documentos` con los mismos campos recibidos + la ruta.
5. **Respond to Webhook** — responde 200 OK a la app.

## 4. Desplegar en Vercel

```bash
npm run build
```
Sube el proyecto a un repo de GitHub y conéctalo a Vercel (igual que hiciste con MetroTrack), agregando las mismas 3 variables de entorno en el panel de Vercel.
