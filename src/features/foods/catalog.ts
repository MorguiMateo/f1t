import catalogData from './catalog.json'
import attributionData from './catalog-attribution.json'

export type FoodCatalogItem = {
  catalogVersion: string
  source: 'OFF'
  sourceCode: string
  sourceRevision: number
  sourceUrl: string
  sourceRetrievedAt: string
  sourceResponseSha256: string
  reviewedAt: string
  reviewNote: string
  energyKcalPer100: number
  basisUnit: 'g' | 'ml'
  name: string
  brand: string
  group: string
  aliases: string[]
  countriesTags: string[]
}

export const foodCatalogVersion = catalogData.catalogVersion
export const foodCatalog = catalogData.products as FoodCatalogItem[]
export const foodCatalogAttribution = attributionData

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').replace(/[^a-z0-9]+/g, ' ').trim()
const indexed = foodCatalog.map((food) => ({
  food,
  terms: normalize([food.name, food.brand, ...food.aliases, food.sourceCode].join(' ')),
  name: normalize(food.name),
}))
const byCode = new Map(foodCatalog.map((food) => [food.sourceCode, food]))

export function getFoodByCode(code: string): FoodCatalogItem | undefined {
  return byCode.get(code)
}

export function searchFoods(query: string, limit = foodCatalog.length): FoodCatalogItem[] {
  if (!Number.isSafeInteger(limit) || limit < 0) return []
  const words = normalize(query).split(' ').filter(Boolean)
  if (!words.length) return foodCatalog.slice(0, limit)
  return indexed
    .filter(({ terms }) => words.every((word) => terms.includes(word)))
    .sort((a, b) => {
      const score = (entry: typeof a) => entry.food.sourceCode === query.trim() ? 0 : entry.name.startsWith(words.join(' ')) ? 1 : entry.name.includes(words[0]) ? 2 : 3
      return score(a) - score(b) || a.food.name.localeCompare(b.food.name, 'es-AR') || a.food.sourceCode.localeCompare(b.food.sourceCode)
    })
    .slice(0, limit)
    .map(({ food }) => food)
}
