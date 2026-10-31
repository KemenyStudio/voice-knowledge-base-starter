import Foundation

enum AppConfig {
    /// Web deployment the app talks to. Set it before shipping to TestFlight so
    /// people never see the server field. When nil, sign-in asks for it.
    static let defaultServer: URL? = nil

    static let serverKey = "serverURL"

    /// Server chosen on this device, falling back to the build default.
    static var server: URL? {
        if let saved = UserDefaults.standard.string(forKey: serverKey), let url = URL(string: saved) {
            return url
        }
        return defaultServer
    }

    /// Accepts "app.example.com" or a full URL and returns the origin.
    static func normalizedServer(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard var components = URLComponents(string: text), components.host != nil else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
