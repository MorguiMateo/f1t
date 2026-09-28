/**
 * Single instance: each `createClient` runs its own auth listener and token
 * refresh, so two clients fight over storage and desync sessions.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail at startup: a half-filled `.env` otherwise surfaces much later as
// cryptic network errors.
if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env y completalas.",
  );
}

// Pasting the key into the URL field has happened before, with an unreadable
// symptom.
if (!/^https?:\/\//.test(url)) {
  throw new Error(
    `VITE_SUPABASE_URL tiene que ser una URL (https://<ref>.supabase.co), no una API key. Valor actual: ${url.slice(0, 24)}…`,
  );
}

// Regenerate database.types.ts with `npm run db:types`.
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // An SPA has no secret to keep.
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    // Consumes the `?code=` from the OAuth redirect and cleans the URL.
    detectSessionInUrl: true,
  },
});
