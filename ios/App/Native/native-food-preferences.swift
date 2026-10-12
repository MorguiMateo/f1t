import Combine
import CryptoKit
import Foundation

/// Food reads are independent of training reads. Calculating a new target still
/// needs confirmed profile/weight and activity; a historical day never does.
struct NativeFoodAvailability {
    struct ReadState {
        let loaded: Bool
        let loading: Bool
        let usingCachedData: Bool
        let error: String?
        var confirmed: Bool { loaded && !usingCachedData && error == nil }
    }
    let diary: ReadState
    let body: ReadState
    let activity: ReadState
    var confirmedDiary: Bool { diary.confirmed }
    var canCalculateTarget: Bool { diary.confirmed && body.confirmed && activity.confirmed }
    var targetError: String? { diary.error ?? body.error ?? activity.error }
    func canRegister(hasHistoricalDay: Bool, acceptsNoTarget: Bool) -> Bool {
        diary.loaded && (hasHistoricalDay || canCalculateTarget || acceptsNoTarget)
    }
}

/// A local draft is not a diary record or an energy snapshot. Pending attempts must
/// be checked, never automatically sent again after rebuilding the view.
struct NativeFoodDraft: Codable, Equatable {
    struct Attempt: Codable, Equatable {
        let amount: Double
        let knownIDs: Set<String>
        let catalogVersion: String
    }
    var dateKey: String
    var search: String
    var foodReference: String?
    var quantity: String
    var usePortions: Bool
    var portionCount: String
    var portionSize: String
    var open: Bool
    var attempt: Attempt?
}

/// App-only product references and amounts. Never put these private preferences in the widget suite.
@MainActor
final class NativeFoodPreferences: ObservableObject {
    private struct Values: Codable {
        var favorites: Set<String> = []
        var recent: [String] = []
        var amounts: [String: Double] = [:]
        var portions: [String: Double] = [:]
        var modes: [String: Bool]? = [:]
        var draft: NativeFoodDraft?
    }

    @Published private var values = Values()
    private(set) var owner: String?
    private let defaults: UserDefaults
    private var storageKey: String?

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func activate(owner: String?) {
        guard self.owner != owner else { return }
        self.owner = owner
        values = Values()
        storageKey = owner.map {
            let digest = SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined()
            return "native.food-preferences.v1.\(digest)"
        }
        guard let storageKey, let data = defaults.data(forKey: storageKey), data.count <= 128_000,
              var saved = try? JSONDecoder().decode(Values.self, from: data) else { return }
        saved.favorites = Set(saved.favorites.filter { $0.count <= 100 }.prefix(200))
        saved.recent = Array(saved.recent.filter { $0.count <= 100 }.prefix(12))
        saved.amounts = saved.amounts.filter { $0.key.count <= 100 && NativeFoodQuantity.valid($0.value) }
        saved.portions = saved.portions.filter { $0.key.count <= 100 && NativeFoodQuantity.valid($0.value) }
        saved.modes = saved.modes?.filter { $0.key.count <= 100 }
        if let draft = saved.draft, NativeDate.parse(draft.dateKey) == nil || draft.dateKey > NativeDate.key() {
            saved.draft = nil
        }
        values = saved
    }

    // Include the base unit: a revised catalog must not reinterpret a saved g amount as ml.
    func reference(_ food: NativeFood) -> String { "\(food.source):\(food.sourceCode):\(food.basisUnit)" }
    func isFavorite(_ food: NativeFood) -> Bool { values.favorites.contains(reference(food)) }
    func lastAmount(_ food: NativeFood) -> Double? { values.amounts[reference(food)] }
    func portion(_ food: NativeFood) -> Double? { values.portions[reference(food)] }
    func portion(source: String, code: String, unit: String) -> Double? { values.portions["\(source):\(code):\(unit)"] }
    func prefersPortions(_ food: NativeFood) -> Bool { values.modes?[reference(food)] == true }
    func setPreferredMode(_ portions: Bool, for food: NativeFood) {
        guard owner != nil else { return }
        if values.modes == nil { values.modes = [:] }
        values.modes?[reference(food)] = portions
        persist()
    }
    func draft(for owner: String) -> NativeFoodDraft? {
        guard self.owner == owner else { return nil }
        return values.draft
    }
    func saveDraft(_ draft: NativeFoodDraft?, owner: String) {
        guard self.owner == owner else { return }
        if let draft {
            guard NativeDate.parse(draft.dateKey) != nil, draft.dateKey <= NativeDate.key(),
                  [draft.search, draft.quantity, draft.portionCount, draft.portionSize].allSatisfy({ $0.count <= 200 }),
                  (draft.foodReference?.count ?? 0) <= 100,
                  draft.attempt.map({ NativeFoodQuantity.valid($0.amount) && $0.knownIDs.count <= 10_000 && $0.catalogVersion.count <= 100 }) ?? true else { return }
        }
        values.draft = draft
        persist()
    }
    func favorites(in foods: [NativeFood]) -> [NativeFood] { foods.filter { isFavorite($0) } }
    func recent(in foods: [NativeFood]) -> [NativeFood] {
        let lookup = Dictionary(foods.map { (reference($0), $0) }, uniquingKeysWith: { first, _ in first })
        return values.recent.compactMap { lookup[$0] }
    }

    func toggleFavorite(_ food: NativeFood) {
        guard owner != nil else { return }
        let id = reference(food)
        if values.favorites.contains(id) { values.favorites.remove(id) }
        else if values.favorites.count < 200 { values.favorites.insert(id) }
        persist()
    }

    func setPortion(_ amount: Double, for food: NativeFood) {
        guard owner != nil, NativeFoodQuantity.valid(amount) else { return }
        values.portions[reference(food)] = amount
        persist()
    }

    func record(_ food: NativeFood, amount: Double, owner: String) {
        guard self.owner == owner, NativeFoodQuantity.valid(amount) else { return }
        let id = reference(food)
        values.amounts[id] = amount
        values.recent.removeAll { $0 == id }
        values.recent.insert(id, at: 0)
        values.recent = Array(values.recent.prefix(12))
        persist()
    }

    /// Seed shortcuts from this account's diary without importing products or provenance into defaults.
    func seed(entries: [NativeFoodEntry], foods: [NativeFood], owner: String) {
        guard self.owner == owner else { return }
        let lookup = Dictionary(foods.map { ($0.sourceCode, $0) }, uniquingKeysWith: { first, _ in first })
        let latest = entries.filter { $0.user_id == owner }.sorted { $0.created_at > $1.created_at }
        var seen = Set<String>()
        var recent: [String] = []
        for entry in latest {
            guard let food = lookup[entry.source_code], food.source == entry.source,
                  food.basisUnit == entry.basis_unit, NativeFoodQuantity.valid(entry.quantity) else { continue }
            let id = reference(food)
            guard seen.insert(id).inserted else { continue }
            recent.append(id)
            values.amounts[id] = entry.quantity
            if recent.count == 12 { break }
        }
        let merged = Array((recent + values.recent.filter { !seen.contains($0) }).prefix(12))
        if !recent.isEmpty { values.recent = merged; persist() }
    }

    private func persist() {
        guard owner != nil, let storageKey, let data = try? JSONEncoder().encode(values), data.count <= 128_000 else { return }
        defaults.set(data, forKey: storageKey)
    }
}

/// Exact decimal conversion keeps a portion from silently rounding the quantity sent to the diary.
enum NativeFoodQuantity {
    static func decimal(_ text: String) -> Decimal? {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
        guard normalized.count <= 16,
              normalized.range(of: #"^[0-9]+(?:\.[0-9]{1,2})?$"#, options: .regularExpression) != nil,
              let amount = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX")),
              amount > 0, amount <= 5000 else { return nil }
        return amount
    }

    static func valid(_ value: Double) -> Bool {
        guard value.isFinite, value > 0, value <= 5000 else { return false }
        var decimal = Decimal(string: String(value), locale: Locale(identifier: "en_US_POSIX")) ?? 0
        var rounded = Decimal()
        NSDecimalRound(&rounded, &decimal, 2, .plain)
        return rounded == decimal
    }

    static func amount(_ text: String) -> Double? { decimal(text).map { NSDecimalNumber(decimal: $0).doubleValue } }

    /// Only offer portion editing when the original base amount is exactly reversible.
    static func portionCount(amount: Double, size: Double) -> Double? {
        guard valid(amount), valid(size),
              let amount = Decimal(string: String(amount), locale: Locale(identifier: "en_US_POSIX")),
              let size = Decimal(string: String(size), locale: Locale(identifier: "en_US_POSIX")) else { return nil }
        var count = amount / size
        var rounded = Decimal()
        NSDecimalRound(&rounded, &count, 2, .plain)
        let value = NSDecimalNumber(decimal: count).doubleValue
        guard count == rounded, valid(value),
              portionAmount(count: NSDecimalNumber(decimal: count).stringValue, size: NSDecimalNumber(decimal: size).doubleValue) == NSDecimalNumber(decimal: amount).doubleValue else { return nil }
        return value
    }

    static func portionAmount(count: String, size: Double) -> Double? {
        guard let count = decimal(count), valid(size),
              let size = Decimal(string: String(size), locale: Locale(identifier: "en_US_POSIX")) else { return nil }
        var total = count * size
        var rounded = Decimal()
        NSDecimalRound(&rounded, &total, 2, .plain)
        guard total > 0, total <= 5000, total == rounded else { return nil }
        return NSDecimalNumber(decimal: total).doubleValue
    }
}
