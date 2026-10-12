import { describe, expect, it } from 'vitest'
import { energySnapshot, foodKcal, MAX_DAY_ENERGY_KCAL, parseFoodQuantity, resolveFoodSnapshot, targetComparison, validDayEnergySnapshot, validFoodDate } from './diary'

describe('food diary calculations and local dates', () => {
  it('uses canonical g/ml quantities and keeps decimal kcal until presentation', () => {
    expect(foodKcal(37.5, 123.4)).toBeCloseTo(46.275, 8)
    expect(foodKcal(250, 42)).toBe(105)
    expect(parseFoodQuantity('37,50')).toBe(37.5)
    expect(parseFoodQuantity('0,01')).toBe(0.01)
    for (const text of ['', '0', '-1', '5000.01', '1.234', 'Infinity', 'NaN', '1e3']) {
      expect(parseFoodQuantity(text)).toBeNull()
    }
  })

  it('takes the existing energyReport target without exercise add-back', () => {
    const snapshot = energySnapshot({
      status: 'ready', bmi: { value: 24, category: 'normal' }, bmr: 1600,
      activity: { factor: 1.55, label: 'moderada', daysPerWeek: 3, sessions: 12 },
      tdee: 2480, target: { kcal: 2000, adjustment: -500, clamped: false }, goal: 'lose',
    })
    expect(snapshot).toEqual({ targetKcal: 2000, tdeeKcal: 2480 })
    expect(targetComparison(1750.25, snapshot.targetKcal)).toBe(249.75)
    expect(targetComparison(2100, snapshot.targetKcal)).toBe(-100)
    expect(energySnapshot({ status: 'missing', missing: ['weight'], bmi: null })).toEqual({ targetKcal: null, tdeeKcal: null })
    expect(energySnapshot({
      status: 'ready', bmi: { value: 2, category: 'underweight' }, bmr: -10,
      activity: { factor: 1.2, label: 'sedentaria', daysPerWeek: 0, sessions: 0 },
      tdee: -12, target: { kcal: -10, adjustment: 0, clamped: true }, goal: 'maintain',
    })).toEqual({ targetKcal: null, tdeeKcal: null })
    expect(targetComparison(100, null)).toBeNull()
  })

  it('requires an explicit bypass on energy query failure, then preserves a historical snapshot', () => {
    expect(resolveFoodSnapshot(null, null, true, false)).toBeNull()
    expect(resolveFoodSnapshot(null, null, true, true)).toEqual({ targetKcal: null, tdeeKcal: null })
    expect(resolveFoodSnapshot(null, null, false, true)).toBeNull()
    const historical = { targetKcal: 1800, tdeeKcal: 2300 }
    expect(resolveFoodSnapshot(historical, null, true, false)).toBe(historical)
    expect(resolveFoodSnapshot({ targetKcal: null, tdeeKcal: null }, null, true, false))
      .toEqual({ targetKcal: null, tdeeKcal: null })
  })

  it('mirrors the 11000 kcal SQL cap and pair invariant', () => {
    expect(MAX_DAY_ENERGY_KCAL).toBe(11000)
    expect(validDayEnergySnapshot({ targetKcal: 11000, tdeeKcal: 10697 })).toBe(true)
    expect(validDayEnergySnapshot({ targetKcal: null, tdeeKcal: null })).toBe(true)
    expect(validDayEnergySnapshot({ targetKcal: 11001, tdeeKcal: 10697 })).toBe(false)
    expect(validDayEnergySnapshot({ targetKcal: 2000, tdeeKcal: null })).toBe(false)
  })

  it('rejects impossible and future local dates without UTC parsing', () => {
    const now = new Date(2026, 8, 29, 0, 5)
    expect(validFoodDate('2026-09-29', now)).toBe(true)
    expect(validFoodDate('2026-09-28', now)).toBe(true)
    expect(validFoodDate('2026-09-30', now)).toBe(false)
    expect(validFoodDate('2026-02-29', now)).toBe(false)
    expect(validFoodDate('2024-02-29', now)).toBe(true)
    expect(validFoodDate('2026-13-01', now)).toBe(false)
  })
})
