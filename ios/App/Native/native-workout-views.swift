import SwiftUI
import UIKit

// Guided training is opt-in; the calendar/history editor stays unrestricted.
enum NativeWorkoutMode { case history, guided }

enum NativeWorkoutProgress {
    /// Nil/zero targets get one finite required set, also used in the displayed goal.
    static func goal(_ target: Int?) -> Int { max(1, target ?? 1) }
    static func ids(_ plan: [NativeRoutineExercise]) -> [String] {
        var seen = Set<String>()
        return plan.map(\.exercise_id).filter { seen.insert($0).inserted }
    }
    static func complete(target: Int?, indexes: [Int]) -> Bool {
        Set(0..<goal(target)).isSubset(of: Set(indexes))
    }
    static func firstUnfinished(plan: [NativeRoutineExercise], sets: [NativeSet]) -> String? {
        ids(plan).first { id in
            !complete(target: plan.first { $0.exercise_id == id }?.target_sets,
                      indexes: sets.filter { $0.exercise_id == id }.map(\.set_index))
        }
    }
    static func pending(plan: [NativeRoutineExercise], sets: [NativeSet]) -> [String] {
        ids(plan).filter { id in
            !complete(target: plan.first { $0.exercise_id == id }?.target_sets,
                      indexes: sets.filter { $0.exercise_id == id }.map(\.set_index))
        }
    }
    /// Advance through the frozen order, wrapping only after the last exercise.
    /// Postponing never registers or completes a set.
    static func nextPending(after current: String, order: [String], pending: [String]) -> String? {
        guard let index = order.firstIndex(of: current), !order.isEmpty else {
            return pending.first { $0 != current }
        }
        return (1..<order.count).map { order[(index + $0) % order.count] }
            .first { pending.contains($0) }
    }
}

struct NativeWorkoutDraftReference: Identifiable, Equatable {
    let exerciseID: String
    let index: Int
    var id: String { "\(exerciseID)\u{1f}\(index)" }

    /// Journal keys include the routine day. A finish review must never expose a
    /// different day's drafts, even when both sessions share a calendar date.
    static func scoped(keys: [String], date: String, dayID: String?) -> [Self] {
        keys.compactMap { key -> Self? in
            let parts = key.components(separatedBy: "\u{1f}")
            guard parts.count == 4, parts[0] == date, parts[3] == (dayID ?? ""),
                  !parts[1].isEmpty, let index = Int(parts[2]), (0...Int(Int16.max)).contains(index) else { return nil }
            return Self(exerciseID: parts[1], index: index)
        }.sorted { $0.exerciseID == $1.exerciseID ? $0.index < $1.index : $0.exerciseID < $1.exerciseID }
    }
}

struct NativeWorkoutFinishSummary {
    let confirmedSets: Int
    let pendingExercises: Int
    let drafts: [NativeWorkoutDraftReference]
    init(plan: [NativeRoutineExercise], sets: [NativeSet], draftKeys: [String], date: String, dayID: String?) {
        confirmedSets = sets.count
        pendingExercises = NativeWorkoutProgress.pending(plan: plan, sets: sets).count
        drafts = NativeWorkoutDraftReference.scoped(keys: draftKeys, date: date, dayID: dayID)
    }
}

enum NativeWorkoutSuggestion {
    static func weight(saved: NativeSet?, target: Double?, previous: NativeSet?) -> Double? {
        if let saved { return saved.weight_kg }
        return target ?? previous?.weight_kg
    }
}

struct NativeGuidedCursor {
    private(set) var currentID: String?
    init(plan: [NativeRoutineExercise], sets: [NativeSet]) {
        currentID = NativeWorkoutProgress.firstUnfinished(plan: plan, sets: sets)
    }
    mutating func next(plan: [NativeRoutineExercise], sets: [NativeSet]) {
        guard let id = currentID,
              NativeWorkoutProgress.complete(target: plan.first { $0.exercise_id == id }?.target_sets,
                  indexes: sets.filter { $0.exercise_id == id }.map(\.set_index)) else { return }
        currentID = NativeWorkoutProgress.firstUnfinished(plan: plan, sets: sets)
    }
    /// Corrections may rewind progress, but a newly completed set never advances it.
    @discardableResult mutating func reconcile(plan: [NativeRoutineExercise], sets: [NativeSet]) -> Bool {
        let ids = NativeWorkoutProgress.ids(plan)
        guard let pending = NativeWorkoutProgress.firstUnfinished(plan: plan, sets: sets),
              let pendingIndex = ids.firstIndex(of: pending) else { return false }
        if let currentID, let currentIndex = ids.firstIndex(of: currentID), pendingIndex >= currentIndex { return false }
        currentID = pending
        return true
    }
}

/// Identity belongs to the UI action, not to whichever account starts its Task.
@MainActor struct NativeWorkoutAction {
    private let generation: UUID
    private let owner: String?
    init(auth: NativeAuth) { generation = auth.generation; owner = auth.session?.user.id }
    func isCurrent(in auth: NativeAuth) -> Bool {
        owner != nil && generation == auth.generation && owner == auth.session?.user.id
    }
    func check(in auth: NativeAuth) throws {
        guard isCurrent(in: auth) else { throw CancellationError() }
    }
}

struct NativeRestClock {
    enum Event { case newSet, edit, untick }
    private(set) var scope: String
    private(set) var end: Date?
    init(scope: String) { self.scope = scope }
    static func minutes(_ value: Double) -> Double {
        guard value.isFinite else { return 2 }
        return (min(10, max(0.5, value)) * 2).rounded() / 2
    }
    mutating func changeScope(_ value: String) { if scope != value { scope = value; cancel() } }
    mutating func record(_ event: Event, succeeded: Bool, scope: String, minutes: Double, now: Date = Date()) {
        guard scope == self.scope, succeeded, event == .newSet else { return }
        end = now.addingTimeInterval(Self.minutes(minutes) * 60)
    }
    mutating func cancel() { end = nil }
    func remaining(at now: Date) -> Int { max(0, Int(ceil(end?.timeIntervalSince(now) ?? 0))) }
    func text(at now: Date) -> String {
        let seconds = remaining(at: now)
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

/// Every editor and draft is scoped to the complete account/session/row identity.
/// Keep the hydrated value for disappearance writes, never the newly rendered inputs.
struct NativeWorkoutRowContext: Hashable {
    let ownerID: String?
    let generation: UUID
    let date: String
    let dayID: String?
    let exerciseID: String
    let index: Int
    var controlID: String {
        "\(ownerID ?? "")|\(generation.uuidString)|\(date)|\(dayID ?? "")|\(exerciseID)|\(index)"
    }
    @MainActor func persistDraft(in store: NativeStore, action: NativeWorkoutAction, repsText: String, weightText: String) throws {
        try action.check(in: store.auth)
        guard ownerID == store.auth.session?.user.id, generation == store.auth.generation else { throw CancellationError() }
        try store.saveWorkoutDraft(date: date, dayID: dayID, exerciseID: exerciseID, index: index,
                                   repsText: repsText, weightText: weightText)
    }
}

extension NativeStore {
    /// Runs a write and hands its error to the caller, for errors shown next to the control.
    func attempt(action: NativeWorkoutAction? = nil, _ operation: () async throws -> Void) async -> String? {
        if let action, !action.isCurrent(in: auth) { return nil }
        if busy { return "Esperá a que termine el guardado anterior y reintentá." }
        let succeeded = await run {
            try action?.check(in: auth)
            try await operation()
            try action?.check(in: auth)
        }
        // Cancellation must not consume or replace the incoming account's error.
        if let action, !action.isCurrent(in: auth) { return nil }
        if succeeded { return nil }
        let message = error ?? "No se pudo completar la operación."
        error = nil
        return message
    }
    @discardableResult func enqueueWorkoutAction(_ operation: @escaping (NativeWorkoutAction) async -> Void) -> Task<Void, Never> {
        let action = NativeWorkoutAction(auth: auth)
        return Task {
            guard action.isCurrent(in: auth) else { return }
            await operation(action)
        }
    }
    /// Compatibility boundary for Live Activity intents and existing callers.
    /// The store owns durable commands, acknowledgement, defaults and background sync.
    func saveWorkoutSet(action: NativeWorkoutAction, exerciseID: String, index: Int, date: String, dayID: String?, reps: Int?, weight: Double?, onNewSet: () -> Void) async throws {
        try action.check(in: auth)
        try await commitWorkoutSet(action: action, exerciseID: exerciseID, index: index, date: date,
                                   dayID: dayID, reps: reps, weight: weight, onNewSet: onNewSet)
    }
    func removeWorkoutSet(action: NativeWorkoutAction, saved: NativeSet) async throws {
        try action.check(in: auth)
        guard let session = sessions.first(where: { $0.id == saved.session_id }) else {
            throw NativeFailure.message("No se encontró el entrenamiento de esta serie. Actualizá antes de quitarla.")
        }
        try await commitWorkoutDeletion(action: action, exerciseID: saved.exercise_id, index: saved.set_index,
                                        date: session.performed_on, dayID: session.routine_day_id)
    }
    func acknowledgeWorkoutSession(_ session: NativeWorkoutSession) {
        sessions.removeAll { $0.id == session.id }
        sessions.append(NativeWorkoutSession(id: session.id, user_id: session.user_id, performed_on: session.performed_on,
            created_at: session.created_at, routine_day_id: session.routine_day_id, notes: session.notes,
            set_count: sets.filter { $0.session_id == session.id }.count))
    }
    func days(of routineID: String?) -> [NativeRoutineDay] {
        days.filter { $0.routine_id == routineID }.sorted { ($0.weekday + 6) % 7 < ($1.weekday + 6) % 7 }
    }
    /// Sets from the latest earlier session of the same routine day; they prefill reps and weight.
    func previousSets(dayID: String?, before key: String) -> [NativeSet] {
        guard let dayID, let session = sessions.filter({ $0.routine_day_id == dayID && $0.performed_on < key && $0.set_count > 0 })
            .max(by: { $0.performed_on < $1.performed_on }) else { return [] }
        return sets.filter { $0.session_id == session.id }
    }
}

enum NativeWorkoutSelection {
    static func shouldSelect(currentID: String?, candidate: String, isCurrentSession: Bool) -> Bool {
        isCurrentSession && candidate != currentID
    }
    static func day(selectedID: String, date: Date, session: NativeWorkoutSession?, activeID: String?, days: [NativeRoutineDay]) -> NativeRoutineDay? {
        if let selected = days.first(where: { $0.id == selectedID && $0.routine_id == activeID }) { return selected }
        if let session { return days.first { $0.id == session.routine_day_id } }
        return days.first { $0.routine_id == activeID && $0.weekday == NativeDate.weekday(date) }
    }
    static func sessionBody(date: String, day: String?) -> [String: Any] {
        ["performed_on": date, "routine_day_id": nativeNull(day)]
    }
    /// Starts at the next day and wraps around, like the web's `nextTrainingDay`.
    static func next(after date: Date, in days: [NativeRoutineDay]) -> (day: NativeRoutineDay, inDays: Int)? {
        let from = NativeDate.weekday(date)
        for inDays in 1...7 { if let day = days.first(where: { $0.weekday == (from + inDays) % 7 }) { return (day, inDays) } }
        return nil
    }
    static func when(_ inDays: Int, weekday: Int) -> String {
        let name = NativeDate.weekdays[weekday].lowercased()
        if inDays == 1 { return "mañana" }
        return inDays == 7 ? "el \(name) que viene" : "el \(name)"
    }
}

// MARK: - Entrenar

/// The current row supplies a command to the screen's bottom safe-area inset.
/// Historical rows remain independent; navigation never carries a stale row command.
@MainActor final class NativeWorkoutControls: ObservableObject {
    @Published var rowID: String?
    @Published var title = "Registrar serie"
    @Published var summary = ""
    @Published var contextLabel = ""
    @Published var errorMessage: String?
    @Published var retryTitle = "Reintentar"
    @Published var saving = false
    @Published var localWrites = Set<String>()
    @Published var undoLabel: String?
    @Published var undoing = false
    @Published var undoToken: UUID?
    var undoContext: NativeWorkoutRowContext?
    var undoAction: NativeWorkoutAction?
    var record: (() -> Void)?
    var retry: (() -> Void)?
    var undo: (() -> Void)?
    var dismissKeyboard: (() -> Void)?
    var keyboardRowID: String?
    func invalidateUndo() {
        undo = nil; undoLabel = nil; undoToken = nil; undoContext = nil; undoAction = nil
    }
    func validateUndo(in store: NativeStore) {
        guard let token = undoToken, let context = undoContext, let action = undoAction else { return }
        let session = store.sessions.first { $0.performed_on == context.date }
        if !action.isCurrent(in: store.auth) || session == nil ||
            store.sets.contains(where: { $0.session_id == session?.id && $0.exercise_id == context.exerciseID && $0.set_index == context.index }) ||
            store.workoutMutationToken(date: context.date, exerciseID: context.exerciseID, index: context.index) != token {
            invalidateUndo()
        }
    }
    func clear(_ id: String? = nil) {
        guard id == nil || rowID == id else { return }
        rowID = nil; record = nil; saving = false
        contextLabel = ""; errorMessage = nil; retry = nil
        if id == nil { invalidateUndo(); undoing = false; dismissKeyboard = nil; keyboardRowID = nil; localWrites.removeAll() }
    }
}

private struct NativeWorkoutControlsKey: EnvironmentKey {
    static let defaultValue: NativeWorkoutControls? = nil
}

extension EnvironmentValues {
    var nativeWorkoutControls: NativeWorkoutControls? {
        get { self[NativeWorkoutControlsKey.self] }
        set { self[NativeWorkoutControlsKey.self] = newValue }
    }
}

private struct NativeWorkoutBottomAction: View {
    @ObservedObject var controls: NativeWorkoutControls
    var body: some View {
        if controls.rowID != nil, controls.record != nil {
            VStack(alignment: .leading, spacing: 6) {
                Text(controls.contextLabel).font(.fit(.sm, .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(controls.summary).font(.fit(.sm)).foregroundStyle(FitColor.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                if let message = controls.errorMessage {
                    Text(message).font(.fit(.sm)).foregroundStyle(FitColor.warn)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Error: \(message)")
                }
                Button {
                    if controls.errorMessage != nil, let retry = controls.retry { retry() }
                    else { controls.record?() }
                } label: {
                    HStack {
                        if controls.saving { ProgressView().tint(FitColor.accentInk) }
                        Text(controls.saving ? "Registrando…" :
                             (controls.errorMessage != nil && controls.retry != nil ? controls.retryTitle : controls.title))
                            .fixedSize(horizontal: false, vertical: true)
                    }.frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(FitButtonStyle(variant: .primary, size: .gym, fullWidth: true))
                .disabled(controls.saving)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .frame(maxWidth: 512).frame(maxWidth: .infinity)
            .background(FitColor.surface)
            .overlay(alignment: .top) { Rectangle().fill(FitColor.line).frame(height: 1) }
        }
    }
}

struct NativeWorkoutView: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.fitSelectTab) private var selectTab
    let date: Date
    let mode: NativeWorkoutMode
    @State private var selectedDayID: String
    @State private var deleteError: String?
    @State private var deleting = false
    @State private var confirmingDelete = false
    @StateObject private var controls = NativeWorkoutControls()
    @ObservedObject private var live = NativeLiveActivity.shared

    init(date: Date, dayID: String? = nil, mode: NativeWorkoutMode = .history) {
        self.date = date; self.mode = mode
        _selectedDayID = State(initialValue: dayID ?? "")
    }

    private var key: String { NativeDate.key(date) }
    private var isToday: Bool { key == NativeDate.key() }
    private var activeDays: [NativeRoutineDay] { store.days(of: store.active?.id) }
    private var session: NativeWorkoutSession? { store.sessions.first { $0.performed_on == key } }
    private var day: NativeRoutineDay? {
        NativeWorkoutSelection.day(selectedID: selectedDayID, date: date, session: session, activeID: store.active?.id, days: store.days)
    }
    private var logged: [NativeSet] {
        guard let id = session?.id else { return [] }
        return store.sets.filter { $0.session_id == id }
    }
    private var previous: [NativeSet] { store.previousSets(dayID: day?.id, before: key) }
    private var matchingActivity: F1tWorkoutAttributes? {
        guard mode == .guided, let attributes = live.activeAttributes,
              attributes.ownerID == store.auth.session?.user.id,
              attributes.sessionDate == key, attributes.dayID == day?.id || attributes.dayID == selectedDayID else { return nil }
        return attributes
    }
    private var plan: [NativeRoutineExercise] {
        if let attributes = matchingActivity { return live.activePlan(for: attributes, store: store) }
        if let performed = live.performedPlan(date: key, dayID: day?.id ?? session?.routine_day_id, store: store) { return performed }
        return store.plan(day)
    }
    private var subtitle: String {
        let plan = plan
        let logged = logged
        let plannedIDs = NativeWorkoutProgress.ids(plan)
        let ids = mode == .guided ? plannedIDs : plannedIDs + Set(logged.map(\.exercise_id)).subtracting(plannedIDs).sorted()
        let byExercise = Dictionary(grouping: logged, by: \.exercise_id)
        var done = 0, planned = 0, volume = 0.0
        for id in ids {
            let sets = byExercise[id] ?? []
            if mode == .guided {
                let required = NativeWorkoutProgress.goal(plan.first { $0.exercise_id == id }?.target_sets)
                done += Set(sets.map(\.set_index)).intersection(0..<required).count
                planned += required
            } else {
                done += sets.count
                planned += max(plan.first { $0.exercise_id == id }?.target_sets ?? 0, sets.count)
            }
            for s in sets { if let r = s.reps, let w = s.weight_kg, r > 0, w > 0 { volume += Double(r) * w } }
        }
        let progress = planned == 0 ? "Sin series todavía" : "\(done)/\(planned) series"
        return volume > 0 ? "\(progress) · volumen \(FitFormat.number(volume)) kg × rep" : progress
    }

    var body: some View {
        FitPage {
            FitPageHeader(title: matchingActivity?.dayLabel ?? day?.label ?? "Entrenar", subtitle: store.loaded ? subtitle : "Cargando entrenamiento…", showsBack: true) { dayMenu }
            NativeDataStatus()
            ForEach(plan.filter { store.routineWeightErrors[$0.id] != nil }) { item in
                FitErrorNote(title: "No se guardó el peso de la rutina", message: store.routineWeightErrors[item.id] ?? "")
            }
            notes
            if store.workoutPendingCount > 0 {
                Text("\(store.workoutPendingCount) cambios guardados en este iPhone · pendientes de sincronizar")
                    .font(.fit(.sm)).foregroundStyle(FitColor.ink2).fitCard().padding(.bottom, 12)
            }
            if let error = store.workoutSyncError {
                FitErrorNote(title: "Revisá la sincronización del entrenamiento", message: error).padding(.bottom, 12)
                Button("Reintentar sincronización") { store.retryWorkoutSync() }
                    .buttonStyle(FitButtonStyle(size: .sm)).padding(.bottom, 12)
            }
            content
            if mode == .history {
                Button("Terminar edición") { dismiss() }
                    .buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true))
                    .padding(.top, 16)
            } else {
                Button("Volver sin finalizar") { dismiss() }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, fullWidth: true))
                    .padding(.top, 16)
            }
            if mode == .history, session != nil {
                Button("Borrar este entrenamiento", role: .destructive) { confirmingDelete = true }
                    .frame(minHeight: 44).buttonStyle(FitButtonStyle(variant: .danger, fullWidth: true))
                    .disabled(deleting).padding(.top, 24)
            }
            if let deleteError {
                FitErrorNote(title: "No se borró el entrenamiento; volvé a tocar Borrar", message: deleteError).padding(.top, 12)
            }
        }
        .environment(\.nativeWorkoutControls, controls)
        .fitKeyboardDone { controls.dismissKeyboard?() }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if let label = controls.undoLabel {
                    HStack {
                        Text(label).font(.fit(.sm))
                        Spacer(minLength: 8)
                        Button(controls.undoing ? "Deshaciendo…" : "Deshacer") { controls.undo?() }
                            .buttonStyle(FitButtonStyle(size: .sm)).disabled(controls.undoing)
                    }.padding(12).background(FitColor.surface2)
                }
                if mode == .guided { NativeWorkoutBottomAction(controls: controls) }
            }
        }
        .onDisappear { controls.clear() }
        .onChange(of: store.workoutSyncRevision) { _, _ in controls.validateUndo(in: store) }
        .onReceive(store.accountChanges) { _ in controls.clear() }
        .confirmationDialog("¿Borrar el entrenamiento del \(FitFormat.fieldDay(date)) y todas sus series?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Borrar entrenamiento", role: .destructive, action: deleteSession)
            Button("Cancelar", role: .cancel) { }
        }
    }

    private func deleteSession() {
        guard !deleting, session != nil else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        deleting = true
        Task {
            defer { deleting = false }
            do {
                try await store.commitWorkoutSessionDeletion(action: action, date: key)
                try action.check(in: store.auth)
                deleteError = nil
                controls.invalidateUndo()
                if live.activeAttributes?.sessionDate == key { live.finishWorkout(store: store) }
            } catch {
                if action.isCurrent(in: store.auth) { deleteError = error.localizedDescription }
            }
        }
    }

    @ViewBuilder private var dayMenu: some View {
        if mode == .history, !activeDays.isEmpty {
            Menu {
                Picker("Día de rutina a entrenar", selection: $selectedDayID) {
                    Text("Según fecha / sesión existente").tag("")
                    ForEach(activeDays) { option in Text("\(NativeDate.weekdays[option.weekday]) · \(option.label)").tag(option.id) }
                }
            } label: {
                Text("Cambiar día")
            }
            .buttonStyle(FitButtonStyle(size: .sm))
            .fixedSize()
        }
    }

    @ViewBuilder private var notes: some View {
        let moved = day.map { $0.weekday != NativeDate.weekday(date) } ?? false
        if !isToday || moved || (session != nil && !selectedDayID.isEmpty && session?.routine_day_id != day?.id) {
            VStack(alignment: .leading, spacing: 4) {
                if !isToday || moved { Text("Fecha: \(FitFormat.longDay(date))") }
                if session != nil, !selectedDayID.isEmpty, session?.routine_day_id != day?.id {
                    Text("La sesión conserva su día de rutina original.")
                }
            }
            .font(.fit(.xs))
            .foregroundStyle(FitColor.muted)
            .padding(.bottom, 12)
        }
    }

    private var guidedScope: String {
        // An active session freezes its plan in the coordinator. Refresh is not a new workout.
        "\(store.auth.session?.user.id ?? "")|\(store.auth.generation.uuidString)|\(key)|\(matchingActivity?.dayID ?? day?.id ?? "")"
    }

    @ViewBuilder private var content: some View {
        let plan = plan
        let logged = logged
        let previous = previous
        let plannedIDs = NativeWorkoutProgress.ids(plan)
        // Exercises already logged stay visible even if they left the routine.
        let exerciseIDs = plannedIDs + Set(logged.map(\.exercise_id)).subtracting(plannedIDs).sorted()
        // Never mount editable set rows until the complete account snapshot is ready.
        if !store.loaded {
            NativePendingContent()
        } else if exerciseIDs.isEmpty {
            if let day {
                FitEmptyState(title: "\(day.label) está vacío", description: "Agregá ejercicios para entrenar.") {
                    NavigationLink("Editar el día") { NativeRoutineDayDetail(dayID: day.id) }.fitLink()
                }
            } else {
                let next = NativeWorkoutSelection.next(after: date, in: activeDays)
                FitEmptyState(title: "No hay nada que registrar", description: store.active == nil ? "Activá una rutina con días de entrenamiento." : "\(isToday ? "Hoy es" : "Ese día fue") descanso.") {
                    if let next { Button("Entrenar \(next.day.label) igual") { selectedDayID = next.day.id }.fitLink() }
                    else { Button("Ir a mis rutinas") { selectTab(.routines) }.fitLink() }
                }
            }
        } else if mode == .guided {
            if plan.isEmpty {
                FitEmptyState(title: "El día ya no tiene ejercicios", description: "Revisá tus series guardadas en Progreso.")
            } else {
                NativeGuidedWorkout(date: date, dayID: matchingActivity?.dayID ?? day?.id, plan: plan, done: logged, past: previous)
                    .id(guidedScope)
            }
        } else {
            let loggedByExercise = Dictionary(grouping: logged, by: \.exercise_id)
            let previousByExercise = Dictionary(grouping: previous, by: \.exercise_id)
            // Keep editable rows mounted so scrolling cannot refill unsaved drafts.
            VStack(spacing: 8) {
                ForEach(exerciseIDs, id: \.self) { id in
                    NativeExerciseLog(exerciseID: id, target: plan.first { $0.exercise_id == id },
                                      done: loggedByExercise[id] ?? [], past: previousByExercise[id] ?? [],
                                      date: key, dayID: day?.id)
                        .id(NativeWorkoutRowContext(ownerID: store.auth.session?.user.id, generation: store.auth.generation,
                                                    date: key, dayID: day?.id, exerciseID: id, index: -1))
                }
            }
        }
    }
}

struct NativeWorkoutRestPreferences: View {
    @EnvironmentObject private var store: NativeStore
    @ObservedObject private var live = NativeLiveActivity.shared
    @ObservedObject private var alerts = NativeRestNotifications.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var requesting = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch alerts.permissionAction {
            case .loading:
                ProgressView("Revisando permiso de avisos…")
            case .request:
                Button(requesting ? "Solicitando permiso…" : "Activar avisos de descanso", action: requestPermission)
                    .buttonStyle(FitButtonStyle(size: .sm)).disabled(requesting)
            case .toggle:
                Toggle("Avisarme al terminar el descanso", isOn: Binding(get: { alerts.enabled }, set: {
                    live.setRestNotificationsEnabled($0, store: store)
                })).font(.fit(.sm))
                if alerts.needsSettings { settingsLink }
            case .settings:
                settingsLink
            }
            Text(alerts.permissionAction == .toggle && !alerts.enabled
                 ? "Avisos de descanso desactivados en FIT. El contador sigue funcionando."
                 : (alerts.permissionMessage ?? "El contador sigue al salir de esta pantalla."))
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            Text("Requiere permiso y depende de silencio y Concentración. No funciona con el iPhone apagado.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
        }.padding(.top, 8)
        .task { await alerts.refreshPermission() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await alerts.refreshPermission() } }
        }
    }
    @ViewBuilder private var settingsLink: some View {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            Link(alerts.permissionAction == .settings ? "Habilitar avisos en Ajustes" : "Revisar avisos en Ajustes", destination: url).fitLink()
        }
    }
    private func requestPermission() {
        guard !requesting else { return }
        requesting = true
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            defer { requesting = false }
            guard action.isCurrent(in: store.auth) else { return }
            live.setRestNotificationsEnabled(true, store: store)
            await live.requestRestNotifications(store: store)
        }
    }
}

/// The old clock initializer remains usable by pure fixtures. Production takes the
/// coordinator's end date; the system Text timer supplies the visible countdown.
struct NativeRestPanel: View {
    @Binding var minutes: Double
    let clock: NativeRestClock
    let onSkip: () -> Void
    var restEnd: Date? = nil
    var onExtend: (() -> Void)? = nil
    private var end: Date? { restEnd ?? clock.end }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        countdown(at: context.date)
                        Spacer(minLength: 0)
                        HStack(spacing: 8) { restActions }.disabled(end == nil)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        countdown(at: context.date)
                        HStack(spacing: 8) { restActions }.disabled(end == nil)
                    }
                }
            }
        }.fitCard()
    }
    private func countdown(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(end.map { $0 > now ? "Descansando" : "Descanso terminado" } ?? "Próximo descanso")
                .font(.fit(.sm, .semibold)).foregroundStyle(FitColor.muted)
            if let end {
                if end > now {
                    Text(timerInterval: now...end, countsDown: true, showsHours: false)
                        .font(.fit(.xl2, .bold)).monospacedDigit().accessibilityLabel("Tiempo de descanso restante")
                } else {
                    Text("00:00").font(.fit(.xl2, .bold)).monospacedDigit()
                }
            } else {
                Text(String(format: "%02d:%02d", Int(minutes * 60) / 60, Int(minutes * 60) % 60))
                    .font(.fit(.xl2, .bold)).monospacedDigit()
            }
        }
    }
    @ViewBuilder private var restActions: some View {
        if let onExtend {
            Button("+30 segundos", action: onExtend).buttonStyle(FitButtonStyle(size: .sm))
        }
        Button("Omitir descanso", action: onSkip).buttonStyle(FitButtonStyle(size: .sm))
    }
}

