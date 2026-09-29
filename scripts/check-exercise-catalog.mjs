/** Validate the checked-in exercise catalog without fetching or changing files. */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function compareSets(actual, expected, label, errors) {
  for (const value of expected) {
    if (!actual.has(value)) errors.push(`${label}: missing ${value}`);
  }
  for (const value of actual) {
    if (!expected.has(value)) errors.push(`${label}: unexpected ${value}`);
  }
}

export async function checkExerciseCatalog(root = ROOT) {
  const errors = [];
  const [groups, translations, catalog, seed] = await Promise.all([
    json(join(root, "scripts/curated-ids.json")),
    json(join(root, "scripts/exercise-es.json")),
    json(join(root, "src/features/exercises/catalog.json")),
    readFile(join(root, "supabase/seed/exercises.sql"), "utf8"),
  ]);

  const curated = Object.values(groups).flat();
  const curatedIds = new Set(curated);
  const catalogIds = new Set(catalog.map((exercise) => exercise.id));
  if (curatedIds.size !== curated.length) errors.push("curated IDs contain duplicates");
  if (catalogIds.size !== catalog.length) errors.push("catalog IDs contain duplicates");
  compareSets(catalogIds, curatedIds, "catalog IDs", errors);
  compareSets(new Set(Object.keys(translations)), curatedIds, "translations", errors);

  // The generator emits one row per line, with ID and visible name first.
  const seedRows = [...seed.matchAll(/^  \('((?:[^']|'')*)', '((?:[^']|'')*)',/gm)]
    .map((match) => [match[1], match[2]].map((value) => value.replaceAll("''", "'")));
  const seedIds = seedRows.map(([id]) => id);
  const seedNames = new Map(seedRows);
  if (new Set(seedIds).size !== seedIds.length) errors.push("seed IDs contain duplicates");
  compareSets(new Set(seedIds), curatedIds, "seed IDs", errors);

  const expectedAssets = new Set();
  for (const exercise of catalog) {
    if (exercise.name !== translations[exercise.id]?.es) {
      errors.push(`catalog translation: mismatched name for ${exercise.id}`);
    }
    if (seedNames.has(exercise.id) && seedNames.get(exercise.id) !== exercise.name) {
      errors.push(`seed name: mismatched name for ${exercise.id}`);
    }
    const images = [0, 1].map((index) =>
      `/exercises/${exercise.id}/${index}.webp`);
    if (JSON.stringify(exercise.images) !== JSON.stringify(images)) {
      errors.push(`catalog images: invalid paths for ${exercise.id}`);
    }
    for (const image of images) expectedAssets.add(image.slice(1));
    if (!exercise.nameEn || !Array.isArray(exercise.aliases) || !exercise.aliases.length) {
      errors.push(`catalog search fields: incomplete for ${exercise.id}`);
    }
  }

  const imageRoot = join(root, "public/exercises");
  const actualAssets = new Set();
  for (const entry of await readdir(imageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      errors.push(`exercise assets: unexpected ${entry.name}`);
      continue;
    }
    for (const file of await readdir(join(imageRoot, entry.name), { withFileTypes: true })) {
      const relative = `exercises/${entry.name}/${file.name}`;
      actualAssets.add(relative);
      if (!file.isFile() || (await stat(join(imageRoot, entry.name, file.name))).size === 0) {
        errors.push(`exercise assets: empty or non-file ${relative}`);
      }
    }
  }
  compareSets(actualAssets, expectedAssets, "exercise assets", errors);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await checkExerciseCatalog();
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("Exercise catalog, seed, translations, and assets are consistent.");
  }
}
