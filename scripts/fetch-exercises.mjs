/**
 * Construye el catálogo de ejercicios desde free-exercise-db.
 *
 * Generador de una sola corrida, igual que gen-icons.mjs. Baja el dataset,
 * lo recorta a la lista blanca de scripts/curated-ids.json, convierte las
 * fotos a WebP y escribe tres cosas:
 *
 *   public/exercises/<id>/{0,1}.webp      assets que entran al precache
 *   src/features/exercises/catalog.json   lo que consume la app
 *   supabase/seed/exercises.sql           upsert idempotente de la tabla
 *
 * No es una API en vivo por decisión (PLAN.md §2): el press de banca no
 * cambia, y como assets propios el catálogo funciona sin señal en el gym y
 * viaja dentro del bundle de iOS cuando entre Capacitor.
 *
 * Es idempotente y se puede cortar a la mitad: las imágenes que ya existen
 * no se vuelven a bajar. Para forzar todo de nuevo, borrar public/exercises.
 *
 * Uso: node scripts/fetch-exercises.mjs
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const OUT_IMAGES = resolve(ROOT, "public/exercises");
const OUT_CATALOG = resolve(ROOT, "src/features/exercises/catalog.json");
const OUT_SEED = resolve(ROOT, "supabase/seed/exercises.sql");

// El JSON crudo pesa ~1 MB. Se cachea bajo node_modules —que ya está
// ignorado— para que volver a correr el script no lo baje de nuevo.
const CACHE = resolve(ROOT, "node_modules/.cache/f1t/exercises.json");

// Medido con sharp sobre una foto real: 850px JPG 69,7 KB → 480px WebP q72
// 16,8 KB. A 165 ejercicios × 2 son ~5,5 MB, precacheables enteros.
const WIDTH = 480;
const QUALITY = 72;

/** Cuántas descargas en paralelo. Suficiente sin martillar a GitHub. */
const CONCURRENCY = 8;

async function loadDataset() {
  if (existsSync(CACHE)) {
    return JSON.parse(await readFile(CACHE, "utf8"));
  }
  process.stdout.write("Bajando exercises.json… ");
  const res = await fetch(`${RAW}/dist/exercises.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status} al bajar el dataset`);
  const text = await res.text();
  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, text, "utf8");
  console.log(`${(text.length / 1024).toFixed(0)} KB`);
  return JSON.parse(text);
}

/** La lista blanca viene agrupada por músculo solo para poder editarla. */
async function loadWhitelist() {
  const grouped = JSON.parse(
    await readFile(resolve(ROOT, "scripts/curated-ids.json"), "utf8"),
  );
  return [...new Set(Object.values(grouped).flat())];
}

/**
 * Nombres en español + inglés acortado + alias de búsqueda, escritos a mano.
 * El dataset trae los nombres crudos en inglés ("Barbell Bench Press - Medium
 * Grip"); este archivo los acorta, los traduce y aporta las variantes en
 * español para que la búsqueda funcione en los dos idiomas (PLAN.md Fase 2).
 */
async function loadNames() {
  return JSON.parse(
    await readFile(resolve(ROOT, "scripts/exercise-es.json"), "utf8"),
  );
}

/** Corre `task` sobre cada item con un pool de tamaño fijo. */
async function pool(items, size, task) {
  const queue = [...items];
  const workers = Array.from({ length: size }, async () => {
    while (queue.length) await task(queue.shift());
  });
  await Promise.all(workers);
}

async function convertImage(exerciseId, index, sourcePath) {
  const outPath = resolve(OUT_IMAGES, exerciseId, `${index}.webp`);
  if (existsSync(outPath)) return { skipped: true, bytes: 0 };

  const res = await fetch(`${RAW}/exercises/${sourcePath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${sourcePath}`);
  const input = Buffer.from(await res.arrayBuffer());

  await mkdir(dirname(outPath), { recursive: true });
  const info = await sharp(input)
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(outPath);

  return { skipped: false, bytes: info.size };
}

/** Escapa un string para SQL. Los nombres traen apóstrofos. */
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** text[] con el constructor array[], que no necesita escapar llaves. */
const arr = (values) =>
  values.length ? `array[${values.map(q).join(", ")}]` : "array[]::text[]";

function buildSeed(catalog) {
  const rows = catalog.map(
    (e) =>
      `  (${q(e.id)}, ${q(e.name)}, ${q(e.category)}, ` +
      `${e.equipment ? q(e.equipment) : "null"}, ${q(e.level)}, ` +
      `${e.force ? q(e.force) : "null"}, ${e.mechanic ? q(e.mechanic) : "null"}, ` +
      `${arr(e.primaryMuscles)}, ${arr(e.secondaryMuscles)}, ` +
      `${arr(e.instructions)}, ${arr(e.images)})`,
  );

  return `-- Generado por scripts/fetch-exercises.mjs — no editar a mano.
-- ${catalog.length} ejercicios curados de free-exercise-db (Unlicense).
--
-- Idempotente: se puede volver a correr después de cambiar la lista blanca.
-- Aplicar con:  npm run db:seed

insert into public.exercises (
  id, name, category, equipment, level, force, mechanic,
  primary_muscles, secondary_muscles, instructions, images
) values
${rows.join(",\n")}
on conflict (id) do update set
  name              = excluded.name,
  category          = excluded.category,
  equipment         = excluded.equipment,
  level             = excluded.level,
  force             = excluded.force,
  mechanic          = excluded.mechanic,
  primary_muscles   = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  instructions      = excluded.instructions,
  images            = excluded.images;
`;
}

// ---------------------------------------------------------------------------

const dataset = await loadDataset();
const whitelist = await loadWhitelist();
const names = await loadNames();
const byId = new Map(dataset.map((e) => [e.id, e]));

// Si el dataset renombra un id, se entera acá y no con una imagen rota en
// producción tres semanas después.
const missing = whitelist.filter((id) => !byId.has(id));
if (missing.length) {
  console.error(`\nEstos ids de la lista blanca no están en el dataset:`);
  for (const id of missing) console.error(`  ${id}`);
  process.exit(1);
}

const withoutImages = whitelist.filter((id) => byId.get(id).images?.length !== 2);
if (withoutImages.length) {
  console.error(`\nEstos ids no tienen exactamente 2 imágenes:`);
  for (const id of withoutImages) console.error(`  ${id}`);
  process.exit(1);
}

// Los nombres se escriben a mano: si falta uno, el ejercicio saldría con el
// nombre crudo del inglés y sin alias en español. Se corta antes que dejar
// pasar un catálogo a medio traducir.
const withoutName = whitelist.filter((id) => !names[id]);
if (withoutName.length) {
  console.error(`\nEstos ids no tienen entrada en scripts/exercise-es.json:`);
  for (const id of withoutName) console.error(`  ${id}`);
  process.exit(1);
}

// Y al revés: una entrada que ya no corresponde a ningún id curado es basura
// que conviene borrar de la mano (típicamente al sacar un ejercicio del catálogo).
const whitelistSet = new Set(whitelist);
const extraNames = Object.keys(names).filter((id) => !whitelistSet.has(id));
if (extraNames.length) {
  console.error(`\nEstas entradas de scripts/exercise-es.json sobran (no están en la lista blanca):`);
  for (const id of extraNames) console.error(`  ${id}`);
  process.exit(1);
}

console.log(`Lista blanca: ${whitelist.length} de ${dataset.length} ejercicios.`);

const catalog = whitelist
  .map((id) => {
    const e = byId.get(id);
    const tr = names[id];
    // El nombre crudo del dataset entra a los alias para que la búsqueda en
    // inglés no regrese aunque el override no lo repita.
    const aliases = [...new Set([...tr.aliases, e.name])];
    return {
      id: e.id,
      name: tr.es, // Display por defecto: español.
      nameEn: tr.en, // Lo consumirá el selector de idioma futuro (PLAN.md).
      aliases,
      category: e.category,
      equipment: e.equipment ?? null,
      level: e.level,
      force: e.force ?? null,
      mechanic: e.mechanic ?? null,
      primaryMuscles: e.primaryMuscles ?? [],
      secondaryMuscles: e.secondaryMuscles ?? [],
      instructions: e.instructions ?? [],
      // Rutas servibles tal cual, para que <img src> no necesite helper.
      images: [0, 1].map((i) => `/exercises/${e.id}/${i}.webp`),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

console.log("Convirtiendo imágenes a WebP…");
let converted = 0, skipped = 0, totalBytes = 0, done = 0;

const jobs = catalog.flatMap((e) =>
  byId.get(e.id).images.map((src, i) => ({ id: e.id, i, src })),
);

await pool(jobs, CONCURRENCY, async ({ id, i, src }) => {
  const { skipped: wasSkipped, bytes } = await convertImage(id, i, src);
  if (wasSkipped) skipped++;
  else { converted++; totalBytes += bytes; }
  done++;
  if (done % 40 === 0 || done === jobs.length) {
    process.stdout.write(`\r  ${done}/${jobs.length}`);
  }
});
console.log();

await mkdir(dirname(OUT_CATALOG), { recursive: true });
await writeFile(OUT_CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");

await mkdir(dirname(OUT_SEED), { recursive: true });
await writeFile(OUT_SEED, buildSeed(catalog), "utf8");

const avg = converted ? (totalBytes / converted / 1024).toFixed(1) : "—";
console.log(`\nImágenes: ${converted} convertidas, ${skipped} ya estaban.`);
if (converted) console.log(`Promedio: ${avg} KB por imagen.`);
console.log(`  src/features/exercises/catalog.json  (${catalog.length} ejercicios)`);
console.log(`  supabase/seed/exercises.sql`);
