import ActivityKit
import AppIntents
import SwiftUI
import UIKit
import WidgetKit

/// Links contain session coordinates only, never credentials or an account identifier.
enum F1tWorkoutLink {
    static func url(date: String, dayID: String?) -> URL? {
        var components = URLComponents()
        components.scheme = "f1t"
        components.host = "workout"
        components.queryItems = [URLQueryItem(name: "date", value: date)]
        if let dayID, !dayID.isEmpty { components.queryItems?.append(URLQueryItem(name: "day", value: dayID)) }
        return components.url
    }
}

/// Catalog photo copied by the app into the App Group; decorative, never essential.
struct F1tThumbnail: View {
    let name: String?
    var width: CGFloat
    var radius: CGFloat = 8

    var body: some View {
        Group {
            if let name, let url = F1tThumbnailStorage.url(for: name), let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: width * 0.3))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.quaternary)
            }
        }
        .frame(width: width, height: (width * 2 / 3).rounded())
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .accessibilityHidden(true)
    }
}

/// The system renders this clock. No extension/app timer or background loop is needed.
/// A stale activity isn't proof a future rest has ended: the absolute end date wins.
struct F1tRestText: View {
    let end: Date?
    let isStale: Bool

    var body: some View {
        let now = Date()
        if let end, end > now {
            Text(timerInterval: now...end, countsDown: true, showsHours: false)
                .monospacedDigit()
                .accessibilityLabel("Tiempo restante de descanso")
        } else if end != nil {
            Text("Descanso terminado")
        }
    }
}

/// Shared presentation decisions for the live card and ordinary widget families.
enum F1tWorkoutPresentation {
    static func isResting(_ state: F1tWorkoutAttributes.ContentState, at now: Date = Date()) -> Bool {
        state.phase == .working && state.restEndsAt.map { $0 > now } == true
    }

    static func status(_ state: F1tWorkoutAttributes.ContentState, at now: Date = Date()) -> String {
        if state.phase == .finished { return "Entrenamiento completo" }
        if isResting(state, at: now) { return "Descansando · próxima serie" }
        return state.restEndsAt == nil ? "En curso" : "Descanso terminado"
    }

    static func suggestedValues(_ state: F1tWorkoutAttributes.ContentState) -> String {
        [state.repsLine, state.weightLine].compactMap { $0 }.joined(separator: " · ")
    }
}

private extension F1tLogSetIntent {
    init(_ attributes: F1tWorkoutAttributes, _ state: F1tWorkoutAttributes.ContentState) {
        self.init(F1tLogSetRequest(ownerID: attributes.ownerID, sessionDate: attributes.sessionDate, dayID: attributes.dayID,
                                   exerciseID: state.exerciseID, setIndex: state.setIndex, reps: state.reps, weightKg: state.weightKg,
                                   revision: state.workoutRevision))
    }
}

private struct F1tLogSetButton: View {
    let attributes: F1tWorkoutAttributes
    let state: F1tWorkoutAttributes.ContentState
    var compact = false
    var reduced = false

    var body: some View {
        Button(intent: F1tLogSetIntent(attributes, state)) {
            VStack(spacing: 1) {
                Label(reduced ? "Serie \(state.setNumber)/\(state.totalSets) · \(state.exerciseName)" : compact ? "Serie \(state.setNumber) hecha" : "Serie hecha", systemImage: "checkmark")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(reduced ? 1 : nil)
                let values = F1tWorkoutPresentation.suggestedValues(state)
                if !values.isEmpty {
                    Text(values).font(.caption).monospacedDigit().lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderedProminent)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .tint(Color(uiColor: .systemBlue))
        .accessibilityLabel("Registrar \(state.setLine.lowercased()) de \(state.exerciseName)")
        .accessibilityValue(F1tWorkoutPresentation.suggestedValues(state))
        .accessibilityHint(["Guarda los valores mostrados. Para cambiarlos, abrí el entrenamiento.", state.syncStatus]
            .compactMap { $0 }.joined(separator: " "))
    }
}

private struct F1tRestControls: View {
    let attributes: F1tWorkoutAttributes
    let revision: String?
    var compact = false
    var symbolsOnly = false

    var body: some View {
        HStack(spacing: 8) {
            Button(intent: F1tExtendRestIntent(ownerID: attributes.ownerID, sessionDate: attributes.sessionDate,
                                             dayID: attributes.dayID, seconds: 30, revision: revision)) {
                Group {
                    if symbolsOnly { Image(systemName: "goforward.30") }
                    else { Text("+30 s") }
                }
                .frame(maxWidth: symbolsOnly ? nil : .infinity)
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .accessibilityLabel("Agregar treinta segundos al descanso")
            Button(intent: F1tSkipRestIntent(ownerID: attributes.ownerID, sessionDate: attributes.sessionDate,
                                           dayID: attributes.dayID, revision: revision)) {
                Group {
                    if symbolsOnly { Image(systemName: "forward.end") }
                    else { Text(compact ? "Omitir" : "Omitir descanso") }
                }
                .frame(maxWidth: symbolsOnly ? nil : .infinity)
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .accessibilityLabel("Omitir el descanso y preparar la próxima serie")
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.bordered)
        .tint(.primary)
    }
}

/// Each metric remains separate so a long name can't displace reps or kilograms.
struct F1tSetMetrics: View {
    let state: F1tWorkoutAttributes.ContentState

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("Serie \(state.setNumber)/\(state.totalSets)")
            Spacer(minLength: 0)
            if let reps = state.repsLine { Text(reps) }
            if let weight = state.weightLine { Text(weight) }
        }
        .font(.subheadline.weight(.semibold))
        .monospacedDigit()
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.detailLine)
    }
}

private struct F1tWorkoutLockScreenView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    let context: ActivityViewContext<F1tWorkoutAttributes>

    var body: some View {
        // Never ask the system for a taller card. Remove secondary content instead.
        ViewThatFits(in: .vertical) {
            if !typeSize.isAccessibilitySize { content(compact: false) }
            content(compact: true)
            reducedContent
        }
        .padding(8)
        .privacySensitive()
    }

    /// A genuinely smaller last candidate: no header, duplicate metrics, or sync text.
    /// Rest actions use familiar symbols with full labels, rather than shrinking text.
    @ViewBuilder private var reducedContent: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 4) {
            if state.phase == .finished {
                Label("Completo", systemImage: "checkmark.circle.fill")
                    .font(.headline).lineLimit(1)
                    .accessibilityLabel("Entrenamiento completo")
                    .accessibilityValue("\(context.attributes.dayLabel), \(state.completedSets) series")
            } else {
                // A notice can describe an unconfirmed save. Never replace it with
                // success: retain a short visible warning and its full spoken text.
                if let notice = state.notice, !notice.isEmpty {
                    Label("Revisá el registro", systemImage: "exclamationmark.circle")
                        .font(.caption.weight(.semibold)).lineLimit(1)
                        .accessibilityLabel("Aviso del entrenamiento: \(notice)")
                }
                if F1tWorkoutPresentation.isResting(state) {
                    HStack(spacing: 8) {
                        F1tRestText(end: state.restEndsAt, isStale: context.isStale)
                            .font(.title3.weight(.bold))
                            .accessibilityHint("Descansando. Próxima serie: \(state.exerciseName), \(state.detailLine)")
                        Spacer(minLength: 0)
                        F1tRestControls(attributes: context.attributes, revision: state.workoutRevision,
                                        compact: true, symbolsOnly: true)
                    }
                } else if let notice = state.notice, !notice.isEmpty {
                    // The error fallback has only a warning and ONE action line.
                    // Do not stack the register button's suggested-values row here:
                    // at AX5 that would spend the entire card height before padding.
                    if let url = context.attributes.workoutURL {
                        Link(destination: url) {
                            Label("Revisar", systemImage: "arrow.up.forward.app")
                                .font(.subheadline.weight(.semibold)).lineLimit(1)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                        .tint(Color(uiColor: .systemBlue))
                        .accessibilityLabel("Revisar el registro de \(state.exerciseName), \(state.setLine.lowercased())")
                        .accessibilityValue(state.detailLine)
                        .accessibilityHint("Abre el entrenamiento para revisar el aviso. \(notice)")
                    } else {
                        Text("Abrí FIT para revisar").font(.subheadline).lineLimit(1)
                            .accessibilityValue(state.detailLine)
                    }
                } else {
                    F1tLogSetButton(attributes: context.attributes, state: state, compact: true, reduced: true)
                        .accessibilityHint([F1tWorkoutPresentation.status(state), state.notice, state.syncStatus]
                            .compactMap { $0 }.joined(separator: ". "))
                }
            }
        }
    }

    @ViewBuilder private func content(compact: Bool) -> some View {
        let state = context.state
        let resting = F1tWorkoutPresentation.isResting(state)
        VStack(alignment: .leading, spacing: compact ? 4 : 6) {
            if state.phase == .finished {
                Label("Entrenamiento completo", systemImage: "checkmark.circle.fill")
                    .font(.headline).lineLimit(2)
                Text("\(context.attributes.dayLabel) · \(state.completedSets) series")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            } else {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(resting ? "Próxima: \(state.exerciseName)" : state.exerciseName)
                            .font(.headline).lineLimit(compact || state.notice != nil || resting ? 1 : 2)
                            .accessibilityLabel(resting ? "Próximo ejercicio: \(state.exerciseName)" : state.exerciseName)
                        if !compact { F1tSetMetrics(state: state) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if !compact && !resting && state.notice == nil && !luminanceReduced {
                        F1tThumbnail(name: state.thumbnail, width: 42)
                    }
                }
                if let notice = state.notice, !notice.isEmpty {
                    Label(notice, systemImage: "exclamationmark.circle")
                        .font(.caption).foregroundStyle(.primary).lineLimit(compact ? 1 : 2)
                        .accessibilityLabel("Aviso: \(notice)")
                } else if let syncStatus = state.syncStatus, !syncStatus.isEmpty && !compact {
                    Text(syncStatus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                if resting {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if !compact {
                            VStack(alignment: .leading, spacing: 1) {
                                Label("Descanso", systemImage: "timer").font(.caption)
                                if let last = state.lastExerciseName, !last.isEmpty {
                                    Text("Tras \(last)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        } else {
                            Image(systemName: "timer").accessibilityHidden(true)
                        }
                        Spacer(minLength: 0)
                        F1tRestText(end: state.restEndsAt, isStale: context.isStale)
                            .font((compact ? Font.title3 : Font.title).weight(.bold))
                        if compact {
                            Text(state.detailLine).font(.caption).monospacedDigit().lineLimit(2)
                                .accessibilityLabel("Próxima serie: \(state.detailLine)")
                        }
                    }
                    F1tRestControls(attributes: context.attributes, revision: state.workoutRevision, compact: compact)
                } else {
                    if state.restEndsAt != nil && !compact {
                        Label("Descanso terminado", systemImage: "checkmark.circle")
                            .font(.caption.weight(.semibold))
                    }
                    F1tLogSetButton(attributes: context.attributes, state: state, compact: compact)
                    if !compact && state.notice == nil && state.syncStatus == nil && state.restEndsAt == nil && !luminanceReduced {
                        ProgressView(value: state.progress)
                            .tint(.primary)
                            .accessibilityLabel("Progreso del entrenamiento")
                            .accessibilityValue("\(state.completedSets) de \(state.plannedSets) series")
                    }
                }
            }
        }
    }
}

struct F1tWorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration { configuration }

    private var configuration: some WidgetConfiguration {
        ActivityConfiguration(for: F1tWorkoutAttributes.self) { context in
            F1tWorkoutLockScreenView(context: context)
            .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .activitySystemActionForegroundColor(.primary)
            .widgetURL(F1tWorkoutLink.url(date: context.attributes.sessionDate, dayID: context.attributes.dayID))
        } dynamicIsland: { context in
            let state = context.state
            let resting = F1tWorkoutPresentation.isResting(state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: state.phase == .finished ? "checkmark.circle.fill" : resting ? "timer" : "dumbbell.fill")
                        .foregroundStyle(.primary).accessibilityHidden(true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if state.phase == .working {
                        if resting {
                            F1tRestText(end: state.restEndsAt, isStale: context.isStale)
                                .font(.title3.weight(.bold))
                        } else {
                            Text("\(state.setNumber)/\(state.totalSets)").font(.headline).monospacedDigit()
                        }
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(state.phase == .finished ? "Entrenamiento completo" : state.exerciseName)
                        .font(.headline).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        if state.phase == .working {
                            F1tSetMetrics(state: state)
                            if let notice = state.notice, !notice.isEmpty {
                                Label(notice, systemImage: "exclamationmark.circle").font(.caption).lineLimit(1)
                            } else {
                                Text(state.syncStatus ?? F1tWorkoutPresentation.status(state))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            if resting {
                                F1tRestControls(attributes: context.attributes, revision: state.workoutRevision, compact: true)
                            } else {
                                F1tLogSetButton(attributes: context.attributes, state: state)
                            }
                        } else {
                            Text("\(context.attributes.dayLabel) · \(state.completedSets) series").font(.subheadline)
                        }
                    }
                }
            } compactLeading: {
                // These compact regions also mirror to the paired Watch Smart Stack on supported systems.
                Image(systemName: state.phase == .finished ? "checkmark.circle.fill" : state.notice != nil ? "exclamationmark.circle" : resting ? "timer" : "dumbbell.fill")
                    .accessibilityLabel(F1tWorkoutPresentation.status(state))
            } compactTrailing: {
                if resting {
                    F1tRestText(end: state.restEndsAt, isStale: context.isStale)
                        .font(.caption.weight(.semibold)).frame(width: 50)
                } else {
                    Text(state.phase == .working ? "\(state.setNumber)/\(state.totalSets)" : "Listo")
                        .monospacedDigit()
                        .accessibilityLabel(state.phase == .working ? state.detailLine : "Entrenamiento completo")
                }
            } minimal: {
                // A clock doesn't reliably fit the minimal island; phase is more useful than clipped digits.
                Image(systemName: state.phase == .finished ? "checkmark" : state.notice != nil ? "exclamationmark" : resting ? "timer" : "dumbbell.fill")
                    .accessibilityLabel(F1tWorkoutPresentation.status(state))
            }
            .widgetURL(F1tWorkoutLink.url(date: context.attributes.sessionDate, dayID: context.attributes.dayID))
            .keylineTint(.green)
        }
    }
}
