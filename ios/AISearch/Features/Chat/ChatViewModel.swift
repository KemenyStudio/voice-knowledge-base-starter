import Foundation
import Observation

struct ChatMessage: Identifiable {
    enum Role { case user, assistant }

    let id = UUID()
    let role: Role
    var text: String
    var citations: [Citation] = []
    var followUps: [String] = []
    var clarify: Clarify?
    var steps: [ResearchStep] = []
    /// "searching", "planning" or "writing" while the answer streams.
    var status: String?
    var isStreaming = false
    var failed = false
}

@MainActor
@Observable
final class ChatViewModel {
    private let api: APIClient
    let assistant: Assistant
    let sessionId: String

    private(set) var messages: [ChatMessage] = []
    var draft = ""
    var research = false
    private(set) var isLoading = false
    private(set) var isAnswering = false
    var loadError: String?

    /// Called after each finished answer so the conversation list can refresh.
    var onAnswered: (() -> Void)?

    private var answerTask: Task<Void, Never>?

    init(api: APIClient, assistant: Assistant, sessionId: String) {
        self.api = api
        self.assistant = assistant
        self.sessionId = sessionId
    }

    func loadTranscript() async {
        guard messages.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let transcript = try await api.transcript(assistantId: assistant.id, sessionId: sessionId)
            messages = transcript.map { row in
                ChatMessage(
                    role: row.role == "user" ? .user : .assistant,
                    text: row.content,
                    citations: row.citations,
                    followUps: row.meta?.followUps ?? [],
                    clarify: row.meta?.clarify
                )
            }
        } catch {
            loadError = error.localizedDescription
        }
    }

    func send(_ question: String, research: Bool = false) {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isAnswering else { return }

        // Suggestions belong to the previous answer only.
        if let last = messages.indices.last {
            messages[last].followUps = []
            messages[last].clarify = nil
        }
        messages.append(ChatMessage(role: .user, text: text))
        messages.append(ChatMessage(role: .assistant, text: "", status: research ? "planning" : "searching", isStreaming: true))
        let index = messages.count - 1
        isAnswering = true

        answerTask = Task {
            defer {
                if messages.indices.contains(index) {
                    messages[index].isStreaming = false
                    messages[index].status = nil
                }
                isAnswering = false
            }
            do {
                for try await event in api.ask(text, assistantId: assistant.id, sessionId: sessionId, research: research) {
                    apply(event, at: index)
                }
                onAnswered?()
            } catch is CancellationError {
            } catch {
                guard messages.indices.contains(index) else { return }
                messages[index].failed = true
                if messages[index].text.isEmpty {
                    messages[index].text = error.localizedDescription
                }
            }
        }
    }

    /// Sends what is in the composer.
    func sendDraft() {
        let question = draft
        let deep = research
        draft = ""
        research = false
        send(question, research: deep)
    }

    func stop() {
        answerTask?.cancel()
    }

    /// Asks the last question again after a failed answer.
    func retry() {
        guard let lastQuestion = messages.last(where: { $0.role == .user })?.text else { return }
        if messages.last?.failed == true { messages.removeLast() }
        if messages.last?.role == .user { messages.removeLast() }
        send(lastQuestion)
    }

    private func apply(_ event: ChatEvent, at index: Int) {
        guard messages.indices.contains(index) else { return }
        switch event {
        case .status(let status):
            messages[index].status = status
        case .plan(let steps):
            messages[index].steps = steps
        case .step(let id, let status, let sources):
            if let step = messages[index].steps.firstIndex(where: { $0.id == id }) {
                messages[index].steps[step].status = status
                messages[index].steps[step].sources = sources
            }
        case .delta(let text):
            messages[index].status = nil
            messages[index].text += text
        case .done(let answer):
            messages[index].text = answer.outputText
            messages[index].citations = answer.citations
            messages[index].clarify = answer.clarify
            messages[index].isStreaming = false
        case .followUps(let questions):
            messages[index].followUps = questions
        case .failure(let message):
            messages[index].failed = true
            messages[index].text = message
        }
    }
}
