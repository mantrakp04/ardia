import AppIntents

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
  case notReady
  case tabClosed
  case profileGone
  case noTab
  case app(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notReady: "Ardia didn't finish starting in 20 seconds."
    case .tabClosed: "That tab is closed."
    case .profileGone: "That profile no longer exists."
    case .noTab: "There's no tab open in Ardia."
    case .app(let message): "\(message)"
    }
  }
}
