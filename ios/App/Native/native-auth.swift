import AuthenticationServices
import Combine
import CryptoKit
import Foundation
import Security
import UIKit

struct NativePendingWorkoutChanges: Equatable {
    var operations = 0
    var drafts = 0
    var total: Int { operations + drafts }
    var hasChanges: Bool { total > 0 }
}

@MainActor
final class NativeAuth: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var session: NativeAuthSession?
    @Published private(set) var ready = false
    @Published var error: String?
    @Published private(set) var signingIn = false
    /// Identity recovered from Keychain after an actual connectivity failure only.
    /// accessToken() still renews expired credentials before ANY remote request.
    @Published private(set) var localAccessOnly = false
    var unsyncedWorkoutCount: (() -> Int)?
    var pendingWorkoutChangesProvider: (() throws -> NativePendingWorkoutChanges)?
    var discardLocalWorkouts: (() throws -> Void)?
    private(set) var generation = UUID()
    /// Definitive local logout/rejection also invalidates unpublished account data.
    let localSessionInvalidations = PassthroughSubject<Void, Never>()
    private var browser: ASWebAuthenticationSession?
    private var refreshTask: Task<NativeAuthSession, Error>?
    private var restoringSession: NativeAuthSession?
    var canRetryRestore: Bool { (session == nil || localAccessOnly) && restoringSession != nil }
    var localWorkoutOwnerID: String? { session?.user.id ?? restoringSession?.user.id }
    private let service: String
    /// Keep fixture/custom credential stores from sharing a workout journal.
    var storageNamespace: String { SHA256.hash(data: Data(service.utf8)).map { String(format: "%02x", $0) }.joined() }
    private let network: URLSession
    init(service: String = "com.morguimateo.f1t.native-session", network: URLSession = .shared) {
        self.service = service; self.network = network; super.init()
    }
    func completeSignIn(_ value: NativeAuthSession) throws {
        var value = value; value.normalizeExpiry()
        try validateSession(value)
        try keychainSave(JSONEncoder().encode(value))
        refreshTask?.cancel(); refreshTask = nil
        restoringSession = nil
        generation = UUID(); localAccessOnly = false; session = value; ready = true; error = nil
    }
    static func logoutRequest(configuration: NativeConfiguration, token: String) -> URLRequest {
        var c = URLComponents(url: configuration.url.appendingPathComponent("auth/v1/logout"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "scope", value: "local")]
        var request = URLRequest(url: c.url!); request.httpMethod = "POST"; request.timeoutInterval = 15
        request.setValue(configuration.key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    static func challenge(_ verifier: String) -> String { Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func callbackCode(_ url: URL) throws -> String {
        try NativeOAuthCallback.code(from: url)
    }
    func exchangePKCECallback(_ callback: URL, verifier: String) async throws -> NativeAuthSession {
        let code = try Self.callbackCode(callback)
        return try await token(grant: "pkce", body: ["auth_code": code, "code_verifier": verifier])
    }

    func restore() async {
        guard session == nil || localAccessOnly else { ready = true; return }
        let attempt = generation
        defer { ready = true }
        do {
            try Task.checkCancellation()
            _ = try NativeConfiguration.load()
            guard let data = try keychainRead() else { return }
            let value = try JSONDecoder().decode(NativeAuthSession.self, from: data)
            try validateIdentity(value)
            guard let expiry = value.expires_at, expiry.isFinite, expiry > 0 else {
                throw NativeFailure.message("La sesión guardada no es válida. Iniciá sesión otra vez.")
            }
            restoringSession = value
            // Never rebase expiry. An expired identity is exposed only by the
            // connectivity-failure path, explicitly without remote authorization.
            if value.expiresAt.timeIntervalSinceNow > 60 {
                try validateSession(value)
                restoringSession = nil; localAccessOnly = false; session = value; error = nil
            } else {
                _ = try await refreshedSession(value)
            }
        } catch is CancellationError { }
        catch {
            guard attempt == generation else { return }
            if NativeFailure.isConnectivityFailure(error), let stored = restoringSession {
                localAccessOnly = true
                session = stored
                self.error = "Sin conexión. Podés seguir entrenando en este iPhone; la sincronización espera a renovar tu sesión."
            } else { self.error = NativeFailure.userMessage(error) }
        }
    }
    func signIn() async {
        guard !signingIn else { return }
        signingIn = true; error = nil
        let attempt = generation
        defer { signingIn = false; browser = nil }
        do {
            let config = try NativeConfiguration.load()
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NativeFailure.message("No se pudo crear un acceso seguro.") }
            let verifier = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            let authorizationURL = NativeOAuthRequest.authorizationURL(baseURL: config.url,
                redirectTo: "f1t://auth/callback", challenge: Self.challenge(verifier))
            let callback: URL = try await withCheckedThrowingContinuation { continuation in
                let flow = ASWebAuthenticationSession(url: authorizationURL, callbackURLScheme: "f1t") { url, failure in
                    if let url { continuation.resume(returning: url) }
                    else { continuation.resume(throwing: failure ?? NativeFailure.message("Se canceló el acceso.")) }
                }
                flow.presentationContextProvider = self
                browser = flow
                if !flow.start() { browser = nil; continuation.resume(throwing: NativeFailure.message("No se pudo abrir Google.")) }
            }
            guard attempt == generation else { throw CancellationError() }
            let newSession = try await exchangePKCECallback(callback, verifier: verifier)
            guard attempt == generation else { throw CancellationError() }
            try completeSignIn(newSession)
        } catch is CancellationError { }
        catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin { }
        catch {
            self.error = NativeFailure.isConnectivityFailure(error)
                ? "Sin conexión para iniciar sesión. Reintentá cuando tengas conexión."
                : error.localizedDescription
        }
    }
    func accessToken() async throws -> String {
        try Task.checkCancellation()
        guard let session else { throw NativeFailure.message("Iniciá sesión para continuar.") }
        if !localAccessOnly, session.expiresAt.timeIntervalSinceNow > 60 { return session.access_token }
        return try await refreshedSession(session).access_token
    }
    private func refreshedSession(_ source: NativeAuthSession) async throws -> NativeAuthSession {
        let attempt = generation
        let task: Task<NativeAuthSession, Error>
        if let refreshTask { task = refreshTask }
        else {
            // All waiters share the validated, persisted result, not just the raw response.
            task = Task {
                defer { if attempt == self.generation { self.refreshTask = nil } }
                do {
                    try Task.checkCancellation()
                    var value = try await self.token(grant: "refresh_token", body: ["refresh_token": source.refresh_token])
                    try Task.checkCancellation()
                    guard attempt == self.generation else { throw CancellationError() }
                    guard value.user.id == source.user.id else { throw NativeFailure.http(401, "invalid_session") }
                    value.normalizeExpiry()
                    try self.validateSession(value)
                    try self.keychainSave(JSONEncoder().encode(value))
                    self.restoringSession = nil; self.localAccessOnly = false
                    self.session = value; self.error = nil
                    return value
                } catch NativeFailure.http(let status, _) where status == 400 || status == 401 {
                    guard attempt == self.generation else { throw CancellationError() }
                    self.generation = UUID(); self.refreshTask = nil; self.restoringSession = nil; self.localAccessOnly = false
                    self.localSessionInvalidations.send(); self.session = nil
                    self.error = "Tu sesión venció. Iniciá sesión otra vez."
                    do { try self.keychainDelete() }
                    catch {
                        self.error = "No se pudo eliminar la sesión del llavero. Reintentá cerrar sesión antes de compartir el dispositivo."
                        throw error
                    }
                    throw NativeFailure.message("Tu sesión venció. Iniciá sesión otra vez.")
                } catch {
                    if attempt == self.generation, NativeFailure.isConnectivityFailure(error) {
                        // This is local identity, not renewed remote authorization.
                        self.localAccessOnly = true; self.restoringSession = source
                        self.error = "Sin conexión. Tu entrenamiento se guarda en este iPhone; renovaremos la sesión al reconectar."
                    }
                    throw error
                }
            }
            refreshTask = task
        }
        let value = try await task.value
        try Task.checkCancellation()
        guard attempt == generation, session?.user.id == source.user.id else { throw CancellationError() }
        return value
    }
    private func validateIdentity(_ value: NativeAuthSession) throws {
        guard !value.user.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !value.access_token.isEmpty, !value.refresh_token.isEmpty else {
            throw NativeFailure.message("La sesión guardada no es válida. Iniciá sesión otra vez.")
        }
    }
    private func validateSession(_ value: NativeAuthSession) throws {
        try validateIdentity(value)
        guard let expiry = value.expires_at, expiry.isFinite, value.expiresAt.timeIntervalSinceNow > 0 else {
            throw NativeFailure.message("Tu sesión venció. Iniciá sesión otra vez.")
        }
    }
    /// Read immediately before presenting logout choices; drafts are not queued writes.
    /// A failed read is an error, never a misleading zero-pending count.
    func pendingWorkoutChanges() throws -> NativePendingWorkoutChanges {
        if let pendingWorkoutChangesProvider { return try pendingWorkoutChangesProvider() }
        let count = unsyncedWorkoutCount?() ?? 0
        guard count != Int.max else {
            throw NativeFailure.message("No se pudo revisar el progreso local pendiente. Desbloqueá el iPhone y reintentá antes de cerrar sesión.")
        }
        return NativePendingWorkoutChanges(operations: count)
    }

    func signOut(discardUnsyncedWorkouts: Bool = false, expectedGeneration: UUID? = nil) async {
        // A confirmation shown for a previous login must never discard the next one's journal.
        guard expectedGeneration == nil || expectedGeneration == generation else { return }
        error = nil
        if !discardUnsyncedWorkouts {
            do {
                let pending = try pendingWorkoutChanges()
                guard !pending.hasChanges else {
                    error = "Tenés \(pending.operations) cambios pendientes de sincronizar y \(pending.drafts) borradores sin registrar. Sincronizá los cambios y revisá los borradores, o elegí descartar el progreso local antes de cerrar sesión."
                    return
                }
            } catch {
                self.error = "No se pudo revisar el progreso local pendiente. Desbloqueá el iPhone y reintentá antes de cerrar sesión."
                return
            }
        }
        do { try discardLocalWorkouts?() }
        catch { self.error = "No se pudo borrar el progreso local. Reintentá cerrar sesión antes de compartir el dispositivo."; return }
        let old = session?.access_token ?? restoringSession?.access_token
        generation = UUID(); browser?.cancel(); browser = nil; refreshTask?.cancel(); refreshTask = nil
        restoringSession = nil; localAccessOnly = false
        localSessionInvalidations.send()
        session = nil
        let outgoingGeneration = generation
        do { try keychainDelete() } catch { self.error = "No se pudo eliminar la sesión del llavero. Reintentá cerrar sesión antes de compartir el dispositivo." }
        if let old {
            do {
                let config = try NativeConfiguration.load()
                let request = Self.logoutRequest(configuration: config, token: old)
                let (data, response) = try await network.data(for: request); try NativeAPI.validate(data, response)
            } catch {
                // A delayed outgoing request must not overwrite a replacement login's state.
                guard generation == outgoingGeneration else { return }
                let warning = "Sesión local cerrada. No se pudo revocar la sesión remota; reintentá cuando haya conexión."
                self.error = [self.error, warning].compactMap { $0 }.joined(separator: "\n")
            }
        }
    }
    private func token(grant: String, body: [String: Any]) async throws -> NativeAuthSession {
        let config = try NativeConfiguration.load()
        let request = try NativeOAuthRequest.tokenRequest(baseURL: config.url, publicKey: config.key, grant: grant, body: body)
        let (data, response) = try await network.data(for: request); try NativeAPI.validate(data, response)
        return try JSONDecoder().decode(NativeAuthSession.self, from: data)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
    private var keychainQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "session"] }
    func keychainRead() throws -> Data? {
        var query = keychainQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw NativeFailure.message("No se pudo leer el llavero seguro.") }
        return item as? Data
    }
    func keychainSave(_ data: Data) throws {
        let attrs: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(keychainQuery as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(keychainQuery.merging(attrs) { _, new in new } as CFDictionary, nil) }
        guard status == errSecSuccess else { throw NativeFailure.message("No se pudo guardar la sesión en el llavero.") }
    }
    func keychainDelete() throws {
        let status = SecItemDelete(keychainQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeFailure.message("No se pudo borrar la sesión del llavero.") }
    }
}
