import Foundation

enum NativeDate {
    static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = .current; return c }
    static func key(_ date: Date = Date()) -> String {
        let p = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year!, p.month!, p.day!)
    }
    static func parse(_ key: String) -> Date? {
        guard key.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let v = key.split(separator: "-").compactMap { Int($0) }
        guard v.count == 3, let d = calendar.date(from: DateComponents(year: v[0], month: v[1], day: v[2])), self.key(d) == key else { return nil }
        return d
    }
    static func add(_ days: Int, to date: Date) -> Date { calendar.date(byAdding: .day, value: days, to: date)! }
    static func weekday(_ date: Date = Date()) -> Int { calendar.component(.weekday, from: date) - 1 }
    static let weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
    static func age(_ birthday: String?, on date: Date) -> Int? {
        guard let birthday, let born = parse(birthday), born <= date else { return nil }
        return calendar.dateComponents([.year], from: born, to: date).year
    }
    static func heatmap(_ sessions: [NativeWorkoutSession], date: Date = Date()) -> [(key: String, level: Int)] {
        let last = add(6 - (weekday(date) + 6) % 7, to: date)
        let first = add(-181, to: last)
        let counts = Dictionary(sessions.map { ($0.performed_on, $0.set_count) }, uniquingKeysWith: +)
        return (0..<182).map { offset in
            let key = self.key(add(offset, to: first)), n = counts[key] ?? 0
            return (key, key > self.key(date) ? 0 : n >= 28 ? 4 : n >= 20 ? 3 : n >= 12 ? 2 : n > 0 ? 1 : 0)
        }
    }
    static func streak(_ sessions: [NativeWorkoutSession], date: Date = Date()) -> Int {
        let trained = Set(sessions.filter { $0.set_count > 0 }.map(\.performed_on))
        var day = trained.contains(key(date)) ? date : add(-1, to: date), count = 0
        while trained.contains(key(day)) { count += 1; day = add(-1, to: day) }
        return count
    }
}
