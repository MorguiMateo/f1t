import ActivityKit
import Combine
import Foundation
import UIKit
import WidgetKit

extension Notification.Name {
    /// Posted after the lock-screen button saves a set, so an open guided view can align its rest clock.
    static let nativeLiveSetLogged = Notification.Name("nativeLiveSetLogged")
    /// Store posts only after the local session deletion transaction succeeds.
    static let nativeWorkoutSessionDeleted = Notification.Name("nativeWorkoutSessionDeleted")
}

enum NativeLiveActivityState {
    /// Pure on purpose: the same rules as the guided view, without ActivityKit.
    /// The current exercise is the first unfinished one, like `NativeGuidedCursor`.
    static func make(plan: [NativeRoutineExercise], sets: [NativeSet], past: [NativeSet],
                     exercise: (String) -> NativeExercise?, restEndsAt: Date?,
                     currentExerciseID: String? = nil) -> F1tWorkoutAttributes.ContentState {
        let ids = NativeWorkoutProgress.ids(plan)
        func target(_ id: String) -> NativeRoutineExercise? { plan.first { $0.exercise_id == id } }
        func done(_ id: String) -> Set<Int> { Set(sets.filter { $0.exercise_id == id }.map(\.set_index)) }
        var completed = 0, planned = 0
        for id in ids {
            let goal = NativeWorkoutProgress.goal(target(id)?.target_sets)
            planned += goal
            completed += done(id).intersection(0..<goal).count
        }
        let pending = NativeWorkoutProgress.firstUnfinished(plan: plan, sets: sets)
        let selected = currentExerciseID.flatMap { id in
            ids.contains(id) && !NativeWorkoutProgress.complete(target: target(id)?.target_sets, indexes: Array(done(id))) ? id : nil
        }
        guard let id = selected ?? pending, let position = ids.firstIndex(of: id) else {
            return .init(phase: .finished, exerciseID: "", exerciseName: "Entrenamiento completo", thumbnail: nil,
                         setIndex: 0, setNumber: 0, totalSets: 0, reps: nil, weightKg: nil,
                         exerciseNumber: ids.count, exerciseCount: ids.count, completedSets: completed, plannedSets: planned,
                         restEndsAt: nil, notice: nil)
        }
        let goal = NativeWorkoutProgress.goal(target(id)?.target_sets)
        let logged = done(id)
        let index = (0..<goal).first { !logged.contains($0) } ?? 0
        // Same prefill as NativeSetRow: latest confirmed earlier set of this
        // exercise, then matching history and routine targets. Never use drafts.
        let earlier = sets.filter { $0.exercise_id == id && $0.set_index < index }
            .max { $0.set_index < $1.set_index }
        let previous = past.first { $0.exercise_id == id && $0.set_index == index }
        let suggested = NativeSetPrefill.values(saved: nil, earlier: earlier, previous: previous,
            targetReps: FitFormat.targetReps(target(id)?.target_reps), targetWeight: target(id)?.target_weight_kg)
        let item = exercise(id)
        return .init(phase: .working, exerciseID: id, exerciseName: String((item?.name ?? id).prefix(80)),
                     thumbnail: item?.images.isEmpty == false ? F1tThumbnailStorage.filename(for: id) : nil,
                     setIndex: index, setNumber: index + 1, totalSets: goal,
                     reps: suggested.reps, weightKg: suggested.weight,
                     exerciseNumber: position + 1, exerciseCount: ids.count, completedSets: completed, plannedSets: planned,
                     restEndsAt: restEndsAt, notice: nil)
    }
}

/// Owns a durable workout independently of navigation, scenes and ActivityKit's UI.
@MainActor
final class NativeLiveActivity: ObservableObject {
    static let shared = NativeLiveActivity()
    static let restMinutesKey = "native.workout.restMinutes"
    @Published var restEndsAt: Date?
    @Published private(set) var activeAttributes: F1tWorkoutAttributes?
    @Published private(set) var currentExerciseID: String?
    @Published private(set) var availabilityMessage: String?
    @Published private(set) var restPermissionMessage: String?
    private var active: NativeActiveWorkout?
    private var activity: Activity<F1tWorkoutAttributes>?
    private var queue: Task<Void, Never>?
    private var queueRevision = UUID()
    private var subscriptions: [AnyCancellable] = []
    private weak var attachedStore: NativeStore?
    private var lifecycle = UUID()
    private var intentBusy = false
    private var pendingRestSetKey: String?
    private var restoration: Task<Void, Never>?
    private var activityObserver: Task<Void, Never>?

    func attach(store: NativeStore) {
        if attachedStore === store { return }
        subscriptions.removeAll()
        attachedStore = store
        F1tWorkoutIntentBridge.logSet = { [weak self, weak store] request in
            guard let self, let store else { throw F1tWorkoutIntentError.unavailable }
            try await self.logSet(request, store: store)
        }
        F1tWorkoutIntentBridge.changeRest = { [weak self, weak store] request in
            guard let self, let store else { throw F1tWorkoutIntentError.unavailable }
            try await self.changeRest(request, store: store)
        }
        NativeRestNotifications.shared.attach(isCurrent: { [weak self, weak store] in
            guard let self, let store, let active = self.active else { return false }
            return store.auth.session?.user.id == active.attributes.ownerID
        }, restoreWorkout: { [weak self, weak store] in
            guard let self, let store else { return }
            await self.restore(store: store)
        })
        NativeRestNotifications.shared.$permissionMessage
            .combineLatest(NativeRestNotifications.shared.$deliveryMessage).sink { [weak self] permission, delivery in
            self?.restPermissionMessage = delivery ?? permission
        }.store(in: &subscriptions)
        NativeAlarmProvider.shared.$enabled.dropFirst().sink { [weak self] _ in
            guard let self, let workout = self.active else { return }
            self.enqueue {
                await NativeRestNotifications.shared.cancel()
                if self.active?.id == workout.id { await self.deliverRestNotice(workout) }
            }
        }.store(in: &subscriptions)
        store.$workoutSyncRevision.dropFirst().sink { [weak self, weak store] _ in
            guard let self, let store, let workout = self.active else { return }
            // Published emits before assignment; evaluate the status on the next actor turn.
            self.enqueue { [weak self, weak store] in
                guard let self, let store, let current = self.active, current.id == workout.id else { return }
                self.publish(current, store: store)
            }
        }.store(in: &subscriptions)
        store.accountChanges.sink { [weak self, weak store] event in
            self?.handleAccount(event)
            NativeDevice.shared.handleAccount(event)
            // This observer exists even when an App Intent launches without a scene.
            if event.previousOwner != event.incomingOwner || event.incomingOwner == nil {
                try? NativeWidgetSync.clear()
            }
            guard let store, event.incomingOwner != nil else { return }
            Task { [weak self] in await self?.restore(store: store) }
        }.store(in: &subscriptions)
        store.auth.localSessionInvalidations.sink { [weak self] in
            self?.purge()
            NativeDevice.shared.clear()
            try? NativeWidgetSync.clear()
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: .nativeWorkoutSessionDeleted).sink { [weak self, weak store] event in
            guard let self, let store, event.object as? NativeStore === store,
                  let owner = event.userInfo?["ownerID"] as? String, owner == store.auth.session?.user.id,
                  let date = event.userInfo?["date"] as? String else { return }
            do { try NativePerformedWorkoutStorage.remove(owner: owner, date: date) }
            catch { self.availabilityMessage = "Se borró el registro, pero no se pudo retirar su plan local. Reintentá desde FIT." }
            if self.active?.attributes.ownerID == owner, self.active?.attributes.sessionDate == date {
                // Deletion can run headlessly; cancellation must not depend on
                // the history screen's follow-up finish call.
                self.finishWorkout(store: store)
            }
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: Notification.Name("nativeDataRefreshed")).sink { [weak self, weak store] event in
            guard let self, let store, event.object as? NativeStore === store else { return }
            NativeDevice.shared.sync(store: store)
            try? NativeWidgetSync.sync(store)
            guard let attributes = self.activeAttributes, store.loaded else { return }
            self.sync(attributes, store: store)
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification).sink { [weak self, weak store] _ in
            guard let store else { return }
            Task { [weak self] in
                await self?.restore(store: store)
                await NativeRestNotifications.shared.refreshPermission()
            }
        }.store(in: &subscriptions)
    }

    /// Safe for both foreground restoration and a scene-less App Intent launch.
    func restore(store: NativeStore) async {
        if let restoration { await restoration.value; return }
        // Coalesce callers instead of returning before the first restore finishes.
        let operation = Task<Void, Never> { [weak self] in await self?.restoreSession(store: store) }
        restoration = operation
        await operation.value
        restoration = nil
    }

    private func restoreSession(store: NativeStore) async {
        if !store.auth.ready { await store.bootstrap() }
        guard let owner = store.auth.session?.user.id else {
            availabilityMessage = "Desbloqueá el iPhone y abrí FIT para recuperar tu entrenamiento."
            await NativeRestNotifications.shared.cancel()
            return
        }
        let action = NativeWorkoutAction(auth: store.auth)
        do {
            if active == nil {
                if let stored = try NativeActiveWorkoutStorage.load() {
                    guard stored.isValid(for: owner) else {
                        purge()
                        return
                    }
                    active = stored
                } else if store.loaded,
                          let existing = Activity<F1tWorkoutAttributes>.activities.first(where: {
                              $0.attributes.ownerID == owner && Self.isOngoing($0)
                          }) {
                    // Migrate the old card once. Its unversioned action is rejected;
                    // the replacement published below supplies the new revision.
                    try begin(existing.attributes, store: store)
                    if var workout = active {
                        workout.restEndsAt = existing.content.state.restEndsAt
                        try persist(workout)
                    }
                }
            }
            try action.check(in: store.auth)
            guard let attributes = active?.attributes else { return }
            sync(attributes, store: store)
            await flushPublication()
        } catch {
            availabilityMessage = "No se pudo recuperar el entrenamiento guardado. Desbloqueá el iPhone y reintentá."
        }
    }

    /// Begin once, then reuse the frozen plan and existing deadline on every update.
    func sync(_ attributes: F1tWorkoutAttributes, store: NativeStore) {
        guard store.auth.session?.user.id == attributes.ownerID else { return }
        do {
            if active == nil, let stored = try NativeActiveWorkoutStorage.load() {
                if stored.isValid(for: attributes.ownerID) { active = stored }
                else { try NativeActiveWorkoutStorage.clear() }
            }
            if let active, !active.matches(attributes) {
                availabilityMessage = "Hay otro entrenamiento en curso. Retomalo o finalizalo antes de empezar uno nuevo."
                expose(active)
                return
            }
            if active == nil {
                guard store.loaded else { return }
                try begin(attributes, store: store)
            }
            reconcile(store: store)
            guard let workout = active else { return }
            expose(workout)
            publish(workout, store: store)
        } catch {
            availabilityMessage = "No se pudo guardar el entrenamiento en este iPhone. Reintentá antes de bloquear la pantalla."
        }
    }

    func activePlan(for attributes: F1tWorkoutAttributes, store: NativeStore) -> [NativeRoutineExercise] {
        if let active, active.matches(attributes), active.attributes.ownerID == store.auth.session?.user.id { return active.plan }
        if let performed = performedPlan(date: attributes.sessionDate, dayID: attributes.dayID, store: store) { return performed }
        let day = attributes.dayID.flatMap { id in store.days.first { $0.id == id } }
        return store.plan(day)
    }

    /// Today/history must use this before the mutable routine's plan. An archive
    /// alone is not proof that a session exists: the owner-scoped durable overlay
    /// fences deleted sessions even before its deletion syncs with the server.
    func performedPlan(date: String, dayID: String?, store: NativeStore) -> [NativeRoutineExercise]? {
        do {
            return try performedWorkout(date: date, dayID: dayID, store: store)?.plan
        } catch {
            // Today/history call this while evaluating their bodies. Publish the
            // error on the next actor turn, with an account-generation guard.
            let message = "No se pudo recuperar el plan realizado en este iPhone. Desbloqueá el iPhone y reintentá."
            if availabilityMessage != message {
                let action = NativeWorkoutAction(auth: store.auth)
                Task { [weak self, weak store] in
                    guard let self, let store, action.isCurrent(in: store.auth), self.availabilityMessage != message else { return }
                    self.availabilityMessage = message
                }
            }
            return nil
        }
    }

    private func performedWorkout(date: String, dayID: String?, store: NativeStore) throws -> NativePerformedWorkout? {
        guard let owner = store.auth.session?.user.id else { return nil }
        let overlay = try store.workoutRepository.overlay(owner: owner, sessions: store.sessions, sets: store.sets)
        guard overlay.sessions.contains(where: {
            $0.user_id == owner && $0.performed_on == date && $0.routine_day_id == dayID
        }) else { return nil }
        return try NativePerformedWorkoutStorage.load(owner: owner, date: date, dayID: dayID)
    }

    func selectExercise(_ id: String, store: NativeStore) {
        guard var workout = ownedWorkout(store), workout.plan.contains(where: { $0.exercise_id == id }),
              workout.currentExerciseID != id else { return }
        workout.currentExerciseID = id; workout.changed()
        accept(workout, store: store)
    }

    /// Durable local plan edit, not a routine/database edit. UI must explicitly
    /// ask for a replacement; recorded sets and unconfirmed drafts are rejected.
    func substituteExercise(_ currentID: String, with replacementID: String, store: NativeStore) throws {
        guard !intentBusy, store.loaded, var workout = ownedWorkout(store),
              let replacement = store.exercise(replacementID) else {
            throw NativeWorkoutSubstitutionError.unavailable
        }
        let action = NativeWorkoutAction(auth: store.auth)
        try action.check(in: store.auth)
        // A protected/corrupt draft journal must fail closed, not look like an
        // absent draft through the UI's optional convenience accessor.
        let drafts = try store.workoutRepository.read(owner: workout.attributes.ownerID).drafts
        let sessionID = store.sessions.first { $0.performed_on == workout.attributes.sessionDate }?.id
        guard !store.sets.contains(where: {
            $0.session_id == sessionID && ($0.exercise_id == currentID || $0.exercise_id == replacementID)
        }) else { throw NativeWorkoutSubstitutionError.recorded }
        // Repository keys encode date/exercise/index/day separated by U+001F.
        // Include extra-series drafts, not only indexes in the target set range.
        guard !drafts.keys.contains(where: { key in
            let scope = key.components(separatedBy: "\u{1f}")
            return scope.count == 4 && scope[0] == workout.attributes.sessionDate &&
                (scope[1] == currentID || scope[1] == replacementID) && scope[3] == (workout.attributes.dayID ?? "")
        }) else { throw NativeWorkoutSubstitutionError.draft }
        try workout.substituteExercise(currentID, with: replacement,
            previous: store.previousSets(dayID: workout.attributes.dayID, before: workout.attributes.sessionDate))
        try action.check(in: store.auth)
        try persist(workout)
        publish(workout, store: store)
    }

    /// Called ONLY after a new set's local transaction has succeeded.
    /// Edits, duplicate callbacks and replays must not restart this deadline.
    func startRest(store: NativeStore, now: Date = Date()) {
        guard var workout = ownedWorkout(store) else { return }
        reconcile(store: store)
        workout = active ?? workout
        let row = workout.confirmedSets.last
        let key = pendingRestSetKey ?? row.map { "\($0.exercise_id)|\($0.set_index)" }
        guard let key, key != workout.lastRestSetKey else { return }
        let minutes = UserDefaults.standard.object(forKey: Self.restMinutesKey) as? Double ?? 2
        workout.restEndsAt = now.addingTimeInterval(NativeRestClock.minutes(minutes) * 60)
        workout.lastRestSetKey = key
        let lastID = key.components(separatedBy: "|").first ?? ""
        workout.lastExerciseName = workout.exerciseNames[lastID]
        workout.changed(now: now)
        if accept(workout, store: store) { pendingRestSetKey = nil }
    }

    func extendRest(seconds: TimeInterval, store: NativeStore) {
        guard seconds.isFinite, seconds > 0, seconds <= 300,
              var workout = ownedWorkout(store), let end = workout.restEndsAt else { return }
        workout.restEndsAt = min(max(end, Date()).addingTimeInterval(seconds), Date().addingTimeInterval(10 * 60))
        workout.changed()
        accept(workout, store: store)
    }

    func omitRest(store: NativeStore) {
        guard var workout = ownedWorkout(store), workout.restEndsAt != nil else { return }
        workout.restEndsAt = nil; workout.changed()
        accept(workout, store: store)
    }

    func requestRestNotifications(store: NativeStore) async {
        let action = NativeWorkoutAction(auth: store.auth)
        await NativeRestNotifications.shared.requestPermission()
        guard action.isCurrent(in: store.auth) else { return }
        // A permission change may enable a previously silent pending countdown.
        await NativeRestNotifications.shared.cancel()
        guard action.isCurrent(in: store.auth), let workout = active else { return }
        scheduleRest(workout)
        await flushPublication()
    }

    func setRestNotificationsEnabled(_ enabled: Bool, store: NativeStore) {
        NativeRestNotifications.shared.enabled = enabled
        guard let workout = ownedWorkout(store) else { return }
        enqueue {
            await NativeRestNotifications.shared.cancel()
            if enabled, self.active?.id == workout.id { await self.deliverRestNotice(workout) }
        }
    }

    func finishWorkout(store: NativeStore) {
        guard let workout = ownedWorkout(store) else { return }
        do {
            let overlay = try store.workoutRepository.overlay(owner: workout.attributes.ownerID,
                sessions: store.sessions, sets: store.sets)
            if overlay.sessions.contains(where: {
                $0.user_id == workout.attributes.ownerID && $0.performed_on == workout.attributes.sessionDate &&
                    $0.routine_day_id == workout.attributes.dayID
            }) {
                // Archive BEFORE removing the only durable active copy. Failure
                // leaves the workout/rest active and permits an explicit retry.
                try NativePerformedWorkoutStorage.write(NativePerformedWorkout(workout))
            } else {
                // Finishing after deletion must never recreate the deleted archive.
                try NativePerformedWorkoutStorage.remove(owner: workout.attributes.ownerID, date: workout.attributes.sessionDate)
            }
            try NativeActiveWorkoutStorage.clear()
        }
        catch {
            availabilityMessage = "No se pudo cerrar el entrenamiento local. Reintentá finalizarlo."
            return
        }
        let activities = activities(for: workout.attributes)
        var final = state(for: workout.attributes, store: store)
        final.phase = .finished; final.restEndsAt = nil
        final.exerciseName = "Entrenamiento finalizado"
        let content = ActivityContent(state: final, staleDate: nil)
        NativeRestNotifications.shared.invalidate()
        clearMemory()
        F1tLiveWorkoutStorage.clear()
        WidgetCenter.shared.reloadAllTimelines()
        enqueue {
            await NativeRestNotifications.shared.cancel()
            for activity in activities {
                await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(10 * 60)))
            }
        }
    }

    /// Compatibility only. Navigation no longer calls this; explicit finish does.
    func stop() {
        guard let store = attachedStore else { return }
        finishWorkout(store: store)
    }

    func handleAccount(_ event: NativeAccountEvent) {
        // A nil cold-bootstrap event can mean protected storage or transient auth
        // failure, not logout. Definitive revocation/logout uses the invalidation sink.
        if event.incomingOwner == nil, event.previousOwner == nil { return }
        endAll(except: event.incomingOwner)
    }

    /// Retention is owner-scoped, NOT date-scoped: midnight doesn't end training.
    func endAll(except owner: String?, today: String = NativeDate.key()) {
        let old = Activity<F1tWorkoutAttributes>.activities.filter { owner == nil || $0.attributes.ownerID != owner }
        enqueue {
            for activity in old { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        if let active, active.attributes.ownerID != owner { purge() }
        else if let stored = try? NativeActiveWorkoutStorage.load(), stored.attributes.ownerID != owner { purge() }
        if let snapshot = F1tLiveWorkoutStorage.load(), snapshot.ownerID != owner { F1tLiveWorkoutStorage.clear() }
        if owner == nil { F1tThumbnailStorage.clear() }
    }

    func state(for attributes: F1tWorkoutAttributes, store: NativeStore) -> F1tWorkoutAttributes.ContentState {
        let workout = active.flatMap { $0.matches(attributes) ? $0 : nil }
        let day = attributes.dayID.flatMap { id in store.days.first { $0.id == id } }
        let plan = workout?.plan ?? store.plan(day)
        let session = store.sessions.first { $0.performed_on == attributes.sessionDate }
        let sets = workout?.confirmedSets ?? store.sets.filter { $0.session_id == session?.id }
        var state = NativeLiveActivityState.make(plan: plan, sets: sets,
            past: workout?.past ?? store.previousSets(dayID: attributes.dayID, before: attributes.sessionDate),
            exercise: store.exercise, restEndsAt: workout?.restEndsAt ?? restEndsAt,
            currentExerciseID: workout?.currentExerciseID)
        if let name = workout?.exerciseNames[state.exerciseID] { state.exerciseName = String(name.prefix(80)) }
        state.workoutRevision = workout?.revision
        state.lastExerciseName = workout?.lastExerciseName
        // Keep the final rest visible until the person explicitly finishes.
        if state.phase == .finished { state.restEndsAt = workout?.restEndsAt }
        state.syncStatus = !store.loaded ? "Guardado en este iPhone · Verificando sincronización" : store.workoutPendingCount > 0
            ? (store.auth.localAccessOnly ? "Guardado en este iPhone · Pendiente de renovar sesión" : "Guardado en este iPhone · Pendiente de sincronizar")
            : "Sincronizado"
        state.notice = availabilityMessage ?? plan.compactMap { store.routineWeightErrors[$0.id] }.first
        return state
    }

    func logSet(_ request: F1tLogSetRequest, store: NativeStore, now: Date = Date()) async throws {
        if !store.auth.ready { await store.bootstrap() }
        guard store.auth.session?.user.id == request.ownerID else {
            throw NativeFailure.message("Este entrenamiento pertenece a otra cuenta. Abrí FIT para continuar.")
        }
        await restore(store: store)
        guard !intentBusy else { throw NativeFailure.message("La serie se está guardando. Esperá un momento.") }
        guard let workout = ownedWorkout(store),
              workout.attributes.sessionDate == request.sessionDate, workout.attributes.dayID == request.dayID,
              request.revision == workout.revision else {
            throw NativeFailure.message("El entrenamiento cambió. Usá la tarjeta actualizada para registrar la serie.")
        }
        let offered = state(for: workout.attributes, store: store)
        guard offered.phase == .working, offered.exerciseID == request.exerciseID,
              offered.setIndex == request.setIndex, offered.reps == request.reps, offered.weightKg == request.weightKg,
              !workout.confirmedSets.contains(where: { $0.exercise_id == request.exerciseID && $0.set_index == request.setIndex }) else {
            throw NativeFailure.message("Esta serie ya cambió o fue registrada. Revisá el entrenamiento actual.")
        }
        let draftKey = NativeWorkoutRepository.draftKey(date: request.sessionDate, dayID: request.dayID,
                                                       exerciseID: request.exerciseID, index: request.setIndex)
        if let draft = try store.workoutRepository.read(owner: request.ownerID).drafts[draftKey] {
            let reps = draft.repsText.trimmingCharacters(in: .whitespacesAndNewlines)
            let weight = draft.weightText.trimmingCharacters(in: .whitespacesAndNewlines)
            let draftReps = reps.isEmpty ? nil : Int(reps)
            let draftWeight = weight.isEmpty ? nil : nativeNumber(weight)
            guard (reps.isEmpty || draftReps != nil), (weight.isEmpty || draftWeight != nil),
                  draftReps == request.reps,
                  draftWeight.map({ ($0 * 100).rounded() / 100 }) == request.weightKg else {
                throw NativeFailure.message("Esta serie tiene cambios sin confirmar. Revisá las repeticiones y el peso en FIT.")
            }
        }
        intentBusy = true
        defer { intentBusy = false }
        let action = NativeWorkoutAction(auth: store.auth)
        do {
            var isNew = false
            try await store.commitWorkoutSet(action: action, exerciseID: request.exerciseID, index: request.setIndex,
                date: request.sessionDate, dayID: request.dayID, reps: request.reps, weight: request.weightKg,
                onNewSet: { isNew = true })
            try action.check(in: store.auth)
            guard active?.id == workout.id else { throw CancellationError() }
            if isNew {
                pendingRestSetKey = "\(request.exerciseID)|\(request.setIndex)"
                // Created AFTER the local durable confirmation, not before network work.
                startRest(store: store)
            } else { sync(workout.attributes, store: store) }
            await flushPublication()
            try action.check(in: store.auth)
            NotificationCenter.default.post(name: .nativeLiveSetLogged, object: store, userInfo: [
                "sessionDate": request.sessionDate, "dayID": request.dayID ?? "", "newSet": isNew,
                "restEndsAt": restEndsAt as Any,
            ])
        } catch {
            if action.isCurrent(in: store.auth), active?.id == workout.id {
                availabilityMessage = "No se pudo completar la acción. Abrí FIT para revisar la serie."
                if let active { publish(active, store: store) }
                await flushPublication()
            }
            throw error
        }
    }

    private func changeRest(_ request: F1tRestRequest, store: NativeStore) async throws {
        if !store.auth.ready { await store.bootstrap() }
        guard store.auth.session?.user.id == request.ownerID else { throw F1tWorkoutIntentError.unavailable }
        await restore(store: store)
        guard let workout = ownedWorkout(store), workout.attributes.sessionDate == request.sessionDate,
              workout.attributes.dayID == request.dayID, request.revision == workout.revision,
              workout.restEndsAt != nil else {
            throw NativeFailure.message("El descanso cambió. Usá la tarjeta actualizada.")
        }
        let action = NativeWorkoutAction(auth: store.auth)
        switch request.action {
        case .extend(let seconds):
            guard (1...300).contains(seconds) else { throw F1tWorkoutIntentError.unavailable }
            extendRest(seconds: TimeInterval(seconds), store: store)
        case .skip: omitRest(store: store)
        }
        guard active?.revision != workout.revision else {
            throw NativeFailure.message("No se pudo guardar el cambio de descanso. Reintentá desde FIT.")
        }
        await flushPublication()
        try action.check(in: store.auth)
    }

    private func begin(_ attributes: F1tWorkoutAttributes, store: NativeStore) throws {
        let day = attributes.dayID.flatMap { id in store.days.first { $0.id == id } }
        let plan = try performedWorkout(date: attributes.sessionDate, dayID: attributes.dayID, store: store)?.plan ?? store.plan(day)
        guard !plan.isEmpty else { throw NativeFailure.message("Este día no tiene ejercicios para empezar.") }
        let session = store.sessions.first { $0.performed_on == attributes.sessionDate }
        let sets = store.sets.filter { $0.session_id == session?.id }
        let names = Dictionary(plan.map { ($0.exercise_id, store.exercise($0.exercise_id)?.name ?? $0.exercise_id) }, uniquingKeysWith: { a, _ in a })
        let workout = NativeActiveWorkout(attributes: attributes, startedAt: Date(), updatedAt: Date(),
            plan: plan, exerciseNames: names, past: store.previousSets(dayID: attributes.dayID, before: attributes.sessionDate),
            confirmedSets: sets, currentExerciseID: NativeWorkoutProgress.firstUnfinished(plan: plan, sets: sets),
            restEndsAt: nil, lastExerciseName: nil)
        try persist(workout)
    }

    private func ownedWorkout(_ store: NativeStore) -> NativeActiveWorkout? {
        guard let active, active.attributes.ownerID == store.auth.session?.user.id else { return nil }
        return active
    }

    private func reconcile(store: NativeStore) {
        guard var workout = ownedWorkout(store), store.loaded else { return }
        let session = store.sessions.first(where: { $0.performed_on == workout.attributes.sessionDate })
        let sets = store.sets.filter { $0.session_id == session?.id }
        func signature(_ rows: [NativeSet]) -> [String] {
            rows.map { "\($0.exercise_id)|\($0.set_index)|\($0.reps.map(String.init) ?? "")|\($0.weight_kg.map { String($0) } ?? "")" }.sorted()
        }
        guard signature(sets) != signature(workout.confirmedSets) else { return }
        let oldKeys = Set(workout.confirmedSets.map { "\($0.exercise_id)|\($0.set_index)" })
        if let added = sets.last(where: { !oldKeys.contains("\($0.exercise_id)|\($0.set_index)") }) {
            pendingRestSetKey = "\(added.exercise_id)|\(added.set_index)"
        }
        workout.confirmedSets = sets
        let next = NativeWorkoutProgress.firstUnfinished(plan: workout.plan, sets: sets)
        if let current = workout.currentExerciseID,
           let row = workout.plan.first(where: { $0.exercise_id == current }),
           !NativeWorkoutProgress.complete(target: row.target_sets, indexes: sets.filter { $0.exercise_id == current }.map(\.set_index)) {
            // Preserve a deliberate selection while its required sets are unfinished.
        } else { workout.currentExerciseID = next }
        workout.changed()
        do { try persist(workout) }
        catch { availabilityMessage = "La serie está guardada, pero no se pudo actualizar el descanso local. Abrí FIT para revisar." }
    }

    private func persist(_ workout: NativeActiveWorkout) throws {
        try NativeActiveWorkoutStorage.write(workout)
        active = workout
        expose(workout)
        availabilityMessage = nil
    }

    @discardableResult private func accept(_ workout: NativeActiveWorkout, store: NativeStore) -> Bool {
        do {
            let previousEnd = active?.restEndsAt
            try persist(workout)
            if previousEnd != workout.restEndsAt { NativeRestNotifications.shared.invalidate() }
            publish(workout, store: store)
            return true
        } catch {
            availabilityMessage = "No se pudo guardar el cambio de descanso en este iPhone. Reintentá."
            return false
        }
    }

    private func expose(_ workout: NativeActiveWorkout) {
        activeAttributes = workout.attributes
        currentExerciseID = workout.currentExerciseID
        restEndsAt = workout.restEndsAt
    }

    private func publish(_ workout: NativeActiveWorkout, store: NativeStore) {
        let state = state(for: workout.attributes, store: store)
        prepareThumbnail(state, store: store)
        do {
            try F1tLiveWorkoutStorage.write(.init(ownerID: workout.attributes.ownerID,
                sessionDate: workout.attributes.sessionDate, dayLabel: workout.attributes.dayLabel, state: state,
                updatedAt: Date(), dayID: workout.attributes.dayID, currentExerciseID: workout.currentExerciseID,
                workoutRevision: workout.revision, workoutID: workout.id))
            WidgetCenter.shared.reloadAllTimelines()
        } catch { availabilityMessage = "El entrenamiento está guardado, pero el widget no pudo actualizarse." }
        let lifetime = lifecycle
        enqueue { [weak self, weak store] in
            guard let self, let store, self.lifecycle == lifetime, self.active?.revision == workout.revision,
                  store.auth.session?.user.id == workout.attributes.ownerID else { return }
            let content = ActivityContent(state: state, staleDate: state.restEndsAt)
            if let existing = self.activities(for: workout.attributes).first {
                self.activity = existing
                self.observe(existing, workoutID: workout.id)
                await existing.update(content)
            } else if !workout.dismissedActivity {
                guard UIApplication.shared.applicationState == .active else {
                    self.availabilityMessage = "Abrí el entrenamiento en FIT para mostrarlo en la pantalla de bloqueo."
                    await self.deliverRestNotice(workout)
                    return
                }
                guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                    self.availabilityMessage = "Las Actividades en vivo están desactivadas. Podés habilitarlas en Ajustes."
                    await self.deliverRestNotice(workout)
                    return
                }
                do {
                    let bytes = try JSONEncoder().encode(workout.attributes).count + JSONEncoder().encode(state).count
                    guard bytes <= 4096 else { throw NativeFailure.message("La tarjeta contiene demasiada información.") }
                    self.activity = try Activity.request(attributes: workout.attributes, content: content, pushType: nil)
                    if let activity = self.activity { self.observe(activity, workoutID: workout.id) }
                } catch {
                    self.availabilityMessage = "No se pudo mostrar la Actividad en vivo. Tu entrenamiento sigue guardado."
                }
            }
            guard self.lifecycle == lifetime, self.active?.revision == workout.revision else { return }
            await self.deliverRestNotice(workout)
        }
    }

    private func scheduleRest(_ workout: NativeActiveWorkout) {
        enqueue { [weak self] in
            guard let self, self.active?.revision == workout.revision else { return }
            await self.deliverRestNotice(workout)
        }
    }

    private func deliverRestNotice(_ workout: NativeActiveWorkout) async {
        guard active?.id == workout.id, active?.restEndsAt == workout.restEndsAt else { return }
        if let end = workout.restEndsAt {
            let milliseconds = Int64(end.timeIntervalSince1970 * 1000)
            let id = NativeRestNotifications.prefix + workout.id + ".\(milliseconds)"
            if end > Date() {
                await NativeRestNotifications.shared.replace(id: id,
                    title: "Descanso terminado", endsAt: end, url: workout.attributes.workoutURL)
            } else {
                NativeRestNotifications.shared.restoreDeliveredNotice(id: id, url: workout.attributes.workoutURL)
            }
        } else if workout.restEndsAt == nil {
            await NativeRestNotifications.shared.cancel()
        }
    }

    private static func isOngoing(_ activity: Activity<F1tWorkoutAttributes>) -> Bool {
        activity.activityState == .active || activity.activityState == .stale
    }

    private func activities(for attributes: F1tWorkoutAttributes) -> [Activity<F1tWorkoutAttributes>] {
        Activity<F1tWorkoutAttributes>.activities.filter {
            $0.attributes.ownerID == attributes.ownerID && $0.attributes.sessionDate == attributes.sessionDate &&
            $0.attributes.dayID == attributes.dayID && Self.isOngoing($0)
        }
    }

    private func clearMemory() {
        activityObserver?.cancel(); activityObserver = nil
        lifecycle = UUID(); active = nil; activity = nil; pendingRestSetKey = nil
        activeAttributes = nil; currentExerciseID = nil; restEndsAt = nil; availabilityMessage = nil
    }

    private func observe(_ activity: Activity<F1tWorkoutAttributes>, workoutID: String) {
        if self.activity?.id == activity.id, activityObserver != nil { return }
        activityObserver?.cancel()
        activityObserver = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard !Task.isCancelled, let self, var workout = self.active, workout.id == workoutID else { return }
                if state == .dismissed || state == .ended {
                    workout.dismissedActivity = true
                    do { try self.persist(workout) }
                    catch { self.availabilityMessage = "No se pudo guardar el estado de la tarjeta." }
                    return
                }
            }
        }
    }

    private func purge() {
        let activities = Activity<F1tWorkoutAttributes>.activities
        NativeRestNotifications.shared.invalidate()
        clearMemory()
        do { try NativeActiveWorkoutStorage.clear() }
        catch { availabilityMessage = "No se pudo borrar el entrenamiento local. Desbloqueá el iPhone y reintentá." }
        F1tLiveWorkoutStorage.clear()
        F1tThumbnailStorage.clear()
        WidgetCenter.shared.reloadAllTimelines()
        enqueue {
            await NativeRestNotifications.shared.cancel()
            for activity in activities { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    private func enqueue(_ operation: @escaping @MainActor () async -> Void) {
        let previous = queue
        queueRevision = UUID()
        queue = Task { await previous?.value; await operation() }
    }

    /// An earlier queued status update may enqueue its publication while we wait.
    /// Drain that finite chain too before returning an intent to the system.
    private func flushPublication() async {
        var observed: UUID
        repeat {
            observed = queueRevision
            await queue?.value
        } while observed != queueRevision
    }

    private func prepareThumbnail(_ state: F1tWorkoutAttributes.ContentState, store: NativeStore) {
        guard let name = state.thumbnail, let directory = F1tThumbnailStorage.directoryURL(),
              let url = F1tThumbnailStorage.url(for: name), !FileManager.default.fileExists(atPath: url.path),
              let path = store.exercise(state.exerciseID)?.images.first, let image = FitImageCache.image(path),
              image.size.width > 0 else { return }
        // Match the largest Lock Screen thumbnail; don't publish oversized assets.
        let size = CGSize(width: 84, height: 56)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        let data = UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.75) { _ in
            let ratio = max(size.width / image.size.width, size.height / image.size.height)
            let fitted = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
            image.draw(in: CGRect(x: (size.width - fitted.width) / 2, y: (size.height - fitted.height) / 2,
                                  width: fitted.width, height: fitted.height))
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
