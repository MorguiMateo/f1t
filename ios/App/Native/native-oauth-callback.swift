import Foundation

enum NativeCallbackFragment: String {
    case absent = "ausente", empty = "vacío", providerError = "error", code = "código"
    case tokens = "tokens", other = "otro", malformed = "formato"
}
struct NativeCallbackShape: Equatable {
    let schemeMatches, hostMatches, pathMatches: Bool
    let codeCount: Int
    let fragment: NativeCallbackFragment
    var summary: String {
        // Only fixed categories/booleans and a bounded count; never echo callback data.
        "s=\(schemeMatches ? 1 : 0),h=\(hostMatches ? 1 : 0),p=\(pathMatches ? 1 : 0),c=\(min(codeCount, 99)),f=\(fragment.rawValue)"
    }
}
enum NativeCallbackReason: String {
    case route, format, missingCode, emptyCode, duplicateCode, conflictingErrors, forbiddenFragment, tokens
    case accessDenied, signupDisabled, userBanned, providerUnavailable, providerError
    var message: String {
        switch self {
        case .route: return "El acceso volvió a una dirección distinta de la esperada."
        case .format: return "El formato del retorno de Google no es válido."
        case .missingCode: return "El retorno de Google no incluye el código de acceso PKCE."
        case .emptyCode: return "El código de acceso recibido está vacío."
        case .duplicateCode: return "El retorno contiene códigos de acceso repetidos o contradictorios."
        case .conflictingErrors: return "El retorno de autenticación contiene errores contradictorios."
        case .forbiddenFragment: return "El retorno contiene un fragmento no permitido para PKCE."
        case .tokens: return "El retorno contiene tokens y no corresponde al acceso PKCE esperado."
        case .accessDenied: return "El proveedor rechazó o canceló el acceso."
        case .signupDisabled: return "El servicio de autenticación informa que no permite nuevas cuentas."
        case .userBanned: return "El servicio de autenticación informa que esta cuenta está bloqueada."
        case .providerUnavailable: return "El servicio de autenticación no pudo completar el acceso."
        case .providerError: return "Google o el servicio de autenticación devolvió un error."
        }
    }
}
struct NativeCallbackFailure: LocalizedError, Equatable {
    let reason: NativeCallbackReason
    let shape: NativeCallbackShape
    var errorDescription: String? {
        "\(reason.message) Reiniciá el acceso. Diagnóstico seguro: \(reason.rawValue) [\(shape.summary)]. No compartas la URL de retorno."
    }
}

enum NativeOAuthCallback {
    private static let errorFields: Set<String> = ["error", "error_code", "error_description"]
    private static let tokenFields: Set<String> = ["access_token", "refresh_token", "provider_token", "provider_refresh_token", "id_token", "token", "token_type", "code_verifier", "code_challenge", "expires_in", "expires_at"]
    // Form decoding matches Supabase, but preserves duplicates instead of silently overwriting them.
    private static func pairs(_ encoded: String?) -> [URLQueryItem]? {
        guard let encoded, !encoded.isEmpty else { return [] }
        var result: [URLQueryItem] = []
        for pair in encoded.split(separator: "&", omittingEmptySubsequences: false) {
            guard !pair.isEmpty else { return nil }
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let name = String(parts[0]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
                  !name.isEmpty else { return nil }
            let rawValue = parts.count == 2 ? String(parts[1]) : ""
            guard let value = rawValue.replacingOccurrences(of: "+", with: " ").removingPercentEncoding else { return nil }
            result.append(URLQueryItem(name: name, value: value))
        }
        return result
    }
    static func code(from url: URL) throws -> String {
        let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = pairs(c?.percentEncodedQuery), fragmentItems = pairs(c?.percentEncodedFragment)
        let all = (query ?? []) + (fragmentItems ?? [])
        let hasTokens = all.contains { tokenFields.contains($0.name.lowercased()) }
        let fragment: NativeCallbackFragment
        if c?.percentEncodedFragment == nil { fragment = .absent }
        else if c?.percentEncodedFragment == "" { fragment = .empty }
        else if fragmentItems == nil { fragment = .malformed }
        else if fragmentItems!.contains(where: { tokenFields.contains($0.name.lowercased()) }) { fragment = .tokens }
        else if fragmentItems!.contains(where: { $0.name.lowercased() == "code" }) { fragment = .code }
        else if fragmentItems!.contains(where: { errorFields.contains($0.name) }) { fragment = .providerError }
        else { fragment = .other }
        let shape = NativeCallbackShape(schemeMatches: c?.scheme == "f1t", hostMatches: c?.host == "auth",
            pathMatches: c?.percentEncodedPath == "/callback", codeCount: all.filter { $0.name.lowercased() == "code" }.count, fragment: fragment)
        func reject(_ reason: NativeCallbackReason) throws -> Never { throw NativeCallbackFailure(reason: reason, shape: shape) }
        // Exact route includes raw path spelling: no encoded separators, credentials, port or opaque URL.
        guard let c, shape.schemeMatches, shape.hostMatches, shape.pathMatches,
              c.user == nil, c.password == nil, c.port == nil else { try reject(.route) }
        guard url.absoluteString.utf8.count <= 16384, let query, let fragmentItems else { try reject(.format) }
        if hasTokens { try reject(.tokens) }
        if shape.codeCount > 1 { try reject(.duplicateCode) }
        if fragment == .code { try reject(.forbiddenFragment) }
        let providerErrors = all.filter { errorFields.contains($0.name) }
        if !providerErrors.isEmpty {
            // Auth mirrors errors in query and fragment. Equal mirrors are safe feedback, never a login.
            guard fragmentItems.allSatisfy({ errorFields.contains($0.name) || ($0.name == "sb" && $0.value == "") }) else { try reject(.forbiddenFragment) }
            for key in errorFields {
                let q = query.filter { $0.name == key }, f = fragmentItems.filter { $0.name == key }
                guard q.count <= 1, f.count <= 1 else { try reject(.conflictingErrors) }
                // Descriptions are ignored. Go's Fragment setter can encode their percent escapes
                // again, so mirrored descriptions need not have the same decoded representation.
                if key != "error_description", let a = q.first?.value, let b = f.first?.value, a != b { try reject(.conflictingErrors) }
            }
            if shape.codeCount != 0 { try reject(.conflictingErrors) }
            // Only recognized fixed codes select a local message. Never display descriptions/unknown codes.
            let codes = providerErrors.filter { $0.name != "error_description" }.compactMap(\.value)
            if codes.contains("signup_disabled") { try reject(.signupDisabled) }
            if codes.contains("user_banned") { try reject(.userBanned) }
            if codes.contains("access_denied") { try reject(.accessDenied) }
            if codes.contains(where: { ["server_error", "temporarily_unavailable", "unexpected_failure"].contains($0) }) { try reject(.providerUnavailable) }
            try reject(.providerError)
        }
        // A harmless terminal '#' carries no parameters; all nonempty success fragments remain forbidden.
        guard fragment == .absent || fragment == .empty else { try reject(.forbiddenFragment) }
        if query.contains(where: { $0.name.lowercased() == "code" && $0.name != "code" }) { try reject(.format) }
        guard let code = query.first(where: { $0.name == "code" })?.value else { try reject(.missingCode) }
        guard !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { try reject(.emptyCode) }
        guard code.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil else { try reject(.format) }
        return code
    }
}

enum NativeOAuthRequest {
    static func authorizationURL(baseURL: URL, redirectTo: String, challenge: String) -> URL {
        var c = URLComponents(url: baseURL.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "provider", value: "google"), URLQueryItem(name: "redirect_to", value: redirectTo),
                       URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "code_challenge_method", value: "s256")]
        return c.url!
    }
    static func tokenRequest(baseURL: URL, publicKey: String, grant: String, body: [String: Any]) throws -> URLRequest {
        var c = URLComponents(url: baseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "grant_type", value: grant)]
        var request = URLRequest(url: c.url!); request.httpMethod = "POST"; request.timeoutInterval = 30
        request.setValue(publicKey, forHTTPHeaderField: "apikey"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }
}
