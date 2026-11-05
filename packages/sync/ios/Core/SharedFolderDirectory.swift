import Foundation

public struct SharedFolderDirectory {
  public static let manifestName = ".ardia-folder.json"
  public static let linkExtension = "webloc"
  static let maxDepth = 8
  static let maxLinkBytes = 64 * 1024
  static let maxManifestBytes = 1024 * 1024
  static let placeholderSuffix = ".icloud"

  public let root: URL
  private let rootReal: String
  private let fileManager = FileManager.default

  public init(root: URL) {
    self.root = root.standardizedFileURL
    self.rootReal = Self.realPath(self.root.path) ?? self.root.path
  }

  public func read() -> [String: Any] {
    var info = stat()
    if stat(root.path, &info) != 0 {
      let code = errno
      guard code != ENOENT else { return ["exists": false] }
      return ["exists": false, "error": "Can’t open “\(root.lastPathComponent)”: \(String(cString: strerror(code)))"]
    }
    guard info.st_mode & S_IFMT == S_IFDIR else { return ["exists": false] }
    return ["exists": true, "root": level(URL(fileURLWithPath: rootReal, isDirectory: true), depth: 0)]
  }

  public func apply(json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8), let ops = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      throw Self.failure("The folder changes couldn’t be read.")
    }
    guard Self.isDirectoryFollowing(root.path) else { throw Self.failure("The folder “\(root.lastPathComponent)” is missing.") }
    var conflicts: [String] = []
    for op in ops {
      if let conflict = try apply(op) {
        conflicts.append(conflict)
        break
      }
    }
    return ["conflicts": conflicts]
  }

  public static func create(in parent: URL, named name: String) throws -> URL {
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
    let base = folderName(name)
    var number = 1
    while true {
      let candidate = parent.appendingPathComponent(number == 1 ? base : "\(base) \(number)", isDirectory: true)
      if mkdir(candidate.path, 0o755) == 0 { return candidate }
      guard errno == EEXIST else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
      number += 1
    }
  }

  static func folderName(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let visible = String(cleaned.drop(while: { $0 == "." }))
    var capped = ""
    for character in visible {
      guard capped.utf8.count + String(character).utf8.count <= 200 else { break }
      capped.append(character)
    }
    return capped.isEmpty ? "Shared Folder" : capped
  }

  enum Kind { case file, directory, symlink, other, missing, blocked }

  static func kind(of path: String) -> Kind {
    var info = stat()
    guard lstat(path, &info) == 0 else { return errno == ENOENT ? .missing : .blocked }
    switch info.st_mode & S_IFMT {
    case S_IFREG: return .file
    case S_IFDIR: return .directory
    case S_IFLNK: return .symlink
    default: return .other
    }
  }

  static func size(of path: String) -> Int {
    var info = stat()
    return lstat(path, &info) == 0 ? Int(info.st_size) : 0
  }

  static func isDirectoryFollowing(_ path: String) -> Bool {
    var folder: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &folder) && folder.boolValue
  }

  static func realPath(_ path: String) -> String? {
    guard let real = realpath(path, nil) else { return nil }
    defer { free(real) }
    return String(cString: real)
  }

  static func isLink(_ name: String) -> Bool {
    (name as NSString).pathExtension.lowercased() == linkExtension
  }

  private func level(_ directory: URL, depth: Int) -> [String: Any] {
    let names: [String]
    do {
      names = try fileManager.contentsOfDirectory(atPath: directory.path)
    } catch {
      return ["entries": [], "manifest": NSNull(), "manifestPending": true, "error": "Can’t read “\(directory.lastPathComponent)”: \(error.localizedDescription)"]
    }
    var entries: [[String: Any]] = []
    var manifest: Any = NSNull()
    var manifestPending = false
    let held = { (name: String, reason: String) in entries.append(["kind": "pending", "file": name, "reason": reason]) }
    for name in names.sorted() {
      let url = directory.appendingPathComponent(name)
      let kind = Self.kind(of: url.path)
      if name.hasPrefix(".") {
        if name == Self.manifestName {
          if kind == .file, waitingFor(url) == nil, let text = readText(url, limit: Self.maxManifestBytes) {
            manifest = text
          } else {
            manifestPending = true
          }
          continue
        }
        guard name.hasSuffix(Self.placeholderSuffix), kind == .file else { continue }
        let real = String(name.dropFirst().dropLast(Self.placeholderSuffix.count))
        try? fileManager.startDownloadingUbiquitousItem(at: directory.appendingPathComponent(real))
        if real == Self.manifestName {
          manifestPending = true
        } else if Self.isLink(real), !names.contains(real) {
          held(real, "download")
        }
        continue
      }
      switch kind {
      case .directory:
        let package = (try? url.resourceValues(forKeys: [.isPackageKey]))?.isPackage == true
        if package || depth >= Self.maxDepth {
          held(name, "unreadable")
        } else {
          let inner = level(url, depth: depth + 1)
          if let error = inner["error"] { return ["entries": [], "manifest": NSNull(), "manifestPending": true, "error": error] }
          entries.append(["kind": "dir", "file": name, "level": inner])
        }
      case .file where Self.isLink(name):
        if Self.size(of: url.path) > Self.maxLinkBytes {
          held(name, "unreadable")
        } else if let reason = waitingFor(url) {
          held(name, reason)
        } else if let text = readText(url, limit: Self.maxLinkBytes) {
          entries.append(["kind": "link", "file": name, "text": text])
        } else {
          held(name, "unreadable")
        }
      case .missing:
        continue
      case .blocked:
        return ["entries": [], "manifest": NSNull(), "manifestPending": true, "error": "Can’t read “\(name)” in “\(directory.lastPathComponent)”."]
      default:
        held(name, "unreadable")
      }
    }
    return ["entries": entries, "manifest": manifest, "manifestPending": manifestPending]
  }

  private func waitingFor(_ url: URL) -> String? {
    let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
    guard values?.isUbiquitousItem == true, let status = values?.ubiquitousItemDownloadingStatus, status != .current else { return nil }
    try? fileManager.startDownloadingUbiquitousItem(at: url)
    return "download"
  }

  static func boundedRead(_ path: String, limit: Int) -> Data? {
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    guard fd >= 0 else { return nil }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
      let data = try? handle.read(upToCount: limit + 1), data.count <= limit
    else { return nil }
    return data
  }

  private func readText(_ url: URL, limit: Int) -> String? {
    guard let data = try? coordinate(reading: url, { Self.boundedRead($0.path, limit: limit) }) ?? nil else { return nil }
    if data.starts(with: Array("bplist".utf8)) {
      guard let plist = try? PropertyListSerialization.propertyList(from: data, format: nil),
        let xml = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
      else { return nil }
      return String(data: xml, encoding: .utf8)
    }
    return String(data: data, encoding: .utf8)
  }

  private func linkURL(at url: URL) -> String? {
    guard let data = Self.boundedRead(url.path, limit: Self.maxLinkBytes),
      let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    else { return nil }
    return (plist["URL"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func apply(_ op: [String: Any]) throws -> String? {
    guard let kind = op["op"] as? String, let path = op["path"] as? String, let url = inside(path) else {
      throw Self.failure("A folder change pointed outside the shared folder.")
    }
    let name = url.lastPathComponent
    switch kind {
    case "write":
      guard let text = op["text"] as? String, Self.isLink(name) || name == Self.manifestName else {
        throw Self.failure("Only links and the folder’s order are written.")
      }
      return try write(Data(text.utf8), to: url, create: op["create"] as? Bool ?? true, expect: op["expect"] as? String) ? nil : path
    case "move":
      guard let toPath = op["to"] as? String, let to = inside(toPath) else { throw Self.failure("A rename pointed outside the shared folder.") }
      let from = Self.kind(of: url.path)
      guard from == .missing || from == .directory || (from == .file && Self.isLink(name)), Self.isLink(to.lastPathComponent) || from != .file else {
        throw Self.failure("Only links and folders are renamed.")
      }
      return try move(url, to: to) ? nil : toPath
    case "delete":
      guard Self.isLink(name), let expect = op["expect"] as? String else { throw Self.failure("Only links are deleted.") }
      return try delete(url, expect: expect) ? nil : path
    case "mkdir":
      switch Self.kind(of: url.path) {
      case .directory: return nil
      case .missing:
        guard mkdir(url.path, 0o755) == 0 || errno == EEXIST else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        return Self.kind(of: url.path) == .directory ? nil : path
      default: return path
      }
    case "rmdir":
      try removeEmptyDirectory(url)
      return nil
    default:
      throw Self.failure("Unknown folder change “\(kind)”.")
    }
  }

  private func inside(_ path: String) -> URL? {
    let parts = path.split(separator: "/", omittingEmptySubsequences: true)
    guard !parts.isEmpty, !path.hasPrefix("/"), !parts.contains(where: { $0 == ".." || $0 == "." }) else { return nil }
    var url = URL(fileURLWithPath: rootReal, isDirectory: true)
    for part in parts.dropLast() {
      url.appendPathComponent(String(part))
      let kind = Self.kind(of: url.path)
      guard kind == .directory || kind == .missing else { return nil }
    }
    url.appendPathComponent(String(parts.last!))
    guard Self.kind(of: url.path) != .symlink else { return nil }
    var parent = url.deletingLastPathComponent().path
    while Self.kind(of: parent) == .missing, parent.count > rootReal.count { parent = (parent as NSString).deletingLastPathComponent }
    guard let real = Self.realPath(parent), real == rootReal || real.hasPrefix(rootReal + "/") else { return nil }
    return url
  }

  private func write(_ data: Data, to url: URL, create: Bool, expect: String?) throws -> Bool {
    let directory = url.deletingLastPathComponent()
    guard Self.kind(of: directory.path) == .directory else { return false }
    let staging = try fileManager.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: directory, create: true)
    defer { try? fileManager.removeItem(at: staging) }
    let temporary = staging.appendingPathComponent(url.lastPathComponent)
    try data.write(to: temporary)
    var landed = false
    try coordinate(writing: url, options: .forReplacing) { target in
      switch Self.kind(of: target.path) {
      case .missing:
        guard create || expect == nil else { return }
        if renamex_np(temporary.path, target.path, UInt32(RENAME_EXCL)) == 0 {
          landed = true
        } else if errno != EEXIST {
          throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
      case .file:
        if create { return }
        if let expect, self.linkURL(at: target) != expect { return }
        _ = try self.fileManager.replaceItemAt(target, withItemAt: temporary)
        landed = true
      default:
        return
      }
    }
    return landed
  }

  private func move(_ from: URL, to: URL) throws -> Bool {
    guard Self.kind(of: from.path) != .missing else { return true }
    guard Self.kind(of: to.path) == .missing else { return false }
    var coordinationError: NSError?
    var bodyError: Error?
    var moved = false
    NSFileCoordinator(filePresenter: nil).coordinate(
      writingItemAt: from, options: .forMoving, writingItemAt: to, options: .forReplacing, error: &coordinationError
    ) { source, destination in
      guard Self.kind(of: destination.path) == .missing else { return }
      if renamex_np(source.path, destination.path, UInt32(RENAME_EXCL)) == 0 {
        moved = true
      } else if errno != EEXIST {
        bodyError = NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
      }
    }
    if let error = coordinationError ?? bodyError { throw error }
    return moved
  }

  private func delete(_ url: URL, expect: String) throws -> Bool {
    let placeholder = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent)\(Self.placeholderSuffix)")
    if Self.kind(of: url.path) == .missing, Self.kind(of: placeholder.path) == .file {
      try? fileManager.startDownloadingUbiquitousItem(at: url)
      return false
    }
    switch Self.kind(of: url.path) {
    case .file: break
    case .blocked: return false
    default: return true
    }
    try coordinate(writing: url, options: .forDeleting) { target in
      guard self.linkURL(at: target) == expect else { return }
      if unlink(target.path) != 0, errno != ENOENT { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }
    return true
  }

  private func removeEmptyDirectory(_ url: URL) throws {
    guard Self.kind(of: url.path) == .directory else { return }
    let housekeeping: Set<String> = [Self.manifestName, ".\(Self.manifestName)\(Self.placeholderSuffix)", ".DS_Store"]
    let names = try fileManager.contentsOfDirectory(atPath: url.path)
    guard names.allSatisfy(housekeeping.contains) else { return }
    let manifest = url.appendingPathComponent(Self.manifestName)
    let order = Self.kind(of: manifest.path) == .file ? Self.boundedRead(manifest.path, limit: Self.maxManifestBytes) : nil
    for name in housekeeping {
      let item = url.appendingPathComponent(name).path
      if Self.kind(of: item) == .file { unlink(item) }
    }
    guard rmdir(url.path) != 0 else { return }
    let code = errno
    if let order { restoreExclusively(order, at: manifest) }
    if code != ENOTEMPTY, code != ENOENT, code != EEXIST { throw NSError(domain: NSPOSIXErrorDomain, code: Int(code)) }
  }

  private func restoreExclusively(_ data: Data, at url: URL) {
    guard let staging = try? fileManager.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: url.deletingLastPathComponent(), create: true) else { return }
    defer { try? fileManager.removeItem(at: staging) }
    let temporary = staging.appendingPathComponent(url.lastPathComponent)
    guard (try? data.write(to: temporary)) != nil else { return }
    _ = renamex_np(temporary.path, url.path, UInt32(RENAME_EXCL))
  }

  private func coordinate(writing url: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordinationError) { url in
      do { try body(url) } catch { bodyError = error }
    }
    if let error = coordinationError ?? bodyError { throw error }
  }

  private func coordinate<T>(reading url: URL, _ body: (URL) throws -> T) throws -> T {
    var coordinationError: NSError?
    var result: Result<T, Error> = .failure(CocoaError(.fileReadUnknown))
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordinationError) { url in
      result = Result { try body(url) }
    }
    if let coordinationError { throw coordinationError }
    return try result.get()
  }

  static func failure(_ message: String) -> NSError {
    NSError(domain: "ArdiaSharedFolders", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
