import Foundation
import CryptoKit

// Standalone, account-free checks. Compile with native-models.swift,
// native-date.swift and native-food-preferences.swift; no simulator is needed.
enum NativeFailure: Error { case message(String) }

@main struct FoodPreferenceChecks {
    @MainActor static func main() throws {
        let ready = NativeFoodAvailability.ReadState(loaded: true, loading: false, usingCachedData: false, error: nil)
        let absent = NativeFoodAvailability.ReadState(loaded: false, loading: false, usingCachedData: false, error: nil)
        let loading = NativeFoodAvailability.ReadState(loaded: false, loading: true, usingCachedData: false, error: nil)
        let cached = NativeFoodAvailability.ReadState(loaded: true, loading: false, usingCachedData: true, error: "food read failed")
        let trainingFailed = NativeFoodAvailability.ReadState(loaded: true, loading: false, usingCachedData: true, error: "training read failed")
        let missingDiary = NativeFoodAvailability(diary: absent, body: ready, activity: ready)
        precondition(!missingDiary.diary.loaded && !missingDiary.confirmedDiary && !missingDiary.canCalculateTarget,
                     "Loaded training/body cannot establish an empty food diary or objective")
        precondition(!missingDiary.canRegister(hasHistoricalDay: false, acceptsNoTarget: true),
                     "A bypass cannot make an unread food date safe to register")
        let loadingDiary = NativeFoodAvailability(diary: loading, body: ready, activity: ready)
        precondition(loadingDiary.diary.loading && !loadingDiary.confirmedDiary)
        let cachedDiary = NativeFoodAvailability(diary: cached, body: ready, activity: ready)
        precondition(cachedDiary.diary.loaded && !cachedDiary.confirmedDiary && !cachedDiary.canCalculateTarget)
        precondition(cachedDiary.targetError == "food read failed")
        precondition(cachedDiary.canRegister(hasHistoricalDay: true, acceptsNoTarget: false),
                     "An existing historical target must not be recalculated from other domains")
        let partial = NativeFoodAvailability(diary: ready, body: ready, activity: trainingFailed)
        precondition(partial.confirmedDiary && !partial.canCalculateTarget,
                     "Food reconciliation succeeds even when training refresh fails")
        precondition(partial.canRegister(hasHistoricalDay: true, acceptsNoTarget: false))
        precondition(!partial.canRegister(hasHistoricalDay: false, acceptsNoTarget: false))
        precondition(partial.canRegister(hasHistoricalDay: false, acceptsNoTarget: true))
        let bodyMissing = NativeFoodAvailability(diary: ready, body: absent, activity: ready)
        precondition(bodyMissing.confirmedDiary && !bodyMissing.canCalculateTarget,
                     "Unknown profile/weight must not masquerade as a valid no-target report")
        let confirmed = NativeFoodAvailability(diary: ready, body: ready, activity: ready)
        precondition(confirmed.confirmedDiary && confirmed.canCalculateTarget && confirmed.targetError == nil)
        precondition(confirmed.canRegister(hasHistoricalDay: false, acceptsNoTarget: false))

        let suite = "food-ux-tests-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let catalogURL = URL(fileURLWithPath: "src/features/foods/catalog.json")
        let food = try JSONDecoder().decode(NativeFoodCatalog.self, from: Data(contentsOf: catalogURL)).products.first!
        let changedUnit = NativeFood(catalogVersion: food.catalogVersion, source: food.source, sourceCode: food.sourceCode,
                                     sourceUrl: food.sourceUrl, sourceRetrievedAt: food.sourceRetrievedAt,
                                     sourceResponseSha256: food.sourceResponseSha256, reviewedAt: food.reviewedAt,
                                     sourceRevision: food.sourceRevision, name: food.name, brand: food.brand,
                                     basisUnit: "ml", group: food.group, energyKcalPer100: food.energyKcalPer100, aliases: food.aliases)
        let today = NativeDate.key(), yesterday = NativeDate.key(NativeDate.add(-1, to: Date()))
        let prefs = NativeFoodPreferences(defaults: defaults)
        prefs.activate(owner: "a")
        prefs.toggleFavorite(food); prefs.setPortion(30, for: food)
        prefs.setPreferredMode(true, for: food); prefs.record(food, amount: 45, owner: "a")
        let draft = NativeFoodDraft(dateKey: yesterday, search: "avena", foodReference: prefs.reference(food), quantity: "45",
                                    usePortions: true, portionCount: "1,5", portionSize: "30", open: true,
                                    attempt: .init(amount: 45, knownIDs: ["previous"], catalogVersion: food.catalogVersion))
        prefs.saveDraft(draft, owner: "a")
        let remounted = NativeFoodPreferences(defaults: defaults); remounted.activate(owner: "a")
        precondition(remounted.draft(for: "a") == draft, "Navigation/recreation must preserve the original destination and pending check")
        precondition(remounted.prefersPortions(food) && remounted.portion(food) == 30 && remounted.lastAmount(food) == 45)
        var moved = draft; moved.dateKey = today; moved.attempt = nil
        remounted.saveDraft(moved, owner: "a")
        precondition(remounted.draft(for: "a")?.quantity == "45" && remounted.draft(for: "a")?.dateKey == today)
        remounted.activate(owner: "b")
        precondition(remounted.draft(for: "b") == nil && !remounted.isFavorite(food) && !remounted.prefersPortions(food))
        precondition(remounted.lastAmount(food) == nil && remounted.portion(food) == nil)
        remounted.saveDraft(draft, owner: "a"); remounted.record(food, amount: 100, owner: "a")
        precondition(remounted.draft(for: "b") == nil && remounted.lastAmount(food) == nil, "Delayed A operations cannot change B")
        remounted.activate(owner: nil); remounted.setPreferredMode(true, for: food)
        precondition(!remounted.prefersPortions(food))
        remounted.activate(owner: "a")
        precondition(remounted.draft(for: "a") == moved)
        precondition(!remounted.isFavorite(changedUnit) && !remounted.prefersPortions(changedUnit))
        precondition(remounted.lastAmount(changedUnit) == nil && remounted.portion(changedUnit) == nil, "Never reinterpret g as ml")
        var invalid = moved; invalid.dateKey = NativeDate.key(NativeDate.add(1, to: Date()))
        remounted.saveDraft(invalid, owner: "a")
        precondition(remounted.draft(for: "a") == moved, "Future/invalid dates cannot replace a valid draft")
        invalid.dateKey = "2026-02-30"; remounted.saveDraft(invalid, owner: "a")
        precondition(remounted.draft(for: "a") == moved)
        let legacyDigest = SHA256.hash(data: Data("legacy".utf8)).map { String(format: "%02x", $0) }.joined()
        let reference = prefs.reference(food)
        let legacy: [String: Any] = ["favorites": [reference], "recent": [reference], "amounts": [reference: 45], "portions": [reference: 30]]
        defaults.set(try JSONSerialization.data(withJSONObject: legacy), forKey: "native.food-preferences.v1.\(legacyDigest)")
        remounted.activate(owner: "legacy")
        precondition(remounted.isFavorite(food) && remounted.lastAmount(food) == 45 && remounted.portion(food) == 30, "New mode/draft fields must not erase older saved preferences")
        precondition(NativeFoodQuantity.portionCount(amount: 45, size: 30) == 1.5)
        precondition(NativeFoodQuantity.portionAmount(count: "1,5", size: 30) == 45)
        precondition(NativeFoodQuantity.portionAmount(count: "0,5", size: 0.02) == 0.01)
        precondition(NativeFoodQuantity.portionCount(amount: 100, size: 30) == nil)
        precondition(NativeFoodQuantity.portionAmount(count: "0,33", size: 0.33) == nil)
        precondition(NativeFoodQuantity.portionCount(amount: 5000, size: 0.01) == nil)
        precondition(NativeFoodQuantity.portionAmount(count: "2", size: 3000) == nil)
        print("Native food checks passed: account/date draft isolation, pending attempts, legacy preferences, unit safety, exact portions and independent domain readiness")
    }
}
