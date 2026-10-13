import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeXCConfig } from './ios-native-config.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const env = {};
for (const name of ['.env', '.env.local']) {
  let text;
  try { text = await readFile(resolve(root, name), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    env[match[1]] = value;
  }
}
const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in an ignored local env file.');
await writeFile(resolve(root, 'ios/native-config.xcconfig'), nativeXCConfig(url, key), { mode: 0o600 });
const resources = resolve(root, 'ios/App/NativeResources');
await mkdir(resources, { recursive: true });
// Remove obsolete generated diary resources from existing native builds.
for (const name of ["foods-catalog.json", "foods-catalog-attribution.json"]) {
  await rm(resolve(resources, name), { force: true });
}
await cp(resolve(root, 'public/exercises'), resolve(resources, 'exercises'), { recursive: true });
const catalog = JSON.parse(await readFile(resolve(root, 'src/features/exercises/catalog.json'), 'utf8'));
const exercises = catalog.map(e => ({ id: e.id, name: e.name, name_en: e.nameEn, aliases: e.aliases, category: e.category, level: e.level, equipment: e.equipment, force: e.force, mechanic: e.mechanic,
  primary_muscles: e.primaryMuscles, secondary_muscles: e.secondaryMuscles, instructions: e.instructions,
  images: e.images.map(path => path.replace(/^\/?exercises\//, '')) }));
await writeFile(resolve(resources, 'exercise-catalog.json'), JSON.stringify(exercises));
await writeFile(resolve(resources, 'exercise-attribution.txt'), 'Exercise catalog and images derived from https://github.com/yuhonas/free-exercise-db (Unlicense).\n');
console.log(`Native resources prepared: ${exercises.length} exercises. No web build or Capacitor sync performed.`);
