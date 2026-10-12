import { QueryClientProvider } from '@tanstack/react-query'
import { createAuthQueryClient, setAuthQueryIdentity } from '../auth/auth-query-client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FoodDiaryPage } from './food-diary-page'
import { foodCatalog } from './catalog'
import { FoodLocalState, foodReference, newFoodDraft } from './local-state'
import { toDateKey } from '../../lib/heatmap'

const mock = vi.hoisted(() => ({
  owner: 'fixture-user',
  quota: false,
  storage: new Map<string, string>(),
  day: null as null | { logged_on: string; target_kcal: number | null; tdee_kcal: number | null },
  entries: [] as Array<Record<string, unknown>>,
  loadError: null as Error | null,
  logError: null as Error | null,
  energyError: null as Error | null,
  report: { status: 'missing', missing: ['weight'], bmi: null } as unknown,
}))
vi.mock('../auth/session', () => ({ useUser: () => ({ id: mock.owner }) }))
vi.mock('./local-state', async importOriginal => {
  const actual = await importOriginal<typeof import('./local-state')>()
  const adapters = new WeakMap<Map<string, string>, import('./local-state').FoodStorage>()
  return { ...actual, FoodLocalState: class extends actual.FoodLocalState {
    constructor(owner: string | null) {
      const values = mock.storage
      let storage = adapters.get(values)
      if (!storage) {
        storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (mock.quota) throw new Error('quota'); values.set(key, value) }, removeItem: key => { values.delete(key) } }
        adapters.set(values, storage)
      }
      super(owner, storage, storage)
    }
  } }
})
vi.mock('./queries', () => ({
  useFoodDay: () => ({ data: { day: mock.day, entries: mock.entries }, isPending: false, error: mock.loadError, refetch: vi.fn() }),
  useLogFood: () => ({ mutate: vi.fn(), isPending: false, error: mock.logError }),
  useSetFoodQuantity: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteFood: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))
vi.mock('../body/queries', () => ({
  useEnergyReportForDate: () => ({ report: mock.energyError ? null : mock.report, isPending: false, error: mock.energyError }),
}))

function render() {
  setAuthQueryIdentity(mock.owner)
  const client = createAuthQueryClient()
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/comidas']}><FoodDiaryPage /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => { mock.owner = 'fixture-user'; mock.quota = false; mock.storage = new Map(); mock.day = null; mock.entries = []; mock.loadError = null; mock.logError = null; mock.energyError = null; mock.report = { status: 'missing', missing: ['weight'], bmi: null } })

describe('food diary screen', () => {
  it('opens as a standalone section without a Today-only return action', () => {
    const html = render()
    expect(html).toContain('Comidas</h1>')
    expect(html).toContain('Registro por fecha local')
    expect(html).toContain('Buscar alimentos')
    expect(html).not.toContain('Volver a Hoy')
  })

  it('allows catalog search without a target and explains offline/save limitation', () => {
    const html = render()
    expect(html).toContain('Sin comidas registradas')
    expect(html).toContain('Sin objetivo calculable')
    expect(html).toContain('Buscar alimentos')
    expect(html).toContain('La búsqueda funciona sin conexión; guardar requiere conexión')
    expect(html).toContain('productos de Open Food Facts etiquetados para Argentina')
    expect(html).toContain(`${foodCatalog.length} productos`)
    expect(html).toContain('Valores orientativos: revisá el envase')
    expect(html).toContain('Catálogo limitado')
    expect(html).toContain(`${foodCatalog.length} de ${foodCatalog.length} productos`)
    expect(html).toContain(foodCatalog.at(-1)!.name)
    expect(html).toContain('Open Food Facts')
    expect(html).toContain('/data/foods-catalog.json')
  })

  it('uses the frozen historical target rather than a newly calculated one', () => {
    mock.day = { logged_on: '2026-09-29', target_kcal: 1800, tdee_kcal: 2300 }
    mock.report = { status: 'ready', target: { kcal: 2500 }, tdee: 3000 }
    const html = render()
    expect(html).toContain('Objetivo 1.800 kcal')
    expect(html).not.toContain('Objetivo 2.500 kcal')
    expect(html).toContain('No se suman calorías del entrenamiento')
    expect(html).toContain('Quedan 1.800 kcal respecto del objetivo')
    expect(html).toContain('kcal registradas')
    expect(html).not.toContain('Diferencia respecto del objetivo')
  })

  it('surfaces load and write failures', () => {
    mock.loadError = new Error('offline')
    mock.logError = new Error('write failed')
    const html = render()
    expect(html).toContain('No se pudo cargar el diario')
    expect(html).toContain('Reintentar')
    expect(html).toContain('No se guardó la comida')
  })

  it('offers an explicit, warned no-target path when the energy query fails', () => {
    mock.energyError = new Error('energy offline')
    const html = render()
    expect(html).toContain('No se pudo calcular el objetivo')
    expect(html).toContain('quedarán sin calcular aunque después se recupere la consulta')
    expect(html).toContain('Registrar este día sin objetivo')
    expect(html).toContain('type="checkbox"')
  })

  it('renders removed catalog products from saved entry snapshots', () => {
    mock.entries = [{
      id: 'old-entry', food_name: 'Producto retirado', brand: 'Marca histórica',
      quantity: 100, basis_unit: 'g', energy_kcal_per_100: 321,
      kcal: 321, source_code: '7790000000001', catalog_version: '2026-09-29.1',
    }]
    const html = render()
    expect(html).toContain('Producto retirado')
    expect(html).toContain('321 kcal')
    expect(html).toContain('catálogo 2026-09-29.1 al registrar')
  })
})

 it('distinguishes a frozen missing target from completing the profile for future days', () => {
    mock.day = { logged_on: '2026-09-29', target_kcal: null, tdee_kcal: null }
    mock.report = { status: 'ready', target: { kcal: 2500 }, tdee: 3000 }
    const html = render()
    expect(html).toContain('Completar el perfil no cambia este historial')
    expect(html).toContain('href="/perfil"')
    expect(html).not.toContain('Objetivo 2.500 kcal')
  })


describe('restored food editor', () => {
  it('restores the destination, quantity and custom portions only for the active account', () => {
    const date = toDateKey(new Date()), food = foodCatalog[0], key = foodReference(food)
    const local = new FoodLocalState('fixture-user')
    local.savePreferences({ ...local.preferences(), favorites: [key], recent: [key], amounts: { [key]: 45 }, portions: { [key]: 30 }, modes: { [key]: true } })
    local.saveDraft({ ...newFoodDraft(date), food: key, quantity: '45', usePortions: true, portionCount: '1,5', portionSize: '30', open: true })
    const html = render()
    expect(html).toContain('Favoritos')
    expect(html).toContain('Usados recientemente')
    expect(html).toContain('value="1,5"')
    expect(html).toContain('1 porción = 30 g')
    expect(html).toContain(`Se registrará para ${date}`)
    expect(html).toContain('45 g →')
    mock.owner = 'another-user'
    const other = render()
    expect(other).not.toContain('value="1,5"')
    expect(other).not.toContain('Usados recientemente')
    expect(other).not.toContain('1 porción = 30 g')
  })
  it('requires checking a restored unconfirmed save rather than submitting it again', () => {
    const food = foodCatalog[0], date = toDateKey(new Date()), local = new FoodLocalState('fixture-user')
    local.saveDraft({ ...newFoodDraft(date), food: foodReference(food), quantity: '100', open: true, pending: { amount: 100, knownIDs: ['old'], catalogVersion: food.catalogVersion } })
    const html = render()
    expect(html).toContain('Comprobar registro')
    expect(html).toMatch(/disabled="">Registrar<\/button>/)
    expect(html).toContain('El intento anterior aún no se confirmó')
  })
  it('associates invalid quantity feedback and units with the editor input', () => {
    const local = new FoodLocalState('fixture-user')
    local.saveDraft({ ...newFoodDraft(toDateKey(new Date())), food: foodReference(foodCatalog[0]), quantity: '1,234', open: true })
    const html = render()
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="food-quantity-help food-quantity-preview"')
    expect(html).toContain('hasta 5.000 g')
    expect(html).toMatch(/disabled="">Registrar<\/button>/)
  })
})


it('honestly reports nonpersisted changes instead of rendering the old stored draft after quota failure', () => {
  const local = new FoodLocalState('fixture-user'), date = toDateKey(new Date())
  local.saveDraft({ ...newFoodDraft(date), food: foodReference(foodCatalog[0]), quantity: '100', open: true })
  local.record(foodCatalog[0], 100)
  mock.quota = true
  local.saveDraft({ ...newFoodDraft(date), food: foodReference(foodCatalog[1]), quantity: '250', open: true })
  local.savePreferences({ ...local.preferences(), favorites: [foodReference(foodCatalog[1])] })
  const html = render()
  expect(html).toContain('No se pudo guardar')
  expect(html).toContain('el borrador ni tus preferencias')
  expect(html).toContain('solo en memoria')
  expect(html).toContain('value="250"')
  expect(html).not.toContain('value="100"')
})
