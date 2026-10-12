#if canImport(AlarmKit)
import ActivityKit
import AlarmKit
import AppIntents
import SwiftUI
import WidgetKit

// Include this file in BOTH app and widget targets: AlarmKit matches the
// exact metadata type between the app's scheduled alarm and this configuration.
// No private workout/account data is sent in the alarm's metadata.
@available(iOS 26.0, *)
struct F1tRestAlarmMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
struct F1tCancelRestAlarmIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Terminar alarma de descanso"
    static var isDiscoverable = false
    @Parameter(title: "Alarma") var alarmID: String
    init() {}
    init(id: UUID) { alarmID = id.uuidString }
    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: alarmID) else { throw CocoaError(.validationMissingMandatoryProperty) }
        // Only cancels the system alarm; it never records a set or changes a workout.
        if try AlarmManager.shared.alarms.contains(where: { $0.id == id }) {
            try AlarmManager.shared.cancel(id: id)
        }
        return .result()
    }
}

@available(iOS 26.0, *)
struct F1tRestAlarmLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<F1tRestAlarmMetadata>.self) { context in
            HStack(spacing: 16) {
                Image(systemName: "timer").font(.title2).foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Descanso · FIT").font(.headline)
                    time(context).font(.title2.bold()).monospacedDigit()
                }
                .foregroundStyle(.white)
                Spacer(minLength: 0)
                dismissButton(context)
            }
            .padding(16)
            .activityBackgroundTint(.black)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: "f1t://workout"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Descanso", systemImage: "timer").foregroundStyle(.orange)
                }
                DynamicIslandExpandedRegion(.trailing) { time(context).monospacedDigit().foregroundStyle(.white) }
                DynamicIslandExpandedRegion(.bottom) { dismissButton(context) }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(.orange)
            } compactTrailing: {
                time(context).monospacedDigit().foregroundStyle(.white).frame(maxWidth: 56)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(.orange)
            }
            .widgetURL(URL(string: "f1t://workout"))
            .keylineTint(.orange)
        }
    }

    @ViewBuilder private func time(_ context: ActivityViewContext<AlarmAttributes<F1tRestAlarmMetadata>>) -> some View {
        switch context.state.mode {
        case .countdown(let value):
            Text(timerInterval: value.startDate...max(value.startDate, value.fireDate), countsDown: true)
                .accessibilityLabel("Tiempo de descanso restante")
        case .paused(let value):
            let remaining = max(0, Int(value.totalCountdownDuration - value.previouslyElapsedDuration))
            Text("Pausado: \(remaining / 60):\(String(format: "%02d", remaining % 60))")
        case .alert: Text("Descanso terminado")
        @unknown default: Text("Descanso")
        }
    }

    private func dismissButton(_ context: ActivityViewContext<AlarmAttributes<F1tRestAlarmMetadata>>) -> some View {
        Button(intent: F1tCancelRestAlarmIntent(id: context.state.alarmID)) {
            Label("Cerrar alarma", systemImage: "xmark.circle.fill")
        }
        .buttonStyle(.bordered)
        .tint(.orange)
    }
}
#endif
