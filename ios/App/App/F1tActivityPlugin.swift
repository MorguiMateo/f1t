import Capacitor
import CoreMotion
import Foundation
import UserNotifications
import WidgetKit

private struct ActivityReminder: Codable {
    let id: String
    let title: String
    let body: String
    let at: String
    let weekdays: [Int]

    var isValid: Bool {
        let parts = at.split(separator: ":", omittingEmptySubsequences: false)
        return id.range(of: "^[a-zA-Z0-9_-]{1,64}$", options: .regularExpression) != nil
            && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && title.count <= 120 && body.count <= 500
            && parts.count == 2 && parts[0].count == 2 && parts[1].count == 2
            && Int(parts[0]).map({ (0...23).contains($0) }) == true
            && Int(parts[1]).map({ (0...59).contains($0) }) == true
            && !weekdays.isEmpty && weekdays.count <= 7
            && Set(weekdays).count == weekdays.count
            && weekdays.allSatisfy { (0...6).contains($0) }
    }
}

@objc(F1tActivityPlugin)
public class F1tActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "F1tActivityPlugin"
    public let jsName = "F1tActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setOwner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStepsToday", returnType: CAPPluginReturnPromise)
    ]

    private let center = UNUserNotificationCenter.current()
    private let pedometer = CMPedometer()
    private let ownerKey = "f1t.activity.owner"
    private let reminderKey = "f1t.activity.reminder"
    private let prefix = "f1t.reminder."
    private var stepRevision = UUID()

    private var owner: String? { UserDefaults.standard.string(forKey: ownerKey) }

    private var savedReminder: ActivityReminder? {
        guard let data = UserDefaults.standard.data(forKey: reminderKey) else { return nil }
        return try? JSONDecoder().decode(ActivityReminder.self, from: data)
    }

    private func removeF1tRequests(_ completion: @escaping () -> Void) {
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self = self else { completion(); return }
            let ids = requests.map(\.identifier).filter { $0.hasPrefix(self.prefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: ids)
            self.center.getDeliveredNotifications { delivered in
                let deliveredIds = delivered.map(\.request.identifier).filter { $0.hasPrefix(self.prefix) }
                self.center.removeDeliveredNotifications(withIdentifiers: deliveredIds)
                completion()
            }
        }
    }

    @objc func setOwner(_ call: CAPPluginCall) {
        let next = call.getString("ownerId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = next?.isEmpty == false ? next : nil
        if owner == normalized, normalized != nil { call.resolve(); return }
        // Fence a pending sensor read before asynchronous notification cleanup.
        stepRevision = UUID()
        do {
            try F1tStepsStorage.clear()
            WidgetCenter.shared.reloadTimelines(ofKind: F1tStepsStorage.widgetKind)
        } catch { call.reject("Could not clear steps widget", "CLEAR_FAILED", error); return }
        removeF1tRequests { [weak self] in
            guard let self = self else { call.reject("Activity plugin unavailable"); return }
            UserDefaults.standard.removeObject(forKey: self.reminderKey)
            if let normalized = normalized {
                UserDefaults.standard.set(normalized, forKey: self.ownerKey)
            } else {
                UserDefaults.standard.removeObject(forKey: self.ownerKey)
            }
            call.resolve()
        }
    }

    @objc func scheduleReminder(_ call: CAPPluginCall) {
        guard owner != nil else { call.reject("No active account", "NO_OWNER"); return }
        guard let raw = call.getObject("reminder"),
              JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw),
              let reminder = try? JSONDecoder().decode(ActivityReminder.self, from: data),
              reminder.isValid else {
            call.reject("Invalid reminder", "INVALID_REMINDER")
            return
        }

        center.getNotificationSettings { [weak self] settings in
            guard let self = self else { call.reject("Activity plugin unavailable"); return }
            if settings.authorizationStatus == .notDetermined {
                self.center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                    if let error = error { call.reject("Notification permission failed", "PERMISSION_FAILED", error); return }
                    if !granted { call.resolve(["scheduled": false]); return }
                    self.replaceReminder(reminder, call: call)
                }
            } else if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral {
                self.replaceReminder(reminder, call: call)
            } else {
                call.resolve(["scheduled": false])
            }
        }
    }

    private func replaceReminder(_ reminder: ActivityReminder, call: CAPPluginCall) {
        removeF1tRequests { [weak self] in
            guard let self = self else { call.reject("Activity plugin unavailable"); return }
            UserDefaults.standard.removeObject(forKey: self.reminderKey)
            let parts = reminder.at.split(separator: ":")
            let hour = Int(parts[0])!
            let minute = Int(parts[1])!
            // One repeating request per weekday (at most 7). No absolute date or
            // timezone is pinned: these calendar components follow local time.
            let requests = reminder.weekdays.map { day -> UNNotificationRequest in
                var components = DateComponents()
                components.weekday = day + 1 // JS Sunday=0, Foundation Sunday=1.
                components.hour = hour
                components.minute = minute
                let content = UNMutableNotificationContent()
                content.title = reminder.title
                content.body = reminder.body
                content.sound = .default
                return UNNotificationRequest(
                    identifier: "\(self.prefix)\(reminder.id).\(day)",
                    content: content,
                    trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
                )
            }
            self.addRequests(requests, index: 0, reminder: reminder, call: call)
        }
    }

    private func addRequests(_ requests: [UNNotificationRequest], index: Int,
                             reminder: ActivityReminder, call: CAPPluginCall) {
        if index == requests.count {
            guard let data = try? JSONEncoder().encode(reminder) else {
                call.reject("Could not persist reminder", "SAVE_FAILED")
                return
            }
            UserDefaults.standard.set(data, forKey: reminderKey)
            call.resolve(["scheduled": true])
            return
        }
        center.add(requests[index]) { [weak self] error in
            guard let self = self else { call.reject("Activity plugin unavailable"); return }
            if let error = error {
                self.removeF1tRequests {
                    call.reject("Could not schedule reminder", "SCHEDULE_FAILED", error)
                }
                return
            }
            self.addRequests(requests, index: index + 1, reminder: reminder, call: call)
        }
    }

    @objc func cancelReminder(_ call: CAPPluginCall) {
        guard owner != nil else { call.reject("No active account", "NO_OWNER"); return }
        guard let id = call.getString("id"), id == savedReminder?.id else {
            call.resolve()
            return
        }
        removeF1tRequests { [weak self] in
            guard let self = self else { call.reject("Activity plugin unavailable"); return }
            UserDefaults.standard.removeObject(forKey: self.reminderKey)
            call.resolve()
        }
    }

    @objc func getReminder(_ call: CAPPluginCall) {
        guard owner != nil, let reminder = savedReminder,
              let data = try? JSONEncoder().encode(reminder),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            call.resolve(["reminder": NSNull()])
            return
        }
        call.resolve(["reminder": object])
    }

    @objc func getStepsToday(_ call: CAPPluginCall) {
        guard let requestOwner = owner else { call.resolve(["steps": NSNull()]); return }
        let ticket = UUID(); stepRevision = ticket
        guard CMPedometer.isStepCountingAvailable() else {
            resolveSteps(status: .unsupported, call: call); return
        }
        switch CMPedometer.authorizationStatus() {
        case .denied: resolveSteps(status: .denied, call: call); return
        case .restricted: resolveSteps(status: .restricted, call: call); return
        case .notDetermined where call.getBool("requestPermission") != true:
            resolveSteps(status: .notDetermined, call: call); return
        default: break
        }
        let now = Date(), calendar = Calendar.current
        pedometer.queryPedometerData(from: calendar.startOfDay(for: now), to: now) { [weak self] data, error in
            DispatchQueue.main.async {
                guard let self, self.owner == requestOwner, self.stepRevision == ticket else {
                    call.resolve(["steps": NSNull()]); return
                }
                guard calendar.timeZone == Calendar.current.timeZone,
                      F1tStepsPayload.dateKey(now, calendar: calendar) == F1tStepsPayload.dateKey(Date()) else {
                    self.resolveSteps(status: .unavailable, call: call); return
                }
                if error == nil, let steps = data?.numberOfSteps.intValue, steps >= 0,
                   CMPedometer.authorizationStatus() == .authorized {
                    self.resolveSteps(status: .available, count: steps, sampledAt: now, call: call)
                } else {
                    let status: F1tStepsPayload.Status
                    switch CMPedometer.authorizationStatus() {
                    case .denied: status = .denied
                    case .restricted: status = .restricted
                    case .notDetermined: status = .notDetermined
                    default: status = .unavailable
                    }
                    self.resolveSteps(status: status, call: call)
                }
            }
        }
    }

    private func resolveSteps(status: F1tStepsPayload.Status, count: Int? = nil,
                              sampledAt: Date = Date(), call: CAPPluginCall) {
        guard let owner else { call.resolve(["steps": NSNull()]); return }
        let payload = F1tStepsPayload(ownerID: owner, status: status, steps: count, sampledAt: sampledAt)
        do {
            try F1tStepsStorage.write(payload)
            WidgetCenter.shared.reloadTimelines(ofKind: F1tStepsStorage.widgetKind)
            call.resolve(["steps": count.map { $0 as Any } ?? NSNull(), "dayKey": payload.dayKey])
        } catch { call.reject("Could not update steps widget", "WRITE_FAILED", error) }
    }
}
