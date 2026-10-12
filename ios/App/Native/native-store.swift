import Combine
import CryptoKit
import Foundation

struct NativeAccountEvent {
    let previousOwner: String?
    let incomingOwner: String?
}

enum NativeDataDomain: String, CaseIterable, Codable {
    case training, body, foods
}

struct NativeDomainState {
    var loaded = false
    var loading = false
    var usingCachedData = false
    var error: String?
    var lastUpdatedAt: Date?
}

private enum NativeDomainRead {
    case training([NativeRoutine], [NativeRoutineDay], [NativeRoutineExercise], [NativeWorkoutSession], [NativeSet])
    case body([NativeWeight], NativeBodyProfile?)
    case foods([NativeFoodEntry], [NativeFoodDay])
    case failed(NativeDataDomain, Error)

    var domain: NativeDataDomain {
        switch self {
        case .training: return .training
        case .body: return .body
        case .foods: return .foods
        case .failed(let domain, _): return domain
        }
    }
}

@MainActor
final class NativeStore: ObservableObject {
    /// The app's store. Shared so a lock-screen intent can write without a scene.
    static let shared = NativeStore()
    let auth: NativeAuth
    let api: NativeAPI
    @Published var routines: [NativeRoutine] = []
    @Published var days: [NativeRoutineDay] = []
    @Published var routineExercises: [NativeRoutineExercise] = []
    @Published var exercises: [NativeExercise] = []
    @Published var sessions: [NativeWorkoutSession] = []
    @Published var sets: [NativeSet] = []
    @Published var weights: [NativeWeight] = []
    @Published var profile: NativeBodyProfile?
    @Published var foodEntries: [NativeFoodEntry] = []
    @Published var foodDays: [NativeFoodDay] = []
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var routineWeightErrors: [String: String] = [:]
    @Published var loaded = false
    @Published private(set) var refreshing = false
    @Published private(set) var usingCachedData = false
    @Published private(set) var domainStates: [NativeDataDomain: NativeDomainState] = [:]
    /// Legacy `loaded`/`loading`/`usingCachedData` describe training, not every tab.
    func domainState(_ domain: NativeDataDomain) -> NativeDomainState {
        domainStates[domain] ?? NativeDomainState()
    }
    var bodyLoaded: Bool { domainState(.body).loaded }
    var foodsLoaded: Bool { domainState(.foods).loaded }
    @Published var workoutSyncRevision: UInt64 = 0
    @Published var workoutPendingCount = 0
    @Published var workoutSyncing = false
    @Published var workoutSyncError: String?
    let workoutRepository: NativeWorkoutRepository
    let automaticallyReplayWorkouts: Bool
    var workoutReplayTask: Task<Void, Never>?
    var workoutRetryTask: Task<Void, Never>?
    private var owner: String?
    let accountChanges = PassthroughSubject<NativeAccountEvent, Never>()
    private var subscription: AnyCancellable?
    private var invalidationSubscription: AnyCancellable?
    private var revision = UUID()
    private var accountGeneration: UUID
    private var refreshID: UUID?
    private var authorizationFailure: NativeFailure?
    private var refreshTask: Task<Void, Never>?
    private var hydrationTask: Task<Void, Never>?
    private var hydrationStarted = false
    private var snapshotSavedAt: Date?
    var lastCompleteSnapshotDate: Date? { snapshotSavedAt }
    private var mutationID: UUID?
    private let cache: NativeDataCache
    private var cacheTicket: UUID
    init(auth: NativeAuth? = nil, api: NativeAPI? = nil, automaticallyRefresh: Bool = true,
         cache: NativeDataCache = NativeDataCache(), workoutRepository: NativeWorkoutRepository? = nil,
         automaticallyReplayWorkouts: Bool = true) {
        let auth = auth ?? NativeAuth()
        self.auth = auth; self.api = api ?? NativeAPI(auth: auth)
        // Injecting a cache is used by isolated fixtures; their journal lives beside
        // that cache rather than reading or writing the real user's Application Support.
        self.workoutRepository = workoutRepository ?? NativeWorkoutRepository(directory: cache.workoutDirectory?.appendingPathComponent(auth.storageNamespace, isDirectory: true))
        self.automaticallyReplayWorkouts = automaticallyReplayWorkouts
        self.cache = cache; cacheTicket = cache.activate(owner: nil); accountGeneration = auth.generation
        auth.pendingWorkoutChangesProvider = { [weak self] in
            guard let self, let owner = self.auth.localWorkoutOwnerID else { return NativePendingWorkoutChanges() }
            let envelope = try self.workoutRepository.read(owner: owner)
            return NativePendingWorkoutChanges(operations: envelope.outbox.count, drafts: envelope.drafts.count)
        }
        auth.discardLocalWorkouts = { [weak self] in
            guard let self, let owner = self.auth.localWorkoutOwnerID else { return }
            try self.workoutRepository.discard(owner: owner)
        }
        invalidationSubscription = auth.localSessionInvalidations.sink { [weak self] in
            self?.cache.discardAll()
        }
        do { exercises = try nativeResource("exercise-catalog.json", as: [NativeExercise].self) }
        catch { self.error = error.localizedDescription }
        subscription = auth.$session.sink { [weak self] value in
            guard let self else { return }
            let incomingOwner = value?.user.id
            guard incomingOwner != self.owner || self.accountGeneration != auth.generation else { return }
            let event = NativeAccountEvent(previousOwner: self.owner, incomingOwner: incomingOwner)
            self.owner = incomingOwner; self.accountGeneration = auth.generation
            self.clear()
            // Published emits during willSet: consumers must use this incoming identity.
            if event.previousOwner != event.incomingOwner { self.accountChanges.send(event) }
            if let incomingOwner, automaticallyRefresh {
                // Start disk hydration without waiting for restore/accessToken to finish.
                self.beginHydration()
                let revision = self.revision, generation = self.accountGeneration
                Task { [weak self] in
                    guard let self, self.isCurrent(owner: incomingOwner, revision: revision, generation: generation) else { return }
                    await self.refresh()
                }
            }
        }
    }
    func bootstrap() async {
        await auth.restore()
        if auth.session == nil {
            clear()
            accountChanges.send(NativeAccountEvent(previousOwner: owner, incomingOwner: nil))
        }
    }
    func clear() {
        workoutReplayTask?.cancel(); workoutReplayTask = nil; workoutRetryTask?.cancel(); workoutRetryTask = nil
        workoutSyncing = false; workoutPendingCount = 0; workoutSyncError = nil; workoutSyncRevision &+= 1
        revision = UUID(); cancelRefresh(); hydrationTask?.cancel(); hydrationTask = nil; hydrationStarted = false
        cacheTicket = cache.activate(owner: owner)
        mutationID = nil; busy = false; error = nil; routineWeightErrors = [:]; resetData()
    }
    private func resetData() {
        loaded = false; usingCachedData = false; snapshotSavedAt = nil
        domainStates = [:]
        routines = []; days = []; routineExercises = []; sessions = []; sets = []; weights = []; profile = nil; foodEntries = []; foodDays = []
    }
    private func cancelRefresh() {
        refreshID = nil; authorizationFailure = nil; refreshTask?.cancel(); refreshTask = nil; loading = false; refreshing = false
        for domain in NativeDataDomain.allCases { domainStates[domain]?.loading = false }
    }
    private func isCurrent(owner: String, revision: UUID, generation: UUID) -> Bool {
        self.owner == owner && self.revision == revision && auth.session?.user.id == owner && auth.generation == generation
    }
    private func beginHydration() {
        guard !hydrationStarted, let owner else { return }
        hydrationStarted = true
        let revision = self.revision, generation = accountGeneration, ticket = cacheTicket
        loading = !loaded
        hydrationTask = Task { [weak self] in
            guard let self else { return }
            do {
                let durable = try self.workoutRepository.read(owner: owner)
                guard !Task.isCancelled, self.isCurrent(owner: owner, revision: revision, generation: generation) else { return }
                if let snapshot = durable.snapshot, snapshot.isOwned(by: owner), !self.loaded {
                    self.publish(snapshot, cached: true)
                } else { self.applyWorkoutOverlay() }
            } catch { self.workoutSyncError = error.localizedDescription }
            let snapshot = await self.cache.read(owner: owner, ticket: ticket)
            guard !Task.isCancelled, self.isCurrent(owner: owner, revision: revision, generation: generation),
                  !self.loaded, let snapshot else { return }
            self.publish(snapshot, cached: true)
        }
    }
    /// Foreground, date rollover and pull-to-refresh always revalidate; only in-flight reads coalesce.
    func refresh(force: Bool = false) async {
        guard let owner = auth.session?.user.id, self.owner == owner else { return }
        let revision = self.revision, generation = auth.generation
        beginHydration()
        await hydrationTask?.value
        guard !Task.isCancelled, isCurrent(owner: owner, revision: revision, generation: generation) else { return }
        if let savedAt = snapshotSavedAt, !NativeDataSnapshot.isFresh(savedAt),
           (try? workoutRepository.read(owner: owner).snapshot) == nil {
            discardSnapshot()
        }
        scheduleWorkoutReplay()
        if force { cancelRefresh() }
        if let task = refreshTask { await task.value; return }
        let requestID = UUID(), cacheTicket = self.cacheTicket
        refreshID = requestID; authorizationFailure = nil; refreshing = true; loading = !loaded
        for domain in NativeDataDomain.allCases {
            var state = domainState(domain)
            state.loading = true
            domainStates[domain] = state
        }
        let task = Task { [weak self] in
            guard let self else { return }
            let journalRevision = (try? self.workoutRepository.read(owner: owner).revision) ?? 0
            await self.revalidate(owner: owner, revision: revision, generation: generation,
                                  requestID: requestID, cacheTicket: cacheTicket, journalRevision: journalRevision)
        }
        refreshTask = task
        await task.value
    }
    private func fetchForRefresh<T: Decodable>(_ table: String, owner: String, revision: UUID, generation: UUID,
                                               requestID: UUID, query: [URLQueryItem] = []) async throws -> [T] {
        try Task.checkCancellation()
        guard isCurrent(owner: owner, revision: revision, generation: generation), refreshID == requestID else { throw CancellationError() }
        do { return try await api.fetch(table, query: query) }
        catch {
            if isCurrent(owner: owner, revision: revision, generation: generation), refreshID == requestID,
               authorizationFailure == nil, let failure = error as? NativeFailure,
               case .http(let status, _) = failure, status == 401 || status == 403 {
                // Observe denial in every child: another table's error may win the parent's await first.
                authorizationFailure = failure; discardSnapshot(revokingDurable: true)
            }
            throw error
        }
    }
    private func revalidate(owner: String, revision: UUID, generation: UUID, requestID: UUID, cacheTicket: UUID, journalRevision: UInt64) async {
        defer {
            if self.revision == revision, refreshID == requestID {
                loading = false; refreshing = false; refreshTask = nil; refreshID = nil; authorizationFailure = nil
                for domain in NativeDataDomain.allCases { domainStates[domain]?.loading = false }
            }
        }
        do {
            // Prime/coalesce token renewal before independent GETs. NativeAPI retains per-page identity checks.
            _ = try await auth.accessToken()
            try Task.checkCancellation()
            guard isCurrent(owner: owner, revision: revision, generation: generation), refreshID == requestID else { return }
            var confirmed = Set<NativeDataDomain>()
            var trainingRead: NativeDomainRead?
            // Each domain publishes atomically, independently of the other tabs.
            // Training's five related tables are never presented half-loaded.
            await withTaskGroup(of: NativeDomainRead.self) { group in
                for domain in NativeDataDomain.allCases {
                    group.addTask {
                        await self.readDomain(domain, owner: owner, revision: revision, generation: generation, requestID: requestID)
                    }
                }
                for await result in group {
                    guard !Task.isCancelled, isCurrent(owner: owner, revision: revision, generation: generation),
                          refreshID == requestID else { group.cancelAll(); continue }
                    guard authorizationFailure == nil else { group.cancelAll(); continue }
                    switch result {
                    case .failed(let domain, let failure):
                        if failure is CancellationError { continue }
                        var state = domainState(domain)
                        state.loading = false; state.usingCachedData = state.loaded
                        state.error = Self.loadFailureMessage(failure)
                        domainStates[domain] = state
                        if domain == .training { usingCachedData = loaded; error = state.error; loading = false }
                    default:
                        if result.domain == .training { trainingRead = result }
                        publishDomain(result)
                        confirmed.insert(result.domain)
                        if let partial = snapshotForRefresh(owner: owner, trainingRead: trainingRead) {
                            do { try workoutRepository.retainPartialSnapshot(partial, trainingReadRevision: trainingRead == nil ? nil : journalRevision) }
                            catch { workoutSyncError = error.localizedDescription }
                            restoreTrainingProjection(trainingRead)
                        }
                    }
                }
            }
            try Task.checkCancellation()
            guard isCurrent(owner: owner, revision: revision, generation: generation), refreshID == requestID else { return }
            if let authorizationFailure { throw authorizationFailure }
            guard !confirmed.isEmpty, let partial = snapshotForRefresh(owner: owner, trainingRead: trainingRead) else { return }
            // An incomplete cohort may retain available domains and the previous
            // food history. Only the confirmed training GET can retire older ACKs;
            // pending writes/newer ACKs win and no complete account GET is claimed.
            let snapshot: NativeDataSnapshot
            if confirmed.count == NativeDataDomain.allCases.count {
                snapshot = partial.confirmed(at: Date())
                do { try workoutRepository.checkpoint(snapshot, readRevision: journalRevision) }
                catch { workoutSyncError = error.localizedDescription }
                snapshotSavedAt = snapshot.savedAt
                restoreTrainingProjection(trainingRead)
            } else {
                snapshot = partial
                do { try workoutRepository.retainPartialSnapshot(snapshot, trainingReadRevision: trainingRead == nil ? nil : journalRevision) }
                catch { workoutSyncError = error.localizedDescription }
                restoreTrainingProjection(trainingRead)
            }
            NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self)
            await cache.write(snapshot, ticket: cacheTicket)
        } catch is CancellationError { }
        catch {
            if isCurrent(owner: owner, revision: revision, generation: generation), refreshID == requestID {
                if authorizationFailure == nil, let failure = error as? NativeFailure, case .http(let status, _) = failure, status == 401 || status == 403 {
                    // A rejected identity/permission must never keep serving its previously cached data.
                    discardSnapshot(revokingDurable: true)
                } else if let savedAt = snapshotSavedAt, !NativeDataSnapshot.isFresh(savedAt),
                          (try? workoutRepository.read(owner: owner).snapshot) == nil {
                    discardSnapshot()
                }
                let message = Self.loadFailureMessage(authorizationFailure ?? error)
                for domain in NativeDataDomain.allCases {
                    var state = domainState(domain)
                    state.loading = false; state.usingCachedData = state.loaded; state.error = message
                    domainStates[domain] = state
                }
                usingCachedData = loaded; self.error = message
            }
        }
    }

    private func readDomain(_ domain: NativeDataDomain, owner: String, revision: UUID, generation: UUID, requestID: UUID) async -> NativeDomainRead {
        do {
            switch domain {
            case .training:
                async let r: [NativeRoutine] = fetchForRefresh("routines", owner: owner, revision: revision, generation: generation, requestID: requestID)
                async let d: [NativeRoutineDay] = fetchForRefresh("routine_days", owner: owner, revision: revision, generation: generation, requestID: requestID)
                async let e: [NativeRoutineExercise] = fetchForRefresh("routine_exercises", owner: owner, revision: revision, generation: generation, requestID: requestID)
                async let s: [NativeWorkoutSession] = fetchForRefresh("sessions", owner: owner, revision: revision, generation: generation, requestID: requestID,
                    query: [URLQueryItem(name: "order", value: "performed_on.desc,id.desc")])
                async let ss: [NativeSet] = fetchForRefresh("session_sets", owner: owner, revision: revision, generation: generation, requestID: requestID)
                let values = try await (r, d, e, s, ss)
                try requireCurrentRefresh(owner: owner, revision: revision, generation: generation, requestID: requestID)
                guard values.0.allSatisfy({ $0.user_id == owner }), values.1.allSatisfy({ $0.user_id == owner }),
                      values.2.allSatisfy({ $0.user_id == owner }), values.3.allSatisfy({ $0.user_id == owner }),
                      values.4.allSatisfy({ $0.user_id == owner }) else { throw foreignDataFailure() }
                return .training(values.0, values.1, values.2, values.3, values.4)
            case .body:
                async let w: [NativeWeight] = fetchForRefresh("weight_entries", owner: owner, revision: revision, generation: generation, requestID: requestID,
                    query: [URLQueryItem(name: "order", value: "measured_on.desc,id.desc")])
                async let p: [NativeBodyProfile] = fetchForRefresh("body_profile", owner: owner, revision: revision, generation: generation, requestID: requestID)
                let values = try await (w, p)
                try requireCurrentRefresh(owner: owner, revision: revision, generation: generation, requestID: requestID)
                guard values.0.allSatisfy({ $0.user_id == owner }), values.1.allSatisfy({ $0.user_id == owner }) else { throw foreignDataFailure() }
                return .body(values.0, values.1.first)
            case .foods:
                async let f: [NativeFoodEntry] = fetchForRefresh("food_entries", owner: owner, revision: revision, generation: generation, requestID: requestID,
                    query: [URLQueryItem(name: "order", value: "created_at.asc,id.asc")])
                async let fd: [NativeFoodDay] = fetchForRefresh("food_days", owner: owner, revision: revision, generation: generation, requestID: requestID)
                let values = try await (f, fd)
                try requireCurrentRefresh(owner: owner, revision: revision, generation: generation, requestID: requestID)
                guard values.0.allSatisfy({ $0.user_id == owner }), values.1.allSatisfy({ $0.user_id == owner }) else { throw foreignDataFailure() }
                return .foods(values.0, values.1)
            }
        } catch { return .failed(domain, error) }
    }

    private func requireCurrentRefresh(owner: String, revision: UUID, generation: UUID, requestID: UUID) throws {
        try Task.checkCancellation()
        guard isCurrent(owner: owner, revision: revision, generation: generation), refreshID == requestID else { throw CancellationError() }
    }

    private static func loadFailureMessage(_ failure: Error) -> String {
        // Reads are retried by Actualizar, not by the workout outbox. Never promise
        // automatic synchronization as the recovery for a failed domain load.
        if NativeFailure.isConnectivityFailure(failure) {
            return "Sin conexión para actualizar. Tus datos guardados y borradores se conservan; reintentá cuando tengas conexión."
        }
        if case .http(let status, _) = failure as? NativeFailure {
            if status == 429 { return "El servicio está ocupado. Reintentá actualizar más tarde; tus registros guardados se conservan." }
            if status >= 500 { return "El servicio no está disponible. Reintentá actualizar más tarde; tus registros guardados se conservan." }
        }
        return NativeFailure.userMessage(failure)
    }

    private func foreignDataFailure() -> NativeFailure {
        // Foreign rows are a definitive account-boundary failure, not an empty tab.
        let failure = NativeFailure.http(403, "foreign_account_data")
        authorizationFailure = failure; discardSnapshot(revokingDurable: true)
        return failure
    }

    private func publishDomain(_ result: NativeDomainRead) {
        switch result {
        case .training(let r, let d, let e, let s, let ss):
            routines = r; days = d; routineExercises = e; sessions = s; sets = ss
            loaded = true; loading = false; usingCachedData = false; error = nil
            applyWorkoutOverlay(notify: false)
        case .body(let w, let p): weights = w; profile = p
        case .foods(let f, let fd): foodEntries = f; foodDays = fd
        case .failed: return
        }
        domainStates[result.domain] = NativeDomainState(loaded: true, lastUpdatedAt: Date())
        NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self)
    }

    private func snapshotForRefresh(owner: String, trainingRead: NativeDomainRead?) -> NativeDataSnapshot? {
        guard let base = currentWorkoutSnapshot(owner: owner) else { return nil }
        guard let trainingRead, case .training(let r, let d, let e, let s, let ss) = trainingRead else { return base }
        // Persist the actual GET, not an already-overlaid UI projection. Otherwise
        // retiring an older ACK would leave its obsolete row inside the snapshot.
        return NativeDataSnapshot(ownerID: owner, savedAt: base.savedAt, routines: r, days: d, routineExercises: e,
            sessions: s, sets: ss, weights: base.weights, profile: base.profile, foodEntries: base.foodEntries,
            foodDays: base.foodDays, domainSavedAt: base.domainSavedAt, completeRefresh: false)
    }

    private func restoreTrainingProjection(_ read: NativeDomainRead?) {
        guard let read, case .training(let r, let d, let e, let s, let ss) = read else { return }
        routines = r; days = d; routineExercises = e; sessions = s; sets = ss
        applyWorkoutOverlay(notify: false)
    }
    private func discardSnapshot(revokingDurable: Bool = false) {
        if revokingDurable, let owner {
            // Definitive denial revokes the account projection on cold launch
            // too. The private journal's pending commands and drafts stay intact.
            do { try workoutRepository.invalidateSnapshot(owner: owner) }
            catch { workoutSyncError = "No se pudo invalidar la copia local tras el rechazo de acceso. " + error.localizedDescription }
        }
        resetData(); cache.discard(owner: owner, ticket: cacheTicket)
        // Consumers such as widgets must clear the snapshot they derived from this store too.
        NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self)
    }
    private func publish(_ snapshot: NativeDataSnapshot, cached: Bool) {
        routines = snapshot.routines; days = snapshot.days; routineExercises = snapshot.routineExercises
        sessions = snapshot.sessions; sets = snapshot.sets; weights = snapshot.weights; profile = snapshot.profile
        foodEntries = snapshot.foodEntries; foodDays = snapshot.foodDays
        for domain in NativeDataDomain.allCases {
            let date = snapshot.updatedAt(for: domain)
            domainStates[domain] = NativeDomainState(loaded: date != nil, usingCachedData: cached && date != nil, lastUpdatedAt: date)
        }
        snapshotSavedAt = snapshot.isCompleteRefresh ? snapshot.savedAt : nil
        usingCachedData = domainState(.training).usingCachedData; loaded = domainState(.training).loaded
        loading = false; error = nil
        applyWorkoutOverlay(notify: false)
        NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self)
    }
    private func markAvailableDomainsStale() {
        usingCachedData = loaded
        for domain in NativeDataDomain.allCases {
            var state = domainState(domain)
            state.usingCachedData = state.loaded
            domainStates[domain] = state
        }
    }
    /// Invoke synchronously after publishing identity-checked server acknowledgements
    /// (profile/weight/food/routine insert, update or deletion), before scheduling GETs.
    /// A remote success is never presented as a failed remote write when disk fails.
    func acknowledgeConfirmedMutation(action: NativeWorkoutAction) throws {
        try action.check(in: auth)
        guard let owner = auth.session?.user.id else { throw CancellationError() }
        cancelRefresh(); hydrationTask?.cancel(); hydrationTask = nil; hydrationStarted = true
        markAvailableDomainsStale()
        cache.discard(owner: owner, ticket: cacheTicket)
        do {
            try workoutRepository.invalidateSnapshot(owner: owner)
            guard let snapshot = currentWorkoutSnapshot(owner: owner) else {
                // The returned row is known, but it cannot make nine unloaded
                // domains a complete account snapshot. Keep the old copy fenced.
                NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self)
                return
            }
            guard snapshot.isOwned(by: owner) else { throw NativeFailure.message("La copia local no pertenece a esta cuenta.") }
            let envelope = try workoutRepository.transact(owner: owner) {
                $0.snapshot = snapshot
                $0.snapshotNeedsRevalidation = true
            }
            try workoutRepository.clearSnapshotFence(owner: owner)
            let ticket = cacheTicket, generation = auth.generation, journalRevision = envelope.revision
            Task { [weak self] in
                guard let self, self.auth.generation == generation, self.auth.session?.user.id == owner,
                      (try? self.workoutRepository.read(owner: owner).revision) == journalRevision else { return }
                await self.cache.write(snapshot, ticket: ticket)
            }
            NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self)
        } catch {
            let message = "El cambio se guardó en el servidor, pero no se pudo actualizar la copia de este iPhone. " + error.localizedDescription
            self.error = message
            throw NativeFailure.message(message)
        }
    }
    /// Set acknowledgesLocalState only when operation publishes returned server
    /// rows/deletions. return=minimal writes cannot establish a fresh local snapshot.
    @discardableResult func run(acknowledgesLocalState: Bool = false, _ operation: () async throws -> Void) async -> Bool {
        guard !busy, auth.session != nil else { return false }
        let identity = auth.generation, mutationID = UUID()
        self.mutationID = mutationID; busy = true; error = nil
        defer { if identity == auth.generation, self.mutationID == mutationID { busy = false; self.mutationID = nil } }
        do {
            try await operation()
            guard identity == auth.generation else { return false }
            markAvailableDomainsStale()
            // Unknown return=minimal writes fence the account copy, never the
            // workout journal's rows/outbox/drafts. Explicit acknowledgements can
            // persist the fully known arrays instead.
            do {
                if acknowledgesLocalState { try acknowledgeConfirmedMutation(action: NativeWorkoutAction(auth: auth)) }
                else {
                    cancelRefresh(); hydrationTask?.cancel(); hydrationTask = nil; hydrationStarted = true
                    cache.discard(owner: owner, ticket: cacheTicket)
                    if let owner { try workoutRepository.invalidateSnapshot(owner: owner, preserveAsStale: true) }
                }
            }
            catch {
                self.error = "El cambio se guardó en el servidor, pero no se pudo actualizar el estado de la copia local. " + error.localizedDescription
            }
            // Release mutation controls before unrelated account reads. Keep the
            // last local snapshot available if the subsequent refresh fails.
            busy = false; self.mutationID = nil
            await refresh(force: true); return identity == auth.generation
        } catch is CancellationError { return false }
        catch { if identity == auth.generation { self.error = error.localizedDescription }; return false }
    }
    var active: NativeRoutine? { routines.first(where: \.is_active) }
    func day(on date: Date) -> NativeRoutineDay? { days.first { $0.routine_id == active?.id && $0.weekday == NativeDate.weekday(date) } }
    func plan(_ day: NativeRoutineDay?) -> [NativeRoutineExercise] { routineExercises.filter { $0.routine_day_id == day?.id }.sorted { $0.position < $1.position } }
    func exercise(_ id: String) -> NativeExercise? { exercises.first { $0.id == id } }
    func ensureSession(date: String, day: String?, action: NativeWorkoutAction? = nil) async throws -> NativeWorkoutSession {
        try action?.check(in: auth)
        let q = nativeQuery("performed_on", date)
        let existing: [NativeWorkoutSession] = try await api.fetch("sessions", query: q)
        try action?.check(in: auth)
        if let row = existing.first {
            guard row.user_id == auth.session?.user.id, row.performed_on == date else {
                throw NativeFailure.message("La sesión recibida no pertenece a este entrenamiento o cuenta.")
            }
            return row
        }
        var body = NativeWorkoutSelection.sessionBody(date: date, day: day)
        // A local session has a stable UUID; reuse it when the date has no server
        // row. Existing dates always use the server's ID, including another client.
        if let owner = auth.session?.user.id, let local = try workoutRepository.read(owner: owner).sessions.first(where: { $0.performed_on == date }) {
            body["id"] = local.id
        }
        do { try await api.write("sessions", method: "POST", body: body) }
        catch NativeFailure.http(_, "23505") { /* Another client created this date first. */ }
        try action?.check(in: auth)
        let rows: [NativeWorkoutSession] = try await api.fetch("sessions", query: q)
        try action?.check(in: auth)
        guard let row = rows.first else { throw NativeFailure.message("No se pudo encontrar la sesión creada.") }
        guard row.user_id == auth.session?.user.id, row.performed_on == date else {
            throw NativeFailure.message("La sesión recibida no pertenece a este entrenamiento o cuenta.")
        }
        return row
    }
}


/// A complete account snapshot keeps `loaded` honest for workout, food and body screens.
/// Authentication/session models and the bundled public exercise catalog are deliberately excluded.
struct NativeDataSnapshot: Codable {
    static let currentVersion = 1
    static let maximumAge: TimeInterval = 7 * 24 * 60 * 60
    var schemaVersion = currentVersion
    let ownerID: String
    let savedAt: Date
    let routines: [NativeRoutine]
    let days: [NativeRoutineDay]
    let routineExercises: [NativeRoutineExercise]
    let sessions: [NativeWorkoutSession]
    let sets: [NativeSet]
    let weights: [NativeWeight]
    let profile: NativeBodyProfile?
    let foodEntries: [NativeFoodEntry]
    let foodDays: [NativeFoodDay]
    // Optional for compatibility with complete v1 snapshots. Missing domains are
    // unknown, not confirmed empty. Their previous arrays/timestamps are retained.
    var domainSavedAt: [String: Date]? = nil
    var completeRefresh: Bool? = nil

    var isCompleteRefresh: Bool {
        (completeRefresh ?? true) && NativeDataDomain.allCases.allSatisfy { updatedAt(for: $0) != nil }
    }
    func updatedAt(for domain: NativeDataDomain) -> Date? {
        if let domainSavedAt { return domainSavedAt[domain.rawValue] }
        return savedAt
    }
    func confirmed(at date: Date) -> Self {
        Self(ownerID: ownerID, savedAt: date, routines: routines, days: days, routineExercises: routineExercises,
             sessions: sessions, sets: sets, weights: weights, profile: profile, foodEntries: foodEntries,
             foodDays: foodDays, domainSavedAt: Dictionary(uniqueKeysWithValues: NativeDataDomain.allCases.map { ($0.rawValue, date) }), completeRefresh: true)
    }

    static func isFresh(_ date: Date, now: Date = Date()) -> Bool {
        let age = now.timeIntervalSince(date)
        return age >= -300 && age <= maximumAge
    }
    func isValid(for owner: String, now: Date = Date()) -> Bool {
        Self.isFresh(savedAt, now: now) && isOwned(by: owner)
            && (domainSavedAt?.values.allSatisfy { Self.isFresh($0, now: now) } ?? true)
    }
    func isOwned(by owner: String) -> Bool {
        schemaVersion == Self.currentVersion && ownerID == owner
            && (domainSavedAt?.allSatisfy { NativeDataDomain(rawValue: $0.key) != nil && $0.value.timeIntervalSince1970.isFinite } ?? true)
            && routines.allSatisfy { $0.user_id == owner } && days.allSatisfy { $0.user_id == owner }
            && routineExercises.allSatisfy { $0.user_id == owner } && sessions.allSatisfy { $0.user_id == owner }
            && sets.allSatisfy { $0.user_id == owner } && weights.allSatisfy { $0.user_id == owner }
            && (profile == nil || profile?.user_id == owner) && foodEntries.allSatisfy { $0.user_id == owner }
            && foodDays.allSatisfy { $0.user_id == owner }
    }
}

/// Serial disk I/O stays off the main actor. Activation is enqueued synchronously so
/// logout/account switches precede later writes, even when an outgoing task finishes late.
final class NativeDataCache: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.morguimateo.f1t.native-data-cache", qos: .userInitiated)
    private let directory: URL?
    let workoutDirectory: URL?
    private let maximumBytes = 16 * 1024 * 1024
    // These fields are accessed only by `queue`.
    private var owner: String?
    private var ticket: UUID?

    init(directory: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent("f1t-native-data-v1", isDirectory: true), workoutDirectory: URL? = nil) {
        self.directory = directory
        let standard = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("f1t-native-data-v1", isDirectory: true)
        if let workoutDirectory { self.workoutDirectory = workoutDirectory }
        else if directory == standard {
            self.workoutDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
                .appendingPathComponent("f1t-workouts-v1", isDirectory: true)
        } else {
            self.workoutDirectory = directory.map {
                $0.deletingLastPathComponent().appendingPathComponent($0.lastPathComponent + "-workout-journal", isDirectory: true)
            }
        }
    }
    @discardableResult func activate(owner: String?) -> UUID {
        let ticket = UUID()
        queue.async {
            if let outgoing = self.owner, outgoing != owner { self.remove(outgoing) }
            // A previous process may never have published its expired owner.
            // Preserve nil startup/offline retry, but retain only the authenticated owner.
            if let owner { self.removeAll(except: self.url(for: owner)) }
            self.owner = owner; self.ticket = ticket
        }
        return ticket
    }
    func read(owner: String, ticket: UUID) async -> NativeDataSnapshot? {
        await withCheckedContinuation { continuation in
            queue.async {
                guard self.owner == owner, self.ticket == ticket, let url = self.url(for: owner) else {
                    continuation.resume(returning: nil); return
                }
                do {
                    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
                    guard let size = attributes[.size] as? NSNumber, size.intValue <= self.maximumBytes else {
                        self.remove(owner); continuation.resume(returning: nil); return
                    }
                    let snapshot = try JSONDecoder().decode(NativeDataSnapshot.self, from: Data(contentsOf: url))
                    guard snapshot.isValid(for: owner) else {
                        self.remove(owner); continuation.resume(returning: nil); return
                    }
                    continuation.resume(returning: snapshot)
                } catch {
                    // Missing, expired, incompatible or corrupt cache is a normal network fallback.
                    self.remove(owner); continuation.resume(returning: nil)
                }
            }
        }
    }
    func write(_ snapshot: NativeDataSnapshot, ticket: UUID) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async {
                defer { continuation.resume() }
                guard self.owner == snapshot.ownerID, self.ticket == ticket, snapshot.isValid(for: snapshot.ownerID),
                      let directory = self.directory, let url = self.url(for: snapshot.ownerID) else { return }
                do {
                    let data = try JSONEncoder().encode(snapshot)
                    guard data.count <= self.maximumBytes else { self.remove(snapshot.ownerID); return }
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                } catch {
                    // Cache failure must not turn a successful server refresh into a failed mutation.
                    self.remove(snapshot.ownerID)
                }
            }
        }
    }
    func discard(owner: String?, ticket: UUID) {
        queue.async {
            guard let owner, self.owner == owner, self.ticket == ticket else { return }
            self.remove(owner)
        }
    }
    func discardAll() {
        queue.async {
            // Invalidate pending outgoing writes as well as orphaned on-disk owners.
            self.owner = nil; self.ticket = nil; self.removeAll(except: nil)
        }
    }
    private func removeAll(except retained: URL?) {
        guard let directory,
              let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        // Both paths are inside this enumerated directory; aliases may change their URL prefixes.
        for file in files where file.lastPathComponent != retained?.lastPathComponent {
            try? FileManager.default.removeItem(at: file)
        }
    }
    private func url(for owner: String) -> URL? {
        let name = SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory?.appendingPathComponent(name + ".json")
    }
    private func remove(_ owner: String) {
        if let url = url(for: owner) { try? FileManager.default.removeItem(at: url) }
    }
}
