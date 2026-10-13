import XCTest
import SwiftUI
import ImageIO
import Combine
import Vision
@testable import App

final class NativeTests: XCTestCase {
    func testBundledSupabaseConfigurationLoadsWithoutUnresolvedSettings() throws {
        // Read the processed App Info.plist, not a fixture or the source xcconfig.
        // A failure is reported without printing the bundled URL/key.
        _ = try NativeConfiguration.load()
    }
    func testDisplayBrandIsFITWhileInstalledIdentityStaysF1t() throws {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "FIT")
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.morguimateo.f1t")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") as? String,
                       "FIT muestra tus pasos de hoy en la pantalla Hoy.")
        let urls = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])
        XCTAssertEqual(urls.first?["CFBundleURLName"] as? String, "com.morguimateo.f1t.auth")
        XCTAssertEqual(urls.first?["CFBundleURLSchemes"] as? [String], ["f1t"])
        XCTAssertEqual(F1tWidgetStorage.appGroup, "group.com.morguimateo.f1t")
        let widgetURL = try XCTUnwrap(Bundle.main.builtInPlugInsURL).appendingPathComponent("WidgetExtension.appex/Info.plist")
        let widget = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(contentsOf: widgetURL), format: nil) as? [String: Any])
        XCTAssertEqual(widget["CFBundleDisplayName"] as? String, "FIT")
        XCTAssertEqual(widget["CFBundleIdentifier"] as? String, "com.morguimateo.f1t.widget")
    }
    @MainActor func testKeychainAndAppGroupRequireUsableSimulatorSigning() throws {
        let auth = NativeAuth(service: "com.morguimateo.f1t.tests.\(UUID().uuidString)")
        defer { try? auth.keychainDelete() }
        let value = Data("test-only-storage-fixture".utf8)
        XCTAssertNil(try auth.keychainRead())
        try auth.keychainSave(value)
        XCTAssertEqual(try auth.keychainRead(), value)
        try auth.keychainDelete()
        XCTAssertNil(try auth.keychainRead())
        XCTAssertNotNil(F1tWidgetStorage.fileURL())
    }
    @MainActor func testNativeScreensRenderEmptyStatesWithoutWebView() {
        let store = NativeStore()
        let screens = [AnyView(NativeTodayView()), AnyView(NativeRoutinesView()), AnyView(NativeProgressView()), AnyView(NativeProfileView())]
        for screen in screens {
            let controller = UIHostingController(rootView: screen.environmentObject(store))
            controller.loadViewIfNeeded()
            controller.view.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
            controller.view.layoutIfNeeded()
            XCTAssertFalse(String(describing: type(of: controller.view)).contains("WKWebView"))
        }
        XCTAssertNil(store.auth.session)
    }
    func testLocalCalendarAndInvalidDates() {
        XCTAssertNil(NativeDate.parse("2026-02-30"))
        XCTAssertNil(NativeDate.parse("2026-2-01"))
        XCTAssertEqual(NativeDate.key(NativeDate.parse("2026-10-01")!), "2026-10-01")
        XCTAssertEqual(NativeDate.weekday(NativeDate.parse("2026-10-01")!), 4)
        XCTAssertEqual(NativeDate.key(NativeDate.add(1, to: NativeDate.parse("2024-02-28")!)), "2024-02-29")
        XCTAssertEqual(NativeDate.age("2000-10-02", on: NativeDate.parse("2026-10-01")!), 25)
    }
    private func session(_ date: String, _ sets: Int) -> NativeWorkoutSession {
        NativeWorkoutSession(id: date, user_id: "u", performed_on: date, created_at: "", routine_day_id: nil, notes: nil, set_count: sets)
    }
    func testHeatmapThresholdsAlignmentAndStreak() {
        let date = NativeDate.parse("2026-10-01")!
        let sessions = [session("2026-09-28", 0), session("2026-09-29", 12), session("2026-09-30", 20), session("2026-10-01", 28)]
        let cells = NativeDate.heatmap(sessions, date: date)
        XCTAssertEqual(cells.count, 182)
        XCTAssertEqual(NativeDate.weekday(NativeDate.parse(cells.first!.key)!), 1)
        XCTAssertEqual(cells.first { $0.key == "2026-09-28" }?.level, 0)
        XCTAssertEqual(cells.first { $0.key == "2026-09-29" }?.level, 2)
        XCTAssertEqual(cells.first { $0.key == "2026-09-30" }?.level, 3)
        XCTAssertEqual(cells.first { $0.key == "2026-10-01" }?.level, 4)
        XCTAssertEqual(NativeDate.streak(sessions, date: date), 3)
        XCTAssertEqual(NativeDate.streak(sessions, date: NativeDate.add(1, to: date)), 3)
    }

    @MainActor func testPKCEAndCallbackValidation() throws {
        XCTAssertEqual(NativeAuth.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(try NativeAuth.callbackCode(URL(string: "f1t://auth/callback?code=abc")!), "abc")
        for text in ["https://auth/callback?code=x", "f1t://evil/callback?code=x", "f1t://auth/wrong?code=x", "f1t://auth/callback?code=x&code=y", "f1t://auth/callback?error=bad&code=x", "f1t://auth/callback?code=", "f1t://auth/callback?code=x#access_token=y"] {
            XCTAssertThrowsError(try NativeAuth.callbackCode(URL(string: text)!))
        }
    }
    func testWidgetCodableShapeAndValidation() throws {
        let week = (0...6).map { F1tWidgetPayload.RoutineDay(weekday: $0, label: nil, exercises: []) }
        let payload = F1tWidgetPayload(levels: Array(repeating: 0, count: 182), todayLabel: nil, todayExercises: [], streak: 0, schemaVersion: 2, routineWeek: week)
        XCTAssertTrue(payload.isValid)
        let roundtrip = try JSONDecoder().decode(F1tWidgetPayload.self, from: JSONEncoder().encode(payload))
        XCTAssertTrue(roundtrip.isValid)
        let invalid = F1tWidgetPayload(levels: [5], todayLabel: nil, todayExercises: [], streak: -1, schemaVersion: 2, routineWeek: week)
        XCTAssertFalse(invalid.isValid)
    }
    func testBackendNullAndConflictEncoding() throws {
        let body: [String: Any] = ["target_weight_kg": nativeNull(nil as Double?), "height_cm": nativeNull(nil as Double?), "weight_kg": 12.5]
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: body)) as? [String: Any])
        XCTAssertTrue(json["target_weight_kg"] is NSNull); XCTAssertTrue(json["height_cm"] is NSNull)
        XCTAssertEqual(json["weight_kg"] as? Double, 12.5)
        XCTAssertEqual(nativeQuery("id", "some-id").first?.value, "eq.some-id")
    }
    func testBundledCatalogsAndImages() throws {
        XCTAssertNil(Bundle.main.url(forResource: "foods-catalog.json", withExtension: nil, subdirectory: "NativeResources"))
        XCTAssertNil(Bundle.main.url(forResource: "foods-catalog-attribution.json", withExtension: nil, subdirectory: "NativeResources"))
        XCTAssertEqual(FitTab.allCases.map(\.label), ["Hoy", "Rutinas", "Progreso", "Perfil"])
        let exercises = try nativeResource("exercise-catalog.json", as: [NativeExercise].self)
        XCTAssertEqual(exercises.count, 165)
        for exercise in exercises {
            for path in exercise.images { XCTAssertNotNil(Bundle.main.url(forResource: path, withExtension: nil, subdirectory: "NativeResources/exercises"), path) }
        }
    }
}

private final class NativeLogoutURLProtocol: URLProtocol {
    static var handler: ((URLRequest, NativeLogoutURLProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(request, self) }
    override func stopLoading() {}
    func finish(status: Int, data: Data = Data()) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
private final class NativeLogoutCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: NativeLogoutURLProtocol?
    func put(_ value: NativeLogoutURLProtocol) { lock.lock(); stored = value; lock.unlock() }
    func take() -> NativeLogoutURLProtocol? { lock.lock(); defer { lock.unlock() }; return stored }
}

final class NativeP2Tests: XCTestCase {
    private func fixture(owner: String, token: String) -> NativeAuthSession {
        NativeAuthSession(access_token: token, refresh_token: "fixture-refresh", expires_in: 3600,
                          expires_at: Date().timeIntervalSince1970 + 3600, user: NativeAuthUser(id: owner, email: nil))
    }
    @MainActor func testRestorePreservesRemindersDuringPublishedWillSetThenLogoutClears() async throws {
        let service = "f1t.p2.restore.\(UUID())", suite = "f1t.p2.defaults.\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("owner-a", forKey: "native.reminders.owner"); defaults.set(true, forKey: "native.reminders.enabled")
        defaults.set(20, forKey: "native.reminders.hour"); defaults.set(15, forKey: "native.reminders.minute")
        var cleanups = 0
        let device = NativeDevice(defaults: defaults, removeNotifications: { cleanups += 1 })
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [NativeLogoutURLProtocol.self]
        NativeLogoutURLProtocol.handler = { _, request in request.finish(status: 204) }
        let network = URLSession(configuration: configuration)
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let auth = NativeAuth(service: service, network: network)
        defer { try? auth.keychainDelete() }
        try auth.keychainSave(JSONEncoder().encode(fixture(owner: "owner-a", token: "outgoing")))
        let store = NativeStore(auth: auth, automaticallyRefresh: false)
        var events: [NativeAccountEvent] = [], publishedOldOwner: String?
        let subscription = store.accountChanges.sink { event in
            publishedOldOwner = auth.session?.user.id
            events.append(event); device.handleAccount(event)
        }
        defer { subscription.cancel() }
        await auth.restore()
        XCTAssertNil(publishedOldOwner, "Restoration event deliberately occurs in willSet")
        XCTAssertEqual(events.first?.incomingOwner, "owner-a")
        XCTAssertTrue(device.reminderEnabled); XCTAssertTrue(defaults.bool(forKey: "native.reminders.enabled"))
        XCTAssertEqual(device.reminderHour, 20); XCTAssertEqual(device.reminderMinute, 15); XCTAssertEqual(cleanups, 0)
        // Refreshing tokens for the same owner must not be treated as an account change.
        try auth.completeSignIn(fixture(owner: "owner-a", token: "refreshed"))
        XCTAssertEqual(events.count, 1); XCTAssertEqual(cleanups, 0)
        await auth.signOut()
        XCTAssertEqual(publishedOldOwner, "owner-a", "Logout also emits while the old session is assigned")
        XCTAssertNil(events.last?.incomingOwner); XCTAssertNil(auth.session)
        XCTAssertFalse(device.reminderEnabled); XCTAssertNil(defaults.string(forKey: "native.reminders.owner")); XCTAssertEqual(cleanups, 1)
        for key in ["native.reminders.enabled", "native.reminders.hour", "native.reminders.minute"] { XCTAssertNil(defaults.object(forKey: key)) }
        XCTAssertEqual(device.reminderHour, 18); XCTAssertEqual(device.reminderMinute, 0)
    }
    @MainActor func testAccountChangeClearsPreferencesAndPrivateRowsBeforeAssignedSession() throws {
        let suite = "f1t.p2.account.\(UUID())", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("a", forKey: "native.reminders.owner"); defaults.set(true, forKey: "native.reminders.enabled")
        defaults.set(22, forKey: "native.reminders.hour"); defaults.set(45, forKey: "native.reminders.minute")
        var cleanups = 0
        let device = NativeDevice(defaults: defaults, removeNotifications: { cleanups += 1 })
        let auth = NativeAuth(service: "f1t.p2.auth.\(UUID())")
        defer { try? auth.keychainDelete() }
        let store = NativeStore(auth: auth, automaticallyRefresh: false)
        var oldOwnerAtSwitch: String?
        let subscription = store.accountChanges.sink { event in
            if event.incomingOwner == "b" { oldOwnerAtSwitch = auth.session?.user.id; XCTAssertTrue(store.weights.isEmpty) }
            device.handleAccount(event)
        }
        defer { subscription.cancel() }
        try auth.completeSignIn(fixture(owner: "a", token: "a-token"))
        XCTAssertTrue(device.reminderEnabled)
        store.weights = [NativeWeight(id: "private", user_id: "a", measured_on: "2026-10-01", weight_kg: 80)]
        try auth.completeSignIn(fixture(owner: "b", token: "b-token"))
        XCTAssertEqual(oldOwnerAtSwitch, "a"); XCTAssertEqual(auth.session?.user.id, "b")
        XCTAssertTrue(store.weights.isEmpty); XCTAssertFalse(device.reminderEnabled)
        XCTAssertNil(defaults.string(forKey: "native.reminders.owner")); XCTAssertEqual(cleanups, 1)
        XCTAssertNil(defaults.object(forKey: "native.reminders.hour")); XCTAssertNil(defaults.object(forKey: "native.reminders.minute"))
        XCTAssertEqual(device.reminderHour, 18); XCTAssertEqual(device.reminderMinute, 0)
    }
    @MainActor func testRestDayAndAlternateDayPreservePerformedDateAndExistingSessionLink() async throws {
        let date = NativeDate.parse("2026-10-01")! // Thursday; routine only Monday/Tuesday.
        let monday = NativeRoutineDay(id: "mon", user_id: "u", routine_id: "r", label: "Piernas", weekday: 1)
        let tuesday = NativeRoutineDay(id: "tue", user_id: "u", routine_id: "r", label: "Torso", weekday: 2)
        XCTAssertNil(NativeWorkoutSelection.day(selectedID: "", date: date, session: nil, activeID: "r", days: [monday, tuesday]))
        let selected = NativeWorkoutSelection.day(selectedID: "mon", date: date, session: nil, activeID: "r", days: [monday, tuesday])
        XCTAssertEqual(selected?.id, "mon")
        let body = NativeWorkoutSelection.sessionBody(date: NativeDate.key(date), day: selected?.id)
        XCTAssertEqual(body["performed_on"] as? String, "2026-10-01"); XCTAssertEqual(body["routine_day_id"] as? String, "mon")
        let existing = NativeWorkoutSession(id: "saved", user_id: "u", performed_on: "2026-10-01", created_at: "", routine_day_id: "tue", notes: nil, set_count: 3)
        XCTAssertEqual(NativeWorkoutSelection.day(selectedID: "", date: date, session: existing, activeID: "r", days: [monday, tuesday])?.id, "tue")
        XCTAssertEqual(NativeWorkoutSelection.day(selectedID: "mon", date: date, session: existing, activeID: "r", days: [monday, tuesday])?.id, "mon")
        XCTAssertEqual(NativeWorkoutSelection.day(selectedID: "mon", date: date, session: existing, activeID: "other", days: [monday, tuesday])?.id, "tue")
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }; try fixture.login("u")
        let auth = fixture.auth
        var reads = 0
        let api = NativeAPI(auth: auth, network: fixture.network, pageLoader: { table, query in
            reads += 1; XCTAssertEqual(table, "sessions")
            XCTAssertEqual(query.first { $0.name == "performed_on" }?.value, "eq.2026-10-01")
            return try JSONEncoder().encode([existing])
        })
        let store = NativeStore(auth: auth, api: api, automaticallyRefresh: false, cache: NativeDataCache(directory: fixture.directory))
        let ensured = try await store.ensureSession(date: "2026-10-01", day: "mon")
        XCTAssertEqual(ensured.id, "saved"); XCTAssertEqual(ensured.routine_day_id, "tue"); XCTAssertEqual(ensured.performed_on, "2026-10-01"); XCTAssertEqual(reads, 1)
    }
    @MainActor private func delayedLogout(replacementOwner: String, responseStatus: Int) async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: configuration), capture = NativeLogoutCapture()
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let started = expectation(description: "Outgoing logout reached suspended transport")
        NativeLogoutURLProtocol.handler = { _, request in capture.put(request); started.fulfill() }
        let auth = NativeAuth(service: "f1t.p2.logout.\(UUID())", network: network)
        defer { try? auth.keychainDelete() }
        try auth.completeSignIn(fixture(owner: "same-owner", token: "outgoing-session-token"))
        let outgoing = Task { await auth.signOut() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertNil(auth.session)
        try auth.completeSignIn(fixture(owner: replacementOwner, token: "replacement-session-token"))
        auth.error = "new-session-message"
        let generation = auth.generation
        let suspended = try XCTUnwrap(capture.take())
        XCTAssertEqual(URLComponents(url: suspended.request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "scope" }?.value, "local")
        XCTAssertEqual(suspended.request.value(forHTTPHeaderField: "Authorization"), "Bearer outgoing-session-token")
        // Model the official contract: local revokes the outgoing token's session only.
        var remoteSessions: Set<String> = ["outgoing", "replacement"]
        if responseStatus == 204 { remoteSessions.remove("outgoing") }
        suspended.finish(status: responseStatus)
        await outgoing.value
        XCTAssertTrue(remoteSessions.contains("replacement"))
        XCTAssertEqual(auth.session?.user.id, replacementOwner); XCTAssertEqual(auth.session?.access_token, "replacement-session-token")
        XCTAssertEqual(auth.generation, generation); XCTAssertEqual(auth.error, "new-session-message")
        let persisted = try JSONDecoder().decode(NativeAuthSession.self, from: XCTUnwrap(auth.keychainRead()))
        XCTAssertEqual(persisted.access_token, "replacement-session-token")
    }
    @MainActor func testDelayedLocalLogoutDoesNotRevokeSameOwnerReplacementLogin() async throws { try await delayedLogout(replacementOwner: "same-owner", responseStatus: 204) }
    @MainActor func testDelayedLogoutFailureDoesNotOverwriteAnotherAccountsState() async throws { try await delayedLogout(replacementOwner: "different-owner", responseStatus: 500) }

    private struct PageRow: Decodable { let id: String }
    @MainActor private func exercisePaging(table: String, descending: Bool) async throws {
        let field = table == "weight_entries" ? "measured_on" : "created_at"
        let primary = table == "weight_entries" ? "2026-10-01" : "2026-10-01T12:34:56.123456+00:00"
        let nextPrimary = table == "weight_entries" ? "2026-09-30" : "2026-10-01T12:34:56.123457+00:00"
        func id(_ value: Int) -> String { String(format: "00000000-0000-0000-0000-%012x", value) }
        var rows = (0..<1200).map { ["id": id($0 * 4), field: $0 < 1000 ? primary : nextPrimary] }
        let originalIDs = Set(rows.compactMap { $0["id"] })
        let deletedUnseen = id((descending ? 5 : 600) * 4)
        let insertedBefore = id(descending ? 8000 : 1)
        let insertedAhead = id((descending ? 200 : 650) * 4 + 1)
        var calls = 0
        let api = NativeAPI(auth: NativeAuth(), pageLoader: { requestedTable, query in
            XCTAssertEqual(requestedTable, table)
            XCTAssertNil(query.first { $0.name == "offset" })
            XCTAssertEqual(query.first { $0.name == "order" }?.value, "\(field).\(descending ? "desc" : "asc"),id.\(descending ? "desc" : "asc")")
            if calls == 1 {
                rows.removeAll { $0["id"] == id((descending ? 999 : 0) * 4) || $0["id"] == deletedUnseen }
                rows += [["id": insertedBefore, field: primary], ["id": insertedAhead, field: primary]]
            }
            let cursorExpression = query.first { $0.name == "and" }?.value
            var filtered = rows
            if let expression = cursorExpression {
                let regex = try NSRegularExpression(pattern: #""([^"]*)""#)
                let matches = regex.matches(in: expression, range: NSRange(expression.startIndex..., in: expression))
                let values = matches.compactMap { Range($0.range(at: 1), in: expression).map { String(expression[$0]) } }
                XCTAssertEqual(values.count, 3, "Must include primary inequality and equality with unique ID tie-break")
                guard values.count == 3 else { throw NativeFailure.message("Invalid test cursor") }
                let comparison = descending ? "lt" : "gt"
                XCTAssertEqual(expression, "(or(\(field).\(comparison).\"\(values[0])\",and(\(field).eq.\"\(values[0])\",id.\(comparison).\"\(values[2])\")))")
                XCTAssertEqual(values[0], values[1])
                filtered = rows.filter { row in
                    let first = row[field]!, second = row["id"]!
                    return descending ? first < values[0] || (first == values[0] && second < values[2]) : first > values[0] || (first == values[0] && second > values[2])
                }
            } else { XCTAssertEqual(calls, 0) }
            filtered.sort { a, b in
                let av = [a[field]!, a["id"]!], bv = [b[field]!, b["id"]!]
                return descending ? bv.lexicographicallyPrecedes(av) : av.lexicographicallyPrecedes(bv)
            }
            calls += 1
            return try JSONSerialization.data(withJSONObject: Array(filtered.prefix(500)))
        })
        let result: [PageRow] = try await api.fetch(table)
        XCTAssertGreaterThanOrEqual(calls, 3)
        let actual = result.map(\.id)
        XCTAssertEqual(Set(actual).count, actual.count, "No duplicated boundary rows")
        XCTAssertEqual(Set(actual), originalIDs.subtracting([deletedUnseen]).union([insertedAhead]))
        XCTAssertFalse(actual.contains(insertedBefore), "Insertions behind the read cursor are picked up by the next refresh")
    }
    @MainActor func testWeightKeysetHandlesInsertsDeletesAndEqualDatePageBoundary() async throws { try await exercisePaging(table: "weight_entries", descending: true) }
    func testCursorContractsPreserveDateAndMergeFilters() throws {
        let plan = try NativeKeysetPlan(table: "sessions")
        let cursor = try plan.cursor(in: JSONSerialization.data(withJSONObject: [["performed_on": "2026-10-01", "id": "last"]]))
        XCTAssertEqual(cursor.values, ["2026-10-01", "last"])
        let query = try plan.query([URLQueryItem(name: "and", value: "(set_count.gt.0)"), URLQueryItem(name: "or", value: "(notes.eq.a,notes.eq.b)")], cursor: cursor)
        XCTAssertEqual(query.first { $0.name == "or" }?.value, "(notes.eq.a,notes.eq.b)")
        XCTAssertTrue(query.first { $0.name == "and" }!.value!.hasPrefix("(set_count.gt.0,or(performed_on.lt."))
        XCTAssertEqual(plan.order, "performed_on.desc,id.desc")
        XCTAssertEqual(try NativeKeysetPlan(table: "body_profile").order, "user_id.asc")
        XCTAssertThrowsError(try plan.query([URLQueryItem(name: "order", value: "id.desc")], cursor: nil))
    }
    func testAppAndWidgetBundledPrivacyManifestsDeclareOnlyActualRequiredReasons() throws {
        func categories(_ url: URL) throws -> [String: [String]] {
            let dict = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
            XCTAssertNil(dict["NSPrivacyCollectedDataTypes"], "Required-reason manifest must not invent a no-collection claim")
            let items = try XCTUnwrap(dict["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
            return try Dictionary(uniqueKeysWithValues: items.map { row in (try XCTUnwrap(row["NSPrivacyAccessedAPIType"] as? String), try XCTUnwrap(row["NSPrivacyAccessedAPITypeReasons"] as? [String])) })
        }
        let appURL = try XCTUnwrap(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let widgetURL = try XCTUnwrap(Bundle.main.builtInPlugInsURL).appendingPathComponent("WidgetExtension.appex/PrivacyInfo.xcprivacy")
        XCTAssertEqual(try categories(appURL), ["NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1"], "NSPrivacyAccessedAPICategoryFileTimestamp": ["C617.1"]])
        XCTAssertEqual(try categories(widgetURL), ["NSPrivacyAccessedAPICategoryFileTimestamp": ["C617.1"]])
    }
}

final class NativeTransportTests: XCTestCase {
    private struct Row: Decodable { let id: String }
    private static func formQuery(_ url: URL) throws -> [String: String] {
        let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery)
        func decode(_ part: Substring) throws -> String {
            // Match PostgREST parseQueryReplacePlus True: replace raw plus before percent-decoding.
            try XCTUnwrap(String(part).replacingOccurrences(of: "+", with: " ").removingPercentEncoding)
        }
        return try Dictionary(uniqueKeysWithValues: query.split(separator: "&").map { item in
            let parts = item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            return (try decode(parts[0]), try decode(parts[1]))
        })
    }
    @MainActor private func checkSecondPage(timestamp: String) async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: config)
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let auth = NativeAuth(service: "f1t.transport.\(UUID())")
        defer { try? auth.keychainDelete() }
        try auth.completeSignIn(NativeAuthSession(access_token: "isolated-fixture", refresh_token: "unused", expires_in: 3600,
             expires_at: Date().timeIntervalSince1970 + 3600, user: NativeAuthUser(id: "transport-fixture", email: nil)))
        let plan = try NativeKeysetPlan(table: "sessions")
        let filter = "eq.literal+%2B%25%20 & = # ? café (x,y)"
        let query = [URLQueryItem(name: "notes", value: filter), URLQueryItem(name: "or", value: "(notes.eq.a,notes.eq.b)")]
        let rows = (0..<502).map { ["id": String(format: "00000000-0000-0000-0000-%012x", 501 - $0), "performed_on": timestamp] }
        let firstData = try JSONSerialization.data(withJSONObject: Array(rows.prefix(500)))
        let secondData = try JSONSerialization.data(withJSONObject: Array(rows.suffix(2)))
        let expectedQuery = try plan.query(query, cursor: NativePageCursor(values: [timestamp, rows[499]["id"]!]))
        var calls = 0
        NativeLogoutURLProtocol.handler = { request, transport in
            do {
                calls += 1
                let url = try XCTUnwrap(request.url)
                XCTAssertEqual(url.path, "/rest/v1/sessions"); XCTAssertEqual(request.httpMethod, "GET")
                let encoded = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery)
                XCTAssertFalse(encoded.contains("+"), "Final outgoing query must not contain form-decoded plus signs")
                XCTAssertTrue(encoded.contains("%252B%2525%2520"), "Already-percent literals must remain literal, not be decoded before encoding")
                let decoded = try Self.formQuery(url)
                XCTAssertEqual(decoded["notes"], filter)
                XCTAssertEqual(decoded["or"], "(notes.eq.a,notes.eq.b)")
                XCTAssertEqual(decoded["order"], "performed_on.desc,id.desc"); XCTAssertEqual(decoded["limit"], "500")
                if calls == 2 {
                    XCTAssertEqual(decoded, Dictionary(uniqueKeysWithValues: expectedQuery.map { ($0.name, $0.value!) }))
                    XCTAssertTrue(decoded["and"]!.contains(timestamp), "Date survives the actual HTTP serialization")
                } else { XCTAssertEqual(calls, 1); XCTAssertNil(decoded["and"]) }
                transport.finish(status: 200, data: calls == 1 ? firstData : secondData)
            } catch {
                XCTFail("Invalid captured final request: \(error)")
                transport.finish(status: 400)
            }
        }
        // No pageLoader: exercise NativeAPI.request -> URLSession -> captured final URLRequest.
        let api = NativeAPI(auth: auth, network: network)
        let result: [Row] = try await api.fetch("sessions", query: query)
        XCTAssertEqual(calls, 2); XCTAssertEqual(result.count, 502)
        XCTAssertEqual(result.map(\.id), rows.map { $0["id"]! })
    }
    @MainActor func testActualSecondPageRequestPreservesDateAndPercentLiterals() async throws {
        try await checkSecondPage(timestamp: "2026-10-01")
    }
}

final class NativeOAuthCallbackTests: XCTestCase {
    private func failure(_ text: String, _ reason: NativeCallbackReason) throws -> NativeCallbackFailure {
        do { _ = try NativeOAuthCallback.code(from: XCTUnwrap(URL(string: text))); XCTFail("Unsafe callback accepted") }
        catch let error as NativeCallbackFailure { XCTAssertEqual(error.reason, reason); return error }
        throw NativeFailure.message("Expected typed callback rejection")
    }
    func testTypicalPKCEReturnAndHarmlessEmptyFragmentWithMetadata() throws {
        for text in ["f1t://auth/callback?code=fixture", "f1t://auth/callback?code=fixture#",
                     "f1t://auth/callback?sb_flow_id=optional&code=fixture&state=metadata#"] {
            XCTAssertEqual(try NativeOAuthCallback.code(from: XCTUnwrap(URL(string: text))), "fixture")
        }
        XCTAssertEqual(try NativeOAuthCallback.code(from: XCTUnwrap(URL(string: "f1t://auth/callback?code=a%2Bb%252B#"))), "a+b%2B")
    }
    func testOfficialErrorMirrorsAndFragmentOnlyErrorsHaveSafeWhitelistMessages() throws {
        let description = "private_email@example.invalid%20private-token"
        _ = try failure("f1t://auth/callback?error=access_denied&error_description=\(description)#error=access_denied&error_description=\(description)&sb=", .accessDenied)
        _ = try failure("f1t://auth/callback#error=access_denied&sb=", .accessDenied)
        _ = try failure("f1t://auth/callback?error=access_denied&error_description=private_email%40example.invalid#error=access_denied&error_description=private_email%2540example.invalid&sb=", .accessDenied)
        _ = try failure("f1t://auth/callback?error=server_error&error_code=signup_disabled", .signupDisabled)
        _ = try failure("f1t://auth/callback?error=access_denied&error_code=user_banned", .userBanned)
        _ = try failure("f1t://auth/callback#error=server_error&error_code=unexpected_failure&sb=", .providerUnavailable)
        _ = try failure("f1t://auth/callback?error=temporarily_unavailable", .providerUnavailable)
        let unknown = try failure("f1t://auth/callback?error_code=private-token&error_description=\(description)", .providerError)
        XCTAssertFalse(unknown.localizedDescription.contains("private-token")); XCTAssertFalse(unknown.localizedDescription.contains("example.invalid"))
    }
    func testDuplicateConflictingCodesAndErrorsAreRejected() throws {
        for text in ["f1t://auth/callback?code=a&code=a", "f1t://auth/callback?code=a&%63ode=b", "f1t://auth/callback?code=a#code=b"] {
            _ = try failure(text, .duplicateCode)
        }
        _ = try failure("f1t://auth/callback#code=a", .forbiddenFragment)
        _ = try failure("f1t://auth/callback?code=a&error=access_denied", .conflictingErrors)
        _ = try failure("f1t://auth/callback?error=access_denied#error=server_error&sb=", .conflictingErrors)
        _ = try failure("f1t://auth/callback?error=access_denied&error=access_denied", .conflictingErrors)
    }
    func testExactRouteCodeAndTokenOrUnknownFragmentsStayProtected() throws {
        for text in ["https://auth/callback?code=a", "f1t://evil/callback?code=a", "f1t://auth/callback/extra?code=a",
                     "f1t://user@auth/callback?code=a", "f1t://auth:443/callback?code=a", "f1t://auth/%63allback?code=a"] {
            _ = try failure(text, .route)
        }
        _ = try failure("f1t://auth/callback", .missingCode)
        _ = try failure("f1t://auth/callback?code=", .emptyCode)
        _ = try failure("f1t://auth/callback?code=%20", .emptyCode)
        _ = try failure("f1t://auth/callback?code=a+b", .format)
        _ = try failure("f1t://auth/callback?code=%FF", .format)
        for text in ["f1t://auth/callback?code=a#access_token=secret", "f1t://auth/callback?code=a&refresh_token=secret", "f1t://auth/callback?code=a#%61ccess_token=secret", "f1t://auth/callback?error=access_denied#id_token=secret"] {
            _ = try failure(text, .tokens)
        }
        for text in ["f1t://auth/callback?code=a#arbitrary=secret", "f1t://auth/callback?code=a#sb=", "f1t://auth/callback?code=a#%23", "f1t://auth/callback?code=a#code_verifier=secret"] {
            _ = try failure(text, text.contains("code_verifier") ? .tokens : .forbiddenFragment)
        }
    }
    func testSanitizedShapeContainsOnlyMatchFlagsCountsAndCategories() throws {
        let a = try failure("f1t://wrong-private-host/private-email@example.invalid?code=private-code#access_token=private-token", .route)
        XCTAssertEqual(a.shape.summary, "s=1,h=0,p=0,c=1,f=tokens")
        for value in ["wrong-private-host", "private-email", "private-code", "private-token", "f1t://"] { XCTAssertFalse(a.localizedDescription.contains(value)) }
        let b = try failure("f1t://auth/callback?error=unrecognized-private-value#sb=&error=unrecognized-private-value", .providerError)
        XCTAssertEqual(b.shape.fragment, .providerError); XCTAssertFalse(b.localizedDescription.contains("unrecognized-private-value"))
    }
    @MainActor func testActualPKCERequestUsesS256AndLocalVerifierWithAcceptedCallback() async throws {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let base = URL(string: "https://example.supabase.co")!
        let url = NativeOAuthRequest.authorizationURL(baseURL: base, redirectTo: "f1t://auth/callback", challenge: NativeAuth.challenge(verifier))
        let params = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
        XCTAssertEqual(url.path, "/auth/v1/authorize"); XCTAssertEqual(params["provider"], "google")
        XCTAssertEqual(params["redirect_to"], "f1t://auth/callback"); XCTAssertEqual(params["code_challenge_method"], "s256")
        XCTAssertEqual(params["code_challenge"], "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        var calls = 0
        NativeLogoutURLProtocol.handler = { request, transport in
            calls += 1
            XCTAssertEqual(request.httpMethod, "POST"); XCTAssertEqual(request.url?.path, "/auth/v1/token")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "grant_type", value: "pkce")])
            let data = request.httpBody ?? request.httpBodyStream.flatMap { stream -> Data? in
                stream.open(); defer { stream.close() }; var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
                return data
            }
            let body = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
            XCTAssertEqual(body, ["auth_code": "fixture-code", "code_verifier": verifier])
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let response = NativeAuthSession(access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600,
                expires_at: Date().timeIntervalSince1970 + 3600, user: NativeAuthUser(id: "fixture", email: nil))
            transport.finish(status: 200, data: try! JSONEncoder().encode(response))
        }
        let auth = NativeAuth(service: "f1t.oauth-contract.\(UUID())", network: network)
        let response = try await auth.exchangePKCECallback(URL(string: "f1t://auth/callback?code=fixture-code&sb_flow_id=ignored-metadata#")!, verifier: verifier)
        XCTAssertEqual(response.user.id, "fixture"); XCTAssertEqual(calls, 1); XCTAssertNil(auth.session)
    }
    @MainActor func testRejectedCallbackNeverStartsTokenExchange() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        var calls = 0
        NativeLogoutURLProtocol.handler = { _, transport in calls += 1; transport.finish(status: 400) }
        let auth = NativeAuth(network: network)
        for text in ["f1t://auth/callback?error=access_denied", "f1t://auth/callback?code=a&code=b", "f1t://auth/callback?code=a#access_token=secret"] {
            do { _ = try await auth.exchangePKCECallback(URL(string: text)!, verifier: "local-test-verifier"); XCTFail("Invalid callback exchanged") }
            catch { XCTAssertTrue(error is NativeCallbackFailure) }
        }
        XCTAssertEqual(calls, 0); XCTAssertNil(auth.session)
    }
}

// Local-only fixture: no bootstrap, sign-in, refresh or remote writes.
final class NativeScrollLayoutTests: XCTestCase {
    @MainActor func testTodayFinalActionClearsNavigationOnCompactLayout() throws {
        try assertTodayLayout(size: CGSize(width: 375, height: 667), bottomSafeArea: 0)
    }
    @MainActor func testTodayFinalActionClearsNavigationWithHomeIndicator() throws {
        try assertTodayLayout(size: CGSize(width: 430, height: 932), bottomSafeArea: 34)
    }

    @MainActor func testTallWorkoutFinalActionClearsNavigationOnCompactLayout() throws {
        try assertTodayLayout(size: CGSize(width: 375, height: 667), bottomSafeArea: 0, tallWorkout: true)
    }
    @MainActor func testTallWorkoutFinalActionClearsNavigationWithHomeIndicator() throws {
        try assertTodayLayout(size: CGSize(width: 430, height: 932), bottomSafeArea: 34, tallWorkout: true)
    }

    @MainActor private func assertTodayLayout(size: CGSize, bottomSafeArea: CGFloat, tallWorkout: Bool = false) throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }; try fixture.login("local")
        let store = fixture.store()
        let routine = NativeRoutine(id: "fixture", user_id: "local", name: "Local", created_at: "", is_active: true)
        store.routines = [routine]
        store.days = [NativeRoutineDay(id: "day", user_id: "local", routine_id: routine.id, label: "Fixture", weekday: NativeDate.weekday(Date()))]
        let exercise = try XCTUnwrap(store.exercises.first)
        store.routineExercises = (0..<(tallWorkout ? 1 : 16)).map { index in
            NativeRoutineExercise(id: "item-\(index)", user_id: "local", routine_day_id: "day",
                exercise_id: tallWorkout ? exercise.id : store.exercises[index].id, position: index,
                target_sets: tallWorkout ? 24 : 3, target_reps: "10", notes: nil)
        }
        store.loaded = true
        // The compact summary no longer supplies a tall exercise fixture. Keep
        // the actual shell regression and exercise max-scroll on the shared editor.
        let root: AnyView = tallWorkout ? AnyView(VStack(spacing: 0) {
            NavigationStack { NativeWorkoutView(date: Date(), dayID: "day") }
            FitBottomNav(selection: .today) { _ in }.fixedSize(horizontal: false, vertical: true)
        }) : AnyView(NativeTabsView(store: store, auth: store.auth))
        let controller = UIHostingController(rootView: root.environmentObject(store))
        controller.overrideUserInterfaceStyle = .light
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let oldKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; oldKeyWindow?.makeKeyAndVisible() }
        settle(controller)
        // Small test windows are not at the physical scene's bottom. Supply the
        // requested home-indicator region through UIKit, just as the real host does.
        controller.additionalSafeAreaInsets.bottom += bottomSafeArea - controller.view.safeAreaInsets.bottom
        settle(controller)
        XCTAssertEqual(controller.view.safeAreaInsets.bottom, bottomSafeArea, accuracy: 0.5)
        let navHost = UIHostingController(rootView: FitBottomNav(selection: .today) { _ in })
        let navHeight = navHost.sizeThatFits(in: CGSize(width: size.width, height: 1000)).height
        let navTop = size.height - bottomSafeArea - navHeight
        let scrolls = descendants(controller.view).compactMap { $0 as? UIScrollView }
            .filter { $0.contentSize.height > 0 && abs($0.bounds.width - size.width) < 0.5 }
        XCTAssertEqual(scrolls.count, 1, "Only the initially visited page should mount in the reserved viewport")
        let today = try XCTUnwrap(scrolls.first)
        if tallWorkout { XCTAssertGreaterThan(today.contentSize.height, today.bounds.height + 300, "Fixture must actually exercise max-scroll") }
        XCTAssertGreaterThan(navHeight, 44)
        // Every mounted tab's scrolling page must stop above the same fixed bar.
        for scroll in scrolls {
            XCTAssertLessThanOrEqual(scroll.convert(scroll.bounds, to: window).maxY - scroll.adjustedContentInset.bottom, navTop + 0.5)
        }
        today.setContentOffset(CGPoint(x: 0, y: today.contentSize.height - today.bounds.height + today.adjustedContentInset.bottom), animated: false)
        settle(controller)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let shot = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: shot)
        attachment.name = "\(tallWorkout ? "Workout" : "Today")-bottom-\(Int(size.width))x\(Int(size.height))"
        attachment.lifetime = .keepAlways
        add(attachment)
        let finalContentBottom = today.convert(CGPoint(x: 0, y: today.contentSize.height), to: window).y
        XCTAssertLessThanOrEqual(finalContentBottom, navTop + 0.5, "The final page content must remain above fixed navigation at max scroll")
        XCTAssertGreaterThanOrEqual(finalContentBottom, navTop - 2, "Max scroll must reach the final content rather than clipping it")
        if tallWorkout {
            // Scan the solid left side of the actual orange training action. An
            // overlapping tab bar clips this to ~16pt in the original layout.
            let image = try XCTUnwrap(shot.cgImage)
            var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
            let context = try XCTUnwrap(CGContext(data: &pixels, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            let orangeRows = (0..<Int(navTop)).filter { y in
                let i = (y * image.width + 32) * 4
                return pixels[i] > 150 && pixels[i + 1] < 130 && pixels[i + 2] < 90
            }
            let last = try XCTUnwrap(orangeRows.last)
            var first = last
            while orangeRows.contains(first - 1) { first -= 1 }
            XCTAssertGreaterThanOrEqual(last - first + 1, 42, "Entire training control must be visible, not just its top edge")
            XCTAssertLessThanOrEqual(CGFloat(last + 1), navTop, "The recording control must clear the fixed navigation bar")
            let point = CGPoint(x: size.width / 2, y: CGFloat(first + last) / 2)
            let hit = try XCTUnwrap(window.hitTest(point, with: nil))
            XCTAssertTrue(hit === today || hit.isDescendant(of: today), "Training action must receive touches in the page, not the fixed nav")
            print("FIT layout \(Int(size.width))x\(Int(size.height)): safeBottom=\(bottomSafeArea), navTop=\(navTop), actionY=\(first)...\(last), scrollBottom=\(today.convert(today.bounds, to: window).maxY)")
        }
        if tallWorkout { return }
        let originalHeight = today.bounds.height - today.adjustedContentInset.bottom
        let originalTopInset = today.adjustedContentInset.top
        NotificationCenter.default.post(name: UIResponder.keyboardWillShowNotification, object: nil)
        settle(controller)
        XCTAssertEqual(today.bounds.height - today.adjustedContentInset.bottom, originalHeight + navHeight, accuracy: 1)
        XCTAssertEqual(today.adjustedContentInset.top, originalTopInset, accuracy: 0.5)
        NotificationCenter.default.post(name: UIResponder.keyboardWillHideNotification, object: nil)
        settle(controller)
        XCTAssertEqual(today.bounds.height - today.adjustedContentInset.bottom, originalHeight, accuracy: 1)
        XCTAssertTrue(descendants(controller.view).contains { $0 === today }, "Keyboard changes must not reset the tab stack")
        XCTAssertEqual(store.auth.session?.user.id, "local")
    }
    @MainActor private func settle(_ controller: UIViewController) {
        controller.view.setNeedsLayout(); controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        controller.view.layoutIfNeeded()
    }
    @MainActor private func descendants(_ view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap(descendants)
    }
}

final class NativeGuidedWorkoutTests: XCTestCase {
    private func item(_ id: String, sets: Int?, position: Int = 0) -> NativeRoutineExercise {
        NativeRoutineExercise(id: "plan-\(id)", user_id: "local", routine_day_id: "day", exercise_id: id,
            position: position, target_sets: sets, target_reps: "10", notes: nil)
    }
    private func set(_ exercise: String, _ index: Int, id: String = UUID().uuidString) -> NativeSet {
        NativeSet(id: id, user_id: "local", session_id: "session", exercise_id: exercise, set_index: index, reps: 10, weight_kg: 20)
    }
    @MainActor func testHistoryRemainsDefaultAndUngated() {
        XCTAssertEqual(NativeWorkoutView(date: Date()).mode, .history)
        XCTAssertEqual(NativeWorkoutView(date: Date(), mode: .guided).mode, .guided)
        let history = NativeExerciseLog(exerciseID: "old", target: nil, done: [set("old", 4)], past: [], date: "2020-01-01", dayID: nil)
        XCTAssertFalse(history.guided)
    }
    func testDistinctRequiredIndexesRejectHolesDuplicatesAndExtras() {
        XCTAssertFalse(NativeWorkoutProgress.complete(target: 3, indexes: [0, 0, 2]))
        XCTAssertFalse(NativeWorkoutProgress.complete(target: 3, indexes: [0, 2, 3, 4]))
        XCTAssertFalse(NativeWorkoutProgress.complete(target: 3, indexes: [-1, 0, 1]))
        XCTAssertTrue(NativeWorkoutProgress.complete(target: 3, indexes: [2, 0, 1, 1, 9]))
    }
    func testFiniteFallbackIsOneDisplayedRequiredSet() {
        for target: Int? in [nil, 0, -1] {
            XCTAssertEqual(NativeWorkoutProgress.goal(target), 1)
            XCTAssertFalse(NativeWorkoutProgress.complete(target: target, indexes: []))
            XCTAssertTrue(NativeWorkoutProgress.complete(target: target, indexes: [0]))
        }
    }
    func testSequentialExplicitNextAndResume() {
        let plan = [item("first", sets: 2), item("second", sets: 1, position: 1)]
        var saved = [set("first", 0)]
        var cursor = NativeGuidedCursor(plan: plan, sets: saved)
        cursor.next(plan: plan, sets: saved)
        XCTAssertEqual(cursor.currentID, "first", "Next must be blocked with an incomplete current exercise")
        saved.append(set("first", 1))
        XCTAssertEqual(cursor.currentID, "first", "Successful final set must not automatically advance; rest stays visible")
        XCTAssertEqual(NativeGuidedCursor(plan: plan, sets: saved).currentID, "second", "Leaving/reopening resumes first unfinished")
        cursor.next(plan: plan, sets: saved)
        XCTAssertEqual(cursor.currentID, "second")
        saved.append(set("second", 0))
        cursor.next(plan: plan, sets: saved)
        XCTAssertNil(cursor.currentID, "Last Next leads to completion summary")
        XCTAssertNil(NativeGuidedCursor(plan: plan, sets: saved).currentID, "All-complete reopen is completion, not a dead end")
    }
    func testSameSessionEarlierRequiredSetRemovalRewindsCursor() {
        let plan = [item("first", sets: 2), item("second", sets: 1, position: 1)]
        var saved = [set("first", 0), set("first", 1)]
        var cursor = NativeGuidedCursor(plan: plan, sets: saved)
        XCTAssertEqual(cursor.currentID, "second")
        saved.removeAll { $0.exercise_id == "first" && $0.set_index == 1 }
        XCTAssertEqual(Set(saved.map(\.session_id)), ["session"], "History edit does not change session identity")
        XCTAssertTrue(cursor.reconcile(plan: plan, sets: saved))
        XCTAssertEqual(cursor.currentID, "first")
        cursor.next(plan: plan, sets: saved)
        XCTAssertEqual(cursor.currentID, "first", "Missing required index locks Next again")
    }
    func testReconciliationDoesNotAdvanceFinalSetOrCancelItsRest() {
        let plan = [item("first", sets: 1), item("second", sets: 1, position: 1)]
        var saved: [NativeSet] = []
        var cursor = NativeGuidedCursor(plan: plan, sets: saved)
        var clock = NativeRestClock(scope: "session")
        saved.append(set("first", 0))
        clock.record(.newSet, succeeded: true, scope: "session", minutes: 2)
        let end = clock.end
        if cursor.reconcile(plan: plan, sets: saved) { clock.cancel() }
        XCTAssertEqual(cursor.currentID, "first")
        XCTAssertEqual(clock.end, end)
        cursor.next(plan: plan, sets: saved)
        saved.append(set("second", 0))
        XCTAssertFalse(cursor.reconcile(plan: plan, sets: saved))
        XCTAssertEqual(cursor.currentID, "second", "Last exercise also needs explicit completion")
        cursor.next(plan: plan, sets: saved)
        XCTAssertNil(cursor.currentID)
        saved.removeAll { $0.exercise_id == "first" }
        XCTAssertTrue(cursor.reconcile(plan: plan, sets: saved))
        XCTAssertEqual(cursor.currentID, "first", "Completion screen must recover after a history correction")
    }
    func testDuplicatePlanIDsRemovedAndRemovedExercisesDoNotGate() {
        let plan = [item("first", sets: 2), item("first", sets: 2), item("second", sets: 1)]
        XCTAssertEqual(NativeWorkoutProgress.ids(plan), ["first", "second"])
        let saved = [set("first", 0), set("first", 1), set("second", 0), set("removed", 0)]
        XCTAssertNil(NativeWorkoutProgress.firstUnfinished(plan: plan, sets: saved))
        XCTAssertEqual(NativeGuidedCursor(plan: [item("new", sets: 1)], sets: saved).currentID, "new")
        XCTAssertEqual(NativeGuidedCursor(plan: [item("first", sets: 3)], sets: saved).currentID, "first")
    }
    func testRestBoundsAndHalfMinuteSteps() {
        XCTAssertEqual(NativeRestClock.minutes(.nan), 2)
        XCTAssertEqual(NativeRestClock.minutes(.infinity), 2)
        XCTAssertEqual(NativeRestClock.minutes(0), 0.5)
        XCTAssertEqual(NativeRestClock.minutes(100), 10)
        XCTAssertEqual(NativeRestClock.minutes(2.26), 2.5)
        XCTAssertEqual(NativeRestClock.minutes(2), 2)
    }
    func testRestOnlyNewSuccessfulSetStartsOrRestarts() {
        let now = Date(timeIntervalSince1970: 1000)
        var clock = NativeRestClock(scope: "account|day|date")
        clock.record(.newSet, succeeded: false, scope: clock.scope, minutes: 2, now: now)
        XCTAssertNil(clock.end)
        clock.record(.edit, succeeded: true, scope: clock.scope, minutes: 2, now: now)
        clock.record(.untick, succeeded: true, scope: clock.scope, minutes: 2, now: now)
        XCTAssertNil(clock.end)
        clock.record(.newSet, succeeded: true, scope: clock.scope, minutes: 2, now: now)
        XCTAssertEqual(clock.text(at: now), "02:00")
        let end = clock.end
        clock.record(.edit, succeeded: true, scope: clock.scope, minutes: 10, now: now.addingTimeInterval(5))
        clock.record(.untick, succeeded: true, scope: clock.scope, minutes: 10, now: now.addingTimeInterval(5))
        clock.record(.newSet, succeeded: false, scope: clock.scope, minutes: 10, now: now.addingTimeInterval(5))
        XCTAssertEqual(clock.end, end)
        clock.record(.newSet, succeeded: true, scope: clock.scope, minutes: 0.5, now: now.addingTimeInterval(5))
        XCTAssertEqual(clock.end, now.addingTimeInterval(35))
    }
    func testRestElapsedWallClockSurvivesBackgroundAndExpires() {
        let now = Date(timeIntervalSince1970: 1000)
        var clock = NativeRestClock(scope: "one")
        clock.record(.newSet, succeeded: true, scope: "one", minutes: 2, now: now)
        XCTAssertEqual(clock.text(at: now.addingTimeInterval(65.2)), "00:55")
        XCTAssertEqual(clock.text(at: now.addingTimeInterval(120)), "00:00")
        XCTAssertEqual(clock.remaining(at: now.addingTimeInterval(3600)), 0)
    }
    func testRestCancellationAndScopeRejectStaleCallbacks() {
        var clock = NativeRestClock(scope: "ownerA|dateA|dayA")
        clock.record(.newSet, succeeded: true, scope: clock.scope, minutes: 2)
        clock.changeScope("ownerA|dateA|dayA")
        XCTAssertNotNil(clock.end, "Same-scope refresh must not reset rest")
        clock.cancel(); XCTAssertNil(clock.end)
        clock.record(.newSet, succeeded: true, scope: clock.scope, minutes: 2)
        clock.changeScope("ownerB|dateB|dayB")
        XCTAssertNil(clock.end)
        clock.record(.newSet, succeeded: true, scope: "ownerA|dateA|dayA", minutes: 2)
        XCTAssertNil(clock.end)
    }
    @MainActor func testSuccessfulSetAcknowledgedBeforeFailedRefreshAndEditDoesNotRestart() async throws {
        try await checkAcknowledgement(failingWrite: false)
    }
    @MainActor func testFailedRemoteSetWriteKeepsDurableLocalProgressAndRest() async throws {
        try await checkAcknowledgement(failingWrite: true)
    }
    @MainActor private func checkAcknowledgement(failingWrite: Bool) async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        try fixture.login("local")
        let session = NativeWorkoutSession(id: "session", user_id: "local", performed_on: "2026-10-05", created_at: "", routine_day_id: "day", notes: nil, set_count: 0)
        let api = NativeAPI(auth: fixture.auth, network: fixture.network, pageLoader: { table, _ in
            if table == "sessions" { return try JSONEncoder().encode([session]) }
            throw NativeFailure.message("Local fixture refresh failed")
        })
        let store = NativeStore(auth: fixture.auth, api: api, automaticallyRefresh: false, cache: NativeDataCache(directory: fixture.directory))
        defer { store.workoutReplayTask?.cancel(); store.workoutRetryTask?.cancel() }
        store.loaded = true
        var starts = 0
        let calls = NativeOfflineRequests(), row = set("exercise", 0, id: "persisted-id")
        let data = try JSONEncoder().encode([row])
        NativeOfflineURLProtocol.handle { request, transport in
            calls.append(transport)
            XCTAssertEqual(request.httpMethod, "POST"); XCTAssertEqual(request.url?.path, "/rest/v1/session_sets")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Prefer"), "return=representation,resolution=merge-duplicates")
            transport.finish(failingWrite ? 500 : 201, failingWrite ? Data() : data)
        }
        func write() async -> String? {
            let action = NativeWorkoutAction(auth: fixture.auth)
            return await store.attempt(action: action) {
                try await store.saveWorkoutSet(action: action, exerciseID: "exercise", index: 0, date: "2026-10-05", dayID: "day", reps: 10, weight: 20) {
                    starts += 1
                    XCTAssertEqual(try? store.workoutRepository.read(owner: "local").outbox.count, 1, "Rest follows durable local commit, before remote acknowledgement")
                    XCTAssertTrue(NativeWorkoutProgress.complete(target: 1, indexes: store.sets.map(\.set_index)))
                }
            }
        }
        let error = await write()
        XCTAssertNil(error); XCTAssertEqual(starts, 1); XCTAssertEqual(store.sets.count, 1)
        XCTAssertEqual(store.sessions.first?.set_count, 1)
        await store.workoutReplayTask?.value
        store.workoutRetryTask?.cancel(); store.workoutRetryTask = nil
        XCTAssertEqual(calls.all.count, 1)
        if failingWrite {
            XCTAssertNotNil(store.workoutSyncError)
            XCTAssertEqual(try store.workoutRepository.read(owner: "local").outbox.count, 1)
            XCTAssertEqual(store.sets.first?.reps, 10, "Remote failure does not erase an accepted local set")
            XCTAssertNil(NativeGuidedCursor(plan: [item("exercise", sets: 1)], sets: store.sets).currentID)
        } else {
            XCTAssertTrue(try store.workoutRepository.read(owner: "local").outbox.isEmpty)
            XCTAssertEqual(store.sets.first?.id, "persisted-id")
            await store.refresh()
            XCTAssertNotNil(store.error, "A failed account GET stays visible without undoing the acknowledged set")
            XCTAssertEqual(store.sets.first?.id, "persisted-id")
            let editError = await write()
            XCTAssertNil(editError); XCTAssertEqual(starts, 1, "Editing a durable index must not start a second rest")
            await store.workoutReplayTask?.value
            XCTAssertEqual(store.sets.count, 1)
        }
        store.busy = true
        var entered = false
        let busyError = await store.attempt { entered = true }
        XCTAssertNotNil(busyError); XCTAssertFalse(entered, "Concurrent wrappers cannot queue another mutation")
        store.busy = false
    }

    @MainActor private func login(_ auth: NativeAuth, owner: String) throws {
        try auth.completeSignIn(NativeAuthSession(access_token: "fixture-\(owner)", refresh_token: "unused", expires_in: 3600,
            expires_at: Date().timeIntervalSince1970 + 3600, user: NativeAuthUser(id: owner, email: nil)))
    }
    @MainActor func testQueuedSetActionsRejectReplacementAccountBeforeStarting() async throws {
        try await checkQueuedActions(replacement: "B")
    }
    @MainActor func testQueuedSetActionsRejectSameOwnerReplacementGeneration() async throws {
        try await checkQueuedActions(replacement: "A")
    }
    @MainActor private func checkQueuedActions(replacement: String) async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: config)
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let auth = NativeAuth(service: "f1t.queued.\(UUID())")
        defer { try? auth.keychainDelete() }
        var reads = 0, requests = 0, callbacks = 0, entered = 0
        let api = NativeAPI(auth: auth, network: network, pageLoader: { _, _ in
            reads += 1
            return Data("[]".utf8)
        })
        let store = NativeStore(auth: auth, api: api, automaticallyRefresh: false)
        NativeLogoutURLProtocol.handler = { _, transport in requests += 1; transport.finish(status: 500) }
        // All row submission sites use this synchronous capture/scheduling helper.
        for kind in ["log", "unlog", "retry-log", "retry-unlog", "blur-save"] {
            try login(auth, owner: "A")
            let saved = set("exercise", 0, id: "shared-id")
            let task = store.enqueueWorkoutAction { action in
                entered += 1
                _ = await store.attempt(action: action) {
                    if kind.contains("unlog") { try await store.removeWorkoutSet(action: action, saved: saved) }
                    else {
                        try await store.saveWorkoutSet(action: action, exerciseID: "exercise", index: 0, date: "2026-10-05", dayID: "day", reps: 10, weight: 20) { callbacks += 1 }
                    }
                }
            }
            // No suspension: replace login before the queued MainActor Task can run.
            try login(auth, owner: replacement)
            store.sets = [saved]; store.error = "incoming-error"; store.busy = true
            await task.value
            XCTAssertEqual(store.sets.map(\.id), ["shared-id"], kind)
            XCTAssertTrue(store.sessions.isEmpty, kind)
            XCTAssertEqual(store.error, "incoming-error", kind)
            XCTAssertTrue(store.busy, kind)
        }
        XCTAssertEqual(entered, 0); XCTAssertEqual(reads, 0); XCTAssertEqual(requests, 0); XCTAssertEqual(callbacks, 0)
    }
    @MainActor func testAccountSwitchDuringSessionLookupNeverStartsSetWrite() async throws {
        try await checkSuspendedLookup(existing: true)
    }
    @MainActor func testAccountSwitchDuringEmptySessionLookupNeverCreatesSession() async throws {
        try await checkSuspendedLookup(existing: false)
    }
    @MainActor private func checkSuspendedLookup(existing: Bool) async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: config)
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let auth = NativeAuth(service: "f1t.lookup.\(UUID())")
        defer { try? auth.keychainDelete() }
        try login(auth, owner: "A")
        let started = expectation(description: "Session lookup suspended")
        var continuation: CheckedContinuation<Data, Never>?
        var reads = 0, requests = 0, callbacks = 0
        let session = NativeWorkoutSession(id: "session", user_id: "A", performed_on: "2026-10-05", created_at: "", routine_day_id: "day", notes: nil, set_count: 0)
        let api = NativeAPI(auth: auth, network: network, pageLoader: { table, _ in
            reads += 1; XCTAssertEqual(table, "sessions")
            return await withCheckedContinuation { continuation = $0; started.fulfill() }
        })
        let store = NativeStore(auth: auth, api: api, automaticallyRefresh: false)
        NativeLogoutURLProtocol.handler = { _, transport in requests += 1; transport.finish(status: 500) }
        let task = store.enqueueWorkoutAction { action in
            do {
                try await store.saveWorkoutSet(action: action, exerciseID: "exercise", index: 0, date: "2026-10-05", dayID: "day", reps: 10, weight: 20) { callbacks += 1 }
            } catch { if action.isCurrent(in: auth) { XCTFail("Outgoing local command failed unexpectedly") } }
        }
        await fulfillment(of: [started], timeout: 3)
        let outgoingReplay = store.workoutReplayTask
        XCTAssertEqual(callbacks, 1, "A's local commit occurred before its suspended remote lookup")
        try login(auth, owner: "B")
        store.error = "incoming-error"; store.busy = true
        let sentinel = set("incoming", 0)
        store.sets = [sentinel]
        try XCTUnwrap(continuation).resume(returning: JSONEncoder().encode(existing ? [session] : []))
        await task.value; await outgoingReplay?.value
        XCTAssertEqual(reads, 1); XCTAssertEqual(requests, 0); XCTAssertEqual(callbacks, 1)
        XCTAssertEqual(store.sets.map(\.id), [sentinel.id]); XCTAssertTrue(store.sessions.isEmpty)
        XCTAssertEqual(store.error, "incoming-error"); XCTAssertTrue(store.busy)
    }
    @MainActor func testAccountSwitchDuringSetPostRejectsAcknowledgementAndRest() async throws {
        try await checkSuspendedMutation(unlog: false)
    }
    @MainActor func testAccountSwitchDuringSetDeletePreservesIncomingLocalRows() async throws {
        try await checkSuspendedMutation(unlog: true)
    }
    @MainActor private func checkSuspendedMutation(unlog: Bool) async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: config), capture = NativeLogoutCapture()
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let auth = NativeAuth(service: "f1t.mutation.\(UUID())")
        defer { try? auth.keychainDelete() }
        try login(auth, owner: "A")
        let session = NativeWorkoutSession(id: "session", user_id: "A", performed_on: "2026-10-05", created_at: "", routine_day_id: "day", notes: nil, set_count: 1)
        var reads = 0, requests = 0, callbacks = 0
        let api = NativeAPI(auth: auth, network: network, pageLoader: { table, _ in
            reads += 1; XCTAssertEqual(table, "sessions")
            return try JSONEncoder().encode([session])
        })
        let store = NativeStore(auth: auth, api: api, automaticallyRefresh: false)
        let saved = NativeSet(id: "shared-id", user_id: "A", session_id: session.id, exercise_id: "exercise", set_index: 0, reps: 10, weight_kg: 20)
        if unlog { store.sessions = [session]; store.sets = [saved] }
        let started = expectation(description: "Outgoing set mutation suspended")
        NativeLogoutURLProtocol.handler = { request, transport in
            requests += 1
            XCTAssertEqual(request.httpMethod, unlog ? "DELETE" : "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-A")
            capture.put(transport); started.fulfill()
        }
        let task = store.enqueueWorkoutAction { action in
            do {
                if unlog { try await store.removeWorkoutSet(action: action, saved: saved) }
                else {
                    try await store.saveWorkoutSet(action: action, exerciseID: "exercise", index: 0, date: "2026-10-05", dayID: "day", reps: 10, weight: 20) { callbacks += 1 }
                }
            } catch { if action.isCurrent(in: auth) { XCTFail("Outgoing local command failed unexpectedly") } }
        }
        await fulfillment(of: [started], timeout: 3)
        let outgoingReplay = store.workoutReplayTask
        try login(auth, owner: "B")
        store.sets = [saved]; store.sessions = [session]; store.error = "incoming-error"; store.busy = true
        try XCTUnwrap(capture.take()).finish(status: unlog ? 204 : 201, data: unlog ? Data() : JSONEncoder().encode([saved]))
        await task.value; await outgoingReplay?.value
        XCTAssertEqual(requests, 1, "Only the already-submitted A request is allowed")
        XCTAssertEqual(reads, 1, "Only the outgoing session lookup is allowed; no replacement-account read")
        XCTAssertEqual(callbacks, unlog ? 0 : 1, "Local rest is triggered before replay, never by its stale reply"); XCTAssertEqual(store.sets.map(\.id), [saved.id])
        XCTAssertEqual(store.sessions.first?.set_count, 1)
        XCTAssertEqual(store.error, "incoming-error"); XCTAssertTrue(store.busy)
    }
}

// Native rendering evidence from local fixtures only. These views cannot sign in,
// bootstrap, refresh or mutate remote data; the timer sample uses its production panel.
final class NativeWorkoutRenderTests: XCTestCase {
    @MainActor func testLocalSummaryGuidedRestAndCompletionScreenshots() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }; try fixture.login("local")
        let store = fixture.store()
        let date = Date(), day = NativeRoutineDay(id: "day", user_id: "local", routine_id: "routine", label: "Fuerza", weekday: NativeDate.weekday(Date()))
        store.routines = [NativeRoutine(id: "routine", user_id: "local", name: "Fixture", created_at: "", is_active: true)]
        store.days = [day]
        let exercises = Array(store.exercises.prefix(2))
        XCTAssertEqual(exercises.count, 2)
        store.routineExercises = exercises.enumerated().map { index, exercise in
            NativeRoutineExercise(id: "item-\(index)", user_id: "local", routine_day_id: day.id, exercise_id: exercise.id,
                position: index, target_sets: 3, target_reps: "10", notes: nil)
        }
        store.loaded = true
        func saved(_ exercise: String, _ index: Int) -> NativeSet {
            NativeSet(id: "\(exercise)-\(index)", user_id: "local", session_id: "session", exercise_id: exercise, set_index: index, reps: 10, weight_kg: 20)
        }
        try shot(AnyView(NativeTodayView()), store: store, name: "guided-Today-summary-no-exercises")
        try shot(AnyView(NavigationStack { NativeWorkoutView(date: date, dayID: day.id, mode: .guided) }), store: store, name: "guided-only-first-exercise")
        store.sessions = [NativeWorkoutSession(id: "session", user_id: "local", performed_on: NativeDate.key(date), created_at: "",
            routine_day_id: day.id, notes: nil, set_count: 3)]
        store.sets = (0..<3).map { saved(exercises[0].id, $0) }
        try shot(AnyView(NavigationStack { NativeWorkoutView(date: date, dayID: day.id, mode: .guided) }), store: store, name: "guided-resume-only-second-exercise")
        store.sets += (0..<3).map { saved(exercises[1].id, $0) }
        try shot(AnyView(NavigationStack { NativeWorkoutView(date: date, dayID: day.id, mode: .guided) }), store: store, name: "guided-complete-with-history-edit")
        let restTarget = try XCTUnwrap(store.routineExercises.first)
        var clock = NativeRestClock(scope: "local-fixture")
        clock.record(.newSet, succeeded: true, scope: clock.scope, minutes: 2)
        try shot(AnyView(NavigationStack {
            FitPage {
                FitPageHeader(title: "Fuerza", subtitle: "Ejercicio 1 de 2", showsBack: false)
                NativeExerciseLog(exerciseID: exercises[0].id, target: restTarget, done: [saved(exercises[0].id, 0)], past: [], date: NativeDate.key(date), dayID: day.id, guided: true)
                NativeRestPanel(minutes: .constant(2), clock: clock, onSkip: {})
                Button("Siguiente ejercicio") {}.buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true)).disabled(true)
            }
        }), store: store, name: "guided-live-rest-timer-production-panel")
        XCTAssertEqual(store.auth.session?.user.id, "local")
    }
    @MainActor private func shot(_ view: AnyView, store: NativeStore, name: String) throws {
        let controller = UIHostingController(rootView: VStack(spacing: 0) {
            view
            FitBottomNav(selection: .today) { _ in }.fixedSize(horizontal: false, vertical: true)
        }.environmentObject(store))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let oldKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        window.rootViewController = controller; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; oldKeyWindow?.makeKeyAndVisible() }
        controller.overrideUserInterfaceStyle = .light
        controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        controller.view.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}

final class NativeRoutineWeightTests: XCTestCase {
    private func item(_ weight: Double? = nil) -> NativeRoutineExercise {
        NativeRoutineExercise(id: "plan", user_id: "a", routine_day_id: "day", exercise_id: "press", position: 0,
                              target_sets: 3, target_reps: "8", notes: nil, target_weight_kg: weight)
    }
    func testWeightParsingAndOldModelCompatibility() throws {
        XCTAssertEqual(try FitFormat.targetWeight(" 62,5 "), 62.5)
        XCTAssertEqual(try FitFormat.targetWeight("0"), 0)
        XCTAssertNil(try FitFormat.targetWeight(" "))
        XCTAssertThrowsError(try FitFormat.targetWeight("abc"))
        XCTAssertThrowsError(try FitFormat.targetWeight("-1"))
        XCTAssertThrowsError(try FitFormat.targetWeight("10000"), "Out-of-range loads must be rejected, not silently clamped")
        XCTAssertEqual(FitFormat.target(sets: 3, reps: "8", weight: 62.5), "3 × 8 · 62,5 kg")
        let data = Data(#"{"id":"plan","user_id":"a","routine_day_id":"day","exercise_id":"press","position":0}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(NativeRoutineExercise.self, from: data).target_weight_kg)
        XCTAssertEqual(try JSONDecoder().decode(NativeRoutineExercise.self, from: JSONEncoder().encode(item(0))).target_weight_kg, 0)
    }
    func testRoutineZeroWinsHistoryAndSavedEmptyStaysEmpty() {
        let previous = NativeSet(id: "old", user_id: "a", session_id: "old-session", exercise_id: "press", set_index: 0, reps: 8, weight_kg: 50)
        let saved = NativeSet(id: "saved", user_id: "a", session_id: "session", exercise_id: "press", set_index: 0, reps: nil, weight_kg: nil)
        XCTAssertEqual(NativeWorkoutSuggestion.weight(saved: nil, target: 0, previous: previous), 0)
        XCTAssertEqual(NativeWorkoutSuggestion.weight(saved: nil, target: nil, previous: previous), 50)
        XCTAssertNil(NativeWorkoutSuggestion.weight(saved: saved, target: 62.5, previous: previous))
        let state = NativeLiveActivityState.make(plan: [item(62.5)], sets: [], past: [previous], exercise: { _ in nil }, restEndsAt: nil)
        XCTAssertEqual(state.weightKg, 62.5)
    }
    @MainActor func testFirstWorkoutWeightIsLearnedIncludingZero() async throws { try await write(defaultWeight: nil, logged: 0) }
    @MainActor func testExplicitRoutineWeightIsPreserved() async throws { try await write(defaultWeight: 62.5, logged: 70) }
    @MainActor func testDefaultFailureWarnsWithoutFailingConfirmedSet() async throws { try await write(defaultWeight: nil, logged: 62.5, failDefault: true) }
    @MainActor func testConcurrentRoutineDefaultWinsAtomicLearning() async throws { try await write(defaultWeight: nil, logged: 62.5, concurrentWeight: 80) }
    @MainActor private func write(defaultWeight: Double?, logged: Double, failDefault: Bool = false, concurrentWeight: Double? = nil) async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }; try fixture.login()
        let session = NativeWorkoutSession(id: "session", user_id: "a", performed_on: "2026-10-07", created_at: "", routine_day_id: "day", notes: nil, set_count: 0)
        let api = NativeAPI(auth: fixture.auth, network: fixture.network, pageLoader: { table, _ in
            if table == "sessions" { return try JSONEncoder().encode([session]) }
            if table == "routine_exercises", let concurrentWeight { return try JSONEncoder().encode([self.item(concurrentWeight)]) }
            throw NativeFailure.message("Local fixture refresh unavailable")
        })
        let store = NativeStore(auth: fixture.auth, api: api, automaticallyRefresh: false, cache: NativeDataCache(directory: fixture.directory))
        store.routineExercises = [item(defaultWeight)]
        var patches = 0, starts = 0
        let row = NativeSet(id: "saved", user_id: "a", session_id: "session", exercise_id: "press", set_index: 0, reps: 8, weight_kg: logged)
        let rowData = try JSONEncoder().encode([row]), defaultData = try JSONEncoder().encode([item(logged)])
        NativeOfflineURLProtocol.handle { request, transport in
            if request.url?.path == "/rest/v1/session_sets" {
                transport.finish(201, rowData)
            } else if request.url?.path == "/rest/v1/routine_exercises" {
                patches += 1
                XCTAssertEqual(request.httpMethod, "PATCH")
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
                XCTAssertTrue(query.contains(URLQueryItem(name: "id", value: "eq.plan")))
                XCTAssertTrue(query.contains(URLQueryItem(name: "target_weight_kg", value: "is.null")))
                XCTAssertEqual(request.value(forHTTPHeaderField: "Prefer"), "return=representation")
                transport.finish(failDefault ? 500 : 200, concurrentWeight == nil ? defaultData : Data("[]".utf8))
            } else { XCTFail("Unexpected fixture request"); transport.offline() }
        }
        let learned = defaultWeight == nil ? expectation(description: "Conditional routine weight settles after durable replay") : nil
        var subscription: AnyCancellable?
        if defaultWeight == nil {
            if failDefault {
                subscription = store.$routineWeightErrors.dropFirst().filter { $0["plan"] != nil }.prefix(1).sink { _ in learned?.fulfill() }
            } else {
                subscription = store.$routineExercises.dropFirst().filter { $0.first?.target_weight_kg == (concurrentWeight ?? logged) }.prefix(1).sink { _ in learned?.fulfill() }
            }
        }
        defer { subscription?.cancel(); store.workoutReplayTask?.cancel(); store.workoutRetryTask?.cancel() }
        let action = NativeWorkoutAction(auth: fixture.auth)
        let error = await store.attempt(action: action) {
            try await store.saveWorkoutSet(action: action, exerciseID: "press", index: 0, date: "2026-10-07", dayID: "day", reps: 8, weight: logged) { starts += 1 }
        }
        await store.workoutReplayTask?.value
        if let learned { await fulfillment(of: [learned], timeout: 3) }
        XCTAssertNil(error); XCTAssertEqual(store.sets.first?.weight_kg, logged); XCTAssertEqual(starts, 1)
        XCTAssertEqual(patches, defaultWeight == nil ? 1 : 0)
        XCTAssertEqual(store.routineExercises.first?.target_weight_kg, failDefault ? nil : (defaultWeight ?? concurrentWeight ?? logged))
        XCTAssertEqual(store.routineWeightErrors["plan"] != nil, failDefault)
        if failDefault { XCTAssertTrue(store.routineWeightErrors["plan"]!.contains("La serie está guardada")) }
    }
}

final class NativeLiveActivityTests: XCTestCase {
    private func item(_ id: String, sets: Int?, reps: String? = "10", position: Int = 0) -> NativeRoutineExercise {
        NativeRoutineExercise(id: "plan-\(id)", user_id: "local", routine_day_id: "day", exercise_id: id,
            position: position, target_sets: sets, target_reps: reps, notes: nil)
    }
    private func set(_ exercise: String, _ index: Int, reps: Int? = 10, weight: Double? = 20) -> NativeSet {
        NativeSet(id: UUID().uuidString, user_id: "local", session_id: "session", exercise_id: exercise, set_index: index, reps: reps, weight_kg: weight)
    }
    private func exercise(_ id: String, name: String) -> NativeExercise {
        NativeExercise(id: id, name: name, category: "strength", level: "beginner", equipment: nil, force: nil, mechanic: nil,
                       primary_muscles: [], secondary_muscles: [], instructions: [], images: ["\(id)/0.webp"], name_en: nil, aliases: nil)
    }
    private func state(_ plan: [NativeRoutineExercise], _ sets: [NativeSet], past: [NativeSet] = [], rest: Date? = nil) -> F1tWorkoutAttributes.ContentState {
        NativeLiveActivityState.make(plan: plan, sets: sets, past: past, exercise: { [self] id in id == "press" ? exercise(id, name: "Press de banca") : nil }, restEndsAt: rest)
    }

    func testStateShowsNextSetWithConfirmedEarlierSetPrefillAndProgress() {
        let plan = [item("press", sets: 3, reps: "8-10"), item("row", sets: 2, position: 1)]
        let rest = Date(timeIntervalSince1970: 1_000)
        let current = state(plan, [set("press", 0)], past: [set("press", 1, reps: 12, weight: 40)], rest: rest)
        XCTAssertEqual(current.phase, .working)
        XCTAssertEqual(current.exerciseName, "Press de banca")
        XCTAssertEqual(current.thumbnail, "press.jpg")
        XCTAssertEqual(current.setIndex, 1)
        XCTAssertEqual(current.detailLine, "Serie 2 de 3 · 10 reps · 20 kg")
        XCTAssertEqual(current.exerciseLine, "Ejercicio 1 de 2")
        XCTAssertEqual(current.completedSets, 1); XCTAssertEqual(current.plannedSets, 5)
        XCTAssertEqual(current.restEndsAt, rest)

        let carried = state(plan, [set("press", 0)])
        XCTAssertEqual(carried.reps, 10, "The confirmed earlier set prefills reps even without history")
        XCTAssertEqual(carried.weightKg, 20)
        let history = state(plan, [], past: [set("press", 0, reps: 12, weight: 40)])
        XCTAssertEqual(history.reps, 12, "Without an earlier confirmed set, matching history prefills reps")
        XCTAssertEqual(history.weightKg, 40)
        let target = state(plan, [])
        XCTAssertEqual(target.reps, 8, "Without earlier confirmed sets or history the routine target prefills reps")
        XCTAssertNil(target.weightKg)
        XCTAssertEqual(state(plan, [set("press", 0), set("press", 2)]).setIndex, 1, "A skipped set is offered before later ones")
    }
    func testStateAdvancesToNextExerciseAndFinishes() {
        let plan = [item("press", sets: 1), item("row", sets: nil, position: 1)]
        let next = state(plan, [set("press", 0)])
        XCTAssertEqual(next.exerciseID, "row")
        XCTAssertEqual(next.exerciseName, "row", "Unknown catalog ids fall back to the id")
        XCTAssertNil(next.thumbnail)
        XCTAssertEqual(next.detailLine, "Serie 1 de 1 · 10 reps")
        XCTAssertEqual(next.exerciseNumber, 2)
        let done = state(plan, [set("press", 0), set("row", 0)], rest: Date())
        XCTAssertEqual(done.phase, .finished)
        XCTAssertNil(done.restEndsAt)
        XCTAssertEqual(done.completedSets, 2); XCTAssertEqual(done.plannedSets, 2)
    }
    func testContentStateStaysUnderActivityKitLimit() throws {
        var long = state([item("press", sets: 99)], [], rest: Date())
        long.exerciseName = String(repeating: "Ejercicio muy largo ", count: 4)
        long.notice = String(repeating: "x", count: 140)
        XCTAssertLessThan(try JSONEncoder().encode(long).count, 4096)
        let request = F1tLogSetRequest(ownerID: "a", sessionDate: "2026-10-05", dayID: nil, exerciseID: "press", setIndex: 2, reps: nil, weightKg: 42.5)
        XCTAssertEqual(F1tLogSetIntent(request).request, request)
        XCTAssertEqual(F1tThumbnailStorage.filename(for: "Squat/../x y"), "Squat____x_y.jpg")
    }
    func testWidgetSnapshotIgnoresOtherDaysAndExpiredFiles() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("live-\(UUID()).json")
        defer { F1tLiveWorkoutStorage.clear(at: url) }
        let now = Date()
        let snapshot = F1tLiveWorkoutStorage.Snapshot(ownerID: "a", sessionDate: F1tWorkoutDate.key(now), dayLabel: "Pecho",
                                                     state: state([item("press", sets: 2)], []), updatedAt: now)
        try F1tLiveWorkoutStorage.write(snapshot, to: url)
        XCTAssertEqual(F1tLiveWorkoutStorage.read(now: now, from: url)?.dayLabel, "Pecho")
        XCTAssertNil(F1tLiveWorkoutStorage.read(now: now.addingTimeInterval(6 * 3600 + 1), from: url), "Six hours without updates is abandoned")
        XCTAssertNil(F1tLiveWorkoutStorage.read(now: now.addingTimeInterval(-3600), from: url), "A clock moved back never revives it")
        XCTAssertNil(F1tLiveWorkoutStorage.read(now: now.addingTimeInterval(86_400), from: url), "Another day never shows it")
        F1tLiveWorkoutStorage.clear(at: url)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
    func testAppDeclaresLiveActivities() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "NSSupportsLiveActivities") as? Bool, true)
    }
    @MainActor func testLockScreenSetRejectsOtherAccountsAndDaysWithoutNetwork() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeLogoutURLProtocol.self]
        let network = URLSession(configuration: config)
        var calls = 0
        NativeLogoutURLProtocol.handler = { _, transport in calls += 1; transport.finish(status: 500) }
        defer { NativeLogoutURLProtocol.handler = nil; network.invalidateAndCancel() }
        let auth = NativeAuth(service: "f1t.live.\(UUID())")
        defer { try? auth.keychainDelete() }
        try auth.completeSignIn(NativeAuthSession(access_token: "fixture", refresh_token: "unused", expires_in: 3600,
            expires_at: Date().timeIntervalSince1970 + 3600, user: NativeAuthUser(id: "owner-a", email: nil)))
        let store = NativeStore(auth: auth, api: NativeAPI(auth: auth, network: network), automaticallyRefresh: false)
        let today = NativeDate.key()
        for request in [
            F1tLogSetRequest(ownerID: "owner-b", sessionDate: today, dayID: "day", exerciseID: "press", setIndex: 0, reps: 10, weightKg: nil),
            F1tLogSetRequest(ownerID: "owner-a", sessionDate: "2000-01-01", dayID: "day", exerciseID: "press", setIndex: 0, reps: 10, weightKg: nil),
        ] {
            do {
                try await NativeLiveActivity.shared.logSet(request, store: store)
                XCTFail("A stale lock-screen button must not write")
            } catch {}
        }
        XCTAssertEqual(calls, 0)
        XCTAssertTrue(store.sets.isEmpty)
    }
}

// Every transport here intercepts all URLs, including configuration-derived hosts.
// Use only a freshly created simulator: the XCTest app host restores before tests run.
private final class NativeOfflineURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var callback: ((URLRequest, NativeOfflineURLProtocol) -> Void)?
    static func handle(_ value: ((URLRequest, NativeOfflineURLProtocol) -> Void)?) {
        lock.lock(); callback = value; lock.unlock()
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let callback = Self.callback; Self.lock.unlock()
        if let callback { callback(request, self) }
        else { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    }
    override func stopLoading() {}
    func finish(_ status: Int = 200, _ data: Data = Data("[]".utf8)) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    func offline() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
}
private final class NativeOfflineRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var transports: [NativeOfflineURLProtocol] = []
    func append(_ value: NativeOfflineURLProtocol) { lock.lock(); transports.append(value); lock.unlock() }
    var all: [NativeOfflineURLProtocol] { lock.lock(); defer { lock.unlock() }; return transports }
}

@MainActor private final class NativeOfflineFixture {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-cache-tests-\(UUID())", isDirectory: true)
    let network: URLSession
    let auth: NativeAuth
    private var stores: [NativeStore] = []
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [NativeOfflineURLProtocol.self]
        network = URLSession(configuration: config)
        auth = NativeAuth(service: "f1t.offline.\(UUID())", network: network)
        NativeOfflineURLProtocol.handle(nil)
    }
    func dispose() {
        // Invalidate isolated fixture work before closing its transport.
        try? auth.completeSignIn(Self.session("fixture-disposed-" + UUID().uuidString))
        stores.forEach { $0.clear() }; stores.removeAll()
        try? auth.keychainDelete(); network.invalidateAndCancel(); NativeOfflineURLProtocol.handle(nil)
        try? FileManager.default.removeItem(at: directory)
        if let journal = NativeDataCache(directory: directory).workoutDirectory {
            try? FileManager.default.removeItem(at: journal)
        }
    }
    func login(_ owner: String = "a", remaining: TimeInterval = 3600) throws {
        try auth.completeSignIn(Self.session(owner, remaining: remaining))
    }
    static func session(_ owner: String = "a", remaining: TimeInterval = 3600, token: String = "fixture-access") -> NativeAuthSession {
        NativeAuthSession(access_token: token, refresh_token: "fixture-refresh", expires_in: 3600,
                          expires_at: Date().timeIntervalSince1970 + remaining, user: NativeAuthUser(id: owner, email: nil))
    }
    static func snapshot(_ owner: String = "a", date: Date = Date(), name: String = "Cached routine") -> NativeDataSnapshot {
        NativeDataSnapshot(ownerID: owner, savedAt: date,
            routines: [NativeRoutine(id: "routine", user_id: owner, name: name, created_at: "", is_active: true)],
            days: [NativeRoutineDay(id: "day", user_id: owner, routine_id: "routine", label: "Fuerza", weekday: NativeDate.weekday(Date()))],
            routineExercises: [NativeRoutineExercise(id: "plan", user_id: owner, routine_day_id: "day", exercise_id: "press", position: 0, target_sets: 3, target_reps: "10", notes: nil)],
            sessions: [NativeWorkoutSession(id: "session", user_id: owner, performed_on: NativeDate.key(), created_at: "", routine_day_id: "day", notes: nil, set_count: 1)],
            sets: [NativeSet(id: "set", user_id: owner, session_id: "session", exercise_id: "press", set_index: 0, reps: 10, weight_kg: 20)],
            weights: [NativeWeight(id: "weight", user_id: owner, measured_on: NativeDate.key(), weight_kg: 80)],
            profile: NativeBodyProfile(user_id: owner, goal: "maintain", updated_at: "", height_cm: 180, target_weight_kg: nil, birth_date: "1990-01-01", sex: "male"))
    }
    func seed(_ value: NativeDataSnapshot? = nil) async {
        let snapshot = value ?? Self.snapshot()
        let cache = NativeDataCache(directory: directory), ticket = cache.activate(owner: snapshot.ownerID)
        await cache.write(snapshot, ticket: ticket)
    }
    func disk(_ owner: String = "a") async -> NativeDataSnapshot? {
        let cache = NativeDataCache(directory: directory), ticket = cache.activate(owner: owner)
        return await cache.read(owner: owner, ticket: ticket)
    }
    func store(auto: Bool = false, loader: ((String, [URLQueryItem]) async throws -> Data)? = nil, replay: Bool = true) -> NativeStore {
        let store = NativeStore(auth: auth, api: NativeAPI(auth: auth, network: network, pageLoader: loader),
                    automaticallyRefresh: auto, cache: NativeDataCache(directory: directory), automaticallyReplayWorkouts: replay)
        stores.append(store)
        return store
    }
}

@MainActor private final class NativeOfflineReadGate {
    var tables: [String] = []
    var continuations: [(String, CheckedContinuation<Data, Never>)] = []
    func load(_ table: String) async -> Data {
        tables.append(table)
        return await withCheckedContinuation { continuations.append((table, $0)) }
    }
    func release(routines: [NativeRoutine] = []) throws {
        let data = try JSONEncoder().encode(routines)
        let pending = continuations; continuations = []
        for (table, continuation) in pending { continuation.resume(returning: table == "routines" ? data : Data("[]".utf8)) }
    }
}

final class NativeCacheRegressionTests: XCTestCase {
    @MainActor func testLegacyAccountSnapshotStillDecodesWithoutTheRemovedDiary() throws {
        let original = NativeOfflineFixture.snapshot()
        let data = try JSONEncoder().encode(original)
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        legacy["foodEntries"] = [["old": "unused"]]
        legacy["foodDays"] = [["old": "unused"]]
        legacy["domainSavedAt"] = ["training": original.savedAt.timeIntervalSinceReferenceDate,
                                   "body": original.savedAt.timeIntervalSinceReferenceDate,
                                   "foods": Date.distantPast.timeIntervalSinceReferenceDate]
        let decoded = try JSONDecoder().decode(NativeDataSnapshot.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertTrue(decoded.isValid(for: original.ownerID))
        XCTAssertEqual(decoded.sessions.map(\.id), original.sessions.map(\.id))
        XCTAssertEqual(decoded.weights.map(\.id), original.weights.map(\.id))
    }

    @MainActor private func wait(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<300 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Offline condition timed out", file: file, line: line)
        throw URLError(.timedOut)
    }
    @MainActor func testCacheHydratesAllSevenTablesBeforeDelayedNetworkAndServerDeletionReplacesDisk() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let gate = NativeOfflineReadGate(), store = fixture.store(auto: true, loader: { table, _ in await gate.load(table) })
        try fixture.login()
        try await wait { store.loaded && gate.tables.count == 7 }
        XCTAssertFalse(store.loading); XCTAssertTrue(store.refreshing); XCTAssertTrue(store.usingCachedData)
        XCTAssertEqual(store.routines.count, 1); XCTAssertEqual(store.days.count, 1); XCTAssertEqual(store.routineExercises.count, 1)
        XCTAssertEqual(store.sessions.count, 1); XCTAssertEqual(store.sets.count, 1); XCTAssertEqual(store.weights.count, 1)
        XCTAssertNotNil(store.profile)
        try gate.release()
        await store.refresh()
        XCTAssertTrue(store.loaded); XCTAssertFalse(store.usingCachedData); XCTAssertFalse(store.refreshing)
        XCTAssertTrue(store.routines.isEmpty); XCTAssertTrue(store.sets.isEmpty); XCTAssertNil(store.profile)
        let disk = await fixture.disk()
        XCTAssertNotNil(disk); XCTAssertTrue(disk?.routines.isEmpty == true)
    }
    @MainActor func testCompleteCacheRemainsAvailableAfterOfflineFailure() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let store = fixture.store()
        try fixture.login(); await store.refresh()
        XCTAssertTrue(store.loaded); XCTAssertTrue(store.usingCachedData); XCTAssertFalse(store.loading); XCTAssertFalse(store.refreshing)
        XCTAssertEqual(store.active?.name, "Cached routine"); XCTAssertNotNil(store.error)
        let disk = await fixture.disk(); XCTAssertNotNil(disk)
    }
    @MainActor func testActualGETsAreSevenConcurrentAndCoalesceOnlyWhileInFlight() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { request, transport in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertTrue(request.url?.path.hasPrefix("/rest/v1/") == true)
            requests.append(transport)
        }
        let store = fixture.store(); try fixture.login()
        let first = Task { await store.refresh() }, second = Task { await store.refresh() }
        try await wait { requests.all.count == 7 }
        XCTAssertEqual(Set(requests.all.compactMap { $0.request.url?.lastPathComponent }).count, 7)
        XCTAssertFalse(store.loaded, "Training requires all five related tables")
        let trainingTables = Set(["routines", "routine_days", "routine_exercises", "sessions", "session_sets"])
        let training = requests.all.filter { trainingTables.contains($0.request.url!.lastPathComponent) }
        for transport in training.prefix(4) { transport.finish() }
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertFalse(store.loaded, "A half-loaded training domain is not available")
        try XCTUnwrap(training.last).finish()
        try await wait { store.loaded }
        XCTAssertFalse(store.bodyLoaded)
        for transport in requests.all where !trainingTables.contains(transport.request.url!.lastPathComponent) { transport.finish() }
        await first.value; await second.value
        XCTAssertEqual(requests.all.count, 7); XCTAssertTrue(store.loaded)
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); transport.finish() }
        await store.refresh()
        XCTAssertEqual(requests.all.count, 14, "Lifecycle reads after completion are not TTL-skipped")
    }
    @MainActor func testSuccessfulMutationCancelsPreMutationReadAndForcesNewCohort() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let gate = NativeOfflineReadGate()
        var fresh = false, calls = 0, writes = 0
        let store = fixture.store(loader: { table, _ in
            calls += 1
            if !fresh { return await gate.load(table) }
            return table == "routines" ? try JSONEncoder().encode(NativeOfflineFixture.snapshot(name: "Fresh").routines) : Data("[]".utf8)
        })
        NativeOfflineURLProtocol.handle { request, transport in
            writes += 1; XCTAssertEqual(request.httpMethod, "POST"); transport.finish(201)
        }
        try fixture.login()
        let old = Task { await store.refresh() }
        try await wait { gate.tables.count == 7 }
        let succeeded = await store.run {
            try await store.api.write("routines", method: "POST", body: ["name": "Fresh"])
            fresh = true
        }
        try gate.release(routines: NativeOfflineFixture.snapshot(name: "Obsolete").routines)
        await old.value
        XCTAssertTrue(succeeded); XCTAssertEqual(writes, 1); XCTAssertEqual(calls, 14)
        XCTAssertEqual(store.active?.name, "Fresh"); XCTAssertFalse(store.busy)
        let disk = await fixture.disk(); XCTAssertEqual(disk?.routines.first?.name, "Fresh")
    }
    @MainActor func testAccountReplacementAndSameOwnerReloginRejectSuspendedReads() async throws {
        for owner in ["b", "a"] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            let gate = NativeOfflineReadGate(), store = fixture.store(loader: { table, _ in await gate.load(table) })
            try fixture.login(); let old = Task { await store.refresh() }
            try await wait { gate.tables.count == 7 }
            try fixture.login(owner)
            store.error = "replacement-error"
            try gate.release(routines: NativeOfflineFixture.snapshot(name: "Obsolete").routines)
            await old.value
            XCTAssertFalse(store.loaded); XCTAssertTrue(store.routines.isEmpty); XCTAssertEqual(store.error, "replacement-error")
            let disk = await fixture.disk(); XCTAssertNil(disk)
        }
    }
    @MainActor func testLogoutPurgesDiskAndRejectsInFlightCompletionAndSameOwnerNewLogin() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let gate = NativeOfflineReadGate(), store = fixture.store(loader: { table, _ in await gate.load(table) })
        NativeOfflineURLProtocol.handle { _, transport in transport.finish(204) }
        try fixture.login(); let old = Task { await store.refresh() }
        try await wait { gate.tables.count == 7 }
        XCTAssertTrue(store.loaded)
        await fixture.auth.signOut()
        try fixture.login()
        try gate.release(routines: NativeOfflineFixture.snapshot().routines); await old.value
        XCTAssertFalse(store.loaded); XCTAssertTrue(store.routines.isEmpty)
        let disk = await fixture.disk(); XCTAssertNil(disk)
    }
    @MainActor func testCacheRejectsStaleFutureCorruptIncompleteVersionOwnerRowsAndOversizedFiles() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let cache = NativeDataCache(directory: fixture.directory), ticket = cache.activate(owner: "a")
        await cache.write(NativeOfflineFixture.snapshot(), ticket: ticket)
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: fixture.directory, includingPropertiesForKeys: nil).first)
        let good = try JSONEncoder().encode(NativeOfflineFixture.snapshot())
        let text = String(decoding: good, as: UTF8.self)
        XCTAssertFalse(text.contains("access_token")); XCTAssertFalse(text.contains("refresh_token"))
        var incompatible = NativeOfflineFixture.snapshot(); incompatible.schemaVersion += 1
        var incomplete = try XCTUnwrap(JSONSerialization.jsonObject(with: good) as? [String: Any]); incomplete.removeValue(forKey: "weights")
        var foreignRow = try XCTUnwrap(JSONSerialization.jsonObject(with: good) as? [String: Any])
        foreignRow["sets"] = [["id": "s", "user_id": "b", "session_id": "s", "exercise_id": "e", "set_index": 0]]
        let invalid: [(String, Data)] = [
            ("expired", try JSONEncoder().encode(NativeOfflineFixture.snapshot(date: Date().addingTimeInterval(-NativeDataSnapshot.maximumAge - 1)))),
            ("future", try JSONEncoder().encode(NativeOfflineFixture.snapshot(date: Date().addingTimeInterval(301)))),
            ("version", try JSONEncoder().encode(incompatible)),
            ("owner", try JSONEncoder().encode(NativeOfflineFixture.snapshot("b"))),
            ("foreign-row", try JSONSerialization.data(withJSONObject: foreignRow)),
            ("incomplete", try JSONSerialization.data(withJSONObject: incomplete)),
            ("corrupt", Data("broken".utf8)),
            ("oversized", Data(repeating: 0, count: 16 * 1024 * 1024 + 1))]
        for (label, bytes) in invalid {
            try bytes.write(to: file)
            let rejected = await cache.read(owner: "a", ticket: ticket)
            XCTAssertNil(rejected, label); XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), label)
        }
        XCTAssertTrue(NativeDataSnapshot.isFresh(Date().addingTimeInterval(-NativeDataSnapshot.maximumAge + 1)))
    }
    @MainActor func testCacheTicketsRejectLateWritesAcrossSwitchLogoutAndSameOwnerActivation() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let cache = NativeDataCache(directory: fixture.directory), first = cache.activate(owner: "a")
        await cache.write(NativeOfflineFixture.snapshot(), ticket: first)
        let sameOwner = cache.activate(owner: "a")
        await cache.write(NativeOfflineFixture.snapshot(name: "Obsolete"), ticket: first)
        let unchanged = await cache.read(owner: "a", ticket: sameOwner)
        XCTAssertEqual(unchanged?.routines.first?.name, "Cached routine")
        let next = cache.activate(owner: "b")
        await cache.write(NativeOfflineFixture.snapshot(), ticket: sameOwner)
        let outgoing = await cache.read(owner: "a", ticket: sameOwner); XCTAssertNil(outgoing)
        await cache.write(NativeOfflineFixture.snapshot("b"), ticket: next)
        let logout = cache.activate(owner: nil)
        await cache.write(NativeOfflineFixture.snapshot("b"), ticket: next)
        let afterLogout = await cache.read(owner: "b", ticket: logout); XCTAssertNil(afterLogout)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
    }
    @MainActor func testMixedServerErrorCannotMask401Or403CacheInvalidation() async throws {
        for status in [401, 403] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            await fixture.seed()
            let store = fixture.store(loader: { table, _ in
                if table == "routines" { throw NativeFailure.http(500, "fixture") }
                // Deliberately let denial arrive after a sibling failed/cancelled.
                try? await Task.sleep(nanoseconds: 20_000_000)
                if table == "body_profile" { throw NativeFailure.http(status, "fixture") }
                return Data("[]".utf8)
            })
            try fixture.login(); await store.refresh()
            XCTAssertFalse(store.loaded); XCTAssertFalse(store.usingCachedData); XCTAssertTrue(store.routines.isEmpty)
            XCTAssertFalse(store.loading); XCTAssertFalse(store.refreshing); XCTAssertNotNil(store.error)
            let disk = await fixture.disk(); XCTAssertNil(disk)
        }
    }
    @MainActor func testUnavailableCacheDoesNotFailFreshServerData() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = NativeStore(auth: fixture.auth, api: NativeAPI(auth: fixture.auth, network: fixture.network, pageLoader: { _, _ in Data("[]".utf8) }), automaticallyRefresh: false, cache: NativeDataCache(directory: nil))
        try fixture.login(); await store.refresh()
        XCTAssertTrue(store.loaded); XCTAssertNil(store.error)
    }
}

final class NativeAuthCacheRegressionTests: XCTestCase {
    @MainActor func testValidStoredSessionRestoresWithZeroNetworkAndDoesNotRebaseExpiry() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); transport.offline() }
        let stored = NativeOfflineFixture.session()
        try fixture.auth.keychainSave(JSONEncoder().encode(stored))
        await fixture.auth.restore()
        XCTAssertTrue(fixture.auth.ready); XCTAssertEqual(fixture.auth.session?.expires_at, stored.expires_at)
        XCTAssertFalse(fixture.auth.canRetryRestore); XCTAssertEqual(requests.all.count, 0)
    }
    @MainActor func testExpiredOfflineRestoreOffersLocalOnlyAccessAndRequiresPersistedRenewal() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let stored = NativeOfflineFixture.session(remaining: -1)
        try fixture.auth.keychainSave(JSONEncoder().encode(stored))
        await fixture.auth.restore()
        XCTAssertTrue(fixture.auth.ready); XCTAssertEqual(fixture.auth.session?.user.id, stored.user.id); XCTAssertTrue(fixture.auth.localAccessOnly); XCTAssertTrue(fixture.auth.canRetryRestore)
        let retained = try JSONDecoder().decode(NativeAuthSession.self, from: XCTUnwrap(fixture.auth.keychainRead()))
        XCTAssertEqual(retained.expires_at, stored.expires_at)
        let started = expectation(description: "Renewal intercepted"), requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); started.fulfill() }
        let retry = Task { await fixture.auth.restore() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertEqual(fixture.auth.session?.expires_at, stored.expires_at); XCTAssertTrue(fixture.auth.localAccessOnly, "Retained identity is local-only until a successful renewal")
        let renewed = NativeOfflineFixture.session(token: "renewed-fixture")
        try XCTUnwrap(requests.all.first).finish(200, JSONEncoder().encode(renewed))
        await retry.value
        XCTAssertEqual(fixture.auth.session?.access_token, renewed.access_token); XCTAssertFalse(fixture.auth.canRetryRestore); XCTAssertFalse(fixture.auth.localAccessOnly)
        let persisted = try JSONDecoder().decode(NativeAuthSession.self, from: XCTUnwrap(fixture.auth.keychainRead()))
        XCTAssertEqual(persisted.access_token, renewed.access_token)
    }
    @MainActor func testConcurrentAccessTokenSharesOneValidatedPersistedRefresh() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        try fixture.login(remaining: 30)
        let started = expectation(description: "One shared refresh"), requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); started.fulfill() }
        let first = Task { try await fixture.auth.accessToken() }, second = Task { try await fixture.auth.accessToken() }
        await fulfillment(of: [started], timeout: 3)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(requests.all.count, 1)
        try XCTUnwrap(requests.all.first).finish(200, JSONEncoder().encode(NativeOfflineFixture.session(token: "new-token")))
        let a = try await first.value, b = try await second.value
        XCTAssertEqual(a, "new-token"); XCTAssertEqual(b, a)
        let persisted = try JSONDecoder().decode(NativeAuthSession.self, from: XCTUnwrap(fixture.auth.keychainRead()))
        XCTAssertEqual(persisted.access_token, a)
    }
    @MainActor func testConcurrentRestoreSharesOneRefresh() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        try fixture.auth.keychainSave(JSONEncoder().encode(NativeOfflineFixture.session(remaining: -1)))
        let started = expectation(description: "Single restoring refresh"), requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); started.fulfill() }
        let first = Task { await fixture.auth.restore() }, second = Task { await fixture.auth.restore() }
        await fulfillment(of: [started], timeout: 3)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(requests.all.count, 1); XCTAssertNil(fixture.auth.session)
        try XCTUnwrap(requests.all.first).finish(200, JSONEncoder().encode(NativeOfflineFixture.session()))
        await first.value; await second.value
        XCTAssertNotNil(fixture.auth.session); XCTAssertFalse(fixture.auth.canRetryRestore)
    }
    @MainActor func testUnauthorizedOrOwnerMismatchRenewalClearsCredentialsAndStoreCache() async throws {
        for status in [400, 401, 200] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            await fixture.seed()
            let store = fixture.store()
            try fixture.login(remaining: 30)
            NativeOfflineURLProtocol.handle { _, transport in
                transport.finish(status, status == 200 ? try! JSONEncoder().encode(NativeOfflineFixture.session("b")) : Data())
            }
            do { _ = try await fixture.auth.accessToken(); XCTFail("Unauthorized renewal accepted") } catch {}
            XCTAssertNil(fixture.auth.session); XCTAssertFalse(fixture.auth.canRetryRestore)
            XCTAssertNil(try fixture.auth.keychainRead()); XCTAssertTrue(store.routines.isEmpty); XCTAssertFalse(store.loaded)
            let disk = await fixture.disk(); XCTAssertNil(disk)
        }
    }
    @MainActor func testSignoutAndReloginSuppressDelayedRenewal() async throws {
        for owner in ["a", "b"] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            try fixture.auth.keychainSave(JSONEncoder().encode(NativeOfflineFixture.session(remaining: -1)))
            let started = expectation(description: "Delayed outgoing renewal"), requests = NativeOfflineRequests()
            NativeOfflineURLProtocol.handle { request, transport in
                if request.url?.lastPathComponent == "logout" { transport.finish(204) }
                else { requests.append(transport); started.fulfill() }
            }
            let restore = Task { await fixture.auth.restore() }
            await fulfillment(of: [started], timeout: 3)
            await fixture.auth.signOut()
            try fixture.login(owner)
            restore.cancel()
            try XCTUnwrap(requests.all.first).finish(200, JSONEncoder().encode(NativeOfflineFixture.session(token: "obsolete-token")))
            await restore.value
            XCTAssertEqual(fixture.auth.session?.user.id, owner); XCTAssertEqual(fixture.auth.session?.access_token, "fixture-access")
            XCTAssertFalse(fixture.auth.canRetryRestore); XCTAssertNil(fixture.auth.error)
            let persisted = try JSONDecoder().decode(NativeAuthSession.self, from: XCTUnwrap(fixture.auth.keychainRead()))
            XCTAssertEqual(persisted.user.id, owner); XCTAssertEqual(persisted.access_token, "fixture-access")
        }
    }
    @MainActor func testMalformedStoredSessionAndInvalidSigninStayUnpublished() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        try fixture.auth.keychainSave(Data("corrupt".utf8)); await fixture.auth.restore()
        XCTAssertNil(fixture.auth.session); XCTAssertFalse(fixture.auth.canRetryRestore); XCTAssertNotNil(fixture.auth.error)
        XCTAssertThrowsError(try fixture.auth.completeSignIn(NativeOfflineFixture.session(" ")))
        XCTAssertNil(fixture.auth.session)
        try fixture.auth.keychainDelete(); XCTAssertNil(try fixture.auth.keychainRead())
    }
}

final class NativeCacheUIRegressionTests: XCTestCase {
    @MainActor func testBodyProgressWithOneWeightRemainsResponsive() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(replay: false)
        try fixture.login(); await fixture.seed(); await store.refresh()
        NativeProgressRoute.requestWeight()
        try await withAsyncHost(AnyView(NativeProgressView()), store: store) { controller, _ in
            try await self.settleAsync(controller)
            let fields = self.descendants(controller.view).compactMap { $0 as? UITextField }
            let weight = try XCTUnwrap(fields.first { $0.keyboardType == .decimalPad })
            weight.resignFirstResponder()
            try await self.settleAsync(controller)
            XCTAssertTrue(weight.becomeFirstResponder(), "Body remains interactive after showing its chart")
            weight.insertText("81,2")
            XCTAssertEqual(weight.text, "81,2")
            weight.resignFirstResponder()
            let picker = try XCTUnwrap(self.descendants(controller.view).compactMap { $0 as? UISegmentedControl }.first)
            for _ in 0..<3 {
                picker.selectedSegmentIndex = 0; picker.sendActions(for: .valueChanged)
                try await self.settleAsync(controller)
                picker.selectedSegmentIndex = 1; picker.sendActions(for: .valueChanged)
                try await self.settleAsync(controller)
                XCTAssertEqual(weight.text, "81,2", "Switching sections must retain the weight draft")
                XCTAssertFalse(weight.isHidden)
            }
        }
    }

    @MainActor private func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
    @MainActor private func settle(_ controller: UIViewController) {
        controller.view.setNeedsLayout(); controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        controller.view.layoutIfNeeded()
    }
    @MainActor private func withHost(_ view: AnyView, store: NativeStore, body: (UIHostingController<AnyView>, UIWindow) throws -> Void) throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        let controller = UIHostingController(rootView: AnyView(view.environmentObject(store)))
        controller.overrideUserInterfaceStyle = .light
        window.rootViewController = controller; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; previous?.makeKeyAndVisible() }
        settle(controller)
        try body(controller, window)
    }
    /// Async UI tests must yield the main actor between real focus/blur events.
    /// A nested RunLoop in one actor turn can coalesce FocusState back to nil
    /// and cannot reliably run the form's queued Task while the test holds it.
    @MainActor private func settleAsync(_ controller: UIViewController) async throws {
        controller.view.setNeedsLayout(); controller.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        controller.view.layoutIfNeeded()
    }
    @MainActor private func withAsyncHost(_ view: AnyView, store: NativeStore,
        body: (UIHostingController<AnyView>, UIWindow) async throws -> Void) async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        let controller = UIHostingController(rootView: AnyView(view.environmentObject(store)))
        controller.overrideUserInterfaceStyle = .light
        window.rootViewController = controller; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; previous?.makeKeyAndVisible() }
        try await settleAsync(controller)
        try await body(controller, window)
    }
    @MainActor private func screenshot(_ window: UIWindow, name: String) throws -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        return try XCTUnwrap(image.pngData())
    }
    private func visibleText(_ png: Data) throws -> String {
        let image = try XCTUnwrap(UIImage(data: png)?.cgImage)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["es-ES", "en-US"]
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    }
    @MainActor private func accessible(_ view: UIView) -> [NSObject] {
        var result: [NSObject] = [], seen = Set<ObjectIdentifier>()
        func visit(_ object: NSObject, depth: Int) {
            guard depth < 16, seen.insert(ObjectIdentifier(object)).inserted else { return }
            result.append(object)
            if let view = object as? UIView { view.subviews.forEach { visit($0, depth: depth + 1) } }
            if let elements = object.accessibilityElements { elements.compactMap { $0 as? NSObject }.forEach { visit($0, depth: depth + 1) } }
            let count = object.accessibilityElementCount()
            if count > 0 && count < 1000 {
                for index in 0..<count { if let child = object.accessibilityElement(at: index) as? NSObject { visit(child, depth: depth + 1) } }
            }
        }
        visit(view, depth: 0); return result
    }
    @MainActor func testUnknownRoutineStateDoesNotRenderConfirmedEmptyAndErrorHasRetry() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store()
        try withHost(AnyView(NativeRoutinesView()), store: store) { controller, window in
            let unknown = try screenshot(window, name: "cache-routines-unknown-skeleton")
            let unknownText = try visibleText(unknown)
            XCTAssertFalse(unknownText.contains("Sin rutinas"))
            store.loaded = true; settle(controller)
            let confirmed = try screenshot(window, name: "cache-routines-confirmed-empty")
            XCTAssertNotEqual(unknown, confirmed)
            XCTAssertTrue(try visibleText(confirmed).contains("Sin rutinas"), "Confirmed empty state must be visibly rendered")
            store.loaded = false; store.error = "Offline fixture"; settle(controller)
            let failure = try visibleText(screenshot(window, name: "cache-routines-offline-retry"))
            XCTAssertTrue(failure.contains("No pudimos cargar"))
            XCTAssertTrue(failure.contains("Reintentar"))
            XCTAssertFalse(failure.contains("Sin rutinas"))
        }
    }
    @MainActor func testRefreshAndScrollingRetainMountedEditableRowsAndUnsavedDraft() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store()
        try fixture.login()
        let snapshot = NativeOfflineFixture.snapshot()
        store.routines = snapshot.routines; store.days = snapshot.days
        store.routineExercises = [NativeRoutineExercise(id: "plan", user_id: "a", routine_day_id: "day", exercise_id: "press", position: 0, target_sets: 24, target_reps: "10", notes: nil)]
        store.sessions = snapshot.sessions; store.sets = snapshot.sets; store.loaded = true
        var controller: UIHostingController<AnyView>?, window: UIWindow?, previous: UIWindow?
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        previous = scene.windows.first(where: \.isKeyWindow)
        window = UIWindow(windowScene: scene); window!.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        controller = UIHostingController(rootView: AnyView(NavigationStack { NativeWorkoutView(date: Date(), dayID: "day") }.environmentObject(store)))
        window!.rootViewController = controller; window!.makeKeyAndVisible()
        defer { window?.isHidden = true; window?.rootViewController = nil; previous?.makeKeyAndVisible() }
        let host = try XCTUnwrap(controller); settle(host)
        let fields = descendants(host.view).compactMap { $0 as? UITextField }
        XCTAssertEqual(fields.count, 46, "The saved series is compact; the remaining 23 editable rows retain their drafts")
        let draft = try XCTUnwrap(fields.first)
        XCTAssertTrue(draft.becomeFirstResponder()); draft.selectAll(nil); draft.insertText("17"); draft.resignFirstResponder(); settle(host)
        XCTAssertEqual(draft.text, "17")
        let scroll = try XCTUnwrap(descendants(host.view).compactMap { $0 as? UIScrollView }.first { $0.contentSize.height > $0.bounds.height + 500 })
        scroll.setContentOffset(CGPoint(x: 0, y: scroll.contentSize.height - scroll.bounds.height), animated: false); settle(host)
        scroll.setContentOffset(.zero, animated: false); settle(host)
        XCTAssertTrue(descendants(host.view).contains { $0 === draft }); XCTAssertEqual(draft.text, "17")
        // Learning a default cannot override an earlier confirmed set, another
        // row's pending kg draft or the weight already saved in the first set.
        let weightDraft = try XCTUnwrap(fields.dropFirst().first)
        XCTAssertTrue(weightDraft.becomeFirstResponder()); weightDraft.selectAll(nil); weightDraft.insertText("17,5")
        weightDraft.resignFirstResponder(); settle(host)
        store.routineExercises[0].target_weight_kg = 62.5; settle(host)
        XCTAssertEqual(weightDraft.text, "17,5")
        XCTAssertEqual(store.sets.first?.weight_kg, 20, "The saved compact series retains its original load")
        XCTAssertEqual(fields[3].text, "20", "Untouched unsaved row keeps the earlier confirmed set's weight over the new default")
        // The mock defaults to offline; a failed refresh must not unmount content.
        await store.refresh(); settle(host)
        XCTAssertTrue(store.loaded); XCTAssertTrue(descendants(host.view).contains { $0 === draft })
        XCTAssertEqual(draft.text, "17"); XCTAssertEqual(store.sets.first?.reps, 10)
        _ = try screenshot(window!, name: "cache-refresh-retained-editable-draft")
    }
    @MainActor func testVisitedTabsMountLazilyAndRetainOriginalScrollAcrossVisits() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); store.loaded = true
        try withHost(AnyView(NativeTabsView(store: store, auth: fixture.auth)), store: store) { controller, _ in
            @MainActor func scrolls() -> [UIScrollView] { descendants(controller.view).compactMap { $0 as? UIScrollView }.filter { $0.contentSize.height > 0 && abs($0.bounds.width - 393) < 1 } }
            let original = try XCTUnwrap(scrolls().first)
            XCTAssertEqual(scrolls().count, 1)
            @MainActor func select(_ title: String) throws {
                // Unit-hosted SwiftUI does not expose its AX tree on every runtime.
                // Do not substitute a fake callback and claim real navigation coverage.
                guard let button = accessible(controller.view).first(where: { $0.accessibilityLabel == title && $0.accessibilityTraits.contains(.button) }) else {
                    throw XCTSkip("Unit-hosted SwiftUI AX tree unavailable; initial lazy mount is covered by NativeScrollLayoutTests. Interactive visited-stack retention requires UI automation.")
                }
                XCTAssertTrue(button.accessibilityActivate()); settle(controller)
            }
            try select("Rutinas")
            XCTAssertEqual(scrolls().count, 2)
            XCTAssertTrue(descendants(controller.view).contains { $0 === original })
            try select("Hoy")
            XCTAssertEqual(scrolls().count, 2)
            XCTAssertTrue(descendants(controller.view).contains { $0 === original }, "Switching back must retain the visited tab navigation stack")
            try select("Progreso")
            XCTAssertEqual(scrolls().count, 3)
        }
    }
    @MainActor func testBoundedThumbnailsPreserveOrientationAspectAndSeparateLightboxQuality() throws {
        let store = NativeStore(automaticallyRefresh: false)
        let paths = Array(Set(store.exercises.flatMap(\.images))).sorted().prefix(12)
        XCTAssertEqual(paths.count, 12)
        for path in paths {
            let url = try XCTUnwrap(Bundle.main.url(forResource: path, withExtension: nil, subdirectory: "NativeResources/exercises"))
            let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
            let metadata = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
            let width = try XCTUnwrap(metadata[kCGImagePropertyPixelWidth] as? Int), height = try XCTUnwrap(metadata[kCGImagePropertyPixelHeight] as? Int)
            let orientation = metadata[kCGImagePropertyOrientation] as? Int ?? 1
            let card = try XCTUnwrap(FitImageCache.image(path, maxPixelSize: 400))
            let detail = try XCTUnwrap(FitImageCache.image(path, maxPixelSize: 1200))
            let full = try XCTUnwrap(FitImageCache.image(path))
            let cardPixels = try XCTUnwrap(card.cgImage), detailPixels = try XCTUnwrap(detail.cgImage)
            XCTAssertLessThanOrEqual(max(cardPixels.width, cardPixels.height), 400)
            XCTAssertGreaterThanOrEqual(max(cardPixels.width, cardPixels.height), min(400, max(width, height)) - 1, "Do not unnecessarily downsample below card resolution")
            XCTAssertLessThanOrEqual(max(detailPixels.width, detailPixels.height), 1200)
            XCTAssertGreaterThanOrEqual(max(detailPixels.width, detailPixels.height), max(cardPixels.width, cardPixels.height))
            let rotated = (5...8).contains(orientation)
            let expectedAspect = rotated ? Double(height) / Double(width) : Double(width) / Double(height)
            XCTAssertEqual(Double(cardPixels.width) / Double(cardPixels.height), expectedAspect, accuracy: 0.02)
            XCTAssertEqual(card.imageOrientation, .up)
            XCTAssertTrue(FitImageCache.image(path, maxPixelSize: 400) === card, "Cache key includes resolution")
            XCTAssertFalse(full === card)
        }
        XCTAssertNil(FitImageCache.image("nonexistent-fixture.jpg", maxPixelSize: 400))
    }
}

extension NativeCacheRegressionTests {
    @MainActor func testColdExpiredUnpublishedRestoreRetainsCacheOfflineButDefinitiveRejectionPurgesIt() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: fixture.directory, includingPropertiesForKeys: nil).first)
        let cache = NativeDataCache(directory: fixture.directory)
        let store = NativeStore(auth: fixture.auth, api: NativeAPI(auth: fixture.auth, network: fixture.network), automaticallyRefresh: false, cache: cache)
        try fixture.auth.keychainSave(JSONEncoder().encode(NativeOfflineFixture.session(remaining: -1)))
        await store.bootstrap()
        await store.refresh() // Bootstrap publishes identity; refresh awaits disk hydration.
        _ = await cache.read(owner: "queue-barrier", ticket: UUID())
        XCTAssertEqual(fixture.auth.session?.user.id, "a"); XCTAssertTrue(fixture.auth.localAccessOnly); XCTAssertTrue(fixture.auth.canRetryRestore)
        XCTAssertTrue(store.loaded); XCTAssertTrue(store.usingCachedData)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path), "Transient offline restore must preserve same-owner cold cache")
        NativeOfflineURLProtocol.handle { _, transport in transport.finish(401, Data()) }
        await fixture.auth.restore()
        _ = await cache.read(owner: "queue-barrier", ticket: UUID())
        XCTAssertNil(fixture.auth.session); XCTAssertFalse(fixture.auth.canRetryRestore)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "A never-published rejected owner still requires persistent deletion")
        try fixture.login("b")
        NativeOfflineURLProtocol.handle { _, transport in transport.finish(204) }
        await fixture.auth.signOut()
        _ = await cache.read(owner: "queue-barrier", ticket: UUID())
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
    }
    @MainActor func testColdExpiredUnpublishedLogoutPurgesOrphanSnapshotAndRevokesOldToken() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let cache = NativeDataCache(directory: fixture.directory)
        let store = NativeStore(auth: fixture.auth, api: NativeAPI(auth: fixture.auth, network: fixture.network), automaticallyRefresh: false, cache: cache)
        try fixture.auth.keychainSave(JSONEncoder().encode(NativeOfflineFixture.session(remaining: -1)))
        await store.bootstrap()
        XCTAssertTrue(fixture.auth.canRetryRestore)
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { request, transport in
            requests.append(transport)
            XCTAssertEqual(request.url?.path, "/auth/v1/logout")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access")
            transport.finish(204)
        }
        await fixture.auth.signOut()
        _ = await cache.read(owner: "queue-barrier", ticket: UUID())
        XCTAssertEqual(requests.all.count, 1); XCTAssertFalse(fixture.auth.canRetryRestore)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
    }
    @MainActor func testFreshProcessAuthenticatedActivationPrunesOrphansButNilStartupPreservesCache() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: fixture.directory, includingPropertiesForKeys: nil).first)
        let relaunched = NativeDataCache(directory: fixture.directory)
        let startup = relaunched.activate(owner: nil)
        _ = await relaunched.read(owner: "queue-barrier", ticket: startup)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        let a = relaunched.activate(owner: "a")
        let valid = await relaunched.read(owner: "a", ticket: a); XCTAssertNotNil(valid)
        // B's new process has never tracked A in memory: pruning must use disk state.
        let replacementProcess = NativeDataCache(directory: fixture.directory)
        _ = replacementProcess.activate(owner: nil)
        let b = replacementProcess.activate(owner: "b")
        _ = await replacementProcess.read(owner: "queue-barrier", ticket: b)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        await replacementProcess.write(NativeOfflineFixture.snapshot("b"), ticket: b)
        replacementProcess.discardAll()
        await replacementProcess.write(NativeOfflineFixture.snapshot("b", name: "Late logout write"), ticket: b)
        _ = await replacementProcess.read(owner: "queue-barrier", ticket: UUID())
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
    }
    @MainActor func testOversizedSnapshotWriteRemovesPreviousSnapshot() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let cache = NativeDataCache(directory: fixture.directory), ticket = cache.activate(owner: "a")
        await cache.write(NativeOfflineFixture.snapshot(), ticket: ticket)
        await cache.write(NativeOfflineFixture.snapshot(name: String(repeating: "x", count: 16 * 1024 * 1024 + 1)), ticket: ticket)
        let disk = await cache.read(owner: "a", ticket: ticket)
        XCTAssertNil(disk); XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
    }
}

extension NativeCacheUIRegressionTests {
    @MainActor func testActualQueuedBodyProfileBlurRejectsDifferentAndSameOwnerReplacement() async throws {
        for replacement in ["b", "a"] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            await fixture.seed()
            let store = fixture.store(loader: { _, _ in throw URLError(.notConnectedToInternet) })
            try fixture.login(); await store.refresh()
            XCTAssertTrue(store.domainState(.body).loaded)
            let requests = NativeOfflineRequests()
            NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); transport.finish(201) }
            try await withAsyncHost(AnyView(ScrollView { NativeBodyProfileCard() }), store: store) { controller, window in
                let height = try XCTUnwrap(descendants(controller.view).compactMap { $0 as? UITextField }.first)
                XCTAssertTrue(height.becomeFirstResponder()); try await settleAsync(controller)
                height.selectAll(nil); height.insertText("199"); try await settleAsync(controller)
                store.busy = true
                height.resignFirstResponder(); try await settleAsync(controller)
                XCTAssertTrue(try visibleText(screenshot(window, name: "profile-queued-originating-owner")).contains("Guardando"), "Actual production blur must enqueue while busy")
                XCTAssertEqual(requests.all.count, 0, "The queued blur must not send while another transaction is busy")
                try fixture.login(replacement)
                store.profile = NativeBodyProfile(user_id: replacement, goal: "maintain", updated_at: "", height_cm: 150, target_weight_kg: nil, birth_date: nil, sex: nil)
                store.error = "replacement-error"
                try await settleAsync(controller); try await settleAsync(controller)
                XCTAssertEqual(requests.all.count, 0, "An A draft must not POST after replacement login \(replacement)")
                XCTAssertEqual(store.profile?.height_cm, 150); XCTAssertEqual(store.error, "replacement-error")
                XCTAssertFalse(try visibleText(screenshot(window, name: "profile-cancelled-old-owner")).contains("Guardando"), "Cancellation must unwind old-card saving UI")
            }
        }
    }
    @MainActor func testActualQueuedBodyProfileBlurStillSavesAfterSameAccountBusyClears() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        await fixture.seed()
        let store = fixture.store(loader: { _, _ in throw URLError(.notConnectedToInternet) })
        try fixture.login(); await store.refresh()
        XCTAssertTrue(store.domainState(.body).loaded)
        let original = try XCTUnwrap(store.profile)
        let confirmed = NativeBodyProfile(user_id: original.user_id, goal: original.goal, updated_at: "fixture-ack",
            height_cm: 199, target_weight_kg: original.target_weight_kg, birth_date: original.birth_date, sex: original.sex)
        let representation = try JSONEncoder().encode([confirmed])
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { request, transport in
            requests.append(transport)
            XCTAssertEqual(request.httpMethod, "POST"); XCTAssertEqual(request.url?.path, "/rest/v1/body_profile")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access")
            transport.finish(201, representation)
        }
        try await withAsyncHost(AnyView(ScrollView { NativeBodyProfileCard() }), store: store) { controller, _ in
            let height = try XCTUnwrap(descendants(controller.view).compactMap { $0 as? UITextField }.first)
            XCTAssertTrue(height.becomeFirstResponder()); try await settleAsync(controller)
            height.selectAll(nil); height.insertText("199"); try await settleAsync(controller)
            store.busy = true; height.resignFirstResponder(); try await settleAsync(controller)
            XCTAssertEqual(requests.all.count, 0)
            store.busy = false
            for _ in 0..<20 {
                if requests.all.count == 1 && store.profile?.height_cm == 199 { break }
                try await settleAsync(controller)
            }
            XCTAssertEqual(requests.all.count, 1, "Current-owner queued saves must not be dropped")
            XCTAssertEqual(store.profile?.height_cm, 199, "The returned acknowledgement must be published, not just requested")
            guard let request = requests.all.first?.request else { return }
            let bodyData: Data?
            if let data = request.httpBody { bodyData = data }
            else if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }; data.append(buffer, count: count)
                }
                bodyData = data
            } else { bodyData = nil }
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(bodyData)) as? [String: Any])
            XCTAssertEqual(body["height_cm"] as? Double, 199); XCTAssertEqual(Set(body.keys), ["height_cm"], "Only the edited profile field is sent")
        }
    }
}

extension NativeCacheRegressionTests {
    @MainActor func testAliasedDirectoryRetainsSameOwnerColdCacheAndHydratesOfflineWhilePruningOthers() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let physical = fixture.directory.appendingPathComponent("physical-cache", isDirectory: true)
        // A noncanonical parent segment exercises directory aliasing without
        // relying on arbitrary symlink-directory enumeration on Simulator.
        let alias = physical.appendingPathComponent("..", isDirectory: true)
            .appendingPathComponent("physical-cache", isDirectory: true)
        try FileManager.default.createDirectory(at: physical, withIntermediateDirectories: true)
        XCTAssertNotEqual(alias.path, physical.path)
        XCTAssertEqual(alias.resolvingSymlinksInPath().path, physical.resolvingSymlinksInPath().path)
        let previousProcess = NativeDataCache(directory: physical), previous = previousProcess.activate(owner: "a")
        await previousProcess.write(NativeOfflineFixture.snapshot(), ticket: previous)
        let retained = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: physical, includingPropertiesForKeys: nil).first)
        let orphan = physical.appendingPathComponent("foreign-owner.json")
        try Data("orphan fixture".utf8).write(to: orphan)
        let enumerated = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: alias, includingPropertiesForKeys: nil).first { $0.lastPathComponent == retained.lastPathComponent })
        print("FIT cache alias enumeration changes raw URL prefix: \(enumerated != alias.appendingPathComponent(retained.lastPathComponent))")
        let cache = NativeDataCache(directory: alias)
        let store = NativeStore(auth: fixture.auth, api: NativeAPI(auth: fixture.auth, network: fixture.network), automaticallyRefresh: false, cache: cache)
        // A nil cold-start activation must not remove an unpublished owner's snapshot.
        _ = await cache.read(owner: "queue-barrier", ticket: UUID())
        XCTAssertTrue(FileManager.default.fileExists(atPath: retained.path))
        try fixture.auth.keychainSave(JSONEncoder().encode(NativeOfflineFixture.session()))
        await store.bootstrap(); await store.refresh()
        XCTAssertTrue(store.loaded); XCTAssertTrue(store.usingCachedData); XCTAssertFalse(store.loading)
        XCTAssertEqual(store.active?.name, "Cached routine")
        XCTAssertNotNil(store.error, "Mock transport is offline: cached hydration must precede the failed read")
        XCTAssertTrue(FileManager.default.fileExists(atPath: retained.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
        // Same-owner authenticated reactivation must preserve the physical file too.
        let rotated = cache.activate(owner: "a")
        let preserved = await cache.read(owner: "a", ticket: rotated)
        XCTAssertEqual(preserved?.routines.first?.name, "Cached routine")
        let switched = cache.activate(owner: "b")
        _ = await cache.read(owner: "queue-barrier", ticket: switched)
        XCTAssertFalse(FileManager.default.fileExists(atPath: retained.path), "Other-owner pruning must still work through an alias")
    }
}

final class NativeWorkoutRoutingTests: XCTestCase {
    @MainActor func testTodayDismissesWorkoutNavigationAndWinsOverEarlierQueuedLinks() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login()
        let snapshot = NativeOfflineFixture.snapshot()
        store.routines = snapshot.routines; store.days = snapshot.days; store.sessions = snapshot.sessions
        let router = NativeWorkoutRouter()
        let workout = try XCTUnwrap(URL(string: "f1t://workout?date=\(NativeDate.key())&day=day"))
        let today = try XCTUnwrap(URL(string: "f1t://today"))
        let active = F1tWorkoutAttributes(ownerID: "a", sessionDate: NativeDate.key(), dayID: "day", dayLabel: "Activo")

        store.loaded = true
        XCTAssertTrue(router.receive(workout, store: store))
        router.resolve(store: store, active: active)
        XCTAssertNotNil(router.presented)

        // Queue a second link while hydration is unavailable, with a workout still presented.
        store.loaded = false
        XCTAssertTrue(router.receive(workout, store: store))
        XCTAssertTrue(router.receive(today, store: store))
        XCTAssertEqual(router.consumeRequestedTab(), .today)
        XCTAssertNil(router.presented, "The widget must show Today, not a covering workout")
        XCTAssertNil(router.requestedTab)

        store.loaded = true
        router.resolve(store: store, active: active)
        router.resolve(store: store, active: active)
        XCTAssertNil(router.presented, "Hydration and onAppear must not undo the latest Today navigation")
        XCTAssertEqual(store.sessions.map(\.id), snapshot.sessions.map(\.id))
        XCTAssertEqual(store.days.map(\.id), snapshot.days.map(\.id))

        // A later explicit workout intent still resumes the active owned workout.
        XCTAssertTrue(router.receive(workout, store: store))
        router.resolve(store: store, active: active)
        XCTAssertEqual(router.presented?.dayID, "day")
        XCTAssertEqual(router.presented.map { NativeDate.key($0.date) }, active.sessionDate)
        XCTAssertTrue(router.presented?.guided == true)
    }

    func testWorkoutLinksRejectOAuthTokensMalformedDatesAndAmbiguity() throws {
        for raw in ["f1t://auth/callback?code=private", "https://workout?date=2026-10-08", "f1t://user@workout", "f1t://workout:42", "f1t://workout/extra", "f1t://workout?date=2026-02-30", "f1t://workout?date=2026-10-08&date=2026-10-09", "f1t://workout?day=", "f1t://workout?day=..%2Fforeign", "f1t://workout?access_token=private", "f1t://workout#access_token=private"] {
            XCTAssertNil(NativeWorkoutLink.parse(try XCTUnwrap(URL(string: raw))))
        }
        XCTAssertEqual(NativeWorkoutLink.parse(try XCTUnwrap(URL(string: "f1t://workout?date=2026-10-08&day=day-1"))), NativeWorkoutLink(dateKey: "2026-10-08", dayID: "day-1"))
        XCTAssertEqual(NativeWorkoutLink.parse(try XCTUnwrap(URL(string: "f1t://workout"))), NativeWorkoutLink(dateKey: nil, dayID: nil))
    }
    @MainActor func testRoutingKeepsExactOwnedDayAndCannotCrossReplacementLogin() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login()
        let snapshot = NativeOfflineFixture.snapshot()
        store.routines = snapshot.routines; store.days = snapshot.days; store.sessions = snapshot.sessions
        let router = NativeWorkoutRouter()
        let url = try XCTUnwrap(URL(string: "f1t://workout?date=\(NativeDate.key())&day=day"))
        XCTAssertTrue(router.receive(url, store: store)); XCTAssertNil(router.presented)
        store.loaded = true; router.resolve(store: store, active: nil)
        XCTAssertEqual(router.presented?.dayID, "day"); XCTAssertTrue(router.presented?.guided == true)
        router.handleIdentity(owner: "a", generation: UUID())
        XCTAssertNil(router.presented, "Even same-owner replacement login invalidates an earlier presentation")
        store.loaded = false; router.receive(url, store: store)
        try fixture.login("b"); store.loaded = true; router.resolve(store: store, active: nil)
        XCTAssertNil(router.presented, "A delayed hydration must not open A's requested workout as B")
    }
    @MainActor func testRoutingRejectsForeignAndConflictingDaysWithoutHTTP() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login()
        let snapshot = NativeOfflineFixture.snapshot()
        store.routines = snapshot.routines; store.days = snapshot.days; store.sessions = snapshot.sessions; store.loaded = true
        store.days.append(NativeRoutineDay(id: "foreign", user_id: "b", routine_id: "routine", label: "Ajeno", weekday: 0))
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); transport.finish(500) }
        let router = NativeWorkoutRouter()
        for day in ["foreign", "missing"] {
            router.receive(try XCTUnwrap(URL(string: "f1t://workout?date=\(NativeDate.key())&day=\(day)")), store: store)
            router.resolve(store: store, active: nil)
            XCTAssertNil(router.presented)
        }
        XCTAssertEqual(requests.all.count, 0)
        let tomorrow = NativeDate.key(NativeDate.add(1, to: Date()))
        router.receive(try XCTUnwrap(URL(string: "f1t://workout?date=\(tomorrow)&day=day")), store: store)
        router.resolve(store: store, active: nil)
        XCTAssertNil(router.presented)
    }
    @MainActor func testGenericLinkPrefersTheActiveOwnedSessionNotTheCurrentWeekday() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login(); store.loaded = true
        store.days = [NativeRoutineDay(id: "moved", user_id: "a", routine_id: "routine", label: "Movido", weekday: (NativeDate.weekday() + 1) % 7)]
        let active = F1tWorkoutAttributes(ownerID: "a", sessionDate: NativeDate.key(), dayID: "moved", dayLabel: "Movido")
        let router = NativeWorkoutRouter(); store.loaded = false
        router.receive(try XCTUnwrap(URL(string: "f1t://workout")), store: store)
        store.loaded = true; router.resolve(store: store, active: active)
        XCTAssertEqual(router.presented?.dayID, "moved")
        XCTAssertEqual(router.presented.map { NativeDate.key($0.date) }, NativeDate.key())
    }
}

final class NativeWorkoutJournalAcceptanceTests: XCTestCase {
    @MainActor private func repository(_ directory: URL) -> NativeWorkoutRepository { NativeWorkoutRepository(directory: directory) }
    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("fit-journal-acceptance-\(UUID())", isDirectory: true) }
    @MainActor func testAtomicMutationDraftAndRestartAreIsolatedPerOwner() throws {
        let folder = directory(); defer { try? FileManager.default.removeItem(at: folder) }
        let writer = repository(folder)
        let date = NativeDate.key()
        let draftKey = NativeWorkoutRepository.draftKey(date: date, dayID: "day", exerciseID: "press", index: 0)
        let session = NativeWorkoutSession(id: "local-session", user_id: "a", performed_on: date, created_at: "", routine_day_id: "day", notes: nil, set_count: 1)
        let row = NativeSet(id: "local-set", user_id: "a", session_id: session.id, exercise_id: "press", set_index: 0, reps: 12, weight_kg: 17.5)
        try writer.transact(owner: "a") { envelope in
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString, kind: .set, date: date, dayID: "day", exerciseID: "press", index: 0, reps: 12, weight: 17.5, localSetID: row.id, revision: envelope.revision)
            envelope.sessions = [session]
            envelope.changes[operation.key] = .init(mutation: operation, row: row, acknowledged: false)
            envelope.outbox = [operation]
            envelope.drafts[draftKey] = NativeWorkoutDraft(repsText: "12", weightText: "17,5")
        }
        let restarted = repository(folder)
        XCTAssertEqual(try restarted.read(owner: "a").outbox.count, 1)
        XCTAssertEqual(try restarted.read(owner: "a").drafts[draftKey]?.weightText, "17,5")
        let projection = try restarted.overlay(owner: "a", sessions: [], sets: [])
        XCTAssertEqual(projection.sessions.first?.set_count, 1); XCTAssertEqual(projection.sets.first?.weight_kg, 17.5)
        XCTAssertTrue(try restarted.read(owner: "b").outbox.isEmpty)
        XCTAssertTrue(try restarted.read(owner: "b").drafts.isEmpty)
        XCTAssertTrue(try restarted.overlay(owner: "b", sessions: [], sets: []).sets.isEmpty)
    }
    @MainActor func testFailedTransactionAndUnreadableStorageNeverErasePriorDraft() throws {
        let folder = directory(); defer { try? FileManager.default.removeItem(at: folder) }
        let writer = repository(folder)
        try writer.transact(owner: "a") { $0.drafts["draft"] = NativeWorkoutDraft(repsText: "10", weightText: "20") }
        XCTAssertThrowsError(try writer.transact(owner: "a") { envelope in
            envelope.drafts["draft"] = nil
            throw NativeFailure.message("Fallo controlado")
        })
        XCTAssertEqual(try repository(folder).read(owner: "a").drafts["draft"]?.repsText, "10")
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).first)
        let corrupt = Data("not-a-valid-private-journal".utf8)
        try corrupt.write(to: file)
        let restarted = repository(folder)
        XCTAssertThrowsError(try restarted.read(owner: "a"))
        XCTAssertThrowsError(try restarted.transact(owner: "a") { $0.drafts.removeAll() })
        XCTAssertEqual(try Data(contentsOf: file), corrupt, "Corruption must not be interpreted as an empty journal")
    }
    @MainActor func testLateSnapshotCannotRemoveAnAcknowledgementOrNewerEdit() throws {
        let folder = directory(); defer { try? FileManager.default.removeItem(at: folder) }
        let writer = repository(folder), snapshot = NativeOfflineFixture.snapshot()
        let date = NativeDate.key(), session = try XCTUnwrap(snapshot.sessions.first)
        var readRevision: UInt64 = 0
        try writer.transact(owner: "a") { envelope in
            readRevision = envelope.revision
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString, kind: .set, date: date, dayID: "day", exerciseID: "press", index: 0, reps: 10, weight: 20, localSetID: "older-row", revision: envelope.revision)
            envelope.sessions = [session]
            envelope.changes[operation.key] = .init(mutation: operation, row: snapshot.sets.first, acknowledged: true)
        }
        try writer.transact(owner: "a") { envelope in
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString, kind: .set, date: date, dayID: "day", exerciseID: "press", index: 0, reps: 15, weight: 22.5, localSetID: "newer-row", revision: envelope.revision)
            let row = NativeSet(id: "newer-row", user_id: "a", session_id: session.id, exercise_id: "press", set_index: 0, reps: 15, weight_kg: 22.5)
            envelope.changes[operation.key] = .init(mutation: operation, row: row, acknowledged: true)
        }
        try writer.checkpoint(snapshot, readRevision: readRevision)
        let projection = try writer.overlay(owner: "a", sessions: snapshot.sessions, sets: snapshot.sets)
        XCTAssertEqual(projection.sets.count, 1); XCTAssertEqual(projection.sets.first?.reps, 15)
        XCTAssertEqual(projection.sets.first?.weight_kg, 22.5)
        let latest = try writer.read(owner: "a").revision
        try writer.checkpoint(snapshot, readRevision: latest)
        XCTAssertTrue(try writer.read(owner: "a").changes.isEmpty, "A later read may retire an acknowledged overlay")
    }
    @MainActor func testActualLocalCommitValidatesInputAndPersistsBeforeNetwork() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login()
        defer { store.workoutReplayTask?.cancel(); store.workoutRetryTask?.cancel() }
        store.loaded = true
        let action = NativeWorkoutAction(auth: fixture.auth), date = NativeDate.key()
        var newSetCount = 0
        for values in [(reps: -1, weight: 10.0), (reps: 1000, weight: 10.0), (reps: 10, weight: Double.nan), (reps: 10, weight: -1.0)] {
            do {
                try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: "day", reps: values.reps, weight: values.weight) { newSetCount += 1 }
                XCTFail("Invalid input committed")
            } catch {}
        }
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").outbox.isEmpty)
        try store.saveWorkoutDraft(date: date, dayID: "day", exerciseID: "press", index: 0, repsText: "12", weightText: "17,5")
        try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: "day", reps: 12, weight: 17.5) { newSetCount += 1 }
        XCTAssertEqual(newSetCount, 1); XCTAssertEqual(store.sets.first?.reps, 12)
        XCTAssertEqual(try store.workoutRepository.read(owner: "a").outbox.count, 1)
        XCTAssertNil(store.workoutDraft(date: date, dayID: "day", exerciseID: "press", index: 0))
        try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: "day", reps: 13, weight: 18) { newSetCount += 1 }
        XCTAssertEqual(newSetCount, 1, "Editing a saved local set must not start a second rest")
        XCTAssertEqual(store.sets.count, 1); XCTAssertEqual(store.sets.first?.reps, 13)
        let oldAction = action; try fixture.login("b")
        do {
            try await store.commitWorkoutSet(action: oldAction, exerciseID: "press", index: 1, date: date, dayID: "day", reps: 10, weight: 20) {}
            XCTFail("Old owner's queued action committed after account replacement")
        } catch {}
        XCTAssertTrue(try store.workoutRepository.read(owner: "b").outbox.isEmpty)
    }
}

extension NativeWorkoutJournalAcceptanceTests {
    @MainActor private func seedCommand(_ store: NativeStore, owner: String = "a") throws {
        let snapshot = NativeOfflineFixture.snapshot(owner)
        let session = try XCTUnwrap(snapshot.sessions.first)
        let row = NativeSet(id: "local-command-row", user_id: owner, session_id: session.id, exercise_id: "press", set_index: 1, reps: 12, weight_kg: 17.5)
        try store.workoutRepository.transact(owner: owner) { envelope in
            let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString, kind: .set, date: session.performed_on, dayID: "day", exerciseID: "press", index: 1, reps: row.reps, weight: row.weight_kg, localSetID: row.id, revision: envelope.revision)
            envelope.snapshot = snapshot; envelope.sessions = [session]
            envelope.outbox = [operation]
            envelope.changes[operation.key] = .init(mutation: operation, row: row, acknowledged: false)
        }
    }
    @MainActor func testLostAcknowledgementRetriesTheSameUpsertAndDoesNotDuplicateLocalSet() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login(); try seedCommand(store)
        defer { store.workoutReplayTask?.cancel(); store.workoutRetryTask?.cancel() }
        let requests = NativeOfflineRequests(), snapshot = NativeOfflineFixture.snapshot()
        let remote = NativeSet(id: "server-row", user_id: "a", session_id: "session", exercise_id: "press", set_index: 1, reps: 12, weight_kg: 17.5)
        let sessionsData = try JSONEncoder().encode(snapshot.sessions), rowData = try JSONEncoder().encode([remote])
        NativeOfflineURLProtocol.handle { request, transport in
            if request.url?.path == "/rest/v1/sessions" { transport.finish(200, sessionsData); return }
            if request.url?.path == "/rest/v1/session_sets", request.httpMethod == "POST" {
                requests.append(transport)
                if requests.all.count == 1 { transport.offline() } else { transport.finish(201, rowData) }
                return
            }
            transport.finish(500)
        }
        await store.replayWorkoutOutbox()
        store.workoutRetryTask?.cancel(); store.workoutRetryTask = nil
        XCTAssertEqual(try store.workoutRepository.read(owner: "a").outbox.count, 1)
        XCTAssertNotNil(store.workoutSyncError, "A lost reply leaves a visible pending sync")
        store.retryWorkoutSync()
        await store.workoutReplayTask?.value
        XCTAssertEqual(requests.all.count, 2)
        for transport in requests.all {
            let request = transport.request
            XCTAssertEqual(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "on_conflict" }?.value, "session_id,exercise_id,set_index")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Prefer"), "return=representation,resolution=merge-duplicates")
        }
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").outbox.isEmpty)
        XCTAssertNil(store.workoutSyncError)
        XCTAssertEqual(store.sets.filter { $0.exercise_id == "press" && $0.set_index == 1 }.count, 1)
        XCTAssertEqual(store.sets.first { $0.set_index == 1 }?.id, "server-row")
    }
    @MainActor func testDelayedOutboxReplyCannotAcknowledgeAfterDifferentOrSameOwnerReplacement() async throws {
        for replacement in ["b", "a"] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            let store = fixture.store(); try fixture.login(); try seedCommand(store)
            defer { store.workoutReplayTask?.cancel(); store.workoutRetryTask?.cancel() }
            let started = expectation(description: "Set reply held"), requests = NativeOfflineRequests()
            let sessionData = try JSONEncoder().encode(NativeOfflineFixture.snapshot().sessions)
            NativeOfflineURLProtocol.handle { request, transport in
                if request.url?.path == "/rest/v1/sessions" { transport.finish(200, sessionData) }
                else { requests.append(transport); started.fulfill() }
            }
            let replay = Task { await store.replayWorkoutOutbox() }
            await fulfillment(of: [started], timeout: 3)
            try fixture.login(replacement)
            store.workoutSyncError = "Estado de la nueva generación"
            let row = NativeSet(id: "late-server-row", user_id: "a", session_id: "session", exercise_id: "press", set_index: 1, reps: 12, weight_kg: 17.5)
            try XCTUnwrap(requests.all.first).finish(201, JSONEncoder().encode([row]))
            await replay.value
            XCTAssertTrue(store.sets.isEmpty)
            XCTAssertEqual(store.workoutSyncError, "Estado de la nueva generación")
            XCTAssertEqual(try store.workoutRepository.read(owner: "a").outbox.count, 1, "A stale reply must never acknowledge the outgoing command")
            if replacement == "b" { XCTAssertTrue(try store.workoutRepository.read(owner: "b").outbox.isEmpty) }
        }
    }
}

final class NativeActiveWorkoutPersistenceAcceptanceTests: XCTestCase {
    func testDeadlineAndFrozenPlanSurviveReloadWithoutRestartingTheRest() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fit-active-acceptance-\(UUID())", isDirectory: true)
        let url = folder.appendingPathComponent("session.json")
        defer { try? FileManager.default.removeItem(at: folder) }
        let now = Date(), deadline = now.addingTimeInterval(120)
        let plan = [NativeRoutineExercise(id: "p", user_id: "a", routine_day_id: "day", exercise_id: "press", position: 0, target_sets: 3, target_reps: "10", notes: nil, target_weight_kg: 20)]
        let attributes = F1tWorkoutAttributes(ownerID: "a", sessionDate: NativeDate.key(now), dayID: "day", dayLabel: "Fuerza")
        var workout = NativeActiveWorkout(attributes: attributes, startedAt: now, updatedAt: now, plan: plan, exerciseNames: ["press": "Press"], past: [], confirmedSets: [], currentExerciseID: "press", restEndsAt: deadline, lastExerciseName: nil)
        try NativeActiveWorkoutStorage.write(workout, to: url)
        let restored = try XCTUnwrap(NativeActiveWorkoutStorage.load(from: url))
        XCTAssertEqual(restored.restEndsAt, deadline)
        XCTAssertEqual(restored.id, workout.id)
        XCTAssertEqual(restored.plan.first?.target_sets, 3)
        XCTAssertEqual(restored.plan.first?.target_weight_kg, 20)
        XCTAssertTrue(restored.isValid(for: "a")); XCTAssertFalse(restored.isValid(for: "b"))
        workout.changed(now: now.addingTimeInterval(90))
        try NativeActiveWorkoutStorage.write(workout, to: url)
        XCTAssertEqual(try NativeActiveWorkoutStorage.load(from: url)?.restEndsAt, deadline, "A republish changes revision, never the original deadline")
        XCTAssertNotEqual(workout.revision, restored.revision)
        XCTAssertEqual(try NativeActiveWorkoutStorage.load(from: url)?.restEndsAt?.timeIntervalSince(now.addingTimeInterval(180)), -60, "An expired timer stays expired after reload")
    }
    func testForeignFrozenPlanAndInvalidDeadlineCannotReplaceValidPrivateSession() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fit-active-invalid-\(UUID())", isDirectory: true)
        let url = folder.appendingPathComponent("session.json")
        defer { try? FileManager.default.removeItem(at: folder) }
        let now = Date(), attributes = F1tWorkoutAttributes(ownerID: "a", sessionDate: NativeDate.key(), dayID: "day", dayLabel: "Fuerza")
        let validPlan = [NativeRoutineExercise(id: "p", user_id: "a", routine_day_id: "day", exercise_id: "press", position: 0, target_sets: 3, target_reps: "10", notes: nil)]
        var valid = NativeActiveWorkout(attributes: attributes, startedAt: now, updatedAt: now, plan: validPlan, exerciseNames: [:], past: [], confirmedSets: [], currentExerciseID: "press", restEndsAt: nil, lastExerciseName: nil)
        try NativeActiveWorkoutStorage.write(valid, to: url)
        let priorData = try Data(contentsOf: url)
        valid.restEndsAt = Date(timeIntervalSince1970: .infinity)
        XCTAssertThrowsError(try NativeActiveWorkoutStorage.write(valid, to: url))
        XCTAssertEqual(try Data(contentsOf: url), priorData)
        let foreignPlan = [NativeRoutineExercise(id: "p", user_id: "b", routine_day_id: "day", exercise_id: "press", position: 0, target_sets: 3, target_reps: "10", notes: nil)]
        let foreign = NativeActiveWorkout(attributes: attributes, startedAt: now, updatedAt: now, plan: foreignPlan, exerciseNames: [:], past: [], confirmedSets: [], currentExerciseID: "press", restEndsAt: nil, lastExerciseName: nil)
        XCTAssertThrowsError(try NativeActiveWorkoutStorage.write(foreign, to: url))
        XCTAssertEqual(try Data(contentsOf: url), priorData)
    }
}

extension NativeWorkoutRoutingTests {
    @MainActor func testPreviousDateFrozenActiveWorkoutResumesGuidedBeforeCacheLoads() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login()
        let yesterday = NativeDate.key(NativeDate.add(-1, to: Date()))
        let active = F1tWorkoutAttributes(ownerID: "a", sessionDate: yesterday, dayID: "removed-day", dayLabel: "En curso")
        let router = NativeWorkoutRouter()
        router.receive(try XCTUnwrap(URL(string: "f1t://workout?date=\(yesterday)&day=removed-day")), store: store)
        router.resolve(store: store, active: active)
        XCTAssertFalse(store.loaded)
        XCTAssertEqual(router.presented.map { NativeDate.key($0.date) }, yesterday)
        XCTAssertEqual(router.presented?.dayID, "removed-day")
        XCTAssertTrue(router.presented?.guided == true, "The active session, not today's weekday, owns navigation")
    }
}

extension NativeCacheUIRegressionTests {
    @MainActor func testProductionNumericRowUsesNumericKeyboardsStacksLargeTextAndRetainsInvalidDraft() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login(); store.loaded = true
        let date = NativeDate.key()
        let row = NativeSetRow(exerciseID: "press", index: 0, saved: nil, previous: nil, targetReps: "10", targetWeightKg: 20, date: date, dayID: "day")
        try withHost(AnyView(ScrollView { row }.environment(\.dynamicTypeSize, .accessibility3)), store: store) { controller, window in
            let fields = descendants(controller.view).compactMap { $0 as? UITextField }
            XCTAssertEqual(fields.count, 2)
            let reps = try XCTUnwrap(fields.first), weight = try XCTUnwrap(fields.last)
            XCTAssertEqual(reps.keyboardType, .numberPad); XCTAssertEqual(weight.keyboardType, .decimalPad)
            XCTAssertEqual(reps.autocorrectionType, .no); XCTAssertEqual(weight.autocorrectionType, .no)
            XCTAssertEqual(reps.autocapitalizationType, .none); XCTAssertEqual(weight.autocapitalizationType, .none)
            let repsRect = reps.convert(reps.bounds, to: controller.view), weightRect = weight.convert(weight.bounds, to: controller.view)
            XCTAssertGreaterThan(weightRect.minY, repsRect.maxY, "Accessibility sizes stack the two inputs without overlap")
            XCTAssertGreaterThan(repsRect.width, 100); XCTAssertGreaterThan(weightRect.width, 100)
            XCTAssertTrue(weight.becomeFirstResponder()); weight.selectAll(nil); weight.insertText("17,555"); weight.resignFirstResponder(); settle(controller)
            XCTAssertEqual(weight.text, "17,555", "Do not silently clamp or rewrite an invalid user's draft")
            XCTAssertEqual(store.workoutDraft(date: date, dayID: "day", exerciseID: "press", index: 0)?.weightText, "17,555")
            XCTAssertTrue(store.sets.isEmpty)
            _ = try screenshot(window, name: "large-text-accessible-invalid-workout-draft")
        }
    }
}

extension NativeCacheUIRegressionTests {
    @MainActor func testProductionNumericRowVoiceOverNamesFromTheActualAccessibilityTree() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login(); store.loaded = true
        let row = NativeSetRow(exerciseID: "press", index: 0, saved: nil, previous: nil, targetReps: "10", targetWeightKg: 20, date: NativeDate.key(), dayID: "day")
        try withHost(AnyView(ScrollView { row }), store: store) { controller, _ in
            let labels = accessible(controller.view).compactMap(\.accessibilityLabel)
            guard !labels.isEmpty else {
                throw XCTSkip("Unit-hosted SwiftUI exposes no accessibility elements on this runtime. VoiceOver labels require UI automation/device acceptance; UIKit keyboard/layout/draft behavior is tested separately.")
            }
            XCTAssertTrue(labels.contains("Repeticiones de la serie 1"))
            XCTAssertTrue(labels.contains("Carga en kg de la serie 1"))
        }
    }
}

extension NativeTests {
    func testWorkoutInputsNeverSilentlyTruncate() throws {
        XCTAssertEqual(NativeWorkoutInput.parse(reps: "12", weight: "17,5")?.weight, 17.5)
        for values in [("12,5", "10"), ("1000", "10"), ("12", "17,555"), ("12", "NaN"), ("12", "-1")] {
            XCTAssertNil(NativeWorkoutInput.parse(reps: values.0, weight: values.1))
            XCTAssertNotNil(NativeWorkoutInput.error(reps: values.0, weight: values.1))
        }
        let empty = try XCTUnwrap(NativeWorkoutInput.parse(reps: "", weight: ""))
        XCTAssertNil(empty.reps); XCTAssertNil(empty.weight)
    }

}

final class NativeDomainRecoveryTests: XCTestCase {
    @MainActor private func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<300 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Domain recovery condition timed out")
        throw URLError(.timedOut)
    }

    private static func data(_ table: String, snapshot: NativeDataSnapshot) throws -> Data {
        let encoder = JSONEncoder()
        switch table {
        case "routines": return try encoder.encode(snapshot.routines)
        case "routine_days": return try encoder.encode(snapshot.days)
        case "routine_exercises": return try encoder.encode(snapshot.routineExercises)
        case "sessions": return try encoder.encode(snapshot.sessions)
        case "session_sets": return try encoder.encode(snapshot.sets)
        case "weight_entries": return try encoder.encode(snapshot.weights)
        case "body_profile": return try encoder.encode(snapshot.profile.map { [$0] } ?? [])
        default: throw NativeFailure.message("Unexpected fixture table")
        }
    }

    @MainActor func testTrainingPublishesAndPersistsBeforeSecondaryDomainsComplete() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let snapshot = NativeOfflineFixture.snapshot(), gate = NativeOfflineReadGate()
        let secondary = Set(["weight_entries", "body_profile"])
        let store = fixture.store(loader: { table, _ in
            if secondary.contains(table) { return await gate.load(table) }
            return try Self.data(table, snapshot: snapshot)
        }, replay: false)
        try fixture.login()
        let read = Task { await store.refresh() }
        try await wait { store.loaded && gate.tables.count == 2 }
        XCTAssertEqual(store.days.count, 1); XCTAssertEqual(store.sessions.count, 1); XCTAssertEqual(store.sets.count, 1)
        XCTAssertFalse(store.loading); XCTAssertTrue(store.refreshing)
        XCTAssertTrue(store.domainState(.body).loading); XCTAssertFalse(store.bodyLoaded)
        let partial = try XCTUnwrap(store.workoutRepository.read(owner: "a").snapshot)
        XCTAssertFalse(partial.isCompleteRefresh)
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").snapshotNeedsRevalidation)
        XCTAssertThrowsError(try store.workoutRepository.checkpoint(partial, readRevision: 0), "Partial availability must not acknowledge a complete account GET")
        try gate.release(); await read.value
        XCTAssertTrue(store.bodyLoaded)
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").snapshot?.isCompleteRefresh == true)
        XCTAssertFalse(try store.workoutRepository.read(owner: "a").snapshotNeedsRevalidation)
    }

    @MainActor func testBodyFailuresDoNotBlockFirstTrainingLoadOrOfflineRelaunch() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let snapshot = NativeOfflineFixture.snapshot()
        let store = fixture.store(loader: { table, _ in
            if table == "body_profile" { throw URLError(.notConnectedToInternet) }
            return try Self.data(table, snapshot: snapshot)
        }, replay: false)
        try fixture.login(); await store.refresh()
        XCTAssertTrue(store.loaded); XCTAssertNil(store.error); XCTAssertFalse(store.usingCachedData)
        XCTAssertEqual(store.active?.id, "routine"); XCTAssertEqual(store.sets.count, 1)
        XCTAssertFalse(store.bodyLoaded)
        XCTAssertTrue(store.weights.isEmpty); XCTAssertNil(store.profile)
        let partial = try XCTUnwrap(store.workoutRepository.read(owner: "a").snapshot)
        XCTAssertNil(partial.updatedAt(for: .body))
        XCTAssertFalse(partial.isCompleteRefresh)
        let cold = fixture.store(replay: false); await cold.refresh()
        XCTAssertTrue(cold.loaded); XCTAssertTrue(cold.usingCachedData)
        XCTAssertEqual(cold.days.count, 1); XCTAssertEqual(cold.sets.count, 1)
        XCTAssertFalse(cold.bodyLoaded)
    }

    @MainActor func testFailedTrainingIsAtomicAndDoesNotBlockBody() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let snapshot = NativeOfflineFixture.snapshot()
        let store = fixture.store(loader: { table, _ in
            if table == "session_sets" { throw NativeFailure.http(500, "fixture") }
            return try Self.data(table, snapshot: snapshot)
        }, replay: false)
        try fixture.login(); await store.refresh()
        XCTAssertFalse(store.loaded); XCTAssertNotNil(store.error)
        XCTAssertTrue(store.routines.isEmpty); XCTAssertTrue(store.days.isEmpty); XCTAssertTrue(store.sessions.isEmpty)
        XCTAssertTrue(store.bodyLoaded); XCTAssertNotNil(store.profile)
        let partial = try XCTUnwrap(store.workoutRepository.read(owner: "a").snapshot)
        XCTAssertNil(partial.updatedAt(for: .training)); XCTAssertFalse(partial.isCompleteRefresh)
    }

    @MainActor func testPartialRefreshPreservesBodySnapshotsDraftsAndPendingWorkoutOverlay() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let old = NativeOfflineFixture.snapshot(date: Date().addingTimeInterval(-3600))
        let store = fixture.store(loader: { table, _ in
            if table == "body_profile" { throw NativeFailure.http(500, "fixture") }
            if table == "session_sets" { return Data("[]".utf8) }
            return try Self.data(table, snapshot: old)
        }, replay: false)
        try fixture.login()
        try store.workoutRepository.checkpoint(old, readRevision: 0)
        try await store.commitWorkoutSet(action: NativeWorkoutAction(auth: fixture.auth), exerciseID: "press", index: 1,
            date: NativeDate.key(), dayID: "day", reps: 12, weight: 25, onNewSet: {})
        try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 2, repsText: "invalid", weightText: "17,555")
        await store.refresh()
        XCTAssertTrue(store.loaded); XCTAssertNil(store.error)
        XCTAssertTrue(store.bodyLoaded); XCTAssertTrue(store.domainState(.body).usingCachedData)
        XCTAssertEqual(store.weights.first?.weight_kg, old.weights.first?.weight_kg)
        XCTAssertEqual(store.sets.first(where: { $0.set_index == 1 })?.reps, 12)
        let journal = try store.workoutRepository.read(owner: "a")
        XCTAssertTrue(journal.snapshotNeedsRevalidation); XCTAssertFalse(journal.snapshot?.isCompleteRefresh ?? true)
        XCTAssertEqual(journal.outbox.count, 1); XCTAssertEqual(journal.drafts.count, 1)
        let cold = fixture.store(replay: false); await cold.refresh()
        XCTAssertEqual(cold.workoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 2)?.weightText, "17,555")
    }

    @MainActor func testDomainRecoveryClearsItsErrorWithoutRegisteringDraftOrRepeatingMutation() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let snapshot = NativeOfflineFixture.snapshot()
        var bodyFailure = true
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); transport.offline() }
        let store = fixture.store(loader: { table, _ in
            if table == "body_profile", bodyFailure { throw URLError(.notConnectedToInternet) }
            return try Self.data(table, snapshot: snapshot)
        }, replay: false)
        try fixture.login(); await store.refresh()
        try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 2, repsText: "9", weightText: "17,5")
        XCTAssertNotNil(store.domainState(.body).error)
        bodyFailure = false; await store.refresh()
        XCTAssertTrue(store.bodyLoaded); XCTAssertNil(store.domainState(.body).error)
        XCTAssertFalse(store.domainState(.body).usingCachedData)
        XCTAssertEqual(store.workoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 2)?.repsText, "9")
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").outbox.isEmpty)
        XCTAssertTrue(requests.all.isEmpty, "Refresh recovery is read-only and a draft is never implicitly registered")
    }

    @MainActor func testConfirmedTrainingDeletionRetiresOlderAcknowledgementEvenWhenBodyFails() async throws {
        for bodyFails in [true, false] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            let old = NativeOfflineFixture.snapshot()
            let store = fixture.store(loader: { table, _ in
                if bodyFails, table == "body_profile" { throw NativeFailure.http(500, "fixture") }
                if table == "session_sets" { return Data("[]".utf8) }
                return try Self.data(table, snapshot: old)
            }, replay: false)
            try fixture.login()
            try store.workoutRepository.checkpoint(old, readRevision: 0)
            try store.workoutRepository.transact(owner: "a") { envelope in
                let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString, kind: .set, date: NativeDate.key(),
                    dayID: "day", exerciseID: "press", index: 0, reps: 10, weight: 20, localSetID: "set", revision: envelope.revision)
                envelope.sessions = old.sessions
                envelope.changes[operation.key] = .init(mutation: operation, row: old.sets.first, acknowledged: true,
                    acknowledgedRevision: envelope.revision)
            }
            await store.refresh()
            XCTAssertTrue(store.loaded); XCTAssertTrue(store.sets.isEmpty, "A confirmed server deletion must not resurrect an obsolete acknowledged overlay")
            let journal = try store.workoutRepository.read(owner: "a")
            XCTAssertTrue(journal.changes.isEmpty); XCTAssertTrue(journal.snapshot?.sets.isEmpty == true)
            XCTAssertEqual(journal.snapshot?.isCompleteRefresh, !bodyFails)
            XCTAssertEqual(journal.snapshotNeedsRevalidation, bodyFails)
        }
    }

    @MainActor func testLateSecondaryDenialRevokesPublishedPartialDataWithoutErasingDrafts() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let snapshot = NativeOfflineFixture.snapshot(), gate = NativeOfflineReadGate()
        let store = fixture.store(loader: { table, _ in
            if table == "body_profile" {
                _ = await gate.load(table)
                throw NativeFailure.http(403, "fixture")
            }
            return try Self.data(table, snapshot: snapshot)
        }, replay: false)
        try fixture.login()
        let read = Task { await store.refresh() }
        try await wait { store.loaded && gate.tables.count == 1 }
        try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 2, repsText: "invalid", weightText: "17,555")
        try gate.release(); await read.value
        XCTAssertFalse(store.loaded); XCTAssertFalse(store.bodyLoaded)
        XCTAssertTrue(store.routines.isEmpty); XCTAssertNotNil(store.error)
        let root = try XCTUnwrap(NativeDataCache(directory: fixture.directory).workoutDirectory).appendingPathComponent(fixture.auth.storageNamespace)
        let cold = try NativeWorkoutRepository(directory: root).read(owner: "a")
        XCTAssertNil(cold.snapshot); XCTAssertEqual(cold.drafts.count, 1)
        let cache = await fixture.disk(); XCTAssertNil(cache)
    }

    @MainActor func testDraftOnlyLogoutRequiresExplicitDiscardAndPreservesDraftUntilConfirmed() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(replay: false), requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { _, transport in requests.append(transport); transport.finish(204) }
        try fixture.login()
        try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 0, repsText: "invalid", weightText: "17,555")
        let pending = try fixture.auth.pendingWorkoutChanges(), generation = fixture.auth.generation
        XCTAssertEqual(pending.operations, 0); XCTAssertEqual(pending.drafts, 1); XCTAssertEqual(pending.total, 1)
        await fixture.auth.signOut()
        XCTAssertEqual(fixture.auth.session?.user.id, "a"); XCTAssertEqual(fixture.auth.generation, generation)
        XCTAssertTrue(fixture.auth.error?.contains("borradores sin registrar") == true)
        XCTAssertEqual(try store.workoutRepository.read(owner: "a").drafts.count, 1); XCTAssertTrue(requests.all.isEmpty)
        await fixture.auth.signOut(discardUnsyncedWorkouts: true, expectedGeneration: generation)
        XCTAssertNil(fixture.auth.session); XCTAssertNil(try fixture.auth.keychainRead())
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").drafts.isEmpty)
        XCTAssertEqual(requests.all.count, 1)
    }

    @MainActor func testTypedPendingCountsAndStaleDiscardConfirmationCannotCrossLoginGeneration() async throws {
        for replacement in ["a", "b"] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            let store = fixture.store(replay: false); try fixture.login()
            try await store.commitWorkoutSet(action: NativeWorkoutAction(auth: fixture.auth), exerciseID: "press", index: 0,
                date: NativeDate.key(), dayID: "day", reps: 10, weight: 20, onNewSet: {})
            try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 1, repsText: "8", weightText: "25")
            XCTAssertEqual(try fixture.auth.pendingWorkoutChanges(), NativePendingWorkoutChanges(operations: 1, drafts: 1))
            let confirmationGeneration = fixture.auth.generation
            try fixture.login(replacement)
            if replacement == "b" {
                try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "other", exerciseID: "press", index: 0, repsText: "6", weightText: "30")
            }
            await fixture.auth.signOut(discardUnsyncedWorkouts: true, expectedGeneration: confirmationGeneration)
            XCTAssertEqual(fixture.auth.session?.user.id, replacement)
            XCTAssertEqual(try store.workoutRepository.read(owner: "a").outbox.count, 1)
            XCTAssertEqual(try store.workoutRepository.read(owner: replacement).drafts.count, 1)
        }
    }

    @MainActor func testUnreadableJournalCannotReportZeroPendingOrSilentlySignOut() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = NativeStore(auth: fixture.auth, automaticallyRefresh: false, cache: NativeDataCache(directory: fixture.directory),
            workoutRepository: NativeWorkoutRepository(directory: nil), automaticallyReplayWorkouts: false)
        try fixture.login()
        XCTAssertThrowsError(try fixture.auth.pendingWorkoutChanges())
        await fixture.auth.signOut()
        XCTAssertEqual(fixture.auth.session?.user.id, "a"); XCTAssertNotNil(fixture.auth.error)
        await fixture.auth.signOut(discardUnsyncedWorkouts: true, expectedGeneration: fixture.auth.generation)
        XCTAssertEqual(fixture.auth.session?.user.id, "a"); XCTAssertNotNil(try fixture.auth.keychainRead())
        withExtendedLifetime(store) {}
    }

    @MainActor func testFailedExplicitDiscardPreservesCredentialsAndPersistentDraft() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(replay: false); try fixture.login()
        try store.saveWorkoutDraft(date: NativeDate.key(), dayID: "day", exerciseID: "press", index: 0, repsText: "12", weightText: "17,5")
        fixture.auth.discardLocalWorkouts = { throw NativeFailure.message("Fixture file is unavailable") }
        let generation = fixture.auth.generation
        await fixture.auth.signOut(discardUnsyncedWorkouts: true, expectedGeneration: generation)
        XCTAssertEqual(fixture.auth.session?.user.id, "a"); XCTAssertEqual(fixture.auth.generation, generation)
        XCTAssertNotNil(try fixture.auth.keychainRead())
        XCTAssertEqual(try store.workoutRepository.read(owner: "a").drafts.count, 1)
    }
}

extension NativeCacheUIRegressionTests {
    @MainActor func testConfirmedProfileWriteSurvivesFailedRefreshAndOfflineRelaunch() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let snapshot = NativeOfflineFixture.snapshot()
        await fixture.seed(snapshot)
        let store = fixture.store(); try fixture.login()
        await store.refresh()
        XCTAssertTrue(store.domainState(.body).loaded)
        let confirmed = NativeBodyProfile(user_id: "a", goal: "maintain", updated_at: "2026-10-08T10:00:00Z", height_cm: 199, target_weight_kg: nil, birth_date: "1990-01-01", sex: "male")
        let representation = try JSONEncoder().encode([confirmed]), requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { request, transport in
            requests.append(transport)
            if request.url?.path == "/rest/v1/body_profile", request.httpMethod == "POST" { transport.finish(201, representation) }
            else { transport.offline() }
        }
        _ = try await NativeBodyMutation.profile(store, patch: ["height_cm": 199], action: NativeWorkoutAction(auth: fixture.auth))
        await store.refresh()
        for _ in 0..<100 {
            if store.profile?.height_cm == 199 && !store.refreshing && store.error != nil { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(requests.all.filter { $0.request.httpMethod == "POST" }.count, 1)
        XCTAssertEqual(store.profile?.height_cm, 199)
        XCTAssertNotNil(store.error, "A failed follow-up GET remains visible")
        let persisted = await fixture.disk()
        XCTAssertEqual(persisted?.profile?.height_cm, 199, "A server-confirmed mutation must replace the older disk snapshot before refresh")
        let relaunched = fixture.store()
        await relaunched.refresh()
        XCTAssertTrue(relaunched.loaded)
        XCTAssertTrue(relaunched.domainState(.body).loaded, "The acknowledged profile must remain available independently of training")
        XCTAssertEqual(relaunched.profile?.height_cm, 199, "A cold offline read must never revert the confirmed profile")
    }
}

@MainActor private final class NativeAlarmFailureBackend: NativeRestAlarmBackend {
    enum Failure: Error { case injected }
    var authorizationStatus: NativeAlarmProvider.AuthorizationStatus = .authorized
    var ids: Set<UUID> = []
    var cancellationFails = false
    var cancellationThrowsAfterRemoval = false
    var readsFail = false
    var scheduleFailsBeforeAcceptance = false
    var scheduleFailsAfterAcceptance = false
    var suspendSchedule = false
    var continuation: CheckedContinuation<Void, Never>?
    var scheduled: (() -> Void)?
    var scheduleCalls = 0
    var cancelCalls = 0
    func requestAuthorization() async throws -> NativeAlarmProvider.AuthorizationStatus { authorizationStatus }
    func activeIDs() throws -> Set<UUID> { if readsFail { throw Failure.injected }; return ids }
    func cancel(id: UUID) throws {
        cancelCalls += 1
        if cancellationFails { throw Failure.injected }
        ids.remove(id)
        if cancellationThrowsAfterRemoval { throw Failure.injected }
    }
    func schedule(id: UUID, title: String, endsAt: Date) async throws {
        scheduleCalls += 1
        if scheduleFailsBeforeAcceptance { throw Failure.injected }
        ids.insert(id); scheduled?()
        if suspendSchedule { await withCheckedContinuation { continuation = $0 } }
        if scheduleFailsAfterAcceptance { throw Failure.injected }
    }
}

final class NativeAlarmFailureAcceptanceTests: XCTestCase {
    @MainActor func testFailedCancellationPersistsUncertaintyAcrossRestartAndBlocksDuplicateFallback() async throws {
        let suite = "fit-alarm-acceptance-\(UUID())", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: NativeAlarmProvider.enabledKey)
        let backend = NativeAlarmFailureBackend(), end = Date().addingTimeInterval(300)
        let old = NativeAlarmProvider.alarmID(for: "old-rest")
        backend.ids.insert(old); backend.cancellationFails = true
        let provider = NativeAlarmProvider(defaults: defaults, backend: backend)
        let result = await provider.scheduleRestResult(id: "old-rest", title: "Descanso", endsAt: end)
        XCTAssertEqual(result, .uncertain); XCTAssertFalse(result.allowsNotificationFallback)
        XCTAssertEqual(backend.scheduleCalls, 0); XCTAssertTrue(backend.ids.contains(old)); XCTAssertTrue(provider.hasUncertainAlarms)
        XCTAssertNotNil(provider.errorMessage)
        let cancelled = await provider.cancelRestResult(id: "old-rest")
        XCTAssertEqual(cancelled, .uncertain)
        let restarted = NativeAlarmProvider(defaults: defaults, backend: backend)
        await restarted.setEnabled(false)
        let blocked = await restarted.scheduleRestResult(id: "new-rest", title: "Descanso", endsAt: end)
        XCTAssertEqual(blocked, .uncertain); XCTAssertFalse(blocked.allowsNotificationFallback)
        XCTAssertEqual(backend.scheduleCalls, 0, "A disabled preference does not prove an earlier alarm was removed")
        backend.cancellationFails = false
        defaults.set(true, forKey: NativeAlarmProvider.enabledKey)
        let reconciled = NativeAlarmProvider(defaults: defaults, backend: backend)
        let replacement = await reconciled.scheduleRestResult(id: "new-rest", title: "Descanso", endsAt: end)
        XCTAssertEqual(replacement, .scheduled)
        XCTAssertEqual(backend.ids, [NativeAlarmProvider.alarmID(for: "new-rest")])
        XCTAssertFalse(reconciled.hasUncertainAlarms)
    }
    @MainActor func testOnlyConfirmedAbsenceAllowsFallbackAfterScheduleOrSystemReadFailures() async throws {
        let suite = "fit-alarm-failures-\(UUID())", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: NativeAlarmProvider.enabledKey)
        let backend = NativeAlarmFailureBackend(), provider = NativeAlarmProvider(defaults: defaults, backend: backend)
        let end = Date().addingTimeInterval(300)
        backend.scheduleFailsBeforeAcceptance = true
        let unavailable = await provider.scheduleRestResult(id: "before", title: "Descanso", endsAt: end)
        XCTAssertEqual(unavailable, .unavailable); XCTAssertTrue(unavailable.allowsNotificationFallback); XCTAssertTrue(backend.ids.isEmpty)
        backend.scheduleFailsBeforeAcceptance = false; backend.scheduleFailsAfterAcceptance = true; backend.cancellationFails = true
        let uncertain = await provider.scheduleRestResult(id: "accepted", title: "Descanso", endsAt: end)
        XCTAssertEqual(uncertain, .uncertain); XCTAssertFalse(uncertain.allowsNotificationFallback)
        XCTAssertEqual(backend.ids.count, 1); XCTAssertTrue(provider.hasUncertainAlarms)
        backend.cancellationFails = false; backend.cancellationThrowsAfterRemoval = true
        let removed = await provider.cancelRestResult(id: "accepted")
        XCTAssertEqual(removed, .cancelled); XCTAssertTrue(backend.ids.isEmpty); XCTAssertFalse(provider.hasUncertainAlarms)
        backend.readsFail = true
        let unknown = await provider.scheduleRestResult(id: "unreadable", title: "Descanso", endsAt: end)
        XCTAssertEqual(unknown, .uncertain); XCTAssertFalse(unknown.allowsNotificationFallback)
        XCTAssertTrue(provider.hasUncertainAlarms)
    }
    @MainActor func testDisableDuringAcceptedSuspendedScheduleNeverReportsFalseSafeAbsence() async throws {
        let suite = "fit-alarm-race-\(UUID())", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: NativeAlarmProvider.enabledKey)
        let backend = NativeAlarmFailureBackend(), provider = NativeAlarmProvider(defaults: defaults, backend: backend)
        let accepted = expectation(description: "Backend accepted alarm before suspension")
        backend.suspendSchedule = true; backend.cancellationFails = true; backend.scheduled = { accepted.fulfill() }
        let scheduling = Task { await provider.scheduleRestResult(id: "race", title: "Descanso", endsAt: Date().addingTimeInterval(300)) }
        await fulfillment(of: [accepted], timeout: 3)
        let disabling = Task { await provider.setEnabled(false) }
        for _ in 0..<100 { if !provider.enabled { break }; await Task.yield() }
        XCTAssertFalse(provider.enabled)
        try XCTUnwrap(backend.continuation).resume(); backend.continuation = nil
        let result = await scheduling.value; await disabling.value
        XCTAssertEqual(result, .uncertain); XCTAssertFalse(result.allowsNotificationFallback)
        XCTAssertTrue(provider.hasUncertainAlarms); XCTAssertEqual(backend.ids.count, 1)
        XCTAssertNotNil(provider.errorMessage)
    }
}

extension NativeCacheRegressionTests {

}

@MainActor private final class NativeRoutineInsertionBackend {
    let owner: String
    var rows: [NativeRoutineExercise] = []
    var postCount = 0
    var getCount = 0
    var loseNextReply = false
    var afterRead: (() -> Void)?
    init(owner: String) { self.owner = owner }
    func fetch() async throws -> [NativeRoutineExercise] { getCount += 1; afterRead?(); return rows }
    func insert(_ body: [String: Any]) async throws {
        postCount += 1
        let id = try XCTUnwrap(body["id"] as? String), day = try XCTUnwrap(body["routine_day_id"] as? String)
        let exercise = try XCTUnwrap(body["exercise_id"] as? String), position = try XCTUnwrap(body["position"] as? Int)
        // Match the real migrated primary key AND UNIQUE(routine_day_id, exercise_id).
        guard !rows.contains(where: { $0.id == id || ($0.routine_day_id == day && $0.exercise_id == exercise) }) else {
            throw NativeFailure.http(409, "23505")
        }
        rows.append(NativeRoutineExercise(id: id, user_id: owner, routine_day_id: day, exercise_id: exercise,
            position: position, target_sets: nil, target_reps: nil, notes: nil))
        if loseNextReply { loseNextReply = false; throw URLError(.networkConnectionLost) }
    }
}

final class NativeRoutineInsertionAcceptanceTests: XCTestCase {
    @MainActor func testLostReplyReconcilesTheOriginalAttemptWithOneTotalInsertAndPreservesLaterMetadata() async throws {
        let attempt = NativeRoutineExerciseInsertion(owner: "a", generation: UUID(), dayID: "day", exerciseID: "Crunches")
        let backend = NativeRoutineInsertionBackend(owner: "a"); backend.loseNextReply = true
        do {
            try await attempt.perform(fetch: { try await backend.fetch() }, insert: { try await backend.insert($0) }, checkCurrent: {})
            XCTFail("Expected the committed insert's reply to be lost")
        } catch let error as URLError { XCTAssertEqual(error.code, .networkConnectionLost) }
        XCTAssertEqual(backend.postCount, 1); XCTAssertEqual(backend.rows.count, 1)
        backend.rows[0] = NativeRoutineExercise(id: attempt.rowID.uppercased(), user_id: "a", routine_day_id: "day", exercise_id: "Crunches",
            position: 7, target_sets: 4, target_reps: "8-12", notes: "Conservar", target_weight_kg: 20)
        try await attempt.perform(fetch: { try await backend.fetch() }, insert: { try await backend.insert($0) }, checkCurrent: {})
        XCTAssertEqual(backend.postCount, 1, "Retry GET finds this attempt and must not send an avoidable UNIQUE-conflicting POST")
        XCTAssertEqual(backend.getCount, 2); XCTAssertEqual(backend.rows.count, 1)
        XCTAssertEqual(backend.rows[0].position, 7); XCTAssertEqual(backend.rows[0].target_sets, 4)
        XCTAssertEqual(backend.rows[0].target_reps, "8-12"); XCTAssertEqual(backend.rows[0].notes, "Conservar"); XCTAssertEqual(backend.rows[0].target_weight_kg, 20)
    }
    @MainActor func testUnrelatedOrForeignRecoveryCannotAcknowledgeAttemptAndChangedGenerationCannotInsert() async throws {
        let generation = UUID(), attempt = NativeRoutineExerciseInsertion(owner: "a", generation: generation, dayID: "day", exerciseID: "Crunches")
        let backend = NativeRoutineInsertionBackend(owner: "a")
        for row in [
            NativeRoutineExercise(id: "other-attempt", user_id: "a", routine_day_id: "day", exercise_id: "Crunches", position: 0, target_sets: nil, target_reps: nil, notes: nil),
            NativeRoutineExercise(id: attempt.rowID, user_id: "b", routine_day_id: "day", exercise_id: "Crunches", position: 0, target_sets: nil, target_reps: nil, notes: nil),
            NativeRoutineExercise(id: attempt.rowID, user_id: "a", routine_day_id: "other-day", exercise_id: "Crunches", position: 0, target_sets: nil, target_reps: nil, notes: nil),
            NativeRoutineExercise(id: attempt.rowID, user_id: "a", routine_day_id: "day", exercise_id: "Other", position: 0, target_sets: nil, target_reps: nil, notes: nil)
        ] {
            backend.rows = [row]
            do { try await attempt.perform(fetch: { try await backend.fetch() }, insert: { try await backend.insert($0) }, checkCurrent: {}); XCTFail("Mismatched insertion identity accepted") }
            catch { XCTAssertTrue(error is NativeFailure) }
        }
        XCTAssertEqual(backend.postCount, 0)
        XCTAssertFalse(attempt.belongs(to: "a", generation: UUID(), dayID: "day", exerciseID: "Crunches"))
        backend.rows = []; var current = true; backend.afterRead = { current = false }
        do {
            try await attempt.perform(fetch: { try await backend.fetch() }, insert: { try await backend.insert($0) }, checkCurrent: { if !current { throw CancellationError() } })
            XCTFail("Old generation inserted after GET")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(backend.postCount, 0)
    }
}

private func nativeAcceptanceRequestBody(_ request: URLRequest) throws -> [String: Any] {
    let data: Data
    if let body = request.httpBody { data = body }
    else if let stream = request.httpBodyStream {
        stream.open(); defer { stream.close() }
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            bytes.append(buffer, count: count)
        }
        data = bytes
    } else { throw NativeFailure.message("El fixture no recibió un cuerpo.") }
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

extension NativeCacheRegressionTests {
    @MainActor func testActualProfilePartialMutationPreservesUneditedRemoteGoalAndTarget() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login(); store.loaded = true
        store.profile = NativeBodyProfile(user_id: "a", goal: "maintain", updated_at: "", height_cm: 180, target_weight_kg: nil, birth_date: nil, sex: nil)
        let requests = NativeOfflineRequests()
        NativeOfflineURLProtocol.handle { request, transport in
            guard request.httpMethod == "POST", request.url?.path == "/rest/v1/body_profile" else { transport.offline(); return }
            requests.append(transport)
            do {
                let patch = try nativeAcceptanceRequestBody(request)
                XCTAssertEqual(Set(patch.keys), ["height_cm"], "Production helper must send only the edited column")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Prefer"), "return=representation,resolution=merge-duplicates,missing=default")
                // Apply the actual payload to a remote profile different from the local cache.
                let remote = NativeBodyProfile(user_id: "a", goal: patch["goal"] as? String ?? "gain", updated_at: "2026-10-08T10:00:00Z",
                    height_cm: patch["height_cm"] as? Double ?? 180, target_weight_kg: patch["target_weight_kg"] is NSNull ? nil : (patch["target_weight_kg"] as? Double ?? 75),
                    birth_date: "1990-01-01", sex: "male")
                transport.finish(201, try JSONEncoder().encode([remote]))
            } catch { XCTFail("Fixture payload/representation failed"); transport.offline() }
        }
        let response = try await NativeBodyMutation.profile(store, patch: ["height_cm": 199], action: NativeWorkoutAction(auth: fixture.auth))
        XCTAssertEqual(response.row.height_cm, 199); XCTAssertEqual(response.row.goal, "gain"); XCTAssertEqual(response.row.target_weight_kg, 75)
        XCTAssertEqual(store.profile?.goal, "gain"); XCTAssertEqual(store.profile?.target_weight_kg, 75)
        await store.refresh()
        XCTAssertEqual(requests.all.count, 1, "A follow-up GET failure cannot automatically resend the mutation")
    }
}

extension NativeWorkoutJournalAcceptanceTests {
    @MainActor private func manualStore(_ fixture: NativeOfflineFixture, repository: NativeWorkoutRepository? = nil) -> NativeStore {
        NativeStore(auth: fixture.auth, api: NativeAPI(auth: fixture.auth, network: fixture.network), automaticallyRefresh: false,
            cache: NativeDataCache(directory: fixture.directory), workoutRepository: repository, automaticallyReplayWorkouts: false)
    }
    @MainActor private func journalBytes(_ fixture: NativeOfflineFixture) throws -> Data {
        let root = try XCTUnwrap(NativeDataCache(directory: fixture.directory).workoutDirectory)
            .appendingPathComponent(fixture.auth.storageNamespace)
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first { $0.pathExtension == "json" })
        return try Data(contentsOf: file)
    }
    @MainActor func testStaleUndoCannotOverwriteNewSeriesOrResurrectDeletedSessionAndWritesNothing() async throws {
        for deletingSession in [false, true] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            let store = manualStore(fixture); try fixture.login(); store.loaded = true
            let action = NativeWorkoutAction(auth: fixture.auth), date = NativeDate.key()
            try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 40) {}
            try await store.commitWorkoutDeletion(action: action, exerciseID: "press", index: 0, date: date, dayID: nil)
            let removedToken = try XCTUnwrap(store.workoutMutationToken(date: date, exerciseID: "press", index: 0))
            if deletingSession { try await store.commitWorkoutSessionDeletion(action: action, date: date) }
            else { try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 12, weight: 50) {} }
            let before = try journalBytes(fixture), pending = try store.workoutRepository.read(owner: "a").outbox.count
            do {
                try await store.commitWorkoutUndo(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 40, expectedToken: removedToken)
                XCTFail("An old undo must fail without any durable write")
            } catch { XCTAssertTrue(error.localizedDescription.contains("No se puede deshacer")) }
            XCTAssertEqual(try journalBytes(fixture), before)
            XCTAssertEqual(try store.workoutRepository.read(owner: "a").outbox.count, pending)
            XCTAssertEqual(store.sets.count, deletingSession ? 0 : 1)
            XCTAssertEqual(store.sets.first?.reps, deletingSession ? nil : 12)
            XCTAssertEqual(store.sessions.count, deletingSession ? 0 : 1)
        }
    }
    @MainActor func testConditionalUndoSurvivesRestartRotatesTokenAndRejectsRepeatedOrForeignUse() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = manualStore(fixture); try fixture.login(); store.loaded = true
        let date = NativeDate.key(), action = NativeWorkoutAction(auth: fixture.auth)
        try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 40) {}
        try await store.commitWorkoutDeletion(action: action, exerciseID: "press", index: 0, date: date, dayID: nil)
        let token = try XCTUnwrap(store.workoutMutationToken(date: date, exerciseID: "press", index: 0))
        let root = try XCTUnwrap(NativeDataCache(directory: fixture.directory).workoutDirectory).appendingPathComponent(fixture.auth.storageNamespace)
        let cold = manualStore(fixture, repository: NativeWorkoutRepository(directory: root))
        XCTAssertEqual(cold.workoutMutationToken(date: date, exerciseID: "press", index: 0), token)
        try await cold.commitWorkoutUndo(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 40, expectedToken: token)
        XCTAssertEqual(cold.sets.first?.reps, 8)
        XCTAssertNotEqual(cold.workoutMutationToken(date: date, exerciseID: "press", index: 0), token)
        let before = try journalBytes(fixture)
        do {
            try await cold.commitWorkoutUndo(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 40, expectedToken: token)
            XCTFail("A consumed undo token cannot be reused")
        } catch {}
        XCTAssertEqual(try journalBytes(fixture), before)
        try fixture.login("b")
        do {
            try await cold.commitWorkoutUndo(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 40, expectedToken: token)
            XCTFail("Outgoing account's undo cannot act on an incoming account")
        } catch is CancellationError {} catch { XCTFail("Owner invalidation must cancel the old action") }
        XCTAssertEqual(try journalBytes(fixture), before)
        XCTAssertTrue(try cold.workoutRepository.read(owner: "b").outbox.isEmpty)
    }
    @MainActor func testOutboxFIFOAndAcknowledgedDeletionFenceSurviveRestart() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = manualStore(fixture); try fixture.login(); store.loaded = true
        let action = NativeWorkoutAction(auth: fixture.auth), date = NativeDate.key()
        try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 9, weight: 40) {}
        try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 10, weight: 45) {}
        let staleSessions = store.sessions, staleSets = store.sets
        try await store.commitWorkoutDeletion(action: action, exerciseID: "press", index: 0, date: date, dayID: nil)
        let remoteSession = try XCTUnwrap(staleSessions.first)
        var writes: [Int] = []
        NativeOfflineURLProtocol.handle { request, transport in
            do {
                if request.url?.path == "/rest/v1/sessions" { transport.finish(200, try JSONEncoder().encode([remoteSession])) }
                else if request.httpMethod == "POST" {
                    let body = try nativeAcceptanceRequestBody(request), reps = try XCTUnwrap(body["reps"] as? Int)
                    writes.append(reps)
                    let row = NativeSet(id: "server-row", user_id: "a", session_id: remoteSession.id, exercise_id: "press", set_index: 0, reps: reps, weight_kg: body["weight_kg"] as? Double)
                    transport.finish(201, try JSONEncoder().encode([row]))
                } else if request.httpMethod == "DELETE" { writes.append(-1); transport.finish(204) }
                else { XCTFail("Unexpected FIFO transport"); transport.offline() }
            } catch { XCTFail("FIFO fixture failed"); transport.offline() }
        }
        await store.replayWorkoutOutbox()
        XCTAssertEqual(writes, [9, 10, -1], "A newer edit or deletion cannot be overtaken by the first edit")
        XCTAssertTrue(try store.workoutRepository.read(owner: "a").outbox.isEmpty)
        let root = try XCTUnwrap(NativeDataCache(directory: fixture.directory).workoutDirectory).appendingPathComponent(fixture.auth.storageNamespace)
        let cold = NativeWorkoutRepository(directory: root)
        XCTAssertTrue(try cold.overlay(owner: "a", sessions: staleSessions, sets: staleSets).sets.isEmpty, "An acknowledged deletion must fence a stale GET across restart")
        XCTAssertTrue(try cold.overlay(owner: "b", sessions: [], sets: []).sets.isEmpty)
        let token = try XCTUnwrap(store.workoutMutationToken(date: date, exerciseID: "press", index: 0))
        let fresh = NativeDataSnapshot(ownerID: "a", savedAt: Date(), routines: [], days: [], routineExercises: [],
            sessions: [remoteSession], sets: [], weights: [], profile: nil)
        try cold.checkpoint(fresh, readRevision: cold.read(owner: "a").revision)
        XCTAssertTrue(try cold.read(owner: "a").changes.isEmpty)
        let afterCheckpoint = manualStore(fixture, repository: NativeWorkoutRepository(directory: root))
        XCTAssertEqual(afterCheckpoint.workoutMutationToken(date: date, exerciseID: "press", index: 0), token, "ACK/checkpoint cleanup cannot expire an otherwise valid undo")
        try await afterCheckpoint.commitWorkoutUndo(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 10, weight: 45, expectedToken: token)
        XCTAssertEqual(afterCheckpoint.sets.first?.reps, 10)
        XCTAssertEqual(try afterCheckpoint.workoutRepository.read(owner: "a").outbox.count, 1)
    }
    @MainActor func testPostAcknowledgementDiskFailureKeepsKnownRowAndPendingSeriesButFencesOldSnapshot() async throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = manualStore(fixture); try fixture.login(); store.loaded = true
        let date = NativeDate.key(), action = NativeWorkoutAction(auth: fixture.auth)
        try await store.commitWorkoutSet(action: action, exerciseID: "press", index: 0, date: date, dayID: nil, reps: 8, weight: 25) {}
        store.profile = NativeBodyProfile(user_id: "a", goal: "gain", updated_at: String(repeating: "x", count: 33 * 1024 * 1024), height_cm: 199, target_weight_kg: 75, birth_date: nil, sex: nil)
        XCTAssertThrowsError(try store.acknowledgeConfirmedMutation(action: action)) { error in
            XCTAssertTrue(error.localizedDescription.contains("se guardó en el servidor"))
        }
        XCTAssertEqual(store.profile?.height_cm, 199); XCTAssertEqual(store.sets.first?.reps, 8)
        let root = try XCTUnwrap(NativeDataCache(directory: fixture.directory).workoutDirectory).appendingPathComponent(fixture.auth.storageNamespace)
        let cold = try NativeWorkoutRepository(directory: root).read(owner: "a")
        XCTAssertNil(cold.snapshot, "A failed post-ACK copy cannot let an older account snapshot masquerade as current")
        XCTAssertEqual(cold.outbox.count, 1); XCTAssertEqual(cold.outbox.first?.reps, 8)
        XCTAssertTrue(cold.snapshotNeedsRevalidation)
    }
}

@MainActor private final class NativeDraftContextFixture: ObservableObject {
    @Published var date = NativeDate.key()
    @Published var dayID = "first-day"
}
private struct NativeDraftContextEditor: View {
    @ObservedObject var context: NativeDraftContextFixture
    var body: some View {
        ScrollView {
            NativeSetRow(exerciseID: "press", index: 0, saved: nil, previous: nil, targetReps: "10", targetWeightKg: nil,
                         date: context.date, dayID: context.dayID)
        }
    }
}
extension NativeCacheUIRegressionTests {
    @MainActor func testReusedProductionRowSwitchesDayWithoutOverwritingEitherPersistedDraft() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login(); store.loaded = true
        let context = NativeDraftContextFixture(), date = context.date
        try store.saveWorkoutDraft(date: date, dayID: "first-day", exerciseID: "press", index: 0, repsText: "11", weightText: "17,5")
        try store.saveWorkoutDraft(date: date, dayID: "second-day", exerciseID: "press", index: 0, repsText: "7", weightText: "75")
        try withHost(AnyView(NativeDraftContextEditor(context: context)), store: store) { controller, window in
            var fields = descendants(controller.view).compactMap { $0 as? UITextField }
            XCTAssertEqual(fields.map(\.text), ["11", "17,5"])
            let weight = try XCTUnwrap(fields.last)
            XCTAssertTrue(weight.becomeFirstResponder()); weight.selectAll(nil); weight.insertText("17,555")
            weight.resignFirstResponder(); settle(controller)
            context.dayID = "second-day"; settle(controller)
            fields = descendants(controller.view).compactMap { $0 as? UITextField }
            XCTAssertEqual(fields.map(\.text), ["7", "75"], "The reused row must hydrate the newly selected day's draft")
            XCTAssertEqual(store.workoutDraft(date: date, dayID: "first-day", exerciseID: "press", index: 0)?.weightText, "17,555")
            XCTAssertEqual(store.workoutDraft(date: date, dayID: "second-day", exerciseID: "press", index: 0)?.weightText, "75")
            context.dayID = "first-day"; settle(controller)
            XCTAssertEqual(descendants(controller.view).compactMap { ($0 as? UITextField)?.text }, ["11", "17,555"])
            XCTAssertTrue(store.sets.isEmpty, "Switching editor contexts must never register either draft")
            _ = try screenshot(window, name: "context-reused-row-day-draft-isolation")
        }
    }
}

extension NativeActiveWorkoutPersistenceAcceptanceTests {
    @MainActor func testCompletedSubstitutedPlanSurvivesColdProjectionAndCannotCrossOwnerOrDeletedSession() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let owner = UUID().uuidString.lowercased(), date = NativeDate.key(), dayID = "performed-day"
        try fixture.login(owner)
        let store = fixture.store(); store.loaded = true
        let original = NativeRoutineExercise(id: "plan", user_id: owner, routine_day_id: dayID, exercise_id: "original", position: 0, target_sets: 1, target_reps: "10", notes: nil)
        let replacement = NativeRoutineExercise(id: "plan", user_id: owner, routine_day_id: dayID, exercise_id: "replacement", position: 0, target_sets: 1, target_reps: "10", notes: nil)
        store.routineExercises = [original]
        store.days = [NativeRoutineDay(id: dayID, user_id: owner, routine_id: "routine", label: "Fuerza", weekday: NativeDate.weekday(Date()))]
        store.sessions = [NativeWorkoutSession(id: "performed-session", user_id: owner, performed_on: date, created_at: "", routine_day_id: dayID, notes: nil, set_count: 1)]
        store.sets = [NativeSet(id: "replacement-set", user_id: owner, session_id: "performed-session", exercise_id: "replacement", set_index: 0, reps: 10, weight_kg: 20)]
        let attributes = F1tWorkoutAttributes(ownerID: owner, sessionDate: date, dayID: dayID, dayLabel: "Fuerza")
        let workout = NativeActiveWorkout(attributes: attributes, startedAt: Date(), updatedAt: Date(), plan: [replacement], exerciseNames: [:], past: [], confirmedSets: store.sets, currentExerciseID: "replacement", restEndsAt: nil, lastExerciseName: nil)
        try NativePerformedWorkoutStorage.write(NativePerformedWorkout(workout))
        defer { try? NativePerformedWorkoutStorage.remove(owner: owner, date: date) }
        let coldRuntime = NativeLiveActivity()
        let frozen = coldRuntime.activePlan(for: attributes, store: store)
        XCTAssertEqual(frozen.map(\.exercise_id), ["replacement"])
        XCTAssertNil(NativeWorkoutProgress.firstUnfinished(plan: frozen, sets: store.sets), "A finished substituted workout cannot become pending against the mutable original routine")
        XCTAssertEqual(coldRuntime.performedPlan(date: date, dayID: dayID, store: store)?.map(\.exercise_id), ["replacement"])
        XCTAssertNil(coldRuntime.performedPlan(date: date, dayID: "another-day", store: store))
        store.sessions = []; store.sets = []
        XCTAssertNil(coldRuntime.performedPlan(date: date, dayID: dayID, store: store), "An archive alone must not resurrect a deleted session")
        try fixture.login("different-owner")
        XCTAssertNil(coldRuntime.performedPlan(date: date, dayID: dayID, store: store))
    }
}

extension NativeGuidedWorkoutTests {
    func testSelectingCurrentExerciseIsANoOpWhileOnlyCurrentSessionMaySelectAnother() {
        XCTAssertFalse(NativeWorkoutSelection.shouldSelect(currentID: "press", candidate: "press", isCurrentSession: true), "Re-selecting the current exercise must not clear the only recording CTA")
        XCTAssertTrue(NativeWorkoutSelection.shouldSelect(currentID: "press", candidate: "row", isCurrentSession: true))
        XCTAssertFalse(NativeWorkoutSelection.shouldSelect(currentID: "press", candidate: "row", isCurrentSession: false))
    }
    @MainActor func testCapturedRowContextPersistsOnlyItsOwnDraftAndRejectsReplacementGeneration() throws {
        let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
        let store = fixture.store(); try fixture.login()
        let action = NativeWorkoutAction(auth: fixture.auth), date = NativeDate.key()
        let first = NativeWorkoutRowContext(ownerID: "a", generation: fixture.auth.generation, date: date, dayID: "first", exerciseID: "press", index: 0)
        let second = NativeWorkoutRowContext(ownerID: "a", generation: fixture.auth.generation, date: date, dayID: "second", exerciseID: "press", index: 0)
        XCTAssertNotEqual(first.controlID, second.controlID)
        try first.persistDraft(in: store, action: action, repsText: "invalid", weightText: "17,555")
        try second.persistDraft(in: store, action: action, repsText: "7", weightText: "75")
        XCTAssertEqual(store.workoutDraft(date: date, dayID: "first", exerciseID: "press", index: 0)?.repsText, "invalid")
        XCTAssertEqual(store.workoutDraft(date: date, dayID: "second", exerciseID: "press", index: 0)?.weightText, "75")
        let revision = try store.workoutRepository.read(owner: "a").revision
        try fixture.login()
        XCTAssertThrowsError(try first.persistDraft(in: store, action: action, repsText: "late", weightText: "late"))
        XCTAssertEqual(try store.workoutRepository.read(owner: "a").revision, revision)
        try fixture.login("b")
        XCTAssertThrowsError(try first.persistDraft(in: store, action: action, repsText: "leak", weightText: "leak"))
        XCTAssertTrue(try store.workoutRepository.read(owner: "b").drafts.isEmpty)
    }
}

extension NativeWorkoutJournalAcceptanceTests {
    @MainActor func testDefinitiveReadDenialFencesDurableSnapshotWithoutErasingOutboxOrDrafts() async throws {
        for status in [401, 403] {
            let fixture = NativeOfflineFixture(); defer { fixture.dispose() }
            let api = NativeAPI(auth: fixture.auth, network: fixture.network, pageLoader: { table, _ in
                if table == "body_profile" { throw NativeFailure.http(status, "fixture") }
                return Data("[]".utf8)
            })
            let store = NativeStore(auth: fixture.auth, api: api, automaticallyRefresh: false,
                cache: NativeDataCache(directory: fixture.directory), automaticallyReplayWorkouts: false)
            try fixture.login()
            let snapshot = NativeOfflineFixture.snapshot(), date = NativeDate.key()
            try store.workoutRepository.checkpoint(snapshot, readRevision: 0)
            try store.workoutRepository.transact(owner: "a") { envelope in
                let row = NativeSet(id: "pending-local-row", user_id: "a", session_id: "session", exercise_id: "press", set_index: 1, reps: 12, weight_kg: 25)
                let operation = NativeWorkoutRepository.Mutation(id: UUID().uuidString, kind: .set, date: date, dayID: "day", exerciseID: "press", index: 1, reps: 12, weight: 25, localSetID: row.id, revision: envelope.revision)
                envelope.sessions = snapshot.sessions
                envelope.outbox = [operation]
                envelope.changes[operation.key] = .init(mutation: operation, row: row, acknowledged: false)
                envelope.drafts["draft"] = NativeWorkoutDraft(repsText: "invalid", weightText: "17,555")
            }
            await store.refresh()
            XCTAssertFalse(store.loaded); XCTAssertFalse(store.usingCachedData)
            let root = try XCTUnwrap(NativeDataCache(directory: fixture.directory).workoutDirectory).appendingPathComponent(fixture.auth.storageNamespace)
            let cold = try NativeWorkoutRepository(directory: root).read(owner: "a")
            XCTAssertNil(cold.snapshot, "A definitive read denial must fence the NEW durable account snapshot too, not only the old cache directory")
            XCTAssertEqual(cold.outbox.count, 1, "Read denial must not erase unsynced workout commands")
            XCTAssertEqual(cold.drafts["draft"]?.weightText, "17,555")
        }
    }
}

extension NativeTests {
    @MainActor func testXCTestHostDoesNotRestoreProductionCredentialsOrPublishIdentity() {
        XCTAssertTrue(NativeApplicationLifecycle.isUnitTestHost)
        XCTAssertFalse(NativeStore.shared.auth.ready, "Host startup must not restore an unrelated installed account during fixture-only tests")
        XCTAssertNil(NativeStore.shared.auth.session, "Test isolation cannot bypass authentication by inventing a local identity")
    }
}
