import SwiftUI

struct ConversationListView: View {
    @Environment(AppModel.self) private var model
    let assistant: Assistant

    @State private var query = ""
    @State private var results: [SessionSummary]?
    @State private var renaming: SessionSummary?
    @State private var newTitle = ""
    @State private var showLibrary = false

    private var conversations: [SessionSummary] {
        results ?? model.sessions[assistant.id] ?? []
    }

    var body: some View {
        @Bindable var model = model

        List(selection: $model.selectedConversation) {
            ForEach(Self.grouped(conversations), id: \.title) { group in
                Section(group.title) {
                    ForEach(group.items) { conversation in
                        ConversationRow(conversation: conversation)
                            .tag(ConversationRoute(sessionId: conversation.session, isNew: false))
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await model.delete(conversation, in: assistant.id) }
                                } label: {
                                    Label("Eliminar", systemImage: "trash")
                                }
                                Button {
                                    startRename(conversation)
                                } label: {
                                    Label("Renombrar", systemImage: "pencil")
                                }
                                .tint(.indigo)
                            }
                            .contextMenu {
                                Button {
                                    startRename(conversation)
                                } label: {
                                    Label("Renombrar", systemImage: "pencil")
                                }
                                Button(role: .destructive) {
                                    Task { await model.delete(conversation, in: assistant.id) }
                                } label: {
                                    Label("Eliminar", systemImage: "trash")
                                }
                            }
                    }
                }
            }
        }
        .overlay {
            if conversations.isEmpty {
                if results != nil {
                    ContentUnavailableView.search(text: query)
                } else if model.sessions[assistant.id] != nil {
                    ContentUnavailableView {
                        Label("Sin conversaciones", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Haz tu primera pregunta a \(assistant.name).")
                    } actions: {
                        Button("Nueva conversación") { model.startConversation() }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    ProgressView()
                }
            }
        }
        .navigationTitle(assistant.name)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Buscar conversaciones")
        .task(id: query) { await search() }
        .refreshable { await model.loadSessions(for: assistant.id) }
        .task(id: assistant.id) { await model.loadSessions(for: assistant.id) }
        .toolbar {
            // On iPhone Duo this bar runs down the side; when it runs out of
            // room, Biblioteca moves to the overflow menu before the compose button.
            ToolbarItem(placement: .primaryAction) {
                Button {
                    model.startConversation()
                } label: {
                    Label("Nueva conversación", systemImage: "square.and.pencil")
                }
            }
            .visibilityPriority(.high)
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showLibrary = true
                } label: {
                    Label("Biblioteca", systemImage: "books.vertical")
                }
            }
        }
        .sheet(isPresented: $showLibrary) {
            LibraryView(assistant: assistant)
        }
        .alert("Renombrar conversación", isPresented: Binding(
            get: { renaming != nil },
            set: { if !$0 { renaming = nil } }
        )) {
            TextField("Título", text: $newTitle)
            Button("Cancelar", role: .cancel) {}
            Button("Guardar") {
                guard let conversation = renaming else { return }
                let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !title.isEmpty else { return }
                Task { await model.rename(conversation, in: assistant.id, to: title) }
            }
        }
    }

    private func startRename(_ conversation: SessionSummary) {
        newTitle = conversation.title
        renaming = conversation
    }

    /// Searches older conversations on the server once the query has 2+ characters.
    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 else {
            results = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        do {
            results = try await model.api.sessions(assistantId: assistant.id, query: text)
        } catch is CancellationError {
        } catch {
            model.errorMessage = error.localizedDescription
        }
    }

    private struct DayGroup {
        let title: String
        let items: [SessionSummary]
    }

    private static func grouped(_ conversations: [SessionSummary]) -> [DayGroup] {
        let calendar = Calendar.current
        let now = Date()
        let buckets: [(String, (Date) -> Bool)] = [
            ("Hoy", { calendar.isDateInToday($0) }),
            ("Ayer", { calendar.isDateInYesterday($0) }),
            ("Últimos 7 días", { now.timeIntervalSince($0) < 7 * 86_400 }),
            ("Últimos 30 días", { now.timeIntervalSince($0) < 30 * 86_400 }),
            ("Anteriores", { _ in true }),
        ]
        var remaining = conversations
        var groups: [DayGroup] = []
        for (title, matches) in buckets {
            let items = remaining.filter { matches($0.lastActivity) }
            remaining.removeAll { matches($0.lastActivity) }
            if !items.isEmpty { groups.append(DayGroup(title: title, items: items)) }
        }
        return groups
    }
}

private struct ConversationRow: View {
    let conversation: SessionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(conversation.title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Text(conversation.lastActivity, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !conversation.message.isEmpty {
                Text(conversation.message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
