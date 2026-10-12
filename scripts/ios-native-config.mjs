import { pathToFileURL } from 'node:url';

// Shared by preparation and Xcode: validate the values that will actually be bundled.
export function validateNativeConfiguration(url, key) {
  if (!url || !key) throw new Error('Missing public Supabase configuration.');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid native Supabase origin.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !/^[a-zA-Z0-9.-]+$/.test(parsed.hostname)) throw new Error('Native Supabase URL must be a plain HTTPS origin.');
  if (parsed.pathname !== '/' || parsed.port) throw new Error('Native Supabase URL must be a plain HTTPS origin without a port or path.');
  if (!/^[A-Za-z0-9_.-]+$/.test(key) || key.startsWith('sb_secret_')) throw new Error('Only a public Supabase anon/publishable key may be bundled.');
  if (!key.startsWith('sb_publishable_')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role; } catch { throw new Error('Invalid public Supabase key.'); }
    if (role !== 'anon') throw new Error('Only a public anon key may be bundled.');
  }
  return { url: parsed.origin, key };
}

export function nativeXCConfig(url, key) {
  const config = validateNativeConfiguration(url, key);
  // xcconfig treats `//` as a comment even inside quotes; `$()` splits it safely.
  return `// Generated locally; contains public client configuration only.\nSUPABASE_URL = ${config.url.replace('https://', 'https:/$()/')}\nSUPABASE_ANON_KEY = ${config.key}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = validateNativeConfiguration(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    // Preparation can normalize an origin; a build must validate the literal plist value.
    if (![config.url, `${config.url}/`].includes(process.env.SUPABASE_URL)) throw new Error('Native Supabase URL is not a resolved HTTPS origin.');
  } catch (error) {
    // Never echo URLs/keys or dump the build environment, even on failure.
    console.error(`error: FIT: ${error.message} Ejecutá npm run ios:prepare desde la raíz del proyecto y volvé a compilar.`);
    process.exitCode = 1;
  }
}
