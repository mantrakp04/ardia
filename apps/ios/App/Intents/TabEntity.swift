import AppIntents
import ArdiaBrowser
import CoreSpotlight
import Foundation
import SwiftData
import UniformTypeIdentifiers

@AppEntity(schema: .browser.tab)
struct TabEntity: IndexedEntity {
  static let defaultQuery = TabEntityQuery()

  let id: UUID

  @Property(title: "Title")
  var name: String

  @Property(title: "URL")
  var url: URL?

  @Property(title: "Archived")
  var isArchived: Bool

  @Property(title: "Private")
  var isPrivate: Bool

  var lastActive: Date

  init(id: UUID, title: String, url: URL?, isArchived: Bool, lastActive: Date) {
    self.id = id
    self.lastActive = lastActive
    self.name = title
    self.url = url
    self.isArchived = isArchived
    self.isPrivate = false
  }

  var host: String? {
    url.flatMap { BrowserURL.host(of: $0.absoluteString) }
  }

  var isBrowseForMe: Bool {
    url?.scheme?.lowercased() == BrowserURL.browseScheme
  }

  var displayTitle: String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? (host ?? String(localized: "Untitled")) : trimmed
  }

  var subtitle: String {
    if isBrowseForMe { return String(localized: "Browse for Me") }
    let place = host ?? ""
    guard isArchived else { return place }
    return place.isEmpty ? String(localized: "Archived") : String(localized: "Archived · \(place)")
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: "\(displayTitle)",
      subtitle: "\(subtitle)",
      image: DisplayRepresentation.Image(systemName: isBrowseForMe ? "sparkle.magnifyingglass" : (isArchived ? "archivebox" : "globe"))
    )
  }

  var attributeSet: CSSearchableItemAttributeSet {
    let attributes = defaultAttributeSet
    attributes.title = displayTitle
    attributes.contentDescription = subtitle
    if let url, !isBrowseForMe {
      attributes.url = url
      attributes.contentURL = url
    }
    if let host { attributes.keywords = [host] }
    attributes.lastUsedDate = lastActive
    return attributes
  }

  init(_ tab: BrowserTab) {
    self.init(id: tab.id, title: tab.title, url: URL(string: tab.url), isArchived: tab.isArchived, lastActive: tab.lastActive)
  }
}

struct TabEntityQuery: EntityStringQuery {
  static let archiveSearchLimit = 30

  @Dependency var app: AppModel

  @MainActor
  func entities(for identifiers: [TabEntity.ID]) async throws -> [TabEntity] {
    identifiers.compactMap { id in
      guard let tab = app.tabs.tab(id), !tab.isPrivate else { return nil }
      return TabEntity(tab)
    }
  }

  @MainActor
  func suggestedEntities() async throws -> [TabEntity] {
    app.tabs.openTabs.sorted { $0.lastActive > $1.lastActive }.map(TabEntity.init)
  }

  @MainActor
  func entities(matching string: String) async throws -> [TabEntity] {
    let needle = string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else { return try await suggestedEntities() }
    let open = app.tabs.openTabs.filter {
      $0.title.localizedStandardContains(needle) || $0.url.localizedStandardContains(needle)
    }
    let openIDs = Set(open.map(\.id))
    let archived = app.tabs.searchArchive(needle).filter { !openIDs.contains($0.id) }.prefix(Self.archiveSearchLimit)
    return (open.sorted { $0.lastActive > $1.lastActive } + archived).map(TabEntity.init)
  }
}
