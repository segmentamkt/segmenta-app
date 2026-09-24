# Segmenta — estructura de despliegue

- `web/` → sitio público → `segmenta.online`
- `app/` → Host + CRM + Portal cliente → `app.segmenta.online`

## Vercel

Crear/configurar dos proyectos apuntando al mismo repositorio:

1. Web: Root Directory `web`, dominios `segmenta.online` y `www.segmenta.online`.
2. App: Root Directory `app`, dominio `app.segmenta.online`.

El proyecto App debe recibir las variables de entorno de Supabase, Meta y CRM usadas actualmente.

Los archivos equivalentes en la raíz quedan temporalmente como legado para no romper el despliegue actual antes del cambio de Root Directory.
