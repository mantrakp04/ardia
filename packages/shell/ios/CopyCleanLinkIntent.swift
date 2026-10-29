import AppIntents

struct CopyCleanLinkIntent: AppIntent {
  static let title: LocalizedStringResource = "Copy Clean Link"
  static let description = IntentDescription("Copies the front tab's link without its trackers, as Copy Link does, and passes it on.")

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<URL> {
    let copied = try await IntentBridge.run(["command": "copyLink"])
    guard let link = (copied["url"] as? String).flatMap(URL.init(string:)) else { throw IntentError.noTab }
    return .result(value: link)
  }
}
