import Foundation

public struct SyncFolderLocation: Codable, Equatable, Sendable {
  public var bookmark: Data
  public var subfolder: String?
  public var name: String

  public init(bookmark: Data, subfolder: String?, name: String) {
    self.bookmark = bookmark
    self.subfolder = subfolder
    self.name = name
  }
}

public final class SyncFolderGrant: @unchecked Sendable {
  public let picked: URL
  public let folder: URL
  private let accessing: Bool

  init(picked: URL, folder: URL, accessing: Bool) {
    self.picked = picked
    self.folder = folder
    self.accessing = accessing
  }

  deinit {
    if accessing { picked.stopAccessingSecurityScopedResource() }
  }
}

public enum SyncFolderAccess {
  public static let folderNames = ["Ardia Sync", "Netnyahoo Sync"]

  public static func grant(picked url: URL) throws -> (SyncFolderGrant, SyncFolderLocation) {
    let accessing = url.startAccessingSecurityScopedResource()
    let subfolder = syncSubfolder(in: url)
    let folder = subfolder.map { url.appendingPathComponent($0, isDirectory: true) } ?? url
    let grant = SyncFolderGrant(picked: url, folder: folder, accessing: accessing)
    let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    return (grant, SyncFolderLocation(bookmark: bookmark, subfolder: subfolder, name: folder.lastPathComponent))
  }

  public enum Resolution {
    case resolved(SyncFolderGrant, refreshed: SyncFolderLocation?)
    case unavailable
  }

  public static func resolve(_ location: SyncFolderLocation) -> Resolution {
    var stale = false
    guard let url = try? URL(resolvingBookmarkData: location.bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
      return .unavailable
    }
    let accessing = url.startAccessingSecurityScopedResource()
    let folder = location.subfolder.map { url.appendingPathComponent($0, isDirectory: true) } ?? url
    let grant = SyncFolderGrant(picked: url, folder: folder, accessing: accessing)
    var refreshed: SyncFolderLocation?
    if stale, let bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
      refreshed = SyncFolderLocation(bookmark: bookmark, subfolder: location.subfolder, name: location.name)
    }
    return .resolved(grant, refreshed: refreshed)
  }

  static func syncSubfolder(in url: URL) -> String? {
    if holdsChains(url) { return nil }
    let present = folderNames.filter { isDirectory(url.appendingPathComponent($0, isDirectory: true)) }
    return present.first { holdsChains(url.appendingPathComponent($0, isDirectory: true)) } ?? present.first
  }

  static func holdsChains(_ url: URL) -> Bool {
    coordinatedListing(url).contains(where: isChainTag)
  }

  static func isChainTag(_ name: String) -> Bool {
    name.count == 26 && name.allSatisfy { "abcdefghijklmnopqrstuvwxyz234567".contains($0) }
  }

  static func isDirectory(_ url: URL) -> Bool {
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  static func coordinatedListing(_ url: URL) -> [String] {
    var names: [String] = []
    var error: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &error) { url in
      names = (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []
    }
    if error != nil { names = (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? [] }
    return names
  }
}
