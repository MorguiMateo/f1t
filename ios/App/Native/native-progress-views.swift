import SwiftUI
import Charts

// MARK: - Progreso

/// Comparable metrics describe logged data, not strength predictions or calorie burn.
enum NativeWorkoutTrend {
    struct Sample: Identifiable {
        var id: String { session.id }
        let session: NativeWorkoutSession
        let setCount: Int
        let maxWeight: Double?
        let repetitions: Int?
        let volume: Double?
        let volumeSetCount: Int
        var hasCompleteVolume: Bool { volume != nil && volumeSetCount == setCount }
    }
    static func samples(exerciseID: String, sessions: [NativeWorkoutSession], sets: [NativeSet]) -> [Sample] {
        let grouped = Dictionary(grouping: sets.filter { $0.exercise_id == exerciseID }, by: \.session_id)
        return sessions.compactMap { session in
            guard let rows = grouped[session.id], !rows.isEmpty else { return nil }
            let weights = rows.compactMap(\.weight_kg).filter { $0.isFinite && $0 >= 0 }
            let reps = rows.compactMap(\.reps).filter { $0 >= 0 }
            let volumes = rows.compactMap { row -> Double? in
                guard let weight = row.weight_kg, weight.isFinite, weight >= 0,
                      let reps = row.reps, reps >= 0 else { return nil }
                return weight * Double(reps)
            }
            return Sample(session: session, setCount: rows.count, maxWeight: weights.max(),
                          repetitions: reps.isEmpty ? nil : reps.reduce(0, +),
                          volume: volumes.isEmpty ? nil : volumes.reduce(0, +), volumeSetCount: volumes.count)
        }.sorted {
            $0.session.performed_on == $1.session.performed_on ? $0.id < $1.id : $0.session.performed_on < $1.session.performed_on
        }
    }
    struct Week: Identifiable {
        var id: String { start }
        let start, end: String
        let trainingDays: Int
    }
    static func weeks(sessions: [NativeWorkoutSession], date: Date = Date()) -> [Week] {
        let monday = NativeDate.add(-((NativeDate.weekday(date) + 6) % 7), to: date)
        let trained = Set(sessions.filter { $0.set_count > 0 && $0.performed_on <= NativeDate.key(date) }.map(\.performed_on))
        return (0..<4).map { index in
            let start = NativeDate.key(NativeDate.add(-7 * (3 - index), to: monday))
            let end = min(NativeDate.key(NativeDate.add(-7 * (3 - index) + 6, to: monday)), NativeDate.key(date))
            return Week(start: start, end: end, trainingDays: trained.filter { $0 >= start && $0 <= end }.count)
        }
    }
    static func change(_ current: Double?, previous: Double?, unit: String) -> String {
        guard let current, let previous else { return "Sin comparación" }
        let difference = current - previous
        if abs(difference) < 0.005 { return "Sin cambio · sesión anterior" }
        return "\(difference > 0 ? "+" : "−")\(FitFormat.number(abs(difference), fraction: 2)) \(unit) · sesión anterior"
    }
}

/// Keep requests until a lazily mounted tab can consume them. No workout write occurs here.
@MainActor
enum NativeProgressRoute {
    static var requestsWeight = false
    static let changed = Notification.Name("nativeProgressRouteChanged")
    static func requestWeight() {
        requestsWeight = true
        NotificationCenter.default.post(name: changed, object: nil)
    }
}

struct NativeProgressView: View {
    @EnvironmentObject var store: NativeStore
    @State private var openDate: String?
    @State private var showAll = false
    @State private var selectedDate = Date()
    @State private var now = Date()
    @State private var section = Section.training
    @State private var weightFocusRequest = 0
    @State private var weightHasDraft = false
    @State private var requestedExercise = ""
    @State private var exerciseRequest = 0
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.fitSelectTab) private var selectTab
    private enum Section: String, CaseIterable { case training = "Entrenamiento", body = "Cuerpo" }
    private var trained: [NativeWorkoutSession] { store.sessions.filter { $0.set_count > 0 } }

    var body: some View {
        NavigationStack {
            FitPage {
                FitPageHeader(title: "Progreso")
                if section == .training { NativeDataStatus() }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { sectionPicker; weightButton }
                    VStack(alignment: .leading, spacing: 12) { sectionPicker; weightButton }
                }
                  VStack(alignment: .leading, spacing: 0) {
                    if !store.domainState(.training).loaded {
                        NativePendingContent(count: 3)
                    } else {
                    consistency.padding(.top, 16)
                    if trained.isEmpty {
                        FitEmptyState(title: "Sin entrenamientos", description: "Registrá el primero desde Hoy.").padding(.top, 16)
                    }
                    NativeExerciseProgressCard(requestedExercise: requestedExercise, requestID: exerciseRequest).padding(.top, 16)
                    if !trained.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Actividad · 26 semanas").font(.fit(.base, .semibold))
                            FitHeatmap(sessions: store.sessions) { openDate = $0 }
                        }.fitCard().padding(.top, 16)
                    }
                    calendarList.padding(.top, 16)
                    }
                  }
                  .frame(height: section == .training ? nil : 0, alignment: .top).clipped()
                  .opacity(section == .training ? 1 : 0).allowsHitTesting(section == .training).accessibilityHidden(section != .training)
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            Text("Evolución corporal").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
                            Spacer()
                            Button("Editar objetivo") { NativeProfileRoute.requestTarget(); selectTab(.profile) }.fitLink(.sm)
                        }
                        NativeWeightLogCard(focusRequest: weightFocusRequest, onPendingChanges: { weightHasDraft = $0 })
                        NativeWeightChartCard()
                    }.padding(.top, section == .body ? 16 : 0)
                    .frame(height: section == .body ? nil : 0, alignment: .top).clipped()
                    .opacity(section == .body ? 1 : 0).allowsHitTesting(section == .body).accessibilityHidden(section != .body)
            }
            .navigationDestination(item: $openDate) { key in NativeWorkoutView(date: NativeDate.parse(key) ?? Date()) }
        }
        .fitTabRoot(isDirty: weightHasDraft) { openDate = nil }
        .onChange(of: section) { _, value in
            if value == .training { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
        }
        .onAppear { consumeRoute(); consumeRoutineExercise() }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("nativeShowExerciseProgress"))) { _ in consumeRoutineExercise() }
        .onReceive(store.accountChanges) { _ in
            openDate = nil; requestedExercise = ""; exerciseRequest += 1; weightHasDraft = false; weightFocusRequest = 0
            NativeProgressRoute.requestsWeight = false
        }
        .onReceive(NotificationCenter.default.publisher(for: NativeProgressRoute.changed)) { _ in consumeRoute() }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("nativeDateRollover"))) { _ in now = Date() }
    }

    @ViewBuilder private var sectionPicker: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Section.allCases, id: \.self) { option in
                    Button(option.rawValue) { section = option }
                        .buttonStyle(FitButtonStyle(variant: section == option ? .primary : .quiet, fullWidth: true))
                        .accessibilityAddTraits(section == option ? .isSelected : [])
                }
            }
        } else {
            Picker("Tipo de progreso", selection: $section) {
                ForEach(Section.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }.pickerStyle(.segmented)
        }
    }
    private var weightButton: some View {
        Button("Anotar peso") { section = .body; weightFocusRequest += 1 }
            .buttonStyle(FitButtonStyle(variant: .primary, size: .sm))
    }
    private func consumeRoutineExercise() {
        guard let id = NativeExerciseProgressRequest.consume(auth: store.auth) else { return }
        requestedExercise = id; exerciseRequest += 1; section = .training
    }
    private func consumeRoute() {
        if NativeProgressRoute.requestsWeight {
            NativeProgressRoute.requestsWeight = false; section = .body; weightFocusRequest += 1
        }
    }

    private var consistency: some View {
        let weeks = NativeWorkoutTrend.weeks(sessions: store.sessions, date: now)
        let activeWeeks = weeks.filter { $0.trainingDays > 0 }.count
        return VStack(alignment: .leading, spacing: 12) {
            Text("Últimas 4 semanas").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(activeWeeks) / 4").font(.fit(.xl2, .bold)).monospacedDigit()
                    Text("semanas activas").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(weeks.reduce(0) { $0 + $1.trainingDays })").font(.fit(.xl2, .bold)).monospacedDigit()
                    Text("días entrenados").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
            }
            DisclosureGroup {
              ForEach(weeks) { week in
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Text("\(FitFormat.shortDay(week.start)) – \(FitFormat.shortDay(week.end))")
                        Spacer(minLength: 8)
                        Text("\(week.trainingDays) \(week.trainingDays == 1 ? "día" : "días")").fontWeight(.semibold)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(FitFormat.shortDay(week.start)) – \(FitFormat.shortDay(week.end))")
                        Text("\(week.trainingDays) \(week.trainingDays == 1 ? "día" : "días")").fontWeight(.semibold)
                    }
                }.font(.fit(.sm)).accessibilityElement(children: .combine)
              }
              Text("Semana actual en curso.")
                .font(.fit(.sm)).foregroundStyle(FitColor.muted)
            } label: {
                Text("Por semana").font(.fit(.sm)).fitMinimumHitArea()
            }
        }.fitCard()
    }

    private var calendarList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Entrenamientos").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            DisclosureGroup {
                FitDateField(date: $selectedDate, range: Date.distantPast...now, label: "Fecha del entrenamiento")
                Button("Abrir entrenamiento") { openDate = NativeDate.key(selectedDate) }
                    .buttonStyle(FitButtonStyle(fullWidth: true))
                    .accessibilityHint("Abre la fecha elegida para registrar o corregir series, incluso sin actividad previa.")
            } label: {
                Text("Buscar una fecha").font(.fit(.sm)).fitMinimumHitArea()
            }
            if !store.sessions.isEmpty {
                DisclosureGroup {
                    history
                } label: {
                    Text("Historial · \(store.sessions.count)").font(.fit(.sm)).fitMinimumHitArea()
                }
            }
        }.fitCard()
    }

    /// Accessible chronological alternative to the decorative heatmap. The date
    /// picker above also opens untrained dates; every row announces its actual date.
    private var history: some View {
        let rows = store.sessions.sorted {
            $0.performed_on == $1.performed_on ? $0.id > $1.id : $0.performed_on > $1.performed_on
        }
        let visible = showAll ? rows : Array(rows.prefix(8))
        return LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(visible) { row in
                Button { openDate = row.performed_on } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(FitFormat.fieldDay(NativeDate.parse(row.performed_on) ?? now)).font(.fit(.base, .medium))
                        let day = store.days.first { $0.id == row.routine_day_id }
                        Text("\(day?.label ?? "Entrenamiento") · \(FitFormat.sets(row.set_count))")
                            .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    }.frame(maxWidth: .infinity, alignment: .leading).fitMinimumHitArea().padding(.vertical, 6)
                }
                .buttonStyle(FitRowButtonStyle())
                .accessibilityHint("Abre las series de esta fecha para revisarlas o corregirlas.")
                Rectangle().fill(FitColor.line).frame(height: 1).accessibilityHidden(true)
            }
            if rows.count > visible.count {
                Button("Ver todos (\(rows.count))") { showAll = true }.fitLink()
            } else if showAll && rows.count > 8 {
                Button("Ver últimos 8") { showAll = false }.fitLink()
            }
        }
    }
}

private struct NativeExerciseProgressCard: View {
    var requestedExercise = ""
    var requestID = 0
    @EnvironmentObject private var store: NativeStore
    @State private var selection = ""
    @State private var metric: Metric = .load
    private enum Metric: String, CaseIterable {
        case load, repetitions, volume
        var label: String {
            switch self { case .load: "Carga"; case .repetitions: "Repeticiones"; case .volume: "Volumen" }
        }
        var unit: String {
            switch self { case .load: "kg"; case .repetitions: "repeticiones"; case .volume: "kg × rep" }
        }
        func value(_ sample: NativeWorkoutTrend.Sample) -> Double? {
            switch self { case .load: sample.maxWeight; case .repetitions: sample.repetitions.map(Double.init); case .volume: sample.volume }
        }
    }
    private var exerciseIDs: [String] {
        Set(store.sets.map(\.exercise_id) + (requestedExercise.isEmpty ? [] : [requestedExercise])).sorted {
            name($0).localizedStandardCompare(name($1)) == .orderedAscending
        }
    }
    private var exerciseID: String { exerciseIDs.contains(selection) && !selection.isEmpty ? selection : exerciseIDs.contains(requestedExercise) ? requestedExercise : exerciseIDs.first ?? "" }
    private var samples: [NativeWorkoutTrend.Sample] {
        NativeWorkoutTrend.samples(exerciseID: exerciseID, sessions: store.sessions, sets: store.sets)
    }
    private func name(_ id: String) -> String { store.exercise(id)?.name ?? id.replacingOccurrences(of: "_", with: " ") }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Evolución por ejercicio").font(.fit(.base, .semibold)).accessibilityAddTraits(.isHeader)
            if exerciseIDs.isEmpty {
                Text("Registrá repeticiones o carga para comparar sesiones.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
            } else {
                Menu {
                    ForEach(exerciseIDs, id: \.self) { id in Button(name(id)) { selection = id } }
                } label: {
                    Label(name(exerciseID), systemImage: "chevron.up.chevron.down")
                        .fixedSize(horizontal: false, vertical: true).fitMinimumHitArea()
                }.buttonStyle(FitButtonStyle(fullWidth: true)).accessibilityLabel("Ejercicio: \(name(exerciseID))")
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { metricButtons }
                    VStack(alignment: .leading, spacing: 8) { metricButtons }
                }
                if let latest = samples.last {
                    Text(metric.value(latest).map { "\(FitFormat.number($0, fraction: 2)) \(metric.unit)" } ?? "Sin \(metric.label.lowercased()) registrada")
                        .font(.fit(.xl2, .bold)).monospacedDigit()
                    Text("\(FitFormat.shortDay(latest.session.performed_on)) · \(metric == .volume ? volumeCoverage(latest) : FitFormat.sets(latest.setCount))")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    if samples.count > 1 {
                        let previous = samples[samples.count - 2]
                        if metric == .volume && (!latest.hasCompleteVolume || !previous.hasCompleteVolume) {
                            Text("Sin comparación · volumen incompleto").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        } else {
                            Text(NativeWorkoutTrend.change(metric.value(latest), previous: metric.value(previous), unit: metric.unit))
                                .font(.fit(.sm, .medium))
                        }
                    } else {
                        Text("Sin sesión anterior").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    }
                    Text("Últimas \(min(samples.count, 12)) sesiones registradas").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                    trendChart
                    DisclosureGroup {
                        Text(metricExplanation).font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        ForEach(Array(samples.suffix(12).reversed())) { sample in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(FitFormat.fieldDay(NativeDate.parse(sample.session.performed_on) ?? Date())).font(.fit(.sm, .medium))
                                Text(metric.value(sample).map { "\(FitFormat.number($0, fraction: 2)) \(metric.unit) · \(metric == .volume ? volumeCoverage(sample) : FitFormat.sets(sample.setCount))" } ?? "Sin dato para esta medida")
                                    .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                            }.padding(.vertical, 6).accessibilityElement(children: .combine)
                        }
                    } label: {
                        Text("Detalle por fecha").font(.fit(.sm)).fitMinimumHitArea()
                    }
                } else {
                    Text("Este ejercicio todavía no tiene sesiones registradas.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }
            }
        }.fitCard()
        .onChange(of: requestID) { _, _ in selection = requestedExercise }
    }
    private var metricExplanation: String {
        switch metric {
        case .load: "Carga máxima anotada en una serie de cada sesión. Más carga no implica por sí sola una mejor sesión."
        case .repetitions: "Total de repeticiones anotadas. Si cambia el número de series, la comparación también cambia."
        case .volume: "Suma de carga × repeticiones. La curva y la comparación incluyen solo sesiones con todas las series registradas con ambos datos. No representa calorías."
        }
    }
    private func volumeCoverage(_ sample: NativeWorkoutTrend.Sample) -> String {
        let count = "\(sample.volumeSetCount) de \(sample.setCount) series con datos"
        return sample.hasCompleteVolume ? count : "Parcial · \(count)"
    }
    @ViewBuilder private var metricButtons: some View {
        ForEach(Metric.allCases, id: \.self) { option in
            Button(option.label) { metric = option }
                .buttonStyle(FitButtonStyle(variant: metric == option ? .primary : .quiet, size: .sm))
                .accessibilityAddTraits(metric == option ? .isSelected : [])
        }
    }
    @ViewBuilder private var trendChart: some View {
        let points = Array(samples.suffix(12))
        let available = points.filter { metric.value($0) != nil && (metric != .volume || $0.hasCompleteVolume) }
        if available.count > 1 {
            Chart(available) { sample in
                if let date = NativeDate.parse(sample.session.performed_on), let value = metric.value(sample) {
                    LineMark(x: .value("Fecha", date), y: .value(metric.label, value)).foregroundStyle(FitColor.accentText)
                    PointMark(x: .value("Fecha", date), y: .value(metric.label, value)).foregroundStyle(FitColor.accentText)
                        .accessibilityLabel(FitFormat.fieldDay(date)).accessibilityValue("\(FitFormat.number(value, fraction: 2)) \(metric.unit)")
                }
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 180)
            .accessibilityLabel("\(metric.label) por sesión de \(name(exerciseID))")
        }
    }
}

/// The web heatmap: 26 Monday-first columns, intensity by opacity so flattened widget colours still read.
struct FitHeatmap: View {
    let sessions: [NativeWorkoutSession]
    let onSelect: (String) -> Void
    @State private var gridWidth: CGFloat = 0
    private static let opacity: [Double] = [0, 0.26, 0.48, 0.72, 1]
    private static let rowLabels = ["Lun", "", "Mié", "", "Vie", "", ""]

    var body: some View {
        let cells = NativeDate.heatmap(sessions)
        let today = NativeDate.key()
        let cell = max((gridWidth - 25 * 2) / 26, 0)
        let trained = cells.filter { $0.level > 0 }.count
        VStack(alignment: .trailing, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Color.clear.frame(height: 12)
                    ForEach(0..<7, id: \.self) { row in
                        Text(Self.rowLabels[row]).font(.fit(.micro)).foregroundStyle(FitColor.muted).frame(height: cell)
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 2) {
                        ForEach(0..<26, id: \.self) { week in
                            Color.clear.frame(height: 8).frame(maxWidth: .infinity).overlay(alignment: .leading) {
                                if let label = monthLabel(cells, week) { Text(label).font(.fit(.micro)).foregroundStyle(FitColor.muted).fixedSize() }
                            }
                        }
                    }
                    HStack(spacing: 2) {
                        ForEach(0..<26, id: \.self) { week in
                            VStack(spacing: 2) {
                                ForEach(0..<7, id: \.self) { day in
                                    let item = cells[week * 7 + day]
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(color(item.level, future: item.key > today))
                                        .aspectRatio(1, contentMode: .fit)
                                        .onTapGesture { if item.key <= today { onSelect(item.key) } }
                                }
                            }
                        }
                    }
                    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Calendario de actividad: \(trained) \(trained == 1 ? "día entrenado" : "días entrenados") en las últimas 26 semanas.")
            HStack(spacing: 4) {
                Text("Menos")
                ForEach(0..<5, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2).fill(color(level, future: false)).frame(width: 10, height: 10)
                }
                Text("Más")
            }
            .font(.fit(.tiny))
            .foregroundStyle(FitColor.muted)
            .accessibilityHidden(true)
        }
    }

    private func color(_ level: Int, future: Bool) -> Color {
        if future { return FitColor.surface2.opacity(0.4) }
        return level == 0 ? FitColor.surface2 : FitColor.accent.opacity(Self.opacity[min(level, 4)])
    }
    private func monthLabel(_ cells: [(key: String, level: Int)], _ week: Int) -> String? {
        guard let date = NativeDate.parse(cells[week * 7].key) else { return nil }
        let label = FitFormat.month(date)
        if week == 0 { return label }
        guard let before = NativeDate.parse(cells[(week - 1) * 7].key) else { return label }
        return FitFormat.month(before) == label ? nil : label
    }
}
