import Foundation
import SwiftData

public enum BrowserSchemaV2: VersionedSchema {
  public static let versionIdentifier = Schema.Version(2, 0, 0)

  public static var models: [any PersistentModel.Type] {
    [BrowserSchemaV1.BrowserTab.self, BrowserSchemaV1.Visit.self, DownloadRecord.self, HiddenSyncedVisit.self, HistoryClearing.self]
  }

  @Model
  public final class DownloadRecord {
    #Unique<DownloadRecord>([\.id])
    #Index<DownloadRecord>([\.startedAt])

    public var id: UUID
    public var fileName: String
    public var sourceURL: String?
    public var startedAt: Date
    public var finishedAt: Date?
    public var receivedBytes: Int64
    public var expectedBytes: Int64?
    public var stateRawValue: String
    public var failureRawValue: String?
    public var ownsFile: Bool

    public init(id: UUID, fileName: String, sourceURL: String?, startedAt: Date, finishedAt: Date?, receivedBytes: Int64, expectedBytes: Int64?, stateRawValue: String, failureRawValue: String?, ownsFile: Bool) {
      self.id = id
      self.fileName = fileName
      self.sourceURL = sourceURL
      self.startedAt = startedAt
      self.finishedAt = finishedAt
      self.receivedBytes = receivedBytes
      self.expectedBytes = expectedBytes
      self.stateRawValue = stateRawValue
      self.failureRawValue = failureRawValue
      self.ownsFile = ownsFile
    }
  }

  @Model
  public final class HiddenSyncedVisit {
    #Unique<HiddenSyncedVisit>([\.fingerprint])
    #Index<HiddenSyncedVisit>([\.lastVisit])

    public var fingerprint: String
    public var lastVisit: Date

    public init(fingerprint: String, lastVisit: Date) {
      self.fingerprint = fingerprint
      self.lastVisit = lastVisit
    }
  }

  @Model
  public final class HistoryClearing {
    #Index<HistoryClearing>([\.end])

    public var start: Date?
    public var end: Date

    public init(start: Date?, end: Date) {
      self.start = start
      self.end = end
    }
  }
}

public typealias DownloadRecord = BrowserSchemaV2.DownloadRecord
public typealias HiddenSyncedVisit = BrowserSchemaV2.HiddenSyncedVisit
public typealias HistoryClearing = BrowserSchemaV2.HistoryClearing
