import SwiftUI
import UIKit

// Design tokens copied from the web client (src/index.css), so the native app keeps its look.
enum FitColor {
    static let ground = dynamic(0xF6F6F8, 0x0C0D10)
    static let surface = dynamic(0xFFFFFF, 0x15171C)
    static let surface2 = dynamic(0xEDEEF2, 0x1D2027)
    static let line = dynamic(0xDFE1E7, 0x262A33)
    static let lineStrong = dynamic(0xC6C9D2, 0x39404D)
    // Inputs need a stronger boundary than decorative card separators.
    static let controlLine = dynamic(0x818896, 0x6F7787)
    static let ink = dynamic(0x14161B, 0xEFF0F3)
    static let ink2 = dynamic(0x3D424D, 0xC4C8D0)
    // Body-size secondary text must remain readable on surface2 as well as surface.
    static let muted = dynamic(0x626978, 0xA0A6B3)
    static let accent = dynamic(0xD93A12, 0xFF5A32)
    // Text-only accent: the filled-action colour is intentionally unchanged.
    static let accentText = dynamic(0xBA300E, 0xFF7957)
    static let accentInk = dynamic(0xFFFFFF, 0x16110E)
    static let ok = dynamic(0x157A4E, 0x34C77B)
    static let warn = dynamic(0x8A5C08, 0xE0A93B)

    static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }
}

// Tailwind's type scale in points (1 CSS px == 1 pt in the old web view).
enum FitSize {
    case micro, tiny, xxs, xs, sm, base, lg, xl2, xl3, xl5
    var points: CGFloat {
        switch self {
        case .micro: 8; case .tiny: 10; case .xxs: 11; case .xs: 12; case .sm: 14
        case .base: 16; case .lg: 18; case .xl2: 24; case .xl3: 30; case .xl5: 48
        }
    }
    /// Unscaled minimum only; never use this as a fixed height for text or controls.
    var lineHeight: CGFloat {
        switch self {
        case .micro, .tiny, .xxs: points * 1.25
        case .xs: 16; case .sm: 20; case .base: 24; case .lg: 28; case .xl2: 32; case .xl3: 36; case .xl5: 48
        }
    }
    var style: Font.TextStyle {
        switch self {
        case .micro, .tiny, .xxs: .caption2
        case .xs: .caption; case .sm: .subheadline; case .base: .body; case .lg: .headline
        case .xl2: .title2; case .xl3: .title; case .xl5: .largeTitle
        }
    }
}

extension Font {
    /// Archivo is bundled under Fonts/ (OFL); a missing face falls back to the system font.
    static func fit(_ size: FitSize, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .medium: name = "Archivo-Medium"
        case .semibold: name = "Archivo-SemiBold"
        case .bold, .heavy, .black: name = "Archivo-Bold"
        default: name = "Archivo-Regular"
        }
        return .custom(name, size: size.points, relativeTo: size.style)
    }
}

// MARK: - Surfaces

struct FitCardModifier: ViewModifier {
    var padding: CGFloat
    var dashed: Bool
    var fill: Color
    var alignment: Alignment
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: alignment)
            .background(fill, in: RoundedRectangle(cornerRadius: 12))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(dashed ? FitColor.lineStrong : FitColor.line, style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : [])))
    }
}

extension View {
    func fitCard(padding: CGFloat = 16, dashed: Bool = false, fill: Color = FitColor.surface, alignment: Alignment = .leading) -> some View {
        modifier(FitCardModifier(padding: padding, dashed: dashed, fill: fill, alignment: alignment))
    }
    /// The web's `text-sm font-medium text-accent` links.
    func fitLink(_ size: FitSize = .sm) -> some View {
        font(.fit(size, .medium))
            .foregroundStyle(FitColor.accentText)
            .buttonStyle(FitLinkButtonStyle())
            .fitMinimumHitArea()
    }
    func fitField(fill: Color = FitColor.surface, radius: CGFloat = 12, horizontal: CGFloat = 16, vertical: CGFloat = 12, size: FitSize = .sm, centered: Bool = false) -> some View {
        font(.fit(size))
            .multilineTextAlignment(centered ? .center : .leading)
            .frame(minHeight: size.lineHeight)
            .padding(.horizontal, horizontal)
            .padding(.vertical, vertical)
            .frame(minWidth: FitControl.minimumHitSize, minHeight: FitControl.minimumHitSize)
            .background(fill, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(FitColor.controlLine))
    }

    /// Apply inside a plain button's label so the complete target receives taps.
    /// A minimum, not a fixed frame: Dynamic Type content can grow freely.
    func fitMinimumHitArea(minimumHeight: CGFloat = FitControl.minimumHitSize) -> some View {
        frame(minWidth: FitControl.minimumHitSize, minHeight: max(FitControl.minimumHitSize, minimumHeight))
            .contentShape(Rectangle())
    }

    /// Exposes one loading element, not a collection of decorative placeholders.
    func fitLoadingAccessibility(_ label: String = "Cargando…") -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(label))
            .accessibilityValue("En curso")
    }

    /// Keeps numeric entry consistent without filtering drafts or changing stored values.
    func fitNumericInput(allowsDecimal: Bool = true) -> some View {
        keyboardType(allowsDecimal ? .decimalPad : .numberPad)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .monospacedDigit()
            .submitLabel(.done)
    }

    /// Install once on the enclosing form/page; the action clears its own FocusState.
    /// Number pads have no Return key. Avoid installing one toolbar per field.
    func fitKeyboardDone(_ action: @escaping () -> Void) -> some View {
        toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Listo", action: action)
                    .buttonStyle(FitButtonStyle(size: .sm))
                    .accessibilityLabel("Terminar de editar")
            }
        }
    }
}

func fitPrompt(_ text: String) -> Text { Text(text).foregroundStyle(FitColor.muted) }

// MARK: - Buttons

enum FitButtonVariant { case primary, quiet, quietMuted, subtle, danger }
enum FitButtonSize { case md, sm, gym }

enum FitControl {
    static let minimumHitSize: CGFloat = 44
    static let gymActionHeight: CGFloat = 56
}

struct FitButtonStyle: ButtonStyle {
    var variant: FitButtonVariant = .quiet
    var size: FitButtonSize = .md
    var fullWidth = false
    /// Gym actions accept 52–56 pt; all sizes are minimums and can grow with text.
    var minimumHeight: CGFloat?
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let radius: CGFloat = size == .sm ? 8 : 12
        let text: FitSize = size == .gym ? .base : (size == .md ? .sm : .xs)
        configuration.label
            .font(.fit(text, .medium))
            .lineLimit(nil)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: text.lineHeight)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.horizontal, size == .sm ? 12 : 16)
            .padding(.vertical, size == .sm ? 6 : 12)
            // Compact buttons keep their smaller visible background; only their target grows.
            .frame(minHeight: size == .sm ? nil : targetHeight)
            .foregroundStyle(foreground)
            .background(background(configuration.isPressed), in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(variant == .primary ? FitColor.accent : FitColor.line))
            .opacity(isEnabled ? (variant == .primary && configuration.isPressed ? 0.9 : 1) : 0.5)
            .fitMinimumHitArea(minimumHeight: targetHeight)
    }
    private var targetHeight: CGFloat {
        if size == .gym { return min(56, max(52, minimumHeight ?? FitControl.gymActionHeight)) }
        return max(FitControl.minimumHitSize, minimumHeight ?? FitControl.minimumHitSize)
    }
    private var foreground: Color {
        switch variant {
        case .primary: FitColor.accentInk
        case .quiet, .subtle: FitColor.ink
        case .quietMuted: FitColor.muted
        // Not the accent: it's already red and would make deleting look as inviting as the primary action.
        case .danger: FitColor.warn
        }
    }
    private func background(_ pressed: Bool) -> Color {
        switch variant {
        case .primary: FitColor.accent
        case .subtle: pressed ? FitColor.surface : FitColor.surface2
        default: pressed ? FitColor.surface2 : FitColor.surface
        }
    }
}

/// Plain rows that darken like the web's `hover:bg-surface-2` while pressed.
struct FitRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fitMinimumHitArea()
            .background(configuration.isPressed ? FitColor.surface2 : Color.clear)
    }
}

private struct FitLinkButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fixedSize(horizontal: false, vertical: true)
            .fitMinimumHitArea()
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.5)
    }
}

/// Confirmation has no time limit and provides an explicit cancellation action.
struct FitConfirmButton: View {
    let label: String
    var confirmLabel = "¿Seguro?"
    var size: FitButtonSize = .md
    let action: () -> Void
    @State private var confirming = false
    var body: some View {
        Button(label) { confirming = true }
        .buttonStyle(FitButtonStyle(variant: .danger, size: size))
        .confirmationDialog(confirmLabel, isPresented: $confirming, titleVisibility: .visible) {
            Button(label, role: .destructive, action: action)
            Button("Cancelar", role: .cancel) { }
        }
        .accessibilityHint("Solicita confirmación antes de continuar")
    }
}

struct FitChip: View {
    let label: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.fit(.xs, .medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundStyle(active ? FitColor.accentInk : FitColor.muted)
                .background(active ? FitColor.accent : FitColor.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(active ? FitColor.accent : FitColor.line))
                .fitMinimumHitArea()
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

struct FitPill: View {
    var text = "Activa"
    var body: some View {
        Text(text)
            .font(.fit(.xxs, .medium))
            .foregroundStyle(FitColor.accentInk)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(FitColor.accent, in: Capsule())
    }
}

// MARK: - Page chrome

struct FitPageHeader<Action: View>: View {
    let title: String
    var subtitle: String?
    var showsBack = false
    @ViewBuilder var action: () -> Action
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsBack {
                Button { dismiss() } label: {
                    FitGlyph(kind: .back, size: 20)
                        .fitMinimumHitArea()
                }
                .buttonStyle(.plain)
                .foregroundStyle(FitColor.muted)
                .padding(.leading, -8)
                .padding(.bottom, 8)
                .accessibilityLabel("Volver")
            }
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
            layout {
                headings.frame(maxWidth: .infinity, alignment: .leading)
                action()
            }
        }
        .padding(.top, 24)
        .padding(.bottom, 20)
    }

    private var headings: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.fit(.xl2, .bold)).tracking(-0.6).accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(.fit(.sm)).foregroundStyle(FitColor.muted) }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

extension FitPageHeader where Action == EmptyView {
    init(title: String, subtitle: String? = nil, showsBack: Bool = false) {
        self.init(title: title, subtitle: subtitle, showsBack: showsBack) { EmptyView() }
    }
}

/// The web layout: one centred column, 16 pt gutters, max 512 pt wide, over the ground colour.
struct FitPage<Content: View>: View {
    @EnvironmentObject private var store: NativeStore
    var refreshable = true
    @ViewBuilder let content: () -> Content

    var body: some View {
        let scroll = ScrollView {
            VStack(alignment: .leading, spacing: 0) { content() }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
                .frame(maxWidth: 512)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(FitColor.ground.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        if refreshable { scroll.refreshable { await store.refresh() } } else { scroll }
    }
}

struct FitEmptyState<Action: View>: View {
    let title: String
    let description: String
    @ViewBuilder var action: () -> Action
    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(.fit(.base, .semibold)).multilineTextAlignment(.center)
            Text(description).font(.fit(.sm)).foregroundStyle(FitColor.muted).multilineTextAlignment(.center).frame(maxWidth: 280)
            action()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 48)
        .frame(maxWidth: .infinity)
        .background(FitColor.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(FitColor.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

extension FitEmptyState where Action == EmptyView {
    init(title: String, description: String) { self.init(title: title, description: description) { EmptyView() } }
}

struct FitErrorNote: View {
    var title = "No se pudo completar la operación"
    let message: String
    var guidance: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.fit(.sm, .semibold)).foregroundStyle(FitColor.warn)
                .accessibilityAddTraits(.isHeader)
            Text(guidance ?? FitErrorCopy.guidance(message: message))
                .font(.fit(.sm)).foregroundStyle(FitColor.ink2)
                .fixedSize(horizontal: false, vertical: true)
            if guidance != nil || FitErrorCopy.guidance(message: message) != message {
                DisclosureGroup("Más información") {
                    Text(message).font(.fit(.sm)).foregroundStyle(FitColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(.top, 4)
                }
                .font(.fit(.sm))
                .tint(FitColor.accentText)
                .frame(minHeight: FitControl.minimumHitSize, alignment: .leading)
            }
        }
        .fitCard()
        .accessibilityElement(children: .contain)
    }
}

/// Do not equate a local-copy failure with a rejected server write.
enum FitErrorCopy {
    static func guidance(message: String) -> String {
        // Existing callers also provide actionable Spanish validation/recovery copy;
        // do not hide that behind a disclosure intended for diagnostics.
        let diagnosticMarkers = ["HTTP ", "Error Domain=", "NSURLError", "PGRST", "SQLSTATE", "PostgREST", "npm run "]
        if message.hasPrefix("El cambio se guardó en el servidor") || diagnosticMarkers.contains(where: message.contains) {
            return savedState(message: message)
        }
        return message
    }
    static func savedState(message: String) -> String {
        if message.hasPrefix("El cambio se guardó en el servidor") {
            return "El cambio está guardado en tu cuenta, pero la copia de este iPhone puede estar desactualizada. Actualizá los datos; no vuelvas a registrar el cambio."
        }
        return "No se pudo confirmar el resultado de esta operación. Revisá el estado de tus datos antes de volver a intentarla."
    }
}

struct FitSkeleton: View {
    var height: CGFloat = 12
    var width: CGFloat?
    var radius: CGFloat = 6
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if reduceMotion || scenePhase != .active {
                placeholder
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                    // No repeating state animation to outlive the view or preference change.
                    placeholder.opacity(0.825 + 0.175 * cos(context.date.timeIntervalSinceReferenceDate * .pi))
                }
            }
        }
        .accessibilityHidden(true)
    }
    private var placeholder: some View {
        RoundedRectangle(cornerRadius: radius)
            .fill(FitColor.surface2)
            .frame(width: width, height: height)
    }
}

/// The shape every tab shares while the first load is pending.
struct FitCardsSkeleton: View {
    var count = 3
    var body: some View {
        VStack(spacing: 8) {
            ForEach(0..<max(0, count), id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    FitSkeleton(height: 12, width: 160)
                    FitSkeleton(height: 10, width: 96)
                }
                .fitCard()
            }
        }
        .fitLoadingAccessibility()
    }
}

/// A web-styled date field that opens the graphical calendar in a popover.
struct FitDateField: View {
    @Binding var date: Date?
    var range: ClosedRange<Date>
    var fill: Color = FitColor.surface
    var label = "Fecha"
    var placeholder = "Elegir fecha"
    /// Where the calendar opens while there is no date yet.
    var initial: Date?
    var components: DatePickerComponents = .date
    @State private var open = false

    var body: some View {
        let text = date.map { components == .date ? FitFormat.fieldDay($0) : FitFormat.time($0) }
        Button { open = true } label: {
            Text(text ?? placeholder)
                .monospacedDigit()
                .foregroundStyle(text == nil ? FitColor.muted : FitColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fitField(fill: fill)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label): \(text ?? placeholder)")
        .popover(isPresented: $open) {
            DatePicker(label, selection: Binding(get: { date ?? initial ?? min(Date(), range.upperBound) }, set: { date = $0 }), in: range, displayedComponents: components)
                .modifier(FitPickerStyle(graphical: components == .date))
                .labelsHidden()
                .tint(FitColor.accent)
                .environment(\.locale, FitFormat.locale)
                .padding()
                .frame(minWidth: components == .date ? 320 : 240)
                .presentationCompactAdaptation(.popover)
                .onChange(of: date) { _, _ in if components == .date { open = false } }
        }
    }
}

extension FitDateField {
    init(date: Binding<Date>, range: ClosedRange<Date>, fill: Color = FitColor.surface, label: String = "Fecha", components: DatePickerComponents = .date) {
        self.init(date: Binding<Date?>(get: { date.wrappedValue }, set: { if let value = $0 { date.wrappedValue = value } }), range: range, fill: fill, label: label, components: components)
    }
}

private struct FitPickerStyle: ViewModifier {
    let graphical: Bool
    func body(content: Content) -> some View {
        if graphical { content.datePickerStyle(.graphical) } else { content.datePickerStyle(.wheel) }
    }
}

// MARK: - Icons

enum FitGlyphKind { case today, routines, foods, progress, profile, back }

/// The web's 24×24 stroke icons (nav-icons.tsx), drawn natively.
struct FitGlyphShape: Shape {
    let kind: FitGlyphKind
    func path(in rect: CGRect) -> Path {
        var p = Path()
        func line(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) { p.move(to: CGPoint(x: x1, y: y1)); p.addLine(to: CGPoint(x: x2, y: y2)) }
        switch kind {
        case .today:
            line(7, 6.5, 7, 17.5); line(17, 6.5, 17, 17.5); line(3.75, 9.5, 3.75, 14.5); line(20.25, 9.5, 20.25, 14.5); line(7, 12, 17, 12)
        case .routines:
            for y in [6.5, 12, 17.5] as [CGFloat] { line(4, y, 7, y); line(10.5, y, 20, y) }
        case .foods:
            p.move(to: CGPoint(x: 4, y: 3)); p.addLine(to: CGPoint(x: 4, y: 7))
            p.addArc(center: CGPoint(x: 7, y: 7), radius: 3, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
            p.addLine(to: CGPoint(x: 10, y: 3)); line(7, 3, 7, 21)
            p.move(to: CGPoint(x: 17, y: 3))
            p.addQuadCurve(to: CGPoint(x: 14, y: 11), control: CGPoint(x: 14, y: 7))
            p.addLine(to: CGPoint(x: 18, y: 11)); line(18, 3, 18, 21)
        case .progress:
            for (x, y) in [(3.5, 4), (10, 4), (16.5, 4), (3.5, 10), (10, 10), (3.5, 16), (10, 16), (16.5, 10)] as [(CGFloat, CGFloat)] {
                p.addRoundedRect(in: CGRect(x: x, y: y, width: 4, height: 4), cornerSize: CGSize(width: 1, height: 1))
            }
        case .profile:
            p.addEllipse(in: CGRect(x: 8.5, y: 5, width: 7, height: 7))
            p.move(to: CGPoint(x: 5, y: 20))
            p.addCurve(to: CGPoint(x: 12, y: 14.5), control1: CGPoint(x: 5, y: 16.6), control2: CGPoint(x: 8.1, y: 14.5))
            p.addCurve(to: CGPoint(x: 19, y: 20), control1: CGPoint(x: 15.9, y: 14.5), control2: CGPoint(x: 19, y: 16.6))
        case .back:
            p.move(to: CGPoint(x: 15, y: 5)); p.addLine(to: CGPoint(x: 8, y: 12)); p.addLine(to: CGPoint(x: 15, y: 19))
        }
        let scale = min(rect.width, rect.height) / 24
        return p.applying(CGAffineTransform(scaleX: scale, y: scale).translatedBy(x: rect.minX / scale, y: rect.minY / scale))
    }
}

struct FitGlyph: View {
    let kind: FitGlyphKind
    var size: CGFloat = 24
    var body: some View {
        FitGlyphShape(kind: kind)
            .stroke(style: StrokeStyle(lineWidth: 1.75 * size / 24, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: - Tabs

enum FitTab: Hashable, CaseIterable {
    case today, routines, foods, progress, profile
    var label: String {
        switch self { case .today: "Hoy"; case .routines: "Rutinas"; case .foods: "Comidas"; case .progress: "Progreso"; case .profile: "Perfil" }
    }
    var glyph: FitGlyphKind {
        switch self { case .today: .today; case .routines: .routines; case .foods: .foods; case .progress: .progress; case .profile: .profile }
    }
}

/// Lets a page jump to another tab, like the web's links between sections.
struct FitTabSelect: Equatable {
    var action: (FitTab) -> Void = { _ in }
    func callAsFunction(_ tab: FitTab) { action(tab) }
    // The container installs one stable action, so there is nothing to diff.
    static func == (lhs: Self, rhs: Self) -> Bool { true }
}

extension EnvironmentValues {
    @Entry var fitSelectTab = FitTabSelect()
    @Entry var fitTabRootRequest: UUID?
}

/// The shell requests navigation, never destroys a page's identity or drafts.
enum FitTabRootPolicy {
    static func canReturn(ownDraft: Bool, descendantDraft: Bool) -> Bool {
        !ownDraft && !descendantDraft
    }
}

private struct FitNavigationDraftKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = value || nextValue()
    }
}

private struct FitTabRootModifier: ViewModifier {
    @Environment(\.fitTabRootRequest) private var request
    @State private var descendantDraft = false
    let ownDraft: Bool
    let returnToRoot: () -> Void
    func body(content: Content) -> some View {
        content
            .onPreferenceChange(FitNavigationDraftKey.self) { descendantDraft = $0 }
            .onChange(of: request) { _, value in
                guard value != nil else { return }
                guard FitTabRootPolicy.canReturn(ownDraft: ownDraft, descendantDraft: descendantDraft) else {
                    UIAccessibility.post(notification: .announcement, argument: "Hay cambios sin guardar. Guardalos o cancelá la edición antes de volver al inicio.")
                    return
                }
                returnToRoot()
            }
    }
}

extension View {
    /// Apply to each tab's NavigationStack and clear its path/item in the action.
    /// Mark descendant forms with fitNavigationDraft while edited or saving.
    func fitTabRoot(isDirty: Bool = false, returnToRoot: @escaping () -> Void) -> some View {
        modifier(FitTabRootModifier(ownDraft: isDirty, returnToRoot: returnToRoot))
    }
    func fitNavigationDraft(_ isDirty: Bool) -> some View {
        // An enclosing clean screen must not overwrite a dirty child editor.
        transformPreference(FitNavigationDraftKey.self) { value in value = value || isDirty }
    }
}

struct FitBottomNav: View {
    let selection: FitTab
    let select: (FitTab) -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: dynamicTypeSize.isAccessibilitySize ? 3 : 5), spacing: 0) {
            ForEach(FitTab.allCases, id: \.self) { tab in
                let active = tab == selection
                Button { select(tab) } label: {
                    VStack(spacing: 4) {
                        FitGlyph(kind: tab.glyph).opacity(active ? 1 : 0.9)
                        Text(tab.label).font(.fit(.xxs, .medium)).tracking(0.275)
                            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(active ? FitColor.accentText : FitColor.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .fitMinimumHitArea()
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
            }
        }
        .frame(maxWidth: 512)
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                if !reduceTransparency { Rectangle().fill(.ultraThinMaterial) }
                FitColor.surface.opacity(reduceTransparency ? 1 : 0.95)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) { Rectangle().fill(FitColor.line).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Navegación principal")
    }
}

// The custom header hides the navigation bar, which would also disable the back swipe.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }
    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}

/// Wraps children onto new lines, like the web's `flex flex-wrap gap-2`.
struct FitFlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? width, height: height)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = itemSize(subviews[index], width: bounds.width)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }
    private func arrange(_ subviews: Subviews, width: CGFloat) -> [(indices: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(indices: [Int], width: CGFloat, height: CGFloat)] = []
        var current: [Int] = [], x: CGFloat = 0, height: CGFloat = 0
        for index in subviews.indices {
            let size = itemSize(subviews[index], width: width)
            if !current.isEmpty, x + spacing + size.width > width {
                rows.append((current, x, height)); current = []; x = 0; height = 0
            }
            x += (current.isEmpty ? 0 : spacing) + size.width
            height = max(height, size.height)
            current.append(index)
        }
        if !current.isEmpty { rows.append((current, x, height)) }
        return rows
    }
    private func itemSize(_ subview: LayoutSubview, width: CGFloat) -> CGSize {
        let ideal = subview.sizeThatFits(.unspecified)
        guard width.isFinite, ideal.width > width else { return ideal }
        // Wrapping onto a new row is not enough when one scaled label is wider
        // than the entire page. Propose the available width so its text can wrap.
        return subview.sizeThatFits(ProposedViewSize(width: max(0, width), height: nil))
    }
}
