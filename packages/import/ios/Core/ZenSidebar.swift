import Foundation

public struct ZenSidebar: Equatable {
  public var spaces: [SpaceSuggestion] = []
  public var essentials: [ImportedTab] = []
  public var favicons: [ImportedFavicon] = []

  public func favicons(for pages: [String]) -> [ImportedFavicon] {
    let wanted = Set(pages)
    var total = 0
    return favicons.filter { icon in
      guard wanted.contains(icon.page), total + icon.png.count <= ChromiumFavicons.maximumTotalBytes else { return false }
      total += icon.png.count
      return true
    }
  }

  public static func sessionFiles(profile: URL) -> [URL] {
    let fm = FileManager.default
    let backups = profile.appendingPathComponent("zen-sessions-backup", isDirectory: true)
    let dated = ((try? fm.contentsOfDirectory(atPath: backups.path)) ?? [])
      .filter { $0.hasPrefix("zen-sessions-") && $0.hasSuffix(".jsonlz4") }
      .sorted(by: >)
      .map { backups.appendingPathComponent($0) }
    let own = [profile.appendingPathComponent("zen-sessions.jsonlz4"), backups.appendingPathComponent("clean.jsonlz4")] + dated
    return (own + [Firefox.sessionFile(profile: profile)].compactMap { $0 }).filter { fm.fileExists(atPath: $0.path) }
  }

  public static func load(profile: URL, profileId: String, cancellation: Cancellation = .init()) throws -> ZenSidebar {
    let files = sessionFiles(profile: profile)
    guard !files.isEmpty else { throw ImportError.notFound("No Zen session in this profile") }
    var failure: Error?
    var parsed = false
    for file in files {
      try cancellation.check()
      do {
        let sidebar = try parse(Firefox.decompressMozLz4(Data(contentsOf: file)), profileId: profileId)
        parsed = true
        if !sidebar.spaces.isEmpty { return sidebar }
      } catch {
        failure = failure ?? error
      }
    }
    if !parsed, let failure { throw failure }
    return ZenSidebar()
  }

  struct Folder {
    var id: String
    var name: String
    var parent: String?
    var space: String?
    var previous: String??
    var live: Bool
    var split: Bool
  }

  typealias Entry = (key: String?, node: BookmarkNode)

  public static func parse(_ json: Data, profileId: String) throws -> ZenSidebar {
    guard let top = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else {
      throw ImportError.unreadable("Zen's session store is malformed")
    }
    let windows = top["windows"] == nil ? [top] : objects(top["windows"]).filter {
      $0["isPopup"] as? Bool != true && $0["isTaskbarTab"] as? Bool != true && $0["isPrivate"] as? Bool != true
    }

    var out = ZenSidebar()
    for window in windows {
      for space in objects(window["spaces"]) {
        guard let id = text(space["uuid"]), !out.spaces.contains(where: { $0.id == id }) else { continue }
        let colors = gradient(space["theme"])
        out.spaces.append(SpaceSuggestion(
          id: id,
          name: text(space["name"]) ?? "Space \(out.spaces.count + 1)",
          color: colors.first,
          colors: colors.isEmpty ? nil : colors,
          emoji: emoji(space["icon"]),
          icon: nil,
          profileId: profileId,
          pinned: [],
          tabs: []
        ))
      }
    }
    guard !out.spaces.isEmpty else { return out }

    var folders: [String: Folder] = [:]
    var folderOrder: [String] = []
    for window in windows {
      for f in objects(window["folders"]) {
        guard let id = text(f["id"]), folders[id] == nil else { continue }
        let previous: String?? = (f["prevSiblingInfo"] as? [String: Any]).map { text($0["id"]) }
        folders[id] = Folder(id: id, name: text(f["name"]) ?? "Folder", parent: text(f["parentId"]), space: text(f["workspaceId"]),
                             previous: previous, live: f["isLiveFolder"] as? Bool == true, split: f["splitViewGroup"] as? Bool == true)
        folderOrder.append(id)
      }
    }

    func spaceIndex(_ id: String?) -> Int {
      id.flatMap { id in out.spaces.firstIndex { $0.id == id } } ?? 0
    }

    var seenTabs = Set<String>()
    var essentialPages = Set<String>()
    var rootPins: [Int: [Entry]] = [:]
    var folderPins: [String: [Entry]] = [:]
    var folderSpace: [String: String] = [:]
    var iconPages = Set<String>()

    for window in windows {
      for tab in objects(window["tabs"]) {
        if tab["zenIsEmpty"] as? Bool == true || tab["zenIsGlance"] as? Bool == true || text(tab["zenLiveFolderItemId"]) != nil {
          continue
        }
        let syncId = text(tab["zenSyncId"])
        if let syncId, !seenTabs.insert(syncId).inserted { continue }
        let essential = tab["zenEssential"] as? Bool == true
        let pinned = essential || tab["pinned"] as? Bool == true
        guard let page = page(tab, pinned: pinned), let url = text(page["url"]) else { continue }
        let title = page["title"] as? String ?? ""
        let label = text(tab["zenStaticLabel"])
        let workspace = text(tab["zenWorkspace"])
        if !iconPages.contains(url), let png = png(pinned ? (tab["_zenPinnedInitialState"] as? [String: Any])?["image"] ?? tab["image"] : tab["image"]),
           let origin = URL(string: url), let scheme = origin.scheme, let host = origin.host, URL.isWebURL(url) {
          iconPages.insert(url)
          let port = origin.port.map { ":\($0)" } ?? ""
          out.favicons.append(ImportedFavicon(page: url, icon: "\(scheme)://\(host)\(port)/favicon.ico", png: png))
        }

        if essential {
          if essentialPages.insert(url).inserted {
            out.essentials.append(ImportedTab(url: url, title: title, pinned: true, customTitle: label))
          }
        } else if pinned {
          var link = BookmarkNode.link(label ?? title, url)
          if label != nil { link.pageTitle = title }
          if let group = text(tab["groupId"]), folders[group] != nil {
            folderPins[group, default: []].append((syncId, link))
            if let workspace, folderSpace[group] == nil { folderSpace[group] = workspace }
          } else {
            rootPins[spaceIndex(workspace), default: []].append((syncId, link))
          }
        } else {
          out.spaces[spaceIndex(workspace)].tabs.append(ImportedTab(
            url: url, title: title, customTitle: label,
            lastActive: (tab["lastAccessed"] as? NSNumber)?.doubleValue
          ))
        }
      }
    }

    func insert(_ entries: [Entry], after folder: String, into list: inout [Entry]) {
      switch folders[folder]?.previous {
      case .some(.some(let previous)):
        list.insert(contentsOf: entries, at: list.lastIndex { $0.key == previous }.map { $0 + 1 } ?? list.count)
      case .some(.none):
        list.insert(contentsOf: entries, at: 0)
      case .none:
        list.append(contentsOf: entries)
      }
    }

    var placed = Set<String>()
    func contents(_ id: String, depth: Int) -> [Entry] {
      var list = folderPins[id] ?? []
      guard depth < 32 else { return list }
      for child in folderOrder where folders[child]?.parent == id && !placed.contains(child) {
        insert(build(child, depth: depth + 1), after: child, into: &list)
      }
      return list
    }
    func build(_ id: String, depth: Int) -> [Entry] {
      guard let folder = folders[id], !folder.live, placed.insert(id).inserted else { return [] }
      let inside = contents(id, depth: depth)
      if folder.split { return inside }
      return [(id, .folder(folder.name, inside.map(\.node)))]
    }
    func spaceOf(_ id: String, depth: Int = 0) -> String? {
      guard depth < 32, let folder = folders[id] else { return nil }
      return folder.space ?? folderSpace[id] ?? folder.parent.flatMap { spaceOf($0, depth: depth + 1) }
    }

    let roots = folderOrder.filter { id in folders[id]?.parent.map { folders[$0] == nil } ?? true }
    for id in roots + folderOrder where !placed.contains(id) {
      let index = spaceIndex(spaceOf(id))
      var list = rootPins[index] ?? []
      insert(build(id, depth: 0), after: id, into: &list)
      rootPins[index] = list
    }
    for (index, list) in rootPins { out.spaces[index].pinned = list.map(\.node) }
    return out
  }

  static func page(_ tab: [String: Any], pinned: Bool) -> [String: Any]? {
    if pinned, let initial = (tab["_zenPinnedInitialState"] as? [String: Any])?["entry"] as? [String: Any], text(initial["url"]) != nil {
      return initial
    }
    let entries = objects(tab["entries"])
    guard !entries.isEmpty else { return nil }
    return entries[Firefox.entryIndex(tab["index"], count: entries.count)]
  }

  static func png(_ any: Any?) -> String? {
    let prefix = "data:image/png;base64,"
    guard let image = text(any), image.hasPrefix(prefix),
          image.utf8.count <= prefix.utf8.count + (ChromiumFavicons.maximumPNGBytes + 2) / 3 * 4 else { return nil }
    let encoded = String(image.dropFirst(prefix.count))
    guard let data = Data(base64Encoded: encoded), data.count <= ChromiumFavicons.maximumPNGBytes,
          data.starts(with: ChromiumFavicons.pngSignature) else { return nil }
    return data.base64EncodedString()
  }

  static func emoji(_ any: Any?) -> String? {
    guard let icon = text(any), icon.count <= 4, !icon.contains("/"), !icon.contains(":"),
          icon.unicodeScalars.contains(where: { $0.properties.isEmoji && $0.value > 0x7F }) else { return nil }
    return icon
  }

  static func gradient(_ theme: Any?) -> [String] {
    let stops = objects((theme as? [String: Any])?["gradientColors"])
    let ordered = stops.filter { $0["isPrimary"] as? Bool == true } + stops.filter { $0["isPrimary"] as? Bool != true }
    return ordered.compactMap { stop in
      if let c = stop["c"] as? [NSNumber], c.count >= 3 {
        return Hex.color(red: c[0].doubleValue / 255, green: c[1].doubleValue / 255, blue: c[2].doubleValue / 255)
      }
      if let css = text(stop["c"]), css.hasPrefix("#"), css.count == 7, UInt32(css.dropFirst(), radix: 16) != nil {
        return css.uppercased()
      }
      return nil
    }
  }

  static func objects(_ any: Any?) -> [[String: Any]] {
    (any as? [Any] ?? []).compactMap { $0 as? [String: Any] }
  }

  static func text(_ any: Any?) -> String? {
    (any as? String).flatMap { $0.isEmpty ? nil : $0 }
  }
}
