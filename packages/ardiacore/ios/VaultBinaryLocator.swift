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
    guard let resolved = realPath(path), let linkDirectory = realPath((path as NSString).deletingLastPathComponent),
      isOwnedSafely(path), directoriesAreSafe(linkDirectory), isOwnedSafely(resolved),
      directoriesAreSafe((resolved as NSString).deletingLastPathComponent), manager.isExecutableFile(atPath: resolved),
      let attributes = try? manager.attributesOfItem(atPath: resolved)
    else { return false }
    return (attributes[.type] as? FileAttributeType) == .typeRegular
  }

  static func isTrustedDirectory(_ directory: String) -> Bool {
    guard directory.hasPrefix("/"), let resolved = realPath(directory) else { return false }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: resolved, isDirectory: &isDirectory), isDirectory.boolValue else { return false }
    return isOwnedSafely(resolved) && directoriesAreSafe((resolved as NSString).deletingLastPathComponent)
  }

  private static func realPath(_ path: String) -> String? {
    guard let pointer = realpath(path, nil) else { return nil }
    defer { free(pointer) }
    let resolved = String(cString: pointer)
    return resolved.hasPrefix("/") ? resolved : nil
  }

  private static func directoriesAreSafe(_ directory: String) -> Bool {
    var current = directory
    while true {
      guard current.hasPrefix("/"), isOwnedSafely(current, stickyAllowed: true) else { return false }
      if current == "/" { return true }
      current = (current as NSString).deletingLastPathComponent
    }
  }

  private static func isOwnedSafely(_ path: String, stickyAllowed: Bool = false) -> Bool {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: path) else { return false }
    guard let owner = (attributes[.ownerAccountID] as? NSNumber)?.uint32Value, owner == 0 || owner == getuid() else { return false }
    let type = attributes[.type] as? FileAttributeType
    if type == .typeSymbolicLink { return true }
    guard let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue else { return false }
    if permissions & 0o002 == 0 { return true }
    return stickyAllowed && type == .typeDirectory && permissions & 0o1000 != 0
  }
}
