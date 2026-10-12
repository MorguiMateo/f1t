import { foodCatalog, type FoodCatalogItem } from './catalog'
import { parseFoodQuantity, validFoodDate } from './diary'

export type FoodReference = Pick<FoodCatalogItem, 'source' | 'sourceCode' | 'basisUnit'>
export const foodReference = (food: FoodReference) => `${food.source}:${food.sourceCode}:${food.basisUnit}`
export type FoodDraft = {
  date: string; query: string; food: string | null; quantity: string
  usePortions: boolean; portionCount: string; portionSize: string; open: boolean
  pending: { amount: number; knownIDs: string[]; catalogVersion: string } | null
}
export type FoodPreferences = {
  favorites: string[]; recent: string[]; amounts: Record<string, number>
  portions: Record<string, number>; modes: Record<string, boolean>
}
const blankPreferences = (): FoodPreferences => ({ favorites: [], recent: [], amounts: {}, portions: {}, modes: {} })
export const newFoodDraft = (date: string): FoodDraft => ({ date, query: '', food: null, quantity: '', usePortions: false, portionCount: '1', portionSize: '', open: false, pending: null })

export function sameFoodDraft(a: FoodDraft, b: FoodDraft): boolean {
  const content = (value: FoodDraft) => JSON.stringify([value.date, value.query, value.food, value.quantity, value.usePortions,
    value.portionCount, value.portionSize, value.open, value.pending?.amount, value.pending?.catalogVersion, value.pending?.knownIDs])
  return content(a) === content(b)
}

/** Integer hundredths: reject unrepresentable products, never silently round. */
export function foodPortionAmount(count: string, size: number): number | null {
  const parsed = parseFoodQuantity(count)
  if (parsed === null || parseFoodQuantity(String(size)) === null) return null
  const product = Math.round(parsed * 100) * Math.round(size * 100)
  if (product % 100 !== 0) return null
  const amount = product / 10000
  return parseFoodQuantity(String(amount))
}
export function foodPortionCount(amount: number, size: number): number | null {
  if (parseFoodQuantity(String(amount)) === null || parseFoodQuantity(String(size)) === null) return null
  const dividend = Math.round(amount * 100) * 100
  const divisor = Math.round(size * 100)
  if (dividend % divisor !== 0) return null
  const count = dividend / divisor / 100
  return parseFoodQuantity(String(count)) !== null && foodPortionAmount(String(count), size) === amount ? count : null
}

export type FoodStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function browserStorage(kind: 'localStorage' | 'sessionStorage'): FoodStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window[kind] } catch { return undefined }
}
function read(storage: FoodStorage | undefined, key: string): unknown {
  try {
    const raw = storage?.getItem(key)
    return raw && raw.length <= 128000 ? JSON.parse(raw) : null
  } catch { return null }
}
type LocalRecord = { revision: number; memoryOnly: boolean; value?: unknown }
const recordsByStorage = new WeakMap<FoodStorage, Map<string, LocalRecord>>()
const recordsWithoutStorage = new Map<string, LocalRecord>()
function records(storage: FoodStorage | undefined): Map<string, LocalRecord> {
  if (!storage) return recordsWithoutStorage
  let value = recordsByStorage.get(storage)
  if (!value) { value = new Map(); recordsByStorage.set(storage, value) }
  return value
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validReference = (key: string) => /^OFF:\d{8,14}:(g|ml)$/.test(key)
const numbers = (value: unknown): Record<string, number> => object(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, amount]) => validReference(key) && typeof amount === 'number' && parseFoodQuantity(String(amount)) !== null ? [[key, amount] as const] : [])) : {}

/** Local UI data only; never store sessions, credentials, nutrition or historical targets. */
export class FoodLocalState {
  readonly owner: string | null
  private readonly preferencesStorage: FoodStorage | undefined
  private readonly draftsStorage: FoodStorage | undefined
  private readonly key: string
  private preferencesFallback: FoodPreferences = blankPreferences()
  private draftFallback: FoodDraft | null = null
  constructor(owner: string | null, preferencesStorage = browserStorage('localStorage'), draftsStorage = browserStorage('sessionStorage')) {
    this.owner = owner; this.preferencesStorage = preferencesStorage; this.draftsStorage = draftsStorage
    this.key = `f1t.food-ui.v1.${encodeURIComponent(owner ?? '')}`
  }
  private recordState(storage: FoodStorage | undefined, suffix: string): LocalRecord {
    const values = records(storage), key = this.key + suffix
    let value = values.get(key)
    if (!value) { value = { revision: 0, memoryOnly: !storage }; values.set(key, value) }
    return value
  }
  private saved(storage: FoodStorage | undefined, suffix: string): unknown {
    const state = this.recordState(storage, suffix)
    return state.memoryOnly ? state.value : read(storage, this.key + suffix)
  }
  private write(storage: FoodStorage | undefined, suffix: string, value: unknown) {
    if (!this.owner) return
    const state = this.recordState(storage, suffix)
    state.revision++
    state.value = structuredClone(value)
    try {
      if (!storage) throw new Error('Storage unavailable')
      storage.setItem(this.key + suffix, JSON.stringify(value))
      state.memoryOnly = false
    } catch {
      // The current value remains authoritative even if an older JSON value is
      // still readable. Share this fallback with subsequent mounts for this owner.
      state.memoryOnly = true
      try { storage?.removeItem(this.key + suffix) } catch { /* Reads still use the memory value. */ }
    }
  }
  persistenceStatus() {
    return {
      draft: !!this.owner && !this.recordState(this.draftsStorage, '.draft').memoryOnly,
      preferences: !!this.owner && !this.recordState(this.preferencesStorage, '.preferences').memoryOnly,
    }
  }
  draftRevision(): number { return this.recordState(this.draftsStorage, '.draft').revision }
  preferences(): FoodPreferences {
    const saved = this.owner ? this.saved(this.preferencesStorage, '.preferences') : null
    if (!object(saved)) return structuredClone(this.preferencesFallback)
    const references = (value: unknown, limit: number) => Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === 'string' && validReference(key)))].slice(0, limit) : []
    return {
      favorites: references(saved.favorites, 200), recent: references(saved.recent, 12),
      amounts: numbers(saved.amounts), portions: numbers(saved.portions),
      modes: object(saved.modes) ? Object.fromEntries(Object.entries(saved.modes).flatMap(([key, value]) => validReference(key) && typeof value === 'boolean' ? [[key, value] as const] : [])) : {},
    }
  }
  savePreferences(value: FoodPreferences) { if (!this.owner) return; this.preferencesFallback = structuredClone(value); this.write(this.preferencesStorage, '.preferences', value) }
  draft(today: string): FoodDraft {
    const saved = this.owner ? this.saved(this.draftsStorage, '.draft') : null
    if (!object(saved)) return this.draftFallback ? structuredClone(this.draftFallback) : newFoodDraft(today)
    const text = (field: string, fallback = '') => typeof saved[field] === 'string' ? (saved[field] as string).slice(0, 200) : fallback
    const pending = object(saved.pending) && typeof saved.pending.amount === 'number' && parseFoodQuantity(String(saved.pending.amount)) !== null && typeof saved.pending.catalogVersion === 'string' && saved.pending.catalogVersion.length <= 100 && Array.isArray(saved.pending.knownIDs) ? { amount: saved.pending.amount, catalogVersion: saved.pending.catalogVersion, knownIDs: saved.pending.knownIDs.filter((id): id is string => typeof id === 'string' && id.length <= 100).slice(0, 10000) } : null
    const reference = typeof saved.food === 'string' && foodCatalog.some(food => foodReference(food) === saved.food) ? saved.food : null
    return {
      date: validFoodDate(text('date')) ? text('date') : today, query: text('query'), food: reference,
      quantity: reference ? text('quantity') : '', usePortions: reference !== null && saved.usePortions === true,
      portionCount: text('portionCount', '1'), portionSize: reference ? text('portionSize') : '', open: saved.open === true || !!pending, pending: reference ? pending : null,
    }
  }
  saveDraft(value: FoodDraft) { if (!this.owner) return; this.draftFallback = structuredClone(value); this.write(this.draftsStorage, '.draft', value) }
  /** Late completions must not erase a newer draft created after navigation. */
  clearRegisteredDraft(attempt: FoodDraft) {
    const saved = this.draft(attempt.date)
    if (sameFoodDraft(saved, attempt)) this.saveDraft({ ...attempt, food: null, quantity: '', portionSize: '', pending: null })
  }
  record(food: FoodReference, amount: number) {
    if (!this.owner || parseFoodQuantity(String(amount)) === null) return
    const value = this.preferences(), key = foodReference(food)
    value.amounts[key] = amount; value.recent = [key, ...value.recent.filter(id => id !== key)].slice(0, 12)
    this.savePreferences(value)
  }
}
