import Foundation

public enum DownloadFailure: String, Codable, Sendable, CaseIterable {
  case connection
  case storage
  case interrupted
  case unknown

  public init(_ error: any Error) {
    let error = error as NSError
    switch (error.domain, error.code) {
    case (NSURLErrorDomain, NSURLErrorNetworkConnectionLost), (NSURLErrorDomain, NSURLErrorNotConnectedToInternet),
         (NSURLErrorDomain, NSURLErrorTimedOut), (NSURLErrorDomain, NSURLErrorCannotConnectToHost),
         (NSURLErrorDomain, NSURLErrorCannotFindHost), (NSURLErrorDomain, NSURLErrorDNSLookupFailed),
         (NSURLErrorDomain, NSURLErrorInternationalRoamingOff), (NSURLErrorDomain, NSURLErrorDataNotAllowed):
      self = .connection
    case (NSCocoaErrorDomain, NSFileWriteOutOfSpaceError), (NSPOSIXErrorDomain, Int(ENOSPC)):
      self = .storage
    default:
      self = .unknown
    }
  }

  public var message: String {
    switch self {
    case .connection: String(localized: "The connection was lost.")
    case .storage: String(localized: "There isn’t enough space to save it.")
    case .interrupted: String(localized: "It stopped when Ardia closed.")
    case .unknown: String(localized: "The download didn’t finish.")
    }
  }
}

public enum DownloadState: Equatable, Sendable {
  case downloading
  case finished
  case failed(DownloadFailure)
  case cancelled
}

public struct DownloadItem: Identifiable, Equatable, Sendable {
  public let id: UUID
  public let fileName: String
  public let sourceURL: URL?
  public let startedAt: Date
  public let finishedAt: Date?
  public let receivedBytes: Int64
  public let expectedBytes: Int64?
  public let state: DownloadState
  public let isPrivate: Bool
  public let ownsFile: Bool

  public init(id: UUID, fileName: String, sourceURL: URL?, startedAt: Date, finishedAt: Date?, receivedBytes: Int64, expectedBytes: Int64?, state: DownloadState, isPrivate: Bool, ownsFile: Bool = false) {
    self.id = id
    self.fileName = fileName
    self.sourceURL = sourceURL
    self.startedAt = startedAt
    self.finishedAt = finishedAt
    self.receivedBytes = receivedBytes
    self.expectedBytes = expectedBytes
    self.state = state
    self.isPrivate = isPrivate
    self.ownsFile = ownsFile
  }

  public static func started(id: UUID, source: URL?, isPrivate: Bool, at date: Date) -> DownloadItem {
    DownloadItem(
      id: id,
      fileName: source?.lastPathComponent.removingPercentEncoding.flatMap { $0 == "/" ? nil : $0 } ?? "",
      sourceURL: source,
      startedAt: date,
      finishedAt: nil,
      receivedBytes: 0,
      expectedBytes: nil,
      state: .downloading,
      isPrivate: isPrivate
    )
  }

  public var isRunning: Bool { state == .downloading }
  public var sourceHost: String? { sourceURL.flatMap { BrowserURL.host(of: $0.absoluteString) } }

  public var fraction: Double? {
    if state == .finished { return 1 }
    guard let expectedBytes, expectedBytes > 0 else { return nil }
    return min(max(Double(receivedBytes) / Double(expectedBytes), 0), 1)
  }

  public var canRetry: Bool {
    guard sourceURL != nil, !isPrivate else { return false }
    switch state {
    case .failed, .cancelled: return true
    case .downloading, .finished: return false
    }
  }

  public func named(_ name: String) -> DownloadItem {
    copy(fileName: name)
  }

  public func placed(as name: String) -> DownloadItem {
    copy(fileName: name, ownsFile: true)
  }

  public func receiving(_ received: Int64, of expected: Int64?) -> DownloadItem {
    guard isRunning else { return self }
    return copy(receivedBytes: received, expectedBytes: .some(expected.flatMap { $0 > 0 ? $0 : nil }))
  }

  public func finishing(at date: Date, size: Int64?) -> DownloadItem {
    guard isRunning else { return self }
    let total = size ?? max(receivedBytes, expectedBytes ?? 0)
    return copy(finishedAt: .some(date), receivedBytes: total, expectedBytes: .some(total), state: .finished)
  }

  public func failing(_ failure: DownloadFailure, at date: Date) -> DownloadItem {
    guard isRunning else { return self }
    return copy(finishedAt: .some(date), state: .failed(failure))
  }

  public func cancelling(at date: Date) -> DownloadItem {
    guard isRunning else { return self }
    return copy(finishedAt: .some(date), state: .cancelled)
  }

  public func relaunched() -> DownloadItem {
    guard isRunning else { return self }
    return copy(state: .failed(.interrupted))
  }

  private func copy(
    fileName: String? = nil,
    finishedAt: Date?? = nil,
    receivedBytes: Int64? = nil,
    expectedBytes: Int64?? = nil,
    state: DownloadState? = nil,
    ownsFile: Bool? = nil
  ) -> DownloadItem {
    DownloadItem(
      id: id,
      fileName: fileName ?? self.fileName,
      sourceURL: sourceURL,
      startedAt: startedAt,
      finishedAt: finishedAt ?? self.finishedAt,
      receivedBytes: receivedBytes ?? self.receivedBytes,
      expectedBytes: expectedBytes ?? self.expectedBytes,
      state: state ?? self.state,
      isPrivate: isPrivate,
      ownsFile: ownsFile ?? self.ownsFile
    )
  }
}
