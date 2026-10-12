import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { ConfirmButton } from '../../components/confirm-button'
import { EmptyState } from '../../components/empty-state'
import { PageHeader } from '../../components/page-header'
import { ErrorNote } from '../../components/status'
import { TextInput } from '../../components/text-input'
import { isAuthQueryClientActive } from '../auth/auth-query-client'
import { FoodDraftSession } from './reconciliation'
import { useUser } from '../auth/session'
import { useEnergyReportForDate } from '../body/queries'
import { foodCatalog, foodCatalogVersion, searchFoods, type FoodCatalogItem } from './catalog'
import { foodKcal, parseFoodQuantity, productLabel, resolveFoodSnapshot, targetComparison, validFoodDate } from './diary'
import { useDeleteFood, useFoodDay, useLogFood, useSetFoodQuantity } from './queries'
import type { FoodEntry } from './api'
import { useLocalToday } from './local-today'
import { FoodLocalState, foodPortionAmount, foodPortionCount, foodReference, type FoodDraft, type FoodPreferences } from './local-state'

const kcalFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const quantityFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const quantityHelp = (unit: string) => `Mayor que 0 y hasta 5.000 ${unit}, con hasta dos decimales. Usá coma o punto, sin separador de miles.`

function FoodEntryRow({ entry, date, portion, onRepeat }: { entry: FoodEntry; date: string; portion?: number; onRepeat?: () => void }) {
  const update = useSetFoodQuantity()
  const remove = useDeleteFood()
  const [editing, setEditing] = useState(false)
  const [quantity, setQuantity] = useState(String(entry.quantity))
  const [usePortions, setUsePortions] = useState(false)
  const [count, setCount] = useState('1')
  const parsed = usePortions && portion ? foodPortionAmount(count, portion) : parseFoodQuantity(quantity)
  const exactCount = portion ? foodPortionCount(entry.quantity, portion) : null
  const inputID = `food-edit-${entry.id}`
  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{entry.food_name}</p>
          <p className="text-xs text-muted">{entry.brand} · {quantityFormat.format(entry.quantity)} {entry.basis_unit}</p>
        </div>
        <span className="shrink-0 font-semibold tnum">{kcalFormat.format(entry.kcal)} kcal</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="min-h-11 text-sm text-accent" disabled={update.isPending || remove.isPending} onClick={() => {
          setEditing(!editing); setQuantity(String(entry.quantity)); setUsePortions(false); setCount(String(exactCount ?? 1))
        }}>{editing ? 'Cancelar' : 'Editar cantidad'}</button>
        {onRepeat ? <button type="button" className="min-h-11 text-sm text-accent" disabled={update.isPending || remove.isPending} onClick={onRepeat}>Repetir</button> : null}
        <ConfirmButton label="Borrar" confirmLabel="¿Borrar?" size="sm" disabled={remove.isPending || update.isPending} onConfirm={() => remove.mutate({ id: entry.id, date })} />
      </div>
      {editing ? <form className="mt-2 space-y-2" onSubmit={(event) => {
        event.preventDefault()
        if (parsed !== null) update.mutate({ id: entry.id, quantity: parsed, date }, { onSuccess: () => setEditing(false) })
      }}>
        {portion && exactCount !== null ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={usePortions} onChange={event => {
          const value = event.target.checked
          if (value) { const converted = foodPortionCount(parseFoodQuantity(quantity) ?? 0, portion); if (converted === null) return; setCount(String(converted)) }
          else if (parsed !== null) setQuantity(String(parsed))
          setUsePortions(value)
        }} />Mis porciones (1 = {quantityFormat.format(portion)} {entry.basis_unit})</label> : null}
        <label className="block text-sm" htmlFor={inputID}>{usePortions ? 'Número de porciones' : `Nueva cantidad en ${entry.basis_unit}`}</label>
        <TextInput id={inputID} inputMode="decimal" value={usePortions ? count : quantity} onChange={event => usePortions ? setCount(event.target.value) : setQuantity(event.target.value)} aria-invalid={parsed === null} aria-describedby={`${inputID}-help`} disabled={update.isPending} className="w-32 tnum" />
        <p id={`${inputID}-help`} className={`text-xs ${parsed === null ? 'text-warn' : 'text-muted'}`}>{usePortions ? `La equivalencia debe ser exacta en ${entry.basis_unit}; no se redondea.` : quantityHelp(entry.basis_unit)}</p>
        {parsed !== null ? <p className="text-sm">{quantityFormat.format(parsed)} {entry.basis_unit} → {kcalFormat.format(foodKcal(parsed, entry.energy_kcal_per_100))} kcal estimadas</p> : null}
        <Button type="submit" disabled={parsed === null || parsed === entry.quantity || update.isPending}>Guardar</Button>
      </form> : null}
      {update.error ? <ErrorNote error={update.error} title="No se actualizó la cantidad" /> : null}
      {remove.error ? <ErrorNote error={remove.error} title="No se borró la comida" /> : null}
      <details className="mt-2 text-xs text-muted"><summary className="min-h-8 cursor-pointer">Detalles y procedencia</summary><p>{quantityFormat.format(entry.energy_kcal_per_100)} kcal / 100 {entry.basis_unit}</p><p>OFF {entry.source_code} · catálogo {entry.catalog_version} al registrar</p></details>
    </li>
  )
}

/** A changed account gets a fresh component immediately, before any effects can run. */
export function FoodDiaryPage() {
  const owner = useUser()?.id ?? null
  return <FoodDiaryContent key={owner ?? 'signed-out'} owner={owner} />
}
function FoodDiaryContent({ owner }: { owner: string | null }) {
  const today = useLocalToday()
  const client = useQueryClient()
  const [local] = useState(() => new FoodLocalState(owner))
  const [draftSession] = useState(() => new FoodDraftSession(local, () => isAuthQueryClientActive(client)))
  useEffect(() => { draftSession.start(); return () => draftSession.cancel() }, [draftSession])
  const [draft, setDraftState] = useState(() => local.draft(today))
  const [preferences, setPreferencesState] = useState(() => local.preferences())
  const [acceptNoTarget, setAcceptNoTarget] = useState(false)
  const [notice, setNotice] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const { date, query, quantity } = draft
  const selected = foodCatalog.find(food => foodReference(food) === draft.food) ?? null
  const portion = selected ? preferences.portions[foodReference(selected)] : undefined
  const parsed = draft.usePortions ? portion ? foodPortionAmount(draft.portionCount, portion) : null : parseFoodQuantity(quantity)
  const detail = useFoodDay(date)
  const energy = useEnergyReportForDate(date)
  const log = useLogFood()
  const day = detail.data?.day ?? null
  const entries = detail.data?.entries ?? []
  const intake = entries.reduce((total, entry) => total + entry.kcal, 0)
  const snapshot = resolveFoodSnapshot(day ? { targetKcal: day.target_kcal, tdeeKcal: day.tdee_kcal } : null, energy.report, Boolean(energy.error), acceptNoTarget)
  const comparison = targetComparison(intake, snapshot?.targetKcal ?? null)
  const candidates = searchFoods(query)
  const locked = log.isPending || draft.pending !== null
  const canSave = !locked && owner && selected && parsed !== null && snapshot && !detail.isPending && !detail.error && !log.isPending && validFoodDate(date)
  const changeDraft = (patch: Partial<FoodDraft>) => {
    setDraftState(draftSession.update(patch, today))
  }
  const changePreferences = (next: FoodPreferences) => { local.savePreferences(next); setPreferencesState(next) }
  const changeDate = (next: string) => {
    if (!validFoodDate(next) || locked) return
    changeDraft({ date: next }); setAcceptNoTarget(false); setNotice('')
  }
  const openAdd = () => {
    changeDraft({ open: true })
    requestAnimationFrame(() => { sectionRef.current?.scrollIntoView?.({ block: 'start' }); (selected ? editorRef : searchRef).current?.focus() })
  }
  const select = (food: FoodCatalogItem, amount = preferences.amounts[foodReference(food)]) => {
    if (locked) return
    const reference = foodReference(food), size = preferences.portions[reference]
    const count = size && amount ? foodPortionCount(amount, size) : null
    changeDraft({ open: true, food: reference, quantity: amount === undefined ? '' : String(amount), usePortions: preferences.modes[reference] === true && (!amount || count !== null), portionCount: String(count ?? 1), portionSize: size ? String(size) : '' })
    setNotice('')
    requestAnimationFrame(() => editorRef.current?.focus())
  }
  const shortcuts = (title: string, references: string[]) => {
    const foods = references.flatMap(reference => foodCatalog.filter(food => foodReference(food) === reference))
    return foods.length ? <div className="mt-3"><h3 className="text-sm font-medium">{title}</h3><div className="mt-2 flex gap-2 overflow-x-auto pb-2">{foods.map(food => <button key={foodReference(food)} type="button" disabled={locked} className="min-h-11 min-w-40 rounded-lg border border-line p-3 text-left text-sm" onClick={() => select(food)}><span className="block font-medium">{food.name}</span><span className="text-xs text-muted">{preferences.amounts[foodReference(food)] ? `Última: ${quantityFormat.format(preferences.amounts[foodReference(food)])} ${food.basisUnit}` : food.brand}</span></button>)}</div></div> : null
  }
  return (
    <>
      <PageHeader title="Comidas" subtitle="Registro por fecha local" />
      <label className="block text-sm font-medium" htmlFor="food-date">Fecha</label>
      <TextInput id="food-date" type="date" value={date} max={today} disabled={locked} onChange={event => changeDate(event.target.value)} className="mt-1 w-full tnum" />
      {date !== today ? <div className="mt-2 flex flex-wrap items-center gap-x-3 text-sm" role="status"><p>Estás registrando para {date}, no para hoy.</p><button type="button" className="min-h-11 font-medium text-accent" disabled={locked} onClick={() => changeDate(today)}>Ir a hoy</button></div> : null}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5" aria-label="Resumen de calorías">
        <h2 className="font-semibold">Resumen del día</h2>
        {detail.isPending ? <p className="mt-2 text-sm text-muted">Cargando comidas…</p> : null}
        {detail.error ? <><ErrorNote error={detail.error} title="No se pudo cargar el diario" /><button type="button" className="mt-2 min-h-11 text-sm text-accent" onClick={() => void detail.refetch()}>Reintentar</button></> : null}
        {!detail.isPending && !detail.error ? <>
          <p className="mt-2 text-2xl font-semibold tnum">{kcalFormat.format(intake)} <span className="text-sm font-normal text-muted">kcal registradas</span></p>
          {snapshot?.targetKcal != null ? <><p className="mt-1 text-sm">Objetivo {kcalFormat.format(snapshot.targetKcal)} kcal</p><p className="mt-1 text-sm font-medium">{comparison! > 0 ? `Quedan ${kcalFormat.format(comparison!)} kcal respecto del objetivo` : comparison! < 0 ? `${kcalFormat.format(-comparison!)} kcal sobre objetivo` : 'Objetivo alcanzado'}</p></>
            : day ? <p className="mt-1 text-sm text-muted">Sin objetivo calculable al primer registro de este día. Completar el perfil no cambia este historial.</p>
            : energy.isPending ? <p className="mt-1 text-sm text-muted">Calculando objetivo…</p>
            : energy.error ? <><ErrorNote error={energy.error} title="No se pudo calcular el objetivo" /><p className="mt-2 text-sm text-warn">Si registrás sin objetivo, el objetivo y gasto de este día quedarán sin calcular aunque después se recupere la consulta.</p><label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={acceptNoTarget} onChange={event => setAcceptNoTarget(event.target.checked)} /><span>Registrar este día sin objetivo</span></label></>
            : <p className="mt-1 text-sm text-muted">Sin objetivo calculable. Podés registrar comida igual.</p>}
          {snapshot?.targetKcal == null && !energy.isPending ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm text-accent" to="/perfil">Completar perfil y peso · se conserva tu borrador</Link> : null}
          <details className="mt-2 text-xs text-muted"><summary className="min-h-8 cursor-pointer">Cómo se calcula el objetivo</summary>{snapshot?.tdeeKcal != null ? <p>Gasto diario estimado: {kcalFormat.format(snapshot.tdeeKcal)} kcal.</p> : null}<p>El objetivo ya incluye la actividad estimada. No se suman calorías del entrenamiento.</p><p>El objetivo y el gasto estimado se fijan al primer registro; los cambios posteriores del perfil o entrenamientos no reescriben este día.</p></details>
        </> : null}
        <Button className="mt-3" variant="primary" onClick={openAdd} disabled={locked} aria-expanded={draft.open} aria-controls="food-add">Agregar comida</Button>
      </section>
      {(!local.persistenceStatus().draft || !local.persistenceStatus().preferences) ? <p className="mt-3 text-sm text-warn" role="status">No se pudo guardar { !local.persistenceStatus().draft && !local.persistenceStatus().preferences ? 'el borrador ni tus preferencias' : !local.persistenceStatus().draft ? 'el borrador' : 'tus preferencias' } en este dispositivo. Los cambios actuales se conservan solo en memoria; podrían perderse al cerrar o recargar la pestaña.</p> : null}
      {notice ? <p className="mt-3 text-sm text-accent" role="status">{notice}</p> : null}
      <section id="food-add" ref={sectionRef} hidden={!draft.open} className="mt-4 scroll-mt-4 rounded-xl border border-line bg-surface p-5" aria-label="Agregar comida">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Agregar producto</h2><button type="button" className="min-h-11 text-sm text-accent" disabled={locked} onClick={() => changeDraft({ open: false })}>Cerrar · conservar borrador</button></div>
        <p className="mt-1 text-sm text-muted">Catálogo limitado: no incluye todos los alimentos ni comidas caseras. El resumen suma solo lo registrado.</p>
        <p className="mt-1 text-xs text-muted">Valores orientativos: revisá el envase. La búsqueda funciona sin conexión; guardar requiere conexión.</p>
        {shortcuts('Favoritos', preferences.favorites)}{shortcuts('Usados recientemente', preferences.recent)}
        <label htmlFor="food-search" className="mt-3 block text-sm font-medium">Buscar alimentos</label>
        <input ref={searchRef} id="food-search" type="search" placeholder="Producto, marca o código" value={query} disabled={locked} onChange={event => changeDraft({ query: event.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm" />
        {selected ? <form className="mt-3 rounded-lg border border-line p-3" onSubmit={event => {
          event.preventDefault()
          if (!canSave) return
          const food = selected, amount = parsed!
          const attempt: FoodDraft = { ...draft, pending: { amount, knownIDs: entries.map(entry => entry.id), catalogVersion: food.catalogVersion } }
          local.saveDraft(attempt); setDraftState(attempt)
          const checkpoint = draftSession.checkpoint(today)
          log.mutate({ date, food, quantity: amount, energy: snapshot! }, { onSuccess: () => {
            if (!draftSession.isCurrent(checkpoint)) return
            local.record(food, amount); local.clearRegisteredDraft(attempt); setPreferencesState(local.preferences())
            setDraftState(local.draft(today)); setNotice(`Registrado: ${quantityFormat.format(amount)} ${food.basisUnit} de ${food.name} para ${date}.`)
          } })
        }}>
          <p className="font-medium">{selected.name}</p><p className="text-xs text-muted">{selected.brand} · {productLabel(selected)}. Prevalece la etiqueta actual del envase.</p>
          <button type="button" className="my-1 min-h-11 text-sm text-accent" disabled={locked} aria-pressed={preferences.favorites.includes(foodReference(selected))} onClick={() => {
            const key = foodReference(selected); changePreferences({ ...preferences, favorites: preferences.favorites.includes(key) ? preferences.favorites.filter(id => id !== key) : [...preferences.favorites, key].slice(0, 200) })
          }}>{preferences.favorites.includes(foodReference(selected)) ? 'Quitar de favoritos' : 'Guardar en favoritos'}</button>
          <label className="block text-sm" htmlFor="food-mode">Cómo ingresar la cantidad</label>
          <select id="food-mode" className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-3" value={draft.usePortions ? 'portions' : 'amount'} disabled={locked} onChange={event => {
            const usePortions = event.target.value === 'portions'
            const count = portion && parsed !== null ? foodPortionCount(parsed, portion) : null
            changeDraft({ usePortions, ...(usePortions ? { portionCount: String(count ?? 1) } : parsed !== null ? { quantity: String(parsed) } : {}) })
            changePreferences({ ...preferences, modes: { ...preferences.modes, [foodReference(selected)]: usePortions } })
          }}><option value="amount">Cantidad en {selected.basisUnit}</option><option value="portions">Mis porciones</option></select>
          {draft.usePortions ? <p className="mt-2 text-xs text-muted">{portion ? `1 porción = ${quantityFormat.format(portion)} ${selected.basisUnit} · configurada por vos` : 'Configurá tu porción abajo antes de registrar.'}</p> : null}
          <label htmlFor="food-quantity" className="mt-2 block text-sm font-medium">{draft.usePortions ? 'Número de porciones' : `Cantidad en ${selected.basisUnit}`}</label>
          <input ref={editorRef} id="food-quantity" inputMode="decimal" value={draft.usePortions ? draft.portionCount : quantity} disabled={locked} onChange={event => changeDraft(draft.usePortions ? { portionCount: event.target.value } : { quantity: event.target.value })} aria-invalid={parsed === null && (draft.usePortions || quantity !== '')} aria-describedby="food-quantity-help food-quantity-preview" className="mt-1 w-32 rounded-xl border border-line bg-surface px-4 py-3 text-sm tnum" />
          <p id="food-quantity-help" className={`mt-1 text-xs ${parsed === null && (draft.usePortions || quantity) ? 'text-warn' : 'text-muted'}`}>{draft.usePortions ? `La equivalencia debe ser mayor que 0, hasta 5.000 ${selected.basisUnit} y exacta a dos decimales; no se redondea.` : quantityHelp(selected.basisUnit)}</p>
          <p id="food-quantity-preview" className="mt-2 text-sm font-medium">{parsed !== null ? `${quantityFormat.format(parsed)} ${selected.basisUnit} → ${kcalFormat.format(foodKcal(parsed, selected.energyKcalPer100))} kcal estimadas` : 'Revisá la cantidad antes de registrar.'}</p>
          <details className="mt-2 text-sm" open={draft.usePortions && !portion}><summary className="min-h-11 cursor-pointer text-accent">Configurar mi porción</summary><label htmlFor="food-portion-size" className="block">Equivalencia de una porción en {selected.basisUnit}</label><TextInput id="food-portion-size" inputMode="decimal" value={draft.portionSize} disabled={locked} onChange={event => changeDraft({ portionSize: event.target.value })} aria-invalid={draft.portionSize !== '' && parseFoodQuantity(draft.portionSize) === null} aria-describedby="food-portion-help" className="mt-1 w-32" /><p id="food-portion-help" className="mt-1 text-xs text-muted">Elegí la equivalencia desde el envase o tu medida. {quantityHelp(selected.basisUnit)} No se convierte entre g y ml.</p><Button className="mt-2" type="button" disabled={locked || parseFoodQuantity(draft.portionSize) === null} onClick={() => {
            const size = parseFoodQuantity(draft.portionSize); if (size === null) return
            changePreferences({ ...preferences, portions: { ...preferences.portions, [foodReference(selected)]: size } }); setNotice(`Porción ${local.persistenceStatus().preferences ? 'guardada en este dispositivo' : 'conservada solo en memoria'}: ${quantityFormat.format(size)} ${selected.basisUnit}.`)
          }}>Guardar mi porción en este dispositivo</Button></details>
          <p className="mt-3 text-sm font-medium">Se registrará para {date}{date === today ? ' (hoy)' : ' (no es hoy)'}. Cambiar la fecha conserva tu cantidad.</p>
          <Button className="mt-2" type="submit" variant="primary" disabled={!canSave}>{log.isPending ? 'Guardando…' : 'Registrar'}</Button>
          {!snapshot && !energy.isPending ? <p className="mt-2 text-xs text-warn">Reintentá calcular el objetivo o elegí registrar sin objetivo en el resumen.</p> : null}
        </form> : null}
        <p className="mt-3 text-xs text-muted" role="status">{candidates.length} de {foodCatalog.length} productos{query.trim() ? ' coinciden con tu búsqueda' : ' · catálogo completo'}</p>
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line">{candidates.map(food => <li key={food.sourceCode}><button type="button" disabled={locked} aria-pressed={selected?.sourceCode === food.sourceCode} className="min-h-11 w-full border-b border-line p-3 text-left text-sm hover:bg-surface-2 aria-pressed:bg-surface-2" onClick={() => select(food)}><span className="block font-medium">{food.name}</span><span className="text-xs text-muted">{food.brand} · {productLabel(food)}</span></button></li>)}{candidates.length === 0 ? <li className="p-3 text-sm text-muted">No hay coincidencias. Este producto podría no estar incluido en el catálogo limitado; probá otro nombre, marca o código. No elijas otro alimento como equivalente.<button type="button" className="mt-2 block min-h-11 text-accent" disabled={locked} onClick={() => changeDraft({ query: '' })}>Ver todo el catálogo</button></li> : null}</ul>
        {draft.pending && !log.isPending ? <div className="mt-3 space-y-2" role="status">
          <p className="text-sm text-warn">El intento anterior aún no se confirmó. Tu cantidad se conserva; comprobá el diario antes de volver a registrar.</p>
          <Button type="button" disabled={detail.isFetching} onClick={() => {
            void draftSession.reconcile(today, () => detail.refetch(), result => {
              setDraftState(result.draft)
              if (result.status === 'found') {
                setPreferencesState(local.preferences()); setNotice(`Registro confirmado para ${result.draft.date}.`)
              } else if (result.status === 'missing') {
                setNotice('No encontramos el registro en esta actualización. El intento podría seguir procesándose. Revisá el diario: no se reenviará automáticamente.')
              } else { setNotice('No pudimos comprobar el registro. Tu borrador se conserva.') }
            })
          }}>Comprobar registro</Button>
          <ConfirmButton label="Descartar borrador" confirmLabel="¿Descartar? Revisá antes el diario" onConfirm={() => changeDraft({ food: null, quantity: '', portionSize: '', pending: null })} />
        </div> : null}
        {log.error ? <ErrorNote error={log.error} title="No se guardó la comida" /> : null}
        <details className="mt-3 text-xs text-muted"><summary className="min-h-8 cursor-pointer">Detalles del catálogo y atribución</summary><p>{foodCatalog.length} productos de Open Food Facts etiquetados para Argentina · catálogo {foodCatalogVersion}. Favoritos y porciones se guardan solo en este dispositivo; el borrador se conserva en esta pestaña. Diario privado.</p><p>Datos de productos: <a className="underline" href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> (<a className="underline" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL 1.0</a>). <a className="underline" href="/data/foods-catalog.json" download>Descargar catálogo abierto</a>.</p></details>
      </section>
      <section className="mt-4 rounded-xl border border-line bg-surface p-5" aria-label="Comidas registradas"><h2 className="font-semibold">Registrado</h2>{!detail.isPending && !detail.error && entries.length === 0 ? <EmptyState title="Sin comidas registradas" description="Tocá Agregar comida para buscar o elegir un favorito." /> : null}<ul>{entries.map(entry => {
        const food = foodCatalog.find(food => food.source === entry.source && food.sourceCode === entry.source_code && food.basisUnit === entry.basis_unit)
        const reference = food ? foodReference(food) : null
        return <FoodEntryRow key={entry.id} entry={entry} date={date} portion={reference ? preferences.portions[reference] : undefined} onRepeat={food && !locked ? () => select(food, entry.quantity) : undefined} />
      })}</ul></section>
    </>
  )
}
