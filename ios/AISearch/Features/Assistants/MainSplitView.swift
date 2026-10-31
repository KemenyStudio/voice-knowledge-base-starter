import SwiftUI

/// Three columns on iPad and wide windows (assistants, conversations, chat).
/// On iPhone the same view collapses into a navigation stack.
struct MainSplitView: View {
    @Environment(AppModel.self) private var model
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var showSettings = false

    var body: some View {
        @Bindable var model = model

        NavigationSplitView(columnVisibility: $columns) {
            AssistantListView(showSettings: $showSettings)
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 340)
        } content: {
            if let assistant = model.selectedAssistant {
                ConversationListView(assistant: assistant)
                    .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
            } else {
                ContentUnavailableView(
                    "Elige un asistente",
                    systemImage: "sparkle.magnifyingglass",
                    description: Text("Cada asistente responde con los documentos de su equipo.")
                )
            }
        } detail: {
            if let assistant = model.selectedAssistant, let route = model.selectedConversation {
                ChatView(assistant: assistant, route: route)
                    .id(route)
            } else if model.selectedAssistant != nil {
                ContentUnavailableView {
                    Label("Sin conversación abierta", systemImage: "bubble.left.and.text.bubble.right")
                } description: {
                    Text("Abre una conversación de la lista o empieza una nueva.")
                } actions: {
                    Button("Nueva conversación") { model.startConversation() }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                Color.clear
            }
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .alert(
            "Algo salió mal",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
        .task {
            if model.assistants.isEmpty { await model.loadAssistants() }
        }
        .onChange(of: model.selectedAssistantId) { _, _ in
            model.selectedConversation = nil
        }
    }
}

struct AssistantListView: View {
    @Environment(AppModel.self) private var model
    @Binding var showSettings: Bool

    var body: some View {
        @Bindable var model = model

        List(selection: $model.selectedAssistantId) {
            ForEach(model.assistantGroups) { group in
                Section(group.title) {
                    ForEach(group.assistants) { assistant in
                        AssistantRow(assistant: assistant)
                            .tag(assistant.id)
                    }
                }
            }
        }
        .overlay {
            if model.assistants.isEmpty && !model.isLoading {
                ContentUnavailableView(
                    "Todavía no hay asistentes",
                    systemImage: "tray",
                    description: Text("Un administrador de tu equipo debe crearlos en la web.")
                )
            } else if model.assistants.isEmpty {
                ProgressView()
            }
        }
        .refreshable { await model.loadAssistants() }
        .navigationTitle(model.auth.appName)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showSettings = true
                } label: {
                    Label("Ajustes", systemImage: "gearshape")
                }
                .keyboardShortcut(",", modifiers: .command)
            }
            .visibilityPriority(.low)
        }
    }
}

private struct AssistantRow: View {
    let assistant: Assistant

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(assistant.name)
                    .font(.body)
                if let description = assistant.description, !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        } icon: {
            Image(systemName: "text.book.closed")
        }
        .padding(.vertical, 2)
    }
}
