import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { foodCatalog } from './catalog'
import { FoodLocalState, foodPortionAmount, foodPortionCount, foodReference, newFoodDraft, type FoodStorage } from './local-state'

function memoryStorage(): FoodStorage {
  const values = new Map<string, string>()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12)) })
afterEach(() => vi.useRealTimers())

describe('food local UI state', () => {
  it('preserves the destination and draft on navigation/remount, separately for every account', () => {
    const storage = memoryStorage(), a = new FoodLocalState('a', storage, storage), b = new FoodLocalState('b', storage, storage)
    const draft = { ...newFoodDraft('2026-10-09'), food: foodReference(foodCatalog[0]), quantity: '125,5', query: 'avena', open: true }
    a.saveDraft(draft)
    expect(new FoodLocalState('a', storage, storage).draft('2026-10-10')).toEqual(draft)
    expect(b.draft('2026-10-10')).toEqual(newFoodDraft('2026-10-10'))
    a.saveDraft({ ...draft, date: '2026-10-10' })
    expect(a.draft('2026-10-10')).toMatchObject({ date: '2026-10-10', quantity: '125,5', food: draft.food })
    expect(b.draft('2026-10-10').quantity).toBe('')
    expect(a.draft('2026-10-10')).not.toHaveProperty('acceptNoTarget')
    expect(new FoodLocalState(null, storage, storage).draft('2026-10-10').food).toBeNull()
  })
  it('never reinterprets saved quantities, favorites, portions or mode across g/ml', () => {
    const storage = memoryStorage(), local = new FoodLocalState('a', storage, storage)
    const food = foodCatalog[0], key = foodReference(food), revised = { ...food, basisUnit: 'ml' as const }
    local.record(food, 45)
    local.savePreferences({ ...local.preferences(), favorites: [key], portions: { [key]: 30 }, modes: { [key]: true } })
    const restored = new FoodLocalState('a', storage, storage).preferences()
    expect(restored.amounts[key]).toBe(45)
    expect(restored.portions[key]).toBe(30)
    expect(restored.modes[key]).toBe(true)
    expect(restored.favorites).not.toContain(foodReference(revised))
    expect(restored.amounts[foodReference(revised)]).toBeUndefined()
    expect(restored.portions[foodReference(revised)]).toBeUndefined()
    expect(new FoodLocalState('b', storage, storage).preferences().recent).toEqual([])
    local.saveDraft({ ...newFoodDraft('2026-10-10'), food: foodReference(revised), quantity: '45' })
    expect(local.draft('2026-10-10').food).toBeNull()
    expect(local.draft('2026-10-10').quantity).toBe('')
  })
  it('keeps unconfirmed attempts through remount and does not erase a newer draft on late success', () => {
    const storage = memoryStorage(), local = new FoodLocalState('a', storage, storage)
    const attempt = { ...newFoodDraft('2026-10-09'), food: foodReference(foodCatalog[0]), quantity: '100', pending: { amount: 100, knownIDs: ['existing'], catalogVersion: foodCatalog[0].catalogVersion } }
    local.saveDraft(attempt)
    expect(new FoodLocalState('a', storage, storage).draft('2026-10-10').pending).toEqual(attempt.pending)
    local.saveDraft({ ...attempt, date: '2026-10-10', quantity: '200', pending: null })
    local.clearRegisteredDraft(attempt)
    expect(local.draft('2026-10-10').quantity).toBe('200')
    local.saveDraft(attempt); const remounted = new FoodLocalState('a', storage, storage); remounted.clearRegisteredDraft(remounted.draft('2026-10-10'))
    expect(local.draft('2026-10-10')).toMatchObject({ date: '2026-10-09', food: null, quantity: '', pending: null })
  })
  it('handles damaged/blocked storage without preventing registration', () => {
    const blocked: FoodStorage = { getItem: () => '{bad json', setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    const local = new FoodLocalState('a', blocked, blocked)
    expect(local.draft('2026-10-10')).toEqual(newFoodDraft('2026-10-10'))
    expect(() => local.record(foodCatalog[0], 100)).not.toThrow()
    local.saveDraft({ ...newFoodDraft('2026-10-09'), food: foodReference(foodCatalog[0]), quantity: '100' })
    expect(local.draft('2026-10-10').date).toBe('2026-10-09')
    expect(local.preferences().amounts[foodReference(foodCatalog[0])]).toBe(100)
  })
})

describe('exact custom portions', () => {
  it('supports decimal comma and reversible portions without rounding', () => {
    expect(foodPortionAmount('1,5', 30)).toBe(45)
    expect(foodPortionCount(45, 30)).toBe(1.5)
    expect(foodPortionAmount('0,5', 0.02)).toBe(0.01)
    expect(foodPortionAmount('0,33', 0.33)).toBeNull()
    expect(foodPortionCount(100, 30)).toBeNull()
    expect(foodPortionAmount('2', 3000)).toBeNull()
    expect(foodPortionCount(5000, 0.01)).toBeNull()
    for (const value of ['0', '-1', 'NaN', '1e3', '1.234']) expect(foodPortionAmount(value, 30)).toBeNull()
    for (const size of [0, -1, NaN, Infinity, 0.333]) expect(foodPortionAmount('1', size)).toBeNull()
  })
})

describe('quota failures with pre-existing stored UI data', () => {
  it.each([false, true])('uses the newest account-scoped memory value even if old JSON remains readable (removeFails=%s)', removeFails => {
    const values = new Map<string, string>()
    let quota = false
    const storage: FoodStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { if (quota) throw new Error('quota'); values.set(key, value) },
      removeItem: key => { if (removeFails) throw new Error('blocked'); values.delete(key) },
    }
    const a = new FoodLocalState('a', storage, storage), b = new FoodLocalState('b', storage, storage)
    const ref = foodReference(foodCatalog[0]), second = foodReference(foodCatalog[1])
    const old = { ...newFoodDraft('2026-10-09'), food: ref, quantity: '100', open: true, pending: { amount: 100, knownIDs: [], catalogVersion: foodCatalog[0].catalogVersion } }
    a.saveDraft(old); a.savePreferences({ ...a.preferences(), favorites: [ref], portions: { [ref]: 30 } })
    b.saveDraft({ ...newFoodDraft('2026-10-10'), food: second, quantity: '99' })
    b.record(foodCatalog[1], 99)
    const bBefore = b.draft('2026-10-10'), bPreferences = b.preferences()
    quota = true
    const newer = { ...old, date: '2026-10-10', food: second, quantity: '250', pending: null }
    const newPreferences = { ...a.preferences(), favorites: [second], portions: { [second]: 40 }, modes: { [second]: true } }
    a.saveDraft(newer); a.savePreferences(newPreferences)
    expect(a.draft('2026-10-10')).toEqual(newer)
    expect(a.preferences()).toEqual(newPreferences)
    expect(a.persistenceStatus()).toEqual({ draft: false, preferences: false })
    const remounted = new FoodLocalState('a', storage, storage)
    expect(remounted.draft('2026-10-10')).toEqual(newer)
    expect(remounted.preferences()).toEqual(newPreferences)
    expect(b.draft('2026-10-10')).toEqual(bBefore)
    expect(b.preferences()).toEqual(bPreferences)
    expect(b.persistenceStatus()).toEqual({ draft: true, preferences: true })
    if (!removeFails) expect(values.has('f1t.food-ui.v1.a.draft')).toBe(false)
    else expect(JSON.parse(values.get('f1t.food-ui.v1.a.draft')!).quantity).toBe('100')
    // An explicit discard cannot bring back the old pending registration.
    const discarded = { ...newer, food: null, quantity: '', pending: null }
    remounted.saveDraft(discarded)
    expect(a.draft('2026-10-10')).toEqual(discarded)
    expect(new FoodLocalState('a', storage, storage).draft('2026-10-10')).toEqual(discarded)
    // A confirmed registration must also stay cleared after a failed write.
    remounted.saveDraft(old); remounted.clearRegisteredDraft(remounted.draft('2026-10-10'))
    expect(new FoodLocalState('a', storage, storage).draft('2026-10-10')).toMatchObject({ food: null, quantity: '', pending: null })
    expect(new FoodLocalState(null, storage, storage).draft('2026-10-10').food).toBeNull()
    // A later successful write restores the honest persistence status.
    quota = false
    a.saveDraft(discarded); a.savePreferences(newPreferences)
    expect(a.persistenceStatus()).toEqual({ draft: true, preferences: true })
    expect(new FoodLocalState('a', storage, storage).draft('2026-10-10')).toEqual(discarded)
  })
})
