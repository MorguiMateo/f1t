import ActivityKit
import Foundation

// Shared by the app and the WidgetKit extension. The app publishes the guided
// workout both as a Live Activity and as a small App Group file the widgets read.

/// Static fields identify the session the lock-screen button writes to.
/// ContentState travels through ActivityKit, which caps it at 4 KB.
struct F1tWorkoutAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable { case working, finished }
        var phase: Phase
        var exerciseID: String
        var exerciseName: String
        /// File name inside `F1tThumbnailStorage`, not a path.
        var thumbnail: String?
        /// 0-based index the "Serie hecha" button records.
        var setIndex: Int
        var setNumber: Int
        var totalSets: Int
        var reps: Int?
        var weightKg: Double?
        var exerciseNumber: Int
        var exerciseCount: Int
        var completedSets: Int
        var plannedSets: Int
        var restEndsAt: Date?
        /// Last lock-screen failure, shown until the next successful change.
        var notice: String?
        /// Rotates after every accepted action; old buttons cannot rewrite a newer set.
        var workoutRevision: String? = nil
        var lastExerciseName: String? = nil
        var syncStatus: String? = nil
    }

    let ownerID: String
    let sessionDate: String
    let dayID: String?
    let dayLabel: String

    var workoutURL: URL? {
        var components = URLComponents()
        components.scheme = "f1t"; components.host = "workout"
        components.queryItems = [URLQueryItem(name: "date", value: sessionDate)]
        if let dayID { components.queryItems?.append(URLQueryItem(name: "day", value: dayID)) }
        return components.url
    }
}

extension F1tWorkoutAttributes.ContentState {
    var setLine: String { "Serie \(setNumber) de \(totalSets)" }
    var shortSetLine: String { "Serie \(setNumber)/\(totalSets)" }
    var exerciseLine: String { "Ejercicio \(exerciseNumber) de \(exerciseCount)" }
    var repsLine: String? { reps.map { $0 == 1 ? "1 rep" : "\($0) reps" } }
    var weightLine: String? {
        weightKg.map { "\($0.formatted(.number.precision(.fractionLength(0...2)))) kg" }
    }
    /// The notification-style description: "Serie 2 de 4 · 10 reps · 40 kg".
    var detailLine: String { ([setLine, repsLine, weightLine].compactMap { $0 }).joined(separator: " · ") }
    var progress: Double { plannedSets > 0 ? min(1, Double(completedSets) / Double(plannedSets)) : 0 }
}

enum F1tWorkoutDate {
    /// Local yyyy-MM-dd, the same key the app uses for `performed_on`.
    static func key(_ date: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let p = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
    }
}

/// The in-progress workout for widgets. Unlike the Live Activity, a widget has
/// no lifecycle, so stale files are ignored instead of trusted.
enum F1tLiveWorkoutStorage {
    static let filename = "workout-live.json"
    static let maxAge: TimeInterval = 6 * 60 * 60

    struct Snapshot: Codable {
        let ownerID: String
        let sessionDate: String
        let dayLabel: String
        let state: F1tWorkoutAttributes.ContentState
        let updatedAt: Date
        var dayID: String? = nil
        var currentExerciseID: String? = nil
        var workoutRevision: String? = nil
        var workoutID: String? = nil

        func isCurrent(at now: Date) -> Bool {
            // A clock moved backwards must not keep an old file alive.
            guard updatedAt.timeIntervalSince(now) < 60 else { return false }
            if let workoutID {
                // A versioned, durable session stays active until explicit finish.
                // Its owner runtime clears this file on finish or account invalidation.
                return UUID(uuidString: workoutID) != nil && workoutRevision != nil &&
                    workoutRevision == state.workoutRevision
            }
            // Legacy files have no durable lifecycle: retain their bounded fallback.
            return sessionDate == F1tWorkoutDate.key(now) &&
                now.timeIntervalSince(updatedAt) < F1tLiveWorkoutStorage.maxAge
        }
        /// Also a timeline refresh point; versioned sessions don't expire here.
        var expiresAt: Date { updatedAt.addingTimeInterval(F1tLiveWorkoutStorage.maxAge) }
    }

    static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: F1tWidgetStorage.appGroup)?
            .appendingPathComponent(filename)
    }

    static func write(_ snapshot: Snapshot, to url: URL? = fileURL()) throws {
        guard let url else { throw CocoaError(.fileNoSuchFile) }
        try JSONEncoder().encode(snapshot).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Returns the raw file, current or not; callers decide with `isCurrent`.
    static func load(from url: URL? = fileURL()) -> Snapshot? {
        guard let url, let data = try? Data(contentsOf: url), data.count <= 16_384 else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    static func read(now: Date = Date(), from url: URL? = fileURL()) -> Snapshot? {
        load(from: url).flatMap { $0.isCurrent(at: now) ? $0 : nil }
    }

    static func clear(at url: URL? = fileURL()) {
        guard let url, FileManager.default.fileExists(atPath: url.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

/// Small JPEG copies of catalog photos. Extensions cannot read the app bundle,
/// so the app copies the one it needs into the App Group.
enum F1tThumbnailStorage {
    static let folder = "live-thumbs"

    static func directoryURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: F1tWidgetStorage.appGroup)?
            .appendingPathComponent(folder, isDirectory: true)
    }

    /// Catalog ids are folder-like names; keep only filename-safe characters.
    static func filename(for exerciseID: String) -> String {
        let safe = exerciseID.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" ? Character($0) : "_" }
        return String(safe.prefix(120)) + ".jpg"
    }

    static func url(for filename: String) -> URL? {
        directoryURL()?.appendingPathComponent(filename)
    }

    static func clear() {
        guard let url = directoryURL(), FileManager.default.fileExists(atPath: url.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
