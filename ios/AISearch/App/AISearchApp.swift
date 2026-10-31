import SwiftUI

@main
struct AISearchApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Nueva conversación") { model.startConversation() }
                    .keyboardShortcut("n", modifiers: .command)
                    .disabled(model.selectedAssistantId == nil)
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.auth.isSignedIn {
                MainSplitView()
                    .transition(.opacity)
            } else {
                SignInView()
                    .transition(.opacity)
            }
        }
        .animation(.default, value: model.auth.isSignedIn)
        .onChange(of: model.auth.isSignedIn) { _, signedIn in
            if !signedIn { model.reset() }
        }
    }
}
