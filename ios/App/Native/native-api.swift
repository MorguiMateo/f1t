import Foundation

enum NativeFailure: LocalizedError {
    case message(String)
    case http(Int, String)
    var errorDescription: String? {
        switch self { case .message(let text): return text; case .http(let status, let code):
            if status == 401 { return "Sesión vencida. Volvé a iniciar sesión." }
            if status == 403 { return "No tenés permiso para sincronizar este cambio. Tu progreso local se conserva." }
            if status == 429 { return "El servicio está ocupado. Reintentaremos la sincronización." }
            if status >= 500 { return "El servicio no está disponible. Reintentaremos cuando se recupere." }
            if code == "23505" { return "El registro ya existe. Actualizá e intentá de nuevo." }
            if code == "23514" { return "Revisá los valores: están fuera del rango permitido." }
            return "No se pudo guardar o cargar (HTTP \(status), \(code)). Reintentá." }
    }
    static func isConnectivityFailure(_ error: Error) -> Bool {
        guard let error = error as? URLError else { return false }
        return [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed].contains(error.code)
    }
    static func canRetry(_ error: Error) -> Bool {
        if isConnectivityFailure(error) { return true }
        if case .http(let status, _) = error as? NativeFailure { return status == 429 || status >= 500 }
        return false
    }
    static func userMessage(_ error: Error) -> String {
        if isConnectivityFailure(error) { return "Sin conexión o sin respuesta del servicio. Reintentaremos la sincronización." }
        if let failure = error as? NativeFailure { return failure.localizedDescription }
        return "No pudimos confirmar la sincronización. Reintentá actualizar."
    }
}
struct NativeConfiguration {
    let url: URL
    let key: String
    static func load() throws -> Self {
        guard let text = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String,
              let url = URL(string: text), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.port == nil, ["", "/"].contains(url.path),
              let key = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String,
              !key.isEmpty, !key.contains("$("), !key.hasPrefix("sb_secret_") else {
            throw NativeFailure.message("Esta versión de FIT no puede conectarse al servicio. Actualizá la app y volvé a abrirla. Tus registros guardados en la cuenta no se modificaron.")
        }
        return Self(url: url, key: key)
    }
}
struct NativePageCursor: Equatable { let values: [String] }
struct NativeKeysetPlan {
    let columns: [String]
    let descending: Bool
    init(table: String) throws {
        switch table {
        case "sessions": columns = ["performed_on", "id"]; descending = true
        case "weight_entries": columns = ["measured_on", "id"]; descending = true
        case "food_entries": columns = ["created_at", "id"]; descending = false
        case "food_days": columns = ["logged_on"]; descending = false
        case "body_profile": columns = ["user_id"]; descending = false
        case "routines", "routine_days", "routine_exercises", "session_sets", "exercises": columns = ["id"]; descending = false
        default: throw NativeFailure.message("La tabla no tiene un cursor de paginación definido.")
        }
    }
    var order: String { columns.map { "\($0).\(descending ? "desc" : "asc")" }.joined(separator: ",") }
    private func quoted(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }
    func condition(_ cursor: NativePageCursor) -> String {
        let comparison = descending ? "lt" : "gt"
        let primary = "\(columns[0]).\(comparison).\(quoted(cursor.values[0]))"
        guard columns.count == 2 else { return primary }
        return "or(\(primary),and(\(columns[0]).eq.\(quoted(cursor.values[0])),\(columns[1]).\(comparison).\(quoted(cursor.values[1]))))"
    }
    func query(_ original: [URLQueryItem], cursor: NativePageCursor?, pageSize: Int = 500) throws -> [URLQueryItem] {
        if let supplied = original.first(where: { $0.name == "order" })?.value, supplied != order {
            throw NativeFailure.message("El orden solicitado no coincide con el cursor de la tabla.")
        }
        var query = original.filter { !["order", "offset", "limit"].contains($0.name) }
        if let cursor {
            let existing = query.first { $0.name == "and" }?.value
            query.removeAll { $0.name == "and" }
            let clauses = existing.map { String($0.dropFirst().dropLast()) + "," } ?? ""
            query.append(URLQueryItem(name: "and", value: "(\(clauses)\(condition(cursor)))"))
        }
        query += [URLQueryItem(name: "order", value: order), URLQueryItem(name: "limit", value: String(pageSize))]
        return query
    }
    func cursor(in data: Data) throws -> NativePageCursor {
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]], let last = rows.last else {
            throw NativeFailure.message("La página no contiene un cursor válido.")
        }
        let values = columns.compactMap { last[$0] as? String }
        guard values.count == columns.count else { throw NativeFailure.message("La respuesta omitió las columnas del cursor.") }
        // Preserve server precision/offset; converting timestamps to Date loses equality boundaries.
        return NativePageCursor(values: values)
    }
}

@MainActor
final class NativeAPI {
    let auth: NativeAuth
    private let network: URLSession
    private let pageLoader: ((String, [URLQueryItem]) async throws -> Data)?
    init(auth: NativeAuth, network: URLSession = .shared, pageLoader: ((String, [URLQueryItem]) async throws -> Data)? = nil) { self.auth = auth; self.network = network; self.pageLoader = pageLoader }
    func fetch<T: Decodable>(_ table: String, query: [URLQueryItem] = []) async throws -> [T] {
        let generation = auth.generation
        let plan = try NativeKeysetPlan(table: table)
        var result: [T] = [], cursor: NativePageCursor?
        while true {
            let pageQuery = try plan.query(query, cursor: cursor)
            let data: Data
            if let pageLoader { data = try await pageLoader(table, pageQuery) }
            else { data = try await request("rest/v1/\(table)", method: "GET", query: pageQuery) }
            guard auth.generation == generation else { throw CancellationError() }
            let page = try JSONDecoder().decode([T].self, from: data)
            result += page
            if page.count < 500 { return result }
            let next = try plan.cursor(in: data)
            guard next != cursor else { throw NativeFailure.message("La paginación no avanzó; actualizá e intentá nuevamente.") }
            cursor = next
        }
    }
    func write(_ table: String, method: String, body: [String: Any] = [:], query: [URLQueryItem] = []) async throws {
        _ = try await request("rest/v1/\(table)", method: method, query: query, body: method == "DELETE" ? nil : body,
                              prefer: "return=minimal" + (query.contains { $0.name == "on_conflict" } ? ",resolution=merge-duplicates" : ""))
    }
    func rpc(_ name: String, body: [String: Any]) async throws { _ = try await request("rest/v1/rpc/\(name)", method: "POST", body: body) }
    func request(_ path: String, method: String, query: [URLQueryItem] = [], body: [String: Any]? = nil, prefer: String? = nil) async throws -> Data {
        let generation = auth.generation
        let token = try await auth.accessToken()
        guard auth.generation == generation else { throw CancellationError() }
        let config = try NativeConfiguration.load()
        var c = URLComponents(url: config.url.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        c.queryItems = query.isEmpty ? nil : query
        // PostgREST form-decodes raw "+" as a space. Escape only literal plus in the
        // final encoded query; do not encode percent escapes or query punctuation again.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        var request = URLRequest(url: c.url!)
        request.httpMethod = method; request.timeoutInterval = 30
        request.setValue(config.key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await network.data(for: request)
        guard auth.generation == generation else { throw CancellationError() }
        try Self.validate(data, response)
        return data
    }
    static func validate(_ data: Data, _ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse else { throw NativeFailure.message("Respuesta de red inválida.") }
        if !(200..<300).contains(response.statusCode) {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            // Do not display server messages, URLs, or token-bearing request bodies.
            let raw = obj?["code"] as? String ?? obj?["error_code"] as? String ?? "request_failed"
            let code = raw.range(of: #"^[a-zA-Z0-9_]{1,60}$"#, options: .regularExpression) != nil ? raw : "request_failed"
            throw NativeFailure.http(response.statusCode, code)
        }
    }
}
