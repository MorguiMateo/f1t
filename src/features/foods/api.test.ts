import { beforeEach, describe, expect, it, vi } from 'vitest'
import { foodCatalog } from './catalog'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc, from } }))
import { deleteFood, fetchFoodDay, FOOD_ENTRY_PAGE_SIZE, logFood, setFoodQuantity } from './api'

const date = '2026-09-29'
const food = foodCatalog[0]

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('food RPC boundary', () => {
  it('sends source/catalog and target snapshots but never an owner id or client kcal', async () => {
    rpc.mockResolvedValue({ data: { id: 'entry-1' }, error: null })
    await logFood({ date, food, quantity: 125.5, energy: { targetKcal: 2000, tdeeKcal: 2450 } })
    expect(rpc).toHaveBeenCalledWith('log_food_entry', expect.objectContaining({
      p_logged_on: date, p_catalog_version: food.catalogVersion,
      p_source_code: food.sourceCode, p_quantity: 125.5,
      p_energy_kcal_per_100: food.energyKcalPer100,
      p_target_kcal: 2000, p_tdee_kcal: 2450,
    }))
    const args = rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('user_id')
    expect(args).not.toHaveProperty('kcal')
  })

  it('accepts no calculable target and rejects bad quantity before network', async () => {
    rpc.mockResolvedValue({ data: { id: 'entry-1' }, error: null })
    await logFood({ date, food, quantity: 1, energy: { targetKcal: null, tdeeKcal: null } })
    expect(rpc.mock.calls[0][1].p_target_kcal).toBeNull()
    rpc.mockClear()
    await expect(logFood({ date, food, quantity: 0, energy: { targetKcal: null, tdeeKcal: null } })).rejects.toThrow()
    await expect(setFoodQuantity({ id: 'entry-1', quantity: -1 })).rejects.toThrow()
    await expect(logFood({ date, food, quantity: 1, energy: { targetKcal: 2000, tdeeKcal: null } })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses owner-checked RPCs rather than direct table writes for edits and deletes', async () => {
    rpc.mockResolvedValue({ data: { id: 'entry-1' }, error: null })
    await setFoodQuantity({ id: 'entry-1', quantity: 50 })
    await deleteFood('entry-1')
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(['set_food_entry_quantity', 'delete_food_entry'])
  })

  it('loads all entries beyond PostgREST default 1000 rows for an authoritative day total', async () => {
    const all = Array.from({ length: 1001 }, (_, index) => ({ id: `entry-${index}`, kcal: 1 }))
    const ranges: [number, number][] = []
    const entriesQuery = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(),
      range: vi.fn((start: number, end: number) => {
        ranges.push([start, end])
        return Promise.resolve({ data: all.slice(start, end + 1), error: null })
      }),
    }
    entriesQuery.select.mockReturnValue(entriesQuery)
    entriesQuery.eq.mockReturnValue(entriesQuery)
    entriesQuery.order.mockReturnValue(entriesQuery)
    const dayQuery = {
      select: vi.fn(), eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { logged_on: date }, error: null }),
    }
    dayQuery.select.mockReturnValue(dayQuery)
    dayQuery.eq.mockReturnValue(dayQuery)
    from.mockImplementation((table: string) => table === 'food_days' ? dayQuery : entriesQuery)

    const result = await fetchFoodDay(date)
    expect(result.entries).toHaveLength(1001)
    expect(result.entries.reduce((sum, entry) => sum + entry.kcal, 0)).toBe(1001)
    expect(ranges).toEqual([
      [0, FOOD_ENTRY_PAGE_SIZE - 1],
      [FOOD_ENTRY_PAGE_SIZE, FOOD_ENTRY_PAGE_SIZE * 2 - 1],
      [FOOD_ENTRY_PAGE_SIZE * 2, FOOD_ENTRY_PAGE_SIZE * 3 - 1],
    ])
    expect(entriesQuery.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(entriesQuery.order).toHaveBeenCalledWith('id', { ascending: true })
  })
})
