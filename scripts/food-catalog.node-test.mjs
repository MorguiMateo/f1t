import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { validateSource } from './foods/validate-source.mjs'
import { snapshotPath } from './foods/snapshot-path.mjs'

const root = import.meta.dirname
const catalogPath = resolve(root, '../src/features/foods/catalog.json')
const attributionPath = resolve(root, '../src/features/foods/catalog-attribution.json')
const publicCatalogPath = resolve(root, '../public/data/foods-catalog.json')
const publicAttributionPath = resolve(root, '../public/data/foods-catalog-attribution.json')
const whitelistPath = resolve(root, 'foods/whitelist.json')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('every pinned source regenerates the same open release without network', () => {
  const run = () => execFileSync(process.execPath, [resolve(root, 'food-import.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(run(), run())
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const attribution = JSON.parse(readFileSync(attributionPath, 'utf8'))
  const whitelist = JSON.parse(readFileSync(whitelistPath, 'utf8'))
  const snapshots = readdirSync(resolve(root, 'foods/snapshots')).filter((name) => name.endsWith('.json.gz'))
  assert.equal(catalog.catalogVersion, '2026-10-01.1')
  assert.equal(catalog.products.length, 43)
  assert.equal(catalog.products.length, whitelist.products.length)
  assert.equal(snapshots.length, whitelist.products.length)
  for (const code of ['7798085371841', '7793360005084', '7790045827559', '7790045000907', '7790040140912', '7790895000782']) {
    assert.ok(!catalog.products.some((item) => item.sourceCode === code), `${code} must remain excluded pending label review`)
    assert.ok(!snapshots.includes(`${code}.json.gz`))
  }
  assert.equal(attribution.catalogSha256, digest(readFileSync(catalogPath)))
  assert.deepEqual(readFileSync(publicCatalogPath), readFileSync(catalogPath))
  assert.deepEqual(readFileSync(publicAttributionPath), readFileSync(attributionPath))
  assert.equal(attribution.downloadPath, '/data/foods-catalog.json')
  assert.equal(catalog.license, 'ODbL-1.0')
  assert.equal(catalog.sourceUrl, attribution.sourceUrl)
  assert.equal(catalog.databaseLicenseUrl, attribution.databaseLicenseUrl)
  assert.equal(catalog.contentsLicense, attribution.contentsLicense)
  assert.equal(catalog.contentsLicenseUrl, attribution.contentsLicenseUrl)
  assert.equal(catalog.attributionUrl, attribution.attributionDownloadPath)
  assert.equal(catalog.attribution, attribution.attribution)
  assert.equal(new URL(catalog.databaseLicenseUrl).protocol, 'https:')
  assert.equal(new URL(catalog.contentsLicenseUrl).protocol, 'https:')
  assert.equal(new URL(catalog.attributionUrl, 'https://example.org').pathname, catalog.attributionUrl)
  assert.ok(readFileSync(catalogPath).length < 100_000, 'catalog exceeds 100 KB budget')
})

test('rejects kcal/kJ contradictions and explicit OFF cross-unit conflict flags', () => {
  const code = '7790742348302'
  const row = JSON.parse(readFileSync(whitelistPath, 'utf8')).products.find((item) => item.sourceCode === code)
  const original = JSON.parse(gunzipSync(readFileSync(snapshotPath(resolve(root, 'foods'), code, false))).toString('utf8'))
  assert.doesNotThrow(() => validateSource(row, original))

  const wrongKj = structuredClone(original)
  wrongKj.product.nutriments['energy-kj_100g'] = 17.5
  assert.throws(() => validateSource(row, wrongKj), /kcal\/kJ contradiction/)

  const flagged = structuredClone(original)
  flagged.product.data_quality_warnings_tags = ['en:nutrition-energy-value-in-kcal-does-not-match-value-in-kj']
  assert.throws(() => validateSource(row, flagged), /OFF energy conflict flag/)
})

test('refresh destination is separate from pinned snapshots', () => {
  const code = '7790742348302'
  const foodsRoot = resolve(root, 'foods')
  assert.equal(snapshotPath(foodsRoot, code, true), resolve(foodsRoot, 'staged', `${code}.json.gz`))
  assert.equal(snapshotPath(foodsRoot, code, false), resolve(foodsRoot, 'snapshots', `${code}.json.gz`))
  assert.notEqual(snapshotPath(foodsRoot, code, true), snapshotPath(foodsRoot, code, false))
})

test('promotion refuses a version without an explicit increment or staged review', () => {
  const code = '7790742348302'
  const pinnedPath = snapshotPath(resolve(root, 'foods'), code, false)
  const beforeSnapshot = readFileSync(pinnedPath)
  const beforeWhitelist = readFileSync(whitelistPath)
  const version = JSON.parse(beforeWhitelist.toString('utf8')).catalogVersion
  const result = spawnSync(process.execPath, [resolve(root, 'food-promote.mjs'),
    '--code', code, '--version', version, '--reviewed-at', '2026-09-29',
    '--review-note', 'Prueba de rechazo sin promoción válida', '--energy', '57',
    '--basis', 'ml', '--name', 'Leche fresca clásica La Serenísima', '--brand', 'La Serenísima',
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Catalog version must increase/)
  assert.deepEqual(readFileSync(pinnedPath), beforeSnapshot)
  assert.deepEqual(readFileSync(whitelistPath), beforeWhitelist)
})
