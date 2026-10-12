// Explicit reviewed promotion of a staged OFF response; never fetches network data.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { validateSource } from './foods/validate-source.mjs'

const args = process.argv.slice(2)
const allowed = new Set(['--code', '--version', '--reviewed-at', '--review-note', '--energy', '--basis', '--name', '--brand'])
if (args.length !== 16 || args.some((arg, index) => index % 2 === 0 && !allowed.has(arg))) {
  throw new Error('Usage: node scripts/food-promote.mjs --code CODE --version YYYY-MM-DD.N --reviewed-at YYYY-MM-DD --review-note TEXT --energy KCAL_PER_100 --basis g|ml --name DISPLAY_NAME --brand DISPLAY_BRAND')
}
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[2 * i], args[2 * i + 1]]))
if (Object.keys(options).length !== allowed.size || Object.values(options).some((value) => !value)) throw new Error('Every promotion option is required exactly once')
const code = options['--code']
const version = options['--version']
const reviewedAt = options['--reviewed-at']
const reviewNote = options['--review-note']
const energyKcalPer100 = Number(options['--energy'])
const basisUnit = options['--basis']
const name = options['--name'].trim()
const brand = options['--brand'].trim()
const root = resolve(import.meta.dirname, 'foods')
const whitelistPath = resolve(root, 'whitelist.json')
const pinnedPath = resolve(root, 'snapshots', `${code}.json.gz`)
const stagedPath = resolve(root, 'staged', `${code}.json.gz`)
const stagedMetaPath = resolve(root, 'staged', `${code}.meta.json`)
const importer = resolve(import.meta.dirname, 'food-import.mjs')
const assert = (condition, message) => { if (!condition) throw new Error(message) }

assert(/^\d{8,14}$/.test(code), 'Invalid code')
assert(/^\d{4}-\d{2}-\d{2}\.\d+$/.test(version), 'Invalid catalog version')
assert(/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt) && !Number.isNaN(Date.parse(reviewedAt)), 'Invalid review date')
assert(reviewNote.trim().length >= 15, 'Review note must describe actual review')
assert(name.length >= 3 && brand.length >= 2, 'Reviewed name and brand required')
assert(Number.isFinite(energyKcalPer100) && energyKcalPer100 >= 0 && energyKcalPer100 <= 900, 'Invalid reviewed energy')
assert(basisUnit === 'g' || basisUnit === 'ml', 'Invalid reviewed unit')

// Do not promote on top of an already inconsistent release.
execFileSync(process.execPath, [importer, '--check'])
const oldWhitelistBytes = await readFile(whitelistPath)
const whitelist = JSON.parse(oldWhitelistBytes.toString('utf8'))
const [newDate, newRevision] = version.split('.')
const [oldDate, oldRevision] = whitelist.catalogVersion.split('.')
assert(newDate > oldDate || (newDate === oldDate && Number(newRevision) > Number(oldRevision)), 'Catalog version must increase')
const row = whitelist.products.find((item) => item.sourceCode === code)
assert(row, `${code}: not in reviewed whitelist`)
const oldSnapshotBytes = await readFile(pinnedPath)
const stagedBytes = await readFile(stagedPath)
const raw = gunzipSync(stagedBytes)
const staged = JSON.parse(raw.toString('utf8'))
const meta = JSON.parse(await readFile(stagedMetaPath, 'utf8'))
const hash = createHash('sha256').update(raw).digest('hex')
assert(meta.sourceCode === code && meta.sourceUrl === `https://world.openfoodfacts.org/api/v2/product/${code}.json`, `${code}: staged metadata mismatch`)
assert(meta.sourceResponseSha256 === hash && meta.sourceRevision === staged.product?.rev, `${code}: staged response changed`)
assert(typeof meta.sourceRetrievedAt === 'string' && !Number.isNaN(Date.parse(meta.sourceRetrievedAt)), `${code}: missing retrieval timestamp`)
assert(reviewedAt >= meta.sourceRetrievedAt.slice(0, 10), 'Review date predates retrieval')
assert(hash !== row.sourceResponseSha256 || staged.product.rev !== row.sourceRevision, 'Staged response is identical to pinned source')
const reviewedRow = {
  ...row,
  sourceRevision: meta.sourceRevision,
  sourceResponseSha256: hash,
  sourceRetrievedAt: meta.sourceRetrievedAt,
  reviewedAt,
  reviewNote: reviewNote.trim(),
  energyKcalPer100,
  basisUnit,
  name,
  brand,
}
validateSource(reviewedRow, staged)
whitelist.catalogVersion = version
whitelist.products = whitelist.products.map((item) => item.sourceCode === code ? reviewedRow : item)

try {
  await writeFile(pinnedPath, stagedBytes)
  await writeFile(whitelistPath, `${JSON.stringify(whitelist, null, 2)}\n`)
  execFileSync(process.execPath, [importer], { stdio: 'inherit' })
  execFileSync(process.execPath, [importer, '--check'])
} catch (error) {
  await writeFile(pinnedPath, oldSnapshotBytes)
  await writeFile(whitelistPath, oldWhitelistBytes)
  execFileSync(process.execPath, [importer], { stdio: 'inherit' })
  throw error
}
await rm(stagedPath)
await rm(stagedMetaPath)
console.log(`${code}: promoted reviewed OFF revision ${meta.sourceRevision} in catalog ${version}`)
