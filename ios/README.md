# AI Search for iOS

Native SwiftUI client for this repo's web app. Same accounts, same assistants, same conversations. Built for iPhone and iPhone Duo, following Apple's Human Interface Guidelines.

## Run it

Requirements: Xcode 27 or later (iOS 27 SDK; the fold APIs need 27.1).

1. Open `ios/AISearch.xcodeproj`.
2. Select the **AISearch** target, then **Signing & Capabilities**, and choose your team. Change the bundle id `example.documentsearch` if you need to.
3. Run on a simulator or a device. Use Device Hub to try the iPhone Duo poses.
4. On first launch, enter the web app's address (for example `app.tuempresa.cl`), your email and password.

Before TestFlight, set `AppConfig.defaultServer` in `AISearch/Core/AppConfig.swift` to the production URL. The server field then disappears from sign-in.

The web deployment must include `GET /api/mobile/config` and bearer-token support in `requireUser()` (both added with this app).

## How it talks to the server

- **Sign-in:** Supabase Auth password grant, against the project that `/api/mobile/config` names. The session lives in the keychain and refreshes itself.
- **Assistants and teams:** read straight from Supabase (`chatbots`, `teams`) with the user's token, so row-level security limits them to the user's teams, as on the web.
- **Everything else:** the web app's `/api` routes with `Authorization: Bearer <access token>`: `/api/chat` (streamed NDJSON), `/api/sessions`, `/api/history`, `/api/files`, `/api/files/:id/download?inline=1`.

Uploads, team management and admin tools stay on the web.

## Layout

| Where | What you see |
|---|---|
| iPhone, iPhone Duo outer display (compact width) | One pane: assistants, then conversations, then chat |
| iPhone Duo inner display (regular width) | `NavigationSplitView` with assistants, conversations and chat side by side |
| iPhone Duo partly folded | The split view adjusts its own columns. A chat that spans the fold keeps its text on the leading side (`ReservedRegion`, kind `.division`) |

Following the iPhone Duo HIG:

- No fixed widths. The chat column has a maximum width and shrinks with the display.
- Open chats live in `AppModel`, not in the views. Folding rebuilds the split view's columns, and a streaming answer and an unsent draft carry on.
- Toolbar items are `Label`s with a title and a symbol, so they read well in the vertical side bars and in the overflow menu. `visibilityPriority` keeps Nueva conversación visible longest and lets Ajustes overflow first.
- Standard system components only (split view, lists, sheets, alerts, toolbars), so bars move to the side and sheets avoid the fold without custom code.

Also from the iOS HIG: Dynamic Type text styles everywhere, SF Symbols, light and dark mode from the system, Liquid Glass on the composer, swipe actions and context menus on conversations, pull to refresh, search, haptics when an answer finishes, VoiceOver labels, and ⌘N and ⌘↩ with a hardware keyboard.

## Files

```
AISearch/
  App/        entry point, AppModel (selection, open chats)
  Core/       models, API client, Supabase auth, keychain, fold layout
  Features/
    SignIn/      sign-in form
    Assistants/  split view, assistant list, conversation list
    Chat/        chat, messages, Markdown, sources
    Library/     documents with Quick Look
    Settings/    account and sign-out
  Resources/  asset catalog (icon, accent color)
```

The Xcode project uses a synchronized folder, so new files under `AISearch/` are picked up without editing the project.
