import Foundation

// Compiles the production Foundation-only parser on macOS; never performs network or credential actions.
@main
struct CallbackRegressionRunner {
    private struct Fixture: Decodable { let name: String; let url: String; let code: String?; let reason: String? }
    static func main() throws {
        var checked = 0
        func verify(_ text: String, code: String? = nil, reason: NativeCallbackReason? = nil) throws {
            let url = URL(string: text)!
            do {
                let result = try NativeOAuthCallback.code(from: url)
                precondition(reason == nil && result == code, "Callback acceptance regression")
            } catch let failure as NativeCallbackFailure {
                precondition(failure.reason == reason, "Callback rejection regression case \(checked + 1): expected \(reason?.rawValue ?? "success"), got \(failure.reason.rawValue)")
                for secret in ["private-fixture", "@example.invalid", "private-code", "private-token", "unrecognized-secret", "f1t://"] {
                    precondition(!failure.localizedDescription.contains(secret), "Diagnostic disclosed callback data")
                }
            }
            checked += 1
        }
        try verify("f1t://auth/callback?code=fixture", code: "fixture")
        try verify("f1t://auth/callback?code=fixture#", code: "fixture")
        try verify("f1t://auth/callback?sb_flow_id=optional&state=meta&code=fixture#", code: "fixture")
        try verify("f1t://auth/callback?code=a%2Bb%252B", code: "a+b%2B")
        for text in ["https://auth/callback?code=x", "f1t://wrong/callback?code=x", "f1t://auth/wrong?code=x", "f1t://auth/%63allback?code=x", "f1t://user@auth/callback?code=x", "f1t://auth:443/callback?code=x"] { try verify(text, reason: .route) }
        try verify("f1t://auth/callback", reason: .missingCode)
        for text in ["f1t://auth/callback?code=", "f1t://auth/callback?code=%20"] { try verify(text, reason: .emptyCode) }
        for text in ["f1t://auth/callback?code=a+b", "f1t://auth/callback?code=%FF", "f1t://auth/callback?Code=fixture", "f1t://auth/callback?code=x&"] { try verify(text, reason: .format) }
        for text in ["f1t://auth/callback?code=x&code=x", "f1t://auth/callback?code=x&%63ode=y", "f1t://auth/callback?code=x#code=y"] { try verify(text, reason: .duplicateCode) }
        for text in ["f1t://auth/callback#code=x", "f1t://auth/callback?code=x#unknown=private-token", "f1t://auth/callback?code=x#sb="] { try verify(text, reason: .forbiddenFragment) }
        for key in ["access_token", "refresh_token", "provider_token", "provider_refresh_token", "id_token", "code_verifier", "code_challenge", "token_type"] {
            try verify("f1t://auth/callback?code=x#\(key)=private-token", reason: .tokens)
            try verify("f1t://auth/callback?code=x&\(key)=private-token", reason: .tokens)
        }
        try verify("f1t://auth/callback?code=x#%61ccess_token=private-token", reason: .tokens)
        try verify("f1t://auth/callback?error=access_denied&code=x", reason: .conflictingErrors)
        try verify("f1t://auth/callback?error=access_denied#error=server_error&sb=", reason: .conflictingErrors)
        try verify("f1t://auth/callback?error=access_denied&error=access_denied", reason: .conflictingErrors)
        try verify("f1t://auth/callback#error=access_denied&sb=", reason: .accessDenied)
        try verify("f1t://auth/callback?error_code=unrecognized-secret&error_description=private-fixture@example.invalid", reason: .providerError)
        let shapeError: NativeCallbackFailure
        do { _ = try NativeOAuthCallback.code(from: URL(string: "f1t://wrong/private-fixture@example.invalid?code=private-code#access_token=private-token")!); fatalError("Unsafe callback accepted") }
        catch let error as NativeCallbackFailure { shapeError = error }
        precondition(shapeError.shape.summary == "s=1,h=0,p=0,c=1,f=tokens")
        if CommandLine.arguments.count > 1 {
            let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
            for fixture in fixtures { try verify(fixture.url, code: fixture.code, reason: fixture.reason.flatMap(NativeCallbackReason.init(rawValue:))) }
        }
        let base = URL(string: "https://example.supabase.co")!
        let authURL = NativeOAuthRequest.authorizationURL(baseURL: base, redirectTo: "f1t://auth/callback", challenge: "public-challenge")
        let query = Dictionary(uniqueKeysWithValues: URLComponents(url: authURL, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
        precondition(authURL.path == "/auth/v1/authorize" && query == ["provider":"google", "redirect_to":"f1t://auth/callback", "code_challenge":"public-challenge", "code_challenge_method":"s256"])
        let token = try NativeOAuthRequest.tokenRequest(baseURL: base, publicKey: "public-key-fixture", grant: "pkce", body: ["auth_code":"fixture-code", "code_verifier":"local-verifier"])
        precondition(token.httpMethod == "POST" && token.url!.path == "/auth/v1/token")
        precondition(URLComponents(url: token.url!, resolvingAgainstBaseURL: false)!.queryItems == [URLQueryItem(name:"grant_type",value:"pkce")])
        let body = try JSONSerialization.jsonObject(with: token.httpBody!) as! [String:String]
        precondition(body == ["auth_code":"fixture-code", "code_verifier":"local-verifier"])
        print("PASS: \(checked) callback cases, sanitized shape, and PKCE authorize/token request contracts (no network).")
    }
}
