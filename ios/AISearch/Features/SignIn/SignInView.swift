import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    @State private var server = AppConfig.server?.host() ?? ""
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @FocusState private var focus: Field?

    private enum Field { case server, email, password }

    /// The server field only shows when the build has no default.
    private let asksForServer = AppConfig.defaultServer == nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "text.magnifyingglass")
                            .font(.system(size: 44, weight: .semibold))
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        Text("Pregunta a los documentos de tu equipo y recibe respuestas con sus fuentes.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                if asksForServer {
                    Section {
                        TextField("app.tuempresa.cl", text: $server)
                            .textContentType(.URL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .server)
                            .submitLabel(.next)
                            .onSubmit { focus = .email }
                    } header: {
                        Text("Servidor")
                    } footer: {
                        Text("La dirección web donde tu equipo usa los asistentes.")
                    }
                }

                Section("Cuenta") {
                    TextField("Correo", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                    SecureField("Contraseña", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button(action: signIn) {
                        HStack {
                            Spacer()
                            if isWorking {
                                ProgressView()
                            } else {
                                Text("Iniciar sesión").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(!canSubmit)

                    Button("¿Olvidaste tu contraseña?") {
                        let base = AppConfig.normalizedServer(server) ?? AppConfig.defaultServer
                        if let base { openURL(base.appending(path: "reset-password")) }
                    }
                    .frame(maxWidth: .infinity)
                    .font(.footnote)
                }
            }
            .navigationTitle(model.auth.appName)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .scrollDismissesKeyboard(.interactively)
            .sensoryFeedback(.error, trigger: errorMessage)
        }
    }

    private var canSubmit: Bool {
        !isWorking && !email.isEmpty && !password.isEmpty
            && (!asksForServer || !server.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    private func signIn() {
        guard canSubmit else { return }
        isWorking = true
        errorMessage = nil
        let target = asksForServer ? server : (AppConfig.defaultServer?.absoluteString ?? "")
        Task {
            defer { isWorking = false }
            do {
                try await model.auth.signIn(server: target, email: email, password: password)
                password = ""
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
