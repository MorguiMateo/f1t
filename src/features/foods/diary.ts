import { fromDateKey, toDateKey } from '../../lib/heatmap'
import type { EnergyReport } from '../body/energy'
import type { FoodCatalogItem } from './catalog'

export const MAX_FOOD_QUANTITY = 5000
/** Maximum energyReport target from the permitted profile ranges; mirrored in SQL. */
export const MAX_DAY_ENERGY_KCAL = 11000

export function parseFoodQuantity(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(text)) return null
  const quantity = Number(text)
  return Number.isFinite(quantity) && quantity > 0 && quantity <= MAX_FOOD_QUANTITY ? quantity : null
}

export function validFoodDate(key: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = fromDateKey(key)
  return toDateKey(date) === key && key <= toDateKey(today)
}

export function foodKcal(quantity: number, kcalPer100: number): number {
  return quantity * kcalPer100 / 100
}

export type DayEnergySnapshot = { targetKcal: number | null; tdeeKcal: number | null }

export function validDayEnergySnapshot(snapshot: DayEnergySnapshot): boolean {
  if (snapshot.targetKcal === null || snapshot.tdeeKcal === null) {
    return snapshot.targetKcal === null && snapshot.tdeeKcal === null
  }
  return Number.isFinite(snapshot.targetKcal) && Number.isFinite(snapshot.tdeeKcal) &&
    snapshot.targetKcal > 0 && snapshot.targetKcal <= MAX_DAY_ENERGY_KCAL &&
    snapshot.tdeeKcal > 0 && snapshot.tdeeKcal <= MAX_DAY_ENERGY_KCAL
}

export function energySnapshot(report: EnergyReport): DayEnergySnapshot {
  return report.status === 'ready' && validDayEnergySnapshot({ targetKcal: report.target.kcal, tdeeKcal: report.tdee })
    ? { targetKcal: report.target.kcal, tdeeKcal: report.tdee }
    : { targetKcal: null, tdeeKcal: null }
}

/** A failed energy lookup may be bypassed only by an explicit choice. */
export function resolveFoodSnapshot(
  existing: DayEnergySnapshot | null,
  report: EnergyReport | null,
  energyFailed: boolean,
  acceptNoTarget: boolean,
): DayEnergySnapshot | null {
  if (existing) return existing
  if (report) return energySnapshot(report)
  if (energyFailed && acceptNoTarget) return { targetKcal: null, tdeeKcal: null }
  return null
}

export function targetComparison(consumedKcal: number, targetKcal: number | null): number | null {
  return targetKcal === null ? null : targetKcal - consumedKcal
}

export function productLabel(food: FoodCatalogItem): string {
  return `${food.energyKcalPer100} kcal / 100 ${food.basisUnit}`
}
