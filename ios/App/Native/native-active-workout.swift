import Foundation
import CryptoKit

/// Private, durable session data. App Group files only contain its public presentation.
/// A frozen plan makes edits to a routine apply to the next workout, not this one.
struct NativeActiveWorkout: Codable {
    static let schema = 1
    var schemaVersion = schema
    var id = UUID().uuidString
    var revision = UUID().uuidString
    let attributes: F1tWorkoutAttributes
    let startedAt: Date
    var updatedAt: Date
    var plan: [NativeRoutineExercise]
    var exerciseNames: [String: String]
    var past: [NativeSet]
    var confirmedSets: [NativeSet]
    var currentExerciseID: String?
    var restEndsAt: Date?
    var lastExerciseName: String?
    var lastRestSetKey: String? = nil
    var dismissedActivity = false

    func matches(_ attributes: F1tWorkoutAttributes) -> Bool {
        self.attributes.ownerID == attributes.ownerID &&
        self.attributes.sessionDate == attributes.sessionDate &&
        self.attributes.dayID == attributes.dayID
    }

    func isValid(for owner: String) -> Bool {
        schemaVersion == Self.schema && attributes.ownerID == owner &&
        UUID(uuidString: id) != nil && UUID(uuidString: revision) != nil &&
        NativeDate.parse(attributes.sessionDate) != nil &&
        !plan.isEmpty && plan.count <= 200 &&
        plan.allSatisfy { $0.user_id == owner && $0.target_sets.map { (0...999).contains($0) } != false } &&
        confirmedSets.allSatisfy { $0.user_id == owner } &&
        past.allSatisfy { $0.user_id == owner } &&
        (currentExerciseID == nil || plan.contains { $0.exercise_id == currentExerciseID }) &&
        (restEndsAt == nil || restEndsAt!.timeIntervalSince1970.isFinite)
    }

    mutating func changed(now: Date = Date()) {
        revision = UUID().uuidString
        updatedAt = now
    }

    /// Session-only substitution. Historical sets remain intact; never repurpose
    /// a logged exercise or transfer machine-specific weight/instructions.
    mutating func substituteExercise(_ currentID: String, with replacement: NativeExercise,
                                     previous: [NativeSet]) throws {
        guard currentExerciseID == currentID,
              let index = plan.firstIndex(where: { $0.exercise_id == currentID }) else {
            throw NativeWorkoutSubstitutionError.changed
        }
        guard replacement.id != currentID, !plan.contains(where: { $0.exercise_id == replacement.id }) else {
            throw NativeWorkoutSubstitutionError.duplicate
        }
        guard !confirmedSets.contains(where: { $0.exercise_id == currentID || $0.exercise_id == replacement.id }) else {
            throw NativeWorkoutSubstitutionError.recorded
        }
        let original = plan[index]
        plan[index] = NativeRoutineExercise(id: original.id, user_id: original.user_id,
            routine_day_id: original.routine_day_id, exercise_id: replacement.id,
            position: original.position, target_sets: original.target_sets,
            target_reps: original.target_reps, notes: nil, target_weight_kg: nil)
        exerciseNames[replacement.id] = replacement.name
        // Keep all frozen history; append only this replacement's owner-scoped
        // history so a suggestion can never reuse the old machine's load.
        let knownIDs = Set(past.map(\.id))
        past += previous.filter {
            $0.user_id == attributes.ownerID && $0.exercise_id == replacement.id && !knownIDs.contains($0.id)
        }
        currentExerciseID = replacement.id
        changed()
    }
}

enum NativeWorkoutSubstitutionError: LocalizedError {
    case changed, duplicate, recorded, draft, unavailable
    var errorDescription: String? {
        switch self {
        case .changed: "El ejercicio cambió. Elegí de nuevo desde el entrenamiento actual."
        case .duplicate: "Elegí otro ejercicio que no esté ya en este entrenamiento."
        case .recorded: "No se puede sustituir un ejercicio con series registradas. Tu historial se conserva."
        case .draft: "Hay una serie sin confirmar. Guardala o descartá sus cambios antes de sustituir."
        case .unavailable: "Esperá a que FIT recupere el entrenamiento antes de sustituir el ejercicio."
        }
    }
}

enum NativeActiveWorkoutStorage {
    static func fileURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("f1t-active-workout", isDirectory: true)
            .appendingPathComponent("session.json")
    }

    /// Throw on protected/unavailable storage. Failure must never look like an empty session.
    static func load(from url: URL? = fileURL()) throws -> NativeActiveWorkout? {
        guard let url else { throw CocoaError(.fileNoSuchFile) }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 2_097_152 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return try JSONDecoder().decode(NativeActiveWorkout.self, from: Data(contentsOf: url))
    }

    static func write(_ workout: NativeActiveWorkout, to url: URL? = fileURL()) throws {
        guard let url, workout.isValid(for: workout.attributes.ownerID) else { throw CocoaError(.fileWriteUnknown) }
        let data = try JSONEncoder().encode(workout)
        guard data.count <= 2_097_152 else { throw CocoaError(.fileWriteOutOfSpace) }
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var excluded = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? excluded.setResourceValues(values)
    }

    static func clear(at url: URL? = fileURL()) throws {
        guard let url else { throw CocoaError(.fileNoSuchFile) }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}

/// Performed plans are history, not active sessions. They contain no rest,
/// revision for an action, authentication material or background task state.
struct NativePerformedWorkout: Codable {
    var version = 1
    let ownerID: String
    let sessionDate: String
    let dayID: String?
    let workoutID: String
    let finishedAt: Date
    let plan: [NativeRoutineExercise]

    init(_ workout: NativeActiveWorkout, finishedAt: Date = Date()) {
        ownerID = workout.attributes.ownerID
        sessionDate = workout.attributes.sessionDate
        dayID = workout.attributes.dayID
        workoutID = workout.id
        self.finishedAt = finishedAt
        plan = workout.plan
    }

    func isValid(owner: String, date: String, dayID: String?) -> Bool {
        version == 1 && ownerID == owner && sessionDate == date && self.dayID == dayID &&
        UUID(uuidString: workoutID) != nil && NativeDate.parse(date) != nil &&
        finishedAt.timeIntervalSince1970.isFinite && !plan.isEmpty && plan.count <= 200 &&
        plan.allSatisfy { $0.user_id == owner && $0.target_sets.map { (0...999).contains($0) } != false }
    }
}

enum NativePerformedWorkoutStorage {
    static func directoryURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("f1t-performed-workouts", isDirectory: true)
    }

    private static func opaque(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func dateDirectory(owner: String, date: String, directory: URL?) throws -> URL {
        guard let directory, !owner.isEmpty, NativeDate.parse(date) != nil else { throw CocoaError(.fileNoSuchFile) }
        return directory.appendingPathComponent(opaque(owner), isDirectory: true)
            .appendingPathComponent(opaque(date), isDirectory: true)
    }

    static func load(owner: String, date: String, dayID: String?, directory: URL? = directoryURL()) throws -> NativePerformedWorkout? {
        let url = try dateDirectory(owner: owner, date: date, directory: directory)
            .appendingPathComponent(opaque(dayID ?? "") + ".json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let metadata = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = metadata[.size] as? NSNumber, size.intValue <= 2_097_152 else { throw CocoaError(.fileReadCorruptFile) }
        let value = try JSONDecoder().decode(NativePerformedWorkout.self, from: Data(contentsOf: url))
        guard value.isValid(owner: owner, date: date, dayID: dayID) else { throw CocoaError(.fileReadCorruptFile) }
        return value
    }

    static func write(_ value: NativePerformedWorkout, directory: URL? = directoryURL()) throws {
        guard value.isValid(owner: value.ownerID, date: value.sessionDate, dayID: value.dayID) else { throw CocoaError(.fileWriteUnknown) }
        let folder = try dateDirectory(owner: value.ownerID, date: value.sessionDate, directory: directory)
        let data = try JSONEncoder().encode(value)
        guard data.count <= 2_097_152 else { throw CocoaError(.fileWriteOutOfSpace) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: folder.appendingPathComponent(opaque(value.dayID ?? "") + ".json"),
                       options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        if var root = directory {
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try? root.setResourceValues(values)
        }
    }

    /// A session deletion removes every day-scoped projection for that date.
    /// No expiry sweep: another day, account or older completed session survives.
    static func remove(owner: String, date: String, directory: URL? = directoryURL()) throws {
        let folder = try dateDirectory(owner: owner, date: date, directory: directory)
        if FileManager.default.fileExists(atPath: folder.path) { try FileManager.default.removeItem(at: folder) }
    }
}
