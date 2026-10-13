import Foundation

// Spanish labels and number/date formats ported from the web client (src/lib/muscles.ts and friends).
enum FitFormat {
    static let locale = Locale(identifier: "es_AR")

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.calendar = NativeDate.calendar
        f.timeZone = .current
        f.setLocalizedDateFormatFromTemplate(pattern)
        return f
    }
    private static let longDayFormatter = formatter("EEEEdMMMM")
    private static let shortDayFormatter = formatter("dMMM")
    private static let monthFormatter = formatter("MMM")
    private static let historyFormatter = formatter("EEEdMMM")
    private static let fieldFormatter: DateFormatter = {
        let f = formatter("dMMMy")
        f.dateFormat = "d MMM yyyy"
        return f
    }()
    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = locale
        f.dateFormat = "HH:mm"
        return f
    }()

    private static func clean(_ text: String) -> String { text.replacingOccurrences(of: ".", with: "") }

    /// "Domingo, 5 de octubre".
    static func longDay(_ date: Date) -> String {
        let text = longDayFormatter.string(from: date)
        return text.prefix(1).uppercased() + text.dropFirst()
    }
    /// "22 sept".
    static func shortDay(_ key: String) -> String { NativeDate.parse(key).map { clean(shortDayFormatter.string(from: $0)) } ?? key }
    static func month(_ date: Date) -> String { clean(monthFormatter.string(from: date)) }
    static func historyDay(_ key: String) -> String { NativeDate.parse(key).map { clean(historyFormatter.string(from: $0)) } ?? key }
    static func fieldDay(_ date: Date) -> String { clean(fieldFormatter.string(from: date)) }
    static func time(_ date: Date) -> String { timeFormatter.string(from: date) }

    /// At most one decimal, with a comma: 81 → "81", 81.5 → "81,5".
    static func kg(_ value: Double) -> String { decimal((value * 10).rounded() / 10) }
    static func decimal(_ value: Double) -> String { plain(value).replacingOccurrences(of: ".", with: ",") }
    /// What an input shows: "80", "82.5".
    static func plain(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e9 { return String(Int(value)) }
        var text = String(format: "%.2f", value)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }
    /// Up or down by how much, with the real minus sign (U+2212).
    static func delta(_ value: Double) -> String {
        if value == 0 { return "±0" }
        return (value > 0 ? "+" : "−") + kg(abs(value))
    }
    static func number(_ value: Double, fraction: Int = 0) -> String {
        let f = NumberFormatter()
        f.locale = locale
        f.numberStyle = .decimal
        f.maximumFractionDigits = fraction
        return f.string(from: NSNumber(value: value)) ?? String(value)
    }
    static func sets(_ n: Int) -> String { "\(n) \(n == 1 ? "serie" : "series")" }
    static func list(_ items: [String]) -> String {
        let f = ListFormatter()
        f.locale = locale
        return f.string(from: items) ?? items.joined(separator: ", ")
    }

    /// "4 × 8-12", "3 series", "10 reps"; nil when there is no target.
    static func target(sets: Int?, reps: String?, weight: Double? = nil) -> String? {
        let goal = targetDescription(sets: sets, reps: reps)
        guard let weight else { return goal }
        let kg = "\(decimal(weight)) kg"
        return goal.map { "\($0) · \(kg)" } ?? kg
    }
    private static func targetDescription(sets: Int?, reps: String?) -> String? {
        let reps = reps?.isEmpty == true ? nil : reps
        if let sets, sets > 0, let reps { return "\(sets) × \(reps)" }
        if let sets, sets > 0 { return Self.sets(sets) }
        if let reps { return "\(reps) reps" }
        return nil
    }
    /// "8-12" becomes 8: under-suggesting is fixed with one tap.
    static func targetReps(_ text: String?) -> Int? {
        guard let text, let range = text.range(of: #"\d+"#, options: .regularExpression) else { return nil }
        return Int(text[range])
    }

    /// Only repetition counts/ranges; timed or free-form targets must not be presented as counts.
    static func targetRepsRange(_ raw: String?) -> ClosedRange<Int>? {
        guard let raw else { return nil }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.range(of: #"^\d+(\s*[-–—]\s*\d+)?$"#, options: .regularExpression) != nil else { return nil }
        let parts = text.components(separatedBy: CharacterSet(charactersIn: "-–—"))
        guard let lower = Int(parts[0].trimmingCharacters(in: .whitespaces)), lower > 0,
              let upper = Int(parts.last!.trimmingCharacters(in: .whitespaces)), upper >= lower else { return nil }
        return lower...upper
    }

    static func targetRepsSource(_ raw: String?) -> String? {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        guard let range = targetRepsRange(raw) else { return "Objetivo de la rutina: \(raw)" }
        if range.lowerBound == range.upperBound { return "Objetivo: \(range.lowerBound) repeticiones" }
        return "Objetivo: \(range.lowerBound)–\(range.upperBound) repeticiones"
    }

    static func targetSets(_ raw: String) throws -> Int? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        guard text.range(of: #"^\d+$"#, options: .regularExpression) != nil,
              let value = Int(text), (1...50).contains(value) else {
            throw NativeFailure.message("Ingresá un número entero de 1 a 50 series, o dejá el campo vacío.")
        }
        return value
    }

    /// Existing duration/free-text goals remain supported. Numeric ranges must be ascending.
    static func validatedTargetReps(_ raw: String) throws -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        guard text.count <= 24 else { throw NativeFailure.message("El objetivo admite hasta 24 caracteres.") }
        let numeric = #"^\d+(\s*[-–—]\s*\d+)?$"#
        let numericPrefix = text.range(of: #"^[\d\s.,+−\-–—]+"#, options: .regularExpression)
            .map { String(text[$0]).trimmingCharacters(in: .whitespaces) }
        let countText = text.range(of: numeric, options: .regularExpression) != nil ? text : nil
        let rangeText = numericPrefix.flatMap { prefix in
            prefix.contains(where: { "-–—".contains($0) }) ? prefix : nil
        }
        if let prefix = numericPrefix,
           prefix.range(of: #"^\d+$"#, options: .regularExpression) != nil,
           Int(prefix).map({ $0 > 0 }) != true {
            throw NativeFailure.message("El objetivo debe ser mayor que cero; no se cambió el valor.")
        }
        if let count = countText ?? rangeText {
            guard targetRepsRange(count) != nil else {
                throw NativeFailure.message("Ingresá repeticiones mayores que cero y un rango de menor a mayor, por ejemplo 8–12.")
            }
        } else if text.first.map({ "+−-".contains($0) }) == true {
            throw NativeFailure.message("El objetivo debe ser positivo; no se cambió el valor.")
        } else if text.range(of: #"^[\d\s.,+−\-–—]+$"#, options: .regularExpression) != nil {
            throw NativeFailure.message("Usá un número entero o un rango, por ejemplo 8–12. Para tiempo, escribí la unidad: 30 s.")
        }
        return text
    }

    /// Empty clears a default; malformed text never silently clears it.
    static func targetWeight(_ raw: String) throws -> Double? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        guard text.range(of: #"^(\d+([.,]\d*)?|[.,]\d+)$"#, options: .regularExpression) != nil,
              let value = nativeNumber(text), value.isFinite, (0...9999.99).contains(value) else {
            throw NativeFailure.message("Ingresá un peso de 0 a 9999,99 kg, o dejá el campo vacío.")
        }
        let decimals = text.components(separatedBy: CharacterSet(charactersIn: ".,"))
        guard decimals.count < 2 || decimals[1].count <= 2 else {
            throw NativeFailure.message("El peso admite hasta dos decimales; no se redondeó el valor.")
        }
        return value
    }
}

enum FitLabels {
    /// Monday-first, like the web week and heatmap.
    static let weekOrder = [1, 2, 3, 4, 5, 6, 0]
    static let weekdayShort = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
    static let muscleOrder = ["abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes", "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders", "traps", "triceps"]
    /// Rarely trained muscles are left out so the warning stays meaningful.
    static let keyMuscles = ["abdominals", "biceps", "calves", "chest", "glutes", "hamstrings", "lats", "lower back", "middle back", "quadriceps", "shoulders", "traps", "triceps"]
    static let muscles = [
        "abdominals": "Abdominales", "abductors": "Abductores", "adductors": "Aductores", "biceps": "Bíceps",
        "calves": "Gemelos", "chest": "Pecho", "forearms": "Antebrazos", "glutes": "Glúteos",
        "hamstrings": "Isquiotibiales", "lats": "Dorsales", "lower back": "Lumbares", "middle back": "Espalda media",
        "neck": "Cuello", "quadriceps": "Cuádriceps", "shoulders": "Hombros", "traps": "Trapecios", "triceps": "Tríceps",
    ]
    static let equipment = [
        "body only": "Peso corporal", "barbell": "Barra", "dumbbell": "Mancuernas", "machine": "Máquina",
        "cable": "Poleas", "kettlebells": "Kettlebell", "bands": "Bandas", "medicine ball": "Balón medicinal",
        "exercise ball": "Pelota suiza", "e-z curl bar": "Barra Z", "foam roll": "Foam roller", "other": "Otro",
    ]
    static let category = [
        "strength": "Fuerza", "stretching": "Elongación", "plyometrics": "Pliometría", "strongman": "Strongman",
        "powerlifting": "Powerlifting", "cardio": "Cardio", "olympic weightlifting": "Halterofilia",
    ]
    static let level = ["beginner": "Principiante", "intermediate": "Intermedio", "expert": "Avanzado"]
    static let force = ["push": "Empuje", "pull": "Tracción", "static": "Isométrico"]
    static let mechanic = ["compound": "Compuesto", "isolation": "Aislamiento"]
    /// Not 1:1: the drawing has no lats region and doesn't split the deltoids.
    static let bodyParts: [String: [String]] = [
        "abdominals": ["abs"], "abductors": ["abductors"], "adductors": ["adductor"], "biceps": ["biceps"],
        "calves": ["calves"], "chest": ["chest"], "forearms": ["forearm"], "glutes": ["gluteal"],
        "hamstrings": ["hamstring"], "lats": ["upper-back"], "lower back": ["lower-back"], "middle back": ["upper-back"],
        "neck": ["neck"], "quadriceps": ["quadriceps"], "shoulders": ["front-deltoids", "back-deltoids"],
        "traps": ["trapezius"], "triceps": ["triceps"],
    ]

    static func muscle(_ id: String) -> String { muscles[id] ?? id }
    static func of(_ table: [String: String], _ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        return table[value] ?? value
    }
    static func parts(_ muscles: [String]) -> Set<String> { Set(muscles.flatMap { bodyParts[$0] ?? [] }) }

    /// Lowercased and unaccented, so "biceps" finds "Bíceps".
    static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: FitFormat.locale).lowercased()
    }
}

struct FitCoverage {
    let primary: [String]
    let secondary: [String]
    let missing: [String]
    let exerciseCount: Int

    /// The three groups are disjoint; anatomical order so similar routines read the same.
    init(exerciseIDs: [String], lookup: (String) -> NativeExercise?) {
        var primary = Set<String>(), secondary = Set<String>(), count = 0
        for id in exerciseIDs {
            guard let exercise = lookup(id) else { continue }
            count += 1
            primary.formUnion(exercise.primary_muscles)
            secondary.formUnion(exercise.secondary_muscles)
        }
        self.primary = FitLabels.muscleOrder.filter { primary.contains($0) }
        self.secondary = FitLabels.muscleOrder.filter { secondary.contains($0) && !primary.contains($0) }
        self.missing = FitLabels.keyMuscles.filter { !primary.contains($0) && !secondary.contains($0) }
        self.exerciseCount = count
    }
}

enum FitCatalogSearch {
    /// Bilingual on purpose: plenty of people type "bench press" in a Spanish UI.
    static func index(_ e: NativeExercise) -> String {
        FitLabels.normalize(([e.name, e.name_en ?? "", e.id.replacingOccurrences(of: "_", with: " ")] + (e.aliases ?? [])
            + e.primary_muscles.map(FitLabels.muscle) + e.secondary_muscles.map(FitLabels.muscle) + e.primary_muscles
            + [FitLabels.equipment[e.equipment ?? ""] ?? "", e.equipment ?? ""]).joined(separator: " "))
    }
    static func filter(_ exercises: [NativeExercise], query: String, muscle: String?, equipment: String?) -> [NativeExercise] {
        let terms = FitLabels.normalize(query.trimmingCharacters(in: .whitespacesAndNewlines)).split(whereSeparator: \.isWhitespace).map(String.init)
        return exercises.filter { e in
            if let equipment, e.equipment != equipment { return false }
            if let muscle, !e.primary_muscles.contains(muscle), !e.secondary_muscles.contains(muscle) { return false }
            guard !terms.isEmpty else { return true }
            let haystack = index(e)
            return terms.allSatisfy { haystack.contains($0) }
        }
    }
}
