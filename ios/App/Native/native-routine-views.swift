import SwiftUI

/// A tab owns its path; the same screens can still be opened in standalone stacks.
enum NativeRoutineRoute: Hashable {
    case routine(String)
    case day(String, initiallyAdding: Bool)
    case catalog(dayID: String?)
    case exercise(String)
    case workout(date: Date, dayID: String?, guided: Bool)
}

struct NativeRoutineNavigation {
    var push: ((NativeRoutineRoute) -> Void)? = nil
}

enum NativeRoutineDraftPolicy {
    static func canRefresh(draft: String, previous: String?, incoming: String?, initialized: Bool) -> Bool {
        !initialized || draft == previous || draft == incoming
    }
    static func nameError(_ draft: String) -> String? {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Ingresá un nombre antes de guardar." : nil
    }
}

extension EnvironmentValues {
    @Entry var nativeRoutineNavigation = NativeRoutineNavigation()
}

struct NativeRoutineDestination: View {
    @EnvironmentObject private var store: NativeStore
    let route: NativeRoutineRoute
    var body: some View {
        switch route {
        case .routine(let id): NativeRoutineDetail(routineID: id)
        case .day(let id, let initiallyAdding): NativeRoutineDayDetail(dayID: id, initiallyAdding: initiallyAdding)
        case .catalog(let dayID): NativeExerciseCatalog(dayID: dayID)
        case .exercise(let id):
            if let exercise = store.exercise(id) { NativeExerciseDetail(exercise: exercise) }
            else { FitEmptyState(title: "Ejercicio no disponible", description: "Volvé al catálogo para elegir otro ejercicio.") }
        case .workout(let date, let dayID, let guided):
            NativeWorkoutView(date: date, dayID: dayID, mode: guided ? .guided : .history)
        }
    }
}

/// Value-based navigation in managed tabs; destination-based elsewhere, including
/// workout sheets and existing standalone previews. No global route dependency.
struct NativeRoutineLink<Label: View>: View {
    @Environment(\.nativeRoutineNavigation) private var navigation
    let route: NativeRoutineRoute
    @ViewBuilder var label: () -> Label
    var body: some View {
        if navigation.push != nil {
            NavigationLink(value: route, label: label)
        } else {
            NavigationLink { NativeRoutineDestination(route: route) } label: { label() }
        }
    }
}

extension NativeRoutineLink where Label == Text {
    init(_ title: String, route: NativeRoutineRoute) {
        self.route = route
        self.label = { Text(title) }
    }
}
import UIKit
import ImageIO

// MARK: - Shared exercise pieces

/// Scoped, one-shot navigation request. Progreso consumes it on appearance and
/// on nativeShowExerciseProgress; a first visit must not lose the notification.
@MainActor enum NativeExerciseProgressRequest {
    private static var pending: (owner: String, generation: UUID, exerciseID: String)?
    static func prepare(exerciseID: String, auth: NativeAuth) {
        guard let owner = auth.session?.user.id else { pending = nil; return }
        pending = (owner, auth.generation, exerciseID)
    }
    static func consume(auth: NativeAuth) -> String? {
        defer { pending = nil }
        guard let pending, pending.owner == auth.session?.user.id, pending.generation == auth.generation else { return nil }
        return pending.exerciseID
    }
}

struct NativeExerciseEvolutionLink: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.fitSelectTab) private var selectTab
    let exerciseID: String
    var body: some View {
        Button("Ver evolución") {
            NativeExerciseProgressRequest.prepare(exerciseID: exerciseID, auth: store.auth)
            selectTab(.progress)
            NotificationCenter.default.post(name: Notification.Name("nativeShowExerciseProgress"), object: nil,
                userInfo: ["exerciseID": exerciseID])
        }.fitLink().fitMinimumHitArea()
        .accessibilityHint("Abre Progreso con este ejercicio seleccionado")
    }
}

/// Compare-and-set plus the database's unique weekday constraint protect both
/// stale edits and occupied destinations. No rows or historical sets are copied.
struct NativeRoutineDayMove {
    let day: NativeRoutineDay
    let destination: Int
    var query: [URLQueryItem] {
        [URLQueryItem(name: "id", value: "eq.\(day.id)"),
         URLQueryItem(name: "routine_id", value: "eq.\(day.routine_id)"),
         URLQueryItem(name: "weekday", value: "eq.\(day.weekday)")]
    }
    func validate(_ rows: [NativeRoutineDay], owner: String) throws {
        guard (0...6).contains(destination), rows.count == 1, let saved = rows.first,
              saved.id == day.id, saved.user_id == owner, saved.routine_id == day.routine_id,
              saved.weekday == destination else {
            throw NativeFailure.message("El día cambió o no pudimos confirmar el guardado. Actualizá la rutina y elegí un día libre.")
        }
    }
}

@MainActor
enum FitImageCache {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 32 * 1024 * 1024
        cache.countLimit = 80
        return cache
    }()
    static func image(_ path: String, maxPixelSize: Int? = nil) -> UIImage? {
        let key = "\(path)|\(maxPixelSize ?? 0)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        guard let url = Bundle.main.url(forResource: path, withExtension: nil, subdirectory: "NativeResources/exercises") else { return nil }
        let image: UIImage
        if let maxPixelSize {
            // Decode only the pixels the card needs, not a full-size lightbox image.
            guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                  let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
                    kCGImageSourceShouldCacheImmediately: true
                  ] as CFDictionary) else { return nil }
            image = UIImage(cgImage: thumbnail)
        } else {
            guard let full = UIImage(contentsOfFile: url.path) else { return nil }
            image = full
        }
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
        cache.setObject(image, forKey: key, cost: cost)
        return image
    }
}

/// A 3:2 photo from the bundled catalog, cropped like the web's `object-cover`.
struct FitExerciseImage: View {
    let path: String?
    var width: CGFloat?
    var radius: CGFloat = 8
    var body: some View {
        Color.clear
            .aspectRatio(3 / 2, contentMode: .fit)
            .frame(width: width)
            .overlay {
                if let path, let image = FitImageCache.image(path, maxPixelSize: width == nil ? 1200 : 400) {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            }
            .background(FitColor.surface2)
            .clipShape(RoundedRectangle(cornerRadius: radius))
    }
}

/// Photo, name and target; tapping it opens the exercise, like the web's `ExerciseLine`.
struct FitExerciseLine<Trailing: View>: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let exerciseID: String
    var targetSets: Int?
    var targetReps: String?
    var targetWeightKg: Double? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        let exercise = store.exercise(exerciseID)
        HStack(alignment: .top, spacing: 8) {
            NativeRoutineLink(route: .exercise(exerciseID)) {
                let layout = dynamicTypeSize >= .xxxLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
                layout {
                    FitExerciseImage(path: exercise?.images.first, width: dynamicTypeSize >= .xxxLarge ? 64 : 80)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        // Ids dropped from the curated catalog still exist in the database.
                        Text(exercise?.name ?? exerciseID.replacingOccurrences(of: "_", with: " "))
                            .font(.fit(.base, .medium)).fixedSize(horizontal: false, vertical: true)
                        Text(FitFormat.target(sets: targetSets, reps: targetReps, weight: targetWeightKg) ?? "Sin objetivo")
                            .font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .fitMinimumHitArea()
            }
            .buttonStyle(.plain)
            .disabled(exercise == nil)
            .accessibilityHint(exercise == nil ? "" : "Abre fotos y técnica del ejercicio")
            trailing()
        }
    }
}

extension FitExerciseLine where Trailing == EmptyView {
    init(exerciseID: String, targetSets: Int? = nil, targetReps: String? = nil, targetWeightKg: Double? = nil) {
        self.init(exerciseID: exerciseID, targetSets: targetSets, targetReps: targetReps, targetWeightKg: targetWeightKg) { EmptyView() }
    }
}

/// Front and back views; primary vs secondary is one hue's intensity, which survives flattened colours.
struct FitMuscleMap: View {
    let primary: [String]
    let secondary: [String]
    var body: some View {
        let primaryParts = FitLabels.parts(primary)
        let secondaryParts = FitLabels.parts(secondary).subtracting(primaryParts)
        HStack(spacing: 8) {
            ForEach(0..<2, id: \.self) { side in
                Canvas { context, size in
                    let scale = min(size.width / 100, size.height / 200)
                    let dx = (size.width - 100 * scale) / 2
                    for (part, polygons) in side == 0 ? NativeBodyMap.anterior : NativeBodyMap.posterior {
                        let color = primaryParts.contains(part) ? FitColor.accent : secondaryParts.contains(part) ? FitColor.muted : FitColor.surface2
                        for polygon in polygons {
                            var path = Path()
                            path.addLines(polygon.map { CGPoint(x: dx + $0.x * scale, y: $0.y * scale) })
                            path.closeSubpath()
                            context.fill(path, with: .color(color))
                        }
                    }
                }
                .aspectRatio(0.5, contentMode: .fit)
                .frame(maxWidth: 144)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

struct FitCoverageCard: View {
    @EnvironmentObject var store: NativeStore
    let exerciseIDs: [String]
    var title = "Cobertura muscular"
    var weekly = false
    var body: some View {
        let coverage = FitCoverage(exerciseIDs: exerciseIDs, lookup: store.exercise)
        // With no exercises everything would read as missing: noise, not information.
        if coverage.exerciseCount > 0 {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.fit(.base, .semibold))
                FitMuscleMap(primary: coverage.primary, secondary: coverage.secondary).padding(.top, 12)
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(Text("Trabaja: ").foregroundStyle(FitColor.muted))\(labels(coverage.primary))")
                    if !coverage.secondary.isEmpty { Text("\(Text("De apoyo: ").foregroundStyle(FitColor.muted))\(labels(coverage.secondary))") }
                    if weekly && !coverage.missing.isEmpty {
                        Text("\(Text("No incluido en esta rutina: ").foregroundStyle(FitColor.muted))\(labels(coverage.missing))")
                    }
                    Text("Según los músculos del catálogo. No evalúa volumen, frecuencia ni suficiencia del entrenamiento.")
                        .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                }
                .font(.fit(.sm))
                .padding(.top, 12)
            }
            .fitCard()
            .padding(.top, 16)
        }
    }
    private func labels(_ muscles: [String]) -> String { muscles.map(FitLabels.muscle).joined(separator: ", ") }
}

private struct FitTodayBadge: View {
    var body: some View {
        Text("hoy")
            .font(.fit(.tiny, .medium))
            .foregroundStyle(FitColor.muted)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .overlay(Capsule().strokeBorder(FitColor.lineStrong))
    }
}

private func fitDivider() -> some View { Rectangle().fill(FitColor.line).frame(height: 1) }

/// Unknown data is never a confirmed empty state, including before a refresh starts.
struct NativePendingContent: View {
    @EnvironmentObject private var store: NativeStore
    var count = 3
    var body: some View {
        if !store.loading, store.error != nil {
            FitEmptyState(title: "No pudimos cargar los datos", description: "Reintentá cuando tengas conexión. No se cambió lo que ya estaba guardado.") {
                Button("Reintentar") {
                    let generation = store.auth.generation
                    Task {
                        guard generation == store.auth.generation else { return }
                        await store.refresh()
                    }
                }.fitLink()
            }
        } else {
            FitCardsSkeleton(count: count)
        }
    }
}

/// A cache is useful content, not proof that the server has been revalidated.
struct NativeDataStatus: View {
    @EnvironmentObject private var store: NativeStore
    var body: some View {
        if store.loaded, store.usingCachedData || (store.refreshing && !store.busy) {
            HStack(spacing: 8) {
                if store.refreshing { ProgressView().controlSize(.mini).tint(FitColor.muted) }
                Text(store.usingCachedData
                     ? (store.refreshing ? "Datos guardados · Actualizando…" : "Mostrando datos guardados")
                     : "Actualizando…")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted)
            }
            .padding(.bottom, 12)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Rutinas

struct NativeRoutinesView: View {
    @EnvironmentObject var store: NativeStore
    @State private var naming = false
    @State private var browsingCatalog = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var name = ""
    @State private var createError: String?
    @State private var path: [NativeRoutineRoute] = []
    @FocusState private var nameFocused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var routines: [NativeRoutine] { store.routines.sorted { $0.created_at < $1.created_at } }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Button("Mis rutinas") { browsingCatalog = false }
                        .buttonStyle(FitButtonStyle(variant: browsingCatalog ? .quiet : .primary))
                        .accessibilityAddTraits(browsingCatalog ? [] : .isSelected)
                    Button("Ejercicios") { browsingCatalog = true }
                        .buttonStyle(FitButtonStyle(variant: browsingCatalog ? .primary : .quiet))
                        .accessibilityAddTraits(browsingCatalog ? .isSelected : [])
                    Spacer(minLength: 0)
                }.padding(.horizontal, 16).padding(.top, 8)
                if browsingCatalog {
                    NativeExerciseCatalog(dayID: nil, showsBack: false)
                } else {
                    FitPage {
                        FitPageHeader(title: "Rutinas", subtitle: "Tus plantillas de entrenamiento por día") {
                            if !store.routines.isEmpty {
                                Button(naming ? "Cancelar" : "Nueva") {
                                    guard !store.busy else { return }
                                    if naming {
                                        naming = false; name = ""; createError = nil; nameFocused = false
                                    } else { naming = true }
                                }.buttonStyle(FitButtonStyle(size: .sm)).disabled(store.busy).fixedSize()
                            }
                        }
                        NativeDataStatus()
                        if naming {
                            let layout = dynamicTypeSize >= .xxxLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 8))
                            layout {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Nombre de la rutina").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                                    TextField("", text: $name, prompt: fitPrompt("Nombre (Cuerpo completo, Torso…)"))
                                        .focused($nameFocused)
                                        .submitLabel(.done)
                                        .onSubmit(create)
                                        .fitField()
                                        .onChange(of: name) { _, value in if value.count > 60 { name = String(value.prefix(60)) } }
                                        .accessibilityLabel("Nombre de la rutina")
                                }
                                Button(store.busy ? "Creando…" : "Crear", action: create)
                                    .buttonStyle(FitButtonStyle(variant: .primary))
                                    .disabled(trimmed.isEmpty || store.busy)
                                    .fixedSize()
                            }
                            .padding(.bottom, 16)
                            .onAppear { nameFocused = true }
                        }
                        if let createError {
                            FitErrorNote(title: "No se pudo crear la rutina", message: createError).padding(.bottom, 8)
                            Button("Reintentar crear", action: create).buttonStyle(FitButtonStyle())
                                .disabled(trimmed.isEmpty || store.busy).padding(.bottom, 12)
                        }
                        if !store.loaded && store.routines.isEmpty {
                            NativePendingContent(count: 1)
                        } else if store.routines.isEmpty && !naming {
                            FitEmptyState(title: "Sin rutinas todavía", description: "Una rutina agrupa los días de la semana y los ejercicios de cada uno, con sus series y repeticiones.") {
                                Button("Crear la primera") { naming = true }.buttonStyle(FitButtonStyle(variant: .primary))
                            }
                        }
                        LazyVStack(spacing: 8) {
                            ForEach(routines) { routine in NativeRoutineRow(routine: routine) }
                        }
                        NativeRoutineLink(route: .catalog(dayID: nil)) {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Catálogo de ejercicios").font(.fit(.base, .semibold))
                                    Text("Buscá por nombre, músculo o equipamiento. Con foto e instrucciones.").font(.fit(.sm)).foregroundStyle(FitColor.muted).multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                Text("→").foregroundStyle(FitColor.muted).accessibilityHidden(true)
                            }
                            .padding(20)
                        }
                        .buttonStyle(FitRowButtonStyle())
                        .fitCard(padding: 0)
                        .padding(.top, 16)
                    }
                }
            }
            .navigationDestination(for: NativeRoutineRoute.self) { NativeRoutineDestination(route: $0) }
            .onChange(of: store.auth.generation) { _, _ in
                createError = nil; name = ""; naming = false; path = []; nameFocused = false; browsingCatalog = false
            }
        }
        .environment(\.nativeRoutineNavigation, NativeRoutineNavigation(push: { path.append($0) }))
        .fitTabRoot(isDirty: (naming && !name.isEmpty) || createError != nil || store.busy) {
            path.removeAll()
            browsingCatalog = false
        }
    }

    private func create() {
        let value = trimmed
        guard !value.isEmpty, !store.busy else { return }
        // Otherwise Today would stay empty with no obvious reason.
        let first = store.routines.isEmpty
        let before = Set(store.routines.map(\.id))
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) { try await store.api.write("routines", method: "POST", body: ["name": value, "is_active": first]) }
            guard action.isCurrent(in: store.auth) else { return }
            if let message { createError = message; return }
            createError = nil; name = ""; naming = false
            if let id = store.routines.first(where: { !before.contains($0.id) })?.id { path.append(.routine(id)) }
        }
    }
}

struct NativeRoutineRow: View {
    @EnvironmentObject var store: NativeStore
    let routine: NativeRoutine
    @State private var error: String?
    var body: some View {
        let count = store.days(of: routine.id).count
        VStack(alignment: .leading, spacing: 0) {
            NativeRoutineLink(route: .routine(routine.id)) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(routine.name).font(.fit(.base, .semibold)).fixedSize(horizontal: false, vertical: true)
                            if routine.is_active { FitPill() }
                        }
                        Text(count == 0 ? "Sin días todavía" : "\(count) \(count == 1 ? "día" : "días") por semana").font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
                    }
                    Spacer(minLength: 0)
                    Text("→").foregroundStyle(FitColor.muted).accessibilityHidden(true)
                }
                .padding(16)
            }
            .buttonStyle(FitRowButtonStyle())
            // Only the active routine feeds the Today tab.
            if !routine.is_active {
                fitDivider()
                VStack(alignment: .leading, spacing: 8) {
                    Button(store.busy ? "Activando…" : "Usar esta rutina") {
                        let action = NativeWorkoutAction(auth: store.auth)
                        Task {
                            let message = await store.attempt(action: action) { try await store.api.rpc("activate_routine", body: ["p_routine_id": routine.id]) }
                            guard action.isCurrent(in: store.auth) else { return }
                            error = message
                        }
                    }
                    .buttonStyle(FitButtonStyle(size: .sm))
                    .disabled(store.busy)
                    if let error { Text(error).font(.fit(.xs)).foregroundStyle(FitColor.warn) }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
        }
        .fitCard(padding: 0)
        .onChange(of: store.auth.generation) { _, _ in error = nil }
    }
}

struct NativeRoutineDetail: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeRoutineNavigation) private var navigation
    let routineID: String
    @State private var creatingWeekday: Int?
    @State private var createdDayID: String?
    @State private var label = ""
    @State private var nameDraft = ""
    @State private var nameInitialized = false
    @State private var confirmingDeletion = false
    @State private var errors: [String: String] = [:]
    @FocusState private var focus: Field?
    private enum Field { case name, day }
    private static let suggestions = ["Empuje", "Tracción", "Pierna", "Torso", "Cuerpo completo", "Cardio"]

    private var routine: NativeRoutine? { store.routines.first { $0.id == routineID } }
    private var days: [NativeRoutineDay] { store.days(of: routineID) }
    private var exerciseIDs: [String] { days.flatMap { store.plan($0).map(\.exercise_id) } }

    var body: some View {
        FitPage {
            if let routine {
                FitPageHeader(title: routine.name, subtitle: days.isEmpty ? "Elegí los días que entrenás" : "\(days.count) \(days.count == 1 ? "día" : "días") · \(exerciseIDs.count) ejercicios", showsBack: true) {
                    if routine.is_active {
                        FitPill()
                    } else {
                        Button("Activar") { activateRoutine() }
                            .buttonStyle(FitButtonStyle(size: .sm)).disabled(store.busy).fixedSize()
                    }
                }
                NativeDataStatus()
                VStack(spacing: 8) {
                    ForEach(FitLabels.weekOrder, id: \.self) { weekday in weekdayRow(weekday) }
                }
                if let message = errors["day"] { FitErrorNote(title: "No se pudo crear el día; corregí el nombre y reintentá", message: message).padding(.top, 12) }
                if let message = errors["activate"] { FitErrorNote(title: "No se pudo activar la rutina; volvé a tocar Activar", message: message).padding(.top, 12) }
                FitCoverageCard(exerciseIDs: exerciseIDs, title: "Qué cubre la rutina", weekly: true)
                settings(routine)
            } else if !store.loaded {
                FitPageHeader(title: "Rutina", showsBack: true)
                NativePendingContent(count: 7)
            } else {
                FitPageHeader(title: "Rutina", showsBack: true)
                FitEmptyState(title: "No encontramos esa rutina", description: "Puede que la hayas borrado desde otro dispositivo.") {
                    Button("Volver a mis rutinas") { dismiss() }.fitLink()
                }
            }
        }
        .navigationDestination(item: $createdDayID) { NativeRoutineDayDetail(dayID: $0, initiallyAdding: true) }
        .fitNavigationDraft(creatingWeekday != nil || (nameInitialized && nameDraft != routine?.name) || errors["rename"] != nil || confirmingDeletion || store.busy)
        .confirmationDialog("¿Borrar la rutina?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Borrar rutina", role: .destructive, action: deleteRoutine)
            Button("Cancelar", role: .cancel) { }
        } message: {
            Text("Se borrarán \(routine?.name ?? "esta rutina"), sus \(days.count) días y sus \(exerciseIDs.count) ejercicios. Los entrenamientos registrados se conservan. Esta acción no se puede deshacer.")
        }
        .onChange(of: store.auth.generation) { _, _ in
            errors = [:]; nameDraft = ""; nameInitialized = false; label = ""; creatingWeekday = nil; createdDayID = nil; confirmingDeletion = false; focus = nil
        }
        .onAppear { if !nameInitialized, let routine { nameDraft = routine.name; nameInitialized = true } }
        .onChange(of: routine?.name) { old, value in
            if NativeRoutineDraftPolicy.canRefresh(draft: nameDraft, previous: old, incoming: value, initialized: nameInitialized) {
                nameDraft = value ?? ""; nameInitialized = value != nil
            }
        }
        .onChange(of: focus) { old, _ in if old == .name { saveName() } }
    }

    @ViewBuilder private func weekdayRow(_ weekday: Int) -> some View {
        let day = days.first { $0.weekday == weekday }
        let name = NativeDate.weekdays[weekday]
        VStack(spacing: 0) {
            if let day {
                let count = store.plan(day).count
                NativeRoutineLink(route: .day(day.id, initiallyAdding: false)) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 8) {
                                Text(name.uppercased()).font(.fit(.xs)).tracking(0.3).foregroundStyle(FitColor.muted)
                                if weekday == NativeDate.weekday() { FitTodayBadge() }
                            }
                            Text(day.label).font(.fit(.base, .semibold)).fixedSize(horizontal: false, vertical: true)
                            Text(count == 0 ? "Sin ejercicios" : "\(count) \(count == 1 ? "ejercicio" : "ejercicios")").font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
                        }
                        Spacer(minLength: 0)
                        Text("→").foregroundStyle(FitColor.muted).accessibilityHidden(true)
                    }
                    .padding(16)
                }
                .buttonStyle(FitRowButtonStyle())
            } else {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name.uppercased()).font(.fit(.xs)).tracking(0.3).foregroundStyle(FitColor.muted)
                        Text("Descanso").foregroundStyle(FitColor.muted)
                    }
                    Spacer(minLength: 0)
                    Button("Agregar día") { creatingWeekday = weekday; label = ""; focus = .day }.buttonStyle(FitButtonStyle(size: .sm))
                }
                .padding(16)
            }
            if creatingWeekday == weekday {
                fitDivider()
                VStack(alignment: .leading, spacing: 8) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Nombre del día").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        TextField("", text: $label, prompt: fitPrompt("Qué entrenás el \(name.lowercased())"))
                            .focused($focus, equals: .day)
                            .submitLabel(.done)
                            .onSubmit { submitDay(weekday) }
                            .fitField()
                            .onChange(of: label) { _, value in if value.count > 40 { label = String(value.prefix(40)) } }
                            .accessibilityLabel("Nombre del día para \(name)")
                        Button(store.busy ? "Creando…" : "Crear y agregar ejercicios") { submitDay(weekday) }
                            .buttonStyle(FitButtonStyle(variant: .primary))
                            .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || store.busy)
                            .fixedSize()
                    }
                    FitFlowLayout {
                        ForEach(Self.suggestions, id: \.self) { suggestion in
                            Button(suggestion) { label = suggestion }.buttonStyle(FitButtonStyle(size: .sm))
                        }
                        Button("Cancelar") { creatingWeekday = nil }.buttonStyle(FitButtonStyle(size: .sm))
                    }
                }
                .padding(12)
                .background(FitColor.surface2.opacity(0.5))
            }
        }
        .fitCard(padding: 0)
    }

    private func settings(_ routine: NativeRoutine) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Ajustes").font(.fit(.base, .semibold))
            VStack(alignment: .leading, spacing: 4) {
                Text("Nombre").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                TextField("", text: $nameDraft)
                    .focused($focus, equals: .name)
                    .submitLabel(.done)
                    .onSubmit { focus = nil }
                    .fitField()
                    .onChange(of: nameDraft) { _, value in if value.count > 60 { nameDraft = String(value.prefix(60)) } }
                    .accessibilityLabel("Nombre de la rutina")
            }
            .padding(.top, 12)
            VStack(alignment: .leading, spacing: 12) {
                Text("Borrar la rutina borra sus días y sus ejercicios. Los entrenamientos ya registrados quedan.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                Button("Borrar rutina", role: .destructive) { confirmingDeletion = true }
                    .buttonStyle(FitButtonStyle(variant: .danger))
                .fixedSize()
                .disabled(store.busy)
            }
            .padding(.top, 16)
            if let message = errors["rename"] {
                FitErrorNote(title: "No se guardó el nombre", message: message).padding(.top, 12)
                Button("Reintentar guardar nombre", action: saveName).buttonStyle(FitButtonStyle()).disabled(store.busy).padding(.top, 8)
            }
            if let message = errors["delete"] { FitErrorNote(title: "No se pudo borrar; volvé a tocar Borrar", message: message).padding(.top, 12) }
        }
        .fitCard()
        .padding(.top, 16)
    }

    private func activateRoutine() {
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) { try await store.api.rpc("activate_routine", body: ["p_routine_id": routineID]) }
            guard action.isCurrent(in: store.auth) else { return }
            errors["activate"] = message
        }
    }

    private func deleteRoutine() {
        guard !store.busy else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) {
                try await store.api.write("routines", method: "DELETE", query: nativeQuery("id", routineID))
            }
            guard action.isCurrent(in: store.auth) else { return }
            errors["delete"] = message
            if message == nil { dismiss() }
        }
    }

    private func submitDay(_ weekday: Int) {
        let value = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !store.busy, let owner = store.auth.session?.user.id else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            var created: NativeRoutineDay?
            let message = await store.attempt(action: action) {
                let data = try await store.api.request("rest/v1/routine_days", method: "POST",
                    body: ["routine_id": routineID, "weekday": weekday, "label": value], prefer: "return=representation")
                let rows = try JSONDecoder().decode([NativeRoutineDay].self, from: data)
                guard let row = rows.first, row.user_id == owner, row.routine_id == routineID, row.weekday == weekday else {
                    throw NativeFailure.message("No pudimos confirmar el día creado. Actualizá la rutina antes de reintentar.")
                }
                created = row
            }
            guard action.isCurrent(in: store.auth) else { return }
            errors["day"] = message
            if message == nil {
                creatingWeekday = nil; label = ""; focus = nil
                if let id = created?.id {
                    if let push = navigation.push { push(.day(id, initiallyAdding: true)) }
                    else { createdDayID = id }
                }
            }
        }
    }

    private func saveName() {
        guard let routine else { return }
        let value = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if let message = NativeRoutineDraftPolicy.nameError(nameDraft) { errors["rename"] = message; return }
        guard value != routine.name else { nameDraft = routine.name; errors["rename"] = nil; return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) { try await store.api.write("routines", method: "PATCH", body: ["name": value], query: nativeQuery("id", routineID)) }
            guard action.isCurrent(in: store.auth) else { return }
            errors["rename"] = message
        }
    }
}

struct NativeRoutineDayDetail: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeRoutineNavigation) private var navigation
    let dayID: String
    var initiallyAdding = false
    @State private var adding = false
    @State private var didAutoAdd = false
    @State private var ordering = false
    @State private var weekdayDraft = -1
    @State private var moved = false
    @State private var labelDraft = ""
    @State private var labelInitialized = false
    @State private var confirmingDeletion = false
    @State private var errors: [String: String] = [:]
    @FocusState private var labelFocused: Bool

    private var day: NativeRoutineDay? { store.days.first { $0.id == dayID } }
    private var items: [NativeRoutineExercise] { store.plan(day) }

    var body: some View {
        FitPage {
            if let day {
                let routine = store.routines.first { $0.id == day.routine_id }
                FitPageHeader(title: day.label, subtitle: "\(NativeDate.weekdays[day.weekday]) · \(routine?.name ?? "")", showsBack: true) {
                    if items.count > 1 {
                        Button(ordering ? "Terminar orden" : "Ordenar") { ordering.toggle() }
                            .buttonStyle(FitButtonStyle(size: .sm))
                    }
                }
                NativeDataStatus()
                if items.isEmpty {
                    FitEmptyState(title: "Este día está vacío", description: "Elegí ejercicios del catálogo: se agregan al final y después los ordenás.")
                } else {
                    VStack(spacing: 8) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            NativeRoutineExerciseItem(item: item, previous: index > 0 ? items[index - 1] : nil, next: index + 1 < items.count ? items[index + 1] : nil, ordering: ordering)
                        }
                    }
                }
                // Reuses the catalog in "pick" mode instead of maintaining a second search.
                Button("Agregar ejercicio", action: openCatalog)
                    .buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true))
                    .padding(.top, 12)
                FitCoverageCard(exerciseIDs: items.map(\.exercise_id), title: "Qué cubre este día")
                settings(day)
            } else if !store.loaded {
                FitPageHeader(title: "Día", showsBack: true)
                NativePendingContent()
            } else {
                FitPageHeader(title: "Día", showsBack: true)
                FitEmptyState(title: "Ese día ya no existe", description: "Puede que lo hayas borrado, o que la rutina haya cambiado.") {
                    Button("Volver") { dismiss() }.fitLink()
                }
            }
        }
        .navigationDestination(isPresented: $adding) { NativeExerciseCatalog(dayID: dayID) }
        .fitNavigationDraft((labelInitialized && labelDraft != day?.label) || errors["rename"] != nil || weekdayDraft >= 0 || confirmingDeletion || store.busy)
        .task {
            if initiallyAdding && !didAutoAdd { didAutoAdd = true; openCatalog() }
        }
        .confirmationDialog("¿Sacar este día?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Sacar día", role: .destructive, action: deleteDay)
            Button("Cancelar", role: .cancel) { }
        } message: {
            Text("\(day?.label ?? "Este día") pasará a ser descanso y se quitarán sus \(items.count) ejercicios con sus objetivos y notas. Los entrenamientos registrados se conservan. Esta acción no se puede deshacer.")
        }
        .onChange(of: store.auth.generation) { _, _ in errors = [:]; labelDraft = ""; labelInitialized = false; labelFocused = false; confirmingDeletion = false; adding = false; ordering = false; weekdayDraft = -1; moved = false }
        .onAppear { if !labelInitialized, let day { labelDraft = day.label; labelInitialized = true } }
        .onChange(of: day?.label) { old, value in
            if NativeRoutineDraftPolicy.canRefresh(draft: labelDraft, previous: old, incoming: value, initialized: labelInitialized) {
                labelDraft = value ?? ""; labelInitialized = value != nil
            }
        }
        .onChange(of: labelFocused) { old, _ in if old { saveLabel() } }
    }

    private func openCatalog() {
        if let push = navigation.push { push(.catalog(dayID: dayID)) }
        else { adding = true }
    }

    private func settings(_ day: NativeRoutineDay) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Ajustes del día").font(.fit(.base, .semibold))
            VStack(alignment: .leading, spacing: 4) {
                Text("Nombre del día").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                TextField("", text: $labelDraft)
                    .focused($labelFocused)
                    .submitLabel(.done)
                    .onSubmit { labelFocused = false }
                    .fitField()
                    .onChange(of: labelDraft) { _, value in if value.count > 40 { labelDraft = String(value.prefix(40)) } }
                    .accessibilityLabel("Nombre del día")
            }
            .padding(.top, 12)
            VStack(alignment: .leading, spacing: 8) {
                Text("Cambiar día de semana").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                Picker("Día de semana libre", selection: $weekdayDraft) {
                    Text("Elegí un día libre").tag(-1)
                    ForEach(FitLabels.weekOrder.filter { weekday in
                        !store.days.contains { $0.routine_id == day.routine_id && $0.weekday == weekday }
                    }, id: \.self) { weekday in Text(NativeDate.weekdays[weekday]).tag(weekday) }
                }
                .pickerStyle(.menu)
                .disabled(store.busy)
                Text("Conserva ejercicios, objetivos, notas y entrenamientos registrados. No reemplaza otros días.")
                    .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                Button("Guardar día de semana") { moveDay(day) }.buttonStyle(FitButtonStyle(size: .sm))
                    .disabled(weekdayDraft < 0 || store.busy)
                if moved { Text("Día de semana actualizado").font(.fit(.sm)).foregroundStyle(FitColor.ok) }
                if let message = errors["move"] { FitErrorNote(title: "No se pudo cambiar el día", message: message) }
            }.padding(.top, 16)
            VStack(alignment: .leading, spacing: 12) {
                Text("Sacar el día lo vuelve descanso y borra sus ejercicios.").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                Button("Sacar día", role: .destructive) { confirmingDeletion = true }
                    .buttonStyle(FitButtonStyle(variant: .danger))
                .fixedSize()
                .disabled(store.busy)
            }
            .padding(.top, 16)
            if let message = errors["rename"] {
                FitErrorNote(title: "No se guardó el nombre", message: message).padding(.top, 12)
                Button("Reintentar guardar nombre", action: saveLabel).buttonStyle(FitButtonStyle()).disabled(store.busy).padding(.top, 8)
            }
            if let message = errors["delete"] { FitErrorNote(title: "No se pudo sacar el día; volvé a tocar Sacar día", message: message).padding(.top, 12) }
        }
        .fitCard()
        .padding(.top, 16)
    }

    private func moveDay(_ day: NativeRoutineDay) {
        guard !store.busy, (0...6).contains(weekdayDraft), let owner = store.auth.session?.user.id else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        let destination = weekdayDraft
        let move = NativeRoutineDayMove(day: day, destination: destination)
        moved = false
        Task {
            let message = await store.attempt(action: action) {
                let data = try await store.api.request("rest/v1/routine_days", method: "PATCH", query: move.query,
                    body: ["weekday": destination], prefer: "return=representation")
                try move.validate(JSONDecoder().decode([NativeRoutineDay].self, from: data), owner: owner)
            }
            guard action.isCurrent(in: store.auth) else { return }
            errors["move"] = message
            if message == nil { weekdayDraft = -1; moved = true }
        }
    }

    private func deleteDay() {
        guard !store.busy else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) {
                try await store.api.write("routine_days", method: "DELETE", query: nativeQuery("id", dayID))
            }
            guard action.isCurrent(in: store.auth) else { return }
            errors["delete"] = message
            if message == nil { dismiss() }
        }
    }

    private func saveLabel() {
        guard let day else { return }
        let value = labelDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if let message = NativeRoutineDraftPolicy.nameError(labelDraft) { errors["rename"] = message; return }
        guard value != day.label else { labelDraft = day.label; errors["rename"] = nil; return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) { try await store.api.write("routine_days", method: "PATCH", body: ["label": value], query: nativeQuery("id", dayID)) }
            guard action.isCurrent(in: store.auth) else { return }
            errors["rename"] = message
        }
    }
}

/// Drafts save together: an invalid field never partially changes the exercise goal.
struct NativeRoutineExerciseItem: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let item: NativeRoutineExercise
    let previous, next: NativeRoutineExercise?
    var ordering = false
    @State private var sets = ""
    @State private var reps = ""
    @State private var notes = ""
    @State private var weight = ""
    @State private var editing = false
    @State private var saving = false
    @State private var confirmingRemoval = false
    @State private var error: (title: String, message: String)?
    @State private var retry: Retry?
    @FocusState private var focus: Field?
    private enum Field { case sets, reps, weight, notes }
    private enum Retry { case save, moveUp, moveDown, remove }
    private var name: String { store.exercise(item.exercise_id)?.name ?? item.exercise_id.replacingOccurrences(of: "_", with: " ") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if ordering {
                HStack(spacing: 8) {
                    Text(name).font(.fit(.base, .medium)).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button { swap(with: previous, direction: .moveUp) } label: { Image(systemName: "arrow.up") }
                        .buttonStyle(FitButtonStyle(size: .sm)).accessibilityLabel("Mover \(name) antes")
                        .disabled(previous == nil || store.busy || saving)
                    Button { swap(with: next, direction: .moveDown) } label: { Image(systemName: "arrow.down") }
                        .buttonStyle(FitButtonStyle(size: .sm)).accessibilityLabel("Mover \(name) después")
                        .disabled(next == nil || store.busy || saving)
                }
            } else {
                FitExerciseLine(exerciseID: item.exercise_id, targetSets: item.target_sets, targetReps: item.target_reps, targetWeightKg: item.target_weight_kg) {
                    Menu {
                        Button("Editar objetivo y notas", systemImage: "pencil") { beginEditing() }
                        Button("Mover antes", systemImage: "arrow.up") { swap(with: previous, direction: .moveUp) }
                            .disabled(previous == nil)
                        Button("Mover después", systemImage: "arrow.down") { swap(with: next, direction: .moveDown) }
                            .disabled(next == nil)
                        Divider()
                        Button("Quitar del día", systemImage: "trash", role: .destructive) { confirmingRemoval = true }
                    } label: {
                        Image(systemName: "ellipsis").font(.fit(.base, .semibold))
                            .foregroundStyle(FitColor.muted).fitMinimumHitArea()
                    }
                    .disabled(store.busy || saving)
                    .accessibilityLabel("Opciones de \(name)")
                }
                if !editing {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) { objectiveActions }
                        VStack(alignment: .leading, spacing: 8) { objectiveActions }
                    }.padding(.top, 12)
                }
                if editing {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Editar objetivo").font(.fit(.sm, .semibold))
                        let layout = dynamicTypeSize >= .xxxLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .top, spacing: 8))
                        layout {
                            numericField("Series", text: $sets, field: .sets, prompt: "1–50", keyboard: .numberPad)
                            numericField("Repeticiones", text: $reps, field: .reps, prompt: "8–12 o 30 s", keyboard: .default)
                            numericField("Peso (kg)", text: $weight, field: .weight, prompt: "Opcional", keyboard: .decimalPad)
                        }
                        Text("Vacío = sin objetivo. 0 kg = sin carga añadida. Las repeticiones también admiten tiempo o una indicación breve.")
                            .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Notas").font(.fit(.sm)).foregroundStyle(FitColor.muted)
                            TextField("", text: $notes, prompt: fitPrompt("Opcional"), axis: .vertical)
                                .focused($focus, equals: .notes)
                                .fitField(fill: FitColor.surface2, radius: 8, horizontal: 12, vertical: 12)
                                .accessibilityLabel("Notas de \(name)")
                        }
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 8) { editorActions }
                            VStack(alignment: .leading, spacing: 8) { editorActions }
                        }
                    }
                    .padding(.top, 12)
                    .disabled(saving)
                } else if let notes = item.notes, !notes.isEmpty {
                    Text(notes).font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 8)
                }
                if let exercise = store.exercise(item.exercise_id) {
                    NativeExerciseTechnique(exercise: exercise).padding(.top, 8)
                }
            }
            if let error {
                FitErrorNote(title: error.title, message: error.message).padding(.top, 8)
                if retry != nil {
                    Button("Reintentar", action: retryOperation).buttonStyle(FitButtonStyle())
                        .disabled(store.busy || saving).padding(.top, 8)
                }
            }
        }
        .padding(12)
        .fitCard(padding: 0)
        .fitNavigationDraft(editing || saving)
        .confirmationDialog("¿Quitar \(name) de este día?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Quitar del día", role: .destructive) { remove() }
            Button("Cancelar", role: .cancel) { }
        } message: {
            Text("Se quitarán su objetivo y sus notas de este día. Los entrenamientos ya registrados se conservan.")
        }
        .toolbar {
            // Only the focused row contributes a toolbar, even if several editors are open.
            if focus != nil {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Listo") { focus = nil }
                        .buttonStyle(FitButtonStyle(size: .sm))
                        .accessibilityLabel("Terminar de editar")
                }
            }
        }
        .onChange(of: store.auth.generation) { _, _ in
            editing = false; saving = false; focus = nil; error = nil; retry = nil; confirmingRemoval = false
            sets = ""; reps = ""; weight = ""; notes = ""
        }
    }

    @ViewBuilder private var objectiveActions: some View {
        Button(item.target_sets == nil && item.target_reps == nil && item.target_weight_kg == nil ? "Definir objetivo" : "Editar objetivo") { beginEditing() }
            .buttonStyle(FitButtonStyle(size: .sm)).disabled(store.busy || saving)
        NativeExerciseEvolutionLink(exerciseID: item.exercise_id)
    }

    @ViewBuilder private var editorActions: some View {
        Button(saving ? "Guardando…" : "Guardar objetivo", action: saveDraft)
            .buttonStyle(FitButtonStyle(variant: .primary)).disabled(store.busy || saving)
        Button("Cancelar") { editing = false; focus = nil; error = nil; retry = nil }
            .buttonStyle(FitButtonStyle()).disabled(saving)
    }

    private func numericField(_ title: String, text: Binding<String>, field: Field, prompt: String, keyboard: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.fit(.sm)).foregroundStyle(FitColor.muted)
            TextField("", text: text, prompt: fitPrompt(prompt))
                .modifier(RoutineNumericInput(keyboard: keyboard))
                .focused($focus, equals: field)
                .onSubmit { focus = nil }
                .fitField(fill: FitColor.surface2, radius: 8, horizontal: 12, vertical: 12)
                .accessibilityLabel("\(title) objetivo de \(name)")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func beginEditing() {
        guard !editing else { return }
        sets = item.target_sets.map(String.init) ?? ""
        reps = item.target_reps ?? ""
        notes = item.notes ?? ""
        weight = item.target_weight_kg.map(FitFormat.plain) ?? ""
        error = nil; retry = nil; editing = true
    }

    private func saveDraft() {
        guard !store.busy, !saving else { return }
        do {
            let targetSets = try FitFormat.targetSets(sets)
            let targetReps = try FitFormat.validatedTargetReps(reps)
            let targetWeight = try FitFormat.targetWeight(weight)
            let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            let patch: [String: Any] = ["target_sets": nativeNull(targetSets), "target_reps": nativeNull(targetReps),
                                      "target_weight_kg": nativeNull(targetWeight), "notes": trimmedNotes.isEmpty ? NSNull() : trimmedNotes]
            let action = NativeWorkoutAction(auth: store.auth)
            saving = true; focus = nil; error = nil; retry = nil
            Task {
                let message = await store.attempt(action: action) {
                    let data = try await store.api.request("rest/v1/routine_exercises", method: "PATCH",
                        query: nativeQuery("id", item.id), body: patch, prefer: "return=representation")
                    let rows = try JSONDecoder().decode([NativeRoutineExercise].self, from: data)
                    guard let saved = rows.first, saved.id == item.id, saved.target_sets == targetSets,
                          saved.target_reps == targetReps, saved.target_weight_kg == targetWeight,
                          (saved.notes ?? "") == trimmedNotes else {
                        throw NativeFailure.message("No pudimos confirmar el objetivo guardado. Revisá la conexión y reintentá.")
                    }
                }
                guard action.isCurrent(in: store.auth) else { return }
                saving = false
                if let message { error = ("No pudimos confirmar el objetivo", message); retry = .save }
                else { editing = false }
            }
        } catch {
            self.error = ("Revisá el objetivo", error.localizedDescription)
            retry = nil // Keep the exact draft visible; nothing was sent to the server.
        }
    }

    private func swap(with other: NativeRoutineExercise?, direction: Retry) {
        guard let other, !store.busy, !saving else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) {
                // Resolve fresh positions immediately before the atomic server RPC.
                guard let current = store.routineExercises.first(where: { $0.id == item.id }),
                      let adjacent = store.routineExercises.first(where: { $0.id == other.id }),
                      current.routine_day_id == adjacent.routine_day_id else {
                    throw NativeFailure.message("El día cambió. Actualizá los datos y elegí la nueva posición.")
                }
                try await store.api.rpc("swap_routine_exercise_positions", body: ["p_a_id": current.id, "p_a_position": current.position, "p_b_id": adjacent.id, "p_b_position": adjacent.position])
            }
            guard action.isCurrent(in: store.auth) else { return }
            error = message.map { ("No se pudo reordenar", $0) }; retry = message == nil ? nil : direction
        }
    }
    private func remove() {
        guard !store.busy, !saving else { return }
        let action = NativeWorkoutAction(auth: store.auth)
        Task {
            let message = await store.attempt(action: action) {
                try await store.api.write("routine_exercises", method: "DELETE", query: nativeQuery("id", item.id))
            }
            guard action.isCurrent(in: store.auth) else { return }
            error = message.map { ("No se pudo quitar el ejercicio", $0) }; retry = message == nil ? nil : .remove
        }
    }
    private func retryOperation() {
        switch retry {
        case .save: saveDraft()
        case .moveUp: swap(with: previous, direction: .moveUp)
        case .moveDown: swap(with: next, direction: .moveDown)
        case .remove: confirmingRemoval = true
        case nil: break
        }
    }
}

private struct RoutineNumericInput: ViewModifier {
    let keyboard: UIKeyboardType
    @ViewBuilder func body(content: Content) -> some View {
        if keyboard == .numberPad || keyboard == .decimalPad {
            content.fitNumericInput(allowsDecimal: keyboard == .decimalPad)
        } else {
            content.textInputAutocapitalization(.never).autocorrectionDisabled().monospacedDigit()
        }
    }
}

// MARK: - Ejercicios

/// One insertion identity survives a lost response. Reconciliation never rewrites existing metadata.
struct NativeRoutineExerciseInsertion {
    let rowID: String
    let owner: String
    let generation: UUID
    let dayID: String
    let exerciseID: String

    init(owner: String, generation: UUID, dayID: String, exerciseID: String) {
        rowID = UUID().uuidString.lowercased()
        self.owner = owner
        self.generation = generation
        self.dayID = dayID
        self.exerciseID = exerciseID
    }

    func belongs(to owner: String, generation: UUID, dayID: String, exerciseID: String) -> Bool {
        self.owner == owner && self.generation == generation && self.dayID == dayID && self.exerciseID == exerciseID
    }

    @MainActor func perform(fetch: () async throws -> [NativeRoutineExercise],
                            insert: ([String: Any]) async throws -> Void,
                            checkCurrent: () throws -> Void) async throws {
        try checkCurrent()
        let rows = try await fetch()
        try checkCurrent()
        guard rows.allSatisfy({ $0.user_id.caseInsensitiveCompare(owner) == .orderedSame && $0.routine_day_id.caseInsensitiveCompare(dayID) == .orderedSame }) else {
            throw NativeFailure.message("No pudimos confirmar los ejercicios de este día. Actualizá y reintentá.")
        }
        if let recovered = rows.first(where: { $0.id.caseInsensitiveCompare(rowID) == .orderedSame }) {
            guard recovered.exercise_id == exerciseID else {
                throw NativeFailure.message("El registro de este agregado no coincide con el ejercicio. Actualizá los datos.")
            }
            return // Own committed insertion: do not POST or overwrite its objective, notes, or position.
        }
        guard !rows.contains(where: { $0.exercise_id == exerciseID }) else {
            throw NativeFailure.message("Este ejercicio ya está en el día por otro agregado. Actualizá los datos para verlo.")
        }
        let lastPosition = rows.map(\.position).max() ?? -1
        guard lastPosition < Int(Int16.max) else {
            throw NativeFailure.message("Este día alcanzó el límite de posiciones. Reordená sus ejercicios antes de agregar otro.")
        }
        try checkCurrent()
        // Plain INSERT, never upsert: the primary key and day/exercise unique constraint remain authoritative.
        try await insert(["id": rowID, "routine_day_id": dayID, "exercise_id": exerciseID, "position": lastPosition + 1])
        try checkCurrent()
    }
}

/// With a day it picks an exercise for it, so there's only one search to maintain.
struct NativeExerciseCatalog: View {
    @EnvironmentObject var store: NativeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let dayID: String?
    var showsBack = true
    @State private var query = ""
    @State private var muscle: String?
    @State private var equipment: String?
    @State private var error: String?
    @State private var failedExercise: NativeExercise?
    @State private var insertionAttempts: [String: NativeRoutineExerciseInsertion] = [:]
    @State private var confirmedAdds: Set<String> = []
    @State private var addingExerciseID: String?

    private var day: NativeRoutineDay? { store.days.first { $0.id == dayID } }
    private var addedIDs: Set<String> {
        Set(store.routineExercises.filter { $0.routine_day_id == dayID }.map(\.exercise_id)).union(confirmedAdds)
    }
    private var destinationLabel: String {
        guard let day else { return "Día no disponible; volvé a tus rutinas" }
        let routine = store.routines.first { $0.id == day.routine_id }
        return "\(routine?.name ?? "Rutina") · \(day.label) · \(NativeDate.weekdays[day.weekday])"
    }

    private var results: [NativeExercise] { FitCatalogSearch.filter(store.exercises, query: query, muscle: muscle, equipment: equipment) }
    private var muscles: [String] {
        let available = Set(store.exercises.flatMap(\.primary_muscles))
        return FitLabels.muscleOrder.filter { available.contains($0) }
    }
    private var equipments: [String] { Array(Set(store.exercises.compactMap(\.equipment))).sorted() }

    var body: some View {
        let results = results
        FitPage(refreshable: false) {
            FitPageHeader(title: dayID == nil ? "Ejercicios" : "Elegir ejercicio",
                          subtitle: dayID == nil ? "\(store.exercises.count) ejercicios con foto y músculos" : destinationLabel, showsBack: showsBack)
            if dayID != nil {
                Button("Volver al día · \(addedIDs.count)") { dismiss() }
                    .buttonStyle(FitButtonStyle(variant: .primary, fullWidth: true)).padding(.bottom, 8)
                Text("Agregá varios ejercicios sin salir. Se guardan al final del día.")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted).padding(.bottom, 12)
            }
            if let error {
                FitErrorNote(title: "No se pudo agregar el ejercicio", message: error).padding(.bottom, 8)
                if let failedExercise, let dayID {
                    Button("Reintentar agregar") { add(failedExercise, to: dayID) }
                        .buttonStyle(FitButtonStyle()).disabled(store.busy).padding(.bottom, 12)
                }
            }
            TextField("", text: $query, prompt: fitPrompt("Buscar por nombre o músculo…"))
                .submitLabel(.search)
                .autocorrectionDisabled()
                .fitField(size: .base)
                .accessibilityLabel("Buscar ejercicio")
            Text("Músculo").font(.fit(.xs, .semibold)).foregroundStyle(FitColor.muted).padding(.top, 12)
            chips(muscles, selection: $muscle, label: FitLabels.muscle).padding(.top, 4)
            Text("Equipamiento").font(.fit(.xs, .semibold)).foregroundStyle(FitColor.muted).padding(.top, 8)
            chips(equipments, selection: $equipment) { FitLabels.equipment[$0] ?? $0 }.padding(.top, 4)
            HStack(alignment: .firstTextBaseline) {
                Text(results.count == store.exercises.count ? "\(results.count) ejercicios" : "\(results.count) de \(store.exercises.count)")
                    .font(.fit(.sm)).foregroundStyle(FitColor.muted).monospacedDigit()
                Spacer()
                if !query.isEmpty || muscle != nil || equipment != nil {
                    Button { query = ""; muscle = nil; equipment = nil } label: {
                        Text("Limpiar").fitLink().fitMinimumHitArea()
                    }.buttonStyle(.plain)
                }
            }
            .padding(.top, 16)
            if results.isEmpty {
                FitEmptyState(title: "Ningún ejercicio coincide", description: "Probá con menos filtros, o buscá por el músculo que querés trabajar.").padding(.top, 12)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(results) { exercise in card(exercise) }
                }
                .padding(.top, 12)
            }
        }
        .fitNavigationDraft(addingExerciseID != nil || failedExercise != nil)
        .onChange(of: store.auth.generation) { _, _ in error = nil; failedExercise = nil; insertionAttempts = [:]; confirmedAdds = []; addingExerciseID = nil; query = ""; muscle = nil; equipment = nil }
        .onChange(of: dayID) { _, _ in error = nil; failedExercise = nil; insertionAttempts = [:]; confirmedAdds = []; addingExerciseID = nil }
    }

    // 17 muscles in a grid would eat a phone screen.
    private func chips(_ values: [String], selection: Binding<String?>, label: @escaping (String) -> String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(values, id: \.self) { value in
                    FitChip(label: label(value), active: selection.wrappedValue == value) {
                        selection.wrappedValue = selection.wrappedValue == value ? nil : value
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
        }
        .padding(.horizontal, -16)
    }

    @ViewBuilder private func card(_ exercise: NativeExercise) -> some View {
        let layout = dynamicTypeSize >= .xxxLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        let row = layout {
            FitExerciseImage(path: exercise.images.first, width: dynamicTypeSize >= .xxxLarge ? 72 : 96)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(exercise.name).font(.fit(.base, .medium)).fixedSize(horizontal: false, vertical: true)
                Text(exercise.primary_muscles.map(FitLabels.muscle).joined(separator: " · ")).font(.fit(.xs)).foregroundStyle(FitColor.muted).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
                Text(FitLabels.of(FitLabels.equipment, exercise.equipment)).font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        if let dayID {
            let added = addedIDs.contains(exercise.id)
            VStack(alignment: .leading, spacing: 0) {
                Button { add(exercise, to: dayID) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        row
                        Text(added ? "Ya está en el día" : "Agregar al día")
                            .font(.fit(.xs, .medium)).foregroundStyle(added ? FitColor.muted : FitColor.accent)
                            .padding(.horizontal, 10).padding(.bottom, 10)
                    }
                }
                .buttonStyle(FitRowButtonStyle())
                .disabled(added || store.busy || addingExerciseID != nil || day == nil)
                .opacity(added ? 0.7 : 1)
                .accessibilityLabel(added ? "\(exercise.name), ya está en el día" : "Agregar \(exercise.name)")
                fitDivider()
                NativeRoutineLink(route: .exercise(exercise.id)) {
                    Text("Ver técnica y fotos").fitLink()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).fitMinimumHitArea()
                }
                .buttonStyle(FitRowButtonStyle())
                .accessibilityLabel("Ver técnica y fotos de \(exercise.name)")
            }
            .fitCard(padding: 0)
        } else {
            NativeRoutineLink(route: .exercise(exercise.id)) { row }
                .buttonStyle(FitRowButtonStyle())
                .fitCard(padding: 0)
        }
    }

    private func add(_ exercise: NativeExercise, to dayID: String) {
        guard !store.busy, addingExerciseID == nil, day != nil, !addedIDs.contains(exercise.id), let owner = store.auth.session?.user.id else { return }
        addingExerciseID = exercise.id
        let action = NativeWorkoutAction(auth: store.auth)
        let generation = store.auth.generation
        let key = dayID + "|" + exercise.id
        let insertion: NativeRoutineExerciseInsertion
        if let existing = insertionAttempts[key], existing.belongs(to: owner, generation: generation, dayID: dayID, exerciseID: exercise.id) {
            insertion = existing
        } else {
            insertion = NativeRoutineExerciseInsertion(owner: owner, generation: generation, dayID: dayID, exerciseID: exercise.id)
            insertionAttempts[key] = insertion
        }
        Task {
            let message = await store.attempt(action: action) {
                try await insertion.perform(fetch: {
                    try await store.api.fetch("routine_exercises", query: nativeQuery("routine_day_id", dayID))
                }, insert: { body in
                    try await store.api.write("routine_exercises", method: "POST", body: body)
                }, checkCurrent: { try action.check(in: store.auth) })
            }
            guard action.isCurrent(in: store.auth) else { return }
            addingExerciseID = nil
            error = message
            failedExercise = message == nil ? nil : exercise
            if message == nil { insertionAttempts[key] = nil; confirmedAdds.insert(exercise.id) }
        }
    }
}

/// Reusable beside a workout exercise; Spanish guides never require a network request.
struct NativeExerciseTechnique: View {
    let exercise: NativeExercise
    var showsOriginal: Bool
    @State private var expanded: Bool
    init(exercise: NativeExercise, expanded: Bool = false, showsOriginal: Bool = false) {
        self.exercise = exercise
        self.showsOriginal = showsOriginal
        _expanded = State(initialValue: expanded)
    }
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 12) {
                if let steps = NativeExerciseInstructionsES.steps(for: exercise.id) {
                    numbered(steps)
                    Text("Guía breve en español · F1t").font(.fit(.xs)).foregroundStyle(FitColor.muted)
                    if exercise.id == "Band_Hip_Adductions" {
                        Text("Aducción significa llevar la pierna hacia el centro. El texto original de esta entrada describe separarla, un movimiento diferente.")
                            .font(.fit(.sm)).foregroundStyle(FitColor.warn)
                    }
                } else {
                    Text("Aún no hay una guía en español para este ejercicio. Podés consultar las imágenes y el texto original en su ficha.")
                        .font(.fit(.sm)).foregroundStyle(FitColor.muted)
                }
                if showsOriginal, exercise.instructions.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                    DisclosureGroup {
                        numbered(exercise.instructions.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
                            .padding(.top, 8)
                        Text("free-exercise-db · Unlicense · Texto original sin traducir")
                            .font(.fit(.xs)).foregroundStyle(FitColor.muted)
                    } label: {
                        Text("Ver instrucciones originales (inglés)").font(.fit(.sm))
                            .fitMinimumHitArea()
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Text("Técnica en español").font(.fit(.sm, .medium)).foregroundStyle(FitColor.ink2)
                .frame(maxWidth: .infinity, alignment: .leading).fitMinimumHitArea()
        }
        .tint(FitColor.muted)
        .accessibilityHint("Muestra u oculta la guía de \(exercise.name)")
    }
    private func numbered(_ steps: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(index + 1)").font(.fit(.sm, .semibold)).foregroundStyle(FitColor.muted).monospacedDigit()
                    Text(step).font(.fit(.sm)).foregroundStyle(FitColor.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

struct NativeExerciseDetail: View {
    let exercise: NativeExercise
    @State private var zoomed: Int?

    var body: some View {
        FitPage(refreshable: false) {
            FitPageHeader(title: exercise.name, subtitle: exercise.primary_muscles.map(FitLabels.muscle).joined(separator: " · "), showsBack: true)
            NativeExerciseEvolutionLink(exerciseID: exercise.id).padding(.bottom, 12)
            // Start and end of the movement: one alone says nothing.
            HStack(spacing: 8) {
                ForEach(Array(exercise.images.enumerated()), id: \.offset) { index, path in
                    Button { zoomed = index } label: { FitExerciseImage(path: path, radius: 12) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Ampliar \(exercise.name): posición \(index == 0 ? "inicial" : "final")")
                }
            }
            NativeExerciseTechnique(exercise: exercise, expanded: true, showsOriginal: true)
                .fitCard().padding(.top, 12)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                fact("Equipamiento", FitLabels.of(FitLabels.equipment, exercise.equipment))
                fact("Nivel", FitLabels.of(FitLabels.level, exercise.level))
                fact("Tipo", FitLabels.of(FitLabels.category, exercise.category))
                fact("Mecánica", FitLabels.of(FitLabels.mechanic, exercise.mechanic))
                fact("Patrón", FitLabels.of(FitLabels.force, exercise.force))
            }
            .padding(.top, 12)
            VStack(alignment: .leading, spacing: 0) {
                Text("Músculos").font(.fit(.base, .semibold))
                FitMuscleMap(primary: exercise.primary_muscles, secondary: exercise.secondary_muscles).padding(.top, 12)
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(Text("Primarios: ").foregroundStyle(FitColor.muted))\(exercise.primary_muscles.map(FitLabels.muscle).joined(separator: ", "))")
                    if !exercise.secondary_muscles.isEmpty {
                        Text("\(Text("Secundarios: ").foregroundStyle(FitColor.muted))\(exercise.secondary_muscles.map(FitLabels.muscle).joined(separator: ", "))")
                    }
                }
                .font(.fit(.sm))
                .padding(.top, 12)
            }
            .fitCard()
            .padding(.top, 20)
            Text(NativeExerciseInstructionsES.attribution)
                .font(.fit(.xs)).foregroundStyle(FitColor.muted).padding(.top, 16)
        }
        .fullScreenCover(item: Binding(get: { zoomed.map { ZoomedImage(index: $0) } }, set: { zoomed = $0?.index })) { item in
            NativeImageLightbox(path: exercise.images[item.index], label: "\(exercise.name): posición \(item.index == 0 ? "inicial" : "final")")
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.fit(.xxs)).tracking(0.3).foregroundStyle(FitColor.muted)
            Text(value).font(.fit(.sm, .medium))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FitColor.surface2, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}

private struct ZoomedImage: Identifiable { let index: Int; var id: Int { index } }

struct NativeImageLightbox: View {
    @Environment(\.dismiss) private var dismiss
    let path: String
    let label: String
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.clear.contentShape(Rectangle()).onTapGesture { dismiss() }
            if let image = FitImageCache.image(path) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(label)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.fit(.lg)).foregroundStyle(.white).fitMinimumHitArea().background(.white.opacity(0.1), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(12)
            .accessibilityLabel("Cerrar")
        }
        .presentationBackground(.black.opacity(0.85))
    }
}
