import Capacitor
import Foundation
import WidgetKit

@objc(F1tWidgetPlugin)
public class F1tWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "F1tWidgetPlugin"
    public let jsName = "F1tWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearWidget", returnType: CAPPluginReturnPromise)
    ]

    @objc func writeWidget(_ call: CAPPluginCall) {
        guard let json = call.getString("json"),
              let data = json.data(using: .utf8), data.count <= 131_072,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(["levels", "todayLabel", "todayExercises", "streak"]).isSubset(of: Set(object.keys)),
              Set(object.keys).isSubset(of: Set(["levels", "todayLabel", "todayExercises", "streak", "schemaVersion", "routineWeek"])),
              let payload = try? JSONDecoder().decode(F1tWidgetPayload.self, from: data),
              payload.isValid else {
            call.reject("Invalid WidgetPayload", "INVALID_PAYLOAD")
            return
        }

        guard let url = F1tWidgetStorage.fileURL() else {
            call.reject("App Group container unavailable; check signing and entitlements", "APP_GROUP_UNAVAILABLE")
            return
        }

        do {
            // Atomic replacement means the extension never sees partial JSON.
            // Available to lock-screen widgets after the first device unlock.
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Could not write widget payload", "WRITE_FAILED", error)
        }
    }

    @objc func clearWidget(_ call: CAPPluginCall) {
        guard let url = F1tWidgetStorage.fileURL() else {
            call.reject("App Group container unavailable; check signing and entitlements", "APP_GROUP_UNAVAILABLE")
            return
        }

        do {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Could not clear widget payload", "CLEAR_FAILED", error)
        }
    }
}
