import SwiftUI

enum NativeFoodInput: Hashable {
    case search, quantity, portionSize, portionCount, entry(String)
}

/// Capture before scheduling a task, not after it starts on a possibly different account.
@MainActor
private struct NativeFoodAction {
    let owner: String
    let generation: UUID
    init?(_ store: NativeStore) {
        guard let owner = store.auth.session?.user.id else { return nil }
        self.owner = owner; generation = store.auth.generation
    }
    func isCurrent(_ store: NativeStore) -> Bool {
        store.auth.session?.user.id == owner && store.auth.generation == generation
    }
    func check(_ store: NativeStore) throws {
        guard isCurrent(store), !Task.isCancelled else { throw CancellationError() }
    }
}

private extension NativeFoodAvailability.ReadState {
    init(_ state: NativeDomainState) {
        self.init(loaded: state.loaded, loading: state.loading, usingCachedData: state.usingCachedData, error: state.error)
    }
}

struct NativeFoodsView: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.fitSelectTab) private var selectTab
    @StateObject private var preferences = NativeFoodPreferences()
    @FocusState private var focused: NativeFoodInput?
    @State private var date = Date()
    @State private var todayKey = NativeDate.key()
    @State private var search = ""
    @State private var foods: [NativeFood] = []
    @State private var catalogVersion = ""
    @State private var catalogError: String?
    @State private var selected: NativeFood?
    @State private var quantity = ""
    @State private var usePortions = false
    @State private var portionCount = "1"
    @State private var portionSize = ""
    @State private var portionNotice: String?
    @State private var noTarget = false
    @State private var logError: String?
    @State private var savedNotice: String?
    @State private var reconciliationNotice: String?
    @State private var saving = false
    @State private var selectionRevision = 0
    @State private var pendingLog: PendingLog?
    @State private var discardPending = false
    @State private var addOpen = false
    @State private var draftReady = false

    private struct PendingLog {
        let food: NativeFood
        let amount: Double
        let day: String
        let knownIDs: Set<String>
        let catalogVersion: String
    }
    private var key: String { NativeDate.key(date) }
    private var owner: String? { store.auth.session?.user.id }
    private var availability: NativeFoodAvailability {
        NativeFoodAvailability(diary: .init(store.domainState(.foods)), body: .init(store.domainState(.body)), activity: .init(store.domainState(.training)))
    }
    private var foodState: NativeFoodAvailability.ReadState { availability.diary }
    private var entries: [NativeFoodEntry] { foodState.loaded ? store.foodEntries.filter { $0.user_id == owner && $0.logged_on == key } : [] }
    private var snapshot: NativeFoodDay? { foodState.loaded ? store.foodDays.first { $0.user_id == owner && $0.logged_on == key } : nil }
    private var confirmedData: Bool { availability.confirmedDiary }
    private var energyFailed: Bool { !availability.canCalculateTarget }
    private var working: Bool { saving || store.busy }
    private var parsedAmount: Double? {
        guard let selected else { return nil }
        if usePortions {
            guard let size = preferences.portion(selected) else { return nil }
            return NativeFoodQuantity.portionAmount(count: portionCount, size: size)
        }
        return NativeFoodQuantity.amount(quantity)
    }
    private var canRegister: Bool {
        parsedAmount != nil && !working && owner != nil && availability.canRegister(hasHistoricalDay: snapshot != nil, acceptsNoTarget: noTarget)
    }

    var body: some View {
        ScrollViewReader { proxy in
            FitPage {
                FitPageHeader(title: "Comidas", subtitle: "Registro por fecha local")
                Text("Fecha").font(.fit(.sm, .medium))
                FitDateField(date: $date, range: Date.distantPast...Date(), label: "Fecha")
                    .disabled(working || pendingLog != nil).padding(.top, 4)
                if key != todayKey {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Estás registrando para \(FitFormat.fieldDay(date)), no para hoy.")
                            .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        Button("Ir a hoy") { date = Date() }
                            .fitLink(.sm).disabled(working || pendingLog != nil)
                    }
                    .padding(.top, 8)
                }
                summary.padding(.top, 16)
                if addOpen { add.padding(.top, 16).id("food-add") }
                logged.padding(.top, 16)
            }
            .onChange(of: selectionRevision) { _, _ in proxy.scrollTo(selected == nil ? "food-add" : "food-editor", anchor: .top) }
        }
        .fitKeyboardDone { focused = nil }
        .fitNavigationDraft(selected != nil || saving || pendingLog != nil)
        .alert("¿Descartar este borrador?", isPresented: $discardPending) {
            Button("Descartar borrador", role: .destructive) { resetDraft(); persistDraft() }
            Button("Conservar", role: .cancel) { }
        } message: {
            Text("El intento de guardado no se confirmó. Descartar la cantidad de esta pantalla no borra ninguna comida guardada; comprobá el diario antes de registrar otra vez.")
        }
        .task(id: owner) {
            draftReady = false
            preferences.activate(owner: owner)
            loadCatalog()
            restoreDraft()
            seedPreferences()
        }
        .onReceive(store.accountChanges) { event in
            draftReady = false
            preferences.activate(owner: event.incomingOwner)
            resetDraft(); date = Date(); search = ""; focused = nil
        }
        .onChange(of: store.auth.generation) { _, _ in saving = false; focused = nil }
        .onChange(of: key) { _, _ in
            // Quantity and product belong to the draft; the bypass belongs to one day.
            noTarget = false; savedNotice = nil; focused = nil
        }
        .onChange(of: draft) { _, _ in persistDraft() }
        .onDisappear { persistDraft() }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("nativeDateRollover"))) { _ in
            // Keep the selected date and any pending draft; only update the notice.
            todayKey = NativeDate.key()
        }
        .onReceive(store.$foodEntries) { entries in
            guard let owner else { return }
            preferences.seed(entries: entries, foods: foods, owner: owner)
        }
    }

    private var summary: some View {
        let intake = entries.map(\.kcal).reduce(0, +)
        let report = NativeEnergy.snapshot(NativeEnergy.report(profile: store.profile, weights: store.weights, sessions: store.sessions, date: date))
        return VStack(alignment: .leading, spacing: 12) {
            Text("Resumen del día").font(.fit(.base, .semibold))
            if !foodState.loaded {
                if foodState.loading {
                    ProgressView("Cargando comidas…").fitLoadingAccessibility("Cargando comidas")
                } else {
                    FitErrorNote(title: "No se pudo cargar el diario", message: foodState.error ?? "Todavía no hay datos disponibles.")
                }
                Text("Las calorías registradas de este día todavía no se pueden confirmar.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
            } else if entries.isEmpty && !confirmedData {
                Text("No podemos confirmar lo registrado en este día con los datos disponibles.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(FitFormat.number(intake, fraction: 1)) kcal").font(.fit(.xl2, .semibold)).monospacedDigit()
                    Text(confirmedData ? "Calorías registradas en el día" : "Calorías de los últimos registros disponibles")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }
            }
            if foodState.loaded && !confirmedData {
                FitErrorNote(title: "El diario puede estar desactualizado", message: foodState.error ?? "Estás viendo los últimos datos guardados en este dispositivo.")
            }
            if !confirmedData { refreshButton }
            if let snapshot {
                if let target = snapshot.target_kcal {
                    targetLines(target: target, tdee: snapshot.tdee_kcal, intake: intake, showBalance: confirmedData || !entries.isEmpty)
                } else {
                    Text("Este día se registró sin objetivo calculable. Completar el perfil no cambia este historial.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }
            } else if !foodState.loaded {
                Text("Cargá el diario para confirmar si esta fecha tiene un objetivo histórico. Podés buscar y preparar una cantidad mientras tanto.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            } else if energyFailed {
                Text("El objetivo aún no está confirmado. Actualizá los datos o elegí registrar sin objetivo.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                if let error = availability.targetError {
                    FitErrorNote(title: "No se pudo confirmar el objetivo", message: error)
                }
                Toggle("Registrar este día sin objetivo", isOn: $noTarget).font(.fit(.sm)).disabled(working)
                if noTarget {
                    Text("El objetivo y el gasto de este día quedarán sin calcular, incluso si después se recuperan los datos.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.warn)
                }
            } else if let target = report.target {
                targetLines(target: target, tdee: report.tdee, intake: intake, showBalance: true)
            } else {
                Text("Sin objetivo calculable. Podés registrar comida igual.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
            }
            if snapshot?.target_kcal == nil && (snapshot != nil || !energyFailed && report.target == nil) {
                Button("Completar perfil y peso · se conserva tu borrador") { persistDraft(); selectTab(.profile) }
                    .fitLink(.sm).disabled(working || pendingLog != nil)
            }
            DisclosureGroup("Cómo se calcula el objetivo") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("El objetivo ya incluye la actividad estimada. No se suman calorías del entrenamiento.")
                    Text("El objetivo y el gasto estimado se fijan al primer registro; cambiar después el perfil o los entrenamientos no reescribe este día.")
                }
                .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 8)
            }
            .font(.fit(.sm)).tint(FitColor.accentText)
            Button("Agregar comida") {
                addOpen = true; selectionRevision += 1
                focused = selected == nil ? .search : usePortions ? .portionCount : .quantity
            }
            .buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true)).disabled(working || pendingLog != nil)
            .accessibilityHint("Abre la búsqueda o tu borrador, antes de la lista de comidas registradas")
        }
        .padding(20).fitCard(padding: 0)
    }

    @ViewBuilder private func targetLines(target: Double, tdee: Double?, intake: Double, showBalance: Bool) -> some View {
        Text("Objetivo: \(FitFormat.number(target, fraction: 1)) kcal").font(.fit(.sm))
        if showBalance {
            let difference = target - intake
            Text(difference > 0 ? "Quedan \(FitFormat.number(difference, fraction: 1)) kcal respecto del objetivo" : difference < 0 ? "\(FitFormat.number(-difference, fraction: 1)) kcal sobre objetivo" : "Objetivo alcanzado")
                .font(.fit(.base, .medium)).foregroundStyle(FitColor.ink)
            if !confirmedData {
                Text("Comparación orientativa con los últimos datos disponibles.").font(.fit(.xs)).foregroundStyle(FitColor.muted)
            }
        }
        if let tdee {
            Text("Gasto diario estimado: \(FitFormat.number(tdee, fraction: 1)) kcal").font(.fit(.sm)).foregroundStyle(FitColor.muted)
        }
    }

    private var refreshButton: some View {
        Button(foodState.loading ? "Actualizando…" : "Actualizar diario") {
            Task { await store.refresh(force: true) }
        }
        .buttonStyle(FitButtonStyle())
        .disabled(working || foodState.loading)
        .accessibilityHint("Vuelve a consultar tus datos sin borrar la cantidad que estás editando")
    }

    private var logged: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(confirmedData ? "Registrado" : foodState.loaded ? "Últimos registros disponibles" : "Diario pendiente de carga").font(.fit(.base, .semibold))
            if entries.isEmpty {
                if confirmedData {
                    FitEmptyState(title: "Sin comidas registradas", description: "Buscá un producto o elegí uno de tus favoritos para empezar.")
                } else {
                    Text("Actualizá el diario para comprobar los registros de esta fecha.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }
            }
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                if index > 0 { Rectangle().fill(FitColor.line).frame(height: 1) }
                NativeFoodEntryRow(entry: entry, preferences: preferences, focus: $focused, onRepeat: (pendingLog == nil ? repeatFood(entry) : nil).map { food in
                    { select(food, amount: entry.quantity) }
                })
            }
        }
        .padding(20).fitCard(padding: 0)
    }

    private var add: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Agregar producto").font(.fit(.base, .semibold))
                Spacer()
                Button("Cerrar") { addOpen = false; focused = nil }
                    .fitLink(.sm).disabled(working || pendingLog != nil)
                    .accessibilityHint("Conserva el producto y la cantidad del borrador")
            }
            Text("Catálogo limitado: no incluye todos los alimentos ni comidas caseras. El resumen suma solo lo registrado.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            Text("Valores orientativos: revisá el envase. Buscar y preparar una cantidad funciona sin conexión; guardar en el diario requiere conexión.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            if let catalogError {
                FitErrorNote(title: "No se pudo abrir el catálogo", message: catalogError)
                Button("Reintentar catálogo") { loadCatalog(); if !draftReady { restoreDraft() } }.buttonStyle(FitButtonStyle())
            } else {
                shortcuts("Favoritos", products: preferences.favorites(in: foods))
                shortcuts("Usados recientemente", products: preferences.recent(in: foods))
                TextField("", text: $search, prompt: fitPrompt("Producto, marca o código"))
                    .autocorrectionDisabled().textInputAutocapitalization(.never).submitLabel(.search)
                    .fitField().focused($focused, equals: .search)
                    .disabled(working || pendingLog != nil).accessibilityLabel("Buscar alimentos por producto, marca o código")
                if let food = selected { editor(food).id("food-editor") }
                catalogResults
            }
            if let logError {
                FitErrorNote(title: "No se confirmó el registro", message: logError)
                Text("Tu cantidad sigue aquí. Comprobar el registro actualiza el diario sin volver a enviar la comida.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                Button("Comprobar registro") { retryLog() }.buttonStyle(FitButtonStyle())
                    .disabled(working || pendingLog == nil || owner == nil || foodState.loading)
                Button("Descartar borrador") { discardPending = true }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted)).disabled(working)
            }
            if let savedNotice {
                Text(savedNotice).font(.fit(.sm, .medium)).foregroundStyle(FitColor.ok)
                    .accessibilityLabel(savedNotice)
            }
            if let reconciliationNotice {
                Text(reconciliationNotice).font(.fit(.sm)).foregroundStyle(FitColor.warn)
            }
            Text("Datos de productos: [Open Food Facts](https://world.openfoodfacts.org) ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)). Diario privado.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted).tint(FitColor.accentText)
            DisclosureGroup("Detalles del catálogo y atribución") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(foods.count) productos etiquetados para Argentina · catálogo \(catalogVersion). Favoritos, porciones y borrador se guardan solo en este dispositivo.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    NavigationLink("Ver atribución completa", value: NativeFoodRoute.attribution).fitLink(.sm)
                }.padding(.top, 8)
            }
            .font(.fit(.sm)).tint(FitColor.accentText)
        }
        .padding(20).fitCard(padding: 0)
    }

    @ViewBuilder private func shortcuts(_ title: String, products: [NativeFood]) -> some View {
        if !products.isEmpty {
            Text(title).font(.fit(.sm, .medium))
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(products) { food in
                        Button { select(food, amount: preferences.lastAmount(food)) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(food.name).font(.fit(.sm, .medium))
                                if let amount = preferences.lastAmount(food) {
                                    Text("Última: \(FitFormat.number(amount, fraction: 2)) \(food.basisUnit)").font(.fit(.xs)).foregroundStyle(FitColor.muted)
                                } else {
                                    Text(food.brand).font(.fit(.xs)).foregroundStyle(FitColor.muted)
                                }
                            }
                            .multilineTextAlignment(.leading).frame(width: 180, alignment: .leading)
                            .padding(12).fitMinimumHitArea().fitCard(padding: 0, fill: FitColor.surface2)
                        }
                        .buttonStyle(FitRowButtonStyle()).disabled(working || pendingLog != nil)
                        .accessibilityHint("Selecciona el producto para revisar su cantidad antes de registrar")
                    }
                }
            }
        }
    }

    private var catalogResults: some View {
        let candidates = FitFoodSearch.search(foods, query: search, limit: foods.count)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text("\(candidates.count) de \(foods.count) productos\(search.trimmingCharacters(in: .whitespaces).isEmpty ? " · catálogo completo" : " coinciden con tu búsqueda")")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(12)
                    .accessibilityLabel("\(candidates.count) coincidencias de \(foods.count) productos")
                ForEach(Array(candidates.enumerated()), id: \.element.id) { index, food in
                    if index > 0 { Rectangle().fill(FitColor.line).frame(height: 1) }
                    Button { select(food, amount: preferences.lastAmount(food)) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(food.name).font(.fit(.sm, .medium))
                            Text("\(food.brand) · \(productLabel(food))").font(.fit(.xs)).foregroundStyle(FitColor.muted)
                            if preferences.isFavorite(food) { Label("Favorito", systemImage: "star.fill").font(.fit(.xs)).foregroundStyle(FitColor.accentText) }
                        }
                        .multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12).fitMinimumHitArea()
                        .background(selected?.id == food.id ? FitColor.surface2 : Color.clear)
                    }
                    .buttonStyle(FitRowButtonStyle()).disabled(working || pendingLog != nil)
                    .accessibilityAddTraits(selected?.id == food.id ? .isSelected : [])
                }
                if candidates.isEmpty {
                    Text("No hay coincidencias. Este producto podría no estar incluido en el catálogo limitado. Probá otro nombre, marca o código; no elijas otro alimento como equivalente.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(12)
                    Button("Ver todo el catálogo") { search = "" }
                        .fitLink(.sm).padding(12)
                }
            }
        }
        .frame(maxHeight: 260)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(FitColor.line))
        .accessibilityLabel("Resultados del catálogo")
    }

    private func editor(_ food: NativeFood) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(food.name).font(.fit(.base, .semibold))
            Text(productLabel(food)).font(.fit(.sm)).foregroundStyle(FitColor.muted)
            Button { preferences.toggleFavorite(food) } label: {
                Label(preferences.isFavorite(food) ? "Quitar de favoritos" : "Guardar en favoritos", systemImage: preferences.isFavorite(food) ? "star.fill" : "star")
            }
            .buttonStyle(FitButtonStyle()).disabled(working || owner == nil || pendingLog != nil)
            Picker("Cómo ingresar la cantidad", selection: Binding(get: { usePortions }, set: { value in
                preferences.setPreferredMode(value, for: food)
                if value, let size = preferences.portion(food), let amount = NativeFoodQuantity.amount(quantity),
                   let count = NativeFoodQuantity.portionCount(amount: amount, size: size) { portionCount = FitFormat.decimal(count) }
                if !value, let amount = parsedAmount { quantity = FitFormat.decimal(amount) }
                usePortions = value
            })) {
                Text("Cantidad en \(food.basisUnit)").tag(false)
                Text("Mis porciones").tag(true)
            }
            .pickerStyle(.menu).font(.fit(.sm)).tint(FitColor.accentText).fitMinimumHitArea().disabled(working || pendingLog != nil)
            if usePortions {
                if let size = preferences.portion(food) {
                    Text("1 porción = \(FitFormat.number(size, fraction: 2)) \(food.basisUnit) · configurada por vos")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    Text("Número de porciones").font(.fit(.sm, .medium))
                    TextField("", text: $portionCount, prompt: fitPrompt("Ej.: 1 o 0,5"))
                        .fitNumericInput().fitField().focused($focused, equals: .portionCount)
                        .disabled(working || pendingLog != nil).accessibilityLabel("Número de porciones de \(food.name)")
                    .accessibilityHint(parsedAmount == nil ? "Cantidad inválida. La equivalencia en \(food.basisUnit) debe ser exacta a dos decimales y hasta 5.000." : "Una porción equivale a \(FitFormat.number(size, fraction: 2)) \(food.basisUnit)")
                    amountShortcuts(food, portions: true)
                } else {
                    Text("Configurá cuántos \(food.basisUnit) tiene tu porción antes de usarla.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.warn)
                }
            } else {
                Text("Cantidad en \(food.basisUnit)").font(.fit(.sm, .medium))
                TextField("", text: $quantity, prompt: fitPrompt("Ej.: 100 o 125,5"))
                    .fitNumericInput().fitField().focused($focused, equals: .quantity)
                    .disabled(working || pendingLog != nil).accessibilityLabel("Cantidad de \(food.name) en \(food.basisUnit)")
                    .accessibilityHint("\(parsedAmount == nil && !quantity.isEmpty ? "Cantidad inválida. " : "")Mayor que 0 y hasta 5.000 \(food.basisUnit), con hasta dos decimales. Usá coma o punto, sin separador de miles.")
                amountShortcuts(food, portions: false)
            }
            portionConfiguration(food)
            if let amount = parsedAmount {
                Text("\(FitFormat.number(amount, fraction: 2)) \(food.basisUnit) → \(FitFormat.number(amount * food.energyKcalPer100 / 100, fraction: 1)) kcal estimadas")
                    .font(.fit(.base, .semibold)).monospacedDigit()
                    .accessibilityLabel("\(FitFormat.number(amount, fraction: 2)) \(food.basisUnit), \(FitFormat.number(amount * food.energyKcalPer100 / 100, fraction: 1)) kilocalorías estimadas")
            } else if usePortions || !quantity.isEmpty {
                Text(usePortions ? "Usá una porción configurada y un número válido. La equivalencia debe ser mayor que 0, hasta 5.000 \(food.basisUnit) y tener como máximo dos decimales; no se redondea automáticamente." : "Ingresá una cantidad mayor que 0 y hasta 5.000 \(food.basisUnit), con hasta dos decimales. Podés usar coma o punto, sin separador de miles.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.warn)
            }
            Text("Se registrará para \(FitFormat.fieldDay(date))\(key == todayKey ? " (hoy)" : " (no es hoy)"). Cambiar la fecha conserva tu cantidad.")
                .font(.fit(.sm, .medium))
            Button(working ? "Guardando…" : "Registrar comida") { log(food) }
                .buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true))
                .disabled(!canRegister || pendingLog != nil)
            if snapshot == nil && energyFailed && !noTarget {
                Text(foodState.loaded ? "Actualizá los datos o elegí registrar sin objetivo en el resumen." : "Cargá el diario para confirmar esta fecha antes de registrar.").font(.fit(.sm)).foregroundStyle(FitColor.warn)
            }
            DisclosureGroup("Procedencia del producto") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Open Food Facts · código \(food.sourceCode) · revisión \(food.sourceRevision) · catálogo \(food.catalogVersion)")
                    Text("Recuperado: \(food.sourceRetrievedAt) · revisado: \(food.reviewedAt)")
                    Text("Si los valores difieren, prevalece la etiqueta actual del envase.")
                    if let url = nativeFoodSourceURL(food.sourceUrl) { Link("Ficha original · Open Food Facts", destination: url).fitLink(.sm) }
                }
                .font(.fit(.sm)).foregroundStyle(FitColor.muted).textSelection(.enabled).padding(.top, 8)
            }
            .font(.fit(.sm)).tint(FitColor.accentText)
        }
        .padding(16).fitCard(padding: 0, fill: FitColor.surface2)
    }

    private func amountShortcuts(_ food: NativeFood, portions: Bool) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                if !portions, let amount = preferences.lastAmount(food) {
                    Button("Última: \(FitFormat.number(amount, fraction: 2)) \(food.basisUnit)") { quantity = FitFormat.decimal(amount) }
                        .buttonStyle(FitButtonStyle(size: .sm))
                }
                ForEach(portions ? [0.5, 1, 2] : food.basisUnit == "ml" ? [100, 200, 250] : [50, 100, 200], id: \.self) { amount in
                    Button("\(FitFormat.number(amount, fraction: 2)) \(portions ? (amount == 1 ? "porción" : "porciones") : food.basisUnit)") {
                        if portions { portionCount = FitFormat.decimal(amount) } else { quantity = FitFormat.decimal(amount) }
                    }
                    .buttonStyle(FitButtonStyle(size: .sm))
                    .accessibilityHint("Completa la cantidad; no guarda la comida hasta que pulses Registrar")
                }
            }.disabled(working || pendingLog != nil)
        }
    }

    private func portionConfiguration(_ food: NativeFood) -> some View {
        DisclosureGroup("Configurar mi porción", isExpanded: Binding(get: { usePortions && preferences.portion(food) == nil || portionConfigurationExpanded }, set: { portionConfigurationExpanded = $0 })) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Equivalencia de una porción en \(food.basisUnit)").font(.fit(.sm, .medium))
                TextField("", text: $portionSize, prompt: fitPrompt("Ej.: 30"))
                    .fitNumericInput().fitField().focused($focused, equals: .portionSize)
                    .disabled(working || pendingLog != nil).accessibilityLabel("\(food.basisUnit) en una porción de \(food.name)")
                    .accessibilityHint("\(!portionSize.isEmpty && NativeFoodQuantity.amount(portionSize) == nil ? "Equivalencia inválida. " : "")Mayor que 0 y hasta 5.000 \(food.basisUnit), con hasta dos decimales. No se convierte entre gramos y mililitros.")
                Text("Elegís esta equivalencia a partir del envase o de tu medida. No se convierte entre gramos y mililitros.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                if !portionSize.isEmpty && NativeFoodQuantity.amount(portionSize) == nil {
                    Text("Usá un valor mayor que 0 y hasta 5.000 \(food.basisUnit), con hasta dos decimales.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.warn)
                }
                Button("Guardar mi porción en este dispositivo") {
                    guard let amount = NativeFoodQuantity.amount(portionSize) else { return }
                    preferences.setPortion(amount, for: food)
                    portionNotice = "Porción guardada: \(FitFormat.number(amount, fraction: 2)) \(food.basisUnit)."
                }
                .buttonStyle(FitButtonStyle()).disabled(working || owner == nil || NativeFoodQuantity.amount(portionSize) == nil || pendingLog != nil)
                if let portionNotice { Text(portionNotice).font(.fit(.sm)).foregroundStyle(FitColor.ok) }
            }.padding(.top, 8)
        }
        .font(.fit(.sm)).tint(FitColor.accentText)
    }
    @State private var portionConfigurationExpanded = false

    private func select(_ food: NativeFood, amount: Double?) {
        guard !working else { return }
        // Keep an unconfirmed draft until the user has reconciled it with the diary.
        guard pendingLog == nil else { focused = nil; return }
        selected = food; quantity = amount.map(FitFormat.decimal) ?? ""
        let size = preferences.portion(food)
        let count = size.flatMap { size in amount.flatMap { NativeFoodQuantity.portionCount(amount: $0, size: size) } }
        usePortions = preferences.prefersPortions(food) && (amount == nil || count != nil)
        portionCount = count.map(FitFormat.decimal) ?? "1"
        addOpen = true
        portionSize = preferences.portion(food).map(FitFormat.decimal) ?? ""
        portionNotice = nil; portionConfigurationExpanded = false
        logError = nil; savedNotice = nil; reconciliationNotice = nil; selectionRevision += 1; focused = nil
    }
    private func repeatFood(_ entry: NativeFoodEntry) -> NativeFood? {
        foods.first { $0.sourceCode == entry.source_code && $0.source == entry.source && $0.basisUnit == entry.basis_unit }
    }
    private func productLabel(_ food: NativeFood) -> String { "\(FitFormat.number(food.energyKcalPer100, fraction: 2)) kcal / 100 \(food.basisUnit)" }
    private func resetDraft() {
        selected = nil; quantity = ""; noTarget = false; logError = nil; savedNotice = nil; reconciliationNotice = nil
        usePortions = false; portionCount = "1"; portionSize = ""; portionNotice = nil
        portionConfigurationExpanded = false; pendingLog = nil; saving = false
        discardPending = false
    }
    private var draft: NativeFoodDraft {
        NativeFoodDraft(dateKey: key, search: search, foodReference: selected.map(preferences.reference),
                        quantity: quantity, usePortions: usePortions, portionCount: portionCount, portionSize: portionSize,
                        open: addOpen, attempt: pendingLog.map { NativeFoodDraft.Attempt(amount: $0.amount, knownIDs: $0.knownIDs, catalogVersion: $0.catalogVersion) })
    }
    private func persistDraft() {
        guard draftReady, let owner, preferences.owner == owner else { return }
        preferences.saveDraft(draft, owner: owner)
    }
    private func restoreDraft() {
        resetDraft(); search = ""; addOpen = false; date = Date()
        // A temporarily unavailable bundle must not overwrite a recoverable draft.
        guard catalogError == nil else { addOpen = true; draftReady = false; return }
        if let owner, let saved = preferences.draft(for: owner), let savedDate = NativeDate.parse(saved.dateKey) {
            date = savedDate; search = saved.search; addOpen = saved.open
            selected = foods.first { preferences.reference($0) == saved.foodReference }
            if let selected {
                quantity = saved.quantity; usePortions = saved.usePortions
                portionCount = saved.portionCount; portionSize = saved.portionSize
                if let attempt = saved.attempt {
                    pendingLog = PendingLog(food: selected, amount: attempt.amount, day: saved.dateKey, knownIDs: attempt.knownIDs, catalogVersion: attempt.catalogVersion)
                    logError = "Hay un intento de guardado pendiente de comprobación. Actualizá el diario antes de registrar otra vez."
                    addOpen = true
                }
            } else if saved.foodReference != nil {
                reconciliationNotice = "El producto del borrador ya no está en este catálogo o cambió su unidad. No se convirtió la cantidad; comprobá el diario antes de elegir otro producto."
                addOpen = true
            }
        }
        draftReady = true
    }
    private func loadCatalog() {
        do {
            let catalog = try nativeResource("foods-catalog.json", as: NativeFoodCatalog.self)
            foods = catalog.products; catalogVersion = catalog.catalogVersion; catalogError = nil
            seedPreferences()
        } catch { catalogError = "El catálogo incluido en la app no está disponible o no se puede leer. Reintentá abrirlo." }
    }
    private func seedPreferences() {
        guard let owner else { return }
        preferences.seed(entries: store.foodEntries, foods: foods, owner: owner)
    }

    private func log(_ food: NativeFood) {
        guard canRegister, pendingLog == nil, let amount = parsedAmount, let action = NativeFoodAction(store) else { return }
        let day = snapshot
        let calculated = NativeEnergy.snapshot(NativeEnergy.report(profile: store.profile, weights: store.weights, sessions: store.sessions, date: date))
        let target = day != nil ? day?.target_kcal : noTarget ? nil : calculated.target
        let tdee = day != nil ? day?.tdee_kcal : noTarget ? nil : calculated.tdee
        let attempt = PendingLog(food: food, amount: amount, day: key, knownIDs: Set(entries.map(\.id)), catalogVersion: food.catalogVersion)
        saving = true; pendingLog = attempt; logError = nil; savedNotice = nil; reconciliationNotice = nil; focused = nil
        persistDraft()
        Task {
            guard action.isCurrent(store) else { return }
            var mutationError: String?
            let succeeded = await store.run {
                do {
                    try action.check(store)
                    try await store.api.rpc("log_food_entry", body: [
                        "p_logged_on": attempt.day, "p_target_kcal": nativeNull(target), "p_tdee_kcal": nativeNull(tdee), "p_catalog_version": food.catalogVersion,
                        "p_source_code": food.sourceCode, "p_source_revision": food.sourceRevision, "p_source_url": food.sourceUrl, "p_source_retrieved_at": food.sourceRetrievedAt,
                        "p_source_response_sha256": food.sourceResponseSha256, "p_reviewed_at": food.reviewedAt, "p_food_name": food.name, "p_brand": food.brand,
                        "p_basis_unit": food.basisUnit, "p_quantity": amount, "p_energy_kcal_per_100": food.energyKcalPer100,
                    ])
                    try action.check(store)
                } catch { mutationError = error.localizedDescription; throw error }
            }
            guard action.isCurrent(store), key == attempt.day else { return }
            saving = false
            if succeeded {
                finishLog(attempt, owner: action.owner)
            } else {
                pendingLog = attempt
                logError = mutationError ?? foodState.error ?? "No se pudo confirmar el guardado. Actualizá e intentá de nuevo."
            }
        }
    }

    private func retryLog() {
        guard !working, let pending = pendingLog, let action = NativeFoodAction(store), key == pending.day else { return }
        saving = true; focused = nil
        Task {
            guard action.isCurrent(store) else { return }
            await store.refresh(force: true)
            guard action.isCurrent(store), key == pending.day else { return }
            saving = false
            guard confirmedData else {
                logError = foodState.error ?? "No pudimos comprobar si se guardó. Tu cantidad se conserva; reintentá cuando haya conexión."
                return
            }
            let found = entries.contains {
                !pending.knownIDs.contains($0.id) && $0.source_code == pending.food.sourceCode && $0.source == pending.food.source &&
                $0.basis_unit == pending.food.basisUnit && $0.quantity == pending.amount && $0.catalog_version == pending.catalogVersion
            }
            if found { finishLog(pending, owner: action.owner) }
            else {
                // No idempotency token: absence in one GET never authorizes an automatic resend.
                pendingLog = nil; logError = nil
                persistDraft()
                reconciliationNotice = "No encontramos el registro en esta actualización. El intento anterior podría seguir procesándose. Revisá el diario: la cantidad solo se volverá a enviar si pulsás Registrar comida."
            }
        }
    }
    private func finishLog(_ attempt: PendingLog, owner: String) {
        preferences.record(attempt.food, amount: attempt.amount, owner: owner)
        selected = nil; quantity = ""; logError = nil; pendingLog = nil; reconciliationNotice = nil
        persistDraft()
        savedNotice = "El servidor confirmó el registro de \(FitFormat.number(attempt.amount, fraction: 2)) \(attempt.food.basisUnit) de \(attempt.food.name)." + (confirmedData ? "" : " El resumen sigue pendiente de actualización; no vuelvas a enviar esta comida.")
    }
}

struct NativeFoodEntryRow: View {
    @EnvironmentObject var store: NativeStore
    let entry: NativeFoodEntry
    @ObservedObject var preferences: NativeFoodPreferences
    var focus: FocusState<NativeFoodInput?>.Binding
    var onRepeat: (() -> Void)? = nil
    @State private var editing = false
    @State private var quantity = ""
    @State private var editPortions = false
    @State private var portionCount = "1"
    @State private var errorMessage: String?
    @State private var notice: String?
    @State private var failedDeletion = false
    @State private var pending: Confirmation?
    @State private var saving = false
    private enum Confirmation { case edit(Double), delete }
    private var working: Bool { saving || store.busy }
    private var foodState: NativeFoodAvailability.ReadState { .init(store.domainState(.foods)) }
    private var portion: Double? { preferences.portion(source: entry.source, code: entry.source_code, unit: entry.basis_unit) }
    private var exactCount: Double? { portion.flatMap { NativeFoodQuantity.portionCount(amount: entry.quantity, size: $0) } }
    private var editedAmount: Double? {
        if editPortions { return portion.flatMap { NativeFoodQuantity.portionAmount(count: portionCount, size: $0) } }
        return NativeFoodQuantity.amount(quantity)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(entry.food_name).font(.fit(.base, .medium))
            Text("\(FitFormat.number(entry.quantity, fraction: 2)) \(entry.basis_unit) · \(FitFormat.number(entry.kcal, fraction: 1)) kcal")
                .font(.fit(.base, .semibold)).monospacedDigit()
            if !entry.brand.isEmpty { Text(entry.brand).font(.fit(.sm)).foregroundStyle(FitColor.muted) }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { actions }
                VStack(alignment: .leading, spacing: 8) { actions }
            }
            if editing { editFields }
            if let errorMessage {
                FitErrorNote(title: "No se confirmó el cambio", message: errorMessage)
                Button("Actualizar diario") { Task { await store.refresh(force: true) } }
                    .buttonStyle(FitButtonStyle()).disabled(working || foodState.loading)
                if failedDeletion {
                    Button("Reintentar borrado") { pending = .delete }
                        .buttonStyle(FitButtonStyle(variant: .danger)).disabled(working)
                }
            }
            if let notice { Text(notice).font(.fit(.sm)).foregroundStyle(FitColor.ok) }
            DisclosureGroup("Detalles y procedencia") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(FitFormat.number(entry.energy_kcal_per_100, fraction: 2)) kcal / 100 \(entry.basis_unit)")
                    Text("Open Food Facts · código \(entry.source_code) · revisión \(entry.source_revision) · catálogo \(entry.catalog_version) al registrar")
                    Text("Recuperado: \(entry.source_retrieved_at) · revisado: \(entry.reviewed_at)")
                    if let url = nativeFoodSourceURL(entry.source_url) { Link("Ficha original · Open Food Facts", destination: url).fitLink(.sm) }
                }.font(.fit(.sm)).foregroundStyle(FitColor.muted).textSelection(.enabled).padding(.top, 8)
            }.font(.fit(.sm)).tint(FitColor.accentText)
        }
        .padding(.vertical, 12)
        .fitNavigationDraft(editing || saving || pending != nil)
        .confirmationDialog(confirmationTitle, isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
            if let pending {
                switch pending {
                case .edit(let amount):
                    Button("Confirmar nueva cantidad") { mutate(amount: amount) }
                case .delete:
                    Button("Borrar comida", role: .destructive) { mutate(amount: nil) }
                }
            }
            Button("Cancelar", role: .cancel) { pending = nil }
        } message: { Text(confirmationMessage) }
        .onReceive(store.accountChanges) { _ in resetEditing() }
        .onChange(of: store.auth.generation) { _, _ in resetEditing() }
        .onChange(of: entry.quantity) { _, amount in
            if errorMessage != nil, editing, editedAmount == amount {
                editing = false; errorMessage = nil; failedDeletion = false
                notice = "La nueva cantidad ya aparece en el diario."
            }
        }
    }

    @ViewBuilder private var actions: some View {
        Button(editing ? "Cancelar edición" : "Editar cantidad") {
            editing.toggle(); quantity = FitFormat.decimal(entry.quantity); errorMessage = nil; notice = nil; failedDeletion = false
            editPortions = false; portionCount = exactCount.map(FitFormat.decimal) ?? "1"
            focus.wrappedValue = editing ? .entry(entry.id) : nil
        }
        .buttonStyle(FitButtonStyle(size: .sm)).disabled(working)
        .accessibilityLabel("\(editing ? "Cancelar edición de" : "Editar cantidad de") \(entry.food_name)")
        if let onRepeat {
            Button("Repetir") { focus.wrappedValue = nil; onRepeat() }
                .buttonStyle(FitButtonStyle(size: .sm)).disabled(working)
                .accessibilityLabel("Repetir \(FitFormat.number(entry.quantity, fraction: 2)) \(entry.basis_unit) de \(entry.food_name)")
                .accessibilityHint("Prepara la misma cantidad; revisá las calorías antes de registrar")
        }
        Button("Borrar") { focus.wrappedValue = nil; pending = .delete }
            .buttonStyle(FitButtonStyle(variant: .danger, size: .sm)).disabled(working)
            .accessibilityLabel("Borrar \(entry.food_name)").accessibilityHint("Solicita confirmación antes de borrar")
    }

    private var editFields: some View {
        let amount = editedAmount
        return VStack(alignment: .leading, spacing: 8) {
            if let portion, exactCount != nil {
                Picker("Cómo editar la cantidad", selection: Binding(get: { editPortions }, set: { value in
                    if value {
                        guard let amount = NativeFoodQuantity.amount(quantity),
                              let count = NativeFoodQuantity.portionCount(amount: amount, size: portion) else { return }
                        portionCount = FitFormat.decimal(count)
                    } else if let amount = editedAmount { quantity = FitFormat.decimal(amount) }
                    editPortions = value
                })) {
                    Text("Cantidad en \(entry.basis_unit)").tag(false)
                    Text("Mis porciones").tag(true)
                }
                .pickerStyle(.menu).font(.fit(.sm)).tint(FitColor.accentText).fitMinimumHitArea().disabled(working)
                Text("1 porción = \(FitFormat.number(portion, fraction: 2)) \(entry.basis_unit) · configurada por vos")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted)
            }
            Text(editPortions ? "Número de porciones" : "Nueva cantidad en \(entry.basis_unit)").font(.fit(.sm, .medium))
            TextField("", text: editPortions ? $portionCount : $quantity, prompt: fitPrompt("Cantidad"))
                .fitNumericInput().fitField().focused(focus, equals: .entry(entry.id)).disabled(working)
                .accessibilityLabel(editPortions ? "Número de porciones de \(entry.food_name)" : "Nueva cantidad de \(entry.food_name) en \(entry.basis_unit)")
                .accessibilityHint("\(amount == nil ? "Cantidad inválida. " : "")La equivalencia debe ser mayor que 0, hasta 5.000 \(entry.basis_unit) y exacta a dos decimales. Usá coma o punto.")
            if let amount {
                Text("\(FitFormat.number(amount, fraction: 2)) \(entry.basis_unit) → \(FitFormat.number(amount * entry.energy_kcal_per_100 / 100, fraction: 1)) kcal estimadas")
                    .font(.fit(.sm, .medium)).monospacedDigit()
            } else {
                Text(editPortions ? "La equivalencia de las porciones debe ser exacta a dos decimales y hasta 5.000 \(entry.basis_unit). No se redondea automáticamente." : "Ingresá una cantidad mayor que 0 y hasta 5.000 \(entry.basis_unit), con hasta dos decimales. Usá coma o punto, sin separador de miles.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.warn)
            }
            Button(working ? "Guardando…" : errorMessage == nil ? "Revisar y guardar cambio" : "Revisar y reintentar cambio") {
                guard let amount else { return }
                focus.wrappedValue = nil; pending = .edit(amount)
            }
            .buttonStyle(FitButtonStyle()).disabled(working || amount == nil || amount == entry.quantity)
        }
    }
    private var confirmationTitle: String {
        if case .edit = pending { return "¿Cambiar la cantidad?" }
        return "¿Borrar esta comida?"
    }
    private var confirmationMessage: String {
        if case .edit(let amount) = pending {
            return "\(entry.food_name): de \(FitFormat.number(entry.quantity, fraction: 2)) a \(FitFormat.number(amount, fraction: 2)) \(entry.basis_unit). El registro pasará de \(FitFormat.number(entry.kcal, fraction: 1)) a \(FitFormat.number(amount * entry.energy_kcal_per_100 / 100, fraction: 1)) kcal."
        }
        return "Se borrarán \(FitFormat.number(entry.quantity, fraction: 2)) \(entry.basis_unit) de \(entry.food_name) (\(FitFormat.number(entry.kcal, fraction: 1)) kcal). El objetivo del día no cambia."
    }
    private func mutate(amount: Double?) {
        guard !working, let action = NativeFoodAction(store), action.owner == entry.user_id else { return }
        saving = true; pending = nil; errorMessage = nil; notice = nil; failedDeletion = false
        Task {
            guard action.isCurrent(store) else { return }
            var mutationError: String?
            let succeeded = await store.run {
                do {
                    try action.check(store)
                    if let amount {
                        try await store.api.rpc("set_food_entry_quantity", body: ["p_id": entry.id, "p_quantity": amount])
                    } else {
                        try await store.api.rpc("delete_food_entry", body: ["p_id": entry.id])
                    }
                    try action.check(store)
                } catch { mutationError = error.localizedDescription; throw error }
            }
            guard action.isCurrent(store) else { return }
            saving = false
            if succeeded {
                editing = false
                let freshDiary = foodState.confirmed
                notice = (amount == nil ? "El servidor confirmó el borrado." : "El servidor confirmó la nueva cantidad.") + (freshDiary ? "" : " El diario sigue pendiente de actualización; no repitas el cambio.")
            } else {
                failedDeletion = amount == nil
                errorMessage = mutationError ?? foodState.error ?? "No se pudo confirmar el cambio. Actualizá el diario o reintentá; el borrador se conserva."
            }
        }
    }
    private func resetEditing() {
        editing = false; quantity = ""; editPortions = false; portionCount = "1"; errorMessage = nil; pending = nil; saving = false
        notice = nil; failedDeletion = false
    }
}

private func nativeFoodSourceURL(_ text: String) -> URL? {
    guard let url = URL(string: text), url.scheme == "https", let host = url.host,
          host == "openfoodfacts.org" || host.hasSuffix(".openfoodfacts.org") else { return nil }
    return url
}

struct NativeAttributionView: View {
    @State private var content = ""
    @State private var metadata: [String: String] = [:]
    @State private var error: String?
    var body: some View {
        FitPage(refreshable: false) {
            FitPageHeader(title: "Atribución", subtitle: "Catálogo de alimentos · Open Food Facts", showsBack: true)
            VStack(alignment: .leading, spacing: 12) {
                Text("Datos de productos: Open Food Facts").font(.fit(.base, .semibold))
                Text("La etiqueta actual del envase prevalece. Este catálogo no incluye imágenes ni datos del diario privado.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                Link("Open Food Facts", destination: URL(string: "https://world.openfoodfacts.org")!).fitLink(.sm)
                Link("Licencia de la base de datos · ODbL 1.0", destination: URL(string: "https://opendatacommons.org/licenses/odbl/1-0/")!).fitLink(.sm)
                Link("Licencia del contenido · DbCL 1.0", destination: URL(string: "https://opendatacommons.org/licenses/dbcl/1-0/")!).fitLink(.sm)
                if let error {
                    FitErrorNote(title: "No se pudo abrir la atribución completa", message: error)
                    Button("Reintentar") { load() }.buttonStyle(FitButtonStyle())
                } else if !content.isEmpty {
                    DisclosureGroup("Detalles técnicos y documento completo") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Versión: \(metadata["catalogVersion"] ?? "No disponible")").font(.fit(.sm))
                            Text(content).font(.caption.monospaced()).foregroundStyle(FitColor.ink2).textSelection(.enabled)
                        }.padding(.top, 8)
                    }.font(.fit(.sm)).tint(FitColor.accentText)
                }
            }.fitCard()
        }
        .task { load() }
    }
    private func load() {
        do {
            guard let url = Bundle.main.url(forResource: "foods-catalog-attribution.json", withExtension: nil, subdirectory: "NativeResources") else { throw NativeFailure.message("Falta la atribución del catálogo.") }
            let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
            metadata = (object as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
            content = String(data: try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8) ?? ""
            error = nil
        } catch { self.error = "El documento de atribución incluido en la app no está disponible o no se puede leer." }
    }
}
