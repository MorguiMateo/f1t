import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FoodDayDetail, FoodEntry } from './api'
import { foodCatalog, type FoodCatalogItem } from './catalog'
import { FoodLocalState, foodReference, newFoodDraft, type FoodStorage } from './local-state'
import { FoodDraftSession } from './reconciliation'
import { createAuthQueryClient, isAuthQueryClientActive, setAuthQueryIdentity } from '../auth/auth-query-client'

const today = '2026-10-10', date = '2026-10-09'
function fixture() {
  const values = new Map<string, string>()
  const storage: FoodStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } }
  const local = new FoodLocalState('a', storage, storage), food = foodCatalog[0]
  local.saveDraft({ ...newFoodDraft(date), food: foodReference(food), quantity: '100', open: true, pending: { amount: 100, knownIDs: ['old'], catalogVersion: food.catalogVersion } })
  setAuthQueryIdentity('a')
  const client = createAuthQueryClient()
  const session = new FoodDraftSession(local, () => isAuthQueryClientActive(client))
  session.start()
  let resolve!: (result: { data?: FoodDayDetail; error?: Error }) => void
  const response = new Promise<{ data?: FoodDayDetail; error?: Error }>(complete => { resolve = complete })
  return { local, food, session, resolve, read: vi.fn(() => response), apply: vi.fn(), storage }
}
function entry(food: FoodCatalogItem, owner = 'a', logged_on = date): FoodEntry {
  return { id: 'new', user_id: owner, logged_on, created_at: '', source: food.source,
    catalog_version: food.catalogVersion, source_code: food.sourceCode, source_revision: food.sourceRevision,
    source_url: food.sourceUrl, source_retrieved_at: food.sourceRetrievedAt, source_response_sha256: food.sourceResponseSha256,
    reviewed_at: food.reviewedAt, food_name: food.name, brand: food.brand, basis_unit: food.basisUnit,
    quantity: 100, energy_kcal_per_100: food.energyKcalPer100, kcal: food.energyKcalPer100 }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12)) })
afterEach(() => { vi.useRealTimers(); setAuthQueryIdentity(null) })

describe('pending food reconciliation races', () => {
  it.each([false, true])('does not restore the old attempt after discard/new selection (found=%s)', async found => {
    const f = fixture(), check = f.session.reconcile(today, f.read, f.apply)
    f.session.update({ food: null, quantity: '', portionSize: '', pending: null }, today)
    const next = f.session.update({ date: today, food: foodReference(foodCatalog[1]), quantity: '250', pending: null }, today)
    f.resolve({ data: { day: null, entries: found ? [entry(f.food)] : [] } })
    await check
    expect(f.local.draft(today)).toEqual(next)
    expect(f.local.preferences().recent).toEqual([])
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.read).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])('does not resurrect an explicitly discarded draft (found=%s)', async found => {
    const f = fixture(), check = f.session.reconcile(today, f.read, f.apply)
    const discarded = f.session.update({ food: null, quantity: '', pending: null }, today)
    f.resolve({ data: { day: null, entries: found ? [entry(f.food)] : [] } })
    await check
    expect(f.local.draft(today)).toEqual(discarded)
    expect(f.apply).not.toHaveBeenCalled()
  })
  it.each([false, true])('cancels both success/missing results after unmount or account-generation change (found=%s)', async found => {
    for (const change of ['unmount', 'auth'] as const) {
      const f = fixture(), before = f.local.draft(today)
      const check = f.session.reconcile(today, f.read, f.apply)
      if (change === 'unmount') { f.session.cancel(); f.session.start() }
      else { setAuthQueryIdentity('b'); setAuthQueryIdentity('a') }
      f.resolve({ data: { day: null, entries: found ? [entry(f.food)] : [] } })
      await check
      expect(f.local.draft(today)).toEqual(before)
      expect(f.local.preferences().recent).toEqual([])
      expect(f.apply).not.toHaveBeenCalled()
    }
  })
  it('ignores a failed GET when a newer draft has already replaced the attempt', async () => {
    const f = fixture(), check = f.session.reconcile(today, f.read, f.apply)
    const next = f.session.update({ food: null, quantity: '', pending: null }, today)
    f.resolve({ error: new Error('offline') }); await check
    expect(f.local.draft(today)).toEqual(next)
    expect(f.apply).not.toHaveBeenCalled()
  })
  it('rejects an identical replacement attempt by revision, including a newer mount', async () => {
    const f = fixture(), check = f.session.reconcile(today, f.read, f.apply)
    const remounted = new FoodLocalState('a', f.storage, f.storage)
    remounted.saveDraft(remounted.draft(today))
    f.resolve({ data: { day: null, entries: [entry(f.food)] } }); await check
    expect(remounted.draft(today).pending).not.toBeNull()
    expect(f.apply).not.toHaveBeenCalled()
  })
  it.each([false, true])('applies a current result once without sending any food (found=%s)', async found => {
    const f = fixture(), check = f.session.reconcile(today, f.read, f.apply)
    f.resolve({ data: { day: null, entries: found ? [entry(f.food)] : [] } }); await check
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.apply.mock.calls[0][0].status).toBe(found ? 'found' : 'missing')
    expect(f.local.draft(today).pending).toBeNull()
    expect(f.local.draft(today).food).toBe(found ? null : foodReference(f.food))
    expect(f.local.preferences().recent).toEqual(found ? [foodReference(f.food)] : [])
    expect(f.read).toHaveBeenCalledTimes(1)
  })
  it('does not confirm a matching row from another owner or date', async () => {
    const f = fixture(), check = f.session.reconcile(today, f.read, f.apply)
    f.resolve({ data: { day: null, entries: [entry(f.food, 'b'), entry(f.food, 'a', today)] } }); await check
    expect(f.apply.mock.calls[0][0].status).toBe('missing')
    expect(f.local.preferences().recent).toEqual([])
  })
})
