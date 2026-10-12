// Shared fail-closed checks for offline import and explicit snapshot promotion.
const assert = (condition, message) => { if (!condition) throw new Error(message) }

export function validateSource(row, response) {
  const code = row.sourceCode
  const p = response.product
  assert(response.status === 1 && response.code === code && p?.code === code, `${code}: source code mismatch`)
  assert(typeof p.product_name === 'string' && p.product_name.trim(), `${code}: source name missing`)
  assert(typeof p.brands === 'string' && p.brands.trim(), `${code}: source brand missing`)
  assert(Array.isArray(p.countries_tags) && p.countries_tags.includes('en:argentina'), `${code}: Argentina not tagged`)
  assert(!p.obsolete, `${code}: obsolete product`)
  assert(p.nutrition_data === 'on', `${code}: nutrition data not enabled`)
  assert(p.nutrition_data_per === (row.basisUnit === 'ml' ? '100ml' : '100g'), `${code}: ambiguous/different nutrition base ${p.nutrition_data_per}`)
  if (p.product_quantity_unit === 'g' || p.product_quantity_unit === 'ml') {
    assert(p.product_quantity_unit === row.basisUnit, `${code}: package unit conflicts with nutrition base; density review required`)
  }

  const kcal = p.nutriments?.['energy-kcal_100g']
  assert(typeof kcal === 'number' && Number.isFinite(kcal) && kcal >= 0 && kcal <= 900, `${code}: invalid kcal/100`)
  assert(kcal === row.energyKcalPer100, `${code}: energy not identical to pinned source`)
  const kj = p.nutriments?.['energy-kj_100g']
  if (kj !== undefined && kj !== null) {
    assert(typeof kj === 'number' && Number.isFinite(kj) && kj >= 0, `${code}: invalid kJ/100`)
    // Label rounding and OFF serving normalization introduce small differences.
    assert(Math.abs(kcal - kj / 4.184) <= Math.max(8, kcal * 0.05), `${code}: kcal/kJ contradiction (${kcal} kcal, ${kj} kJ)`)
  }
  const flags = p.data_quality_warnings_tags ?? []
  assert(Array.isArray(flags), `${code}: invalid OFF quality flags`)
  const directConflict = flags.find((flag) =>
    /^en:nutrition-energy-value-in-(kcal|kj)-does-not-match-value-in-(kcal|kj)$/.test(flag)
    || flag === 'en:nutrition-energy-value-in-kcal-greater-than-in-kj',
  )
  assert(!directConflict, `${code}: OFF energy conflict flag ${directConflict}`)

  const macros = ['fat_100g', 'carbohydrates_100g', 'proteins_100g'].map((key) => p.nutriments?.[key])
  if (macros.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    const estimated = 9 * macros[0] + 4 * macros[1] + 4 * macros[2]
    // OFF's own computed-nutrient warnings are common even for coherent labels;
    // use a disclosed broad plausibility screen instead of treating every flag as proof.
    assert(Math.abs(kcal - estimated) <= Math.max(35, estimated * 0.20), `${code}: energy conflicts with macronutrients`)
  }
  return p
}
