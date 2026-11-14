import Foundation

public struct LegacyImportGate: Sendable {
  public let legacyStores: [URL]
  public let marker: URL

  public init(legacyStores: [URL], marker: URL) {
    self.legacyStores = legacyStores
    self.marker = marker
  }

  public var hasLegacyStore: Bool {
    legacyStores.contains { FileManager.default.fileExists(atPath: $0.path(percentEncoded: false)) }
  }

  public var imported: Bool {
    FileManager.default.fileExists(atPath: marker.path(percentEncoded: false))
  }

  public var holdsSync: Bool { hasLegacyStore && !imported }

  public func markImported(at time: Date = .now) throws {
    try FileManager.default.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
    let record = try JSONSerialization.data(withJSONObject: ["importedAt": (time.timeIntervalSince1970 * 1000).rounded()])
    try record.write(to: marker, options: .atomic)
  }
}
