import ArdiaCore
import Foundation

enum ConfigFolder {
  static let readLimit = 1 << 20
  static let schemaNames: Set<String> = ["config.schema.json", "theme.schema.json"]
  private static let themeName = try! NSRegularExpression(pattern: "^themes/[a-z0-9][a-z0-9_-]*\\.json$")

  static var directory: String { LaunchConfig.shared.configDirectory }

  static func isWatchable(_ name: String) -> Bool {
    name == "config.json" || isThemeFile(name)
  }

  private static func isThemeFile(_ name: String) -> Bool {
    themeName.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
  }

  static func path(_ name: String) -> String { (directory as NSString).appendingPathComponent(name) }

  static func read(_ name: String) -> [String: Any] {
    guard name == "config.json" || isThemeFile(name) else { return ["status": "unreadable"] }
    return readRegularFile(path(name))
  }

  static func readRegularFile(_ path: String) -> [String: Any] {
    let fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
    if fd < 0 { return ["status": errno == ENOENT || errno == ENOTDIR ? "missing" : "unreadable"] }
    defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0 else { return ["status": "unreadable"] }
    guard info.st_mode & S_IFMT == S_IFREG else { return ["status": "notFile"] }
    guard info.st_size <= readLimit else { return ["status": "tooBig"] }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while data.count <= readLimit {
      let count = Darwin.read(fd, &buffer, buffer.count)
      if count < 0 {
        if errno == EINTR { continue }
        return ["status": "unreadable"]
      }
      if count == 0 { break }
      data.append(buffer, count: count)
    }
    guard data.count <= readLimit else { return ["status": "tooBig"] }
    guard let text = String(data: data, encoding: .utf8) else { return ["status": "unreadable"] }
    return ["status": "ok", "text": text]
  }

  static func folderExists() -> Bool {
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  static func writeSchemas(_ files: [String: String]) throws -> [String] {
    let schemaDir = try DocumentStore.url("config-schema").path
    try FileManager.default.createDirectory(atPath: schemaDir, withIntermediateDirectories: true)
    let folders = folderExists() ? [schemaDir, directory] : [schemaDir]
    var written: [String] = []
    for folder in folders {
      for (name, contents) in files where schemaNames.contains(name) {
        let target = (folder as NSString).appendingPathComponent(name)
        if let current = readRegularFile(target)["text"] as? String, current == contents { continue }
        try replace(target, with: Data(contents.utf8))
        written.append(target)
      }
    }
    return written
  }

  private static func replace(_ target: String, with data: Data) throws {
    let folder = (target as NSString).deletingLastPathComponent
    let name = (target as NSString).lastPathComponent
    let temp = (folder as NSString).appendingPathComponent(".\(name).\(getpid()).\(UUID().uuidString).tmp")
    let fd = open(temp, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0o644)
    guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    let wrote = data.withUnsafeBytes { bytes in Darwin.write(fd, bytes.baseAddress, bytes.count) }
    let closed = close(fd)
    guard wrote == data.count, closed == 0, rename(temp, target) == 0 else {
      let code = errno
      unlink(temp)
      throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
    }
  }
}
