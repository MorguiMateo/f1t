import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { checkExerciseCatalog } from "./check-exercise-catalog.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "f1t-catalog-check-"));
  roots.push(root);
  const paths = [
    "scripts",
    "src/features/exercises",
    "supabase/seed",
    "public/exercises/Example",
  ];
  await Promise.all(paths.map((path) => mkdir(join(root, path), { recursive: true })));
  await writeFile(join(root, "scripts/curated-ids.json"), JSON.stringify({ chest: ["Example"] }));
  await writeFile(join(root, "scripts/exercise-es.json"), JSON.stringify({ Example: { es: "Ejemplo" } }));
  await writeFile(join(root, "src/features/exercises/catalog.json"), JSON.stringify([{
    id: "Example", name: "Ejemplo", nameEn: "Example", aliases: ["Ejemplo"],
    images: ["/exercises/Example/0.webp", "/exercises/Example/1.webp"],
  }]));
  await writeFile(join(root, "supabase/seed/exercises.sql"), "  ('Example', 'Ejemplo', null)\n");
  await writeFile(join(root, "public/exercises/Example/0.webp"), "image");
  await writeFile(join(root, "public/exercises/Example/1.webp"), "image");
  return root;
}

test("accepts a consistent catalog", async () => {
  assert.deepEqual(await checkExerciseCatalog(await fixture()), []);
});

test("reports missing and orphan assets without deleting them", async () => {
  const root = await fixture();
  await rm(join(root, "public/exercises/Example/1.webp"));
  await writeFile(join(root, "public/exercises/Example/orphan.webp"), "image");
  const errors = await checkExerciseCatalog(root);
  assert.ok(errors.some((error) => error.includes("missing exercises/Example/1.webp")));
  assert.ok(errors.some((error) => error.includes("unexpected exercises/Example/orphan.webp")));
});

test("reports divergent seed and translations", async () => {
  const root = await fixture();
  await writeFile(join(root, "supabase/seed/exercises.sql"), "  ('Other', 'Otro', null)\n");
  await writeFile(join(root, "scripts/exercise-es.json"), "{}");
  const errors = await checkExerciseCatalog(root);
  assert.ok(errors.some((error) => error.includes("seed IDs: missing Example")));
  assert.ok(errors.some((error) => error.includes("seed IDs: unexpected Other")));
  assert.ok(errors.some((error) => error.includes("translations: missing Example")));
});

test("reports stale names even when IDs still match", async () => {
  const root = await fixture();
  await writeFile(join(root, "supabase/seed/exercises.sql"), "  ('Example', 'Old name', null)\n");
  await writeFile(join(root, "scripts/exercise-es.json"), JSON.stringify({ Example: { es: "New name" } }));
  const errors = await checkExerciseCatalog(root);
  assert.ok(errors.some((error) => error.includes("seed name: mismatched name for Example")));
  assert.ok(errors.some((error) => error.includes("catalog translation: mismatched name for Example")));
});
