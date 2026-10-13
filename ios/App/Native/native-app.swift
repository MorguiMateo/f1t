import SwiftUI
import Combine
import UIKit
import ActivityKit
import UserNotifications

struct NativeRootView: View {
    @StateObject private var store = NativeStore.shared
    @Environment(\.scenePhase) private var phase
    @ObservedObject private var lifecycle = NativeApplicationLifecycle.shared
    @State private var todayKey = NativeDate.key()
    @State private var bootstrapStarted = false
    @State private var bootstrapFinished = false
    @State private var restoringSession = false
    @State private var foregroundRefreshPending = false
    @State private var refreshPendingGeneration: UUID?
    @State private var refreshScheduled = false
    var body: some View {
        NativeAuthGate(store: store, auth: store.auth, restoringSession: $restoringSession, retryRestore: { retryRestore() })
            .environmentObject(store)
            .task {
                guard !NativeApplicationLifecycle.isUnitTestHost else { return }
                guard !bootstrapStarted else { return }
                bootstrapStarted = true
                restoringSession = true
                // Restoring the account already schedules its first store refresh.
                await lifecycle.restore(store: store)
                restoringSession = false
                bootstrapFinished = true
            }
            .onChange(of: phase) { _, phase in
                if phase == .background { foregroundRefreshPending = true }
                if phase == .active {
                    let dateChanged = checkDate()
                    let shouldRefresh = foregroundRefreshPending || dateChanged
                    foregroundRefreshPending = false
                    if shouldRefresh { requestForegroundUpdate() }
                    refreshIfIdle()
                }
            }
            .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
                if phase == .active, checkDate() { requestForegroundUpdate() }
            }
            .onChange(of: store.busy) { _, busy in if !busy { refreshIfIdle() } }
            .onChange(of: store.loading) { _, loading in if !loading { refreshIfIdle() } }
            .onChange(of: store.refreshing) { _, refreshing in if !refreshing { refreshIfIdle() } }
            .onChange(of: restoringSession) { _, restoring in if !restoring { refreshIfIdle() } }
            .safeAreaInset(edge: .top) {
                if let widgetError = lifecycle.widgetError {
                    Text(widgetError).font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(6).frame(maxWidth: .infinity).background(FitColor.surface2)
                }
            }
    }
    private func requestForegroundUpdate() {
        guard bootstrapFinished, phase == .active else { return }
        if store.auth.canRetryRestore {
            retryRestore(requireActive: true)
        } else if store.auth.session != nil {
            refreshPendingGeneration = store.auth.generation
            refreshIfIdle()
        }
    }
    private func retryRestore(requireActive: Bool = false) {
        guard bootstrapFinished, !restoringSession, store.auth.ready, store.auth.canRetryRestore,
              !store.auth.signingIn, !store.loading, !store.refreshing, !store.busy else { return }
        let generation = store.auth.generation
        restoringSession = true
        Task {
            defer { restoringSession = false }
            guard !requireActive || phase == .active,
                  generation == store.auth.generation, store.auth.canRetryRestore,
                  !store.auth.signingIn, !store.loading, !store.refreshing, !store.busy else { return }
            await store.auth.restore()
            await NativeLiveActivity.shared.restore(store: store)
            guard generation == store.auth.generation else { return }
            // The account publisher hydrates and refreshes; restoration must not duplicate it.
            refreshPendingGeneration = nil
        }
    }
    private func refreshIfIdle() {
        guard let generation = refreshPendingGeneration else { return }
        guard generation == store.auth.generation else { refreshPendingGeneration = nil; return }
        guard bootstrapFinished, phase == .active, !restoringSession, !refreshScheduled,
              store.auth.ready, store.auth.session != nil, !store.loading, !store.refreshing, !store.busy else { return }
        refreshScheduled = true
        Task {
            defer { refreshScheduled = false; refreshIfIdle() }
            // Recheck after scheduling: another refresh or an account change may win.
            guard phase == .active, !restoringSession, store.auth.ready, store.auth.session != nil,
                  generation == store.auth.generation, refreshPendingGeneration == generation,
                  !store.loading, !store.refreshing, !store.busy else { return }
            // Keep later foreground/rollover requests pending, even if this read fails.
            refreshPendingGeneration = nil
            await store.refresh()
        }
    }
    @discardableResult private func checkDate() -> Bool {
        let current = NativeDate.key()
        guard current != todayKey else { return false }
        let previous = todayKey; todayKey = current
        NativeDevice.shared.refreshStepsForNewDay()
        NotificationCenter.default.post(name: Notification.Name("nativeDateRollover"), object: nil, userInfo: ["previous": previous])
        return true
    }
}

struct NativeAuthGate: View {
    @ObservedObject var store: NativeStore
    @ObservedObject var auth: NativeAuth
    @Binding var restoringSession: Bool
    var retryRestore: () -> Void
    var body: some View {
        Group {
            if !auth.ready {
                ZStack { FitColor.ground.ignoresSafeArea(); ProgressView("Restaurando sesión…").font(.fit(.sm)).foregroundStyle(FitColor.muted) }
            } else if auth.session == nil {
                NativeSignInView(auth: auth, restoringSession: $restoringSession, retryRestore: retryRestore)
            } else {
                NativeTabsView(store: store, auth: auth).id(auth.session?.user.id)
            }
        }
        .font(.fit(.base))
        .foregroundStyle(FitColor.ink)
        .tint(FitColor.accent)
    }
}

struct NativeSignInView: View {
    @ObservedObject var auth: NativeAuth
    @Binding var restoringSession: Bool
    var retryRestore: () -> Void
    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    Text("FIT").font(.fit(.xl5, .bold)).tracking(-1.2).accessibilityAddTraits(.isHeader)
                    Text("Tus rutinas, tu calendario de actividad y tu progreso, en un solo lugar.")
                        .foregroundStyle(FitColor.muted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 360)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                    Button(action: signIn) {
                        HStack(spacing: 12) {
                            Image("GoogleMark").resizable().frame(width: 20, height: 20).accessibilityHidden(true)
                            Text(auth.signingIn ? "Abriendo Google…" : "Continuar con Google").font(.fit(.base, .medium))
                                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: 320)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)
                        .fitMinimumHitArea()
                        .background(FitColor.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(FitColor.lineStrong))
                        .opacity(auth.signingIn || restoringSession ? 0.6 : 1)
                    }
                    .buttonStyle(.plain)
                    .disabled(auth.signingIn || restoringSession)
                    .padding(.top, 40)
                    if auth.canRetryRestore {
                        Button(action: retryRestore) {
                            HStack(spacing: 8) {
                                if restoringSession { ProgressView().controlSize(.small) }
                                Text(restoringSession ? "Restaurando sesión…" : "Reintentar sesión")
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .buttonStyle(FitButtonStyle(size: .sm))
                        .disabled(restoringSession || auth.signingIn)
                        .accessibilityHint("Recupera la sesión guardada sin abrir Google.")
                        .padding(.top, 16)
                    }
                    if let error = auth.error {
                        FitErrorNote(title: "No se pudo iniciar sesión", message: error,
                                     guidance: "Tus registros siguen asociados a tu cuenta. Reintentá recuperar la sesión o continuá con Google.")
                            .frame(maxWidth: 360).padding(.top, 16)
                    }
                    Spacer(minLength: 32)
                    VStack(spacing: 4) {
                        Text("Una cuenta, un solo usuario. Tus datos son solo tuyos.")
                        Text("Autenticación segura en el navegador del sistema. No se guardan contraseñas en FIT.")
                    }
                    .font(.fit(.xs))
                    .foregroundStyle(FitColor.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 32)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: 512)
                .frame(maxWidth: .infinity)
                .frame(minHeight: viewport.size.height)
            }
        }
        .background(FitColor.ground.ignoresSafeArea())
    }
    private func signIn() {
        let generation = auth.generation
        Task {
            guard !restoringSession, !auth.signingIn, generation == auth.generation else { return }
            await auth.signIn()
        }
    }
}

/// Value-based links let the shell return to the diary without remounting it.

/// Navigation-only state. Account changes recreate it through NativeAuthGate's
/// user identity; selecting a tab never invalidates a mounted page's identity.
struct FitTabNavigationState {
    private(set) var selection: FitTab = .today
    private(set) var visited: Set<FitTab> = [.today]
    private(set) var rootRequests: [FitTab: UUID] = [:]

    /// True only when switching tabs requires dismissing the old keyboard.
    mutating func select(_ tab: FitTab, returnToRootIfSelected: Bool = false) -> Bool {
        guard tab != selection else {
            if returnToRootIfSelected { rootRequests[tab] = UUID() }
            return false
        }
        visited.insert(tab)
        selection = tab
        return true
    }
}

/// Mount tabs on first visit, then keep their navigation stacks under a fixed bottom bar.
struct NativeTabsView: View {
    @ObservedObject var store: NativeStore
    @ObservedObject var auth: NativeAuth
    @State private var navigation = FitTabNavigationState()
    @State private var keyboardVisible = false
    @ObservedObject private var router = NativeWorkoutRouter.shared
    private var selection: FitTab { navigation.selection }
    private var visited: Set<FitTab> { navigation.visited }
    private var rootRequests: [FitTab: UUID] { navigation.rootRequests }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                ForEach(FitTab.allCases, id: \.self) { tab in
                    if visited.contains(tab) {
                        page(tab)
                            .environment(\.fitTabRootRequest, rootRequests[tab])
                            .opacity(selection == tab ? 1 : 0)
                            .zIndex(selection == tab ? 1 : 0)
                            .allowsHitTesting(selection == tab)
                            .disabled(selection != tab)
                            .accessibilityHidden(selection != tab)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // Reserve the bar's actual height in layout, rather than relying on
            // nested NavigationStacks to forward an outer bottom safe-area inset.
            if !keyboardVisible {
                FitBottomNav(selection: selection) { tab in
                    select(tab, returnToRootIfSelected: true)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .environment(\.fitSelectTab, FitTabSelect { select($0) })
        .safeAreaInset(edge: .top, spacing: 0) { banner }
        .overlay(alignment: .top) {
            ZStack {
                if let activityLabel {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini)
                        Text(activityLabel)
                    }
                        .font(.fit(.xs, .medium))
                        .foregroundStyle(FitColor.muted)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(FitColor.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(FitColor.line))
                        .padding(.top, 4)
                        .transition(.opacity)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .allowsHitTesting(false)
            .animation(.easeOut(duration: 0.15), value: activityLabel)
        }
        .onAppear { selectRequestedTab(); router.resolve(store: store) }
        .onChange(of: router.requestedTab) { _, _ in selectRequestedTab() }
        .onChange(of: store.loaded) { _, _ in router.resolve(store: store) }
        .onChange(of: auth.generation) { _, _ in router.resolve(store: store) }
        .fullScreenCover(item: $router.presented) { destination in
            NavigationStack {
                NativeWorkoutView(date: destination.date, dayID: destination.dayID, mode: destination.guided ? .guided : .history)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Volver") { router.presented = nil }
                        }
                    }
            }
            .environmentObject(store)
            .font(.fit(.base)).foregroundStyle(FitColor.ink).tint(FitColor.accent)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
    }

    private func select(_ tab: FitTab, returnToRootIfSelected: Bool = false) {
        // A repeated tap only emits a request. It neither destroys the page nor
        // resigns focus, which would commit a draft before the dirty-form guard.
        guard navigation.select(tab, returnToRootIfSelected: returnToRootIfSelected) else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        keyboardVisible = false
    }

    private func selectRequestedTab() {
        guard let tab = router.consumeRequestedTab() else { return }
        select(tab, returnToRootIfSelected: true)
    }

    private var activityLabel: String? {
        if store.busy { return "Guardando…" }
        if store.loading || store.refreshing { return store.loaded ? "Actualizando…" : "Cargando…" }
        return nil
    }

    private func retryRefresh() {
        let generation = auth.generation
        Task {
            guard auth.ready, auth.session != nil, generation == auth.generation,
                  !store.loading, !store.refreshing, !store.busy else { return }
            await store.refresh()
        }
    }

    @ViewBuilder private func page(_ tab: FitTab) -> some View {
        switch tab {
        case .today: NativeTodayView()
        case .routines: NativeRoutinesView()
        case .progress: NativeProgressView()
        case .profile: NativeProfileView()
        }
    }

    @ViewBuilder private var banner: some View {
        if let error = store.error ?? auth.error {
            VStack(alignment: .leading, spacing: 8) {
                FitErrorNote(title: "Revisá el estado de tus datos", message: error,
                             guidance: error.hasPrefix("El cambio se guardó en el servidor")
                                ? FitErrorCopy.savedState(message: error)
                                : "Actualizar datos consulta tu cuenta; no vuelve a enviar cambios pendientes. Si falló un guardado, revisá su estado en la pantalla donde lo hiciste.")
                FitFlowLayout(spacing: 8) {
                    Button("Actualizar datos", action: retryRefresh)
                        .buttonStyle(FitButtonStyle(size: .sm))
                        .disabled(store.loading || store.refreshing || store.busy)
                        .accessibilityHint("Consulta los datos guardados; no reintenta un cambio que no se guardó")
                    Button("Cerrar aviso") { store.error = nil; auth.error = nil }.buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: 512)
            .frame(maxWidth: .infinity)
            .background(FitColor.ground)
        }
    }
}


/// Only explicit app destinations are handled here. OAuth remains exclusively owned by
/// ASWebAuthenticationSession and its PKCE callback validator.
enum NativeTodayLink {
    static func matches(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == "f1t" && parts.host == "today"
            && (parts.path.isEmpty || parts.path == "/")
            && parts.user == nil && parts.password == nil && parts.port == nil
            && parts.query == nil && (parts.fragment == nil || parts.fragment == "")
    }
}

struct NativeWorkoutLink: Equatable {
    let dateKey: String?
    let dayID: String?

    static func parse(_ url: URL) -> Self? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "f1t", parts.host == "workout",
              parts.path.isEmpty || parts.path == "/",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.fragment == nil || parts.fragment == "" else { return nil }
        let items = parts.queryItems ?? []
        guard items.allSatisfy({ ["date", "day"].contains($0.name) }),
              Set(items.map(\.name)).count == items.count else { return nil }
        let date = items.first { $0.name == "date" }?.value
        let day = items.first { $0.name == "day" }?.value
        if items.contains(where: { $0.name == "date" }), date.flatMap(NativeDate.parse) == nil { return nil }
        if items.contains(where: { $0.name == "day" }) {
            guard let day, !day.isEmpty, day.count <= 128,
                  day.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }) else { return nil }
        }
        return Self(dateKey: date, dayID: day)
    }
}

@MainActor final class NativeWorkoutRouter: ObservableObject {
    static let shared = NativeWorkoutRouter()
    struct Destination: Identifiable {
        let id = UUID()
        let date: Date
        let dayID: String?
        let guided: Bool
    }
    @Published var presented: Destination?
    // Independent from pending workout links: a widget navigation never overwrites one.
    @Published var requestedTab: FitTab?
    private var pending: NativeWorkoutLink?
    private var generation: UUID?
    private var owner: String?
    private var coldRestore = false
    private var workoutNavigationDeferred = false

    @discardableResult func receive(_ url: URL, store: NativeStore) -> Bool {
        if NativeTodayLink.matches(url) {
            guard !store.auth.ready || store.auth.session != nil else { return true }
            // Today is the latest navigation intent; retain older queued links
            // without letting hydration/onAppear immediately present them again.
            workoutNavigationDeferred = true
            requestedTab = .today
            return true
        }
        guard let link = NativeWorkoutLink.parse(url) else { return false }
        // A link is navigation, never authorization or an invitation to log in.
        guard !store.auth.ready || store.auth.session != nil else { return true }
        workoutNavigationDeferred = false
        pending = link; generation = store.auth.generation
        owner = store.auth.session?.user.id; coldRestore = !store.auth.ready
        resolve(store: store)
        return true
    }
    func consumeRequestedTab() -> FitTab? {
        guard let tab = requestedTab else { return nil }
        requestedTab = nil
        // Dismiss navigation only. Never stop a workout or clear journal/drafts/outbox.
        if tab == .today { presented = nil }
        return tab
    }
    func handleIdentity(owner incoming: String?, generation incomingGeneration: UUID) {
        // The initial keychain restore may bind one pending cold-launch link.
        if coldRestore, incoming != nil { return }
        if (pending != nil || presented != nil), incoming != owner || incomingGeneration != generation { invalidate() }
    }
    func invalidate() {
        requestedTab = nil
        workoutNavigationDeferred = false
        pending = nil; presented = nil; owner = nil; generation = nil; coldRestore = false
    }
    func resolve(store: NativeStore) {
        guard NativeApplicationLifecycle.shared.restored else { return }
        resolve(store: store, active: NativeLiveActivity.shared.activeAttributes)
    }
    func resolve(store: NativeStore, active: F1tWorkoutAttributes?) {
        guard pending != nil, !workoutNavigationDeferred else { return }
        guard store.auth.ready else { return }
        guard let current = store.auth.session?.user.id else { invalidate(); return }
        if coldRestore {
            owner = current; generation = store.auth.generation; coldRestore = false
        }
        guard current == owner, generation == store.auth.generation else { invalidate(); return }
        guard let link = pending else { return }
        let today = NativeDate.calendar.startOfDay(for: Date())
        let matchingActive = active.flatMap { value -> F1tWorkoutAttributes? in
            guard value.ownerID == current, let date = NativeDate.parse(value.sessionDate), date <= today else { return nil }
            return value
        }
        let key = link.dateKey ?? matchingActive?.sessionDate ?? NativeDate.key()
        guard let date = NativeDate.parse(key), date <= today else { invalidate(); return }
        let exactActive = matchingActive?.sessionDate == key && (link.dayID == nil || matchingActive?.dayID == link.dayID)
        // A durable frozen workout can resume even before remote/cache hydration.
        guard store.loaded || exactActive else { return }
        let session = store.sessions.first { $0.user_id == current && $0.performed_on == key }
        let dayID = link.dayID ?? (matchingActive?.sessionDate == key ? matchingActive?.dayID : nil) ?? session?.routine_day_id ?? store.day(on: date)?.id
        // Reject a stale day rather than silently opening another session/day.
        if let requested = link.dayID, let saved = session?.routine_day_id, requested != saved { invalidate(); return }
        if let dayID, !store.days.contains(where: { $0.id == dayID && $0.user_id == current }),
           !(matchingActive?.sessionDate == key && matchingActive?.dayID == dayID) { invalidate(); return }
        pending = nil
        presented = Destination(date: date, dayID: dayID, guided: exactActive || key == NativeDate.key())
    }
}

/// Installs headless account cleanup and restores just once across AppDelegate
/// and the first SwiftUI scene. Neither notifications nor launches request permission.
@MainActor final class NativeApplicationLifecycle: ObservableObject {
    /// Tests supply isolated auth/transport fixtures, never an installed account.
    /// This suppresses host side effects without publishing or bypassing identity.
    static var isUnitTestHost: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        #else
        false
        #endif
    }
    static let shared = NativeApplicationLifecycle()
    @Published private(set) var widgetError: String?
    private(set) var restored = false
    private var subscriptions: Set<AnyCancellable> = []
    private var restoration: Task<Void, Never>?
    private var attached = false

    func attach(store: NativeStore) {
        guard !attached else { return }
        attached = true
        NativeLiveActivity.shared.attach(store: store)
        store.accountChanges.sink { [weak self] event in
            NativeDevice.shared.handleAccount(event)
            if event.previousOwner != nil || event.incomingOwner == nil { NativeWorkoutRouter.shared.invalidate() }
            self?.clearWidgets()
        }.store(in: &subscriptions)
        store.auth.$session.sink { [weak store] session in
            guard let store, store.auth.ready || session != nil else { return }
            NativeWorkoutRouter.shared.handleIdentity(owner: session?.user.id, generation: store.auth.generation)
        }.store(in: &subscriptions)
        store.auth.localSessionInvalidations.sink { [weak self] in
            NativeWorkoutRouter.shared.invalidate()
            NativeDevice.shared.clear()
            self?.clearWidgets()
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: .nativeWorkoutOpenRequested).sink { [weak store] notification in
            guard let store, let url = notification.object as? URL else { return }
            NativeWorkoutRouter.shared.receive(url, store: store)
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: Notification.Name("nativeDataRefreshed")).sink { [weak self, weak store] notification in
            guard let store, notification.object as? NativeStore === store else { return }
            NativeDevice.shared.sync(store: store)
            do { try NativeWidgetSync.sync(store); self?.widgetError = nil }
            catch { self?.widgetError = error.localizedDescription }
            NativeWorkoutRouter.shared.resolve(store: store)
        }.store(in: &subscriptions)
    }
    func restore(store: NativeStore) async {
        attach(store: store)
        if let restoration { await restoration.value; return }
        let task = Task { @MainActor in
            if !store.auth.ready { await store.bootstrap() }
            await NativeLiveActivity.shared.restore(store: store)
            self.restored = true
            NativeWorkoutRouter.shared.resolve(store: store)
        }
        restoration = task
        await task.value
    }
    private func clearWidgets() {
        do { try NativeWidgetSync.clear(); widgetError = nil }
        catch { widgetError = error.localizedDescription }
    }
}

struct NativeTrainingStatusSettingsView: View {
    @ObservedObject private var live = NativeLiveActivity.shared
    @Environment(\.scenePhase) private var phase
    @State private var notificationStatus: UNAuthorizationStatus?
    @State private var activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
    @State private var checking = false
    var body: some View {
        VStack(spacing: 16) {
            statusCard
            NativeRestNoticePreferences(status: notificationStatus, refreshStatus: readStatus)
            NativeAlarmPreferences()
        }
        .task { await readStatus() }
        .onChange(of: phase) { _, value in if value == .active { Task { await readStatus() } } }
    }
    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Entrenar con la pantalla bloqueada").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            Text("La Actividad en vivo muestra tu ejercicio y descanso. El iPhone debe permanecer encendido; iOS puede pedir desbloquear para algunas acciones.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            Label(activitiesEnabled ? "Actividades en vivo habilitadas" : "Actividades en vivo desactivadas", systemImage: activitiesEnabled ? "checkmark.circle" : "exclamationmark.circle")
                .font(.fit(.sm))
            Text(notificationMessage).font(.fit(.sm)).foregroundStyle(FitColor.muted)
            if let message = live.availabilityMessage { Text(message).font(.fit(.sm)).foregroundStyle(FitColor.muted) }
            if !activitiesEnabled {
                Button("Abrir Ajustes para Actividades en vivo", action: nativeOpenAppSettings)
                    .buttonStyle(FitButtonStyle(size: .sm))
            }
            Text("Los permisos son opcionales. Podés seguir entrenando dentro de FIT sin habilitarlos.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted)
        }
        .padding(20).fitCard(padding: 0)
    }
    private var notificationMessage: String {
        switch notificationStatus {
        case nil: "Consultando el permiso de notificaciones…"
        case .authorized, .provisional, .ephemeral: "Notificaciones habilitadas. La entrega depende de tus ajustes y del modo de concentración."
        case .denied: "Notificaciones desactivadas. Podés habilitarlas en Ajustes para recibir el aviso de descanso."
        default: "El permiso de notificaciones se solicita al activar un aviso, no al abrir FIT."
        }
    }
    private func readStatus() async {
        guard !checking else { return }
        checking = true; defer { checking = false }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = settings.authorizationStatus
        activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        await NativeRestNotifications.shared.refreshPermission()
    }
}

/// Presentation only: the existing providers continue to own authorization and scheduling.
enum FitPermissionState {
    case checking, notDetermined, denied, authorized, unavailable
    var offersRequest: Bool { self == .notDetermined }
    var offersSettings: Bool { self == .denied }
    var canToggle: Bool { self == .authorized }
}

private func nativeOpenAppSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
}

private struct NativeRestNoticePreferences: View {
    @EnvironmentObject private var store: NativeStore
    @ObservedObject private var live = NativeLiveActivity.shared
    @ObservedObject private var notices = NativeRestNotifications.shared
    @State private var requesting = false
    let status: UNAuthorizationStatus?
    let refreshStatus: () async -> Void

    private var permission: FitPermissionState {
        switch status {
        case nil: .checking
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .authorized, .provisional, .ephemeral: .authorized
        default: .unavailable
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Aviso de fin de descanso").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            if permission.canToggle {
                Toggle("Avisar al terminar el descanso", isOn: Binding(
                    get: { notices.enabled },
                    set: { live.setRestNotificationsEnabled($0, store: store) }
                ))
                .font(.fit(.sm)).tint(FitColor.accent)
                .disabled(requesting)
            }
            Text(permission == .checking ? "Consultando el permiso…" :
                 live.restPermissionMessage ?? "El aviso se programa en el iPhone. No hace falta mantener FIT abierta.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            if permission.offersRequest {
                Button(requesting ? "Solicitando permiso…" : "Habilitar avisos de descanso") {
                    guard !requesting else { return }
                    requesting = true
                    Task {
                        live.setRestNotificationsEnabled(true, store: store)
                        await live.requestRestNotifications(store: store)
                        await refreshStatus()
                        requesting = false
                    }
                }
                .buttonStyle(FitButtonStyle(variant: .primary, size: .sm))
                .disabled(requesting)
                .accessibilityHint("Solicita el permiso de notificaciones del iPhone")
            } else if permission.offersSettings {
                Button("Abrir Ajustes de notificaciones", action: nativeOpenAppSettings)
                    .buttonStyle(FitButtonStyle(size: .sm))
            }
            // A rejected system permission must not trap an enabled preference.
            if !permission.canToggle, permission != .checking, notices.enabled {
                Button("Desactivar avisos en FIT") { live.setRestNotificationsEnabled(false, store: store) }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm))
            }
            Text("Silencio y Concentración pueden limitar el aviso. El contador funciona aunque no habilites notificaciones.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20).fitCard(padding: 0)
    }
}

private struct NativeAlarmPreferences: View {
    @ObservedObject private var provider = NativeAlarmProvider.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var requesting = false

    private var permission: FitPermissionState {
        switch provider.authorizationStatus {
        case .unavailable: .unavailable
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .authorized: .authorized
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Alarmas de descanso").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            Text("Opcional en iOS 26: una alarma al terminar el descanso, incluso con la pantalla bloqueada. Puede sonar con Silencio o Concentración activos.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            if permission.canToggle {
                Toggle("Usar alarmas de descanso", isOn: Binding(get: { provider.enabled }, set: setEnabled))
                    .font(.fit(.sm)).tint(FitColor.accent).disabled(requesting)
            }
            Text(provider.authorizationStatus.label).font(.fit(.sm)).foregroundStyle(FitColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            if permission.offersRequest {
                Button(requesting ? "Solicitando permiso…" : "Habilitar alarmas de descanso") { setEnabled(true) }
                    .buttonStyle(FitButtonStyle(variant: .primary, size: .sm))
                    .disabled(requesting)
                    .accessibilityHint("Solicita el permiso de alarmas del iPhone")
            } else if permission.offersSettings {
                Button("Abrir Ajustes de alarmas", action: nativeOpenAppSettings)
                    .buttonStyle(FitButtonStyle(size: .sm))
            }
            if !permission.canToggle, provider.enabled {
                Button("Desactivar alarmas en FIT") { setEnabled(false) }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).disabled(requesting)
            }
            if let error = provider.errorMessage {
                Text(error).font(.fit(.sm)).foregroundStyle(FitColor.warn)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if provider.hasUncertainAlarms {
                Button(requesting ? "Cancelando…" : "Reintentar cancelación") {
                    guard !requesting else { return }
                    requesting = true
                    Task { _ = await provider.cancelAllResult(); requesting = false }
                }
                .buttonStyle(FitButtonStyle(size: .sm)).disabled(requesting)
            }
            Text("Sin alarmas, FIT intenta un aviso normal si habilitaste las notificaciones. El teléfono debe estar encendido.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20).fitCard(padding: 0)
        .onAppear { provider.refreshAuthorization() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { provider.refreshAuthorization() } }
    }

    private func setEnabled(_ value: Bool) {
        guard !requesting else { return }
        requesting = true
        Task { await provider.setEnabled(value); requesting = false }
    }
}
