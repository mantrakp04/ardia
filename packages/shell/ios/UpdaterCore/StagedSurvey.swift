import Foundation

enum StagedSurvey {
  struct Found: Equatable {
    let copy: ChannelSwitch.Copy
    let bundle: URL
    let channel: String?
  }

  static let sparkleInstallationPath = ["org.sparkle-project.Sparkle", "Installation"]

  static func root(caches: URL, bundleId: String) -> URL {
    ([bundleId] + sparkleInstallationPath).reduce(caches.resolvingSymlinksInPath().standardizedFileURL) {
      $0.appendingPathComponent($1, isDirectory: true)
    }
  }

  struct Survey: Equatable {
    var found: [Found] = []
    var residue: Set<ChannelSwitch.Residue> = []
    var blind = false
  }

  static let plistLimit = 4 << 20

  static func survey(caches: URL, bundleId: String) -> Survey {
    var folder = caches.resolvingSymlinksInPath().standardizedFileURL
    for name in [bundleId] + sparkleInstallationPath {
      folder.appendPathComponent(name, isDirectory: true)
      switch kind(folder.path) {
      case .directory: continue
      case .missing: return Survey()
      case .other, .unreadable: return Survey(blind: true)
      }
    }
    return copies(in: folder, bundleId: bundleId)
  }

  private enum Kind {
    case directory, missing, other, unreadable
  }

  private enum Inspection {
    case copy(Found), notOurs, gone, unreadable
  }

  private enum Read {
    case data(Data), missing, unreadable
  }

  private static func kind(_ path: String) -> Kind {
    var info = stat()
    guard lstat(path, &info) == 0 else { return errno == ENOENT || errno == ENOTDIR ? .missing : .unreadable }
    return (info.st_mode & S_IFMT) == S_IFDIR ? .directory : .other
  }

  private static func isMissing(_ error: Error) -> Bool {
    let error = error as NSError
    if error.domain == NSCocoaErrorDomain, [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return true }
    if error.domain == NSPOSIXErrorDomain, [Int(ENOENT), Int(ENOTDIR)].contains(error.code) { return true }
    return (error.userInfo[NSUnderlyingErrorKey] as? Error).map(isMissing) ?? false
  }

  private static func copies(in root: URL, bundleId: String) -> Survey {
    final class Box { var survey = Survey() }
    let box = Box()
    let mark = { (url: URL) in
      guard let folder = updateFolder(of: url, in: root) else { return box.survey.blind = true }
      var info = stat()
      if lstat(folder.path, &info) == 0 {
        box.survey.residue.insert(ChannelSwitch.Residue(folder: folder.path, device: UInt64(info.st_dev), inode: UInt64(info.st_ino)))
      } else if errno != ENOENT {
        box.survey.blind = true
      }
    }
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil, options: [.skipsPackageDescendants],
                                                     errorHandler: { url, error in
                                                       if !isMissing(error) { mark(url) }
                                                       return true
                                                     })
    else { return Survey(blind: true) }
    for case let url as URL in walk {
      if walk.level > 4 {
        walk.skipDescendants()
        continue
      }
      guard url.pathExtension == "app" else { continue }
      switch kind(url.path) {
      case .directory: break
      case .missing, .other: continue
      case .unreadable:
        mark(url)
        continue
      }
      switch inspect(url, in: root, bundleId: bundleId) {
      case .copy(let copy): box.survey.found.append(copy)
      case .notOurs, .gone: continue
      case .unreadable: mark(url)
      }
    }
    return box.survey
  }

  private static func read(_ url: URL) -> Read {
    let descriptor = open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else { return errno == ENOENT || errno == ENOTDIR ? .missing : .unreadable }
    defer { close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size <= plistLimit else { return .unreadable }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 64 << 10)
    while true {
      let count = Darwin.read(descriptor, &buffer, buffer.count)
      if count == 0 { return .data(data) }
      guard count > 0, data.count + count <= plistLimit else { return .unreadable }
      data.append(contentsOf: buffer[0..<count])
    }
  }

  private enum Folder: Equatable {
    case present(device: UInt64, inode: UInt64), gone, unreadable
  }

  private static func folder(_ url: URL) -> Folder {
    var stats = stat()
    guard lstat(url.path, &stats) == 0 else { return errno == ENOENT ? .gone : .unreadable }
    guard (stats.st_mode & S_IFMT) == S_IFDIR else { return .unreadable }
    return .present(device: UInt64(stats.st_dev), inode: UInt64(stats.st_ino))
  }

  private static func inspect(_ app: URL, in root: URL, bundleId: String) -> Inspection {
    guard let update = updateFolder(of: app, in: root) else { return .unreadable }
    let before = folder(update)
    guard case .present(let device, let inode) = before else { return before == .gone ? .gone : .unreadable }
    let data: Data
    switch read(app.appendingPathComponent("Contents/Info.plist")) {
    case .data(let contents): data = contents
    case .missing: return kind(app.path) == .missing ? .gone : .unreadable
    case .unreadable: return .unreadable
    }
    guard folder(update) == before else { return .unreadable }
    guard let info = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any] else { return .unreadable }
    guard info["CFBundleIdentifier"] as? String == bundleId else { return .notOurs }
    guard let build = info["CFBundleVersion"] as? String else { return .unreadable }
    let copy = ChannelSwitch.Copy(folder: update.path, device: device, inode: inode, build: build)
    return .copy(Found(copy: copy, bundle: app, channel: info["ACUpdateChannel"] as? String))
  }

  static func updateFolder(of bundle: URL, in root: URL) -> URL? {
    let base = root.standardizedFileURL.pathComponents
    let parts = bundle.standardizedFileURL.pathComponents
    guard parts.count > base.count, Array(parts.prefix(base.count)) == base else { return nil }
    return URL(fileURLWithPath: NSString.path(withComponents: Array(parts.prefix(base.count + 1))), isDirectory: true)
  }
}
