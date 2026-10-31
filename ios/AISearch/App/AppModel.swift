import Foundation
import Observation

/// What the detail column shows: an existing conversation or a fresh one.
struct ConversationRoute: Hashable {
    let sessionId: String
    let isNew: Bool

    static func new() -> ConversationRoute {
        ConversationRoute(sessionId: UUID().uuidString.lowercased(), isNew: true)
    }
}

struct AssistantGroup: Identifiable {
    let id: String
    let title: String
    let assistants: [Assistant]
}

/// Assistants, conversations and the current selection, shared by every column.
@MainActor
@Observable
final class AppModel {
    let auth: AuthStore
    let api: APIClient

    private(set) var teams: [Team] = []
    private(set) var assistants: [Assistant] = []
    private(set) var sessions: [String: [SessionSummary]] = [:]
    private(set) var isLoading = false
    var errorMessage: String?

    var selectedAssistantId: String?
    var selectedConversation: ConversationRoute?

    /// Open chats, kept here rather than in the view. Folding or unfolding
    /// iPhone Duo collapses or expands the split view and rebuilds its
    /// columns; the answer that is streaming and the unsent draft survive.
    @ObservationIgnored private var chats: [String: ChatViewModel] = [:]

    init() {
        let auth = AuthStore()
        self.auth = auth
        self.api = APIClient(auth: auth)
    }

    var selectedAssistant: Assistant? {
        assistants.first { $0.id == selectedAssistantId }
    }

    /// Assistants grouped under their team, teams in name order.
    var assistantGroups: [AssistantGroup] {
        let grouped = Dictionary(grouping: assistants, by: \.teamId)
        var result = teams.compactMap { team in
            grouped[team.id].map { AssistantGroup(id: team.id, title: team.name, assistants: $0) }
        }
        let teamIds = Set(teams.map(\.id))
        let orphans = assistants.filter { !teamIds.contains($0.teamId) }
        if !orphans.isEmpty { result.append(AssistantGroup(id: "other", title: "Otros", assistants: orphans)) }
        return result
    }

    func loadAssistants() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let teams = api.teams()
            async let assistants = api.assistants()
            self.teams = try await teams
            self.assistants = try await assistants
            // One assistant: skip the list, as the web app does.
            if selectedAssistantId == nil, self.assistants.count == 1 {
                selectedAssistantId = self.assistants[0].id
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadSessions(for assistantId: String) async {
        do {
            sessions[assistantId] = try await api.sessions(assistantId: assistantId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func rename(_ conversation: SessionSummary, in assistantId: String, to title: String) async {
        do {
            try await api.rename(assistantId: assistantId, sessionId: conversation.session, title: title)
            await loadSessions(for: assistantId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(_ conversation: SessionSummary, in assistantId: String) async {
        sessions[assistantId]?.removeAll { $0.id == conversation.id }
        if selectedConversation?.sessionId == conversation.session { selectedConversation = nil }
        chats[conversation.session] = nil
        do {
            try await api.delete(assistantId: assistantId, sessionId: conversation.session)
        } catch {
            errorMessage = error.localizedDescription
            await loadSessions(for: assistantId)
        }
    }

    func chat(for assistant: Assistant, route: ConversationRoute) -> ChatViewModel {
        if let existing = chats[route.sessionId] { return existing }
        let chat = ChatViewModel(api: api, assistant: assistant, sessionId: route.sessionId)
        chat.onAnswered = { [weak self] in
            Task { await self?.loadSessions(for: assistant.id) }
        }
        chats[route.sessionId] = chat
        if !route.isNew { Task { await chat.loadTranscript() } }
        return chat
    }

    func startConversation() {
        selectedConversation = .new()
    }

    func signOut() async {
        await auth.signOut()
        reset()
    }

    func reset() {
        teams = []
        assistants = []
        sessions = [:]
        chats = [:]
        selectedAssistantId = nil
        selectedConversation = nil
    }
}
