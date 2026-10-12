import type { Tables } from '../../lib/database.types'
import { unwrap, unwrapRow } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { FoodCatalogItem } from './catalog'
import { parseFoodQuantity, validDayEnergySnapshot, validFoodDate, type DayEnergySnapshot } from './diary'

export type FoodDay = Tables<'food_days'>
export type FoodEntry = Tables<'food_entries'>
export type FoodDayDetail = { day: FoodDay | null; entries: FoodEntry[] }

/** Below PostgREST's default 1,000-row cap; fetch every page for a correct total. */
export const FOOD_ENTRY_PAGE_SIZE = 500

export async function fetchFoodDay(date: string): Promise<FoodDayDetail> {
  if (!validFoodDate(date)) throw new Error('Fecha de diario inválida.')
  const day = unwrap(await supabase.from('food_days').select('*').eq('logged_on', date).maybeSingle())
  const entries: FoodEntry[] = []
  for (let offset = 0; ; offset += FOOD_ENTRY_PAGE_SIZE) {
    const page = unwrap(await supabase.from('food_entries').select('*').eq('logged_on', date)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + FOOD_ENTRY_PAGE_SIZE - 1)) ?? []
    entries.push(...page)
    if (page.length < FOOD_ENTRY_PAGE_SIZE) break
  }
  return { day, entries }
}

export async function logFood(input: {
  date: string; food: FoodCatalogItem; quantity: number; energy: DayEnergySnapshot
}): Promise<FoodEntry> {
  const { date, food, quantity, energy } = input
  if (!validFoodDate(date) || parseFoodQuantity(String(quantity)) === null || !validDayEnergySnapshot(energy)) {
    throw new Error('Fecha, cantidad u objetivo inválido.')
  }
  return unwrapRow(await supabase.rpc('log_food_entry', {
    p_logged_on: date,
    p_target_kcal: energy.targetKcal,
    p_tdee_kcal: energy.tdeeKcal,
    p_catalog_version: food.catalogVersion,
    p_source_code: food.sourceCode,
    p_source_revision: food.sourceRevision,
    p_source_url: food.sourceUrl,
    p_source_retrieved_at: food.sourceRetrievedAt,
    p_source_response_sha256: food.sourceResponseSha256,
    p_reviewed_at: food.reviewedAt,
    p_food_name: food.name,
    p_brand: food.brand,
    p_basis_unit: food.basisUnit,
    p_quantity: quantity,
    p_energy_kcal_per_100: food.energyKcalPer100,
  }))
}

export async function setFoodQuantity(input: { id: string; quantity: number }): Promise<FoodEntry> {
  if (parseFoodQuantity(String(input.quantity)) === null) throw new Error('Cantidad inválida.')
  return unwrapRow(await supabase.rpc('set_food_entry_quantity', {
    p_id: input.id, p_quantity: input.quantity,
  }))
}

export async function deleteFood(id: string): Promise<void> {
  unwrap(await supabase.rpc('delete_food_entry', { p_id: id }))
}
