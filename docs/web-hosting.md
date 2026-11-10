# Hosting web

El hosting web de F1t es privado y requiere autenticación de Vercel; no hay demo pública disponible. La configuración está en `vercel.json` (Vite, `npm run build`, salida `dist`). Variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. `.vercelignore` excluye archivos locales y el proyecto nativo de la subida.
