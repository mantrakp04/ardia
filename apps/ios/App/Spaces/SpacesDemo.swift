import Foundation

enum SpacesDemo {
  static let arguments = ProcessInfo.processInfo.arguments

  static var isDemo: Bool {
    arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo")
  }

  static func value(_ key: String) -> String? {
    guard isDemo, let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else { return nil }
    return arguments[index + 1]
  }

  static let space = value("-ArdiaSpace")
  static let deckQuery = value("-ArdiaDeckSearch")
  static let showsSpaceIcons = value("-ArdiaSpaceIcons").map { $0 == "YES" || $0 == "1" || $0 == "true" } ?? false

  @MainActor
  static func apply(to app: AppModel) {
    guard app.isDemo, let space else { return }
    app.selectSpace(space)
  }
}
