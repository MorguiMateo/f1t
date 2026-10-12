import { describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => ({
  gte: vi.fn(), lte: vi.fn(), gt: vi.fn(), select: vi.fn(), from: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from: query.from } }))
import { fetchEnergySessionDays } from './api'

describe('energy session window', () => {
  it('queries exactly 28 local dates across a month boundary', async () => {
    query.from.mockReturnValue(query)
    query.select.mockReturnValue(query)
    query.gte.mockReturnValue(query)
    query.lte.mockReturnValue(query)
    query.gt.mockResolvedValue({ data: [{ performed_on: '2026-03-01' }], error: null })
    expect(await fetchEnergySessionDays('2026-03-01')).toEqual([{ performed_on: '2026-03-01' }])
    expect(query.from).toHaveBeenCalledWith('sessions')
    expect(query.gte).toHaveBeenCalledWith('performed_on', '2026-02-02')
    expect(query.lte).toHaveBeenCalledWith('performed_on', '2026-03-01')
    expect(query.gt).toHaveBeenCalledWith('set_count', 0)
  })
})
