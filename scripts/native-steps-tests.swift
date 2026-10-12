import Foundation

/// Standalone tests: compile with Shared/F1tWidgetPayload.swift; no simulator,
/// account, Motion permission, or signed App Group is needed for these rules.
final class NativeStepsPayloadTests {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/Argentina/Mendoza")!
        return value
    }
    private func date(_ key: String) -> Date { ISO8601DateFormatter().date(from: key)! }
    private func payload(_ status: F1tStepsPayload.Status = .available, steps: Int? = 1234) -> F1tStepsPayload {
        F1tStepsPayload(ownerID: "fixture-a", status: status, steps: steps,
                        sampledAt: date("2026-10-09T15:00:00Z"), calendar: calendar)
    }

    func testZeroIsAReadingAndPermissionsNeverFabricateZero() {
        let now = date("2026-10-09T15:01:00Z")
        expectEqual(payload(steps: 0).count(at: now, calendar: calendar), 0)
        expectFalse(payload(steps: -1).isValid)
        expectFalse(payload(steps: nil).isValid)
        for status in [F1tStepsPayload.Status.notDetermined, .denied, .restricted, .unsupported, .unavailable] {
            expectTrue(payload(status, steps: nil).isValid)
            expectNil(payload(status, steps: nil).count(at: now, calendar: calendar))
            expectFalse(payload(status, steps: 0).isValid)
        }
    }

    func testLocalMidnightAndFutureReadingsNeverShowAsToday() {
        let value = payload()
        expectEqual(value.dayKey, "2026-10-09")
        expectEqual(value.count(at: date("2026-10-10T02:59:59Z"), calendar: calendar), 1234)
        expectNil(value.count(at: date("2026-10-10T03:00:00Z"), calendar: calendar))
        expectNil(value.count(at: date("2026-10-09T14:59:59Z"), calendar: calendar))
    }

    func testFreshnessAndTimeZoneChanges() {
        let value = payload()
        expectFalse(value.needsRefresh(at: date("2026-10-09T15:14:59Z"), calendar: calendar))
        expectTrue(value.needsRefresh(at: date("2026-10-09T15:15:00Z"), calendar: calendar))
        var changed = calendar
        changed.timeZone = TimeZone(identifier: "America/New_York")!
        expectNil(value.count(at: date("2026-10-09T15:01:00Z"), calendar: changed),
                     "Even on the same date, a different midnight requires a new reading")
    }

    func testDaylightSavingRolloverUsesLocalMidnightNot24Hours() {
        var local = calendar
        local.timeZone = TimeZone(identifier: "America/New_York")!
        let value = F1tStepsPayload(ownerID: "fixture", status: .available, steps: 10,
                                    sampledAt: date("2026-03-08T05:30:00Z"), calendar: local)
        expectEqual(value.dayKey, "2026-03-08")
        expectEqual(value.count(at: date("2026-03-09T03:59:59Z"), calendar: local), 10)
        expectNil(value.count(at: date("2026-03-09T04:00:00Z"), calendar: local))
    }

    func testStorageIsIndependentAndClearIsIdempotent() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let stepsURL = folder.appendingPathComponent(F1tStepsStorage.filename)
        let workoutURL = folder.appendingPathComponent(F1tWidgetStorage.filename)
        let workout = Data("unchanged workout".utf8)
        try workout.write(to: workoutURL)
        try F1tStepsStorage.write(payload(steps: 0), to: stepsURL)
        expectEqual(F1tStepsStorage.read(from: stepsURL)?.steps, 0)
        // A subsequent workout write must not erase steps (separate filenames).
        try workout.write(to: workoutURL, options: .atomic)
        expectEqual(F1tStepsStorage.read(from: stepsURL)?.ownerID, "fixture-a")
        try F1tStepsStorage.clear(at: stepsURL)
        try F1tStepsStorage.clear(at: stepsURL)
        expectNil(F1tStepsStorage.read(from: stepsURL))
        expectEqual(try Data(contentsOf: workoutURL), workout)
        expectThrows(try F1tStepsStorage.write(payload(steps: -1), to: stepsURL))
        expectThrows(try F1tStepsStorage.write(payload(), to: nil))
    }

    func testInvalidOrTruncatedStorageIsNotAReading() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("{\"steps\":0}".utf8).write(to: url)
        expectNil(F1tStepsStorage.read(from: url))
        let data = try JSONEncoder().encode(payload())
        var object = unwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        for (key, invalid) in [("ownerID", ""), ("dayKey", "2026-10-08"), ("status", "unknown"),
                               ("timeZoneIdentifier", "invalid/zone")] {
            var modified = object
            modified[key] = invalid
            try JSONSerialization.data(withJSONObject: modified).write(to: url)
            expectNil(F1tStepsStorage.read(from: url))
        }
        object["schemaVersion"] = 99
        try JSONSerialization.data(withJSONObject: object).write(to: url)
        expectNil(F1tStepsStorage.read(from: url))
        try Data(repeating: 0, count: 4097).write(to: url)
        expectNil(F1tStepsStorage.read(from: url))
    }
}

private func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String = "",
                                        file: StaticString = #file, line: UInt = #line) {
    precondition(actual == expected, message.isEmpty ? "Expected \(expected), got \(actual)" : message, file: file, line: line)
}
private func expectTrue(_ value: Bool, file: StaticString = #file, line: UInt = #line) {
    precondition(value, "Expected true", file: file, line: line)
}
private func expectFalse(_ value: Bool, file: StaticString = #file, line: UInt = #line) {
    precondition(!value, "Expected false", file: file, line: line)
}
private func expectNil<T>(_ value: T?, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    precondition(value == nil, message.isEmpty ? "Expected no reading" : message, file: file, line: line)
}
private func unwrap<T>(_ value: T?) -> T {
    precondition(value != nil, "Invalid test fixture")
    return value!
}
private func expectThrows(_ operation: @autoclosure () throws -> Void, file: StaticString = #file, line: UInt = #line) {
    do { try operation() } catch { return }
    preconditionFailure("Expected storage failure", file: file, line: line)
}

@main enum NativeStepsTestRunner {
    static func main() throws {
        let suite = NativeStepsPayloadTests()
        suite.testZeroIsAReadingAndPermissionsNeverFabricateZero()
        suite.testLocalMidnightAndFutureReadingsNeverShowAsToday()
        suite.testFreshnessAndTimeZoneChanges()
        suite.testDaylightSavingRolloverUsesLocalMidnightNot24Hours()
        try suite.testStorageIsIndependentAndClearIsIdempotent()
        try suite.testInvalidOrTruncatedStorageIsNotAReading()
        print("Native steps: 6 regression tests passed")
    }
}
