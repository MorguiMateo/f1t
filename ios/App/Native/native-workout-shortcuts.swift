import AppIntents
import Foundation

/// All mutations go through the app's durable workout runtime, never a second
/// Siri-specific save path. This file belongs to the APP target only.
struct NativeWorkoutShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor { .orange }
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: NativeResumeWorkoutIntent(), phrases: [
            "Retomar entrenamiento en \(.applicationName)",
            "Continuar mi entrenamiento en \(.applicationName)"
        ], shortTitle: "Retomar entrenamiento", systemImageName: "play.circle")
        AppShortcut(intent: NativeStartWorkoutIntent(), phrases: [
            "Iniciar entrenamiento en \(.applicationName)",
            "Empezar mi entrenamiento en \(.applicationName)"
        ], shortTitle: "Iniciar entrenamiento", systemImageName: "figure.strengthtraining.traditional")
        AppShortcut(intent: NativeLogSuggestedSetIntent(), phrases: [
            "Registrar serie en \(.applicationName)",
            "Serie hecha en \(.applicationName)"
        ], shortTitle: "Registrar serie", systemImageName: "checkmark.circle")
        AppShortcut(intent: NativeSkipRestIntent(), phrases: [
            "Omitir descanso en \(.applicationName)",
            "Terminar descanso en \(.applicationName)"
        ], shortTitle: "Omitir descanso", systemImageName: "forward.end")
    }
}

struct NativeResumeWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource = "Retomar entrenamiento"
    static var description = IntentDescription("Abre el entrenamiento activo de tu cuenta en FIT.")
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }
    static var openAppWhenRun: Bool { true }

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let store = try await NativeShortcutWorkoutContext.prepare()
        let attributes = try NativeShortcutWorkoutContext.active(store: store)
        try NativeShortcutWorkoutContext.open(attributes, store: store)
        return .result(dialog: "Abrí tu entrenamiento en FIT para continuar.")
    }
}

struct NativeStartWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource = "Iniciar entrenamiento"
    static var description = IntentDescription("Abre el entrenamiento de hoy. Si hay uno activo, lo retoma sin crear otro.")
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }
    static var openAppWhenRun: Bool { true }

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let store = try await NativeShortcutWorkoutContext.prepare()
        if NativeLiveActivity.shared.activeAttributes != nil {
            let attributes = try NativeShortcutWorkoutContext.active(store: store)
            try NativeShortcutWorkoutContext.open(attributes, store: store)
            return .result(dialog: "Ya tenés un entrenamiento activo. Abrí FIT para retomarlo.")
        }
        let action = NativeWorkoutAction(auth: store.auth)
        if !store.loaded { await store.refresh() }
        try action.check(in: store.auth)
        guard store.loaded, let owner = store.auth.session?.user.id, let routine = store.active,
              routine.user_id == owner else {
            throw NativeFailure.message("Abrí FIT y cargá una rutina activa antes de iniciar el entrenamiento.")
        }
        let now = Date(), key = NativeDate.key(now)
        let sessions = store.sessions.filter { $0.user_id == owner && $0.performed_on == key }
        guard sessions.count <= 1 else { throw NativeFailure.message("Hay más de una sesión para hoy. Elegí el entrenamiento en FIT.") }
        let candidates = store.days.filter {
            $0.user_id == owner && $0.routine_id == routine.id && $0.weekday == NativeDate.weekday(now)
        }
        if sessions.isEmpty, candidates.count != 1 {
            throw NativeFailure.message(candidates.isEmpty
                ? "Hoy no hay entrenamiento programado. Elegí un día de rutina en FIT."
                : "Hay más de un día de rutina para hoy. Elegí cuál entrenar en FIT.")
        }
        guard let day = NativeWorkoutSelection.day(selectedID: "", date: now, session: sessions.first,
                                                   activeID: routine.id, days: store.days),
              day.user_id == owner, !store.plan(day).isEmpty else {
            throw NativeFailure.message("Este entrenamiento no tiene un plan disponible. Revisalo en FIT.")
        }
        // Navigation is not a claim of a successful session write. The guided
        // view invokes the same start/resume domain path as an in-app tap.
        let attributes = F1tWorkoutAttributes(ownerID: owner, sessionDate: key, dayID: day.id, dayLabel: day.label)
        try NativeShortcutWorkoutContext.open(attributes, store: store)
        return .result(dialog: "Tu entrenamiento de hoy está listo para abrir en FIT.")
    }
}

struct NativeLogSuggestedSetIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Registrar serie sugerida"
    static var description = IntentDescription("Confirma y guarda la serie sugerida del ejercicio actual. No elige otra cuenta ni otro entrenamiento.")
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let store = try await NativeShortcutWorkoutContext.prepare()
        let action = NativeWorkoutAction(auth: store.auth)
        let suggestion = try NativeShortcutWorkoutContext.suggestion(store: store)
        let dialog = IntentDialog(stringLiteral: suggestion.confirmation)
        if #available(iOS 18.0, *) {
            try await requestConfirmation(actionName: .addData, dialog: dialog)
        } else {
            try await requestConfirmation(result: .result(dialog: dialog), confirmationActionName: .addData)
        }
        try action.check(in: store.auth)
        let current = try NativeShortcutWorkoutContext.suggestion(store: store)
        guard current.workoutID == suggestion.workoutID, current.request == suggestion.request else {
            throw NativeFailure.message("La serie actual cambió mientras confirmabas. Pedí registrar la serie de nuevo.")
        }
        try await NativeLiveActivity.shared.logSet(suggestion.request, store: store)
        try action.check(in: store.auth)
        // A cancelled/stale handler must never produce Siri's success dialog.
        let request = suggestion.request
        let sessionIDs = Set(store.sessions.filter {
            $0.user_id == request.ownerID && $0.performed_on == request.sessionDate
        }.map(\.id))
        guard store.sets.contains(where: {
            $0.user_id == request.ownerID && sessionIDs.contains($0.session_id) &&
            $0.exercise_id == request.exerciseID && $0.set_index == request.setIndex &&
            $0.reps == request.reps && $0.weight_kg == request.weightKg.map({ ($0 * 100).rounded() / 100 })
        }) else {
            throw NativeFailure.message("No se pudo confirmar la serie guardada. Abrí FIT antes de reintentar.")
        }
        return .result(dialog: "Serie guardada en este iPhone. La sincronización puede quedar pendiente si no hay conexión.")
    }
}

struct NativeSkipRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Omitir descanso"
    static var description = IntentDescription("Termina el descanso del entrenamiento activo sin registrar otra serie.")
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let store = try await NativeShortcutWorkoutContext.prepare()
        let action = NativeWorkoutAction(auth: store.auth)
        let attributes = try NativeShortcutWorkoutContext.active(store: store)
        let live = NativeLiveActivity.shared
        guard let end = live.restEndsAt, end > Date() else {
            throw NativeFailure.message("No hay un descanso activo para omitir.")
        }
        let state = live.state(for: attributes, store: store)
        guard let revision = state.workoutRevision else {
            throw NativeFailure.message("No se pudo validar el descanso guardado. Abrí FIT para revisarlo.")
        }
        try await F1tWorkoutIntentBridge.performRest(.init(ownerID: attributes.ownerID,
            sessionDate: attributes.sessionDate, dayID: attributes.dayID, revision: revision, action: .skip))
        try action.check(in: store.auth)
        guard live.restEndsAt == nil else {
            throw NativeFailure.message("No se pudo confirmar el fin del descanso. Revisalo en FIT.")
        }
        return .result(dialog: "Descanso terminado. No se registró ninguna serie.")
    }
}

@MainActor private enum NativeShortcutWorkoutContext {
    struct Suggestion {
        let workoutID: String
        let request: F1tLogSetRequest
        let confirmation: String
    }

    static func prepare() async throws -> NativeStore {
        let store = NativeStore.shared
        let initialOwner = store.auth.session?.user.id
        let initialGeneration = store.auth.generation
        await NativeApplicationLifecycle.shared.restore(store: store)
        try Task.checkCancellation()
        if let initialOwner {
            guard store.auth.session?.user.id == initialOwner, store.auth.generation == initialGeneration else {
                throw NativeFailure.message("La cuenta cambió. Volvé a ejecutar el atajo desde tu cuenta actual.")
            }
        }
        guard store.auth.ready, store.auth.session != nil else {
            throw NativeFailure.message("Iniciá sesión en FIT antes de usar este atajo.")
        }
        return store
    }

    static func active(store: NativeStore) throws -> F1tWorkoutAttributes {
        guard let owner = store.auth.session?.user.id,
              let attributes = NativeLiveActivity.shared.activeAttributes,
              attributes.ownerID == owner else {
            throw NativeFailure.message("No hay un entrenamiento activo de tu cuenta. Abrí FIT para iniciar uno.")
        }
        return attributes
    }

    static func open(_ attributes: F1tWorkoutAttributes, store: NativeStore) throws {
        guard attributes.ownerID == store.auth.session?.user.id else { throw CancellationError() }
        var url = URLComponents()
        url.scheme = "f1t"; url.host = "workout"
        url.queryItems = [URLQueryItem(name: "date", value: attributes.sessionDate)]
        if let day = attributes.dayID { url.queryItems?.append(.init(name: "day", value: day)) }
        guard let destination = url.url, NativeWorkoutRouter.shared.receive(destination, store: store) else {
            throw NativeFailure.message("No se pudo abrir el entrenamiento en FIT.")
        }
    }

    static func suggestion(store: NativeStore) throws -> Suggestion {
        let attributes = try active(store: store)
        let live = NativeLiveActivity.shared
        guard let workout = try NativeActiveWorkoutStorage.load(), workout.isValid(for: attributes.ownerID),
              workout.matches(attributes) else {
            throw NativeFailure.message("No se pudo validar el entrenamiento guardado. Abrí FIT antes de registrar una serie por voz.")
        }
        let state = live.state(for: attributes, store: store)
        guard state.phase == .working, !state.exerciseID.isEmpty,
              state.workoutRevision == workout.revision,
              state.exerciseID == live.currentExerciseID, state.setIndex >= 0,
              state.setIndex < state.totalSets, let reps = state.reps, (1...999).contains(reps),
              state.weightKg == nil || (state.weightKg!.isFinite && (0...9999.99).contains(state.weightKg!)) else {
            throw NativeFailure.message("No hay una serie sugerida inequívoca. Elegí el ejercicio y revisá sus valores en FIT.")
        }
        let weight = state.weightKg.map { ($0 * 100).rounded() / 100 }
        // Don't silently overwrite a different in-app draft with the suggestion.
        if let draft = store.workoutDraft(date: attributes.sessionDate, dayID: attributes.dayID,
                                          exerciseID: state.exerciseID, index: state.setIndex) {
            let draftReps = draft.repsText.trimmingCharacters(in: .whitespacesAndNewlines)
            let draftWeight = draft.weightText.trimmingCharacters(in: .whitespacesAndNewlines)
            let parsedWeight = draftWeight.isEmpty ? nil : nativeNumber(draftWeight)
            guard Int(draftReps) == reps, draftWeight.isEmpty || parsedWeight != nil,
                  parsedWeight.map({ ($0 * 100).rounded() / 100 }) == weight else {
                throw NativeFailure.message("Esta serie tiene cambios sin confirmar en FIT. Revisalos en la app antes de registrarla por voz.")
            }
        }
        let request = F1tLogSetRequest(ownerID: attributes.ownerID, sessionDate: attributes.sessionDate,
                                      dayID: attributes.dayID, exerciseID: state.exerciseID,
                                      setIndex: state.setIndex, reps: reps, weightKg: state.weightKg, revision: workout.revision)
        let weightLabel = weight.map { "\($0.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "es_AR")))) kilos" } ?? "sin peso informado"
        let name = String(state.exerciseName.prefix(100))
        return Suggestion(workoutID: workout.id, request: request, confirmation: "¿Registrar \(name), serie \(state.setIndex + 1), \(reps) repeticiones, \(weightLabel)?")
    }
}
