import AppIntents

struct ProfileQuery: EntityQuery {
  @MainActor
  func entities(for identifiers: [String]) async throws -> [ProfileEntity] {
    try await IntentBridge.ready()
    return ProfileEntity.all.filter { identifiers.contains($0.id) }
  }

  @MainActor
  func suggestedEntities() async throws -> [ProfileEntity] {
    try await IntentBridge.ready()
    return ProfileEntity.all
  }
}
