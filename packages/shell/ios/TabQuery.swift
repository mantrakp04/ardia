import AppIntents

struct TabQuery: EntityStringQuery {
  @MainActor
  func entities(for identifiers: [String]) async throws -> [TabEntity] {
    try await IntentBridge.ready()
    return TabEntity.open.filter { identifiers.contains($0.id) }
  }

  @MainActor
  func entities(matching string: String) async throws -> [TabEntity] {
    try await IntentBridge.ready()
    return TabEntity.open.filter {
      $0.title.localizedCaseInsensitiveContains(string) || ($0.url?.absoluteString.localizedCaseInsensitiveContains(string) ?? false)
    }
  }

  @MainActor
  func suggestedEntities() async throws -> [TabEntity] {
    try await IntentBridge.ready()
    return TabEntity.open
  }
}
