import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Execute the production pure presentation rules, without permissions, an account,
// a simulator or a project-file edit. The rest of each file requires SwiftUI/iOS.
test('native Today preserves session identity and reminder scheduling truth', () => {
  const today = readFileSync(new URL('../ios/App/Native/native-today-views.swift', import.meta.url), 'utf8')
  const device = readFileSync(new URL('../ios/App/Native/native-device.swift', import.meta.url), 'utf8')
  const todayRules = today.slice(today.indexOf('enum NativeTodaySelection {'), today.indexOf('struct NativeTodayRoutine:'))
  const reminderRules = device.slice(device.indexOf('enum NativeReminderState:'), device.indexOf('@MainActor'))
  const directory = mkdtempSync(join(tmpdir(), 'f1t-today-ux-'))
  try {
    const source = join(directory, 'main.swift')
    writeFileSync(source, `${todayRules}\n${reminderRules}\n
      func expect(_ condition: Bool, _ message: String) { precondition(condition, message) }
      expect(NativeTodaySelection.dayID(hasSession: true, sessionDayID: "legs", scheduledDayID: "push") == "legs", "Session beats calendar")
      expect(NativeTodaySelection.dayID(hasSession: true, sessionDayID: nil, scheduledDayID: "push") == nil, "Unlinked session is not replaced")
      expect(NativeTodaySelection.dayID(hasSession: false, sessionDayID: nil, scheduledDayID: "push") == "push", "Calendar before session")
      expect(!NativeTodaySelection.showScheduledPlan(activeDate: "2026-10-10", activeDayID: "legs", dateKey: "2026-10-10", scheduledDayID: "legs"), "One primary entry for same plan")
      expect(NativeTodaySelection.showScheduledPlan(activeDate: "2026-10-09", activeDayID: "legs", dateKey: "2026-10-10", scheduledDayID: "legs"), "Previous-date workout preserves today's secondary plan")
      expect(NativeTodaySelection.showScheduledPlan(activeDate: "2026-10-10", activeDayID: "legs", dateKey: "2026-10-10", scheduledDayID: "push"), "Different day retains a secondary plan")
      func state(enabled: Bool = true, loaded: Bool = true, hasDays: Bool = true, known: Bool = true, allowed: Bool = true, blocked: Bool = false, scheduling: Bool = false, scheduled: Bool = true) -> NativeReminderState {
        NativeReminderState.resolve(enabled: enabled, loaded: loaded, hasDays: hasDays, permissionKnown: known, allowed: allowed, blocked: blocked, scheduling: scheduling, scheduled: scheduled)
      }
      expect(state(enabled: false) == .disabled, "Saved toggle off is disabled")
      expect(state(loaded: false) == .waiting, "Missing data is not no-days")
      expect(state(hasDays: false) == .noDays, "No days cannot mean scheduled")
      expect(state(known: false) == .waiting, "Unknown permission cannot mean scheduled")
      expect(state(allowed: false, blocked: true) == .blocked, "Denied permission cannot mean active")
      expect(state(allowed: false) == .permissionNeeded, "Undetermined permission needs explicit activation")
      expect(state(scheduling: true, scheduled: false) == .scheduling, "Await notification center confirmation")
      expect(state(scheduled: false) == .failed, "A failed add is not a scheduled reminder")
      expect(state() == .scheduled, "Only successful authorized scheduling is scheduled")
    `)
    const result = spawnSync('swift', [source], { encoding: 'utf8', timeout: 60_000 })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
