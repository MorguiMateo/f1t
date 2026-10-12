import Combine
import CryptoKit
import Foundation
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

/// Only `unavailable` confirms it is safe to use an ordinary notification.
/// `uncertain` means an alarm may remain active: do not add another alert.
enum NativeRestAlarmResult: Equatable {
    case scheduled, unavailable, uncertain
    var allowsNotificationFallback: Bool { self == .unavailable }
}

enum NativeRestAlarmCancellationResult: Equatable {
    case cancelled, uncertain
}

/// Isolates system effects so failure-after-acceptance and cancellation races
/// can be tested without registering real alarms or requesting permission.
@MainActor protocol NativeRestAlarmBackend {
    var authorizationStatus: NativeAlarmProvider.AuthorizationStatus { get }
    func requestAuthorization() async throws -> NativeAlarmProvider.AuthorizationStatus
    func activeIDs() throws -> Set<UUID>
    func schedule(id: UUID, title: String, endsAt: Date) async throws
    func cancel(id: UUID) throws
}

@MainActor
final class NativeAlarmProvider: ObservableObject {
    static let shared = NativeAlarmProvider()
    static let enabledKey = "native.workout.alarms.enabled"
    private static let scheduledKey = "native.workout.alarms.scheduled"
    private static let journalKey = "native.workout.alarms.journal"

    enum AuthorizationStatus: Equatable {
        case unavailable, notDetermined, denied, authorized
        var label: String {
            switch self {
            case .unavailable: "Las alarmas de descanso requieren iOS 26 o posterior."
            case .notDetermined: "Todavía no autorizaste las alarmas de FIT."
            case .denied: "Las alarmas están desautorizadas. Podés habilitarlas en Ajustes."
            case .authorized: "Alarmas autorizadas."
            }
        }
    }

    @Published private(set) var enabled: Bool
    @Published private(set) var authorizationStatus: AuthorizationStatus = .unavailable
    @Published private(set) var errorMessage: String?
    @Published private(set) var hasUncertainAlarms = false
    private let defaults: UserDefaults
    private let backend: (any NativeRestAlarmBackend)?
    private var revision = UUID()
    private var tickets: [UUID: UUID] = [:]
    private var queue: Task<Void, Never>?
    private var authorizationTask: Task<Void, Never>?

    init(defaults: UserDefaults = .standard, backend: (any NativeRestAlarmBackend)? = nil) {
        self.defaults = defaults
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { self.backend = backend ?? NativeSystemRestAlarmBackend() }
        else { self.backend = backend }
        #else
        self.backend = backend
        #endif
        enabled = defaults.bool(forKey: Self.enabledKey)
        var saved = defaults.dictionary(forKey: Self.journalKey) as? [String: String] ?? [:]
        for raw in defaults.stringArray(forKey: Self.scheduledKey) ?? [] where saved[raw] == nil {
            if UUID(uuidString: raw) != nil { saved[raw] = "uncertain" }
        }
        defaults.set(saved, forKey: Self.journalKey)
        hasUncertainAlarms = saved.values.contains("uncertain")
        refreshAuthorization()
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), backend == nil {
            authorizationTask = Task { [weak self] in
                for await state in AlarmManager.shared.authorizationUpdates {
                    guard !Task.isCancelled, let self else { return }
                    self.authorizationStatus = Self.status(state)
                }
            }
        }
        #endif
    }

    func refreshAuthorization() {
        authorizationStatus = backend?.authorizationStatus ?? .unavailable
    }

    /// Only the explicit settings action requests permission; rest scheduling never prompts.
    func setEnabled(_ value: Bool) async {
        revision = UUID()
        let ticket = revision
        errorMessage = nil
        if !value {
            enabled = false
            defaults.set(false, forKey: Self.enabledKey)
            await cancelAll()
            return
        }
        refreshAuthorization()
        guard authorizationStatus != .unavailable else { return }
        if let backend {
            do {
                let state = try await backend.requestAuthorization()
                guard revision == ticket else { return }
                authorizationStatus = state
                enabled = state == .authorized
                defaults.set(enabled, forKey: Self.enabledKey)
            } catch {
                guard revision == ticket else { return }
                errorMessage = "No se pudo solicitar el permiso de alarmas. Podés reintentar."
            }
        }
    }

    /// Stable, opaque ids survive a process restart, without persisting account ids or titles.
    static func alarmID(for id: String) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(("f1t.rest.alarm:" + id).utf8)).prefix(16))
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }

    /// Compatibility only: true also means an uncertain alarm MAY be active.
    /// New runtime consumers MUST use scheduleRestResult and fall back only on unavailable.
    func scheduleRest(id: String, title: String, endsAt: Date) async -> Bool {
        await scheduleRestResult(id: id, title: title, endsAt: endsAt) != .unavailable
    }

    func scheduleRestResult(id: String, title: String, endsAt: Date) async -> NativeRestAlarmResult {
        let alarmID = Self.alarmID(for: id), ticket = UUID(), revision = revision
        tickets[alarmID] = ticket
        let previous = queue
        let operation = Task { @MainActor [weak self] () -> NativeRestAlarmResult in
            await previous?.value
            guard let self else { return .uncertain }
            guard self.revision == revision, self.tickets[alarmID] == ticket else { return .uncertain }
            // Reconcile ALL opaque ids, not just this rest: a failed cancellation
            // from an earlier deadline/account must block any second alert.
            var existing = self.rememberedIDs
            if self.backend != nil, !id.isEmpty { existing.insert(alarmID) }
            guard self.confirmAbsence(of: existing) == .cancelled else {
                self.showUncertainty(ifCurrent: revision)
                return .uncertain
            }
            self.errorMessage = nil
            self.refreshAuthorization()
            guard !id.isEmpty, self.enabled, self.revision == revision, self.tickets[alarmID] == ticket,
                  endsAt.timeIntervalSinceNow > 0, self.authorizationStatus == .authorized,
                  let backend = self.backend else { return .unavailable }
            // Persist BEFORE touching the system. A crash or a throw after
            // acceptance must retain the id for reconciliation on the next launch.
            self.remember(alarmID, uncertain: true)
            do {
                try await backend.schedule(id: alarmID, title: title, endsAt: endsAt)
                guard self.enabled, self.revision == revision, self.tickets[alarmID] == ticket else {
                    let absent = self.confirmAbsence(of: [alarmID]) == .cancelled
                    if !absent { self.showUncertainty(ifCurrent: self.revision) }
                    return absent ? .unavailable : .uncertain
                }
                self.remember(alarmID, uncertain: false)
                self.errorMessage = nil
                return .scheduled
            } catch {
                // schedule can throw after the system accepted it. Attempt bounded
                // cleanup, then read system state; a thrown cancel is NOT absence.
                guard self.confirmAbsence(of: [alarmID]) == .cancelled else {
                    self.showUncertainty(ifCurrent: revision)
                    return .uncertain
                }
                if self.revision == revision, self.tickets[alarmID] == ticket {
                    self.errorMessage = "No se pudo programar la alarma de descanso. Se intentará el aviso habitual si está autorizado."
                }
                return .unavailable
            }
        }
        queue = Task { _ = await operation.value }
        return await operation.value
    }

    func cancelRest(id: String) async {
        _ = await cancelRestResult(id: id)
    }

    func cancelRestResult(id: String) async -> NativeRestAlarmCancellationResult {
        let alarmID = Self.alarmID(for: id)
        tickets[alarmID] = UUID() // Invalidate immediately, before waiting on system work.
        return await cancel([alarmID])
    }

    /// Runtime should invoke on account invalidation as well as cancelling its own rest id.
    func cancelAll() async {
        _ = await cancelAllResult()
    }

    func cancelAllResult() async -> NativeRestAlarmCancellationResult {
        revision = UUID()
        let ids = Set(tickets.keys).union(rememberedIDs)
        tickets.removeAll()
        return await cancel(ids)
    }

    private var journal: [String: String] {
        defaults.dictionary(forKey: Self.journalKey) as? [String: String] ?? [:]
    }

    private var rememberedIDs: Set<UUID> { Set(journal.keys.compactMap(UUID.init(uuidString:))) }

    private func remember(_ id: UUID, uncertain: Bool) {
        var saved = journal
        saved[id.uuidString] = uncertain ? "uncertain" : "scheduled"
        writeJournal(saved)
    }

    private func writeJournal(_ saved: [String: String]) {
        defaults.set(saved, forKey: Self.journalKey)
        defaults.set(saved.keys.sorted(), forKey: Self.scheduledKey)
        hasUncertainAlarms = saved.values.contains("uncertain")
    }

    /// Never removes an id until a successful state read confirms absence.
    /// Two bounded cancellation attempts handle a transient throw without looping forever.
    private func confirmAbsence(of ids: Set<UUID>) -> NativeRestAlarmCancellationResult {
        guard !ids.isEmpty else { return .cancelled }
        guard let backend else { return rememberedIDs.isDisjoint(with: ids) ? .cancelled : .uncertain }
        var saved = journal
        for id in ids { saved[id.uuidString] = "uncertain" }
        writeJournal(saved)
        for attempt in 0...2 {
            let active: Set<UUID>
            do { active = try backend.activeIDs() }
            catch { return .uncertain }
            let remaining = ids.intersection(active)
            saved = journal
            for id in ids.subtracting(remaining) { saved[id.uuidString] = nil }
            writeJournal(saved)
            if remaining.isEmpty { return .cancelled }
            if attempt == 2 { return .uncertain }
            for id in remaining {
                do { try backend.cancel(id: id) }
                catch { /* Retain uncertainty, retry and reconcile against system state. */ }
            }
        }
        return .uncertain
    }

    private func showUncertainty(ifCurrent messageRevision: UUID) {
        guard revision == messageRevision else { return }
        errorMessage = "No se pudo confirmar la cancelación de una alarma. Puede seguir activa; no se agregará otro aviso. Reintentá desde FIT."
    }

    private func cancel(_ ids: Set<UUID>) async -> NativeRestAlarmCancellationResult {
        let previous = queue
        let messageRevision = revision
        let operation = Task { @MainActor [weak self] () -> NativeRestAlarmCancellationResult in
            await previous?.value
            guard let self else { return .uncertain }
            let result = self.confirmAbsence(of: ids)
            if result == .uncertain { self.showUncertainty(ifCurrent: messageRevision) }
            else if self.revision == messageRevision { self.errorMessage = nil }
            return result
        }
        queue = Task { _ = await operation.value }
        return await operation.value
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    fileprivate static func status(_ value: AlarmManager.AuthorizationState) -> AuthorizationStatus {
        switch value {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .authorized: .authorized
        @unknown default: .unavailable
        }
    }
    #endif
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
@MainActor private final class NativeSystemRestAlarmBackend: NativeRestAlarmBackend {
    var authorizationStatus: NativeAlarmProvider.AuthorizationStatus {
        NativeAlarmProvider.status(AlarmManager.shared.authorizationState)
    }

    func requestAuthorization() async throws -> NativeAlarmProvider.AuthorizationStatus {
        guard let usage = Bundle.main.object(forInfoDictionaryKey: "NSAlarmKitUsageDescription") as? String,
              !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        return NativeAlarmProvider.status(try await AlarmManager.shared.requestAuthorization())
    }

    func activeIDs() throws -> Set<UUID> { Set(try AlarmManager.shared.alarms.map(\.id)) }
    func cancel(id: UUID) throws { try AlarmManager.shared.cancel(id: id) }

    func schedule(id: UUID, title: String, endsAt: Date) async throws {
        let safeTitle = String(title.prefix(100))
        let text = LocalizedStringResource(stringLiteral: safeTitle.isEmpty ? "Descanso terminado" : safeTitle)
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) { alert = AlarmPresentation.Alert(title: text) }
        else {
            alert = AlarmPresentation.Alert(title: text,
                stopButton: .init(text: "Listo", textColor: .white, systemImageName: "checkmark"))
        }
        let attributes = AlarmAttributes<F1tRestAlarmMetadata>(
            presentation: .init(alert: alert, countdown: .init(title: "Descanso")),
            metadata: .init(), tintColor: .orange)
        let configuration = AlarmManager.AlarmConfiguration(
            countdownDuration: .init(preAlert: max(1, endsAt.timeIntervalSinceNow), postAlert: nil),
            schedule: .fixed(endsAt), attributes: attributes)
        _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
    }
}
#endif

struct NativeAlarmSettingsView: View {
    @ObservedObject private var provider = NativeAlarmProvider.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var requesting = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Alarmas de descanso").font(.fit(.base, .semibold))
            Text("Opcional en iOS 26: una alarma al terminar el descanso, incluso con la pantalla bloqueada. Puede sonar con Silencio o un modo de Concentración activo.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            Toggle("Usar alarmas de descanso", isOn: Binding(get: { provider.enabled }, set: { value in
                requesting = true
                Task { await provider.setEnabled(value); requesting = false }
            }))
            .tint(FitColor.accent)
            .disabled(requesting || provider.authorizationStatus == .unavailable)
            Text(provider.authorizationStatus.label).font(.fit(.sm)).foregroundStyle(FitColor.muted)
            if let error = provider.errorMessage { Text(error).font(.fit(.sm)).foregroundStyle(FitColor.muted) }
            if provider.hasUncertainAlarms {
                Button("Reintentar cancelación") {
                    requesting = true
                    Task { _ = await provider.cancelAllResult(); requesting = false }
                }
                .font(.fit(.sm))
                .disabled(requesting)
            }
            Text("Si no usás alarmas, FIT intenta un aviso normal con tu permiso de notificaciones; Silencio y Concentración pueden silenciarlo. El teléfono debe estar encendido.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted)
        }
        .padding(20).fitCard(padding: 0)
        .onAppear { provider.refreshAuthorization() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { provider.refreshAuthorization() } }
    }
}
