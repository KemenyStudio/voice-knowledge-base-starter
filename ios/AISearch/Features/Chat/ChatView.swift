import SwiftUI

struct ChatView: View {
    @Environment(AppModel.self) private var model
    let assistant: Assistant
    let route: ConversationRoute

    @State private var openCitation: Citation?
    @State private var foldWidth: CGFloat?
    @FocusState private var composerFocused: Bool

    /// Readable line length on wide displays. A maximum, never a fixed width,
    /// so the column can shrink on the outer display of iPhone Duo.
    private let maxContentWidth: CGFloat = 760

    var body: some View {
        content(model.chat(for: assistant, route: route))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $openCitation) { citation in
                SourceSheet(citation: citation)
                    .presentationDetents([.medium, .large])
            }
    }

    private var title: String {
        model.sessions[assistant.id]?.first { $0.session == route.sessionId }?.title
            ?? (route.isNew ? "Nueva conversación" : assistant.name)
    }

    @ViewBuilder
    private func content(_ chat: ChatViewModel) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if chat.messages.isEmpty && !chat.isLoading {
                    WelcomeView(assistant: assistant) { prompt in
                        chat.send(prompt)
                    }
                }
                ForEach(chat.messages) { message in
                    MessageView(
                        message: message,
                        isLast: message.id == chat.messages.last?.id,
                        onAsk: { chat.send($0) },
                        onRetry: { chat.retry() },
                        onCitation: { openCitation = $0 }
                    )
                    .id(message.id)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .foldSafeColumn(maxWidth: maxContentWidth, foldWidth: foldWidth)
        }
        .onGeometryChange(for: CGFloat?.self) { proxy in
            FoldLayout.leadingWidth(in: proxy)
        } action: { width in
            foldWidth = width
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .overlay {
            if chat.isLoading { ProgressView() }
            if let error = chat.loadError {
                ContentUnavailableView {
                    Label("No se pudo abrir", systemImage: "exclamationmark.bubble")
                } description: {
                    Text(error)
                } actions: {
                    Button("Reintentar") {
                        chat.loadError = nil
                        Task { await chat.loadTranscript() }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Composer(
                draft: Bindable(chat).draft,
                research: Bindable(chat).research,
                researchAvailable: assistant.researchEnabled == true,
                isAnswering: chat.isAnswering,
                focused: $composerFocused,
                onSend: { chat.sendDraft() },
                onStop: { chat.stop() }
            )
            .foldSafeColumn(maxWidth: maxContentWidth, foldWidth: foldWidth)
        }
        .sensoryFeedback(.success, trigger: chat.isAnswering) { wasAnswering, isAnswering in
            wasAnswering && !isAnswering
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "cite" else { return .systemAction }
            let number = Int(url.absoluteString.dropFirst("cite:".count))
            if let citation = chat.messages.reversed().lazy.flatMap(\.citations).first(where: { $0.number == number }) {
                openCitation = citation
            }
            return .handled
        })
    }
}

private struct WelcomeView: View {
    let assistant: Assistant
    let onAsk: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.largeTitle)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text(assistant.welcomeMessage?.isEmpty == false
                 ? assistant.welcomeMessage!
                 : "Pregunta lo que necesites. Respondo con los documentos de \(assistant.name) y te muestro las fuentes.")
                .font(.title3)
            ForEach(assistant.examplePrompts.prefix(6), id: \.self) { prompt in
                Button {
                    onAsk(prompt)
                } label: {
                    HStack {
                        Text(prompt)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.up.right")
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .background(.fill.quaternary, in: .rect(cornerRadius: 14))
            }
        }
        .padding(.top, 24)
    }
}

/// Text field and send button, floating over the conversation.
private struct Composer: View {
    @Binding var draft: String
    @Binding var research: Bool
    let researchAvailable: Bool
    let isAnswering: Bool
    var focused: FocusState<Bool>.Binding
    let onSend: () -> Void
    let onStop: () -> Void

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isAnswering
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            if researchAvailable {
                Toggle(isOn: $research) {
                    Label("Investigar a fondo", systemImage: "binoculars")
                        .labelStyle(.iconOnly)
                }
                .toggleStyle(.button)
                .buttonBorderShape(.circle)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHint("Busca en varios pasos antes de responder.")
            }

            TextField(research ? "¿Qué quieres investigar?" : "Pregunta algo", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .focused(focused)
                .submitLabel(.send)
                .onSubmit { if canSend { onSend() } }
                .padding(.vertical, 12)
                .padding(.leading, researchAvailable ? 0 : 6)

            if isAnswering {
                Button(action: onStop) {
                    Image(systemName: "stop.fill")
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Detener respuesta")
                .padding(.bottom, 6)
            } else {
                Button(action: onSend) {
                    Image(systemName: "arrow.up")
                        .fontWeight(.semibold)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.circle)
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel("Enviar")
                .padding(.bottom, 6)
            }
        }
        .padding(.horizontal, 8)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26))
        .padding(.horizontal)
        .padding(.bottom, 8)
    }
}
