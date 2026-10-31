import Foundation

/// Public settings served by `GET /api/mobile/config`.
struct ServerConfig: Codable, Equatable {
    let appName: String
    let supabaseUrl: URL
    let supabaseAnonKey: String
}

struct Team: Codable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct SuggestedQuestionGroup: Codable, Hashable {
    let category: String
    let prompts: [String]
}

/// One row of `chatbots`, read with the user's token so RLS limits it to their teams.
struct Assistant: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let teamId: String
    let welcomeMessage: String?
    let suggestedQuestions: [SuggestedQuestionGroup]?
    let researchEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case teamId = "team_id"
        case welcomeMessage = "welcome_message"
        case suggestedQuestions = "suggested_questions"
        case researchEnabled = "research_enabled"
    }

    var examplePrompts: [String] {
        (suggestedQuestions ?? []).flatMap(\.prompts)
    }
}

/// One conversation in `POST /api/sessions`.
struct SessionSummary: Codable, Identifiable, Hashable {
    let session: String
    let message: String
    /// Unix seconds of the last activity.
    let createdAt: Double
    let title: String

    var id: String { session }
    var lastActivity: Date { Date(timeIntervalSince1970: createdAt) }
}

struct Citation: Codable, Identifiable, Hashable {
    let number: Int
    let fileId: String
    let filename: String
    let title: String
    let text: String
    let fileUrl: String?
    let outdated: Bool?

    var id: Int { number }

    /// Library id of the source document, from its download link
    /// (`/api/files/<uuid>/download`). `file_id` is the search index's id,
    /// which the download route does not accept.
    var documentId: String? {
        guard let fileUrl, let range = fileUrl.range(of: "/api/files/") else { return nil }
        return fileUrl[range.upperBound...].split(separator: "/").first.map(String.init)
    }

    enum CodingKeys: String, CodingKey {
        case number, filename, title, text, outdated
        case fileId = "file_id"
        case fileUrl = "file_url"
    }
}

struct Clarify: Codable, Hashable {
    let question: String
    let options: [String]
}

struct MessageMeta: Codable, Hashable {
    let followUps: [String]?
    let clarify: Clarify?

    enum CodingKeys: String, CodingKey {
        case clarify
        case followUps = "follow_ups"
    }
}

/// One message of `POST /api/history`.
struct TranscriptMessage: Codable {
    let id: String
    let role: String
    let content: String
    let citations: [Citation]
    let meta: MessageMeta?
}

/// One document of `GET /api/files`.
struct LibraryFile: Codable, Identifiable, Hashable {
    let id: String
    let fileName: String
    let fileType: String?
    let uploadedAt: String?
    let syncStatus: String?

    enum CodingKeys: String, CodingKey {
        case id
        case fileName = "file_name"
        case fileType = "file_type"
        case uploadedAt = "uploaded_at"
        case syncStatus = "sync_status"
    }

    var uploadedDate: Date? {
        guard let uploadedAt else { return nil }
        return ISO8601DateFormatter.supabase.date(from: uploadedAt)
            ?? ISO8601DateFormatter().date(from: uploadedAt)
    }

    var symbolName: String {
        switch (fileName as NSString).pathExtension.lowercased() {
        case "pdf": "doc.richtext"
        case "doc", "docx", "txt", "md", "rtf": "doc.text"
        case "xls", "xlsx", "csv": "tablecells"
        case "ppt", "pptx": "rectangle.on.rectangle"
        case "png", "jpg", "jpeg", "gif", "webp", "heic": "photo"
        default: "doc"
        }
    }
}

/// One line of the streamed answer (`POST /api/chat` with `stream: true`).
enum ChatEvent {
    case status(String)
    case plan([ResearchStep])
    case step(id: Int, status: String, sources: Int?)
    case delta(String)
    case done(FinishedAnswer)
    case followUps([String])
    case failure(String)
}

struct ResearchStep: Codable, Identifiable, Hashable {
    let id: Int
    let label: String
    var status: String?
    var sources: Int?
}

struct FinishedAnswer: Decodable {
    let id: String?
    let outputText: String
    let citations: [Citation]
    let clarify: Clarify?

    enum CodingKeys: String, CodingKey {
        case id, citations, clarify
        case outputText = "output_text"
    }
}

extension ChatEvent {
    private struct Envelope: Decodable {
        let type: String
        let status: String?
        let text: String?
        let message: String?
        let questions: [String]?
        let steps: [ResearchStep]?
        let sources: Int?
    }

    /// "step" events carry the step number in `id`; "done" uses `id` for the
    /// response id (a string), so it is read only here.
    private struct StepId: Decodable { let id: Int }

    /// Parses one NDJSON line. Unknown event types are ignored (nil).
    static func parse(_ line: String) throws -> ChatEvent? {
        let data = Data(line.utf8)
        let decoder = JSONDecoder()
        let envelope = try decoder.decode(Envelope.self, from: data)
        switch envelope.type {
        case "status": return .status(envelope.status ?? "")
        case "plan": return .plan(envelope.steps ?? [])
        case "step": return .step(id: try decoder.decode(StepId.self, from: data).id, status: envelope.status ?? "", sources: envelope.sources)
        case "delta": return .delta(envelope.text ?? "")
        case "done": return .done(try decoder.decode(FinishedAnswer.self, from: data))
        case "followups": return .followUps(envelope.questions ?? [])
        case "error": return .failure(envelope.message ?? "No se pudo completar la respuesta.")
        default: return nil
        }
    }
}

extension ISO8601DateFormatter {
    /// Supabase timestamps carry fractional seconds.
    static let supabase: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
