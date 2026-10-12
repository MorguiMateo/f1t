import Foundation
import CryptoKit

struct NativeWorkoutDraft: Codable, Equatable {
    let repsText: String
    let weightText: String
}

/// One app-process writer. Widgets receive projections, never this private journal.
/// A transaction replaces the entire owner envelope, so a row and its outbox entry
/// cannot be committed separately. Unreadable/corrupt files are NEVER silently reset.
@MainActor
final class NativeWorkoutRepository {
    struct Mutation: Codable, Identifiable {
        enum Kind: String, Codable { case set, deleteSet, deleteSession }
        let id: String
        let kind: Kind
        let date: String
        let dayID: String?
        let exerciseID: String
        let index: Int
        let reps: Int?
        let weight: Double?
        let localSetID: String
        var remoteSessionID: String?
        var revision: UInt64
        var failure: String?
        var attempts = 0
        var retryAt: Date?
        var requiresAttention = false
        var key: String { Self.key(date: date, exerciseID: exerciseID, index: index) }
        static func key(date: String, exerciseID: String, index: Int) -> String {
            [date, exerciseID, String(index)].joined(separator: "\u{1f}")
        }
    }
    struct Change: Codable {
        var mutation: Mutation
        var row: NativeSet?
        var acknowledged: Bool
        // ACK freshness and local edit ordering are separate: acknowledging an
        // older session deletion must not move it after a later local restart.
        var acknowledgedRevision: UInt64? = nil
    }
    struct MutationHead: Codable {
        let token: UUID
        let kind: Mutation.Kind
        let revision: UInt64
    }
    struct Envelope: Codable {
        var version = 1
        let ownerID: String
        var revision: UInt64 = 0
        var snapshot: NativeDataSnapshot?
        var snapshotNeedsRevalidation = false
        var sessions: [NativeWorkoutSession] = []
        var changes: [String: Change] = [:]
        var outbox: [Mutation] = []
        var drafts: [String: NativeWorkoutDraft] = [:]
        // Optional for compatibility with journals predating conditional Undo.
        // Independent of sync overlays: a checkpoint must not expire this token.
        var mutationHeads: [String: MutationHead]?

        func mutationHead(date: String, exerciseID: String, index: Int) -> MutationHead? {
            let head = mutationHeads?[Mutation.key(date: date, exerciseID: exerciseID, index: index)]
            let session = mutationHeads?[Mutation.key(date: date, exerciseID: "", index: -1)]
            if let session, session.revision > (head?.revision ?? 0) { return session }
            return head
        }

        mutating func recordMutation(_ operation: Mutation) throws {
            guard let token = UUID(uuidString: operation.id) else {
                throw NativeFailure.message("No se pudo validar la acción de entrenamiento.")
            }
            if mutationHeads == nil { mutationHeads = [:] }
            mutationHeads?[operation.key] = MutationHead(token: token, kind: operation.kind, revision: operation.revision)
        }
    }
    private let directory: URL?
    private var envelopes: [String: Envelope] = [:]
    private let maximumBytes = 32 * 1024 * 1024

    init(directory: URL? = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("f1t-workouts-v1", isDirectory: true)) {
        self.directory = directory
    }

    func read(owner: String) throws -> Envelope {
        if let existing = envelopes[owner] { return existing }
        let url = try fileURL(owner: owner)
        var value: Envelope
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= maximumBytes else { throw NativeFailure.message("El archivo local de entrenamiento es demasiado grande. No se modificó tu progreso.") }
            value = try JSONDecoder().decode(Envelope.self, from: data)
            guard value.version == 1, value.ownerID == owner,
                  value.sessions.allSatisfy({ $0.user_id == owner }),
                  value.changes.values.allSatisfy({ $0.row == nil || $0.row?.user_id == owner }),
                  value.snapshot == nil || value.snapshot?.isOwned(by: owner) == true,
                  Set(value.outbox.map(\.id)).count == value.outbox.count else {
                throw NativeFailure.message("No se pudo validar el progreso local. No se modificó el archivo.")
            }
        } catch let failure as CocoaError where failure.code == .fileReadNoSuchFile {
            value = Envelope(ownerID: owner)
        } catch {
            if let failure = error as? NativeFailure { throw failure }
            throw NativeFailure.message("No se pudo leer el progreso local. Desbloqueá el iPhone y reintentá; el archivo no se borró.")
        }
        if value.mutationHeads == nil {
            value.mutationHeads = [:]
            let operations = value.changes.values.map(\.mutation) + value.outbox
            for operation in operations.sorted(by: { $0.revision < $1.revision }) {
                try value.recordMutation(operation)
            }
        }
        let fenceURL = try snapshotFenceURL(owner: owner)
        if FileManager.default.fileExists(atPath: fenceURL.path) {
            let fence = try Data(contentsOf: fenceURL)
            value.snapshotNeedsRevalidation = true
            if fence != Data("stale".utf8) { value.snapshot = nil }
        }
        envelopes[owner] = value
        return value
    }

    @discardableResult
    func transact(owner: String, _ update: (inout Envelope) throws -> Void) throws -> Envelope {
        var next = try read(owner: owner)
        next.revision += 1
        try update(&next)
        let url = try fileURL(owner: owner)
        guard let directory else { throw NativeFailure.message("No hay almacenamiento local disponible.") }
        do {
            let data = try JSONEncoder().encode(next)
            guard data.count <= maximumBytes else { throw NativeFailure.message("No hay espacio suficiente para guardar el progreso local.") }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: url, options: .atomic)
            #endif
        } catch {
            if let failure = error as? NativeFailure { throw failure }
            throw NativeFailure.message("No se pudo guardar en este iPhone. Revisá el espacio disponible, desbloquealo y reintentá.")
        }
        envelopes[owner] = next
        return next
    }

    func discard(owner: String) throws {
        let url = try fileURL(owner: owner)
        do { try FileManager.default.removeItem(at: url) }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile { }
        try clearSnapshotFence(owner: owner)
        envelopes[owner] = nil
    }

    /// A tiny durable fence prevents an old acknowledged account snapshot from
    /// reappearing if the subsequent (larger) snapshot write fails. Pending workout
    /// rows/outbox/drafts remain in the journal and are never erased by this fence.
    func invalidateSnapshot(owner: String, preserveAsStale: Bool = false) throws {
        guard let directory else { throw NativeFailure.message("No hay almacenamiento local disponible.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = try snapshotFenceURL(owner: owner)
        // An unknown acknowledged write cannot downgrade a definitive access
        // revocation and make the old on-disk account snapshot readable again.
        var preservesSnapshot = preserveAsStale
        if preserveAsStale, FileManager.default.fileExists(atPath: url.path) {
            preservesSnapshot = try Data(contentsOf: url) == Data("stale".utf8)
        }
        let data = Data((preservesSnapshot ? "stale" : "invalid").utf8)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
        if var existing = envelopes[owner] {
            existing.snapshotNeedsRevalidation = true
            if !preservesSnapshot { existing.snapshot = nil }
            envelopes[owner] = existing
        }
    }

    func clearSnapshotFence(owner: String) throws {
        let url = try snapshotFenceURL(owner: owner)
        do { try FileManager.default.removeItem(at: url) }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile { }
    }

    private func snapshotFenceURL(owner: String) throws -> URL {
        try fileURL(owner: owner).appendingPathExtension("snapshot-invalid")
    }

    func checkpoint(_ snapshot: NativeDataSnapshot, readRevision: UInt64) throws {
        guard snapshot.isOwned(by: snapshot.ownerID), snapshot.isCompleteRefresh else {
            throw NativeFailure.message("La actualización está incompleta. Los cambios locales y los borradores se conservan.")
        }
        try transact(owner: snapshot.ownerID) { envelope in
            envelope.snapshot = snapshot
            envelope.snapshotNeedsRevalidation = false
            Self.retireConfirmedChanges(in: &envelope, readRevision: readRevision)
        }
        try clearSnapshotFence(owner: snapshot.ownerID)
    }

    /// Persist available domains without claiming a complete account read. A full
    /// training-domain GET can retire only older ACKs, never pending writes/drafts.
    func retainPartialSnapshot(_ snapshot: NativeDataSnapshot, trainingReadRevision: UInt64? = nil) throws {
        guard snapshot.isOwned(by: snapshot.ownerID), !snapshot.isCompleteRefresh else {
            throw NativeFailure.message("No se pudo validar la actualización parcial de esta cuenta.")
        }
        try transact(owner: snapshot.ownerID) {
            $0.snapshot = snapshot
            $0.snapshotNeedsRevalidation = true
            if let trainingReadRevision, snapshot.updatedAt(for: .training) != nil {
                Self.retireConfirmedChanges(in: &$0, readRevision: trainingReadRevision)
            }
        }
        try clearSnapshotFence(owner: snapshot.ownerID)
    }

    private static func retireConfirmedChanges(in envelope: inout Envelope, readRevision: UInt64) {
        // Only a GET begun after acknowledgement may clear that overlay. Pending
        // mutations and acknowledgements received during this GET always win.
        let pendingKeys = Set(envelope.outbox.map(\.key))
        envelope.changes = envelope.changes.filter { key, change in
            !change.acknowledged || (change.acknowledgedRevision ?? change.mutation.revision) > readRevision || pendingKeys.contains(key)
        }
        let protectedDates = Set(envelope.changes.values.map { $0.mutation.date })
        envelope.sessions.removeAll { !protectedDates.contains($0.performed_on) }
    }

    func overlay(owner: String, sessions: [NativeWorkoutSession], sets: [NativeSet]) throws -> (sessions: [NativeWorkoutSession], sets: [NativeSet]) {
        let envelope = try read(owner: owner)
        var resultSessions = sessions, resultSets = sets
        for local in envelope.sessions {
            if let index = resultSessions.firstIndex(where: { $0.performed_on == local.performed_on }) {
                let oldID = resultSessions[index].id
                resultSessions[index] = local
                resultSets = resultSets.map { row in
                    guard row.session_id == oldID else { return row }
                    return Self.remap(row, sessionID: local.id)
                }
            } else { resultSessions.append(local) }
        }
        for change in envelope.changes.values.sorted(by: { $0.mutation.revision < $1.mutation.revision }) {
            let operation = change.mutation
            if operation.kind == .set, !resultSessions.contains(where: { $0.performed_on == operation.date }),
               let local = envelope.sessions.first(where: { $0.performed_on == operation.date }) {
                resultSessions.append(local)
            }
            guard let session = resultSessions.first(where: { $0.performed_on == operation.date }) else { continue }
            if operation.kind == .deleteSession {
                resultSets.removeAll { $0.session_id == session.id }
                resultSessions.removeAll { $0.performed_on == operation.date }
            } else {
                resultSets.removeAll { $0.session_id == session.id && $0.exercise_id == operation.exerciseID && $0.set_index == operation.index }
                if let row = change.row { resultSets.append(Self.remap(row, sessionID: session.id)) }
            }
        }
        let changedDates = Set(envelope.changes.values.map { $0.mutation.date })
        resultSessions = resultSessions.map { row in
            guard changedDates.contains(row.performed_on) else { return row }
            return NativeWorkoutSession(id: row.id, user_id: row.user_id, performed_on: row.performed_on, created_at: row.created_at,
                routine_day_id: row.routine_day_id, notes: row.notes, set_count: resultSets.filter { $0.session_id == row.id }.count)
        }
        return (resultSessions, resultSets)
    }

    static func remap(_ row: NativeSet, sessionID: String) -> NativeSet {
        NativeSet(id: row.id, user_id: row.user_id, session_id: sessionID, exercise_id: row.exercise_id,
            set_index: row.set_index, reps: row.reps, weight_kg: row.weight_kg)
    }

    static func draftKey(date: String, dayID: String?, exerciseID: String, index: Int) -> String {
        Mutation.key(date: date, exerciseID: exerciseID, index: index) + "\u{1f}" + (dayID ?? "")
    }

    private func fileURL(owner: String) throws -> URL {
        guard let directory, !owner.isEmpty else { throw NativeFailure.message("No hay almacenamiento local disponible para esta cuenta.") }
        let name = SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name + ".json")
    }
}

extension NativeStore {
    func commitWorkoutSet(action: NativeWorkoutAction, exerciseID: String, index: Int, date: String, dayID: String?, reps: Int?, weight: Double?, onNewSet: () -> Void) async throws {
        try persistWorkoutSet(action: action, exerciseID: exerciseID, index: index, date: date, dayID: dayID,
                              reps: reps, weight: weight, expectedToken: nil, onNewSet: onNewSet)
    }

    /// Capture after deletion. Replay/ACK and server reconciliation do not change
    /// this local mutation identity; another log/delete/session delete does.
    func workoutMutationToken(date: String, exerciseID: String, index: Int) -> UUID? {
        guard let owner = auth.session?.user.id else { return nil }
        do { return try workoutRepository.read(owner: owner).mutationHead(date: date, exerciseID: exerciseID, index: index)?.token }
        catch { workoutSyncError = error.localizedDescription; return nil }
    }

    func commitWorkoutUndo(action: NativeWorkoutAction, exerciseID: String, index: Int, date: String, dayID: String?, reps: Int?, weight: Double?, expectedToken: UUID) async throws {
        try persistWorkoutSet(action: action, exerciseID: exerciseID, index: index, date: date, dayID: dayID,
                              reps: reps, weight: weight, expectedToken: expectedToken, onNewSet: {})
    }

    /// No suspension point exists between the token/owner check and atomic write.
    /// Undo restores data, not a new-set rest event.
    private func persistWorkoutSet(action: NativeWorkoutAction, exerciseID: String, index: Int, date: String, dayID: String?, reps: Int?, weight: Double?, expectedToken: UUID?, onNewSet: () -> Void) throws {
        try action.check(in: auth)
        guard let owner = auth.session?.user.id else { throw NativeFailure.message("Iniciá sesión para continuar.") }
        guard index >= 0, index <= Int(Int16.max), reps == nil || (0...999).contains(reps!),
              weight == nil || (weight!.isFinite && (0...9999.99).contains(weight!)), NativeDate.parse(date) != nil else {
            throw NativeFailure.message("Revisá la fecha, las repeticiones y el peso de la serie.")
        }
        var isNew = false
        try workoutRepository.transact(owner: owner) { envelope in
            try action.check(in: auth)
            let projection = try workoutRepository.overlay(owner: owner,
                sessions: loaded ? sessions : (envelope.snapshot?.sessions ?? sessions),
                sets: loaded ? sets : (envelope.snapshot?.sets ?? sets))
            let existing = projection.sessions.first { $0.performed_on == date }
            let old = projection.sets.first { $0.session_id == existing?.id && $0.exercise_id == exerciseID && $0.set_index == index }
            if let expectedToken {
                guard let head = envelope.mutationHead(date: date, exerciseID: exerciseID, index: index),
                      head.token == expectedToken, head.kind == .deleteSet, existing != nil, old == nil else {
                    throw NativeFailure.message("No se puede deshacer: la serie o el entrenamiento ya cambió. Tu progreso actual se conserva.")
                }
            }
            let session = existing ?? NativeWorkoutSession(id: UUID().uuidString.lowercased(), user_id: owner, performed_on: date,
                created_at: ISO8601DateFormatter().string(from: Date()), routine_day_id: dayID, notes: nil, set_count: 0)
            let row = NativeSet(id: old?.id ?? UUID().uuidString.lowercased(), user_id: owner, session_id: session.id,
                exercise_id: exerciseID, set_index: index, reps: reps, weight_kg: weight.map { ($0 * 100).rounded() / 100 })
            isNew = old == nil
            if envelope.snapshot == nil { envelope.snapshot = currentWorkoutSnapshot(owner: owner) }
            envelope.snapshotNeedsRevalidation = true
            envelope.sessions.removeAll { $0.performed_on == date }; envelope.sessions.append(session)
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString.lowercased(), kind: .set, date: date,
                dayID: dayID, exerciseID: exerciseID, index: index, reps: row.reps, weight: row.weight_kg,
                localSetID: row.id, revision: envelope.revision)
            try envelope.recordMutation(operation)
            envelope.changes[operation.key] = .init(mutation: operation, row: row, acknowledged: false)
            envelope.outbox.append(operation)
            envelope.drafts[NativeWorkoutRepository.draftKey(date: date, dayID: dayID, exerciseID: exerciseID, index: index)] = nil
        }
        applyWorkoutOverlay()
        if isNew { onNewSet() }
        scheduleWorkoutReplay()
    }

    func commitWorkoutDeletion(action: NativeWorkoutAction, exerciseID: String, index: Int, date: String, dayID: String?) async throws {
        try action.check(in: auth)
        guard let owner = auth.session?.user.id else { throw NativeFailure.message("Iniciá sesión para continuar.") }
        guard let session = sessions.first(where: { $0.performed_on == date }) else { return }
        try workoutRepository.transact(owner: owner) { envelope in
            if envelope.snapshot == nil { envelope.snapshot = currentWorkoutSnapshot(owner: owner) }
            envelope.snapshotNeedsRevalidation = true
            envelope.sessions.removeAll { $0.performed_on == date }; envelope.sessions.append(session)
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString.lowercased(), kind: .deleteSet, date: date,
                dayID: dayID, exerciseID: exerciseID, index: index, reps: nil, weight: nil,
                localSetID: "", revision: envelope.revision)
            try action.check(in: auth)
            try envelope.recordMutation(operation)
            envelope.changes[operation.key] = .init(mutation: operation, row: nil, acknowledged: false)
            envelope.outbox.append(operation)
            envelope.drafts[NativeWorkoutRepository.draftKey(date: date, dayID: dayID, exerciseID: exerciseID, index: index)] = nil
        }
        applyWorkoutOverlay(); scheduleWorkoutReplay()
    }

    func commitWorkoutSessionDeletion(action: NativeWorkoutAction, date: String) async throws {
        try action.check(in: auth)
        guard let owner = auth.session?.user.id, let session = sessions.first(where: { $0.performed_on == date }) else { return }
        try workoutRepository.transact(owner: owner) { envelope in
            if envelope.snapshot == nil { envelope.snapshot = currentWorkoutSnapshot(owner: owner) }
            envelope.snapshotNeedsRevalidation = true
            envelope.sessions.removeAll { $0.performed_on == date }; envelope.sessions.append(session)
            envelope.changes = envelope.changes.filter { $0.value.mutation.date != date }
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString.lowercased(), kind: .deleteSession, date: date,
                dayID: session.routine_day_id, exerciseID: "", index: -1, reps: nil, weight: nil,
                localSetID: "", revision: envelope.revision)
            try action.check(in: auth)
            try envelope.recordMutation(operation)
            envelope.changes[operation.key] = .init(mutation: operation, row: nil, acknowledged: false)
            envelope.outbox.append(operation)
            envelope.drafts = envelope.drafts.filter { !$0.key.hasPrefix(date + "\u{1f}") }
        }
        applyWorkoutOverlay()
        try action.check(in: auth)
        NotificationCenter.default.post(name: .nativeWorkoutSessionDeleted, object: self,
                                        userInfo: ["ownerID": owner, "date": date])
        scheduleWorkoutReplay()
    }

    func workoutSyncLabel(exerciseID: String, index: Int, date: String) -> String {
        guard let owner = auth.session?.user.id else { return "Iniciá sesión para sincronizar" }
        do {
            let pending = try workoutRepository.read(owner: owner).outbox.last {
                $0.date == date && ($0.kind == .deleteSession || ($0.exerciseID == exerciseID && $0.index == index))
            }
            if let pending {
                if auth.localAccessOnly { return "Guardado en este iPhone · Pendiente de renovar sesión" }
                if pending.failure != nil { return "Guardado en este iPhone · Sincronización pendiente" }
                return "Guardado en este iPhone · Pendiente de sincronizar"
            }
            let sessionID = sessions.first { $0.performed_on == date }?.id
            return sets.contains { $0.session_id == sessionID && $0.exercise_id == exerciseID && $0.set_index == index }
                ? "Sincronizado" : "Sin registrar"
        } catch { return "No se pudo leer el estado local" }
    }

    func saveWorkoutDraft(date: String, dayID: String?, exerciseID: String, index: Int, repsText: String, weightText: String) throws {
        guard let owner = auth.session?.user.id else { throw NativeFailure.message("Iniciá sesión para guardar el borrador.") }
        guard repsText.count <= 64, weightText.count <= 64 else { throw NativeFailure.message("El valor ingresado es demasiado largo.") }
        let key = NativeWorkoutRepository.draftKey(date: date, dayID: dayID, exerciseID: exerciseID, index: index)
        let draft = NativeWorkoutDraft(repsText: repsText, weightText: weightText)
        if try workoutRepository.read(owner: owner).drafts[key] == draft { return }
        try workoutRepository.transact(owner: owner) {
            if $0.snapshot == nil { $0.snapshot = currentWorkoutSnapshot(owner: owner) }
            $0.drafts[key] = draft
        }
        workoutSyncRevision &+= 1
    }
    func workoutDraft(date: String, dayID: String?, exerciseID: String, index: Int) -> NativeWorkoutDraft? {
        guard let owner = auth.session?.user.id else { return nil }
        do { return try workoutRepository.read(owner: owner).drafts[NativeWorkoutRepository.draftKey(date: date, dayID: dayID, exerciseID: exerciseID, index: index)] }
        catch { workoutSyncError = error.localizedDescription; return nil }
    }
    func clearWorkoutDraft(date: String, dayID: String?, exerciseID: String, index: Int) throws {
        guard let owner = auth.session?.user.id else { throw NativeFailure.message("Iniciá sesión para continuar.") }
        let key = NativeWorkoutRepository.draftKey(date: date, dayID: dayID, exerciseID: exerciseID, index: index)
        if try workoutRepository.read(owner: owner).drafts[key] == nil { return }
        try workoutRepository.transact(owner: owner) { $0.drafts[key] = nil }
        workoutSyncRevision &+= 1
    }

    func currentWorkoutSnapshot(owner: String) -> NativeDataSnapshot? {
        guard loaded || domainStates.values.contains(where: \.loaded) else { return nil }
        // Local-only legacy fixtures may set loaded directly. Runtime availability
        // comes from domainStates; no empty secondary arrays become confirmed data.
        if domainStates.isEmpty {
            return NativeDataSnapshot(ownerID: owner, savedAt: lastCompleteSnapshotDate ?? Date(), routines: routines, days: days,
                routineExercises: routineExercises, sessions: sessions, sets: sets, weights: weights, profile: profile,
                foodEntries: foodEntries, foodDays: foodDays)
        }
        let dates = Dictionary(uniqueKeysWithValues: NativeDataDomain.allCases.compactMap { domain -> (String, Date)? in
            let state = domainState(domain)
            guard state.loaded, let date = state.lastUpdatedAt else { return nil }
            return (domain.rawValue, date)
        })
        return NativeDataSnapshot(ownerID: owner, savedAt: dates.values.max() ?? Date(), routines: routines, days: days,
            routineExercises: routineExercises, sessions: sessions, sets: sets, weights: weights, profile: profile,
            foodEntries: foodEntries, foodDays: foodDays, domainSavedAt: dates, completeRefresh: false)
    }

    func applyWorkoutOverlay(notify: Bool = true) {
        guard let owner = auth.session?.user.id else { return }
        do {
            let envelope = try workoutRepository.read(owner: owner)
            let result = try workoutRepository.overlay(owner: owner, sessions: sessions, sets: sets)
            sessions = result.sessions; sets = result.sets
            workoutPendingCount = envelope.outbox.count; workoutSyncRevision &+= 1
            if notify { NotificationCenter.default.post(name: Notification.Name("nativeDataRefreshed"), object: self) }
        } catch { workoutSyncError = error.localizedDescription }
    }

    func scheduleWorkoutReplay() {
        guard automaticallyReplayWorkouts, workoutReplayTask == nil, auth.session != nil else { return }
        let generation = auth.generation
        workoutReplayTask = Task { [weak self] in
            guard let self else { return }
            await self.replayWorkoutOutbox()
            if self.auth.generation == generation { self.workoutReplayTask = nil }
        }
    }

    /// Called by refresh/foreground; only the private journal's current owner is replayed.
    func replayWorkoutOutbox() async {
        guard !workoutSyncing, let owner = auth.session?.user.id else { return }
        let action = NativeWorkoutAction(auth: auth), generation = auth.generation
        workoutSyncing = true
        defer { if auth.generation == generation { workoutSyncing = false } }
        while action.isCurrent(in: auth), !Task.isCancelled {
            var operation: NativeWorkoutRepository.Mutation
            do {
                let pending = try workoutRepository.read(owner: owner).outbox
                workoutPendingCount = pending.count
                guard let next = pending.enumerated().first(where: { position, candidate in
                    guard !candidate.requiresAttention else { return false }
                    let preceding = pending.prefix(position)
                    // A session deletion is a barrier; unrelated series may still
                    // synchronize when one malformed/conflicting series is paused.
                    return !preceding.contains { older in
                        older.date == candidate.date && (older.key == candidate.key || older.kind == .deleteSession || candidate.kind == .deleteSession)
                    }
                })?.element else {
                    if pending.isEmpty { workoutSyncError = nil }
                    return
                }
                operation = next
            } catch { workoutSyncError = error.localizedDescription; return }
            do {
                _ = try await auth.accessToken()
                try action.check(in: auth)
                let remote: NativeWorkoutSession?
                if operation.kind == .set, let expected = operation.remoteSessionID {
                    let found: [NativeWorkoutSession] = try await api.fetch("sessions", query: nativeQuery("performed_on", operation.date))
                    guard let existing = found.first, existing.id == expected else {
                        throw NativeFailure.message("El entrenamiento cambió o se borró en otro dispositivo. Tu serie local se conserva; revisá el entrenamiento antes de reintentar.")
                    }
                    remote = existing
                } else if operation.kind == .set {
                    remote = try await ensureSession(date: operation.date, day: operation.dayID, action: action)
                } else if let remoteID = operation.remoteSessionID {
                    // A retried DELETE targets the same session, never a replacement created later.
                    remote = NativeWorkoutSession(id: remoteID, user_id: owner, performed_on: operation.date,
                        created_at: "", routine_day_id: operation.dayID, notes: nil, set_count: 0)
                } else {
                    let found: [NativeWorkoutSession] = try await api.fetch("sessions", query: nativeQuery("performed_on", operation.date))
                    remote = found.first
                }
                try action.check(in: auth)
                if let remote {
                    guard remote.user_id == owner, remote.performed_on == operation.date else {
                        throw NativeFailure.message("La sesión recibida no pertenece a este entrenamiento o cuenta. Tu progreso local se conserva.")
                    }
                    operation.remoteSessionID = remote.id
                    try workoutRepository.transact(owner: owner) { envelope in
                        if let position = envelope.outbox.firstIndex(where: { $0.id == operation.id }) { envelope.outbox[position].remoteSessionID = remote.id }
                        if let position = envelope.sessions.firstIndex(where: { $0.performed_on == operation.date }) { envelope.sessions[position] = remote }
                    }
                }
                var saved: NativeSet?
                if let remote {
                    switch operation.kind {
                    case .set:
                        let data = try await api.request("rest/v1/session_sets", method: "POST",
                            query: [URLQueryItem(name: "on_conflict", value: "session_id,exercise_id,set_index")],
                            body: ["session_id": remote.id, "exercise_id": operation.exerciseID, "set_index": operation.index,
                                   "reps": nativeNull(operation.reps), "weight_kg": nativeNull(operation.weight)],
                            prefer: "return=representation,resolution=merge-duplicates")
                        try action.check(in: auth)
                        let rows = try JSONDecoder().decode([NativeSet].self, from: data)
                        guard let row = rows.first, row.user_id == owner, row.session_id == remote.id,
                              row.exercise_id == operation.exerciseID, row.set_index == operation.index else {
                            throw NativeFailure.message("No se pudo confirmar la sincronización de la serie.")
                        }
                        saved = row
                    case .deleteSet:
                        try await api.write("session_sets", method: "DELETE", query: nativeQuery("session_id", remote.id)
                            + nativeQuery("exercise_id", operation.exerciseID) + [URLQueryItem(name: "set_index", value: "eq.\(operation.index)")])
                    case .deleteSession:
                        try await api.write("sessions", method: "DELETE", query: nativeQuery("id", remote.id))
                    }
                }
                try action.check(in: auth)
                try workoutRepository.transact(owner: owner) { envelope in
                    envelope.outbox.removeAll { $0.id == operation.id }
                    if var latest = envelope.changes[operation.key], latest.mutation.id == operation.id {
                        latest.acknowledged = true; latest.acknowledgedRevision = envelope.revision
                        latest.mutation.failure = nil; latest.row = saved
                        envelope.changes[operation.key] = latest
                    }
                }
                applyWorkoutOverlay()
                if operation.kind == .set, let weight = saved?.weight_kg {
                    learnWorkoutWeight(action: action, dayID: operation.dayID, exerciseID: operation.exerciseID, weight: weight)
                }
            } catch is CancellationError { return }
            catch {
                guard action.isCurrent(in: auth) else { return }
                let message = NativeFailure.userMessage(error)
                workoutSyncError = "Tu progreso está guardado en este iPhone. " + message
                let retryable = NativeFailure.canRetry(error)
                do {
                    try workoutRepository.transact(owner: owner) { envelope in
                        if let index = envelope.outbox.firstIndex(where: { $0.id == operation.id }) {
                            envelope.outbox[index].attempts += 1
                            envelope.outbox[index].failure = message
                            envelope.outbox[index].requiresAttention = !retryable
                            envelope.outbox[index].retryAt = Date().addingTimeInterval(min(60, pow(2, Double(min(6, envelope.outbox[index].attempts)))))
                        }
                    }
                } catch { workoutSyncError = error.localizedDescription }
                workoutSyncRevision &+= 1
                if retryable { scheduleWorkoutRetry(generation: generation, owner: owner); return }
                // Continue with independent series, preserving each series' order.
            }
        }
    }

    /// Explicit retry after the person has reviewed an authorization/validation error.
    func retryWorkoutSync() {
        guard let owner = auth.session?.user.id else { return }
        do {
            try workoutRepository.transact(owner: owner) { envelope in
                for index in envelope.outbox.indices {
                    envelope.outbox[index].requiresAttention = false
                    envelope.outbox[index].retryAt = nil
                }
            }
            workoutRetryTask?.cancel(); workoutRetryTask = nil
            scheduleWorkoutReplay()
        } catch { workoutSyncError = error.localizedDescription }
    }

    private func scheduleWorkoutRetry(generation: UUID, owner: String) {
        workoutRetryTask?.cancel()
        let retryAt = (try? workoutRepository.read(owner: owner).outbox.first?.retryAt) ?? Date().addingTimeInterval(10)
        let delay = max(1, retryAt.timeIntervalSinceNow)
        workoutRetryTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            guard let self, self.auth.generation == generation, self.auth.session?.user.id == owner else { return }
            self.workoutRetryTask = nil
            self.scheduleWorkoutReplay()
        }
    }

    private func learnWorkoutWeight(action: NativeWorkoutAction, dayID: String?, exerciseID: String, weight: Double) {
        guard let item = routineExercises.first(where: { $0.routine_day_id == dayID && $0.exercise_id == exerciseID }), item.target_weight_kg == nil else { return }
        Task { [weak self] in
            guard let self, action.isCurrent(in: self.auth) else { return }
            do {
                let data = try await self.api.request("rest/v1/routine_exercises", method: "PATCH",
                    query: nativeQuery("id", item.id) + [URLQueryItem(name: "target_weight_kg", value: "is.null")],
                    body: ["target_weight_kg": weight], prefer: "return=representation")
                try action.check(in: self.auth)
                var rows = try JSONDecoder().decode([NativeRoutineExercise].self, from: data)
                if rows.isEmpty {
                    // The null-only PATCH lost to another writer. Read that
                    // authoritative default; never resend/overwrite it with ours.
                    rows = try await self.api.fetch("routine_exercises", query: nativeQuery("id", item.id))
                    try action.check(in: self.auth)
                }
                guard let row = rows.first, row.id == item.id, row.user_id == self.auth.session?.user.id,
                      row.routine_day_id == item.routine_day_id, row.exercise_id == item.exercise_id else {
                    throw NativeFailure.message("No se pudo confirmar el peso actual de la rutina.")
                }
                if let index = self.routineExercises.firstIndex(where: { $0.id == row.id }) {
                    // A newer explicit acknowledgement published during the
                    // request takes precedence over this optional learning task.
                    guard self.routineExercises[index].target_weight_kg == nil else { return }
                    self.routineExercises[index] = row
                    do { try self.acknowledgeConfirmedMutation(action: action) }
                    catch {
                        self.routineWeightErrors[item.id] = error.localizedDescription
                        return
                    }
                }
                self.routineWeightErrors[item.id] = nil
            } catch {
                guard action.isCurrent(in: self.auth) else { return }
                self.routineWeightErrors[item.id] = "La serie está guardada. No se pudo recordar el peso para futuros entrenamientos; podés guardarlo desde la rutina."
            }
        }
    }
}
