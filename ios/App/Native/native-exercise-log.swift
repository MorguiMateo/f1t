import SwiftUI

/// Reuse only confirmed earlier work; callers preserve focused and durable drafts.
enum NativeSetPrefill {
    static func values(saved: NativeSet?, earlier: NativeSet?, previous: NativeSet?, targetReps: Int?, targetWeight: Double?) -> (reps: Int?, weight: Double?) {
        if let saved { return (saved.reps, saved.weight_kg) }
        return (earlier?.reps ?? previous?.reps ?? targetReps,
                earlier?.weight_kg ?? targetWeight ?? previous?.weight_kg)
    }
}

/// Adjustment preferences are not workout data. Separate account/exercise keys
/// prevent a newly signed-in athlete from inheriting someone else's controls.
enum NativeWorkoutWeightIncrement {
    static let didChange = Notification.Name("nativeWorkoutWeightIncrementChanged")
    static let choices: [Double] = [0.5, 1, 1.25, 2.5, 5, 10]
    static func normalized(_ value: Double) -> Double { choices.contains(value) ? value : 2.5 }
    static func key(ownerID: String?, exerciseID: String) -> String? {
        guard let ownerID, !ownerID.isEmpty, !exerciseID.isEmpty else { return nil }
        let scope = [ownerID, exerciseID].map { Data($0.utf8).base64EncodedString() }.joined(separator: ".")
        return "native.workout.weightIncrement.\(scope)"
    }
    static func read(ownerID: String?, exerciseID: String, defaults: UserDefaults = .standard) -> Double {
        guard let key = key(ownerID: ownerID, exerciseID: exerciseID), defaults.object(forKey: key) != nil else { return 2.5 }
        return normalized(defaults.double(forKey: key))
    }
    static func save(_ value: Double, ownerID: String?, exerciseID: String, defaults: UserDefaults = .standard) {
        guard let key = key(ownerID: ownerID, exerciseID: exerciseID) else { return }
        defaults.set(normalized(value), forKey: key)
        NotificationCenter.default.post(name: didChange, object: key)
    }
}

struct NativeExerciseLog: View {
    @EnvironmentObject private var store: NativeStore
    let exerciseID: String
    let target: NativeRoutineExercise?
    let done, past: [NativeSet]
    let date: String
    let dayID: String?
    var guided = false
    var onNewSet: () -> Void = {}
    @State private var expanded = false

    private var rowCount: Int {
        if guided { return NativeWorkoutProgress.goal(target?.target_sets) }
        let highest = (done.map(\.set_index).max() ?? -1) + 1
        let base = max(max(target?.target_sets ?? 0, highest), max(past.count, 1))
        return base + (done.count >= base ? 1 : 0)
    }
    private var goal: Int { guided ? NativeWorkoutProgress.goal(target?.target_sets) : (target?.target_sets ?? rowCount) }
    private var completedCount: Int { guided ? Set(done.map(\.set_index)).intersection(0..<goal).count : done.count }
    private var currentIndex: Int? { (0..<rowCount).first { index in !done.contains { $0.set_index == index } } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !guided {
                FitExerciseLine(exerciseID: exerciseID, targetSets: target?.target_sets, targetReps: target?.target_reps,
                                targetWeightKg: target?.target_weight_kg) {
                    Text("\(completedCount)/\(goal)").font(.fit(.sm)).monospacedDigit()
                }
                if let notes = target?.notes, !notes.isEmpty { Text(notes).font(.fit(.sm)).foregroundStyle(FitColor.muted) }
                ForEach(0..<rowCount, id: \.self) { index in row(index) }
            } else {
                if let index = currentIndex {
                    Text("Serie \(index + 1) de \(goal)").font(.fit(.lg, .semibold)).accessibilityAddTraits(.isHeader)
                    if let goal = FitFormat.targetRepsSource(target?.target_reps) {
                        Text("\(goal)\(target?.target_weight_kg.map { " · \(FitFormat.decimal($0)) kg" } ?? "")")
                            .font(.fit(.base, .medium)).fixedSize(horizontal: false, vertical: true)
                    }
                    row(index, emphasized: true)
                } else {
                    Label("\(FitFormat.sets(completedCount)) registradas", systemImage: "checkmark.circle")
                        .font(.fit(.base, .semibold))
                }
                if !done.isEmpty {
                    DisclosureGroup("Revisar o corregir series (\(done.count))", isExpanded: $expanded) {
                        // Mount required indexes, not only saved rows, so an explicit deletion
                        // doesn't lose its correction/undo state as the store publishes.
                        ForEach(0..<rowCount, id: \.self) { index in
                            if index != currentIndex { row(index) }
                        }
                    }.font(.fit(.sm)).padding(.top, 4)
                }
                Text("\(completedCount) de \(goal) series registradas. Cada fila muestra su estado de sincronización.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            }
        }.fitCard()
    }
    private func row(_ index: Int, emphasized: Bool = false) -> some View {
        NativeSetRow(exerciseID: exerciseID, index: index, saved: done.first { $0.set_index == index },
                     previous: past.first { $0.set_index == index }, targetReps: target?.target_reps,
                     targetWeightKg: target?.target_weight_kg,
                     earlier: done.filter { $0.set_index < index }.max { $0.set_index < $1.set_index },
                     date: date, dayID: dayID,
                     onNewSet: onNewSet, emphasized: emphasized, seriesGoal: guided ? goal : nil)
            .id(NativeWorkoutRowContext(ownerID: store.auth.session?.user.id, generation: store.auth.generation,
                                        date: date, dayID: dayID, exerciseID: exerciseID, index: index))
    }
}

enum NativeWorkoutInput {
    static func registrationError(reps: String, weight: String, isNew: Bool) -> String? {
        if let error = error(reps: reps, weight: weight) { return error }
        if isNew, reps.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Ingresá las repeticiones antes de registrar la serie."
        }
        return nil
    }
    static func parse(reps: String, weight: String) -> (reps: Int?, weight: Double?)? {
        let r = reps.trimmingCharacters(in: .whitespacesAndNewlines)
        let w = weight.trimmingCharacters(in: .whitespacesAndNewlines)
        let repetitions = r.isEmpty ? nil : Int(r)
        let kilograms = w.isEmpty ? nil : nativeNumber(w)
        if !r.isEmpty {
            guard let repetitions, (0...999).contains(repetitions) else { return nil }
        }
        if !w.isEmpty {
            guard let kilograms, (0...9999.99).contains(kilograms),
                  w.range(of: #"^\d+([.,]\d{0,2})?$"#, options: .regularExpression) != nil else { return nil }
        }
        return (repetitions, kilograms.map { ($0 * 100).rounded() / 100 })
    }
    static func error(reps: String, weight: String) -> String? {
        guard parse(reps: reps, weight: weight) == nil else { return nil }
        let r = reps.trimmingCharacters(in: .whitespacesAndNewlines)
        if !r.isEmpty, Int(r).map({ !(0...999).contains($0) }) ?? true {
            return "Repeticiones inválidas: ingresá un entero entre 0 y 999. Tu borrador no se cambió."
        }
        return "Peso inválido: ingresá entre 0 y 9999,99 kg, con hasta dos decimales. Tu borrador no se cambió."
    }
}

struct NativeSetRow: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.nativeWorkoutControls) private var controls
    let exerciseID: String
    let index: Int
    let saved, previous: NativeSet?
    let targetReps: String?
    var targetWeightKg: Double? = nil
    var earlier: NativeSet? = nil
    let date: String
    let dayID: String?
    var onNewSet: () -> Void = {}
    var emphasized = false
    var seriesGoal: Int? = nil
    @State private var saving = false
    @State private var editing = false
    @State private var reps = ""
    @State private var weight = ""
    @State private var draftEdited = false
    @State private var hydrated = false
    @State private var failure: (message: String, unlog: Bool)?
    @State private var draftFailure: String?
    @State private var identity: NativeWorkoutAction?
    @State private var hydratedContext: NativeWorkoutRowContext?
    @State private var confirmingUnlog = false
    @State private var weightIncrement = 2.5
    @FocusState private var focus: Field?
    private enum Field { case reps, weight }
    private var context: NativeWorkoutRowContext {
        NativeWorkoutRowContext(ownerID: store.auth.session?.user.id, generation: store.auth.generation,
                                date: date, dayID: dayID, exerciseID: exerciseID, index: index)
    }
    private var rowID: String { context.controlID }
    private var isDone: Bool { saved != nil }
    private var signature: String { "\(saved?.id ?? "")|\(saved?.reps ?? -1)|\(saved?.weight_kg ?? -1)" }
    private var suggestion: (reps: Int?, weight: Double?) {
        NativeSetPrefill.values(saved: saved, earlier: earlier, previous: previous,
                                targetReps: FitFormat.targetRepsRange(targetReps)?.lowerBound, targetWeight: targetWeightKg)
    }
    private var suggestionSignature: String { "\(suggestion.reps ?? -1)|\(suggestion.weight ?? -1)" }
    private var changed: Bool {
        guard let saved, let values = NativeWorkoutInput.parse(reps: reps, weight: weight) else { return saved != nil }
        return values.reps != saved.reps || values.weight != saved.weight_kg
    }
    private var status: String {
        let value = store.workoutSyncLabel(exerciseID: exerciseID, index: index, date: date)
        if value == "Sin registrar" { return "" }
        return !isDone && value.hasPrefix("Guardado en este iPhone") ? "Serie quitada · \(value)" : value
    }
    private var registerTitle: String { isDone ? "Guardar corrección" : "Registrar serie \(index + 1)" }
    private var summary: String {
        let repetitions = reps.isEmpty ? "sin repeticiones" : "\(reps) repeticiones"
        let kilograms = weight.isEmpty ? "sin carga" : "\(weight.replacingOccurrences(of: ".", with: ",")) kg"
        return "\(repetitions) · \(kilograms)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !emphasized { Text("Serie \(index + 1)").font(.fit(.sm, .semibold)) }
            if !isDone || editing || draftEdited {
                // Two 44-point adjustment buttons plus a readable numeric field
                // cannot fit twice across an iPhone card, even at normal text size.
                VStack(spacing: 12) {
                    numericField("Repeticiones", text: $reps, field: .reps, decimal: false, step: 1)
                    numericField("Carga en kg", text: $weight, field: .weight, decimal: true, step: weightIncrement)
                }
                Menu {
                    Picker("Incremento de carga", selection: Binding(get: { weightIncrement }, set: { value in
                        guard hydratedContext == context, identity?.isCurrent(in: store.auth) == true else { return }
                        weightIncrement = NativeWorkoutWeightIncrement.normalized(value)
                        NativeWorkoutWeightIncrement.save(value, ownerID: context.ownerID, exerciseID: exerciseID)
                    })) {
                        ForEach(NativeWorkoutWeightIncrement.choices, id: \.self) { value in
                            Text("\(FitFormat.decimal(value)) kg").tag(value)
                        }
                    }
                } label: {
                    Text("Ajuste rápido: ±\(FitFormat.decimal(weightIncrement)) kg").fitMinimumHitArea()
                }.fitLink().disabled(saving)
                    .accessibilityHint("Se recuerda para este ejercicio y tu cuenta. También podés escribir cualquier carga.")
                if !isDone { provenance }
                if draftEdited || changed {
                    Text("Borrador: todavía no registrado. Tocá \(registerTitle.lowercased()) para confirmar.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }
                if !emphasized || controls == nil {
                    Button(action: register) {
                        HStack {
                            if saving { ProgressView().tint(FitColor.accentInk) }
                            Text(saving ? "Registrando…" : registerTitle)
                        }
                    }
                    .buttonStyle(FitButtonStyle(variant: .primary, size: emphasized ? .gym : .md, fullWidth: true))
                    .disabled(saving)
                }
                if editing || draftEdited {
                    Button("Descartar cambios", action: discardDraft)
                        .buttonStyle(FitButtonStyle(variant: .quietMuted, size: .sm)).disabled(saving)
                }
            } else {
                Text(summary).font(.fit(.base, .semibold)).monospacedDigit()
                Button("Corregir valores") { editing = true; focus = .reps }
                    .buttonStyle(FitButtonStyle(size: .sm)).disabled(saving)
            }
            if !status.isEmpty {
                Label(status, systemImage: "arrow.triangle.2.circlepath")
                    .font(.fit(.sm)).foregroundStyle(FitColor.ink2)
                    .accessibilityElement(children: .combine)
            }
            if isDone {
                Button("Quitar esta serie", role: .destructive) { confirmingUnlog = true }
                    .buttonStyle(FitButtonStyle(variant: .danger, size: .sm)).disabled(saving)
                    .accessibilityLabel("Quitar la serie \(index + 1) de \(store.exercise(exerciseID)?.name ?? "este ejercicio")")
            }
            if let failure {
                FitErrorNote(title: failure.unlog ? "No se quitó la serie" : "No se pudo registrar la serie", message: failure.message)
                Button("Reintentar") {
                    if failure.unlog { remove() } else { register() }
                }.buttonStyle(FitButtonStyle(size: .sm)).disabled(saving)
            }
            if let draftFailure {
                FitErrorNote(title: "No se pudo conservar el borrador en el dispositivo", message: draftFailure)
                Button("Reintentar conservar borrador", action: persistDraft).buttonStyle(FitButtonStyle(size: .sm))
            }
        }
        .padding(12)
        .background(emphasized ? FitColor.surface2 : FitColor.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(emphasized ? FitColor.lineStrong : FitColor.line))
        .onAppear { hydrate(); publishControl() }
        .onChange(of: context) { _, _ in hydrate(force: true); publishControl() }
        .onChange(of: reps) { _, _ in edited() }
        .onChange(of: weight) { _, _ in edited() }
        .onChange(of: saving) { _, _ in publishControl() }
        .onChange(of: failure?.message) { _, _ in publishControl() }
        .onChange(of: failure?.unlog) { _, _ in publishControl() }
        .onChange(of: draftFailure) { _, _ in publishControl() }
        .onReceive(NotificationCenter.default.publisher(for: NativeWorkoutWeightIncrement.didChange)) { notification in
            guard hydratedContext == context, identity?.isCurrent(in: store.auth) == true,
                  notification.object as? String == NativeWorkoutWeightIncrement.key(ownerID: context.ownerID, exerciseID: exerciseID) else { return }
            weightIncrement = NativeWorkoutWeightIncrement.read(ownerID: context.ownerID, exerciseID: exerciseID)
        }
        .onChange(of: suggestionSignature) { _, _ in refreshUntouchedSuggestion() }
        .onChange(of: signature) { _, _ in
            if focus == nil, !draftEdited, !saving { hydrate(force: true) }
            publishControl()
        }
        .onChange(of: focus) { _, new in
            if new != nil {
                controls?.keyboardRowID = rowID
                controls?.dismissKeyboard = { focus = nil }
            } else {
                if draftEdited { persistDraft() }
                else { refreshUntouchedSuggestion() }
                if controls?.keyboardRowID == rowID { controls?.dismissKeyboard = nil; controls?.keyboardRowID = nil }
            }
        }
        .onDisappear {
            if draftEdited { persistDraft() }
            let oldID = hydratedContext?.controlID ?? rowID
            controls?.clear(oldID)
            if controls?.keyboardRowID == oldID { controls?.dismissKeyboard = nil; controls?.keyboardRowID = nil }
        }
        .confirmationDialog("¿Quitar la serie \(index + 1)?", isPresented: $confirmingUnlog, titleVisibility: .visible) {
            Button("Quitar serie", role: .destructive, action: remove)
            Button("Cancelar", role: .cancel) { }
        } message: { Text("Deja de contar como registrada. Podés deshacerlo desde este entrenamiento.") }
    }

    private func numericField(_ title: String, text: Binding<String>, field: Field, decimal: Bool, step: Double) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.fit(.sm, .medium))
            HStack(spacing: 8) {
                Button { increment(text, amount: -step, decimal: decimal) } label: {
                    Image(systemName: "minus").fitMinimumHitArea()
                }.buttonStyle(FitButtonStyle(size: .sm)).accessibilityLabel("Reducir \(title.lowercased()) en \(FitFormat.decimal(step))")
                TextField(title, text: text, prompt: fitPrompt(decimal ? "kg" : "repeticiones"))
                    .fitNumericInput(allowsDecimal: decimal).focused($focus, equals: field)
                    .fitField(fill: FitColor.surface, size: .base, centered: true)
                    .accessibilityLabel("\(title) de la serie \(index + 1)")
                Button { increment(text, amount: step, decimal: decimal) } label: {
                    Image(systemName: "plus").fitMinimumHitArea()
                }.buttonStyle(FitButtonStyle(size: .sm)).accessibilityLabel("Aumentar \(title.lowercased()) en \(FitFormat.decimal(step))")
            }.disabled(saving)
            if let error = NativeWorkoutInput.error(reps: reps, weight: weight), draftEdited,
               (field == .reps ? error.hasPrefix("Repeticiones") : error.hasPrefix("Peso")) {
                Text(error).font(.fit(.sm)).foregroundStyle(FitColor.warn)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var provenance: some View {
        if let earlier {
            Text("Serie anterior de hoy: \(earlier.reps.map { "\($0) repeticiones" } ?? "sin repeticiones") · \(earlier.weight_kg.map { "\(FitFormat.decimal($0)) kg" } ?? "sin carga").")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
        } else if let previous {
            Text("Última vez, serie \(index + 1): \(previous.reps.map { "\($0) repeticiones" } ?? "sin repeticiones") · \(previous.weight_kg.map { "\(FitFormat.decimal($0)) kg" } ?? "sin carga").")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
        }
        if earlier?.weight_kg == nil, let targetWeightKg {
            Text("Carga sugerida por tu rutina: \(FitFormat.decimal(targetWeightKg)) kg. Podés ajustarla.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
        } else if earlier == nil, previous != nil {
            Text("Valores sugeridos de la sesión anterior; revisalos antes de registrar.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
        }
    }

    private func hydrate(force: Bool = false) {
        if hydratedContext != context {
            if hydrated, draftEdited { persistDraft() }
            if let oldID = hydratedContext?.controlID { controls?.clear(oldID) }
            hydrated = false; draftEdited = false; editing = false; saving = false
            focus = nil; failure = nil; draftFailure = nil
            identity = NativeWorkoutAction(auth: store.auth)
            hydratedContext = context
            weightIncrement = NativeWorkoutWeightIncrement.read(ownerID: context.ownerID, exerciseID: exerciseID)
        }
        guard !hydrated || force else { return }
        if let identity, !identity.isCurrent(in: store.auth) { return }
        if identity == nil { identity = NativeWorkoutAction(auth: store.auth) }
        hydrated = false
        if let draft = store.workoutDraft(date: date, dayID: dayID, exerciseID: exerciseID, index: index) {
            reps = draft.repsText; weight = draft.weightText
            draftEdited = true; editing = isDone
        } else {
            reps = suggestion.reps.map(String.init) ?? ""
            weight = suggestion.weight.map(FitFormat.plain) ?? ""
            draftEdited = false
        }
        hydrated = true
    }
    private func edited() {
        guard hydrated, hydratedContext == context, identity?.isCurrent(in: store.auth) == true else { return }
        // onChange may observe hydration after its transaction; compare against actual
        // saved/suggested values rather than claiming the initial prefill is an edit.
        let baseReps = suggestion.reps
        let baseWeight = suggestion.weight
        if !draftEdited, reps == (baseReps.map(String.init) ?? ""), weight == (baseWeight.map(FitFormat.plain) ?? "") {
            publishControl(); return
        }
        draftEdited = true
        persistDraft(); publishControl()
    }
    private func refreshUntouchedSuggestion() {
        // A learned routine load is only a prefill, never a correction or an edit.
        // Rehydration checks the durable draft first, including drafts persisted
        // elsewhere after this row mounted. Saved nil must stay explicitly blank.
        guard hydrated, hydratedContext == context, identity?.isCurrent(in: store.auth) == true,
              saved == nil, !draftEdited, !editing, !saving, focus == nil else { return }
        hydrate(force: true)
        publishControl()
    }
    private func persistDraft() {
        guard hydrated, let draftContext = hydratedContext, let action = identity, action.isCurrent(in: store.auth) else { return }
        do {
            try draftContext.persistDraft(in: store, action: action, repsText: reps, weightText: weight)
            draftFailure = nil
        } catch { draftFailure = error.localizedDescription }
    }
    private func discardDraft() {
        guard !saving, hydratedContext == context, identity?.isCurrent(in: store.auth) == true else { return }
        do {
            try store.clearWorkoutDraft(date: date, dayID: dayID, exerciseID: exerciseID, index: index)
            focus = nil; editing = false; draftEdited = false; draftFailure = nil; failure = nil
            hydrate(force: true)
            publishControl()
        } catch { draftFailure = error.localizedDescription }
    }
    private func increment(_ text: Binding<String>, amount: Double, decimal: Bool) {
        guard text.wrappedValue.isEmpty || nativeNumber(text.wrappedValue) != nil else {
            failure = ("Corregí el número antes de usar + o −. Se conserva el texto que ingresaste.", false); return
        }
        let old = nativeNumber(text.wrappedValue) ?? 0
        let limit = decimal ? 9999.99 : 999.0
        let next = old + amount
        guard (0...limit).contains(next) else {
            failure = ("El ajuste queda fuera del rango permitido. No se cambió el valor.", false); return
        }
        text.wrappedValue = FitFormat.plain(decimal ? next : next.rounded())
    }
    private func publishControl() {
        guard emphasized, hydrated, hydratedContext == context, identity?.isCurrent(in: store.auth) == true else { return }
        guard !isDone || editing || draftEdited else { controls?.clear(rowID); return }
        controls?.rowID = rowID
        controls?.title = registerTitle
        controls?.summary = summary
        let name = store.exercise(exerciseID)?.name ?? exerciseID.replacingOccurrences(of: "_", with: " ")
        controls?.contextLabel = "\(name) · Serie \(index + 1)\(seriesGoal.map { " de \($0)" } ?? "")"
        controls?.errorMessage = failure?.message ?? draftFailure
        if let failure {
            controls?.retryTitle = failure.unlog ? "Reintentar quitar serie" : "Reintentar registro"
            controls?.retry = { if failure.unlog { remove() } else { register() } }
        } else if draftFailure != nil {
            controls?.retryTitle = "Reintentar conservar borrador"
            controls?.retry = persistDraft
        } else {
            controls?.retry = nil
        }
        controls?.saving = saving
        controls?.record = register
    }
    private func register() {
        guard !saving, hydratedContext == context, let action = identity, action.isCurrent(in: store.auth) else { return }
        if let error = NativeWorkoutInput.registrationError(reps: reps, weight: weight, isNew: saved == nil) {
            failure = (error, false)
            persistDraft(); return
        }
        guard let values = NativeWorkoutInput.parse(reps: reps, weight: weight) else { return }
        focus = nil; saving = true; failure = nil
        controls?.localWrites.insert(rowID)
        // Persist before enqueueing. A queue failure must never discard the draft.
        persistDraft()
        let submittedReps = reps, submittedWeight = weight
        let operationContext = context
        Task {
            defer {
                controls?.localWrites.remove(operationContext.controlID)
                if hydratedContext == operationContext { saving = false }
            }
            do {
                try await store.saveWorkoutSet(action: action, exerciseID: exerciseID, index: index,
                                               date: date, dayID: dayID, reps: values.reps, weight: values.weight,
                                               onNewSet: onNewSet)
                try action.check(in: store.auth)
                guard hydratedContext == operationContext, context == operationContext else { return }
                controls?.invalidateUndo()
                if reps == submittedReps && weight == submittedWeight {
                    draftEdited = false; editing = false; draftFailure = nil
                    do { try store.clearWorkoutDraft(date: date, dayID: dayID, exerciseID: exerciseID, index: index) }
                    catch { draftFailure = "La serie fue registrada; no se pudo limpiar su borrador: \(error.localizedDescription)" }
                }
            } catch {
                guard action.isCurrent(in: store.auth), hydratedContext == operationContext, context == operationContext else { return }
                failure = (error.localizedDescription, false)
            }
        }
    }
    private func remove() {
        guard !saving, hydratedContext == context, let saved, let action = identity, action.isCurrent(in: store.auth) else { return }
        saving = true; failure = nil; focus = nil
        controls?.localWrites.insert(rowID)
        let operationContext = context
        Task {
            defer {
                controls?.localWrites.remove(operationContext.controlID)
                if hydratedContext == operationContext { saving = false }
            }
            do {
                try await store.commitWorkoutDeletion(action: action, exerciseID: exerciseID, index: index, date: date, dayID: dayID)
                try action.check(in: store.auth)
                guard hydratedContext == operationContext, context == operationContext else { return }
                if let controls, let token = store.workoutMutationToken(date: date, exerciseID: exerciseID, index: index) {
                    controls.invalidateUndo()
                    controls.undoToken = token
                    controls.undoContext = operationContext
                    controls.undoAction = action
                    controls.undoLabel = "Serie \(index + 1) quitada"
                    controls.undo = {
                        controls.validateUndo(in: store)
                        guard controls.undoToken == token, action.isCurrent(in: store.auth) else { return }
                        guard !controls.undoing else { return }
                        controls.undoing = true
                        Task {
                            defer { if controls.undoToken == token || controls.undoToken == nil { controls.undoing = false } }
                            do {
                                try await store.commitWorkoutUndo(action: action, exerciseID: operationContext.exerciseID,
                                                                  index: operationContext.index, date: operationContext.date,
                                                                  dayID: operationContext.dayID, reps: saved.reps,
                                                                  weight: saved.weight_kg, expectedToken: token)
                                try action.check(in: store.auth)
                                if controls.undoToken == token { controls.invalidateUndo() }
                            } catch {
                                if action.isCurrent(in: store.auth) {
                                    controls.validateUndo(in: store)
                                    store.error = "No se pudo deshacer: \(error.localizedDescription)"
                                }
                            }
                        }
                    }
                    controls.validateUndo(in: store)
                }
                editing = false
            } catch {
                if action.isCurrent(in: store.auth), hydratedContext == operationContext, context == operationContext {
                    failure = (error.localizedDescription, true)
                }
            }
        }
    }
}

