import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Cuenta") {
                    LabeledContent("Correo", value: model.auth.session?.email ?? "—")
                    if let server = model.auth.server {
                        LabeledContent("Servidor", value: server.host() ?? server.absoluteString)
                    }
                }

                if let server = model.auth.server {
                    Section {
                        Button("Abrir en la web", systemImage: "safari") { openURL(server) }
                        Button("Términos", systemImage: "doc.plaintext") {
                            openURL(server.appending(path: "terminos"))
                        }
                        Button("Privacidad", systemImage: "hand.raised") {
                            openURL(server.appending(path: "privacidad"))
                        }
                    } footer: {
                        Text("Administra equipos, documentos y miembros desde la web.")
                    }
                }

                Section {
                    Button("Cerrar sesión", role: .destructive) { confirmSignOut = true }
                }

                Section {
                } footer: {
                    Text("Versión \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")")
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
            .confirmationDialog("¿Cerrar sesión?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Cerrar sesión", role: .destructive) {
                    Task {
                        dismiss()
                        await model.signOut()
                    }
                }
            }
        }
    }
}
