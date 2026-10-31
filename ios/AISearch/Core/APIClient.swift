import Foundation

enum APIError: LocalizedError {
    case server(status: Int, message: String?)
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .notSignedIn:
            "Inicia sesión de nuevo."
        case .server(let status, let message):
            message ?? (status >= 500
                ? "El servidor tuvo un problema. Inténtalo de nuevo."
                : "No se pudo completar la acción.")
        }
    }
}

/// Talks to the web deployment's `/api` routes and to Supabase PostgREST,
/// always as the signed-in user (bearer token, so RLS applies).
@MainActor
final class APIClient {
    private let auth: AuthStore
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(auth: AuthStore) {
        self.auth = auth
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 300
        configuration.waitsForConnectivity = true
        session = URLSession(configuration: configuration)
    }

    // MARK: Assistants (Supabase, RLS limits rows to the user's teams)

    func teams() async throws -> [Team] {
        try await rest("teams", query: [("select", "id,name"), ("order", "name")])
    }

    func assistants() async throws -> [Assistant] {
        try await rest("chatbots", query: [
            ("select", "id,name,description,team_id,welcome_message,suggested_questions,research_enabled"),
            ("order", "name"),
        ])
    }

    // MARK: Conversations

    func sessions(assistantId: String, query: String? = nil) async throws -> [SessionSummary] {
        var body: [String: String] = ["chatbotId": assistantId]
        if let query, !query.isEmpty { body["query"] = query }
        return try await api("api/sessions", method: "POST", body: body)
    }

    func transcript(assistantId: String, sessionId: String) async throws -> [TranscriptMessage] {
        try await api("api/history", method: "POST", body: ["chatbotId": assistantId, "sessionId": sessionId])
    }

    func rename(assistantId: String, sessionId: String, title: String) async throws {
        let _: Ignored = try await api("api/sessions", method: "PATCH", body: [
            "chatbotId": assistantId, "sessionId": sessionId, "title": title,
        ])
    }

    func delete(assistantId: String, sessionId: String) async throws {
        let _: Ignored = try await api("api/sessions", method: "DELETE", body: [
            "chatbotId": assistantId, "sessionId": sessionId,
        ])
    }

    // MARK: Library

    func files(assistantId: String) async throws -> [LibraryFile] {
        try await api("api/files", query: [("chatbotId", assistantId)])
    }

    /// Downloads a document to a temporary file for Quick Look.
    func download(fileId: String, name: String) async throws -> URL {
        let request = try await authorized(path: "api/files/\(fileId)/download", query: [("inline", "1")])
        let (data, response) = try await send(request)
        try check(response, data)
        let folder = FileManager.default.temporaryDirectory.appending(path: fileId, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // The server's Content-Disposition carries the real name and extension.
        let fileName = response.suggestedFilename.flatMap { $0.isEmpty ? nil : $0 } ?? name
        let safeName = fileName.replacingOccurrences(of: "/", with: "-")
        let url = folder.appending(path: safeName.isEmpty ? "documento" : safeName)
        try data.write(to: url, options: .atomic)
        return url
    }

    // MARK: Chat

    struct ChatRequest: Encodable {
        struct Query: Encodable { let content: String }
        let query: [Query]
        let chatbotId: String
        let sessionId: String
        let stream = true
        let research: Bool?
    }

    /// Asks a question and yields the NDJSON events as they arrive.
    func ask(_ question: String, assistantId: String, sessionId: String, research: Bool) -> AsyncThrowingStream<ChatEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let payload = ChatRequest(
                        query: [.init(content: question)],
                        chatbotId: assistantId,
                        sessionId: sessionId,
                        research: research ? true : nil
                    )
                    var request = try await authorized(path: "api/chat")
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONEncoder().encode(payload)

                    let (bytes, response) = try await session.bytes(for: request)
                    if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        try check(response, data)
                    }
                    for try await line in bytes.lines where !line.isEmpty {
                        if let event = try? ChatEvent.parse(line) { continuation.yield(event) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Plumbing

    private struct Ignored: Decodable {}
    private struct ErrorBody: Decodable { let error: String? }

    private func api<T: Decodable>(
        _ path: String,
        method: String = "GET",
        query: [(String, String)] = [],
        body: [String: String]? = nil
    ) async throws -> T {
        var request = try await authorized(path: path, query: query)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        var (data, response) = try await send(request)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            // The token may have expired between the check and the call.
            request.setValue("Bearer \(try await auth.accessToken(forceRefresh: true))", forHTTPHeaderField: "Authorization")
            (data, response) = try await send(request)
        }
        try check(response, data)
        return try decoder.decode(T.self, from: data)
    }

    private func rest<T: Decodable>(_ table: String, query: [(String, String)]) async throws -> T {
        guard let config = auth.config else { throw APIError.notSignedIn }
        var components = URLComponents(url: config.supabaseUrl.appending(path: "rest/v1/\(table)"), resolvingAgainstBaseURL: false)!
        components.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) }
        var request = URLRequest(url: components.url!)
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(try await auth.accessToken())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await send(request)
        try check(response, data)
        return try decoder.decode(T.self, from: data)
    }

    private func authorized(path: String, query: [(String, String)] = []) async throws -> URLRequest {
        guard let server = auth.server else { throw APIError.notSignedIn }
        var components = URLComponents(url: server.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) } }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(try await auth.accessToken())", forHTTPHeaderField: "Authorization")
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError where error.code != .cancelled {
            throw APIError.server(status: 0, message: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.")
        }
    }

    private func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { auth.clear() }
            let message = try? decoder.decode(ErrorBody.self, from: data).error
            throw APIError.server(status: http.statusCode, message: http.statusCode < 500 ? message : nil)
        }
    }
}
