// One-time OFF acquisition. Not used by the app or the deterministic importer.
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { snapshotPath } from './foods/snapshot-path.mjs'

const root = resolve(import.meta.dirname, 'foods')
const whitelist = JSON.parse(await readFile(resolve(root, 'whitelist.json'), 'utf8'))
const refresh = process.argv.includes('--refresh')
if (process.argv.slice(2).some((arg) => arg !== '--refresh')) throw new Error('Only --refresh is supported')
const userAgent = 'F1t-offline-food-catalog/1.0 (https://github.com/mateomorgui/F1t; offline one-time import)'
let lastRequest = 0

for (const { sourceCode: code } of whitelist.products) {
  const path = snapshotPath(root, code, refresh)
  if (!refresh) {
    try { await access(path); console.log(`${code}: snapshot exists`); continue } catch { /* fetch */ }
  }
  const delay = Math.max(0, 4500 - (Date.now() - lastRequest))
  if (delay) await new Promise((r) => setTimeout(r, delay))
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json`
  lastRequest = Date.now()
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}; rerun later (existing snapshots are retained)`)
  const raw = Buffer.from(await response.arrayBuffer())
  const parsed = JSON.parse(raw.toString('utf8'))
  if (parsed.status !== 1 || parsed.code !== code || parsed.product?.code !== code) {
    throw new Error(`${code}: missing or mismatched product`)
  }
  await mkdir(resolve(root, refresh ? 'staged' : 'snapshots'), { recursive: true })
  await writeFile(path, gzipSync(raw, { mtime: 0 }))
  const sha256 = createHash('sha256').update(raw).digest('hex')
  const p = parsed.product
  if (refresh) {
    await writeFile(resolve(root, 'staged', `${code}.meta.json`), `${JSON.stringify({
      sourceCode: code,
      sourceUrl: url,
      sourceRetrievedAt: new Date().toISOString(),
      sourceRevision: p.rev,
      sourceResponseSha256: sha256,
    }, null, 2)}\n`)
  }
  console.log(`${code}: ${refresh ? 'STAGED' : 'pinned'} rev ${p.rev}; sha256 ${sha256}; ${p.product_name}; ${p.brands}; ${p.nutriments?.['energy-kcal_100g']} kcal`)
}
