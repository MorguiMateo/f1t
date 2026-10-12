import { resolve } from 'node:path'

export function snapshotPath(root, code, refresh) {
  if (!/^\d{8,14}$/.test(code)) throw new Error(`Invalid code: ${code}`)
  return resolve(root, refresh ? 'staged' : 'snapshots', `${code}.json.gz`)
}
