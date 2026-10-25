import Foundation
import SwiftData

public enum TabOrigin: String, Codable, Sendable, CaseIterable {
  case typed
  case search
  case link
  case sync
  case share
  case browseForMe
  case sent
}

public enum VisitTransition: String, Codable, Sendable {
  case typed
  case link
  case backForward
  case formSubmit
  case restored
  case other
}

public enum BrowserSchemaV1: VersionedSchema {
  public static let versionIdentifier = Schema.Version(1, 0, 0)

  public static var models: [any PersistentModel.Type] {
    [BrowserTab.self, Visit.self, BrowseResult.self]
  }

  @Model
  public final class BrowserTab {
    #Unique<BrowserTab>([\.id])
    #Index<BrowserTab>([\.archivedAt], [\.lastActive], [\.position])

    public var id: UUID
    public var url: String
    public var title: String
    public var created: Date
    public var lastActive: Date
    public var archivedAt: Date?
    public var position: Double
    public var profileSyncId: String?
    @Attribute(.externalStorage) public var interactionState: Data?
    public var faviconURL: String?
    public var themeColorHex: String?
    public var snapshotFileName: String?
    public var originRawValue: String
    public var browseResultID: UUID?
    public var receivedKey: String?
    @Transient public var isPrivate = false

    public var origin: TabOrigin {
      get { TabOrigin(rawValue: originRawValue) ?? .typed }
      set { originRawValue = newValue.rawValue }
    }

    public var isArchived: Bool { archivedAt != nil }

    public init(
      id: UUID = UUID(),
      url: String,
      title: String = "",
      created: Date,
      position: Double,
      origin: TabOrigin,
      profileSyncId: String? = nil,
      browseResultID: UUID? = nil,
      receivedKey: String? = nil
    ) {
      self.id = id
      self.url = url
      self.title = title
      self.created = created
      self.lastActive = created
      self.archivedAt = nil
      self.position = position
      self.profileSyncId = profileSyncId
      self.interactionState = nil
      self.faviconURL = nil
      self.themeColorHex = nil
      self.snapshotFileName = nil
      self.originRawValue = origin.rawValue
      self.browseResultID = browseResultID
      self.receivedKey = receivedKey
    }
  }

  @Model
  public final class Visit {
    #Index<Visit>([\.url], [\.visitedAt], [\.profileSyncId, \.visitedAt])

    public var url: String
    public var title: String
    public var visitedAt: Date
    public var profileSyncId: String?
    public var transitionRawValue: String

    public var transition: VisitTransition {
      VisitTransition(rawValue: transitionRawValue) ?? .other
    }

    public init(url: String, title: String, visitedAt: Date, profileSyncId: String?, transition: VisitTransition) {
      self.url = url
      self.title = title
      self.visitedAt = visitedAt
      self.profileSyncId = profileSyncId
      self.transitionRawValue = transition.rawValue
    }
  }

  @Model
  public final class BrowseResult {
    #Unique<BrowseResult>([\.id])
    #Index<BrowseResult>([\.created])

    public var id: UUID
    public var query: String
    public var created: Date
    @Attribute(.externalStorage) public var payload: Data
    public var payloadVersion: Int

    public init(id: UUID = UUID(), query: String, created: Date, payload: Data, payloadVersion: Int) {
      self.id = id
      self.query = query
      self.created = created
      self.payload = payload
      self.payloadVersion = payloadVersion
    }
  }
}

public typealias BrowserTab = BrowserSchemaV1.BrowserTab
public typealias Visit = BrowserSchemaV1.Visit
public typealias BrowseResult = BrowserSchemaV1.BrowseResult

public enum BrowserMigrationPlan: SchemaMigrationPlan {
  public static var schemas: [any VersionedSchema.Type] { [BrowserSchemaV1.self] }
  public static var stages: [MigrationStage] { [] }
}

public enum BrowserStoreLocation: Sendable {
  case appGroup
  case directory(URL)
  case inMemory
}

public enum BrowserStore {
  public static let appGroupIdentifier = "group.com.ardia.ios"

  public static func makeContainer(_ location: BrowserStoreLocation) throws -> ModelContainer {
    let schema = Schema(versionedSchema: BrowserSchemaV1.self)
    let configuration: ModelConfiguration
    switch location {
    case .inMemory:
      configuration = ModelConfiguration("Browser", schema: schema, isStoredInMemoryOnly: true, allowsSave: true)
    case .directory(let directory):
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      configuration = ModelConfiguration(schema: schema, url: directory.appending(path: "Browser.store"))
    case .appGroup:
      if FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) != nil {
        configuration = ModelConfiguration("Browser", schema: schema, groupContainer: .identifier(appGroupIdentifier))
      } else {
        let support = URL.applicationSupportDirectory.appending(path: "Ardia", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        configuration = ModelConfiguration(schema: schema, url: support.appending(path: "Browser.store"))
      }
    }
    return try ModelContainer(for: schema, migrationPlan: BrowserMigrationPlan.self, configurations: [configuration])
  }
}
