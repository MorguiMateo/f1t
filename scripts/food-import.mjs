// Deterministic, offline-only OFF snapshot -> app catalog compiler.
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateSource } from './foods/validate-source.mjs'

const root = resolve(import.meta.dirname, 'foods')
const output = resolve(import.meta.dirname, '../src/features/foods/catalog.json')
const attributionOutput = resolve(import.meta.dirname, '../src/features/foods/catalog-attribution.json')
const releaseDirectory = resolve(import.meta.dirname, '../public/data')
const releaseOutput = resolve(releaseDirectory, 'foods-catalog.json')
const releaseAttributionOutput = resolve(releaseDirectory, 'foods-catalog-attribution.json')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const whitelist = JSON.parse(await readFile(resolve(root, 'whitelist.json'), 'utf8'))
assert(/^\d{4}-\d{2}-\d{2}\.\d+$/.test(whitelist.catalogVersion), 'Invalid catalog version')
assert(Array.isArray(whitelist.products) && whitelist.products.length > 0, 'Empty whitelist')

const seen = new Set()
const products = []
for (const row of whitelist.products) {
  const code = row.sourceCode
  assert(typeof code === 'string' && /^\d{8,14}$/.test(code), `Invalid code ${code}`)
  assert(!seen.has(code), `Duplicate code ${code}`)
  seen.add(code)
  assert(typeof row.name === 'string' && row.name.trim().length >= 3, `${code}: missing visible name`)
  assert(typeof row.brand === 'string' && row.brand.trim(), `${code}: missing brand`)
  assert(typeof row.group === 'string' && row.group.trim(), `${code}: missing group`)
  assert(Array.isArray(row.aliases) && row.aliases.every((alias) => typeof alias === 'string' && alias.trim()), `${code}: invalid aliases`)
  assert(typeof row.sourceRevision === 'number' && Number.isSafeInteger(row.sourceRevision) && row.sourceRevision > 0, `${code}: revision not pinned`)
  assert(typeof row.sourceResponseSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sourceResponseSha256), `${code}: response hash not pinned`)
  assert(typeof row.sourceRetrievedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row.sourceRetrievedAt) && !Number.isNaN(Date.parse(row.sourceRetrievedAt)), `${code}: retrieval date missing`)
  assert(typeof row.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.reviewedAt), `${code}: review date missing`)
  assert(typeof row.reviewNote === 'string' && row.reviewNote.trim().length >= 15, `${code}: review note missing`)
  assert(row.basisUnit === 'g' || row.basisUnit === 'ml', `${code}: invalid basis unit`)
  assert(typeof row.energyKcalPer100 === 'number' && Number.isFinite(row.energyKcalPer100) && row.energyKcalPer100 >= 0 && row.energyKcalPer100 <= 900, `${code}: invalid energy`)

  const raw = gunzipSync(await readFile(resolve(root, 'snapshots', `${code}.json.gz`)))
  assert(sha256(raw) === row.sourceResponseSha256, `${code}: snapshot hash changed`)
  const response = JSON.parse(raw.toString('utf8'))
  const p = validateSource(row, response)
  assert(p.rev === row.sourceRevision, `${code}: source revision changed`)
  products.push({
    catalogVersion: whitelist.catalogVersion,
    source: 'OFF',
    sourceCode: code,
    sourceRevision: row.sourceRevision,
    sourceUrl: `https://world.openfoodfacts.org/product/${code}`,
    sourceRetrievedAt: row.sourceRetrievedAt,
    sourceResponseSha256: row.sourceResponseSha256,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    energyKcalPer100: row.energyKcalPer100,
    basisUnit: row.basisUnit,
    name: row.name.trim(),
    brand: row.brand.trim(),
    group: row.group.trim(),
    aliases: row.aliases.map((alias) => alias.trim()),
    countriesTags: ['en:argentina'],
  })
}

products.sort((a, b) => a.sourceCode.localeCompare(b.sourceCode))
const catalog = {
  catalogVersion: whitelist.catalogVersion,
  source: 'OFF',
  sourceUrl: 'https://world.openfoodfacts.org/',
  license: 'ODbL-1.0',
  databaseLicenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  contentsLicense: 'DbCL-1.0',
  contentsLicenseUrl: 'https://opendatacommons.org/licenses/dbcl/1-0/',
  attribution: 'Datos de productos: Open Food Facts (ODbL 1.0)',
  attributionUrl: '/data/foods-catalog-attribution.json',
  products,
}
const catalogBytes = Buffer.from(`${JSON.stringify(catalog)}\n`)
const attribution = {
  catalogVersion: whitelist.catalogVersion,
  catalogSha256: sha256(catalogBytes),
  attribution: catalog.attribution,
  sourceName: 'Open Food Facts',
  sourceUrl: catalog.sourceUrl,
  databaseLicense: 'ODbL-1.0',
  databaseLicenseUrl: catalog.databaseLicenseUrl,
  contentsLicense: 'DbCL-1.0',
  contentsLicenseUrl: catalog.contentsLicenseUrl,
  derivedDatabase: 'src/features/foods/catalog.json',
  downloadPath: '/data/foods-catalog.json',
  attributionDownloadPath: '/data/foods-catalog-attribution.json',
  imagesIncluded: false,
  note: 'Solo fichas de productos curadas; no incluye datos privados ni imágenes. La etiqueta actual del envase prevalece.',
}
const attributionBytes = Buffer.from(`${JSON.stringify(attribution, null, 2)}\n`)
if (process.argv.includes('--check')) {
  assert((await readFile(output)).equals(catalogBytes), 'Catalog out of date; run node scripts/food-import.mjs')
  assert((await readFile(attributionOutput)).equals(attributionBytes), 'Attribution out of date; run node scripts/food-import.mjs')
  assert((await readFile(releaseOutput)).equals(catalogBytes), 'Public release out of date; run node scripts/food-import.mjs')
  assert((await readFile(releaseAttributionOutput)).equals(attributionBytes), 'Public attribution out of date; run node scripts/food-import.mjs')
} else {
  await mkdir(releaseDirectory, { recursive: true })
  await writeFile(output, catalogBytes)
  await writeFile(attributionOutput, attributionBytes)
  await writeFile(releaseOutput, catalogBytes)
  await writeFile(releaseAttributionOutput, attributionBytes)
}
console.log(`${products.length} OFF products; catalog ${catalogBytes.length} bytes; SHA-256 ${sha256(catalogBytes)}`)
