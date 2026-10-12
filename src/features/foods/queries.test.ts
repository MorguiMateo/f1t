import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { foodKeys, invalidateFoodDay } from './queries'

describe('food cache invalidation', () => {
  it('invalidates only the edited day, preserving other history', async () => {
    const client = new QueryClient()
    client.setQueryData(foodKeys.day('2026-09-29'), { entries: [] })
    client.setQueryData(foodKeys.day('2026-09-28'), { entries: [] })
    await invalidateFoodDay(client, '2026-09-29')
    expect(client.getQueryState(foodKeys.day('2026-09-29'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(foodKeys.day('2026-09-28'))?.isInvalidated).toBe(false)
    client.clear()
  })
})
