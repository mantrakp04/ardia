import Foundation
import SwiftData

@MainActor
public protocol DownloadStore: AnyObject {
  func loadDownloads() throws -> [DownloadItem]
  func saveDownload(_ item: DownloadItem) throws
  func deleteDownloads(_ ids: Set<UUID>) throws
}

@MainActor
public final class SwiftDataDownloadStore: DownloadStore {
  private let context: ModelContext

  public init(context: ModelContext) {
    self.context = context
  }

  public func loadDownloads() throws -> [DownloadItem] {
    try context.fetch(FetchDescriptor<DownloadRecord>(sortBy: [SortDescriptor(\.startedAt, order: .reverse)]))
      .map(Self.item(from:))
  }

  public func saveDownload(_ item: DownloadItem) throws {
    guard !item.isPrivate else { return }
    let id = item.id
    var descriptor = FetchDescriptor<DownloadRecord>(predicate: #Predicate { $0.id == id })
    descriptor.fetchLimit = 1
    let parts = Self.stateParts(item.state)
    if let record = try context.fetch(descriptor).first {
      record.fileName = item.fileName
      record.finishedAt = item.finishedAt
      record.receivedBytes = item.receivedBytes
      record.expectedBytes = item.expectedBytes
      record.stateRawValue = parts.state
      record.failureRawValue = parts.failure
      record.ownsFile = item.ownsFile
    } else {
      context.insert(DownloadRecord(
        id: item.id,
        fileName: item.fileName,
        sourceURL: item.sourceURL?.absoluteString,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        receivedBytes: item.receivedBytes,
        expectedBytes: item.expectedBytes,
        stateRawValue: parts.state,
        failureRawValue: parts.failure,
        ownsFile: item.ownsFile
      ))
    }
    try context.save()
  }

  public func deleteDownloads(_ ids: Set<UUID>) throws {
    guard !ids.isEmpty else { return }
    let list = Array(ids)
    for record in try context.fetch(FetchDescriptor<DownloadRecord>(predicate: #Predicate { list.contains($0.id) })) {
      context.delete(record)
    }
    try context.save()
  }

  static func stateParts(_ state: DownloadState) -> (state: String, failure: String?) {
    switch state {
    case .downloading: ("downloading", nil)
    case .finished: ("finished", nil)
    case .failed(let failure): ("failed", failure.rawValue)
    case .cancelled: ("cancelled", nil)
    }
  }

  static func item(from record: DownloadRecord) -> DownloadItem {
    let state: DownloadState = switch record.stateRawValue {
    case "downloading": .downloading
    case "finished": .finished
    case "cancelled": .cancelled
    default: .failed(record.failureRawValue.flatMap(DownloadFailure.init(rawValue:)) ?? .unknown)
    }
    return DownloadItem(
      id: record.id,
      fileName: record.fileName,
      sourceURL: record.sourceURL.flatMap(URL.init(string:)),
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      receivedBytes: record.receivedBytes,
      expectedBytes: record.expectedBytes,
      state: state,
      isPrivate: false,
      ownsFile: record.ownsFile
    )
  }
}
