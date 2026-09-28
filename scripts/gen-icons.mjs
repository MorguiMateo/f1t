// Intensity is encoded with opacity, not hue, as in the heatmap: that way the
// icon survives the iOS Clear and Tint modes.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = resolve(ROOT, "public");

const GROUND = "#0c0d10";
const ACCENT = "#ff5a32";

// 0 = off; 1–4 = intensity.
const PATTERN = [
  [0, 1, 2, 4],
  [1, 2, 4, 3],
  [2, 4, 3, 1],
  [4, 3, 1, 0],
];

const OPACITY = { 0: 0.14, 1: 0.34, 2: 0.55, 3: 0.78, 4: 1 };

// `inset` is the free fraction per edge; maskable icons need ~20% safe margin.
function buildSvg(size, inset) {
  const area = size * (1 - inset * 2);
  const origin = size * inset;
  // Safe margin ~20% for maskable icons.
  const gap = area * 0.075;
  const cell = (area - gap * 3) / 4;
  const radius = cell * 0.22;

  const squares = PATTERN.flatMap((row, y) =>
    row.map((level, x) => {
      const px = origin + x * (cell + gap);
      const py = origin + y * (cell + gap);
      return `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${ACCENT}" fill-opacity="${OPACITY[level]}"/>`;
    }),
  ).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${GROUND}"/>${squares}</svg>`;
}

async function png(svg, size, outPath) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath);
  console.log(`  ${outPath.replace(ROOT + "/", "")}`);
}

await mkdir(resolve(PUBLIC, "icons"), { recursive: true });

const standard = buildSvg(512, 0.14);
// Generous margins so no system crop clips it.
const maskable = buildSvg(512, 0.24);

console.log("Generando iconos:");
await png(standard, 192, resolve(PUBLIC, "icons/icon-192.png"));
await png(standard, 512, resolve(PUBLIC, "icons/icon-512.png"));
await png(maskable, 512, resolve(PUBLIC, "icons/icon-maskable-512.png"));
// iOS doesn't round the apple-touch-icon's corners: it ships square.
await png(standard, 180, resolve(PUBLIC, "apple-touch-icon.png"));

await writeFile(resolve(PUBLIC, "favicon.svg"), buildSvg(64, 0.08), "utf8");
console.log("  public/favicon.svg");
