import AppKit
import Foundation

public enum LegacyDockTile {
  static let dockDomain = "com.apple.dock" as CFString
  static let dockBundleId = "com.apple.dock"
  static let persistentApps = "persistent-apps" as CFString
  static let doneKey = "LegacyDockTileChecked"
  static let restartKey = "LegacyDockTileRestartPending"

  enum Identity: Hashable {
    case file(String)
    case absent
    case unknown
  }

  struct Disk {
    let identity: (String) -> Identity
    let caseInsensitive: Bool

    static func live(folder: URL) -> Disk {
      let values = try? folder.resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey])
      return Disk(
        identity: { path in
          var info = stat()
          if stat(path, &info) == 0 { return .file("\(info.st_dev):\(info.st_ino)") }
          return errno == ENOENT || errno == ENOTDIR ? .absent : .unknown
        },
        caseInsensitive: values?.volumeSupportsCaseSensitiveNames == false)
    }
  }

  struct Result {
    let tiles: [[String: Any]]?
    let keptLive: Bool
  }

  enum Kind {
    case other
    case dead, live
    case pinned, deadOurs
  }

  static func repointed(_ tiles: [[String: Any]], app: URL, bundleId: String, label: String, disk: Disk) -> Result {
    let appPath = lexical(app.path) ?? app.path
    let oldRaw = app.deletingLastPathComponent().appendingPathComponent(LegacyName.appFileName).path
    let oldPath = lexical(oldRaw) ?? oldRaw
    let appID = disk.identity(appPath), oldID = disk.identity(oldPath)
    func named(_ path: String, like other: String) -> Bool {
      (path as NSString).lastPathComponent.lowercased() == (other as NSString).lastPathComponent.lowercased()
    }
    func same(_ path: String, _ id: Identity, _ other: String, _ otherID: Identity) -> Bool {
      if case .file = id, case .file = otherID { return id == otherID }
      return disk.caseInsensitive ? path.lowercased() == other.lowercased() : path == other
    }
    let names: Set<String> = [(oldPath as NSString).lastPathComponent.lowercased(), (appPath as NSString).lastPathComponent.lowercased()]
    func kind(_ tile: [String: Any]) -> Kind {
      guard let data = tile["tile-data"] as? [String: Any] else { return .other }
      let tileId = (data["bundle-identifier"] as? String)?.lowercased()
      let oldById = tileId == LegacyName.bundleId, oursById = tileId == bundleId.lowercased()
      guard oldById || oursById || rawName(data).map(names.contains) == true, let path = filePath(data) else { return .other }
      guard oldById || oursById || named(path, like: oldPath) || named(path, like: appPath) else { return .other }
      let id = disk.identity(path)
      if case .file = id, case .file = appID, id == appID { return oldById ? .dead : .pinned }
      if oldById || (!oursById && named(path, like: oldPath) && same(path, id, oldPath, oldID)) {
        switch id {
        case .absent: return .dead
        case .file, .unknown: return .live
        }
      }
      guard oursById else { return .other }
      switch id {
      case .file: return .pinned
      case .absent: return .deadOurs
      case .unknown: return .other
      }
    }
    let kinds = tiles.map(kind)
    let keptLive = kinds.contains(.live)
    guard kinds.contains(.dead) else { return Result(tiles: nil, keptLive: keptLive) }
    var pinned = kinds.contains(.pinned)
    var result: [[String: Any]] = []
    for (tile, kind) in zip(tiles, kinds) {
      guard kind == .dead || kind == .deadOurs else {
        result.append(tile)
        continue
      }
      if pinned { continue }
      pinned = true
      result.append(rewritten(tile, app: app, bundleId: bundleId, label: label))
    }
    return Result(tiles: result, keptLive: keptLive)
  }

  static func rewritten(_ tile: [String: Any], app: URL, bundleId: String, label: String) -> [String: Any] {
    var tile = tile
    var data = (tile["tile-data"] as? [String: Any]) ?? [:]
    for key in ["book", "file-mod-date", "parent-mod-date"] { data.removeValue(forKey: key) }
    data["bundle-identifier"] = bundleId
    data["file-label"] = label
    data["file-data"] = ["_CFURLString": URL(fileURLWithPath: app.path, isDirectory: true).absoluteString, "_CFURLStringType": 15]
    tile["tile-data"] = data
    return tile
  }

  static func filePath(_ data: [String: Any]) -> String? {
    guard let file = data["file-data"] as? [String: Any], let string = file["_CFURLString"] as? String, !string.isEmpty,
      let type = file["_CFURLStringType"] as? Int else { return nil }
    switch type {
    case 0: return lexical(string)
    case 15:
      guard string.lowercased().hasPrefix("file:///") || string.lowercased().hasPrefix("file://localhost/"),
        let url = URL(string: string), url.isFileURL, url.path.hasPrefix("/") else { return nil }
      return lexical(url.path)
    default: return nil
    }
  }

  static func lexical(_ path: String) -> String? {
    guard path.hasPrefix("/") else { return nil }
    var parts: [Substring] = []
    for part in path.split(separator: "/") where part != "." {
      if part == ".." {
        _ = parts.popLast()
      } else {
        parts.append(part)
      }
    }
    return "/" + parts.joined(separator: "/")
  }

  static func rawName(_ data: [String: Any]) -> String? {
    guard let file = data["file-data"] as? [String: Any], let string = file["_CFURLString"] as? String else { return nil }
    let last = string.split(separator: "/").last.map(String.init) ?? ""
    return (last.removingPercentEncoding ?? last).lowercased()
  }

  public static func repointSoon(bundle: Bundle = .main) {
    #if !DEBUG
    guard !isTestInstance(ProcessInfo.processInfo.environment), let bundleId = bundle.bundleIdentifier,
      LegacyName.isSuccessor(bundleId) else { return }
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: doneKey) else { return }
    let app = bundle.bundleURL
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) {
      guard isInstalled(app) else { return }
      run(Seams(
        synchronize: { _ = CFPreferencesAppSynchronize(dockDomain) },
        read: { CFPreferencesCopyAppValue(persistentApps, dockDomain) as? [[String: Any]] },
        write: { tiles in
          CFPreferencesSetAppValue(persistentApps, tiles as CFArray, dockDomain)
          return CFPreferencesAppSynchronize(dockDomain)
        },
        restart: restartDock,
        flag: { defaults.bool(forKey: $0) },
        setFlag: { key, value in
          if value { defaults.set(true, forKey: key) } else { defaults.removeObject(forKey: key) }
          defaults.synchronize()
        },
        disk: .live(folder: app.deletingLastPathComponent())),
        app: app, bundleId: bundleId)
    }
    #endif
  }

  static func isTestInstance(_ env: [String: String]) -> Bool { env["ARDIA_DATA_DIR"] != nil || env["ARDIA_BACKGROUND"] != nil }

  struct Seams {
    let synchronize: () -> Void
    let read: () -> [[String: Any]]?
    let write: ([[String: Any]]) -> Bool
    let restart: () -> Bool
    let flag: (String) -> Bool
    let setFlag: (String, Bool) -> Void
    let disk: Disk
  }

  static func run(_ seams: Seams, app: URL, bundleId: String) {
    guard !seams.flag(doneKey) else { return }
    seams.synchronize()
    guard let tiles = seams.read() else { return }
    let label = app.deletingPathExtension().lastPathComponent
    final class Lookups {
      var ids: [String: Identity] = [:]
      var missed = false
    }
    let lookups = Lookups()
    let looking = Disk(identity: { path in
      if let id = lookups.ids[path] { return id }
      let id = seams.disk.identity(path)
      lookups.ids[path] = id
      return id
    }, caseInsensitive: seams.disk.caseInsensitive)
    let lookedUp = Disk(identity: { path in
      if let id = lookups.ids[path] { return id }
      lookups.missed = true
      return .unknown
    }, caseInsensitive: seams.disk.caseInsensitive)
    var result = repointed(tiles, app: app, bundleId: bundleId, label: label, disk: looking)
    let wasPending = seams.flag(restartKey)
    if result.tiles != nil {
      if !wasPending { seams.setFlag(restartKey, true) }
      seams.synchronize()
      let fresh = seams.read()
      let again = fresh.map { repointed($0, app: app, bundleId: bundleId, label: label, disk: lookedUp) }
      let wrote = !lookups.missed && again?.tiles.map(seams.write) == true
      guard !lookups.missed, let again else {
        if !wasPending { seams.setFlag(restartKey, false) }
        return
      }
      if !wrote {
        if !wasPending { seams.setFlag(restartKey, false) }
        guard again.tiles == nil else {
          NSLog("Ardia: couldn't repoint the Dock's \(LegacyName.appName) tile; trying again next launch")
          return
        }
      } else {
        NSLog("Ardia: the Dock's \(LegacyName.appName) tile now opens \(app.path); restarting the Dock")
      }
      result = again
    }
    if seams.flag(restartKey) {
      guard seams.restart() else {
        NSLog("Ardia: couldn't restart the Dock; trying again next launch")
        return
      }
      seams.setFlag(restartKey, false)
    }
    if !result.keptLive { seams.setFlag(doneKey, true) }
  }

  static func restartDock() -> Bool {
    NSRunningApplication.runningApplications(withBundleIdentifier: dockBundleId).allSatisfy { dock in
      dock.isTerminated || kill(dock.processIdentifier, SIGTERM) == 0 || errno == ESRCH
    }
  }

  static func isInstalled(_ app: URL) -> Bool {
    let path = app.standardizedFileURL.path
    guard !path.contains("/AppTranslocation/"), app.lastPathComponent != LegacyName.appFileName else { return false }
    let resolved = { (url: URL) in url.resolvingSymlinksInPath().standardizedFileURL.path }
    let folder = resolved(app.deletingLastPathComponent())
    let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")
    return folder == resolved(URL(fileURLWithPath: "/Applications")) || folder == resolved(home)
  }
}
