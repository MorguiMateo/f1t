import Foundation

struct NativeRoutine: Codable, Identifiable { let id, user_id, name, created_at: String; let is_active: Bool }
struct NativeRoutineDay: Codable, Identifiable { let id, user_id, routine_id, label: String; let weekday: Int }
struct NativeRoutineExercise: Codable, Identifiable {
    let id, user_id, routine_day_id, exercise_id: String
    let position: Int
    let target_sets: Int?
    let target_reps, notes: String?
    var target_weight_kg: Double? = nil
}
struct NativeExercise: Codable, Identifiable {
    let id, name, category, level: String
    let equipment, force, mechanic: String?
    let primary_muscles, secondary_muscles, instructions, images: [String]
    // Search-only fields; optional so older generated catalogs still decode.
    let name_en: String?
    let aliases: [String]?
}
struct NativeWorkoutSession: Codable, Identifiable {
    let id, user_id, performed_on, created_at: String
    let routine_day_id, notes: String?
    let set_count: Int
}
struct NativeSet: Codable, Identifiable {
    let id, user_id, session_id, exercise_id: String
    let set_index: Int
    let reps: Int?
    let weight_kg: Double?
}
struct NativeWeight: Codable, Identifiable { let id, user_id, measured_on: String; let weight_kg: Double }
struct NativeBodyProfile: Codable, Identifiable {
    var id: String { user_id }
    let user_id, goal, updated_at: String
    let height_cm, target_weight_kg: Double?
    let birth_date, sex: String?
}
struct NativeAuthUser: Codable {
    let id: String
    let email: String?
    var user_metadata: NativeUserMetadata? = nil
}
/// Google profile fields for the account card. Decoding is lenient: odd metadata never breaks a session.
struct NativeUserMetadata: Codable {
    let fullName, avatarURL: String?
    private enum Keys: String, CodingKey { case full_name, name, avatar_url, picture }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        func text(_ key: Keys) -> String? { (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil }
        fullName = text(.full_name) ?? text(.name)
        avatarURL = text(.avatar_url) ?? text(.picture)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encodeIfPresent(fullName, forKey: .full_name)
        try c.encodeIfPresent(avatarURL, forKey: .avatar_url)
    }
}
struct NativeAuthSession: Codable {
    let access_token, refresh_token: String
    let expires_in: Double?
    var expires_at: Double?
    let user: NativeAuthUser
    var expiresAt: Date { Date(timeIntervalSince1970: expires_at ?? 0) }
    mutating func normalizeExpiry() { if expires_at == nil { expires_at = Date().timeIntervalSince1970 + (expires_in ?? 3600) } }
}

func nativeNull<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }
func nativeNumber(_ text: String) -> Double? {
    guard let n = Double(text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")), n.isFinite else { return nil }
    return n
}
func nativeQuery(_ field: String, _ value: String) -> [URLQueryItem] { [URLQueryItem(name: field, value: "eq.\(value)")] }
func nativeResource<T: Decodable>(_ filename: String, as type: T.Type) throws -> T {
    guard let url = Bundle.main.url(forResource: filename, withExtension: nil, subdirectory: "NativeResources") else {
        throw NativeFailure.message("Falta el recurso \(filename). Ejecutá npm run ios:prepare.")
    }
    return try JSONDecoder().decode(type, from: Data(contentsOf: url))
}
