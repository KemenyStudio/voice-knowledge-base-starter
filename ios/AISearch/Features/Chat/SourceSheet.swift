import QuickLook
import SwiftUI

/// The cited passage, with a button to open the whole document.
struct SourceSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let citation: Citation

    @State private var preview: URL?
    @State private var isOpening = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if citation.outdated == true {
                        Label("Un administrador marcó este documento como desactualizado.", systemImage: "clock.badge.exclamationmark")
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }
                    if !citation.text.isEmpty {
                        Text("Fragmento citado")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(citation.text)
                            .textSelection(.enabled)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.fill.quaternary, in: .rect(cornerRadius: 14))
                    }
                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }
                .padding()
            }
            .navigationTitle(citation.title.isEmpty ? "Fuente \(citation.number)" : citation.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar", systemImage: "xmark") { dismiss() }
                }
                if let documentId = citation.documentId {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            open(documentId)
                        } label: {
                            if isOpening {
                                ProgressView()
                            } else {
                                Label("Abrir documento", systemImage: "doc.viewfinder")
                            }
                        }
                        .disabled(isOpening)
                    }
                }
            }
            .quickLookPreview($preview)
        }
    }

    private func open(_ documentId: String) {
        isOpening = true
        errorMessage = nil
        Task {
            defer { isOpening = false }
            do {
                let name = citation.filename.isEmpty ? citation.title : citation.filename
                preview = try await model.api.download(fileId: documentId, name: name)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
