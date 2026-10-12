import type { FoodDayDetail } from './api'
import { foodCatalog } from './catalog'
import { FoodLocalState, foodReference, sameFoodDraft, type FoodDraft } from './local-state'

type CheckResult = { data?: FoodDayDetail; error?: unknown }
export type FoodDraftCheckpoint = { draft: FoodDraft; revision: number; generation: number }
export type FoodReconciliationResult = { status: 'found' | 'missing' | 'failed'; draft: FoodDraft }

/** One mounted editor lifetime. Auth generation and per-owner draft revision are
 * checked before every reconciliation side effect, not merely when a GET starts. */
export class FoodDraftSession {
  private generation = 0
  private active = true
  private checkSequence = 0
  readonly local: FoodLocalState
  private readonly isAuthCurrent: () => boolean
  constructor(local: FoodLocalState, isAuthCurrent: () => boolean) {
    this.local = local; this.isAuthCurrent = isAuthCurrent
  }
  start() { this.active = true; this.generation++ }
  cancel() { this.active = false; this.generation++; this.checkSequence++ }
  checkpoint(today: string): FoodDraftCheckpoint {
    return { draft: this.local.draft(today), revision: this.local.draftRevision(), generation: this.generation }
  }
  isCurrent(checkpoint: FoodDraftCheckpoint): boolean {
    return this.active && this.isAuthCurrent() && this.generation === checkpoint.generation &&
      this.local.draftRevision() === checkpoint.revision && sameFoodDraft(this.local.draft(checkpoint.draft.date), checkpoint.draft)
  }
  update(patch: Partial<FoodDraft>, today: string): FoodDraft {
    const next = { ...this.local.draft(today), ...patch }
    this.local.saveDraft(next)
    return next
  }
  async reconcile(today: string, readDay: () => Promise<CheckResult>, apply: (result: FoodReconciliationResult) => void): Promise<void> {
    const checkpoint = this.checkpoint(today), attempt = checkpoint.draft, pending = attempt.pending
    const food = foodCatalog.find(food => foodReference(food) === attempt.food)
    if (!pending || !food || !this.active || !this.isAuthCurrent()) return
    const sequence = ++this.checkSequence
    const isCurrent = () => this.checkSequence === sequence && this.isCurrent(checkpoint)
    let result: CheckResult
    try { result = await readDay() } catch (error) { result = { error } }
    if (!isCurrent()) return
    if (result.error || !result.data) { apply({ status: 'failed', draft: this.local.draft(today) }); return }
    const found = result.data.entries.some(entry => entry.user_id === this.local.owner && entry.logged_on === attempt.date &&
      !pending.knownIDs.includes(entry.id) && entry.source === food.source && entry.source_code === food.sourceCode &&
      entry.basis_unit === food.basisUnit && entry.quantity === pending.amount && entry.catalog_version === pending.catalogVersion)
    // No await between this guard and the updates: a discard/date/account change
    // cannot interleave with recording a confirmation or releasing this attempt.
    if (found) {
      this.local.record(food, pending.amount)
      this.local.clearRegisteredDraft(attempt)
    } else {
      this.update({ pending: null }, today)
    }
    apply({ status: found ? 'found' : 'missing', draft: this.local.draft(today) })
  }
}
