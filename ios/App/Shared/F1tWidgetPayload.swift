import Foundation

// Shared by the native SwiftUI app and WidgetKit extension. The JSON is the
// top-level WidgetPayload written by device.ts, not a UserDefaults envelope.
enum F1tWidgetStorage {
    static let appGroup = "group.com.morguimateo.f1t"
    static let filename = "widget-payload.json"

    static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(filename)
    }

    static func read() -> F1tWidgetSnapshot? {
        guard let url = fileURL(),
              let data = try? Data(contentsOf: url),
              data.count <= 131_072,
              let payload = try? JSONDecoder().decode(F1tWidgetPayload.self, from: data),
              payload.isValid else { return nil }

        let modifiedAt = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
            .contentModificationDate
        return F1tWidgetSnapshot(payload: payload, modifiedAt: modifiedAt)
    }
}

struct F1tWidgetPayload: Codable {
    struct Exercise: Codable {
        let name: String
        let detail: String
    }

    struct RoutineDay: Codable {
        let weekday: Int
        let label: String?
        let exercises: [Exercise]
    }

    let levels: [Int]
    let todayLabel: String?
    let todayExercises: [Exercise]
    let streak: Int
    let schemaVersion: Int?
    let routineWeek: [RoutineDay]?

    var isValid: Bool {
        levels.count == 26 * 7 &&
        levels.allSatisfy { (0...4).contains($0) } &&
        todayExercises.count <= 6 && streak >= 0 &&
        ((schemaVersion == nil && routineWeek == nil) ||
         (schemaVersion == 2 && routineWeek?.count == 7 &&
          Set(routineWeek?.map(\.weekday) ?? []) == Set(0...6) &&
          routineWeek?.allSatisfy { $0.exercises.count <= 6 } == true))
    }
}

struct F1tWidgetSnapshot {
    let payload: F1tWidgetPayload
    let modifiedAt: Date?

    func routine(at date: Date) -> F1tWidgetPayload.RoutineDay? {
        if payload.schemaVersion == 2 {
            return payload.routineWeek?.first {
                $0.weekday == Calendar.current.component(.weekday, from: date) - 1
            }
        }
        // v1 only describes the write day, so never show it on later dates.
        guard let modifiedAt, Calendar.current.isDate(modifiedAt, inSameDayAs: date) else {
            return nil
        }
        return F1tWidgetPayload.RoutineDay(weekday: Calendar.current.component(.weekday, from: date) - 1,
                                           label: payload.todayLabel, exercises: payload.todayExercises)
    }
}

/// Device-local steps are independent of the workout payload. Syncing a routine
/// must never erase a Motion reading or make yesterday's count look like today.
struct F1tStepsPayload: Codable {
    enum Status: String, Codable {
        case available, notDetermined, denied, restricted, unsupported, unavailable

        var message: String {
            switch self {
            case .available: "Abrí FIT para actualizar"
            case .notDetermined: "Abrí FIT y tocá Consultar para habilitar los pasos"
            case .denied: "Habilitá Movimiento y condición física en Ajustes"
            case .restricted: "El acceso a Movimiento está restringido"
            case .unsupported: "Los pasos requieren un iPhone compatible"
            case .unavailable: "No se pudieron leer los pasos. Abrí FIT para reintentar"
            }
        }
    }

    let schemaVersion: Int
    let ownerID: String
    let dayKey: String
    let timeZoneIdentifier: String
    let sampledAt: Date
    let status: Status
    let steps: Int?

    init(ownerID: String, status: Status, steps: Int? = nil, sampledAt: Date = Date(),
         calendar: Calendar = .current) {
        schemaVersion = 1
        self.ownerID = ownerID
        dayKey = Self.dateKey(sampledAt, calendar: calendar)
        timeZoneIdentifier = calendar.timeZone.identifier
        self.sampledAt = sampledAt
        self.status = status
        self.steps = steps
    }

    static func dateKey(_ date: Date, calendar: Calendar = .current) -> String {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        let parts = gregorian.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    var isValid: Bool {
        guard schemaVersion == 1, !ownerID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              sampledAt.timeIntervalSince1970.isFinite,
              let zone = TimeZone(identifier: timeZoneIdentifier) else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        guard dayKey == Self.dateKey(sampledAt, calendar: calendar) else { return false }
        return status == .available ? steps.map { $0 >= 0 } == true : steps == nil
    }

    func isToday(at date: Date, calendar: Calendar = .current) -> Bool {
        isValid && sampledAt <= date && timeZoneIdentifier == calendar.timeZone.identifier &&
        dayKey == Self.dateKey(date, calendar: calendar)
    }

    func count(at date: Date, calendar: Calendar = .current) -> Int? {
        isToday(at: date, calendar: calendar) && status == .available ? steps : nil
    }

    func needsRefresh(at date: Date, calendar: Calendar = .current) -> Bool {
        !isToday(at: date, calendar: calendar) || date.timeIntervalSince(sampledAt) >= 15 * 60
    }
}

enum F1tStepsStorage {
    static let widgetKind = "F1tStepsWidget"
    static let filename = "steps-today.json"

    enum Failure: LocalizedError {
        case appGroupUnavailable, invalidPayload
        var errorDescription: String? {
            switch self {
            case .appGroupUnavailable: "Los pasos no tienen acceso al App Group. Revisá la firma de app y extensión."
            case .invalidPayload: "La lectura de pasos no es válida."
            }
        }
    }

    static func fileURL() -> URL? {
        F1tWidgetStorage.fileURL()?.deletingLastPathComponent().appendingPathComponent(filename)
    }

    static func read(from url: URL? = fileURL()) -> F1tStepsPayload? {
        guard let url, let data = try? Data(contentsOf: url), data.count <= 4096,
              let payload = try? JSONDecoder().decode(F1tStepsPayload.self, from: data),
              payload.isValid else { return nil }
        return payload
    }

    static func write(_ payload: F1tStepsPayload, to url: URL? = fileURL()) throws {
        guard payload.isValid else { throw Failure.invalidPayload }
        guard let url else { throw Failure.appGroupUnavailable }
        let data = try JSONEncoder().encode(payload)
        guard data.count <= 4096 else { throw Failure.invalidPayload }
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear(at url: URL? = fileURL()) throws {
        guard let url else { throw Failure.appGroupUnavailable }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}
