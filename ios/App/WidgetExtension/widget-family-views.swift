import SwiftUI
import WidgetKit

// Keep these views presentation-only: the provider/storage enforce account and age policy.
extension F1tWidgetPayload.RoutineDay {
    var title: String { label.flatMap { $0.isEmpty ? nil : $0 } ?? "Descanso" }
}

private extension F1tLiveWorkoutStorage.Snapshot {
    func restEnd(after date: Date) -> Date? {
        state.phase == .working ? state.restEndsAt.flatMap { $0 > date ? $0 : nil } : nil
    }
}

/// Large-widget banner above today's list; metrics take precedence over imagery.
struct F1tLiveHeader: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    let live: F1tLiveWorkoutStorage.Snapshot
    let date: Date

    var body: some View {
        HStack(spacing: 8) {
            if !typeSize.isAccessibilitySize && !luminanceReduced && live.state.restEndsAt == nil {
                F1tThumbnail(name: live.state.thumbnail, width: 42)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(F1tWorkoutPresentation.status(live.state, at: date))
                    .font(.caption.weight(.semibold)).lineLimit(1)
                Text(live.state.phase == .finished ? live.dayLabel : live.state.exerciseName)
                    .font(.subheadline.weight(.semibold)).lineLimit(2)
                if live.state.phase == .working {
                    Text(live.state.detailLine).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                } else {
                    Text("\(live.state.completedSets) series completadas").font(.caption)
                }
                if let notice = live.state.notice, !notice.isEmpty {
                    Label(notice, systemImage: "exclamationmark.circle").font(.caption).lineLimit(1)
                } else if let syncStatus = live.state.syncStatus, !syncStatus.isEmpty {
                    Text(syncStatus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let end = live.restEnd(after: date) {
                Text(timerInterval: date...end, countsDown: true, showsHours: false)
                    .font(.title3.weight(.bold)).monospacedDigit()
                    .accessibilityLabel("Tiempo restante de descanso")
            }
        }
        .padding(8)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .privacySensitive()
    }
}

struct F1tSmallView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let snapshot: F1tWidgetSnapshot?
    let live: F1tLiveWorkoutStorage.Snapshot?
    let date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let live {
                Text(F1tWorkoutPresentation.status(live.state, at: date))
                    .font(.caption.weight(.semibold)).lineLimit(1)
                Text(live.state.phase == .finished ? live.dayLabel : live.state.exerciseName)
                    .font(.headline).lineLimit(typeSize.isAccessibilitySize ? 1 : 2)
                if live.state.phase == .working {
                    Text(live.state.shortSetLine).font(.subheadline.weight(.semibold)).monospacedDigit().lineLimit(1)
                    let values = F1tWorkoutPresentation.suggestedValues(live.state)
                    if !values.isEmpty {
                        Text(values).font(.subheadline).monospacedDigit().lineLimit(1)
                    }
                    if let end = live.restEnd(after: date) {
                        Text(timerInterval: date...end, countsDown: true, showsHours: false)
                            .font(.title.weight(.bold)).monospacedDigit()
                            .accessibilityLabel("Tiempo restante de descanso")
                    }
                    if let notice = live.state.notice, !notice.isEmpty {
                        Label(notice, systemImage: "exclamationmark.circle").font(.caption).lineLimit(2)
                    } else if let syncStatus = live.state.syncStatus, !syncStatus.isEmpty {
                        Text(syncStatus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if !typeSize.isAccessibilitySize {
                        ProgressView(value: live.state.progress)
                            .tint(.primary)
                            .accessibilityLabel("Progreso del entrenamiento")
                            .accessibilityValue("\(live.state.completedSets) de \(live.state.plannedSets) series")
                    }
                } else {
                    Label("\(live.state.completedSets) series", systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                    Spacer(minLength: 0)
                }
            } else {
                Text("Hoy").font(.caption).foregroundStyle(.secondary)
                if let routine = snapshot?.routine(at: date) {
                    Text(routine.title).font(.headline).lineLimit(2)
                    ForEach(routine.exercises.prefix(typeSize.isAccessibilitySize ? 1 : 2).indices, id: \.self) { index in
                        Text(routine.exercises[index].name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else {
                    Text("Abrí FIT para ver tu rutina").font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if let streak = snapshot?.payload.streak, streak > 0 {
                    Label("\(streak) \(streak == 1 ? "día" : "días")", systemImage: "flame.fill")
                        .font(.caption.weight(.semibold))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .privacySensitive()
    }
}

struct F1tCircularView: View {
    let snapshot: F1tWidgetSnapshot?
    let live: F1tLiveWorkoutStorage.Snapshot?
    var date: Date = Date()

    var body: some View {
        if let live {
            if let end = live.restEnd(after: date) {
                ZStack {
                    AccessoryWidgetBackground()
                    Text(timerInterval: date...end, countsDown: true, showsHours: false)
                        .font(.caption.weight(.bold)).monospacedDigit()
                        .accessibilityLabel("Tiempo restante de descanso")
                }
            } else if live.state.phase == .finished {
                Image(systemName: "checkmark.circle.fill")
                    .widgetAccentable()
                    .accessibilityLabel("Entrenamiento completo, \(live.state.completedSets) series")
            } else {
                Gauge(value: live.state.progress) {
                    Image(systemName: "dumbbell.fill")
                } currentValueLabel: {
                    Text("\(live.state.setNumber)/\(live.state.totalSets)").monospacedDigit()
                }
                .gaugeStyle(.accessoryCircular)
                .widgetAccentable()
                .accessibilityLabel("\(F1tWorkoutPresentation.status(live.state, at: date)), \(live.state.exerciseName), \(live.state.detailLine)")
            }
        } else {
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "flame.fill").font(.caption).widgetAccentable()
                    Text("\(snapshot?.payload.streak ?? 0)").font(.title3.weight(.semibold)).monospacedDigit()
                }
            }
            .accessibilityLabel("Racha de \(snapshot?.payload.streak ?? 0) días")
        }
    }
}

struct F1tRectangularView: View {
    let snapshot: F1tWidgetSnapshot?
    let live: F1tLiveWorkoutStorage.Snapshot?
    let date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let live {
                Text(live.state.phase == .finished ? "Entrenamiento completo" : live.state.exerciseName)
                    .font(.headline).lineLimit(1).widgetAccentable()
                if live.state.phase == .working {
                    Text(live.state.detailLine).font(.caption).lineLimit(1)
                    if let end = live.restEnd(after: date) {
                        HStack(spacing: 3) {
                            Image(systemName: "timer").accessibilityHidden(true)
                            Text(timerInterval: date...end, countsDown: true, showsHours: false)
                                .monospacedDigit().accessibilityLabel("Tiempo restante de descanso")
                        }
                        .font(.subheadline.weight(.semibold))
                    } else if let notice = live.state.notice, !notice.isEmpty {
                        Label(notice, systemImage: "exclamationmark.circle").font(.caption).lineLimit(1)
                    } else {
                        Text(live.state.restEndsAt == nil ? live.state.exerciseLine : "Descanso terminado")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Text("\(live.state.completedSets) series · \(live.dayLabel)").font(.caption).lineLimit(2)
                }
            } else if let routine = snapshot?.routine(at: date) {
                Text(routine.title).font(.headline).lineLimit(1).widgetAccentable()
                if routine.exercises.isEmpty {
                    Text("Sin ejercicios hoy").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(routine.exercises.prefix(2).indices, id: \.self) { index in
                        Text(routine.exercises[index].name).font(.caption).lineLimit(1)
                    }
                }
            } else {
                Text("FIT").font(.headline).widgetAccentable()
                Text("Abrí FIT para ver tu rutina").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .privacySensitive()
    }
}

struct F1tInlineView: View {
    let snapshot: F1tWidgetSnapshot?
    let live: F1tLiveWorkoutStorage.Snapshot?
    let date: Date

    var body: some View {
        if let live {
            if let end = live.restEnd(after: date) {
                Label {
                    Text("Descanso ") + Text(timerInterval: date...end, countsDown: true, showsHours: false)
                } icon: {
                    Image(systemName: "timer")
                }
            } else if live.state.phase == .finished {
                Label("Entrenamiento completo", systemImage: "checkmark.circle")
            } else {
                Label("\(live.state.restEndsAt == nil ? live.state.shortSetLine : "Descanso terminado") · \(live.state.exerciseName)",
                      systemImage: "dumbbell.fill")
            }
        } else if let routine = snapshot?.routine(at: date) {
            Label("Hoy: \(routine.exercises.isEmpty ? "descanso" : routine.title)", systemImage: "figure.strengthtraining.traditional")
        } else {
            Text("Abrí FIT")
        }
    }
}
