import Foundation

enum StagedUpdateCopies {
  static let launchServicesTool = URL(
    fileURLWithPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
  static let unregisterDeadline: TimeInterval = 10

  static var userCaches: URL? {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
  }

  static func installationRoot(bundleId: String? = Bundle.main.bundleIdentifier, caches: URL? = userCaches) -> URL? {
    guard let bundleId, let caches else { return nil }
    var folder = caches.resolvingSymlinksInPath().standardizedFileURL
    for name in [bundleId] + StagedSurvey.sparkleInstallationPath {
      folder.appendPathComponent(name, isDirectory: true)
      guard isPlainDirectory(folder) else { return nil }
    }
    return folder
  }

  static func copies(bundleId: String? = Bundle.main.bundleIdentifier, caches: URL? = userCaches) -> [(bundle: Bundle, modified: Date)] {
    guard let bundleId, let root = installationRoot(bundleId: bundleId, caches: caches) else { return [] }
    let keys: [URLResourceKey] = [.contentModificationDateKey, .isSymbolicLinkKey]
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys,
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
    var found: [(bundle: Bundle, modified: Date)] = []
    for case let url as URL in walk {
      if walk.level > 4 { walk.skipDescendants(); continue }
      let values = try? url.resourceValues(forKeys: Set(keys))
      guard values?.isSymbolicLink != true, url.pathExtension == "app", let bundle = Bundle(url: url),
        bundle.infoDictionary?["CFBundleIdentifier"] as? String == bundleId
      else { continue }
      found.append((bundle, values?.contentModificationDate ?? .distantPast))
    }
    return found
  }

  static func unregister(_ bundle: URL, tool path: URL = launchServicesTool, deadline: TimeInterval = unregisterDeadline) {
    let tool = Process()
    tool.executableURL = path
    tool.arguments = ["-u", bundle.path]
    tool.standardInput = FileHandle.nullDevice
    tool.standardOutput = FileHandle.nullDevice
    tool.standardError = FileHandle.nullDevice
    let ended = DispatchSemaphore(value: 0)
    tool.terminationHandler = { _ in ended.signal() }
    do {
      try tool.run()
    } catch {
      return NSLog("Ardia: couldn't unregister \(bundle.path) from Launch Services: \(error.localizedDescription)")
    }
    guard ended.wait(timeout: .now() + deadline) == .timedOut else { return }
    NSLog("Ardia: lsregister didn't unregister \(bundle.path) within \(Int(deadline)) s; stopping it")
    tool.terminate()
    if ended.wait(timeout: .now() + 1) == .timedOut { kill(tool.processIdentifier, SIGKILL) }
  }

  static func isPlainDirectory(_ url: URL) -> Bool {
    var info = stat()
    return lstat(url.path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFDIR
  }
}
