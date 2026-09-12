/**
 * El cliente único de Supabase.
 *
 * Una sola instancia para toda la app: cada `createClient` levanta su propio
 * listener de auth y su propio refresco de token, así que dos clientes se
 * pelean por el mismo storage y terminan con sesiones desincronizadas.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Falla al arrancar y no en el primer request: un `.env` a medio llenar
// produce errores de red incomprensibles cuarenta minutos después.
if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env y completalas.",
  );
}

// Un error que ya cometimos una vez: pegar la publishable key en el campo de
// la URL. El síntoma es ilegible, así que se chequea acá.
if (!/^https?:\/\//.test(url)) {
  throw new Error(
    `VITE_SUPABASE_URL tiene que ser una URL (https://<ref>.supabase.co), no una API key. Valor actual: ${url.slice(0, 24)}…`,
  );
}

// El parámetro <Database> viene de database.types.ts, que se regenera con
// `npm run db:types` desde el schema real. Con eso supabase.from("sessions")
// queda tipado: confundir performed_on con otra columna lo agarra tsc.
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // PKCE es el flujo correcto para una SPA: no hay secreto que guardar.
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    // Procesa el `?code=` con el que Google devuelve al usuario y limpia la URL.
    detectSessionInUrl: true,
  },
});
