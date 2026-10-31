import Foundation
import Observation

/// Supabase session returned by GoTrue (`/auth/v1/token`).
struct AuthSession: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let email: String?

    var isExpiring: Bool { expiresAt.timeIntervalSinceNow < 60 }
}

enum AuthError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): text
        }
    }
}

/// Signs in against the deployment's Supabase project and keeps the session in the keychain.
@MainActor
@Observable
final class AuthStore {
    private(set) var session: AuthSession?
    private(set) var config: ServerConfig?
    private(set) var server: URL?

    private static let sessionAccount = "supabase.session"
    private static let configKey = "serverConfig"
    private var refreshTask: Task<AuthSession, Error>?

    init() {
        server = AppConfig.server
        if let data = UserDefaults.standard.data(forKey: Self.configKey) {
            config = try? JSONDecoder().decode(ServerConfig.self, from: data)
        }
        if let data = Keychain.read(Self.sessionAccount) {
            session = try? JSONDecoder().decode(AuthSession.self, from: data)
        }
        if config == nil || server == nil { session = nil }
    }

    var isSignedIn: Bool { session != nil }
    var appName: String { config?.appName ?? "Document Search" }

    // MARK: Sign in and out

    func signIn(server input: String, email: String, password: String) async throws {
        guard let server = AppConfig.normalizedServer(input) else {
            throw AuthError.message("Escribe la dirección del servidor, por ejemplo app.tuempresa.cl.")
        }
        let config = try await Self.fetchConfig(server)
        let session = try await Self.token(
            config: config,
            grant: "password",
            body: ["email": email.trimmingCharacters(in: .whitespaces), "password": password]
        )
        let encodedConfig = try JSONEncoder().encode(config)
        UserDefaults.standard.set(server.absoluteString, forKey: AppConfig.serverKey)
        UserDefaults.standard.set(encodedConfig, forKey: Self.configKey)
        self.server = server
        self.config = config
        store(session)
    }

    func signOut() async {
        if let session, let config {
            var request = URLRequest(url: config.supabaseUrl.appending(path: "auth/v1/logout"))
            request.httpMethod = "POST"
            request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: request)
        }
        clear()
    }

    func clear() {
        session = nil
        Keychain.delete(Self.sessionAccount)
    }

    // MARK: Tokens

    /// A valid access token, refreshed when it is about to expire.
    func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard let current = session else { throw AuthError.message("Inicia sesión de nuevo.") }
        if !forceRefresh && !current.isExpiring { return current.accessToken }
        return try await refresh(current).accessToken
    }

    private func refresh(_ current: AuthSession) async throws -> AuthSession {
        if let refreshTask { return try await refreshTask.value }
        guard let config else { throw AuthError.message("Inicia sesión de nuevo.") }
        let task = Task {
            try await Self.token(config: config, grant: "refresh_token", body: ["refresh_token": current.refreshToken])
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let fresh = try await task.value
            store(fresh)
            return fresh
        } catch {
            clear()
            throw AuthError.message("Tu sesión expiró. Inicia sesión de nuevo.")
        }
    }

    private func store(_ session: AuthSession) {
        self.session = session
        if let data = try? JSONEncoder().encode(session) {
            Keychain.save(data, for: Self.sessionAccount)
        }
    }

    // MARK: Network

    private static func fetchConfig(_ server: URL) async throws -> ServerConfig {
        let url = server.appending(path: "api/mobile/config")
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw AuthError.message("Ese servidor no tiene la app móvil habilitada.")
            }
            return try JSONDecoder().decode(ServerConfig.self, from: data)
        } catch let error as AuthError {
            throw error
        } catch {
            throw AuthError.message("No se pudo conectar. Revisa la dirección y tu conexión.")
        }
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double
        let user: User?
        struct User: Decodable { let email: String? }
    }

    private struct GoTrueError: Decodable {
        let error_description: String?
        let msg: String?
        let message: String?
    }

    nonisolated private static func token(
        config: ServerConfig,
        grant: String,
        body: [String: String]
    ) async throws -> AuthSession {
        var components = URLComponents(
            url: config.supabaseUrl.appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "grant_type", value: grant)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONEncoder().encode(body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw AuthError.message("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.")
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let detail = try? JSONDecoder().decode(GoTrueError.self, from: data)
            throw AuthError.message(spanish(detail?.error_description ?? detail?.msg ?? detail?.message))
        }
        let token = try JSONDecoder().decode(TokenResponse.self, from: data)
        return AuthSession(
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date().addingTimeInterval(token.expires_in),
            email: token.user?.email
        )
    }

    /// Same wording as the web sign-in (lib/auth/messages.ts).
    nonisolated private static func spanish(_ message: String?) -> String {
        let text = (message ?? "").lowercased()
        if text.contains("invalid login credentials") { return "Correo o contraseña incorrectos." }
        if text.contains("email not confirmed") { return "Confirma tu correo antes de entrar." }
        if text.contains("rate limit") || text.contains("for security purposes") {
            return "Espera un momento antes de volver a intentarlo."
        }
        return "No se pudo iniciar sesión. Inténtalo de nuevo."
    }
}
