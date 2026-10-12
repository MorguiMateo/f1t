import Foundation
import WidgetKit

enum NativeWidgetSync {
    static func clear() throws {
        guard let url = F1tWidgetStorage.fileURL() else { throw NativeFailure.message("Los widgets no tienen acceso al App Group. Revisá la firma de app y extensión.") }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        try F1tStepsStorage.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }
    @MainActor static func sync(_ store: NativeStore) throws {
        guard let url = F1tWidgetStorage.fileURL() else { throw NativeFailure.message("Los widgets no tienen acceso al App Group. Revisá la firma de app y extensión.") }
        guard store.auth.session != nil else {
            try clear(); return
        }
        // Loading/offline workout state is not a reason to delete device steps.
        guard store.loaded else {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            WidgetCenter.shared.reloadTimelines(ofKind: "F1tWidget")
            return
        }
        let week = (0...6).map { weekday -> F1tWidgetPayload.RoutineDay in
            let day = store.days.first { $0.routine_id == store.active?.id && $0.weekday == weekday }
            let exercises = store.plan(day).prefix(6).map { row in
                F1tWidgetPayload.Exercise(name: store.exercise(row.exercise_id)?.name ?? row.exercise_id,
                                         detail: "\(row.target_sets.map(String.init) ?? "—") × \(row.target_reps ?? "—")")
            }
            return F1tWidgetPayload.RoutineDay(weekday: weekday, label: day?.label, exercises: Array(exercises))
        }
        let today = week[NativeDate.weekday()]
        let payload = F1tWidgetPayload(levels: NativeDate.heatmap(store.sessions).map(\.level), todayLabel: today.label, todayExercises: today.exercises,
                                       streak: NativeDate.streak(store.sessions), schemaVersion: 2, routineWeek: week)
        guard payload.isValid else { throw NativeFailure.message("El contenido del widget no es válido.") }
        let data = try JSONEncoder().encode(payload)
        guard data.count <= 131_072 else { throw NativeFailure.message("El contenido del widget es demasiado grande.") }
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        WidgetCenter.shared.reloadAllTimelines()
    }
}
