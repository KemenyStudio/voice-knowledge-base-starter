import SwiftUI

/// Renders the answer's Markdown with native text styles, so it follows
/// Dynamic Type and dark mode. Citation markers like [2] become links with
/// the `cite:` scheme; the chat view opens the matching source.
struct MarkdownText: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Self.blocks(markdown).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text))
                .font(level <= 2 ? .title3.bold() : .headline)
                .padding(.top, 4)
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            Text(Self.inline(text))
        case .bullet(let marker, let text, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Text(Self.inline(text))
            }
            .padding(.leading, CGFloat(depth) * 16)
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.callout.monospaced())
                    .padding(12)
            }
            .background(.fill.tertiary, in: .rect(cornerRadius: 10))
        case .quote(let text):
            Text(Self.inline(text))
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    Capsule().fill(.tint).frame(width: 3)
                }
        case .rule:
            Divider()
        }
    }

    // MARK: Parsing

    enum Block {
        case heading(Int, String)
        case paragraph(String)
        case bullet(marker: String, text: String, depth: Int)
        case code(String)
        case quote(String)
        case rule
    }

    static func blocks(_ markdown: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        var code: [String]?

        func flush() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }

        for raw in markdown.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let lines = code {
                    blocks.append(.code(lines.joined(separator: "\n")))
                    code = nil
                } else {
                    flush()
                    code = []
                }
                continue
            }
            if code != nil {
                code?.append(raw)
                continue
            }
            if line.isEmpty {
                flush()
                continue
            }
            let depth = (raw.prefix { $0 == " " }.count) / 2
            if let match = line.firstMatch(of: /^(#{1,6})\s+(.*)$/) {
                flush()
                blocks.append(.heading(match.1.count, String(match.2)))
            } else if line == "---" || line == "***" {
                flush()
                blocks.append(.rule)
            } else if let match = line.firstMatch(of: /^[-*•+]\s+(.*)$/) {
                flush()
                blocks.append(.bullet(marker: "•", text: String(match.1), depth: depth))
            } else if let match = line.firstMatch(of: /^(\d+)[.)]\s+(.*)$/) {
                flush()
                blocks.append(.bullet(marker: "\(match.1).", text: String(match.2), depth: depth))
            } else if let match = line.firstMatch(of: /^>\s?(.*)$/) {
                flush()
                blocks.append(.quote(String(match.1)))
            } else if line.hasPrefix("|") {
                // Tables: keep the cells readable as one line each.
                if line.contains("---") { continue }
                let cells = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                paragraph.append(cells.filter { !$0.isEmpty }.joined(separator: " · "))
            } else {
                paragraph.append(line)
            }
        }
        if let lines = code { blocks.append(.code(lines.joined(separator: "\n"))) }
        flush()
        return blocks
    }

    /// Inline Markdown (bold, italics, links, code) with citation links.
    static func inline(_ text: String) -> AttributedString {
        let cited = text
            .replacing(/【[^】]*】/, with: "")
            .replacing(/\[(\d{1,3})\](?!\()/) { match in "[[\(match.1)]](cite:\(match.1))" }
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        var result = (try? AttributedString(markdown: cited, options: options)) ?? AttributedString(text)
        for run in result.runs where run.link?.scheme == "cite" {
            result[run.range].font = Font.footnote.weight(.semibold)
        }
        return result
    }
}
