import AppIntents
import ArdiaBrowser
import CoreSpotlight
import Foundation
import SwiftData

@MainActor
final class SpotlightIndexer {
  static let fingerprintsKey = "system.spotlight.fingerprints"
  static let archiveLimit = 500
  static let debounce: Duration = .seconds(1.5)

  private let defaults: UserDefaults
  private var pending: Task<Void, Never>?

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func update(from app: AppModel) {
    guard !app.isDemo, CSSearchableIndex.isIndexingAvailable() else { return }
    pending?.cancel()
    pending = Task { [weak self, weak app] in
      try? await Task.sleep(for: Self.debounce)
      guard !Task.isCancelled, let self, let app else { return }
      await self.reindex(Self.entities(in: app))
    }
  }

  static func entities(in app: AppModel) -> [TabEntity] {
    let open = app.tabs.openTabs.filter { !$0.isPrivate }
    var descriptor = FetchDescriptor<BrowserTab>(
      predicate: #Predicate { $0.archivedAt != nil },
      sortBy: [SortDescriptor(\.archivedAt, order: .reverse)]
    )
    descriptor.fetchLimit = archiveLimit
    let archived = (try? app.tabs.context.fetch(descriptor)) ?? []
    let openIDs = Set(open.map(\.id))
    return (open + archived.filter { !openIDs.contains($0.id) && !$0.isPrivate })
      .filter { BrowserURL.isSyncable($0.url) || $0.origin == .browseForMe }
      .map(TabEntity.init)
  }

  private func reindex(_ entities: [TabEntity]) async {
    let previous = defaults.dictionary(forKey: Self.fingerprintsKey) as? [String: String]
    var current: [String: String] = [:]
    for entity in entities { current[entity.id.uuidString] = Self.fingerprint(entity) }
    let changed = entities.filter { previous?[$0.id.uuidString] != current[$0.id.uuidString] }
    let removed = (previous ?? [:]).keys.filter { current[$0] == nil }.compactMap(UUID.init(uuidString:))
    do {
      if previous == nil {
        try await CSSearchableIndex.default().deleteAppEntities(ofType: TabEntity.self)
      } else if !removed.isEmpty {
        try await CSSearchableIndex.default().deleteAppEntities(identifiedBy: removed, ofType: TabEntity.self)
      }
      if !changed.isEmpty {
        try await CSSearchableIndex.default().indexAppEntities(changed)
      }
    } catch {
      return
    }
    defaults.set(current, forKey: Self.fingerprintsKey)
    if !changed.isEmpty || !removed.isEmpty {
      ArdiaShortcuts.updateAppShortcutParameters()
    }
  }

  static func fingerprint(_ entity: TabEntity) -> String {
    var hash: UInt64 = 0xCBF2_9CE4_8422_2325
    let text = [entity.name, entity.url?.absoluteString ?? "", entity.isArchived ? "1" : "0"].joined(separator: "\u{1}")
    for byte in text.utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 0x0000_0100_0000_01B3
    }
    return String(hash, radix: 16)
  }

  nonisolated static func tabID(fromItemIdentifier identifier: String) -> UUID? {
    if let id = UUID(uuidString: identifier) { return id }
    let pattern = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/
    return identifier.firstMatch(of: pattern).flatMap { UUID(uuidString: String($0.output)) }
  }
}
