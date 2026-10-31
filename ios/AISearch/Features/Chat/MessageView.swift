import SwiftUI
import UIKit

struct MessageView: View {
    let message: ChatMessage
    let isLast: Bool
    let onAsk: (String) -> Void
    let onRetry: () -> Void
    let onCitation: (Citation) -> Void

    var body: some View {
        switch message.role {
        case .user: userBubble
        case .assistant: answer
        }
    }

    private var userBubble: some View {
        HStack {
            Spacer(minLength: 48)
            Text(message.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(.white)
                .background(.tint, in: .rect(cornerRadius: 20))
                .textSelection(.enabled)
        }
        .accessibilityLabel("Tú: \(message.text)")
    }

    private var answer: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !message.steps.isEmpty {
                ResearchStepsView(steps: message.steps)
            }

            if message.text.isEmpty, let status = message.status {
                StatusLine(status: status)
            } else if message.failed {
                VStack(alignment: .leading, spacing: 10) {
                    Label(message.text, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    if isLast {
                        Button("Reintentar", systemImage: "arrow.clockwise", action: onRetry)
                            .buttonStyle(.bordered)
                    }
                }
            } else {
                MarkdownText(markdown: message.text)
                    .contextMenu {
                        Button("Copiar", systemImage: "doc.on.doc") {
                            UIPasteboard.general.string = message.text
                        }
                        ShareLink(item: message.text)
                    }
            }

            if !message.citations.isEmpty && !message.isStreaming {
                SourcesRow(citations: message.citations, onSelect: onCitation)
            }

            if let clarify = message.clarify, isLast {
                VStack(alignment: .leading, spacing: 8) {
                    Text(clarify.question).font(.subheadline.weight(.semibold))
                    FlowButtons(items: clarify.options, onTap: onAsk)
                }
            }

            if !message.followUps.isEmpty && isLast {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Seguir preguntando")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(message.followUps, id: \.self) { question in
                        Button {
                            onAsk(question)
                        } label: {
                            Label(question, systemImage: "arrow.turn.down.right")
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.tint)
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .animation(.default, value: message.isStreaming)
    }
}

private struct StatusLine: View {
    let status: String

    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text(label)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var label: String {
        switch status {
        case "planning": "Planificando la investigación…"
        case "writing": "Redactando la respuesta…"
        default: "Buscando en los documentos…"
        }
    }
}

private struct ResearchStepsView: View {
    let steps: [ResearchStep]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(steps) { step in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Group {
                        if step.status == "done" {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        } else if step.status == "searching" {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "circle").foregroundStyle(.tertiary)
                        }
                    }
                    .frame(width: 18)
                    Text(step.label)
                        .font(.subheadline)
                    if let sources = step.sources, step.status == "done" {
                        Text("\(sources) fuentes")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: .rect(cornerRadius: 14))
    }
}

/// Numbered source chips under an answer.
private struct SourcesRow: View {
    let citations: [Citation]
    let onSelect: (Citation) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Fuentes")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(citations) { citation in
                        Button {
                            onSelect(citation)
                        } label: {
                            HStack(spacing: 6) {
                                Text("\(citation.number)")
                                    .font(.caption.weight(.bold))
                                    .frame(minWidth: 20, minHeight: 20)
                                    .background(.tint.opacity(0.15), in: .circle)
                                Text(citation.title.isEmpty ? citation.filename : citation.title)
                                    .font(.footnote)
                                    .lineLimit(1)
                                    .frame(maxWidth: 220, alignment: .leading)
                                if citation.outdated == true {
                                    Image(systemName: "clock.badge.exclamationmark")
                                        .foregroundStyle(.orange)
                                        .accessibilityLabel("Desactualizado")
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        .background(.fill.tertiary, in: .capsule)
                        .accessibilityLabel("Fuente \(citation.number): \(citation.title)")
                    }
                }
            }
        }
    }
}

/// Option buttons that wrap onto several lines.
private struct FlowButtons: View {
    let items: [String]
    let onTap: (String) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { buttons }
            VStack(alignment: .leading, spacing: 8) { buttons }
        }
    }

    private var buttons: some View {
        ForEach(items, id: \.self) { item in
            Button(item) { onTap(item) }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
        }
    }
}
