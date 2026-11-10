# Base de datos

El backend usa Supabase. Las migraciones históricas del esquema están en `supabase/migrations/`; las pruebas locales de integridad, en `supabase/tests/20260929_integrity.sql`.

Scripts disponibles: `npm run db:link`, `npm run db:status`, `npm run db:new`, `npm run db:push`, `npm run db:seed` y `npm run db:types`. `db:types` escribe en `src/lib/database.types.ts`; para evitar reemplazos accidentales, genera primero en un archivo temporal y revisa el diff. `db:push` y los comandos con `--linked` operan contra el proyecto Supabase vinculado.

La aplicación trabaja con rutinas, entrenamientos, perfil corporal y pesos. La función de comida ya no forma parte de la app. No guardes claves privadas ni `service_role` en el cliente.
