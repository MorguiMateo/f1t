import SwiftUI

// MARK: - Hoy

struct NativeTodayView: View {
    @EnvironmentObject private var store: NativeStore
    @ObservedObject private var live = NativeLiveActivity.shared
    @State private var now = Date()
    @State private var path: [NativeRoutineRoute] = []
    private var active: F1tWorkoutAttributes? {
        live.activeAttributes.flatMap { $0.ownerID == store.auth.session?.user.id ? $0 : nil }
    }
    var body: some View {
        NavigationStack(path: $path) {
            FitPage {
                FitPageHeader(title: "Hoy", subtitle: FitFormat.longDay(now))
                if let active {
                    let state = live.state(for: active, store: store)
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Entrenamiento en curso", systemImage: "figure.strengthtraining.traditional")
                            .font(.fit(.base, .semibold))
                        Text(active.dayLabel).font(.fit(.lg, .bold))
                        if active.sessionDate != NativeDate.key(now) {
                            Text("Empezado el \(FitFormat.fieldDay(NativeDate.parse(active.sessionDate) ?? now)). Conserva esa fecha.")
                                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        }
                        Text("\(state.completedSets) de \(state.plannedSets) series previstas registradas")
                            .font(.fit(.sm)).monospacedDigit()
                        if state.phase != .finished {
                            Text("Ejercicio \(state.exerciseNumber) de \(state.exerciseCount) · \(state.exerciseName)")
                                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        }
                        if let status = state.syncStatus {
                            Text(status).font(.fit(.xs)).foregroundStyle(FitColor.muted)
                        }
                        NativeRoutineLink(route: .workout(date: NativeDate.parse(active.sessionDate) ?? now, dayID: active.dayID, guided: true)) {
                            Text(state.phase == .finished ? "Revisar y finalizar entrenamiento" : "Retomar entrenamiento").frame(minHeight: 32)
                        }
                        .buttonStyle(FitButtonStyle(variant: .primary, size: .gym, fullWidth: true))
                    }.fitCard().padding(.bottom, 16)
                    if let notice = state.notice {
                        Text(notice).font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.bottom, 12)
                    }
                    if NativeTodaySelection.showScheduledPlan(activeDate: active.sessionDate, activeDayID: active.dayID, dateKey: NativeDate.key(now), scheduledDayID: store.day(on: now)?.id) {
                        NativeTodayRoutine(date: now, secondary: true)
                    }
                } else {
                    NativeTodayRoutine(date: now)
                }
                NativeStepsView().padding(.top, 16)
            }
            .navigationDestination(for: NativeRoutineRoute.self) { NativeRoutineDestination(route: $0) }
        }
        .environment(\.nativeRoutineNavigation, NativeRoutineNavigation(push: { path.append($0) }))
        .fitTabRoot(isDirty: store.busy) { path.removeAll() }
        .onChange(of: store.auth.generation) { _, _ in path = [] }
        .task { await live.restore(store: store) }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("nativeDateRollover"))) { _ in now = Date() }
    }
}

/// An active workout owns the primary action, even across midnight.
enum NativeTodaySelection {
    static func showScheduledPlan(activeDate: String, activeDayID: String?, dateKey: String, scheduledDayID: String?) -> Bool {
        activeDate != dateKey || activeDayID != scheduledDayID
    }
    static func dayID(hasSession: Bool, sessionDayID: String?, scheduledDayID: String?) -> String? {
        hasSession ? sessionDayID : scheduledDayID
    }
}



struct NativeTodayRoutine: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.fitSelectTab) private var selectTab
    @ObservedObject private var live = NativeLiveActivity.shared
    let date: Date
    var secondary = false

    var body: some View {
        NativeDataStatus()
        let owner = store.auth.session?.user.id
        let session = secondary ? nil : store.sessions.first { $0.user_id == owner && $0.performed_on == NativeDate.key(date) }
        // Existing sessions never silently fall back to another weekday's plan.
        let dayID = NativeTodaySelection.dayID(hasSession: session != nil, sessionDayID: session?.routine_day_id, scheduledDayID: store.day(on: date)?.id)
        let day = dayID.flatMap { id in store.days.first { $0.user_id == owner && $0.id == id } }
        if let day {
            dayBlock(day, session: session)
        } else if session != nil {
            FitEmptyState(title: "Ya hay un entrenamiento registrado hoy", description: "Su día ya no está disponible. Tus series siguen guardadas en Progreso.") {
                Button("Revisar registros") { selectTab(.progress) }.fitLink()
            }
        } else if let routine = store.active {
            let days = store.days(of: routine.id)
            if days.isEmpty {
                FitEmptyState(title: "\"\(routine.name)\" no tiene días", description: "Elegí en qué días de la semana entrenás y qué toca en cada uno.") {
                    NativeRoutineLink("Armar la semana", route: .routine(routine.id)).fitLink()
                }
            } else {
                rest(routine: routine, days: days)
            }
        } else if !store.loaded {
            NativePendingContent(count: 1)
        } else {
            FitEmptyState(title: "Todavía no hay rutina activa", description: "Armá una rutina, asignale días de la semana y acá va a aparecer lo que te toca entrenar.") {
                Button("Ir a mis rutinas") { selectTab(.routines) }.fitLink()
            }
        }
    }

    @ViewBuilder private func dayBlock(_ day: NativeRoutineDay, session: NativeWorkoutSession?) -> some View {
        let frozen = live.activeAttributes.flatMap { active -> F1tWorkoutAttributes? in
            active.ownerID == store.auth.session?.user.id && active.sessionDate == NativeDate.key(date) && active.dayID == day.id ? active : nil
        }
        let performed = secondary ? nil : live.performedPlan(date: NativeDate.key(date), dayID: day.id, store: store)
        let items = frozen.map { live.activePlan(for: $0, store: store) } ?? performed ?? store.plan(day)
        if items.isEmpty {
            VStack(spacing: 4) {
                Text("\(day.label) sin ejercicios").font(.fit(.base, .semibold))
                Text("Este día existe en la rutina pero está vacío.").font(.fit(.sm)).foregroundStyle(FitColor.muted).multilineTextAlignment(.center)
                NativeRoutineLink("Agregar ejercicios", route: .day(day.id, initiallyAdding: false)).fitLink().padding(.top, 8)
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            .background(FitColor.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(FitColor.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
            let count = NativeWorkoutProgress.ids(items).count
            let totalSets = NativeWorkoutProgress.ids(items).reduce(0) { sum, id in sum + NativeWorkoutProgress.goal(items.first { $0.exercise_id == id }?.target_sets) }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(day.label).font(.fit(.lg, .semibold))
                Spacer()
                Text("\(count) \(count == 1 ? "ejercicio" : "ejercicios")\(totalSets > 0 ? " · \(totalSets) series" : "")")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
            }
            let sets = store.sets.filter { $0.session_id == session?.id }
            let allComplete = NativeWorkoutProgress.firstUnfinished(plan: items, sets: sets) == nil
            let finished = allComplete || performed != nil
            let logged = sets.count
            if allComplete {
                Label("Todas las series registradas", systemImage: "checkmark.circle.fill")
                    .font(.fit(.sm, .semibold)).foregroundStyle(FitColor.ok).padding(.top, 12)
            } else if performed != nil {
                Text("Finalizado por hoy · \(logged) series registradas de \(totalSets) previstas")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 12)
            }
            if secondary {
                Text("Plan de hoy · Retomá o finalizá el entrenamiento en curso antes de empezar otro.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 8)
                NativeRoutineLink("Ver plan de hoy", route: .day(day.id, initiallyAdding: false)).fitLink().padding(.top, 8)
            } else {
                if logged > 0 && !finished {
                    Text("\(logged) series registradas · \(totalSets) previstas")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 8)
                }
                NativeRoutineLink(route: .workout(date: date, dayID: day.id, guided: !finished)) {
                    Text(finished ? "Revisar entrenamiento" : logged > 0 ? "Retomar entrenamiento" : "Empezar entrenamiento")
                        .frame(minHeight: 32)
                }
                .buttonStyle(FitButtonStyle(variant: .primary, size: .gym, fullWidth: true))
                .padding(.top, 16)
                NativeTodayPlanDisclosure(items: items).padding(.top, 8)
                NativeRoutineLink(route: .day(day.id, initiallyAdding: false)) { Text("Editar este día").frame(minHeight: 44) }
                    .fitLink().padding(.top, 4)
            }
        }
    }

    // A weekday with no row in routine_days is a rest day: the data model talking, not an error.
    private func rest(routine: NativeRoutine, days: [NativeRoutineDay]) -> some View {
        let next = NativeWorkoutSelection.next(after: date, in: days)
        return VStack(spacing: 0) {
            Text("Hoy toca descansar").font(.fit(.lg, .semibold))
            Text(next.map { "Lo próximo es \($0.day.label), \(NativeWorkoutSelection.when($0.inDays, weekday: $0.day.weekday))." } ?? "No hay más días cargados en esta rutina.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted).multilineTextAlignment(.center).frame(maxWidth: 280).padding(.top, 4)
            NativeRoutineLink("Ver la rutina", route: .routine(routine.id)).fitLink().padding(.top, 12)
            // Slipping the week by a day is common, so pulling the next day forward is one tap.
            if let next, !secondary {
                NativeRoutineLink(route: .workout(date: date, dayID: next.day.id, guided: true)) { Text("Entrenar \(next.day.label) igual") }
                    .buttonStyle(FitButtonStyle(variant: .subtle, fullWidth: true))
                    .padding(.top, 16)
            }
        }
        .padding(20)
        .fitCard(padding: 0, alignment: .center)
    }
}


private struct NativeTodayPlanDisclosure: View {
    @EnvironmentObject private var store: NativeStore
    let items: [NativeRoutineExercise]
    var body: some View {
        DisclosureGroup("Ver ejercicios del plan") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.exercise(item.exercise_id)?.name ?? "Ejercicio").font(.fit(.sm, .medium))
                        Text("\(NativeWorkoutProgress.goal(item.target_sets)) series\(item.target_reps.map { " · \($0) reps" } ?? "")")
                            .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(.top, 8)
        }.font(.fit(.sm)).frame(minHeight: 44)
    }
}
