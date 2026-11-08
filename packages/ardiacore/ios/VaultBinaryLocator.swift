import Darwin
import Foundation

enum VaultBinaryLocator {
  static func directories() -> [String] {
    if let data = LaunchConfig.shared.dataDirectory {
      return [URL(fileURLWithPath: data, isDirectory: true).appendingPathComponent("Password Managers/bin", isDirectory: true).path]
    }
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "\(home)/.npm-global/bin", "/opt/local/bin", "\(home)/bin"]
  }

  static func locate(_ name: String) -> String? {
    guard !name.isEmpty, !name.contains("/"), !name.hasPrefix(".") else { return nil }
    for directory in directories() {
      let path = (directory as NSString).appendingPathComponent(name)
      if isTrusted(path) { return path }
    }
    return nil
  }

  static func isTrusted(_ path: String) -> Bool {
    let manager = FileManager.default
    guard path.hasPrefix("/"), manager.fileExists(atPath: path) else { return false }
    let resolved = (path as NSString).resolvingSymlinksInPath
    guard isOwnedSafely(path), isOwnedSafely((path as NSString).deletingLastPathComponent), isOwnedSafely(resolved),
      isOwnedSafely((resolved as NSString).deletingLastPathComponent), manager.isExecutableFile(atPath: resolved),
      let attributes = try? manager.attributesOfItem(atPath: resolved)
    else { return false }
    return (attributes[.type] as? FileAttributeType) == .typeRegular
  }

  private static func isOwnedSafely(_ path: String) -> Bool {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: path) else { return false }
    guard let owner = (attributes[.ownerAccountID] as? NSNumber)?.uint32Value, owner == 0 || owner == getuid() else { return false }
    if (attributes[.type] as? FileAttributeType) == .typeSymbolicLink { return true }
    guard let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue else { return false }
    return permissions & 0o002 == 0
  }
}
