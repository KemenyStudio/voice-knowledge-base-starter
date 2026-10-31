import QuickLook
import SwiftUI

/// The assistant's documents. Read-only: uploads stay on the web.
struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let assistant: Assistant

    @State private var files: [LibraryFile]?
    @State private var query = ""
    @State private var preview: URL?
    @State private var opening: String?
    @State private var errorMessage: String?

    private var visible: [LibraryFile] {
        guard let files else { return [] }
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return files }
        return files.filter { $0.fileName.localizedStandardContains(text) }
    }

    var body: some View {
        NavigationStack {
            List(visible) { file in
                Button {
                    open(file)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: file.symbolName)
                            .font(.title3)
                            .foregroundStyle(.tint)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.fileName)
                                .lineLimit(2)
                            if let date = file.uploadedDate {
                                Text(date, format: .dateTime.day().month().year())
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if opening == file.id {
                            ProgressView()
                        } else if file.syncStatus == "processing" {
                            Text("Indexando")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .foregroundStyle(.primary)
                .disabled(opening != nil)
            }
            .overlay {
                if files == nil {
                    ProgressView()
                } else if visible.isEmpty {
                    if query.isEmpty {
                        ContentUnavailableView(
                            "Biblioteca vacía",
                            systemImage: "books.vertical",
                            description: Text("Un administrador puede subir documentos desde la web.")
                        )
                    } else {
                        ContentUnavailableView.search(text: query)
                    }
                }
            }
            .searchable(text: $query, prompt: "Buscar documentos")
            .refreshable { await load() }
            .task { await load() }
            .navigationTitle("Biblioteca")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
            .quickLookPreview($preview)
            .alert("No se pudo abrir", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private func load() async {
        do {
            files = try await model.api.files(assistantId: assistant.id)
        } catch {
            if files == nil { files = [] }
            errorMessage = error.localizedDescription
        }
    }

    private func open(_ file: LibraryFile) {
        opening = file.id
        Task {
            defer { opening = nil }
            do {
                preview = try await model.api.download(fileId: file.id, name: file.fileName)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
