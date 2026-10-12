import Combine
import CoreMotion
import SwiftUI
import UIKit
import UserNotifications
import WidgetKit

/// Presentation is derived from permission and successful scheduling, not just the saved toggle.
enum NativeReminderState: Equatable {
    case disabled, waiting, noDays, permissionNeeded, blocked, scheduling, scheduled, failed
    static func resolve(enabled: Bool, loaded: Bool, hasDays: Bool, permissionKnown: Bool,
                        allowed: Bool, blocked: Bool, scheduling: Bool, scheduled: Bool) -> Self {
        guard loaded else { return .waiting }
        guard hasDays else { return .noDays }
        guard enabled else { return .disabled }
        guard permissionKnown else { return .waiting }
        if blocked { return .blocked }
        guard allowed else { return .permissionNeeded }
        if scheduling { return .scheduling }
        return scheduled ? .scheduled : .failed
    }
}

@MainActor
final class NativeDevice: ObservableObject {
    static let shared = NativeDevice()
    @Published var steps: Int?
    @Published var stepsMessage: String?
    @Published private(set) var stepsSampledAt: Date?
    @Published private(set) var stepsLoading = false
    @Published private(set) var stepsWidgetMessage: String?
    @Published var reminderMessage: String?
    @Published private(set) var reminderAuthorization: UNAuthorizationStatus?
    @Published private(set) var reminderScheduling = false
    @Published private(set) var reminderScheduled = false
    @Published var reminderEnabled = false
    @Published var reminderHour = 18
    @Published var reminderMinute = 0
    private let pedometer = CMPedometer()
    private let defaults: UserDefaults
    private let removeNotifications: () -> Void
    private var revision = UUID()
    private var stepRevision = UUID()
    private var stepsOwner: String?
    private var foregroundObserver: AnyCancellable?
    private var scheduleTask: Task<Void, Never>?
    private var reminderIDs: [String] { (0...6).map { "f1t.native.training.\($0)" } + (0...6).map { "f1t.training.\($0)" } }
    init(defaults: UserDefaults = .standard, removeNotifications: (() -> Void)? = nil) {
        self.defaults = defaults
        self.removeNotifications = removeNotifications ?? { Self.removeReminderNotifications() }
        reminderEnabled = defaults.bool(forKey: "native.reminders.enabled")
        reminderHour = defaults.object(forKey: "native.reminders.hour") as? Int ?? 18
        reminderMinute = defaults.integer(forKey: "native.reminders.minute")
        foregroundObserver = NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in
                Task { @MainActor in self?.readSteps(requestPermission: false) }
            }
    }
    func handleAccount(_ event: NativeAccountEvent) {
        let savedOwner = defaults.string(forKey: "native.reminders.owner")
        if event.incomingOwner == nil ||
            (event.previousOwner != nil && event.previousOwner != event.incomingOwner) ||
            (savedOwner != nil && savedOwner != event.incomingOwner) {
            clear()
        }
        let savedStepsOwner = defaults.string(forKey: "native.steps.owner")
        if stepsOwner != event.incomingOwner || savedStepsOwner != event.incomingOwner {
            resetSteps()
        }
        stepsOwner = event.incomingOwner
        defaults.set(event.incomingOwner, forKey: "native.steps.owner")
    }
    /// Only the explicit Consultar action may trigger the Motion prompt.
    func readSteps(requestPermission: Bool = true) {
        guard let owner = stepsOwner else { steps = nil; stepsSampledAt = nil; return }
        if let date = stepsSampledAt, F1tStepsPayload.dateKey(date) != F1tStepsPayload.dateKey(Date()) {
            steps = nil; stepsSampledAt = nil
        }
        let ticket = UUID(); stepRevision = ticket
        stepsLoading = false
        guard CMPedometer.isStepCountingAvailable() else {
            receiveSteps(status: .unsupported); return
        }
        switch CMPedometer.authorizationStatus() {
        case .denied: receiveSteps(status: .denied); return
        case .restricted: receiveSteps(status: .restricted); return
        case .notDetermined where !requestPermission: receiveSteps(status: .notDetermined); return
        default: break
        }
        stepsLoading = true
        let now = Date(), calendar = NativeDate.calendar
        pedometer.queryPedometerData(from: calendar.startOfDay(for: now), to: now) { [weak self] data, error in
            Task { @MainActor in
                guard let self, self.stepRevision == ticket, self.stepsOwner == owner else { return }
                guard calendar.timeZone == NativeDate.calendar.timeZone,
                      F1tStepsPayload.dateKey(now, calendar: calendar) == F1tStepsPayload.dateKey(Date()) else {
                    self.refreshStepsForNewDay(); return
                }
                if error == nil, let data, data.numberOfSteps.intValue >= 0,
                   CMPedometer.authorizationStatus() == .authorized {
                    self.receiveSteps(status: .available, count: data.numberOfSteps.intValue, sampledAt: now)
                } else {
                    let status: F1tStepsPayload.Status
                    switch CMPedometer.authorizationStatus() {
                    case .denied: status = .denied
                    case .restricted: status = .restricted
                    case .notDetermined: status = .notDetermined
                    default: status = .unavailable
                    }
                    self.receiveSteps(status: status)
                }
            }
        }
    }
    private func receiveSteps(status: F1tStepsPayload.Status, count: Int? = nil, sampledAt: Date = Date()) {
        stepsLoading = false
        // A failed/revoked read must not leave yesterday's or an old number visible.
        steps = status == .available ? count : nil
        stepsSampledAt = status == .available ? sampledAt : nil
        stepsMessage = status == .available || status == .notDetermined ? nil : status.message
        guard let owner = stepsOwner else { return }
        do {
            try F1tStepsStorage.write(F1tStepsPayload(ownerID: owner, status: status, steps: steps, sampledAt: sampledAt))
            stepsWidgetMessage = nil
            WidgetCenter.shared.reloadTimelines(ofKind: F1tStepsStorage.widgetKind)
        } catch { stepsWidgetMessage = "No se pudo actualizar el widget de pasos. \(error.localizedDescription)" }
    }
    private func resetSteps() {
        stepRevision = UUID(); steps = nil; stepsSampledAt = nil; stepsMessage = nil; stepsLoading = false
        do { try F1tStepsStorage.clear(); stepsWidgetMessage = nil }
        catch { stepsWidgetMessage = "No se pudo borrar el widget de pasos. \(error.localizedDescription)" }
        WidgetCenter.shared.reloadTimelines(ofKind: F1tStepsStorage.widgetKind)
    }
    func refreshStepsForNewDay() {
        resetSteps()
        readSteps(requestPermission: false)
    }
    func clear() {
        resetSteps(); stepsOwner = nil; defaults.removeObject(forKey: "native.steps.owner")
        revision = UUID(); scheduleTask?.cancel(); scheduleTask = nil
        steps = nil; stepsMessage = nil; reminderEnabled = false
        reminderHour = 18; reminderMinute = 0; reminderMessage = nil
        reminderAuthorization = nil; reminderScheduling = false; reminderScheduled = false
        removeNotifications()
        for key in ["native.reminders.owner", "native.reminders.enabled", "native.reminders.hour", "native.reminders.minute"] {
            defaults.removeObject(forKey: key)
        }
    }
    private static func removeReminderNotifications() {
        let ids = (0...6).map { "f1t.native.training.\($0)" } + (0...6).map { "f1t.training.\($0)" }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
        center.getPendingNotificationRequests { requests in
            let legacy = requests.map(\.identifier).filter { $0.hasPrefix("f1t.reminder.") }
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: legacy)
        }
        center.getDeliveredNotifications { notifications in
            let legacy = notifications.map { $0.request.identifier }.filter { $0.hasPrefix("f1t.reminder.") }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: legacy)
        }
    }
    func enable(store: NativeStore) async {
        let identity = store.auth.generation
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            guard store.auth.generation == identity, store.auth.session != nil else { return }
            guard allowed else {
                await refreshReminderPermission()
                guard store.auth.generation == identity, store.auth.session != nil else { return }
                reminderMessage = "Permiso denegado. Podés habilitar notificaciones en Ajustes."
                return
            }
            reminderEnabled = true; reminderMessage = nil
            defaults.set(store.auth.session?.user.id, forKey: "native.reminders.owner")
            defaults.set(true, forKey: "native.reminders.enabled")
            sync(store: store)
        } catch {
            guard store.auth.generation == identity, store.auth.session != nil else { return }
            reminderMessage = "No se pudieron habilitar los recordatorios."
        }
    }
    func refreshReminderPermission() async {
        let ticket = revision, owner = stepsOwner
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard ticket == revision, owner == stepsOwner else { return }
        reminderAuthorization = settings.authorizationStatus
        if settings.authorizationStatus == .denied { reminderScheduled = false }
        if reminderEnabled, settings.authorizationStatus == .denied {
            reminderMessage = "Los avisos están bloqueados. Habilitá Notificaciones para FIT en Ajustes."
        }
    }
    func reminderState(loaded: Bool, hasDays: Bool) -> NativeReminderState {
        NativeReminderState.resolve(enabled: reminderEnabled, loaded: loaded, hasDays: hasDays,
            permissionKnown: reminderAuthorization != nil,
            allowed: reminderAuthorization == .authorized || reminderAuthorization == .provisional || reminderAuthorization == .ephemeral,
            blocked: reminderAuthorization == .denied, scheduling: reminderScheduling, scheduled: reminderScheduled)
    }
    func disable() {
        reminderEnabled = false; defaults.set(false, forKey: "native.reminders.enabled")
        reminderScheduled = false; reminderScheduling = false; reminderMessage = nil
        revision = UUID(); scheduleTask?.cancel()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: reminderIDs)
    }
    func sync(store: NativeStore) {
        guard let owner = store.auth.session?.user.id else { clear(); return }
        // Activity is device-local and works without a loaded remote routine.
        if stepsOwner == owner, !stepsLoading,
           stepsSampledAt.map({ Date().timeIntervalSince($0) >= 60 }) ?? true {
            readSteps(requestPermission: false)
        }
        if let saved = defaults.string(forKey: "native.reminders.owner"), saved != owner { clear(); return }
        guard store.loaded else { return }
        guard reminderEnabled else { return }
        defaults.set(reminderHour, forKey: "native.reminders.hour"); defaults.set(reminderMinute, forKey: "native.reminders.minute")
        let weekdays = Array(Set(store.days.filter { $0.user_id == owner && $0.routine_id == store.active?.id }.map(\.weekday))).filter { (0...6).contains($0) }
        scheduleTask?.cancel(); let ticket = UUID(); revision = ticket
        reminderScheduled = false; reminderScheduling = true; reminderMessage = nil
        scheduleTask = Task {
            defer { if revision == ticket { reminderScheduling = false } }
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            guard revision == ticket, !Task.isCancelled else { return }
            reminderAuthorization = settings.authorizationStatus
            center.removePendingNotificationRequests(withIdentifiers: reminderIDs)
            guard !weekdays.isEmpty else {
                reminderMessage = "Elegí días en una rutina activa para programar avisos."
                return
            }
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral else {
                reminderMessage = "Recordatorio configurado, pero sin permiso para mostrar avisos. Revisá Notificaciones en Ajustes."
                return
            }
            var succeeded = true
            for day in weekdays {
                guard revision == ticket, !Task.isCancelled else { return }
                let content = UNMutableNotificationContent(); content.title = "Hoy toca entrenar"; content.body = "Tu rutina está lista en FIT. Abrila para empezar o retomar el entrenamiento."
                content.sound = settings.soundSetting == .enabled ? .default : nil
                let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: reminderHour, minute: reminderMinute, weekday: day + 1), repeats: true)
                let id = "f1t.native.training.\(day)"
                do { try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) }
                catch {
                    succeeded = false
                    if revision == ticket { reminderMessage = "No se pudieron programar todos los recordatorios. Reintentá." }
                }
                if revision != ticket || Task.isCancelled { center.removePendingNotificationRequests(withIdentifiers: [id]); return }
            }
            if revision == ticket, succeeded {
                reminderScheduled = true
                reminderMessage = settings.soundSetting == .enabled ? nil : "Avisos sin sonido. Revisá Notificaciones en Ajustes."
            }
        }
    }
}
/// Embed beside the existing alarm settings or the guided rest controls.
/// Permission is requested only when the person taps the explicit action.
struct NativeRestNotificationSettingsView: View {
    @EnvironmentObject var store: NativeStore
    @ObservedObject private var live = NativeLiveActivity.shared
    @ObservedObject private var notices = NativeRestNotifications.shared
    @State private var requesting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Aviso de fin de descanso").font(.fit(.base, .semibold))
            Toggle("Avisar al terminar el descanso", isOn: Binding(
                get: { notices.enabled },
                set: { live.setRestNotificationsEnabled($0, store: store) }
            ))
            .font(.fit(.sm))
            Text(live.restPermissionMessage ?? "El aviso se programa en el iPhone. No hace falta mantener FIT abierta.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            Button(requesting ? "Solicitando permiso…" : "Habilitar avisos de descanso") {
                requesting = true
                Task {
                    live.setRestNotificationsEnabled(true, store: store)
                    await live.requestRestNotifications(store: store)
                    requesting = false
                }
            }
            .buttonStyle(FitButtonStyle(variant: .primary, size: .sm))
            .disabled(requesting)
            Text("Silencio y Concentración pueden limitar el aviso. Para alarmas prominentes, usá la opción de alarmas si está disponible.")
                .font(.fit(.xs)).foregroundStyle(FitColor.muted)
        }
        .padding(20).fitCard(padding: 0)
        .task { await notices.refreshPermission() }
    }
}

struct NativeStepsView: View {
    @ObservedObject private var device = NativeDevice.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("Pasos de hoy").font(.fit(.base, .semibold))
                Spacer()
                // Motion permission is asked only by the explicit Consultar action.
                if device.steps == nil {
                    Button(device.stepsLoading ? "Leyendo…" : "Consultar") { device.readSteps() }
                        .buttonStyle(FitButtonStyle(size: .sm)).frame(minHeight: 44).disabled(device.stepsLoading)
                }
            }
            if let n = device.steps { Text(FitFormat.number(Double(n))).font(.fit(.xl2, .semibold)).monospacedDigit() }
            if let message = device.stepsMessage { Text(message).font(.fit(.sm)).foregroundStyle(FitColor.muted) }
            else if device.steps == nil {
                Text(device.stepsLoading ? "Consultando disponibilidad…" : "Tocá Consultar para leer tus pasos de Movimiento y condición física.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            }
            if let date = device.stepsSampledAt {
                (Text("Lectura de las ") + Text(date, style: .time)).font(.fit(.xs)).foregroundStyle(FitColor.muted)
            }
            DisclosureGroup("Opciones de pasos") {
                if device.steps != nil {
                    Button(device.stepsLoading ? "Leyendo…" : "Actualizar lectura") { device.readSteps(requestPermission: false) }
                        .fitLink().disabled(device.stepsLoading)
                }
                Text("Agregar widget de pasos").font(.fit(.sm, .semibold)).padding(.top, 8)
                Text("Mantené presionada la pantalla de inicio, tocá Editar y agregá FIT → Pasos de hoy. También podés agregarlo a la pantalla bloqueada.")
                    .padding(.top, 8)
                Text("Muestra la última lectura de hoy. Abrí FIT para actualizar; iOS decide cuándo refrescar el widget.")
                    .padding(.top, 4)
            }
            .font(.fit(.sm)).frame(minHeight: 44).padding(.top, 8)
            if let message = device.stepsWidgetMessage { Text(message).font(.fit(.xs)).foregroundStyle(FitColor.muted) }
        }
        .padding(20)
        .fitCard(padding: 0)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Pasos de hoy")
        .onAppear { device.readSteps(requestPermission: false) }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            if UIApplication.shared.applicationState == .active { device.readSteps(requestPermission: false) }
        }
    }
}
struct NativeReminderSettingsView: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.fitSelectTab) private var selectTab
    @ObservedObject private var device = NativeDevice.shared
    @State private var time = Date()
    @State private var requesting = false
    var body: some View {
        let owner = store.auth.session?.user.id
        let weekdays = FitLabels.weekOrder.filter { weekday in
            store.days.contains { $0.user_id == owner && $0.routine_id == store.active?.id && $0.weekday == weekday }
        }
        let state = device.reminderState(loaded: store.loaded, hasDays: !weekdays.isEmpty)
        VStack(alignment: .leading, spacing: 0) {
            Text("Recordatorio de entrenamiento").font(.fit(.base, .semibold))
            Text("Avisos en los días de tu rutina activa, aunque FIT esté cerrada.").font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 4)
            if !weekdays.isEmpty {
                Text(weekdays.map { NativeDate.weekdays[$0] }.joined(separator: " · "))
                    .font(.fit(.sm, .medium)).padding(.top, 12)
                Text("Hora local").font(.fit(.sm, .medium)).padding(.top, 16)
                FitDateField(date: $time, range: Date.distantPast...Date.distantFuture, fill: FitColor.surface2, label: "Hora local", components: .hourAndMinute)
                    .frame(maxWidth: 160).padding(.top, 4)
            }
            Text(statusText(state)).font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 12)
            HStack(spacing: 8) {
                if state == .noDays {
                    Button("Elegir rutina y días") { selectTab(.routines) }.fitLink()
                } else if device.reminderAuthorization == .denied, state != .waiting {
                    Button("Abrir Ajustes de notificaciones") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                    }.fitLink()
                } else if state == .disabled || state == .permissionNeeded {
                    Button(requesting ? "Activando…" : "Activar recordatorio") {
                        requesting = true
                        Task { await device.enable(store: store); requesting = false }
                    }
                    .buttonStyle(FitButtonStyle(variant: .primary, size: .sm))
                    .disabled(requesting || !store.loaded)
                } else if state == .failed {
                    Button("Reintentar programación") { device.sync(store: store) }.fitLink()
                }
                if device.reminderEnabled {
                    Button("Desactivar") { device.disable() }.buttonStyle(FitButtonStyle(size: .sm))
                }
            }.padding(.top, 16)
            if let message = device.reminderMessage, state != .blocked, state != .noDays {
                Text(message).font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.top, 12)
            }
            Text("Permiso opcional; se solicita solo al activar los avisos.").font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 8)
        }
        .padding(20).fitCard(padding: 0)
        .onAppear { time = NativeDate.calendar.date(bySettingHour: device.reminderHour, minute: device.reminderMinute, second: 0, of: Date()) ?? Date() }
        .task { await device.refreshReminderPermission() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { await device.refreshReminderPermission(); device.sync(store: store) }
        }
        .onChange(of: time) { _, value in
            device.reminderHour = NativeDate.calendar.component(.hour, from: value)
            device.reminderMinute = NativeDate.calendar.component(.minute, from: value)
            device.sync(store: store)
        }
    }
    private func statusText(_ state: NativeReminderState) -> String {
        switch state {
        case .disabled: "Desactivado"
        case .waiting: "Consultando disponibilidad…"
        case .noDays: "Sin días de entrenamiento: no hay avisos programados."
        case .permissionNeeded: "Falta habilitar el permiso para programar avisos."
        case .blocked: "Avisos bloqueados por iOS. Habilitá Notificaciones para FIT en Ajustes."
        case .scheduling: "Programando avisos…"
        case .scheduled: "Programado a las \(String(format: "%02d:%02d", device.reminderHour, device.reminderMinute))."
        case .failed: "No se confirmó la programación de los avisos."
        }
    }
}
