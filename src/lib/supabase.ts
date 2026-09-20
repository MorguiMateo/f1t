/**
 * The single Supabase client.
 *
 * One instance for the whole app: each `createClient` spins up its own auth
 * listener and its own token refresh, so two clients fight over the same
 * storage and end up with sessions out of sync.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail at startup and not on the first request: a half-filled `.env`
// produces incomprehensible network errors forty minutes later.
if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env y completalas.",
  );
}

// A mistake already made once: pasting the publishable key into the URL
// field. The symptom is unreadable, so it gets checked here.
if (!/^https?:\/\//.test(url)) {
  throw new Error(
    `VITE_SUPABASE_URL tiene que ser una URL (https://<ref>.supabase.co), no una API key. Valor actual: ${url.slice(0, 24)}…`,
  );
}

// The <Database> parameter comes from database.types.ts, regenerated with
// `npm run db:types` from the real schema. That makes supabase.from("sessions")
// typed: mixing up performed_on with another column gets caught by tsc.
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // PKCE is the right flow for an SPA: there is no secret to keep.
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    // Handles the `?code=` Google sends the user back with, and cleans the URL.
    detectSessionInUrl: true,
  },
});
