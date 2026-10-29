#if DEBUG
import AppIntents

@MainActor
enum IntentHarness {
  private struct Unresolved: Error {}
  private struct UnknownIntent: Error { let name: String }

  static func run(_ name: String, _ args: [String: Any]) async -> [String: Any] {
    do {
      return ["ok": true, "value": try await perform(name, args) as Any]
    } catch is Unresolved {
      return ["ok": false, "unresolved": true]
    } catch let unknown as UnknownIntent {
      return ["ok": false, "error": "No intent named \(unknown.name)."]
    } catch let error as IntentError {
      return ["ok": false, "error": String(localized: error.localizedStringResource)]
    } catch {
      return ["ok": false, "error": "\(error)"]
    }
  }

  private static func perform(_ name: String, _ args: [String: Any]) async throws -> Any? {
    switch name {
    case "openURL":
      let intent = OpenURLIntent()
      guard let url = URL(string: args["url"] as? String ?? "") else { throw Unresolved() }
      intent.url = url
      intent.profile = try await profile(args["profileId"])
      intent.destination = (args["destination"] as? String).flatMap(LinkDestination.init(rawValue:))
      _ = try await intent.perform()
      return nil
    case "newTab":
      let intent = NewTabIntent()
      guard let found = try await profile(args["profileId"]) else { throw Unresolved() }
      intent.profile = found
      return try await intent.perform().value.map(plain)
    case "getOpenTabs":
      let intent = GetOpenTabsIntent()
      intent.profile = try await profile(args["profileId"])
      return try await intent.perform().value?.map(plain)
    case "switchToTab":
      let intent = SwitchToTabIntent()
      guard let found = try await tabs([args["tabId"] as? String ?? ""]).first else { throw Unresolved() }
      intent.tab = found
      try await closeSinceResolving(args)
      _ = try await intent.perform()
      return nil
    case "closeTabs":
      let intent = CloseTabsIntent()
      intent.tabs = try await tabs(args["tabIds"] as? [String] ?? [])
      try await closeSinceResolving(args)
      _ = try await intent.perform()
      return nil
    case "copyCleanLink":
      return try await CopyCleanLinkIntent().perform().value?.absoluteString
    default:
      throw UnknownIntent(name: name)
    }
  }

  private static func profile(_ id: Any?) async throws -> ProfileEntity? {
    guard let id = id as? String else { return nil }
    guard let found = try await ProfileEntity.defaultQuery.entities(for: [id]).first else { throw Unresolved() }
    return found
  }

  private static func closeSinceResolving(_ args: [String: Any]) async throws {
    for id in args["closedSinceResolving"] as? [String] ?? [] {
      _ = try await IntentBridge.run(["command": "closeTab", "tabId": id])
    }
  }

  private static func tabs(_ ids: [String]) async throws -> [TabEntity] {
    try await TabEntity.defaultQuery.entities(for: ids)
  }

  private static func plain(_ tab: TabEntity) -> [String: Any] {
    ["id": tab.id, "title": tab.title, "url": tab.url?.absoluteString as Any, "profile": tab.profile.name, "isPinned": tab.isPinned]
  }
}
#endif
