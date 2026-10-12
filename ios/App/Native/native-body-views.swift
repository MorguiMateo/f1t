import Charts
import SwiftUI

/// Validation never substitutes a different measurement for the user's draft.
enum FitMeasure: Equatable {
    case empty, invalid, value(Double)
    init(_ raw: String, min: Double, max: Double, decimals: Int) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { self = .empty; return }
        let normalized = text.replacingOccurrences(of: ",", with: ".")
        guard normalized.range(of: #"^\d+(?:\.\d+)?$"#, options: .regularExpression) != nil,
              (normalized.split(separator: ".").dropFirst().first?.count ?? 0) <= decimals,
              let parsed = nativeNumber(text), parsed >= min, parsed <= max else { self = .invalid; return }
        let factor = pow(10, Double(decimals))
        guard abs(parsed * factor - (parsed * factor).rounded()) < 0.000001 else { self = .invalid; return }
        self = .value((parsed * factor).rounded() / factor)
    }
}

/// Shared only by the body views: acknowledge the returned row before a background
/// refresh. Identity guards apply before both publishing and presenting feedback.
@MainActor
enum NativeBodyMutation {
    static func refresh(_ store: NativeStore, action: NativeWorkoutAction) {
        Task {
            guard action.isCurrent(in: store.auth) else { return }
            await store.refresh(force: true)
        }
    }

    /// Only use after an identity-checked ACK row/deletion has been published.
    /// Disk failure is a local warning, not a failed remote write. Do not refresh
    /// an unpersisted ACK automatically: the confirmed UI row must remain visible.
    static func acknowledge(_ store: NativeStore, action: NativeWorkoutAction) -> String? {
        guard action.isCurrent(in: store.auth) else { return nil }
        do {
            try store.acknowledgeConfirmedMutation(action: action)
            refresh(store, action: action)
            return nil
        } catch {
            guard action.isCurrent(in: store.auth) else { return nil }
            return error.localizedDescription
        }
    }

    struct ProfileAcknowledgement {
        let row: NativeBodyProfile
        let localWarning: String?
    }

    static func profile(_ store: NativeStore, patch: [String: Any], action: NativeWorkoutAction) async throws -> ProfileAcknowledgement {
        try action.check(in: store.auth)
        // A partial upsert works for both absent and existing rows atomically.
        // Insert defaults come from the schema (owner = auth.uid(), goal = maintain);
        // conflict updates touch only payload columns, never the stale local profile.
        // Explicit NSNull values still clear the edited optional field.
        let data = try await store.api.request("rest/v1/body_profile", method: "POST",
            query: [URLQueryItem(name: "on_conflict", value: "user_id")], body: patch,
            prefer: "return=representation,resolution=merge-duplicates,missing=default")
        try action.check(in: store.auth)
        guard let row = try JSONDecoder().decode([NativeBodyProfile].self, from: data).first,
              row.user_id == store.auth.session?.user.id else {
            throw NativeFailure.message("No se pudo confirmar el guardado. Conservamos tu valor para reintentar.")
        }
        store.profile = row
        let localWarning = acknowledge(store, action: action)
        return ProfileAcknowledgement(row: row, localWarning: localWarning)
    }
}

/// An error with cached data must never be presented as an empty history.
private struct NativeBodyLoadNote: View {
    @EnvironmentObject var store: NativeStore
    private var bodyState: NativeDomainState { store.domainState(.body) }
    var title = "No se pudieron actualizar los datos"
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = bodyState.error {
                FitErrorNote(title: title, message: error)
            }
            if bodyState.usingCachedData {
                Text("Mostramos la última copia guardada. Puede no incluir los cambios más recientes.")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted)
            }
            if bodyState.error != nil || bodyState.usingCachedData {
                Button(store.refreshing ? "Actualizando…" : "Reintentar actualización") {
                    Task { await store.refresh() }
                }
                .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
                .disabled(store.refreshing)
            }
        }
    }
}

// MARK: - Perfil

/// Drafts are not registered commands. A pending journal must be reviewed, never implicitly discarded.
enum NativeSignOutPolicy {
    enum Decision: Equatable { case close, review, wait }
    static func decision(drafts: Int, outbox: Int, unreadable: Bool, bodyPending: Bool, syncing: Bool) -> Decision {
        if bodyPending || syncing { return .wait }
        return unreadable || drafts > 0 || outbox > 0 ? .review : .close
    }
}

@MainActor
enum NativeProfileRoute {
    static var targetRequested = false
    static let changed = Notification.Name("nativeProfileRouteChanged")
    static func requestTarget() {
        targetRequested = true
        NotificationCenter.default.post(name: changed, object: nil)
    }
}

struct NativeProfileView: View {
    @EnvironmentObject var store: NativeStore
    private var bodyState: NativeDomainState { store.domainState(.body) }
    @State private var profilePath = NavigationPath()
    @State private var signingOut = false
    @State private var bodyHasDraft = false
    @State private var reviewSignOut = false
    @State private var confirmDiscard = false
    @State private var signOutAction: NativeWorkoutAction?
    @State private var signOutGeneration: UUID?
    @State private var signOutMessage: String?
    @State private var signOutReadError: String?
    @State private var draftCount = 0
    @State private var outboxCount = 0
    @State private var pendingTotal = 0
    @State private var pendingDates: [String] = []

    var body: some View {
        NavigationStack(path: $profilePath) {
            ScrollViewReader { proxy in
              FitPage {
                FitPageHeader(title: "Perfil", subtitle: "Tu objetivo, datos para estimaciones y preferencias")
                if bodyState.loaded {
                    NativeBodyLoadNote().padding(.top, 16)
                    NativeBodyProfileCard(onPendingChanges: { bodyHasDraft = $0 }).padding(.top, 16)
                    NativeEnergyCardView().padding(.top, 16)
                } else if bodyState.loading {
                    FitCardsSkeleton(count: 2).padding(.top, 16)
                } else if bodyState.error != nil {
                    NativeBodyLoadNote(title: "No se pudo cargar el perfil").padding(.top, 16)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tu perfil todavía no se cargó.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        Button("Cargar perfil") { Task { await store.refresh() } }.fitLink()
                    }.padding(.top, 16)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text("Preferencias de entrenamiento").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
                    Text("Avisos de descanso, pantalla bloqueada y recordatorios de este iPhone.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    DisclosureGroup {
                        NativeTrainingStatusSettingsView().padding(.top, 12)
                        NativeReminderSettingsView().padding(.top, 16)
                    } label: {
                        Text("Configurar avisos y recordatorios").font(.fit(.sm)).fitMinimumHitArea()
                    }
                }.fitCard().padding(.top, 16)
                Text("Cuenta").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader).padding(.top, 24)
                account.padding(.top, 12)
                Button(signingOut ? "Cerrando sesión…" : "Cerrar sesión", action: requestSignOut)
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, fullWidth: true))
                    .disabled(signingOut || store.busy).padding(.top, 16)
                if let signOutMessage {
                    Text(signOutMessage).font(.fit(.sm)).foregroundStyle(FitColor.warn).padding(.top, 12)
                }
                Text("Tus registros pertenecen a tu cuenta. Antes de salir revisaremos los borradores y cambios locales pendientes. Al cerrar sesión se limpian los widgets y recordatorios de este dispositivo.")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 12)
              }
              .onAppear { consumeProfileRoute(proxy) }
              .onChange(of: bodyState.loaded) { _, loaded in if loaded { consumeProfileRoute(proxy) } }
              .onReceive(NotificationCenter.default.publisher(for: NativeProfileRoute.changed)) { _ in consumeProfileRoute(proxy) }
            }
        }
        .fitTabRoot(isDirty: bodyHasDraft || signingOut || reviewSignOut) { profilePath = NavigationPath() }
        .sheet(isPresented: $reviewSignOut) { signOutReview }
        .onChange(of: store.workoutSyncRevision) { _, _ in if reviewSignOut { readPending() } }
        .onReceive(store.accountChanges) { _ in
            reviewSignOut = false; confirmDiscard = false; signOutAction = nil; signOutGeneration = nil; signOutMessage = nil; bodyHasDraft = false
            draftCount = 0; outboxCount = 0; pendingTotal = 0; pendingDates = []; signOutReadError = nil; signingOut = false
        }
    }
    private func consumeProfileRoute(_ proxy: ScrollViewProxy) {
        guard NativeProfileRoute.targetRequested, bodyState.loaded else { return }
        NativeProfileRoute.targetRequested = false
        proxy.scrollTo("native-body-target", anchor: .top)
    }
    private func requestSignOut() {
        // Body writes are online acknowledgements, not entries in the workout outbox.
        guard !bodyHasDraft else {
            signOutMessage = "Hay datos corporales sin guardar. Salí del campo para guardarlos y revisá cualquier error antes de cerrar sesión."; return
        }
        signOutAction = NativeWorkoutAction(auth: store.auth); signOutGeneration = store.auth.generation; signOutMessage = nil
        readPending()
        switch NativeSignOutPolicy.decision(drafts: draftCount, outbox: outboxCount, unreadable: signOutReadError != nil, bodyPending: bodyHasDraft, syncing: store.workoutSyncing) {
        case .review: reviewSignOut = true
        case .close: finishSignOut(discard: false)
        case .wait: signOutMessage = "Esperá a que termine el guardado o la sincronización antes de cerrar sesión."
        }
    }
    private func readPending() {
        guard let action = signOutAction, action.isCurrent(in: store.auth), let owner = store.auth.session?.user.id else { return }
        do {
            let pending = try store.auth.pendingWorkoutChanges()
            let envelope = try store.workoutRepository.read(owner: owner)
            draftCount = pending.drafts; outboxCount = pending.operations; pendingTotal = pending.total
            pendingDates = Array(Set(envelope.outbox.map(\.date) + envelope.drafts.keys.compactMap { key in key.split(separator: "\u{1f}", omittingEmptySubsequences: false).first.map(String.init) })).filter { NativeDate.parse($0) != nil }.sorted().reversed()
            signOutReadError = nil
        } catch { signOutReadError = "No se pudo revisar el progreso local. Desbloqueá el iPhone y reintentá. \(error.localizedDescription)" }
    }
    private func finishSignOut(discard: Bool) {
        guard let action = signOutAction, let generation = signOutGeneration, action.isCurrent(in: store.auth), !bodyHasDraft, !store.busy, !store.workoutSyncing else { return }
        signingOut = true
        Task {
            guard action.isCurrent(in: store.auth) else { signingOut = false; return }
            await store.auth.signOut(discardUnsyncedWorkouts: discard, expectedGeneration: generation)
            guard store.auth.session == nil || store.auth.generation == generation else { return }
            signingOut = false
            if store.auth.session != nil { signOutMessage = store.auth.error; readPending() }
            else { reviewSignOut = false }
        }
    }
    private var signOutReview: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Antes de cerrar sesión").font(.fit(.xl2, .bold))
                    Text("\(pendingTotal) elementos locales pendientes").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    Text("\(draftCount) borradores sin registrar").font(.fit(.base, .semibold))
                    Text("Los borradores no son series registradas y no se envían al sincronizar. Revisalos en el entrenamiento para decidir qué registrar.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    Text("\(outboxCount) cambios registrados pendientes de sincronizar").font(.fit(.base, .semibold))
                    Text("Estos cambios ya están guardados en este iPhone. Podés intentar enviarlos sin registrar ningún borrador.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    if let signOutReadError { Text(signOutReadError).font(.fit(.sm)).foregroundStyle(FitColor.warn) }
                    if let message = store.workoutSyncError { Text(message).font(.fit(.sm)).foregroundStyle(FitColor.warn) }
                    Button(store.workoutSyncing ? "Sincronizando…" : "Sincronizar cambios registrados") {
                        guard let action = signOutAction, action.isCurrent(in: store.auth) else { return }
                        store.retryWorkoutSync()
                    }.buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true))
                        .disabled(store.workoutSyncing || signingOut || outboxCount == 0 || signOutReadError != nil)
                    ForEach(pendingDates, id: \.self) { date in
                        NavigationLink {
                            NativeWorkoutView(date: NativeDate.parse(date) ?? Date())
                        } label: {
                            Label("Revisar entrenamiento del \(FitFormat.fieldDay(NativeDate.parse(date) ?? Date()))", systemImage: "chevron.right")
                                .font(.fit(.sm)).fitMinimumHitArea()
                        }
                    }
                    Button("Volver a revisar estado", action: readPending).fitLink(.sm)
                    if draftCount == 0 && outboxCount == 0 && signOutReadError == nil {
                        Button("Cerrar sesión sin descartar cambios") { finishSignOut(discard: false) }
                            .buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true)).disabled(store.workoutSyncing || signingOut)
                    }
                    Button("Cancelar y conservar todo") { reviewSignOut = false }
                        .buttonStyle(FitButtonStyle(fullWidth: true))
                    if draftCount > 0 || outboxCount > 0 || signOutReadError != nil {
                        Button("Descartar progreso local y salir", role: .destructive) {
                            confirmDiscard = true
                        }.buttonStyle(FitButtonStyle(variant: .danger, fullWidth: true)).disabled(store.workoutSyncing || signingOut)
                    }
                }.padding(20)
            }.background(FitColor.ground)
        }
        .alert("¿Descartar cambios locales y cerrar sesión?", isPresented: $confirmDiscard) {
            Button("Descartar y cerrar sesión", role: .destructive) { finishSignOut(discard: true) }
            Button("Conservar y seguir en F1t", role: .cancel) {}
        } message: {
            Text("Se eliminarán los borradores sin registrar y cambios de entrenamiento pendientes de este iPhone. Lo que ya se sincronizó no se borra. Esta acción no se puede deshacer.")
        }
    }

    private var account: some View {
        let user = store.auth.session?.user
        let name = user?.user_metadata?.fullName
        return HStack(spacing: 16) {
            AsyncImage(url: user?.user_metadata?.avatarURL.flatMap { URL(string: $0) }) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Text(String((name ?? user?.email ?? "?").prefix(1)).uppercased())
                    .font(.fit(.lg, .semibold))
                    .foregroundStyle(FitColor.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(FitColor.surface2)
            }
            .frame(width: 56, height: 56)
            .clipShape(Circle())
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let name { Text(name).font(.fit(.base, .semibold)).fixedSize(horizontal: false, vertical: true) }
                Text(user?.email ?? "Cuenta Google").font(.fit(.sm)).foregroundStyle(FitColor.muted).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .fitCard(padding: 0)
    }
}

/// Each draft has its own acknowledgement. A successful older write cannot make
/// newer typing look saved, and refreshes only replace fields with no local draft.
struct NativeBodyProfileCard: View {
    var onPendingChanges: (Bool) -> Void = { _ in }
    @EnvironmentObject var store: NativeStore
    private var bodyState: NativeDomainState { store.domainState(.body) }
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var drafts: [Field: String] = [:]
    @State private var acknowledged: [Field: String] = [:]
    @State private var submitted: [Field: String] = [:]
    @State private var requests: [Field: UUID] = [:]
    @State private var failures: [Field: String] = [:]
    @State private var localWarnings: [Field: String] = [:]
    @State private var validation: [Field: String] = [:]
    @State private var saveTail: Task<Void, Never>?
    @State private var initialized = false
    @State private var draftOwner: NativeWorkoutAction?
    @FocusState private var focus: Field?
    private enum Field: String, CaseIterable {
        case height = "height_cm", birth = "birth_date", sex, goal, target = "target_weight_kg"
    }
    private static let minBirth = NativeDate.parse("1900-01-01")!
    private static let goals = [("lose", "Bajar", "Ajuste de −500 kcal"), ("maintain", "Mantener", "Sin ajuste"), ("gain", "Subir", "Ajuste de +300 kcal")]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Datos para estimaciones").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            Text("Son opcionales para usar F1t. Para estimar el gasto necesitás altura, fecha de nacimiento, sexo para la fórmula y un peso registrado.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
            field(.height, label: "Altura", hint: "Centímetros (cm) · 80–260, sin decimales") {
                TextField("", text: binding(.height), prompt: fitPrompt("Ej.: 178"))
                    .fitNumericInput(allowsDecimal: false).focused($focus, equals: .height).fitField(fill: FitColor.surface2)
                    .accessibilityLabel("Altura en centímetros")
                    .accessibilityHint("Entre 80 y 260, sin decimales. Vacío elimina la altura.")
            }
            field(.birth, label: "Fecha de nacimiento", hint: ageLabel) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { birthPicker; removeBirth }
                    VStack(alignment: .leading, spacing: 8) { birthPicker; removeBirth }
                }
            }
            field(.sex, label: "Sexo para la fórmula", hint: "Opcional; solo se usa para estimar el gasto") {
                choice(options: [("female", "Mujer", nil), ("male", "Hombre", nil)], value: draft(.sex)) { value in
                    change(.sex, value: value); commit(.sex)
                }
                if !draft(.sex).isEmpty {
                    Button("Quitar sexo") { change(.sex, value: ""); commit(.sex) }
                        .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
                }
            }
            Divider().padding(.vertical, 4)
            Text("Objetivo corporal").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader).id("native-body-target")
            Text("La meta de peso es una referencia para la curva; no cambia por sí sola la estimación de calorías.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
            field(.goal, label: "Objetivo", hint: "Ajuste orientativo de la estimación") {
                choice(options: Self.goals.map { ($0.0, $0.1, Optional($0.2)) }, value: draft(.goal)) { value in
                    change(.goal, value: value); commit(.goal)
                }
            }
            field(.target, label: "Peso objetivo", hint: "Kilogramos (kg) · 20–400, hasta 1 decimal · opcional") {
                TextField("", text: binding(.target), prompt: fitPrompt("Ej.: 75,5"))
                    .fitNumericInput().focused($focus, equals: .target).fitField(fill: FitColor.surface2)
                    .accessibilityLabel("Peso objetivo en kilogramos")
                    .accessibilityHint("Entre 20 y 400, hasta un decimal. Vacío elimina el objetivo.")
            }
            Text("Los números se guardan al salir del campo o tocar Listo; las opciones, al elegirlas. Los datos son opcionales y se usan en estimaciones.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted)
        }
        .padding(20).fitCard(padding: 0)
        .fitKeyboardDone { focus = nil }
        .onAppear { synchronize(); onPendingChanges(hasPendingChanges) }
        .fitNavigationDraft(hasPendingChanges)
        .onChange(of: hasPendingChanges) { _, pending in onPendingChanges(pending) }
        .onDisappear { if let field = focus { commit(field) }; focus = nil }
        .onChange(of: store.profile?.updated_at) { _, _ in synchronize() }
        .onChange(of: bodyState.loaded) { _, loaded in if loaded { synchronize() } }
        .onChange(of: store.auth.generation) { _, _ in reset() }
        .onReceive(store.accountChanges) { _ in reset() }
        .onChange(of: focus) { old, _ in
            if let old, initialized { commit(old) }
        }
    }

    private var hasPendingChanges: Bool {
        !submitted.isEmpty || !failures.isEmpty || !validation.isEmpty || Field.allCases.contains { draft($0) != acknowledged[$0] }
    }

    private var ageLabel: String? {
        NativeDate.age(draft(.birth).isEmpty ? nil : draft(.birth), on: Date()).map { "\($0) años · opcional" } ?? "Opcional"
    }
    private var birthPicker: some View {
        FitDateField(date: Binding(get: { NativeDate.parse(draft(.birth)) }, set: { value in
            change(.birth, value: value.map(NativeDate.key) ?? ""); commit(.birth)
        }), range: Self.minBirth...Date(), fill: FitColor.surface2, label: "Fecha de nacimiento", placeholder: "Agregar", initial: NativeDate.parse("1995-01-01"))
    }
    @ViewBuilder private var removeBirth: some View {
        if !draft(.birth).isEmpty {
            Button("Quitar fecha") { change(.birth, value: ""); commit(.birth) }
                .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
        }
    }
    private func values(_ p: NativeBodyProfile?) -> [Field: String] {
        [.height: p?.height_cm.map(FitFormat.plain) ?? "", .target: p?.target_weight_kg.map(FitFormat.plain) ?? "",
         .birth: p?.birth_date ?? "", .sex: p?.sex ?? "", .goal: p?.goal ?? "maintain"]
    }
    private func draft(_ key: Field) -> String { drafts[key] ?? (key == .goal ? "maintain" : "") }
    private func binding(_ key: Field) -> Binding<String> {
        Binding(get: { draft(key) }, set: { change(key, value: $0) })
    }
    private func change(_ key: Field, value: String) {
        drafts[key] = value
        validation[key] = nil
        failures[key] = nil
    }
    private func synchronize() {
        guard bodyState.loaded, store.profile == nil || store.profile?.user_id == store.auth.session?.user.id else { return }
        if !initialized { draftOwner = NativeWorkoutAction(auth: store.auth) }
        let current = values(store.profile)
        for key in Field.allCases {
            if !initialized || (draft(key) == acknowledged[key] && submitted[key] == nil && failures[key] == nil && focus != key) {
                drafts[key] = current[key]; acknowledged[key] = current[key]
            }
        }
        initialized = true
    }
    private func reset() {
        // Requests already sent may finish on the server, but must not touch another account's drafts.
        saveTail?.cancel(); saveTail = nil; initialized = false; draftOwner = nil
        drafts = [:]; acknowledged = [:]; submitted = [:]; requests = [:]; failures = [:]; localWarnings = [:]; validation = [:]
        focus = nil
    }
    private func validated(_ key: Field, _ raw: String) -> (value: Any, canonical: String)? {
        if key == .height || key == .target {
            let isHeight = key == .height
            switch FitMeasure(raw, min: isHeight ? 80 : 20, max: isHeight ? 260 : 400, decimals: isHeight ? 0 : 1) {
            case .empty: return (NSNull(), "")
            case .invalid:
                validation[key] = isHeight ? "Ingresá una altura entre 80 y 260 cm, sin decimales, o dejá el campo vacío." : "Ingresá un peso entre 20 y 400 kg, con hasta un decimal, o dejá el campo vacío. Podés usar coma o punto."
                return nil
            case .value(let value): return (value, FitFormat.plain(value))
            }
        }
        if key == .birth, !raw.isEmpty {
            guard let date = NativeDate.parse(raw), date >= Self.minBirth, date <= Date() else {
                validation[key] = "Elegí una fecha entre 1900 y hoy."; return nil
            }
        }
        return (raw.isEmpty ? NSNull() : raw as Any, raw)
    }
    private func commit(_ key: Field) {
        guard initialized, bodyState.loaded, let action = draftOwner, action.isCurrent(in: store.auth) else { return }
        let raw = draft(key)
        guard let value = validated(key, raw) else { return }
        validation[key] = nil
        // Do not duplicate the same in-flight request; an explicit Retry remains available after failure.
        if submitted[key] == raw { return }
        if raw == acknowledged[key], failures[key] == nil, submitted[key] == nil { return }
        let request = UUID(), previous = saveTail
        submitted[key] = raw; requests[key] = request; failures[key] = nil
        saveTail = Task {
            await previous?.value
            guard action.isCurrent(in: store.auth), !Task.isCancelled else { return }
            do {
                // Respect an existing store transaction without holding the whole
                // app busy during this card's own network refresh.
                var waited = 0
                while store.busy, waited < 100 {
                    try await Task.sleep(for: .milliseconds(100))
                    try action.check(in: store.auth)
                    waited += 1
                }
                guard !store.busy else { throw NativeFailure.message("Hay otro guardado en curso. Tu valor sigue acá; tocá Reintentar cuando termine.") }
                try Task.checkCancellation()
                let result = try await NativeBodyMutation.profile(store, patch: [key.rawValue: value.value], action: action)
                guard action.isCurrent(in: store.auth) else { return }
                localWarnings[key] = result.localWarning
                guard requests[key] == request else { return }
                let saved = values(result.row)[key] ?? value.canonical
                guard saved == value.canonical else {
                    throw NativeFailure.message("El servidor devolvió otro valor. Conservamos tu borrador; revisá el campo antes de reintentar.")
                }
                acknowledged[key] = saved
                if draft(key) == raw { drafts[key] = saved }
                submitted[key] = nil; requests[key] = nil; failures[key] = nil
            } catch {
                guard action.isCurrent(in: store.auth), requests[key] == request else { return }
                submitted[key] = nil; requests[key] = nil
                failures[key] = error is CancellationError ? "El guardado se interrumpió. Tu valor sigue acá." : error.localizedDescription
            }
        }
    }
    private func status(_ key: Field) -> String {
        if let submitted = submitted[key] { return submitted == draft(key) ? "Guardando…" : "Sin guardar" }
        if validation[key] != nil || failures[key] != nil || draft(key) != acknowledged[key] { return "Sin guardar" }
        return "Guardado"
    }
    private func field<Content: View>(_ key: Field, label: String, hint: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 12) { Text(label).font(.fit(.sm, .medium)); Spacer(); statusLabel(key) }
                VStack(alignment: .leading, spacing: 4) { Text(label).font(.fit(.sm, .medium)); statusLabel(key) }
            }
            if let hint { Text(hint).font(.fit(.xs)).foregroundStyle(FitColor.muted) }
            content()
            if let error = validation[key] ?? failures[key] {
                Text(error).font(.fit(.xs)).foregroundStyle(FitColor.warn).fixedSize(horizontal: false, vertical: true)
            }
            if failures[key] != nil {
                Button("Reintentar guardado") { commit(key) }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
                    .accessibilityLabel("Reintentar guardar \(label.lowercased())")
            }
            if let warning = localWarnings[key] {
                Text(warning).font(.fit(.xs)).foregroundStyle(FitColor.warn).fixedSize(horizontal: false, vertical: true)
                Button("Actualizar copia local") {
                    guard let action = draftOwner, action.isCurrent(in: store.auth) else { return }
                    let warning = NativeBodyMutation.acknowledge(store, action: action)
                    guard action.isCurrent(in: store.auth) else { return }
                    // A successful retry persists the entire current snapshot.
                    if warning == nil { localWarnings = [:] } else { localWarnings[key] = warning }
                }
                .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
                .accessibilityHint("Reintenta solo la copia de este iPhone; no vuelve a enviar el campo al servidor.")
            }
        }
    }
    private func statusLabel(_ key: Field) -> some View {
        Text(status(key)).font(.fit(.xs)).foregroundStyle(status(key) == "Sin guardar" ? FitColor.warn : FitColor.muted)
            .accessibilityLabel("Estado del campo: \(status(key))")
    }
    private func choice(options: [(String, String, String?)], value: String, select: @escaping (String) -> Void) -> some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            ForEach(options, id: \.0) { option in
                let on = option.0 == value
                Button { select(option.0) } label: {
                    VStack(spacing: 4) {
                        Text(option.1).font(.fit(.sm, .medium))
                        if let hint = option.2 { Text(hint).font(.fit(.xxs)).multilineTextAlignment(.center) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .foregroundStyle(on ? FitColor.accentInk : FitColor.ink)
                    .background(on ? FitColor.accent : FitColor.surface2, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(on ? FitColor.accent : FitColor.line))
                    .fitMinimumHitArea()
                }
                .buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// Formula outputs are neutral estimates, never intake prescriptions or health ratings.
struct NativeEnergyCardView: View {
    @EnvironmentObject var store: NativeStore
    private var bodyState: NativeDomainState { store.domainState(.body) }
    private var trainingState: NativeDomainState { store.domainState(.training) }
    @Environment(\.fitSelectTab) private var selectTab
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let card = NativeEnergyCard(profile: store.profile, weights: store.weights, sessions: store.sessions)
        if !bodyState.loaded {
            VStack(alignment: .leading, spacing: 12) {
                Text("Estimación de calorías").font(.fit(.base, .semibold))
                if bodyState.loading {
                    FitSkeleton(height: 100).fitLoadingAccessibility("Cargando datos para la estimación")
                } else {
                    NativeBodyLoadNote(title: "No se pudo cargar la estimación")
                    if bodyState.error == nil {
                        Text("Primero necesitamos cargar tus datos.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        Button("Cargar datos") { Task { await store.refresh() } }.fitLink()
                    }
                }
            }.padding(20).fitCard(padding: 0)
        } else if !trainingState.loaded {
            VStack(alignment: .leading, spacing: 12) {
                Text("Estimación de calorías").font(.fit(.base, .semibold))
                Text(trainingState.loading ? "Cargando los entrenamientos registrados para estimar el gasto." : "Falta cargar la actividad registrada. No interpretamos un error de carga como cero entrenamientos.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                if let error = trainingState.error { FitErrorNote(title: "No se pudo cargar la actividad", message: error) }
                Button("Actualizar actividad") { Task { await store.refresh() } }.fitLink(.sm).disabled(store.refreshing)
            }.fitCard()
        } else if let report = card.report {
            VStack(alignment: .leading, spacing: 0) {
                Text("Estimación de calorías").font(.fit(.base, .semibold))
                Text("Referencia diaria calculada").font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 12)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) { targetNumber(report); targetUnit }
                    VStack(alignment: .leading, spacing: 2) { targetNumber(report); targetUnit }
                }.padding(.top, 4).accessibilityElement(children: .combine)
                Text("\(NativeEnergyCard.goalLabels[card.goal] ?? "Mantener") · \(adjustment(card.adjustment)) · redondeado a 50 kcal")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 4)
                if card.clamped {
                    Text("La fórmula limita esta referencia al gasto en reposo estimado. Ese límite no determina cuánto necesitás comer.")
                        .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 8)
                }
                if let source = card.sourceWeight {
                    Text("Calculado con \(FitFormat.kg(source.weight_kg)) kg del \(FitFormat.fieldDay(NativeDate.parse(source.measured_on) ?? Date())).")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 12)
                    Button("Actualizar peso") { NativeProgressRoute.requestWeight(); selectTab(.progress) }.fitLink(.sm)
                }
                DisclosureGroup {
                let layout = typeSize >= .xxxLarge ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(alignment: .top, spacing: 8))
                layout {
                    figure(FitFormat.decimal(report.bmi), unit: "kg/m²", label: "IMC (peso / altura²)")
                    figure(FitFormat.number(report.bmr), unit: "kcal/día", label: "Reposo estimado")
                    figure(FitFormat.number(report.tdee), unit: "kcal/día", label: "Gasto diario estimado")
                }.padding(.top, 16)
                let perWeek = (report.activityDays * 10).rounded() / 10
                Text("\(FitFormat.decimal(perWeek)) días con series por semana en los últimos 28 días · factor de actividad \(card.activityLabel)")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 12)
                Text("El factor usa solo los días con entrenamientos registrados; no mide tu actividad cotidiana. El IMC no describe la composición corporal.")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 8)
                } label: {
                    Text("Cómo se calcula · IMC y gasto estimado").font(.fit(.sm)).fitMinimumHitArea()
                }.padding(.top, 12)
                if bodyState.usingCachedData || bodyState.error != nil || trainingState.usingCachedData || trainingState.error != nil {
                    Text("Calculado con la última copia disponible, que puede estar desactualizada.")
                        .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 8)
                }
                Text("Valores orientativos calculados con tus datos guardados; no son una recomendación de alimentación ni reemplazan asesoramiento profesional.")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 8)
            }.padding(20).fitCard(padding: 0)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Estimación de calorías").font(.fit(.base, .semibold)).foregroundStyle(FitColor.ink)
                if bodyState.usingCachedData || bodyState.error != nil || trainingState.usingCachedData || trainingState.error != nil {
                    Text("No hay datos suficientes en la copia disponible para estimar el gasto. Actualizá antes de completar los campos que faltan.")
                        .font(.fit(.sm))
                } else {
                    Text(card.missing.isEmpty ? "Revisá tus datos corporales para obtener una estimación." : "Para obtener una estimación falta \(FitFormat.list(card.missing)).")
                        .font(.fit(.sm))
                }
                if card.missing.contains("un peso") {
                    Button("Anotar un peso") { NativeProgressRoute.requestWeight(); selectTab(.progress) }.fitLink()
                }
                if let bmi = card.bmi {
                    Text("IMC estimado: \(FitFormat.decimal(bmi)) kg/m² (peso / altura²)").font(.fit(.sm)).monospacedDigit()
                }
                Text("Se usan los datos guardados. Los cambios sin guardar todavía no afectan la estimación.").font(.fit(.xs))
            }
            .foregroundStyle(FitColor.muted).padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(FitColor.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        }
    }
    private func targetNumber(_ report: NativeEnergyReport) -> some View {
        Text(FitFormat.number(report.target)).font(.fit(.xl3, .bold)).monospacedDigit()
    }
    private var targetUnit: some View { Text("kcal/día").font(.fit(.base)).foregroundStyle(FitColor.muted) }
    private func adjustment(_ kcal: Double) -> String {
        kcal == 0 ? "sin ajuste de fórmula" : "ajuste de fórmula: \(kcal > 0 ? "+" : "−")\(FitFormat.number(abs(kcal))) kcal"
    }
    private func figure(_ value: String, unit: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.fit(.base, .bold)).monospacedDigit()
            Text(unit).font(.fit(.xs)).foregroundStyle(FitColor.muted)
            Text(label).font(.fit(.xs)).foregroundStyle(FitColor.muted).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(FitColor.surface2, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Peso

struct NativeWeightLogCard: View {
    var focusRequest = 0
    var onPendingChanges: (Bool) -> Void = { _ in }
    @EnvironmentObject var store: NativeStore
    private var bodyState: NativeDomainState { store.domainState(.body) }
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var date = Date()
    @State private var weight = ""
    @State private var saveError: String?
    @State private var localWarning: String?
    @State private var confirmedAction: NativeWorkoutAction?
    @State private var validation: String?
    @State private var saving = false
    @State private var inFlightDraft: String?
    @State private var savedDraft: String?
    @State private var editingID: String?
    @State private var historyExpanded = false
    @State private var deleting = Set<String>()
    @State private var deleteErrors: [String: String] = [:]
    @State private var pendingSave: WeightDraft?
    @State private var pendingDelete: NativeWeight?
    @State private var pendingEdit: NativeWeight?
    @State private var confirmationAction: NativeWorkoutAction?
    @State private var draftOwner: NativeWorkoutAction?
    @FocusState private var weightFocused: Bool

    private struct WeightDraft {
        let key: String
        let kg: Double
        let stamp: String
        let replaced: NativeWeight?
        let action: NativeWorkoutAction
    }
    private var stamp: String { "\(NativeDate.key(date))|\(weight)" }
    private var entries: [NativeWeight] {
        store.weights.sorted { $0.measured_on != $1.measured_on ? $0.measured_on > $1.measured_on : $0.id > $1.id }
    }
    private var hasDraft: Bool { !weight.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && savedDraft != stamp }
    private var saveStatus: String {
        saving && inFlightDraft == stamp ? "Guardando…" : savedDraft == stamp ? "Guardado" : "Sin guardar"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 12) { heading; Spacer(); currentWeight }
                VStack(alignment: .leading, spacing: 4) { heading; currentWeight }
            }
            NativeBodyLoadNote(title: "No se pudo cargar el historial de peso").padding(.top, 8)
            form.padding(.top, 16)
            if editingID != nil {
                Text("Corrección del \(FitFormat.fieldDay(date)). El original se conserva hasta guardar.")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 8)
                Button("Cancelar corrección") { clearDraft() }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).padding(.top, 8).disabled(saving)
            }
            if !weight.isEmpty || saving || savedDraft != nil {
                Text(saveStatus).font(.fit(.xs)).foregroundStyle(saveStatus == "Sin guardar" ? FitColor.warn : FitColor.muted)
                    .padding(.top, 8).accessibilityLabel("Estado del peso: \(saveStatus)")
            }
            if let message = validation ?? saveError {
                Text(message).font(.fit(.xs)).foregroundStyle(FitColor.warn).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            }
            if saveError != nil {
                Button("Reintentar guardado", action: submit)
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).padding(.top, 8).disabled(saving || !bodyState.loaded)
                Button(store.refreshing ? "Actualizando…" : "Actualizar historial") { Task { await store.refresh() } }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).padding(.top, 4).disabled(store.refreshing)
            }
            if let warning = localWarning {
                Text(warning).font(.fit(.xs)).foregroundStyle(FitColor.warn).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
                Button("Actualizar copia local") {
                    guard let action = confirmedAction, action.isCurrent(in: store.auth) else { return }
                    let warning = NativeBodyMutation.acknowledge(store, action: action)
                    guard action.isCurrent(in: store.auth) else { return }
                    localWarning = warning
                }
                .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).padding(.top, 4)
                .accessibilityHint("Reintenta solo la copia de este iPhone; no vuelve a anotar ni borrar el peso.")
            }
            if !bodyState.loaded {
                if bodyState.loading {
                    FitCardsSkeleton(count: 1).padding(.top, 16)
                } else if bodyState.error == nil {
                    Text("El historial todavía no se cargó.").font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 16)
                    Button("Cargar historial") { Task { await store.refresh() } }.fitLink().padding(.top, 8)
                }
            } else if entries.isEmpty {
                if bodyState.usingCachedData || bodyState.error != nil {
                    Text("La copia disponible no contiene registros de peso. Actualizá para confirmar el historial.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 16)
                } else {
                    Text("Sin registros de peso.").font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 16)
                }
            } else {
                DisclosureGroup(isExpanded: $historyExpanded) {
                    VStack(spacing: 0) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            if index > 0 { Rectangle().fill(FitColor.line).frame(height: 1) }
                            row(entry, delta: index + 1 < entries.count ? ((entry.weight_kg - entries[index + 1].weight_kg) * 10).rounded() / 10 : nil)
                        }
                    }
                } label: {
                    Text("Historial · \(entries.count)").font(.fit(.sm)).fitMinimumHitArea()
                }.padding(.top, 8)
            }
        }
        .padding(20).fitCard(padding: 0)
        .fitKeyboardDone { weightFocused = false }
        .fitNavigationDraft(hasDraft || saving || !deleting.isEmpty)
        .onChange(of: hasDraft || saving || !deleting.isEmpty) { _, pending in onPendingChanges(pending) }
        .confirmationDialog("¿Reemplazar el peso de esta fecha?", isPresented: Binding(get: { pendingSave != nil }, set: { if !$0 { pendingSave = nil } }), titleVisibility: .visible) {
            if let draft = pendingSave {
                Button("Reemplazar por \(FitFormat.kg(draft.kg)) kg") { pendingSave = nil; save(draft) }
                Button("Cancelar", role: .cancel) { pendingSave = nil }
            }
        } message: {
            if let draft = pendingSave, let previous = draft.replaced {
                Text("El \(FitFormat.fieldDay(NativeDate.parse(draft.key) ?? date)) tiene \(FitFormat.kg(previous.weight_kg)) kg. Se reemplazará por \(FitFormat.kg(draft.kg)) kg.")
            }
        }
        .confirmationDialog("¿Borrar este registro de peso?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible) {
            if let entry = pendingDelete, let action = confirmationAction {
                Button("Borrar \(FitFormat.kg(entry.weight_kg)) kg", role: .destructive) { pendingDelete = nil; remove(entry, action: action) }
                Button("Cancelar", role: .cancel) { pendingDelete = nil }
            }
        } message: {
            if let entry = pendingDelete { Text("Se eliminará el peso del \(FitFormat.fieldDay(NativeDate.parse(entry.measured_on) ?? date)). Esta acción no se puede deshacer.") }
        }
        .alert("¿Descartar el peso sin guardar?", isPresented: Binding(get: { pendingEdit != nil }, set: { if !$0 { pendingEdit = nil } })) {
            if let entry = pendingEdit, let action = confirmationAction {
                Button("Descartar y corregir", role: .destructive) {
                    pendingEdit = nil
                    guard action.isCurrent(in: store.auth) else { return }
                    edit(entry)
                }
                Button("Conservar borrador", role: .cancel) { pendingEdit = nil }
            }
        } message: { Text("Tu borrador se reemplazará por el registro que elegiste.") }
        .onAppear { bindDraftOwner(); if focusRequest > 0 { weightFocused = true } }
        .onChange(of: focusRequest) { _, value in if value > 0 { weightFocused = true } }
        .onChange(of: bodyState.loaded) { _, loaded in if loaded { bindDraftOwner() } }
        .onChange(of: weight) { _, _ in draftChanged() }
        .onChange(of: date) { _, _ in draftChanged() }
        .onChange(of: deleteErrors) { _, errors in if !errors.isEmpty { historyExpanded = true } }
        .onChange(of: store.auth.generation) { _, _ in reset() }
        .onReceive(store.accountChanges) { _ in reset() }
    }

    private var heading: some View { Text("Peso").font(.fit(.base, .semibold)) }
    @ViewBuilder private var currentWeight: some View {
        if bodyState.loaded, let current = entries.first(where: { $0.measured_on <= NativeDate.key() }) {
            Text("Último: \(FitFormat.kg(current.weight_kg)) kg · \(FitFormat.shortDay(current.measured_on))")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
                .accessibilityLabel("Último peso registrado: \(FitFormat.kg(current.weight_kg)) kilogramos, el \(FitFormat.fieldDay(NativeDate.parse(current.measured_on) ?? date))")
        }
    }
    private var form: some View {
        let layout = typeSize >= .xxxLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .bottom, spacing: 8))
        return VStack(alignment: .leading, spacing: 8) {
          layout {
            VStack(alignment: .leading, spacing: 6) {
                Text("Peso (kg)").font(.fit(.xs)).foregroundStyle(FitColor.muted)
                TextField("", text: $weight, prompt: fitPrompt("75,5"))
                    .fitNumericInput().focused($weightFocused).fitField()
                    .frame(minWidth: 72).accessibilityLabel("Peso en kilogramos")
                    .accessibilityHint("Entre 20 y 400, hasta un decimal. Podés usar coma o punto.")
            }
            Button(saving ? "Guardando…" : editingID != nil ? "Guardar corrección" : "Anotar", action: submit)
                .buttonStyle(FitButtonStyle(variant: .primary)).disabled(saving || !bodyState.loaded)
          }
          DisclosureGroup {
                FitDateField(date: $date, range: Date.distantPast...Date(), label: "Fecha del peso")
                    .disabled(editingID != nil)
                    .accessibilityHint(editingID == nil ? "Elegí el día del registro" : "Fecha del registro que estás corrigiendo. Cancelá la corrección para elegir otra fecha.")
          } label: {
              Text("\(NativeDate.key(date) == NativeDate.key() ? "Hoy" : FitFormat.fieldDay(date)) · Fecha")
                  .font(.fit(.sm)).foregroundStyle(FitColor.muted).fitMinimumHitArea()
          }
        }
    }
    private func row(_ entry: NativeWeight, delta: Double?) -> some View {
        let layout = typeSize >= .xxxLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
        return VStack(alignment: .leading, spacing: 8) {
            layout {
                VStack(alignment: .leading, spacing: 4) {
                    Text(FitFormat.fieldDay(NativeDate.parse(entry.measured_on) ?? date)).font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    Text("\(FitFormat.kg(entry.weight_kg)) kg").font(.fit(.base, .semibold)).monospacedDigit()
                    if let delta {
                        Text("\(FitFormat.delta(delta)) kg").font(.fit(.xs)).foregroundStyle(FitColor.muted).monospacedDigit()
                            .accessibilityLabel("\(FitFormat.delta(delta)) kilogramos respecto del registro anterior")
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { editButton(entry); deleteButton(entry) }
                    VStack(alignment: .leading, spacing: 8) { editButton(entry); deleteButton(entry) }
                }
            }
            if let message = deleteErrors[entry.id] {
                Text("No se borró el registro. \(message)").font(.fit(.xs)).foregroundStyle(FitColor.warn)
                Button("Reintentar borrado") { confirmDelete(entry) }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).disabled(deleting.contains(entry.id))
                    .accessibilityLabel("Reintentar borrar el peso del \(FitFormat.shortDay(entry.measured_on))")
            }
        }.padding(.vertical, 10)
    }
    private func editButton(_ entry: NativeWeight) -> some View {
        Button("Corregir") {
            if hasDraft { confirmationAction = NativeWorkoutAction(auth: store.auth); pendingEdit = entry }
            else { edit(entry) }
        }
        .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).disabled(saving || deleting.contains(entry.id))
        .accessibilityLabel("Corregir el peso del \(FitFormat.shortDay(entry.measured_on))")
    }
    private func deleteButton(_ entry: NativeWeight) -> some View {
        Button(deleting.contains(entry.id) ? "Borrando…" : "Borrar") { confirmDelete(entry) }
            .buttonStyle(FitButtonStyle(variant: .danger, size: .sm)).disabled(saving || deleting.contains(entry.id))
            .accessibilityLabel("Borrar \(FitFormat.kg(entry.weight_kg)) kilogramos del \(FitFormat.shortDay(entry.measured_on))")
    }
    private func bindDraftOwner() {
        guard bodyState.loaded, draftOwner == nil else { return }
        draftOwner = NativeWorkoutAction(auth: store.auth)
    }
    private func edit(_ entry: NativeWeight) {
        guard entry.user_id == store.auth.session?.user.id, let parsed = NativeDate.parse(entry.measured_on) else { return }
        draftOwner = NativeWorkoutAction(auth: store.auth)
        date = parsed; weight = FitFormat.plain(entry.weight_kg); editingID = entry.id
        saveError = nil; validation = nil; savedDraft = stamp; weightFocused = true
    }
    private func confirmDelete(_ entry: NativeWeight) {
        confirmationAction = NativeWorkoutAction(auth: store.auth); pendingDelete = entry
    }
    private func draftChanged() {
        bindDraftOwner()
        saveError = nil; validation = nil; pendingSave = nil
        // Comparing stamps, rather than the persisted row, keeps unsaved editing explicit.
    }
    private func clearDraft() {
        weight = ""; date = Date(); editingID = nil; saveError = nil; validation = nil; savedDraft = nil; weightFocused = false
    }
    private func reset() {
        clearDraft(); draftOwner = nil; saving = false; inFlightDraft = nil; deleting = []; deleteErrors = [:]
        localWarning = nil; confirmedAction = nil
        pendingSave = nil; pendingDelete = nil; pendingEdit = nil; confirmationAction = nil
    }
    private func submit() {
        guard !saving, bodyState.loaded, let action = draftOwner, action.isCurrent(in: store.auth) else { return }
        switch FitMeasure(weight, min: 20, max: 400, decimals: 1) {
        case .empty: validation = "Ingresá el peso en kilogramos antes de anotar."; return
        case .invalid: validation = "Ingresá un peso entre 20 y 400 kg, con hasta un decimal. Podés usar coma o punto; el valor no se ajusta automáticamente."; return
        case .value(let kg):
            let key = NativeDate.key(date)
            guard key <= NativeDate.key() else { validation = "La fecha no puede estar en el futuro."; return }
            validation = nil; saveError = nil; weightFocused = false
            let previous = entries.first { $0.measured_on == key }
            if previous?.weight_kg == kg { savedDraft = stamp; return }
            let draft = WeightDraft(key: key, kg: kg, stamp: stamp, replaced: previous, action: action)
            if previous != nil { pendingSave = draft } else { save(draft) }
        }
    }
    private func save(_ draft: WeightDraft) {
        guard draft.action.isCurrent(in: store.auth), !saving, draft.stamp == stamp else { return }
        saving = true; inFlightDraft = draft.stamp; saveError = nil
        Task {
            defer { if draft.action.isCurrent(in: store.auth) { saving = false; inFlightDraft = nil } }
            do {
                try draft.action.check(in: store.auth)
                // New days use an insert, not an upsert: a concurrent record must not
                // be overwritten without having been shown in the confirmation.
                let query = draft.replaced.map { nativeQuery("id", $0.id) + nativeQuery("weight_kg", String($0.weight_kg)) + nativeQuery("measured_on", $0.measured_on) } ?? []
                let data = try await store.api.request("rest/v1/weight_entries", method: draft.replaced == nil ? "POST" : "PATCH",
                    query: query, body: ["measured_on": draft.key, "weight_kg": draft.kg], prefer: "return=representation")
                try draft.action.check(in: store.auth)
                guard let row = try JSONDecoder().decode([NativeWeight].self, from: data).first,
                      row.user_id == store.auth.session?.user.id, row.measured_on == draft.key, row.weight_kg == draft.kg else {
                    NativeBodyMutation.refresh(store, action: draft.action)
                    throw NativeFailure.message("No se pudo confirmar el peso o el registro cambió. Conservamos el borrador; actualizá antes de reintentar.")
                }
                store.weights.removeAll { $0.id == row.id || $0.measured_on == row.measured_on }
                store.weights.append(row)
                if stamp == draft.stamp { savedDraft = stamp; editingID = nil; saveError = nil }
                confirmedAction = draft.action
                localWarning = NativeBodyMutation.acknowledge(store, action: draft.action)
            } catch {
                guard draft.action.isCurrent(in: store.auth) else { return }
                if stamp == draft.stamp { saveError = error is CancellationError ? "El guardado se interrumpió. Tu peso sigue en el formulario." : error.localizedDescription }
                if case NativeFailure.http(_, "23505") = error {
                    NativeBodyMutation.refresh(store, action: draft.action)
                }
            }
        }
    }
    private func remove(_ entry: NativeWeight, action: NativeWorkoutAction) {
        guard action.isCurrent(in: store.auth), !deleting.contains(entry.id) else { return }
        deleting.insert(entry.id); deleteErrors[entry.id] = nil
        Task {
            defer { if action.isCurrent(in: store.auth) { deleting.remove(entry.id) } }
            do {
                try action.check(in: store.auth)
                let data = try await store.api.request("rest/v1/weight_entries", method: "DELETE",
                    query: nativeQuery("id", entry.id) + nativeQuery("weight_kg", String(entry.weight_kg)) + nativeQuery("measured_on", entry.measured_on), prefer: "return=representation")
                try action.check(in: store.auth)
                guard let removed = try JSONDecoder().decode([NativeWeight].self, from: data).first,
                      removed.id == entry.id, removed.user_id == store.auth.session?.user.id else {
                    NativeBodyMutation.refresh(store, action: action)
                    throw NativeFailure.message("El registro cambió o ya no existe. Actualizá el historial antes de volver a borrarlo.")
                }
                store.weights.removeAll { $0.id == entry.id }
                if editingID == entry.id { editingID = nil }
                if NativeDate.key(date) == entry.measured_on { savedDraft = nil }
                confirmedAction = action
                localWarning = NativeBodyMutation.acknowledge(store, action: action)
            } catch {
                guard action.isCurrent(in: store.auth) else { return }
                deleteErrors[entry.id] = error is CancellationError ? "El borrado se interrumpió." : error.localizedDescription
            }
        }
    }
}

/// The last 26 weeks, the same stretch as the heatmap, so both can be read against each other.
struct NativeWeightChartCard: View {
    @EnvironmentObject var store: NativeStore
    private var bodyState: NativeDomainState { store.domainState(.body) }
    @Environment(\.fitSelectTab) private var selectTab
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if !bodyState.loaded {
            VStack(alignment: .leading, spacing: 12) {
                Text("Evolución").font(.fit(.base, .semibold))
                if bodyState.loading { FitSkeleton(height: 140).fitLoadingAccessibility("Cargando la evolución del peso") }
                else {
                    NativeBodyLoadNote(title: "No se pudo cargar la evolución")
                    if bodyState.error == nil {
                        Text("La evolución estará disponible al cargar el historial.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        Button("Cargar historial") { Task { await store.refresh() } }.fitLink()
                    }
                }
            }.padding(20).fitCard(padding: 0)
        } else if !store.weights.isEmpty {
            let today = NativeDate.key()
            let start = NativeDate.key(NativeDate.add(-181, to: Date()))
            let entries = store.weights.filter { $0.measured_on >= start && $0.measured_on <= today && $0.weight_kg.isFinite && NativeDate.parse($0.measured_on) != nil }
            let target = store.profile?.target_weight_kg.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
            VStack(alignment: .leading, spacing: 12) {
                Text("Evolución del peso").font(.fit(.base, .semibold))
                NativeBodyLoadNote()
                if entries.isEmpty {
                    Text(bodyState.usingCachedData || bodyState.error != nil ? "No hay pesos de las últimas 26 semanas en la copia disponible. Actualizá para confirmar." : "No hay pesos registrados en las últimas 26 semanas.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                } else {
                    let chart = NativeWeightChart(entries: entries, target: target)
                    if let latest = chart.points.last {
                        Text("\(FitFormat.kg(latest.entry.weight_kg)) kg").font(.fit(.xl2, .bold)).monospacedDigit()
                        Text(FitFormat.fieldDay(NativeDate.parse(latest.entry.measured_on) ?? Date()))
                            .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                    }
                    if let first = chart.points.first, let last = chart.points.last {
                        Text("\(FitFormat.shortDay(first.entry.measured_on)) – \(FitFormat.shortDay(last.entry.measured_on)) · \(entries.count) mediciones · últimas 26 semanas")
                            .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("● Peso registrado · ━ Media 7 días").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        if let target { Text("┄ Meta \(FitFormat.kg(target)) kg").font(.fit(.sm)).foregroundStyle(FitColor.muted) }
                    }.accessibilityElement(children: .combine)
                    chart
                        .frame(height: typeSize.isAccessibilitySize ? 260 : 200)
                    if let latest = chart.points.last {
                        let start = NativeDate.key(NativeDate.add(-6, to: NativeDate.parse(latest.entry.measured_on) ?? Date()))
                        let count = entries.filter { $0.measured_on >= start && $0.measured_on <= latest.entry.measured_on }.count
                        Text("Media 7 días · \(FitFormat.kg(latest.trend)) kg · \(count) mediciones disponibles").font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
                        if count < 2 {
                            Text("La media actual tiene una sola medición; todavía no permite distinguir una tendencia.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        }
                        if chart.hasGaps {
                            Text("Hay intervalos de más de 7 días sin registros. No se midió el peso entre los puntos.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        }
                    }
                    DisclosureGroup {
                        Text("Puntos: pesos registrados. Línea: promedio de los registros disponibles en 7 días.")
                            .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                        if let target {
                            Text("Línea discontinua: meta \(FitFormat.kg(target)) kg.").font(.fit(.xs)).foregroundStyle(FitColor.muted)
                        } else {
                            Button("Definir meta en Perfil") { NativeProfileRoute.requestTarget(); selectTab(.profile) }.fitLink(.xs)
                        }
                    } label: {
                        Text("Detalle de la curva").font(.fit(.sm)).fitMinimumHitArea()
                    }
                }
            }.padding(20).fitCard(padding: 0)
        }
    }
}

struct NativeWeightChart: View {
    let entries: [NativeWeight], target: Double?
    /// Each weigh-in with the mean of the seven days ending on it.
    var points: [(entry: NativeWeight, trend: Double)] {
        let sorted = entries.filter { $0.weight_kg.isFinite && NativeDate.parse($0.measured_on) != nil }.sorted { $0.measured_on < $1.measured_on }
        return sorted.compactMap { entry in
            guard let date = NativeDate.parse(entry.measured_on) else { return nil }
            let start = NativeDate.key(NativeDate.add(-6, to: date))
            let window = sorted.filter { $0.measured_on >= start && $0.measured_on <= entry.measured_on }
            return (entry, window.map(\.weight_kg).reduce(0, +) / Double(window.count))
        }
    }
    var hasGaps: Bool {
        let dates = entries.compactMap { NativeDate.parse($0.measured_on) }.sorted()
        return zip(dates, dates.dropFirst()).contains { NativeDate.add(7, to: $0.0) < $0.1 }
    }
    private func segment(_ date: String) -> String {
        let sorted = entries.map(\.measured_on).sorted()
        var start = sorted.first ?? date
        var previous: Date?
        for key in sorted where key <= date {
            guard let current = NativeDate.parse(key) else { continue }
            if let previous, NativeDate.add(7, to: previous) < current { start = key }
            previous = current
        }
        return start
    }
    var domain: ClosedRange<Double> {
        let values = entries.map(\.weight_kg).filter(\.isFinite) + (target.flatMap { $0.isFinite ? [$0] : nil } ?? [])
        let lo = values.min() ?? 0, hi = values.max() ?? 2, pad = max((hi - lo) * 0.08, 1)
        return (lo - pad)...(hi + pad)
    }
    private var spanDays: Int {
        let keys = entries.map(\.measured_on).sorted()
        guard let first = keys.first.flatMap(NativeDate.parse), let last = keys.last.flatMap(NativeDate.parse) else { return 0 }
        return NativeDate.calendar.dateComponents([.day], from: first, to: last).day ?? 0
    }
    var body: some View {
        let points = points
        let monthly = spanDays > 45
        Chart {
            if let target, target.isFinite {
                RuleMark(y: .value("Meta", target))
                    .foregroundStyle(FitColor.muted)
                    .lineStyle(StrokeStyle(lineWidth: 1.25, dash: [4, 3]))
            }
            ForEach(points, id: \.entry.id) { point in
                if let date = NativeDate.parse(point.entry.measured_on) {
                    PointMark(x: .value("Fecha", date), y: .value("Peso", point.entry.weight_kg))
                        .foregroundStyle(FitColor.accent.opacity(0.35))
                        .symbolSize(20)
                }
            }
            ForEach(points, id: \.entry.id) { point in
                if let date = NativeDate.parse(point.entry.measured_on) {
                    LineMark(x: .value("Fecha", date), y: .value("Media 7 días", point.trend), series: .value("Intervalo", segment(point.entry.measured_on)))
                        .foregroundStyle(FitColor.accent)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                }
            }
        }
        .chartYScale(domain: domain)
        .chartYAxisLabel("Peso (kg)")
        .chartXAxisLabel("Fecha")
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(FitColor.line)
                AxisValueLabel { if let kg = value.as(Double.self) { Text(FitFormat.kg(kg)).font(.fit(.xs)).foregroundStyle(FitColor.muted) } }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { value in
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(monthly ? FitFormat.month(date) : (NativeDate.key(date) == NativeDate.key() ? "hoy" : FitFormat.shortDay(NativeDate.key(date))))
                            .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                    }
                }
            }
        }
        .accessibilityLabel("Evolución del peso en kilogramos y promedio de registros de siete días, con el peso objetivo si está definido")
        .accessibilityHint("Los valores individuales y sus fechas están disponibles en el historial de peso.")
    }
}
