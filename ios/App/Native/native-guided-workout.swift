import SwiftUI

/// The coordinator, not a navigation view, owns exercise selection and rest.
struct NativeGuidedWorkout: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeWorkoutControls) private var controls
    @ObservedObject private var live = NativeLiveActivity.shared
    @AppStorage("native.workout.restMinutes") private var restMinutes = 2.0
    let date: Date
    let dayID: String?
    let plan: [NativeRoutineExercise]
    let done, past: [NativeSet]
    @State private var started = false
    @State private var replacingSession = false
    @State private var confirmingFinish = false
    @State private var identity: NativeWorkoutAction?
    @State private var choosingReplacement = false
    @State private var replacementSourceID: String?

    private var attributes: F1tWorkoutAttributes? {
        guard identity?.isCurrent(in: store.auth) == true, let owner = store.auth.session?.user.id else { return nil }
        return F1tWorkoutAttributes(ownerID: owner, sessionDate: NativeDate.key(date), dayID: dayID,
                                    dayLabel: store.days.first { $0.id == dayID }?.label ?? live.activeAttributes?.dayLabel ?? "Entrenamiento")
    }
    private var isCurrentSession: Bool {
        guard let requested = attributes, let active = live.activeAttributes else { return false }
        return requested.ownerID == active.ownerID && requested.sessionDate == active.sessionDate && requested.dayID == active.dayID
    }
    private var activePlan: [NativeRoutineExercise] {
        if isCurrentSession, let active = live.activeAttributes { return live.activePlan(for: active, store: store) }
        return plan
    }
    private var ids: [String] { NativeWorkoutProgress.ids(activePlan) }
    private var allComplete: Bool { !ids.isEmpty && NativeWorkoutProgress.firstUnfinished(plan: activePlan, sets: done) == nil }
    private var currentID: String? {
        if allComplete { return nil }
        if isCurrentSession, let id = live.currentExerciseID, ids.contains(id) { return id }
        return NativeWorkoutProgress.firstUnfinished(plan: activePlan, sets: done)
    }
    private var signature: [String] {
        done.map { "\($0.id)|\($0.exercise_id)|\($0.set_index)|\($0.reps ?? -1)|\($0.weight_kg ?? -1)" }.sorted()
    }
    private var minutes: Binding<Double> {
        Binding(get: { NativeRestClock.minutes(restMinutes) }, set: { restMinutes = NativeRestClock.minutes($0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !started {
                ProgressView("Recuperando entrenamiento…").fitLoadingAccessibility("Recuperando entrenamiento…")
                if live.activeAttributes != nil, !isCurrentSession {
                    Button("Resolver entrenamiento anterior") { replacingSession = true }
                        .buttonStyle(FitButtonStyle(fullWidth: true))
                }
            } else if let id = currentID, let position = ids.firstIndex(of: id) {
                Text("Ejercicio \(position + 1) de \(ids.count)")
                    .font(.fit(.sm, .semibold)).foregroundStyle(FitColor.muted)
                exerciseHeader(id)
                NativeExerciseLog(exerciseID: id, target: activePlan.first { $0.exercise_id == id },
                                  done: done.filter { $0.exercise_id == id }, past: past.filter { $0.exercise_id == id },
                                  date: NativeDate.key(date), dayID: dayID, guided: true) {
                    if isCurrentSession { live.startRest(store: store, now: Date()) }
                }.id(id)
                if isCurrentSession { rest }
                exerciseNavigation(id)
            } else if allComplete {
                if isCurrentSession, live.restEndsAt != nil { rest }
                Label("Todas las series registradas", systemImage: "checkmark.circle.fill")
                    .font(.fit(.lg, .semibold)).foregroundStyle(FitColor.ok)
                Text("\(ids.count) ejercicios completados.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                NavigationLink("Revisar o corregir series") { NativeWorkoutView(date: date, dayID: dayID, mode: .history) }
                    .buttonStyle(FitButtonStyle(variant: .subtle, fullWidth: true))
                Button("Finalizar entrenamiento") { confirmingFinish = true }
                    .buttonStyle(FitButtonStyle(variant: .primary, size: .gym, fullWidth: true))
                    .disabled(controls?.localWrites.isEmpty == false)
            } else {
                FitEmptyState(title: "No hay ejercicios en este entrenamiento", description: "Tus registros siguen en Progreso.")
            }
            if let message = live.availabilityMessage {
                Text(message).font(.fit(.sm)).foregroundStyle(FitColor.muted).fitCard()
            }
            if started, !allComplete {
                Button("Finalizar por hoy") { confirmingFinish = true }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, fullWidth: true))
                    .disabled(controls?.localWrites.isEmpty == false)
            }
        }
        .task {
            let action = NativeWorkoutAction(auth: store.auth)
            identity = action
            await live.restore(store: store)
            guard !Task.isCancelled, action.isCurrent(in: store.auth), let attributes else { return }
            if live.activeAttributes != nil && !isCurrentSession {
                replacingSession = true
            } else {
                if !allComplete { live.sync(attributes, store: store) }
                started = true
            }
        }
        .onChange(of: signature) { _, _ in
            if started, isCurrentSession, let attributes { live.sync(attributes, store: store) }
        }
        .onReceive(store.accountChanges) { _ in
            if identity?.isCurrent(in: store.auth) != true { controls?.clear(); started = false }
        }
        // Neither navigation, a background transition nor midnight ends an active workout.
        .confirmationDialog("Hay otro entrenamiento en curso", isPresented: $replacingSession, titleVisibility: .visible) {
            Button("Finalizar el anterior y empezar este") {
                live.finishWorkout(store: store)
                if let attributes { live.sync(attributes, store: store) }
                if isCurrentSession { started = true }
            }
            Button("Volver al entrenamiento anterior", role: .cancel) { dismiss() }
        } message: {
            Text("Se conserva lo registrado y termina el descanso anterior.")
        }
        .sheet(isPresented: $confirmingFinish) {
            if let identity {
                NativeWorkoutFinishReview(date: NativeDate.key(date), dayID: dayID, plan: activePlan, action: identity) {
                    confirmingFinish = false
                    finish()
                }.environmentObject(store)
            }
        }
        .sheet(isPresented: $choosingReplacement) {
            if let source = replacementSourceID {
                NativeWorkoutSubstitutePicker(currentID: source, planIDs: Set(ids)) { replacement in
                    guard identity?.isCurrent(in: store.auth) == true, isCurrentSession, currentID == source else {
                        throw NativeFailure.message("El entrenamiento cambió. Volvé al ejercicio actual para sustituirlo.")
                    }
                    try live.substituteExercise(source, with: replacement.id, store: store)
                    controls?.clear()
                }.environmentObject(store)
            }
        }
    }

    private func exerciseHeader(_ id: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.exercise(id)?.name ?? id.replacingOccurrences(of: "_", with: " "))
                .font(.fit(.xl2, .bold)).fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            DisclosureGroup {
                NativeWorkoutExerciseImage(exercise: store.exercise(id)).id(id)
                if let exercise = store.exercise(id) {
                    NativeExerciseTechnique(exercise: exercise)
                    NavigationLink { NativeExerciseDetail(exercise: exercise) } label: {
                        Label("Ver ficha", systemImage: "info.circle").fitMinimumHitArea()
                    }.fitLink()
                }
            } label: {
                Text("Imagen y técnica").fitMinimumHitArea()
            }.font(.fit(.sm)).id(id)
            if let notes = activePlan.first(where: { $0.exercise_id == id })?.notes, !notes.isEmpty {
                DisclosureGroup {
                    Text(notes).foregroundStyle(FitColor.ink2).padding(.top, 4)
                } label: {
                    Text("Notas de rutina").fitMinimumHitArea()
                }.font(.fit(.sm))
            }
        }
    }

    private func exerciseNavigation(_ id: String) -> some View {
        let pending = ids.filter { candidate in
            !NativeWorkoutProgress.complete(target: activePlan.first { $0.exercise_id == candidate }?.target_sets,
                                             indexes: done.filter { $0.exercise_id == candidate }.map(\.set_index))
        }
        let others = pending.filter { $0 != id }
        let next = NativeWorkoutProgress.nextPending(after: id, order: ids, pending: pending)
        let complete = !pending.contains(id)
        return VStack(alignment: .leading, spacing: 8) {
            if !others.isEmpty {
                Button(complete ? "Siguiente ejercicio" : "Hacer este ejercicio después") {
                    guard let next, isCurrentSession else { return }
                    selectExercise(next)
                }.buttonStyle(FitButtonStyle(variant: .subtle, fullWidth: true))
                Menu {
                    ForEach(others, id: \.self) { candidate in
                        Button(store.exercise(candidate)?.name ?? candidate.replacingOccurrences(of: "_", with: " ")) {
                            selectExercise(candidate)
                        }
                    }
                } label: {
                    Label("Elegir otro ejercicio pendiente", systemImage: "list.bullet").fitMinimumHitArea()
                }.buttonStyle(FitButtonStyle(fullWidth: true)).disabled(!isCurrentSession)
            }
            let hasRecordedSets = done.contains { $0.exercise_id == id }
            Button("Sustituir solo en este entrenamiento") {
                replacementSourceID = id; choosingReplacement = true
            }.buttonStyle(FitButtonStyle(variant: .subtle, fullWidth: true))
                .disabled(!isCurrentSession || hasRecordedSets)
            if hasRecordedSets {
                Text("No se puede sustituir con series registradas.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Queda pendiente; no se marca como completado.")
                    Text("Sustituir solo cambia este entrenamiento, no tu rutina. Antes, guardá o descartá los borradores.")
                }.foregroundStyle(FitColor.muted).padding(.top, 4)
            } label: {
                Text("Sobre estos controles").fitMinimumHitArea()
            }.font(.fit(.sm))
        }
    }

    private func selectExercise(_ candidate: String) {
        guard NativeWorkoutSelection.shouldSelect(currentID: currentID, candidate: candidate, isCurrentSession: isCurrentSession) else { return }
        // The coordinator may reject a write. Keep the old CTA until its selection
        // actually changes; new-row appearance publishes the replacement command.
        live.selectExercise(candidate, store: store)
    }

    private var rest: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isCurrentSession, live.restEndsAt != nil, let attributes,
               let previousExercise = live.state(for: attributes, store: store).lastExerciseName {
                Text("Descanso después de \(previousExercise)")
                    .font(.fit(.base, .semibold)).fixedSize(horizontal: false, vertical: true)
            }
            NativeRestPanel(minutes: minutes, clock: NativeRestClock(scope: NativeDate.key(date)),
                            onSkip: { live.omitRest(store: store) }, restEnd: isCurrentSession ? live.restEndsAt : nil,
                            onExtend: { live.extendRest(seconds: 30, store: store) })
        }
    }
    private func finish() {
        guard identity?.isCurrent(in: store.auth) == true else { return }
        if isCurrentSession {
            live.finishWorkout(store: store)
            // A local storage failure keeps the active session. Stay here so its
            // availability message and Finalizar action remain reviewable.
            if isCurrentSession { return }
        }
        controls?.clear()
        dismiss()
    }
}

/// Reviewing a draft never confirms it. Each row retains the explicit register
/// action, and finishing leaves drafts and the local sync queue untouched.
private struct NativeWorkoutFinishReview: View {
    @EnvironmentObject private var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var live = NativeLiveActivity.shared
    @StateObject private var controls = NativeWorkoutControls()
    @State private var reviewReferences: [NativeWorkoutDraftReference] = []
    @State private var reviewingDrafts = false
    let date: String
    let dayID: String?
    let plan: [NativeRoutineExercise]
    let action: NativeWorkoutAction
    let onFinish: () -> Void

    private var logged: [NativeSet] {
        guard action.isCurrent(in: store.auth) else { return [] }
        let session = store.sessions.first { $0.performed_on == date }
        return store.sets.filter { $0.session_id == session?.id }
    }
    private var snapshot: (summary: NativeWorkoutFinishSummary, error: String?) {
        do {
            try action.check(in: store.auth)
            guard let owner = store.auth.session?.user.id else { throw CancellationError() }
            let keys = Array(try store.workoutRepository.read(owner: owner).drafts.keys)
            return (NativeWorkoutFinishSummary(plan: plan, sets: logged, draftKeys: keys, date: date, dayID: dayID), nil)
        } catch {
            return (NativeWorkoutFinishSummary(plan: plan, sets: logged, draftKeys: [], date: date, dayID: dayID),
                    "No se pudieron revisar los borradores locales. No se borrarán al finalizar. \(error.localizedDescription)")
        }
    }

    var body: some View {
        let data = snapshot
        NavigationStack {
            FitPage(refreshable: false) {
                FitPageHeader(title: "Finalizar por hoy", subtitle: "Revisá lo que queda guardado", showsBack: true)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Series registradas: \(data.summary.confirmedSets)").font(.fit(.lg, .semibold))
                    Text("Ejercicios pendientes: \(data.summary.pendingExercises)")
                    if data.error == nil { Text("Borradores sin confirmar: \(data.summary.drafts.count)") }
                    Text("Registrado no significa sincronizado. Los cambios guardados en este iPhone se sincronizan cuando sea posible.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }.fitCard()
                if let error = data.error {
                    FitErrorNote(title: "Revisá tus borradores", message: error).padding(.top, 12)
                }
                if !data.summary.drafts.isEmpty, !reviewingDrafts {
                    Button("Revisar borradores antes de finalizar") {
                        guard action.isCurrent(in: store.auth) else { return }
                        reviewReferences = data.summary.drafts
                        reviewingDrafts = true
                    }.buttonStyle(FitButtonStyle(variant: .subtle, fullWidth: true)).padding(.top, 16)
                }
                if reviewingDrafts, action.isCurrent(in: store.auth) {
                    Text("Borradores: solo se registran si tocás Registrar o Guardar corrección.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 16)
                    // Keep rows mounted after a successful save so publication
                    // cannot remount a stale draft or lose correction feedback.
                    ForEach(reviewReferences) { reference in
                        draftRow(reference).padding(.top, 12)
                    }
                }
                Text("Finalizar termina el descanso y la actividad en vivo. Conserva registros y borradores; no completa ejercicios pendientes.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 16)
                Button(data.summary.drafts.isEmpty && data.error == nil ? "Finalizar y conservar registros" : "Finalizar conservando registros y borradores") {
                    guard action.isCurrent(in: store.auth) else { return }
                    onFinish()
                }.buttonStyle(FitButtonStyle(variant: .primary, size: .gym, fullWidth: true))
                    .disabled(!controls.localWrites.isEmpty || controls.undoing).padding(.top, 12)
                Button("Seguir entrenando") { dismiss() }
                    .buttonStyle(FitButtonStyle(variant: .quietMuted, fullWidth: true)).padding(.top, 8)
            }
            .environment(\.nativeWorkoutControls, controls)
            .fitKeyboardDone { controls.dismissKeyboard?() }
            .safeAreaInset(edge: .bottom) {
                if let label = controls.undoLabel {
                    HStack {
                        Text(label).font(.fit(.sm))
                        Spacer(minLength: 8)
                        Button(controls.undoing ? "Deshaciendo…" : "Deshacer") { controls.undo?() }
                            .buttonStyle(FitButtonStyle(size: .sm)).disabled(controls.undoing)
                    }.padding(12).background(FitColor.surface2)
                }
            }
        }
        .onChange(of: store.workoutSyncRevision) { _, _ in controls.validateUndo(in: store) }
        .onReceive(store.accountChanges) { _ in
            if !action.isCurrent(in: store.auth) { controls.clear(); dismiss() }
        }
        .onDisappear { controls.clear() }
    }

    private func draftRow(_ reference: NativeWorkoutDraftReference) -> some View {
        let target = plan.first { $0.exercise_id == reference.exerciseID }
        let past = store.previousSets(dayID: dayID, before: date)
        return VStack(alignment: .leading, spacing: 8) {
            Text(store.exercise(reference.exerciseID)?.name ?? reference.exerciseID.replacingOccurrences(of: "_", with: " "))
                .font(.fit(.base, .semibold))
            NativeSetRow(exerciseID: reference.exerciseID, index: reference.index,
                         saved: logged.first { $0.exercise_id == reference.exerciseID && $0.set_index == reference.index },
                         previous: past.first { $0.exercise_id == reference.exerciseID && $0.set_index == reference.index },
                         targetReps: target?.target_reps, targetWeightKg: target?.target_weight_kg,
                         earlier: logged.filter { $0.exercise_id == reference.exerciseID && $0.set_index < reference.index }
                            .max { $0.set_index < $1.set_index },
                         date: date, dayID: dayID, onNewSet: {
                guard action.isCurrent(in: store.auth), let active = live.activeAttributes,
                      active.sessionDate == date, active.dayID == dayID else { return }
                live.startRest(store: store)
            })
        }
    }
}

/// Bundled images render immediately, including offline; no detail navigation is required.
private struct NativeWorkoutExerciseImage: View {
    let exercise: NativeExercise?
    @State private var zoomed = false

    var body: some View {
        if let exercise, let path = exercise.images.first,
           let image = FitImageCache.image(path, maxPixelSize: 800) {
            Button { zoomed = true } label: {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
                    .frame(height: 176)
                    .background(FitColor.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Ampliar imagen de \(exercise.name)")
            .accessibilityHint("Muestra la posición inicial.")
            .fullScreenCover(isPresented: $zoomed) {
                NativeImageLightbox(path: path, label: "\(exercise.name): posición inicial")
            }
        } else {
            Text("Imagen no disponible")
                .font(.fit(.sm))
                .foregroundStyle(FitColor.muted)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(12)
                .background(FitColor.surface2, in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

/// Selection is reviewed before the coordinator writes its frozen, session-local
/// plan. The runtime rechecks drafts, recorded sets and duplicate exercises.
private struct NativeWorkoutSubstitutePicker: View {
    @EnvironmentObject private var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    let currentID: String
    let planIDs: Set<String>
    let onSelect: (NativeExercise) throws -> Void
    @State private var query = ""
    @State private var muscle: String?
    @State private var equipment: String?
    @State private var selectedID: String?
    @State private var failure: String?
    @State private var committing = false
    @State private var identity: NativeWorkoutAction?

    private var candidates: [NativeExercise] { store.exercises.filter { !planIDs.contains($0.id) } }
    private var results: [NativeExercise] { FitCatalogSearch.filter(candidates, query: query, muscle: muscle, equipment: equipment) }
    private var selected: NativeExercise? { candidates.first { $0.id == selectedID } }
    private var muscles: [String] {
        let available = Set(candidates.flatMap(\.primary_muscles))
        return FitLabels.muscleOrder.filter { available.contains($0) }
    }
    private var equipmentNames: [String] { Set(candidates.compactMap(\.equipment)).sorted() }

    var body: some View {
        NavigationStack {
            FitPage(refreshable: false) {
                FitPageHeader(title: "Sustituir ejercicio", subtitle: "Solo para este entrenamiento")
                Text("En lugar de \(store.exercise(currentID)?.name ?? currentID.replacingOccurrences(of: "_", with: " "))")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                Text("Revisá la carga del nuevo ejercicio antes de registrar.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.ink2).padding(.top, 8)
                DisclosureGroup {
                    Text("Conserva las series y repeticiones objetivo, no la carga anterior. No modifica tu rutina ni el historial. Los ejercicios no necesariamente son equivalentes.")
                        .foregroundStyle(FitColor.muted).padding(.top, 4)
                } label: {
                    Text("Qué cambia al sustituir").fitMinimumHitArea()
                }.font(.fit(.sm))
                if let failure {
                    FitErrorNote(title: "No se pudo sustituir el ejercicio", message: failure).padding(.top, 12)
                }
                TextField("Buscar ejercicio", text: $query, prompt: fitPrompt("Nombre o músculo…"))
                    .fitField(size: .base).autocorrectionDisabled().submitLabel(.search).padding(.top, 16)
                    .accessibilityLabel("Buscar ejercicio sustituto")
                Menu {
                    Picker("Músculo principal", selection: $muscle) {
                        Text("Todos los músculos").tag(String?.none)
                        ForEach(muscles, id: \.self) { Text(FitLabels.muscle($0)).tag(Optional($0)) }
                    }
                } label: {
                    Label(muscle.map(FitLabels.muscle) ?? "Todos los músculos", systemImage: "line.3.horizontal.decrease")
                        .fitMinimumHitArea()
                }.buttonStyle(FitButtonStyle(fullWidth: true)).padding(.top, 8)
                Menu {
                    Picker("Equipamiento", selection: $equipment) {
                        Text("Cualquier equipamiento").tag(String?.none)
                        ForEach(equipmentNames, id: \.self) { Text(FitLabels.equipment[$0] ?? $0).tag(Optional($0)) }
                    }
                } label: {
                    Text(equipment.flatMap { FitLabels.equipment[$0] } ?? "Cualquier equipamiento").fitMinimumHitArea()
                }.buttonStyle(FitButtonStyle(fullWidth: true)).padding(.top, 8)
                if let selected {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Elegiste: \(selected.name)").font(.fit(.lg, .semibold)).accessibilityAddTraits(.isHeader)
                        NativeExerciseTechnique(exercise: selected, expanded: true)
                        NavigationLink("Ver imágenes y ficha") { NativeExerciseDetail(exercise: selected) }.fitLink()
                    }.fitCard().padding(.top, 16)
                }
                if results.isEmpty {
                    FitEmptyState(title: "No hay ejercicios con esos filtros", description: "Probá otros filtros. No se incluyen ejercicios ya elegidos.") {
                        Button("Limpiar filtros") { query = ""; muscle = nil; equipment = nil }.fitLink()
                    }.padding(.top, 16)
                } else {
                    Text("\(results.count) ejercicios disponibles").font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 16)
                    LazyVStack(spacing: 8) {
                        ForEach(results) { exercise in
                            Button {
                                selectedID = exercise.id; failure = nil
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(exercise.name).font(.fit(.base, .medium))
                                        Text(exercise.primary_muscles.map(FitLabels.muscle).joined(separator: ", "))
                                            .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: selectedID == exercise.id ? "checkmark.circle.fill" : "circle").accessibilityHidden(true)
                                }.fitMinimumHitArea().fitCard()
                            }.buttonStyle(.plain).accessibilityValue(selectedID == exercise.id ? "Seleccionado" : "Sin seleccionar")
                        }
                    }.padding(.top, 8)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let selected {
                    Button("Confirmar \(selected.name)") { confirm(selected) }
                        .buttonStyle(FitButtonStyle(variant: .primary, size: .gym, fullWidth: true))
                        .disabled(committing).padding(16).background(FitColor.surface)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
            }
        }
        .onAppear { if identity == nil { identity = NativeWorkoutAction(auth: store.auth) } }
        .onReceive(store.accountChanges) { _ in
            if identity?.isCurrent(in: store.auth) != true { selectedID = nil; dismiss() }
        }
    }
    private func confirm(_ exercise: NativeExercise) {
        guard !committing, identity?.isCurrent(in: store.auth) == true else { return }
        committing = true
        defer { committing = false }
        do { try onSelect(exercise); dismiss() }
        catch { failure = error.localizedDescription }
    }
}

