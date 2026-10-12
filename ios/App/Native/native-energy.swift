import Foundation

struct NativeEnergyReport { let bmi, bmr, tdee, target: Double; let activityDays: Double }
enum NativeEnergy {
    static func target(tdee: Double, bmr: Double, goal: String) -> Double {
        let delta: Double = goal == "lose" ? -500 : goal == "gain" ? 300 : 0
        return max((max(tdee + delta, bmr) / 50).rounded() * 50, ceil(bmr / 50) * 50)
    }
    static func report(profile: NativeBodyProfile?, weights: [NativeWeight], sessions: [NativeWorkoutSession], date: Date = Date()) -> NativeEnergyReport? {
        let key = NativeDate.key(date)
        guard let p = profile, let h = p.height_cm, h.isFinite, (80...260).contains(h), let w = latestWeight(weights.filter { $0.user_id == p.user_id }, on: date)?.weight_kg, w.isFinite, (20...400).contains(w),
              let age = NativeDate.age(p.birth_date, on: date), let sex = p.sex, ["male", "female"].contains(sex) else { return nil }
        let start = NativeDate.key(NativeDate.add(-27, to: date))
        let count = Set(sessions.filter { $0.user_id == p.user_id && $0.set_count > 0 && NativeDate.parse($0.performed_on) != nil && $0.performed_on >= start && $0.performed_on <= key }.map(\.performed_on)).count
        let days = Double(count) / 4, roundedDays = days.rounded()
        let factor: Double = roundedDays >= 7 ? 1.9 : roundedDays >= 5 ? 1.725 : roundedDays >= 3 ? 1.55 : roundedDays >= 1 ? 1.375 : 1.2
        let bmr = 10 * w + 6.25 * h - 5 * Double(age) + (sex == "male" ? 5 : -161)
        let tdee = bmr * factor
        guard bmr.isFinite, tdee.isFinite, bmr > 0, tdee > 0 else { return nil }
        return NativeEnergyReport(bmi: (w / pow(h / 100, 2) * 10).rounded() / 10, bmr: bmr.rounded(), tdee: tdee.rounded(), target: target(tdee: tdee, bmr: bmr, goal: p.goal), activityDays: days)
    }
    /// Invalid and future dates must not become the current weight. Resolve ties
    /// consistently with the log, rather than depending on response ordering.
    static func latestWeight(_ weights: [NativeWeight], on date: Date) -> NativeWeight? {
        let key = NativeDate.key(date)
        return weights.filter { NativeDate.parse($0.measured_on) != nil && $0.measured_on <= key && $0.weight_kg.isFinite && (20...400).contains($0.weight_kg) }
            .max { $0.measured_on != $1.measured_on ? $0.measured_on < $1.measured_on : $0.id < $1.id }
    }
    static func quantity(_ text: String) -> Double? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
        guard text.range(of: #"^\d+(?:\.\d{1,2})?$"#, options: .regularExpression) != nil, let value = Double(text), value > 0, value <= 5000 else { return nil }
        return value
    }
    static func snapshot(_ report: NativeEnergyReport?) -> (target: Double?, tdee: Double?) {
        guard let r = report, r.target > 0, r.target <= 11000, r.tdee > 0, r.tdee <= 11000 else { return (nil, nil) }
        return (r.target, r.tdee)
    }
}

/// Presentation data for the orientative energy formula; no intake recommendation.
struct NativeEnergyCard {
    let sourceWeight: NativeWeight?
    let missing: [String]
    let bmi: Double?
    let report: NativeEnergyReport?
    let goal: String
    let adjustment: Double
    let clamped: Bool
    let activityLabel: String

    static let goalLabels = ["lose": "Bajar", "maintain": "Mantener", "gain": "Subir"]
    static func bmiCategory(_ value: Double) -> String {
        value < 18.5 ? "Bajo peso" : value < 25 ? "Normal" : value < 30 ? "Sobrepeso" : "Obesidad"
    }

    init(profile: NativeBodyProfile?, weights: [NativeWeight], sessions: [NativeWorkoutSession], date: Date = Date()) {
        let height = profile?.height_cm.flatMap { $0.isFinite && (80...260).contains($0) ? $0 : nil }
        let scopedWeights = profile.map { p in weights.filter { $0.user_id == p.user_id } } ?? weights
        let source = NativeEnergy.latestWeight(scopedWeights, on: date)
        sourceWeight = source
        let weight = source?.weight_kg
        let sex = profile?.sex.flatMap { ["male", "female"].contains($0) ? $0 : nil }
        let age = NativeDate.age(profile?.birth_date, on: date)
        var missing: [String] = []
        if height == nil { missing.append("tu altura") }
        if weight == nil { missing.append("un peso") }
        if sex == nil { missing.append("tu sexo") }
        if age == nil { missing.append("tu fecha de nacimiento") }
        self.missing = missing
        bmi = height.flatMap { h in weight.map { (($0 / pow(h / 100, 2)) * 10).rounded() / 10 } }
        report = NativeEnergy.report(profile: profile, weights: weights, sessions: sessions, date: date)
        goal = ["lose", "maintain", "gain"].contains(profile?.goal ?? "") ? profile!.goal : "maintain"
        adjustment = goal == "lose" ? -500 : goal == "gain" ? 300 : 0
        let days = (report?.activityDays ?? 0).rounded()
        activityLabel = days >= 7 ? "muy alta" : days >= 5 ? "alta" : days >= 3 ? "moderada" : days >= 1 ? "ligera" : "sin días de entrenamiento registrados"
        if report != nil, let height, let weight, let sex, let age {
            let bmr = 10 * weight + 6.25 * height - 5 * Double(age) + (sex == "male" ? 5 : -161)
            let factor = days >= 7 ? 1.9 : days >= 5 ? 1.725 : days >= 3 ? 1.55 : days >= 1 ? 1.375 : 1.2
            // The deficit would go below the resting burn, so the target was raised to it.
            clamped = bmr * factor + adjustment < bmr
        } else {
            clamped = false
        }
    }
}
