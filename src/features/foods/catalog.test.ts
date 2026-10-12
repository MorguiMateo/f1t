import { describe, expect, it } from 'vitest'
import catalogData from './catalog.json'
import { foodCatalog, foodCatalogAttribution, foodCatalogVersion, getFoodByCode, searchFoods } from './catalog'

describe('curated food catalog', () => {
  it('is versioned, Argentine, unique, sourced and energy-safe', () => {
    expect(foodCatalog.length).toBeGreaterThan(0)
    expect(new Set(foodCatalog.map((item) => item.sourceCode)).size).toBe(foodCatalog.length)
    expect(foodCatalog.map((item) => item.sourceCode)).toEqual([...foodCatalog.map((item) => item.sourceCode)].sort())
    for (const item of foodCatalog) {
      expect(item.catalogVersion).toBe(foodCatalogVersion)
      expect(item.source).toBe('OFF')
      expect(item.sourceCode).toMatch(/^\d{8,14}$/)
      expect(item.sourceRevision).toBeGreaterThan(0)
      expect(item.sourceUrl).toBe(`https://world.openfoodfacts.org/product/${item.sourceCode}`)
      expect(item.sourceResponseSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(Number.isNaN(Date.parse(item.sourceRetrievedAt))).toBe(false)
      expect(Number.isNaN(Date.parse(item.reviewedAt))).toBe(false)
      expect(item.reviewNote.length).toBeGreaterThan(14)
      expect(item.countriesTags).toContain('en:argentina')
      expect(['g', 'ml']).toContain(item.basisUnit)
      expect(Number.isFinite(item.energyKcalPer100)).toBe(true)
      expect(item.energyKcalPer100).toBeGreaterThanOrEqual(0)
      expect(item.name.trim()).not.toBe('')
      expect(item.brand.trim()).not.toBe('')
    }
  })

  it('exports machine-readable attribution without product images', () => {
    expect(catalogData.databaseLicenseUrl).toBe(foodCatalogAttribution.databaseLicenseUrl)
    expect(catalogData.contentsLicenseUrl).toBe(foodCatalogAttribution.contentsLicenseUrl)
    expect(catalogData.attributionUrl).toBe(foodCatalogAttribution.attributionDownloadPath)
    expect(catalogData.attribution).toBe(foodCatalogAttribution.attribution)
    expect(foodCatalogAttribution.databaseLicense).toBe('ODbL-1.0')
    expect(foodCatalogAttribution.imagesIncluded).toBe(false)
  })

  it('searches accents, aliases and barcodes without network', () => {
    const match = foodCatalog.find((item) => item.name.toLowerCase().includes('serenísima'))
    expect(match).toBeDefined()
    expect(searchFoods('serenisima').some((item) => item.sourceCode === match?.sourceCode)).toBe(true)
    expect(searchFoods(match!.sourceCode)[0]?.sourceCode).toBe(match?.sourceCode)
    expect(getFoodByCode(match!.sourceCode)).toEqual(match)
    expect(getFoodByCode('0000000000000')).toBeUndefined()
    expect(searchFoods('un alimento inexistente')).toEqual([])
    expect(searchFoods('')).toHaveLength(foodCatalog.length)
    expect(searchFoods('', 3)).toHaveLength(3)
    expect(searchFoods('', 0)).toEqual([])
  })
})
