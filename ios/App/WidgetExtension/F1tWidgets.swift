import SwiftUI
import WidgetKit

private struct F1tEntry: TimelineEntry {
    let date: Date
    let snapshot: F1tWidgetSnapshot?
    var live: F1tLiveWorkoutStorage.Snapshot? = nil
}

private struct F1tProvider: TimelineProvider {
    func placeholder(in context: Context) -> F1tEntry {
        F1tEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (F1tEntry) -> Void) {
        completion(F1tEntry(date: Date(), snapshot: F1tWidgetStorage.read(), live: F1tLiveWorkoutStorage.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<F1tEntry>) -> Void) {
        let now = Date()
        let snapshot = F1tWidgetStorage.read()
        let live = F1tLiveWorkoutStorage.read(now: now)
        let midnight = Calendar.current.startOfDay(for: now)
        // Preload daily entries so WidgetKit can switch the recurring routine
        // offline at local midnight without waiting for a reload opportunity.
        // Host writes/sign-out still request an immediate timeline reload.
        let future = (1...28).compactMap { offset in
            Calendar.current.date(byAdding: .day, value: offset, to: midnight)
                .map { date in F1tEntry(date: date, snapshot: snapshot, live: live.flatMap { $0.isCurrent(at: date) ? $0 : nil }) }
        }
        // The app reloads on every set; these entries only end the rest
        // countdown and drop a workout the app never closed.
        let liveChanges = [live?.state.restEndsAt, live?.expiresAt].compactMap { $0 }.filter { $0 > now }.map { date in
            F1tEntry(date: date, snapshot: snapshot, live: live.flatMap { $0.isCurrent(at: date) ? $0 : nil })
        }
        let entries = ([F1tEntry(date: now, snapshot: snapshot, live: live)] + liveChanges + future).sorted { $0.date < $1.date }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

private struct F1tWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: F1tEntry

    private var live: F1tLiveWorkoutStorage.Snapshot? {
        entry.live.flatMap { $0.isCurrent(at: entry.date) ? $0 : nil }
    }

    var body: some View {
        Group {
            switch family {
            case .systemMedium:
                if let live {
                    F1tMediumWorkoutView(live: live, date: entry.date)
                } else {
                    F1tHeatmapView(snapshot: entry.snapshot)
                }
            case .systemSmall:
                F1tSmallView(snapshot: entry.snapshot, live: live, date: entry.date)
            case .accessoryCircular:
                F1tCircularView(snapshot: entry.snapshot, live: live, date: entry.date)
            case .accessoryRectangular:
                F1tRectangularView(snapshot: entry.snapshot, live: live, date: entry.date)
            case .accessoryInline:
                F1tInlineView(snapshot: entry.snapshot, live: live, date: entry.date)
            default:
                F1tRoutineView(snapshot: entry.snapshot, live: live, date: entry.date)
            }
        }
        .widgetURL(F1tWorkoutLink.url(date: live?.sessionDate ?? F1tWorkoutDate.key(entry.date), dayID: live?.dayID))
        .privacySensitive()
        .containerBackground(for: .widget) {
            // Lock Screen accessories draw on the wallpaper; the system tints them.
            if [.accessoryCircular, .accessoryRectangular, .accessoryInline].contains(family) {
                Color.clear
            } else {
                Rectangle().fill(.background)
            }
        }
    }
}

private struct F1tMediumWorkoutView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let live: F1tLiveWorkoutStorage.Snapshot
    let date: Date

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(F1tWorkoutPresentation.status(live.state, at: date))
                    .font(.caption.weight(.semibold)).lineLimit(1)
                Text(live.state.phase == .finished ? live.dayLabel : live.state.exerciseName)
                    .font(.headline).lineLimit(typeSize.isAccessibilitySize ? 1 : 2)
                if live.state.phase == .working {
                    Text(live.state.shortSetLine).font(.subheadline.weight(.semibold)).monospacedDigit()
                    Text(F1tWorkoutPresentation.suggestedValues(live.state)).font(.subheadline).monospacedDigit().lineLimit(1)
                }
                if let notice = live.state.notice, !notice.isEmpty {
                    Label(notice, systemImage: "exclamationmark.circle").font(.caption).lineLimit(2)
                } else if let syncStatus = live.state.syncStatus, !syncStatus.isEmpty {
                    Text(syncStatus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                if !typeSize.isAccessibilitySize {
                    Text("\(live.state.completedSets) de \(live.state.plannedSets) series")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let end = live.state.restEndsAt, end > date, live.state.phase == .working {
                VStack(alignment: .trailing, spacing: 4) {
                    Label("Descanso", systemImage: "timer").font(.caption)
                    Text(timerInterval: date...end, countsDown: true, showsHours: false)
                        .font(.title.weight(.bold)).monospacedDigit()
                        .accessibilityLabel("Tiempo restante de descanso")
                }
            } else if !typeSize.isAccessibilitySize {
                Image(systemName: live.state.phase == .finished ? "checkmark.circle.fill" : "dumbbell.fill")
                    .font(.title).foregroundStyle(.secondary).accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct F1tHeatmapView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let snapshot: F1tWidgetSnapshot?

    private func opacity(for level: Int) -> Double {
        // Alpha, not hue, carries intensity after Clear/Tint recoloring.
        [0.12, 0.30, 0.52, 0.75, 1.0][level]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Actividad")
                    .font(.headline)
                Spacer(minLength: 4)
                if let streak = snapshot?.payload.streak, streak > 0 {
                    Text("\(streak) días seguidos")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if let levels = snapshot?.payload.levels {
                GeometryReader { geometry in
                    let gap: CGFloat = 2
                    let cell = min((geometry.size.width - 25 * gap) / 26,
                                   (geometry.size.height - 6 * gap) / 7)
                    HStack(alignment: .top, spacing: gap) {
                        ForEach(0..<26, id: \.self) { week in
                            VStack(spacing: gap) {
                                ForEach(0..<7, id: \.self) { day in
                                    let level = levels[week * 7 + day]
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(renderingMode == .fullColor ? Color.green : Color.primary)
                                        .widgetAccentable()
                                        .opacity(opacity(for: level))
                                        .frame(width: max(cell, 1), height: max(cell, 1))
                                }
                            }
                        }
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Actividad de las últimas 26 semanas")
                .accessibilityValue("\(levels.filter { $0 > 0 }.count) días con actividad")
            } else {
                Spacer()
                Text("Abrí FIT para ver tu actividad")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
    }
}

private struct F1tRoutineView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let snapshot: F1tWidgetSnapshot?
    let live: F1tLiveWorkoutStorage.Snapshot?
    let date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let live {
                F1tLiveHeader(live: live, date: date)
            }
            Text("Rutina de hoy")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let routine = snapshot?.routine(at: date) {
                Text(routine.title)
                    .font(.title3.weight(.semibold))
                    .lineLimit(2)

                if routine.exercises.isEmpty {
                    Text("No hay ejercicios programados para hoy")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    // The live banner takes the space of two rows.
                    ForEach(routine.exercises.prefix(typeSize.isAccessibilitySize ? 2 : live != nil ? 4 : 6).indices, id: \.self) { index in
                        let exercise = routine.exercises[index]
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(index + 1).")
                                .foregroundStyle(.secondary)
                                .frame(width: 18, alignment: .trailing)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(exercise.name)
                                    .font(.subheadline.weight(.medium))
                                    .lineLimit(1)
                                if !exercise.detail.isEmpty {
                                    Text(exercise.detail)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
            } else {
                Text("Abrí FIT para ver la rutina de hoy")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct F1tWidget: Widget {
    let kind = "F1tWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: F1tProvider()) { entry in
            F1tWidgetView(entry: entry)
        }
        .configurationDisplayName("FIT")
        .description("Actividad, rutina de hoy y entrenamiento en curso")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge,
                            .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

private struct F1tStepsEntry: TimelineEntry {
    let date: Date
    let payload: F1tStepsPayload?
}

private struct F1tStepsProvider: TimelineProvider {
    func placeholder(in context: Context) -> F1tStepsEntry {
        F1tStepsEntry(date: Date(), payload: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (F1tStepsEntry) -> Void) {
        let now = Date()
        let payload = context.isPreview
            ? F1tStepsPayload(ownerID: "preview", status: .available, steps: 4321, sampledAt: now)
            : F1tStepsStorage.read()
        completion(F1tStepsEntry(date: now, payload: payload))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<F1tStepsEntry>) -> Void) {
        let now = Date(), payload = F1tStepsStorage.read()
        let calendar = Calendar.current, midnight = calendar.startOfDay(for: now)
        var dates = [now]
        if let payload, payload.isToday(at: now), payload.status == .available {
            let staleAt = payload.sampledAt.addingTimeInterval(15 * 60)
            if staleAt > now { dates.append(staleAt) }
        }
        // Rollover entries work offline even if iOS postpones a timeline reload.
        // No sensor access or permission prompts run inside the extension.
        dates += (1...28).compactMap { calendar.date(byAdding: .day, value: $0, to: midnight) }
        let entries = dates.sorted().map { F1tStepsEntry(date: $0, payload: payload) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }
}

private struct F1tStepsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: F1tStepsEntry

    private var count: Int? { entry.payload?.count(at: entry.date) }
    private var number: String { count?.formatted(.number.locale(Locale(identifier: "es_AR"))) ?? "—" }
    private var stale: Bool { entry.payload?.needsRefresh(at: entry.date) ?? true }
    private var message: String {
        guard let payload = entry.payload else { return "Abrí FIT y tocá Consultar" }
        guard payload.isToday(at: entry.date) else { return "Sin lectura de hoy. Abrí FIT para actualizar" }
        return payload.status.message
    }
    private var isAccessory: Bool {
        [.accessoryCircular, .accessoryRectangular, .accessoryInline].contains(family)
    }

    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                Label(count == nil ? "Pasos · Abrí FIT" : stale ? "Pasos: \(number) · Actualizar" : "Pasos de hoy: \(number)", systemImage: "figure.walk")
                    .accessibilityLabel("Pasos de hoy")
                    .accessibilityValue(accessibleReading)
            case .accessoryCircular:
                VStack(spacing: 1) {
                    Image(systemName: "figure.walk").accessibilityHidden(true)
                    Text(number).font(.caption.weight(.bold)).monospacedDigit().minimumScaleFactor(0.5).lineLimit(1)
                    Text(count == nil ? "Abrí FIT" : stale ? "Actualizar" : "Hoy")
                        .font(.caption2).lineLimit(1).minimumScaleFactor(0.5)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Pasos de hoy")
                .accessibilityValue(accessibleReading)
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Label("Pasos de hoy", systemImage: "figure.walk").font(.caption)
                    Text(number).font(.title3.weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    if count != nil, let date = entry.payload?.sampledAt {
                        (Text(date, style: .time) + Text(stale ? " · Actualizar" : " · Lectura"))
                            .font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
                    } else {
                        Text(message).font(.caption2).lineLimit(2)
                    }
                }
            default:
                VStack(alignment: .leading, spacing: 6) {
                    Label("Pasos de hoy", systemImage: "figure.walk").font(.headline).lineLimit(1)
                    Text(number).font(.largeTitle.weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                    if count != nil, let payload = entry.payload {
                        (Text("Lectura: ") + Text(payload.sampledAt, style: .time))
                            .font(.caption).foregroundStyle(.secondary)
                        if payload.needsRefresh(at: entry.date) {
                            Text(message).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                    } else {
                        Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .widgetURL(URL(string: "f1t://today"))
        .privacySensitive()
        .containerBackground(for: .widget) {
            if isAccessory { Color.clear } else { Rectangle().fill(.background) }
        }
    }

    private var accessibleReading: String {
        guard count != nil, let date = entry.payload?.sampledAt else { return message }
        let time = date.formatted(date: .omitted, time: .shortened)
        return "\(number) pasos. Lectura de las \(time).\(stale ? " Lectura antigua; abrí FIT para actualizar." : "")"
    }
}

struct F1tStepsWidget: Widget {
    let kind = F1tStepsStorage.widgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: F1tStepsProvider()) { entry in
            F1tStepsWidgetView(entry: entry)
        }
        .configurationDisplayName("Pasos de hoy")
        .description("Última lectura de pasos del iPhone. Abrí FIT para actualizar.")
        .supportedFamilies([.systemSmall, .systemMedium,
                            .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct F1tWidgetBundle: WidgetBundle {
    var body: some Widget {
        F1tWidget()
        F1tStepsWidget()
        F1tWorkoutLiveActivity()
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            F1tRestAlarmLiveActivity()
        }
        #endif
    }
}
