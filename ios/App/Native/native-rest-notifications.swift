import Combine
import Foundation
import UIKit
import UserNotifications

/// Permission is independent of the user's preference to receive rest notices.
enum NativeRestPermissionAction: Equatable {
    case loading, request, toggle, settings
    static func resolve(_ status: UNAuthorizationStatus?) -> Self {
        guard let status else { return .loading }
        switch status {
        case .notDetermined: return .request
        case .authorized, .provisional, .ephemeral: return .toggle
        case .denied: return .settings
        @unknown default: return .settings
        }
    }
}

/// System-delivered notices, not an in-process timer. No periodic background work.
@MainActor
final class NativeRestNotifications: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NativeRestNotifications()
    static let prefix = "f1t.native.rest."
    @Published private(set) var permissionMessage: String?
    @Published private(set) var deliveryMessage: String?
    @Published private(set) var authorizationStatus: UNAuthorizationStatus?
    @Published private(set) var needsSettings = false
    var permissionAction: NativeRestPermissionAction { NativeRestPermissionAction.resolve(authorizationStatus) }
    @Published var enabled: Bool {
        didSet { defaults.set(enabled, forKey: "native.workout.restAlertsEnabled") }
    }
    private let center: UNUserNotificationCenter
    private let defaults: UserDefaults
    private let alarmProvider: NativeAlarmProvider
    private var ticket = UUID()
    private var currentID: String?
    private var pendingCancellations: Set<String>
    private var appliedID: String?
    private var invalidated = true
    private var currentURL: URL?
    private var lastFeedbackID: String?
    private var isCurrent: (() -> Bool)?
    private var restoreWorkout: (() async -> Void)?

    init(center: UNUserNotificationCenter = .current(), defaults: UserDefaults = .standard,
         alarmProvider: NativeAlarmProvider? = nil) {
        self.center = center; self.defaults = defaults; self.alarmProvider = alarmProvider ?? .shared
        enabled = defaults.object(forKey: "native.workout.restAlertsEnabled") as? Bool ?? true
        currentID = defaults.string(forKey: "native.workout.restNoticeID")
        pendingCancellations = Set(defaults.stringArray(forKey: "native.workout.restNoticeCancellationIDs") ?? [])
        super.init()
    }

    func attach(isCurrent: @escaping () -> Bool, restoreWorkout: (() async -> Void)? = nil) {
        self.isCurrent = isCurrent
        self.restoreWorkout = restoreWorkout
        center.delegate = self
        Task { await refreshPermission() }
    }

    /// Called by a contextual user action, never by restoring or starting a timer.
    func requestPermission() async {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound])
            await refreshPermission()
        } catch {
            permissionMessage = "No se pudo solicitar el permiso. Revisá Notificaciones en Ajustes."
        }
    }

    func refreshPermission() async {
        let settings = await center.notificationSettings()
        authorizationStatus = settings.authorizationStatus
        needsSettings = settings.authorizationStatus == .denied || settings.authorizationStatus == .provisional ||
            settings.soundSetting != .enabled || settings.lockScreenSetting != .enabled
        switch settings.authorizationStatus {
        case .notDetermined:
            permissionMessage = "Activá los avisos para recibir el fin del descanso con la pantalla apagada."
        case .denied:
            permissionMessage = "Avisos desactivados en Ajustes. El contador sigue funcionando; no recibirás una notificación de descanso."
        case .authorized, .provisional, .ephemeral:
            if settings.authorizationStatus == .provisional {
                permissionMessage = "Los avisos se entregan de forma silenciosa hasta que los habilites en Ajustes."
            } else if settings.soundSetting != .enabled {
                permissionMessage = "Avisos sin sonido. Revisá Notificaciones en Ajustes."
            } else if settings.lockScreenSetting != .enabled {
                permissionMessage = "Avisos habilitados, pero ocultos en la pantalla de bloqueo."
            } else {
                permissionMessage = "Avisos habilitados. Silencio y Concentración pueden limitar el sonido."
            }
        @unknown default:
            permissionMessage = "Revisá el permiso de notificaciones en Ajustes."
        }
    }

    /// The stable ID includes the workout and deadline. Republishing a card never
    /// restarts its timer or creates a second alert.
    func replace(id: String, title: String, endsAt: Date, url: URL?) async {
        if currentID == id, appliedID == id, !invalidated {
            currentURL = url
            return
        }
        let revision = UUID(); ticket = revision
        let previous = currentID
        currentID = id; currentURL = url
        appliedID = nil
        invalidated = false
        deliveryMessage = nil
        defaults.set(id, forKey: "native.workout.restNoticeID")
        if let previous {
            center.removePendingNotificationRequests(withIdentifiers: [previous])
            center.removeDeliveredNotifications(withIdentifiers: [previous])
            rememberCancellation(previous)
            if await alarmProvider.cancelRestResult(id: previous) == .cancelled, ticket == revision {
                forgetCancellation(previous)
            }
        }
        guard ticket == revision, currentID == id else { return }
        await removeOrphans(keeping: id)
        guard ticket == revision, currentID == id, enabled, endsAt > Date(), isCurrent?() == true else { return }
        // The provider reconciles its durable journal before scheduling. Only a
        // confirmed absence allows fallback: a thrown cancellation is NOT absence.
        let alarm = await alarmProvider.scheduleRestResult(id: id, title: title, endsAt: endsAt)
        guard ticket == revision, currentID == id, isCurrent?() == true else {
            rememberCancellation(id)
            let cancellation = await alarmProvider.cancelRestResult(id: id)
            if cancellation == .cancelled, ticket == revision {
                forgetCancellation(id)
            } else if cancellation == .uncertain {
                deliveryMessage = Self.uncertaintyMessage
            }
            return
        }
        switch alarm {
        case .scheduled:
            clearCancellations()
            appliedID = id
            return
        case .uncertain:
            rememberCancellation(id)
            deliveryMessage = Self.uncertaintyMessage
            return
        case .unavailable:
            clearCancellations()
        }
        let settings = await center.notificationSettings()
        guard ticket == revision, currentID == id, isCurrent?() == true else { return }
        await refreshPermission()
        guard ticket == revision, currentID == id else { return }
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let remaining = endsAt.timeIntervalSinceNow
        guard remaining > 0 else { return }
        let content = UNMutableNotificationContent()
        content.title = "Descanso terminado"
        content.body = "Podés continuar con la próxima serie."
        content.sound = settings.soundSetting == .enabled ? .default : nil
        content.threadIdentifier = "f1t.workout.rest"
        content.userInfo = ["restID": id]
        if let url { content.userInfo["workoutURL"] = url.absoluteString }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, remaining), repeats: false)
        do {
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
            if ticket != revision || currentID != id {
                center.removePendingNotificationRequests(withIdentifiers: [id])
            } else { appliedID = id }
        } catch {
            if ticket == revision { deliveryMessage = "No se pudo programar el aviso de descanso. El contador sigue funcionando." }
        }
    }

    func cancel() async {
        invalidated = true
        let revision = UUID(); ticket = revision
        let previous = currentID
        currentID = nil; currentURL = nil; appliedID = nil
        defaults.removeObject(forKey: "native.workout.restNoticeID")
        if let previous {
            center.removePendingNotificationRequests(withIdentifiers: [previous])
            center.removeDeliveredNotifications(withIdentifiers: [previous])
            rememberCancellation(previous)
        }
        // Persist identifiers until system state confirms absence, including
        // cancellation on logout/finish and retries after a cold launch.
        for id in pendingCancellations {
            let result = await alarmProvider.cancelRestResult(id: id)
            // Scoped old-ID cleanup is safe, but a newer rest now owns global
            // cancellation. Never let this suspended operation cancel it.
            if result == .cancelled, ticket == revision || currentID != id {
                forgetCancellation(id)
            }
            guard ticket == revision else { return }
        }
        guard ticket == revision else { return }
        let result = await alarmProvider.cancelAllResult()
        guard ticket == revision else { return }
        if result == .cancelled, ticket == revision { clearCancellations() }
        if ticket == revision {
            deliveryMessage = result == .uncertain ? Self.uncertaintyMessage : nil
        }
        await removeOrphans(keeping: nil)
    }

    private static let uncertaintyMessage = "No se pudo confirmar la cancelación de una alarma. Puede seguir activa; no se agregará otro aviso. Abrí FIT y reintentá."

    private func rememberCancellation(_ id: String) {
        pendingCancellations.insert(id)
        defaults.set(pendingCancellations.sorted(), forKey: "native.workout.restNoticeCancellationIDs")
    }

    private func forgetCancellation(_ id: String) {
        pendingCancellations.remove(id)
        defaults.set(pendingCancellations.sorted(), forKey: "native.workout.restNoticeCancellationIDs")
    }

    private func clearCancellations() {
        pendingCancellations.removeAll()
        defaults.removeObject(forKey: "native.workout.restNoticeCancellationIDs")
    }

    /// Synchronous supersession closes the window before queued system work runs.
    /// Keep the ID so cancel() can also remove its AlarmKit counterpart.
    func invalidate() {
        ticket = UUID()
        appliedID = nil; invalidated = true
        if let currentID {
            center.removePendingNotificationRequests(withIdentifiers: [currentID])
            center.removeDeliveredNotifications(withIdentifiers: [currentID])
        }
    }

    /// A delivered notice can launch the app after its deadline. Rebind only
    /// the exact durable rest, after owner validation; never schedule it again.
    func restoreDeliveredNotice(id: String, url: URL?) {
        guard currentID == id, isCurrent?() == true else { return }
        invalidated = false
        currentURL = url
    }

    private func removeOrphans(keeping id: String?) async {
        let requests = await center.pendingNotificationRequests()
        // Re-check currentID after awaiting: a newer session may now own its request.
        let keep = currentID ?? id
        let old = requests.map(\.identifier).filter { $0.hasPrefix(Self.prefix) && $0 != keep }
        center.removePendingNotificationRequests(withIdentifiers: old)
        let delivered = await center.deliveredNotifications()
        let obsolete = delivered.map { $0.request.identifier }.filter { $0.hasPrefix(Self.prefix) && $0 != currentID }
        center.removeDeliveredNotifications(withIdentifiers: obsolete)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run {
            let id = notification.request.identifier
            guard id.hasPrefix(Self.prefix) else { return [.banner, .sound] }
            guard self.currentID == id, !self.invalidated, self.enabled, self.isCurrent?() == true else { return [] }
            if self.lastFeedbackID != id {
                self.lastFeedbackID = id
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
            return [.banner, .sound]
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        await openWorkout(response)
    }

    private func openWorkout(_ response: UNNotificationResponse) async {
        guard response.notification.request.identifier.hasPrefix(Self.prefix) else { return }
        await restoreWorkout?()
        guard currentID == response.notification.request.identifier, !invalidated,
              isCurrent?() == true,
              let text = response.notification.request.content.userInfo["workoutURL"] as? String,
              let url = URL(string: text), url.scheme == "f1t", url.host == "workout",
              url == currentURL else { return }
        NotificationCenter.default.post(name: .nativeWorkoutOpenRequested, object: url)
    }
}

extension Notification.Name {
    static let nativeWorkoutOpenRequested = Notification.Name("nativeWorkoutOpenRequested")
}
