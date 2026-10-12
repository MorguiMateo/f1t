import AppIntents
import Foundation

struct F1tLogSetRequest: Sendable, Equatable {
    let ownerID: String
    let sessionDate: String
    let dayID: String?
    let exerciseID: String
    let setIndex: Int
    let reps: Int?
    let weightKg: Double?
    var revision: String? = nil
}

/// The extension compiles this intent to build the button, but a
/// LiveActivityIntent always runs in the app process, which installs the handler.
enum F1tWorkoutIntentBridge {
    @MainActor static var logSet: ((F1tLogSetRequest) async throws -> Void)?
    @MainActor static var changeRest: ((F1tRestRequest) async throws -> Void)?

    @MainActor static func perform(_ request: F1tLogSetRequest) async throws {
        guard let logSet else { throw F1tWorkoutIntentError.unavailable }
        try await logSet(request)
    }
}

enum F1tWorkoutIntentError: LocalizedError {
    case unavailable
    var errorDescription: String? { "Abrí FIT para registrar la serie." }
}

/// "Serie hecha" on the lock screen and Dynamic Island.
struct F1tLogSetIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Serie hecha"
    static var description = IntentDescription("Registra la serie actual del entrenamiento guiado.")
    static var isDiscoverable = false

    @Parameter(title: "Cuenta") var ownerID: String
    @Parameter(title: "Fecha") var sessionDate: String
    @Parameter(title: "Día de rutina") var dayID: String?
    @Parameter(title: "Ejercicio") var exerciseID: String
    @Parameter(title: "Serie") var setIndex: Int
    @Parameter(title: "Repeticiones") var reps: Int?
    @Parameter(title: "Peso") var weightKg: Double?
    @Parameter(title: "Versión del entrenamiento") var revision: String?

    init() {}

    init(_ request: F1tLogSetRequest) {
        ownerID = request.ownerID
        sessionDate = request.sessionDate
        dayID = request.dayID
        exerciseID = request.exerciseID
        setIndex = request.setIndex
        reps = request.reps
        weightKg = request.weightKg
        revision = request.revision
    }

    var request: F1tLogSetRequest {
        F1tLogSetRequest(ownerID: ownerID, sessionDate: sessionDate, dayID: dayID, exerciseID: exerciseID,
                         setIndex: setIndex, reps: reps, weightKg: weightKg, revision: revision)
    }

    func perform() async throws -> some IntentResult {
        try await F1tWorkoutIntentBridge.perform(request)
        return .result()
    }
}

struct F1tRestRequest: Sendable {
    enum Action: Sendable { case extend(seconds: Int), skip }
    let ownerID: String
    let sessionDate: String
    let dayID: String?
    let revision: String?
    let action: Action
}

/// Shared intent code contains no UIKit or app-only persistence dependencies.
struct F1tExtendRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Agregar 30 segundos"
    static var isDiscoverable = false
    @Parameter(title: "Cuenta") var ownerID: String
    @Parameter(title: "Fecha") var sessionDate: String
    @Parameter(title: "Día de rutina") var dayID: String?
    @Parameter(title: "Segundos") var seconds: Int
    @Parameter(title: "Versión del entrenamiento") var revision: String?

    init() { seconds = 30 }
    init(ownerID: String, sessionDate: String, dayID: String?, seconds: Int = 30, revision: String? = nil) {
        self.ownerID = ownerID; self.sessionDate = sessionDate; self.dayID = dayID
        self.seconds = seconds; self.revision = revision
    }
    func perform() async throws -> some IntentResult {
        let request = F1tRestRequest(ownerID: ownerID, sessionDate: sessionDate, dayID: dayID,
                                    revision: revision, action: .extend(seconds: seconds))
        try await F1tWorkoutIntentBridge.performRest(request)
        return .result()
    }
}

struct F1tSkipRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Omitir descanso"
    static var isDiscoverable = false
    @Parameter(title: "Cuenta") var ownerID: String
    @Parameter(title: "Fecha") var sessionDate: String
    @Parameter(title: "Día de rutina") var dayID: String?
    @Parameter(title: "Versión del entrenamiento") var revision: String?

    init() {}
    init(ownerID: String, sessionDate: String, dayID: String?, revision: String? = nil) {
        self.ownerID = ownerID; self.sessionDate = sessionDate; self.dayID = dayID; self.revision = revision
    }
    func perform() async throws -> some IntentResult {
        try await F1tWorkoutIntentBridge.performRest(.init(ownerID: ownerID, sessionDate: sessionDate,
                                                        dayID: dayID, revision: revision, action: .skip))
        return .result()
    }
}

extension F1tWorkoutIntentBridge {
    @MainActor static func performRest(_ request: F1tRestRequest) async throws {
        guard let changeRest else { throw F1tWorkoutIntentError.unavailable }
        try await changeRest(request)
    }
}
