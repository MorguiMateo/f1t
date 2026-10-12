import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const xcode = require('xcode')
const projectPath = resolve(import.meta.dirname, '../ios/App/App.xcodeproj/project.pbxproj')

test('xcode can generate project IDs with its patched CommonJS uuid dependency', () => {
  const project = xcode.project(projectPath).parseSync()
  const existing = new Set(project.allUuids())
  const generated = new Set()
  for (let index = 0; index < 128; index++) {
    const id = project.generateUuid()
    assert.match(id, /^[A-F0-9]{24}$/)
    assert.ok(!existing.has(id))
    assert.ok(!generated.has(id))
    generated.add(id)
  }
})

test('xcode preserves the app and widget project graph when round-tripping', () => {
  const original = xcode.project(projectPath).parseSync()
  const directory = mkdtempSync(resolve(tmpdir(), 'f1t-xcode-test-'))
  try {
    const copyPath = resolve(directory, 'project.pbxproj')
    writeFileSync(copyPath, original.writeSync())
    const copy = xcode.project(copyPath).parseSync()
    assert.deepEqual(copy.hash.project.objects, original.hash.project.objects)
    const names = Object.values(copy.pbxNativeTargetSection())
      .filter((value) => typeof value === 'object')
      .map((value) => value.name)
    assert.ok(names.includes('App'))
    assert.ok(names.includes('WidgetExtension'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
