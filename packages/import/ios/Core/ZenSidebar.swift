import Foundation

public enum ZenSidebar {
  public static func sessionFile(profile: URL) -> URL? {
    let zen = profile.appendingPathComponent("zen-sessions.jsonlz4")
    return FileManager.default.fileExists(atPath: zen.path) ? zen : Firefox.sessionFile(profile: profile)
  }

  public static func load(profile: URL, profileId: String) throws -> ArcSidebar {
    guard let file = sessionFile(profile: profile) else { throw ImportError.notFound("No Zen session in this profile") }
    return try parse(Firefox.decompressMozLz4(Data(contentsOf: file)), profileId: profileId)
  }

  public static func parse(_ json: Data, profileId: String) throws -> ArcSidebar {
    guard let top = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else {
      throw ImportError.unreadable("Zen session store is malformed")
    }
    let windows = top["windows"] as? [[String: Any]] ?? [top]
    var spaces: [SpaceSuggestion] = []
    var folders: [(id: String, space: String?, title: String, parent: String?)] = []
    for window in windows {
      for space in window["spaces"] as? [[String: Any]] ?? [] {
        guard let id = space["uuid"] as? String, !spaces.contains(where: { $0.id == id }) else { continue }
        let icon = space["icon"] as? String
        let colors = gradient(space["theme"])
        spaces.append(SpaceSuggestion(
          id: id, name: (space["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Space \(spaces.count + 1)",
          color: colors.first, colors: colors.isEmpty ? nil : colors,
          emoji: icon.flatMap { $0.isEmpty || $0.contains("/") ? nil : $0 },
          profileId: profileId, pinned: [], tabs: []
        ))
      }
      for folder in window["folders"] as? [[String: Any]] ?? [] {
        guard let id = folder["id"] as? String, !folders.contains(where: { $0.id == id }) else { continue }
        folders.append((id, folder["workspaceId"] as? String, folder["name"] as? String ?? "Folder", folder["parentId"] as? String))
      }
    }
    guard !spaces.isEmpty else { return ArcSidebar() }

    var out = ArcSidebar()
    var seenPins = Set<String>()
    var folderLinks: [String: [BookmarkNode]] = [:]
    func spaceIndex(_ id: String?) -> Int { id.flatMap { id in spaces.firstIndex { $0.id == id } } ?? 0 }

    for window in windows {
      for tab in window["tabs"] as? [[String: Any]] ?? [] {
        guard tab["zenIsEmpty"] as? Bool != true, tab["zenIsGlance"] as? Bool != true else { continue }
        let entries = tab["entries"] as? [[String: Any]] ?? []
        let current = entries.isEmpty ? nil : entries[min(max((tab["index"] as? Int ?? entries.count) - 1, 0), entries.count - 1)]
        let pinned = tab["pinned"] as? Bool == true
        let initialState = tab["_zenPinnedInitialState"] as? [String: Any]
        let initial = initialState?["entry"] as? [String: Any]
        let page = pinned ? initial ?? current : current
        guard let url = page?["url"] as? String, !url.isEmpty else { continue }
        let title = page?["title"] as? String ?? ""
        let label = (tab["zenStaticLabel"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        if out.icons[url] == nil, let image = imageData((pinned ? initialState?["image"] : nil) ?? tab["image"]) { out.icons[url] = image }

        if !pinned {
          spaces[spaceIndex(tab["zenWorkspace"] as? String)].tabs.append(ImportedTab(
            url: url, title: title, customTitle: label, groupId: tab["groupId"] as? String,
            lastActive: (tab["lastAccessed"] as? NSNumber)?.doubleValue))
          continue
        }
        guard seenPins.insert(tab["zenSyncId"] as? String ?? url).inserted else { continue }
        if tab["zenEssential"] as? Bool == true {
          out.favorites[profileId, default: []].append(ImportedTab(url: url, title: title, pinned: true, customTitle: label))
          continue
        }
        let node = BookmarkNode(type: .url, title: label ?? title, url: url, dateAdded: nil, children: nil, role: nil,
                                pageTitle: label == nil ? nil : title)
        if let group = tab["groupId"] as? String, folders.contains(where: { $0.id == group }) {
          folderLinks[group, default: []].append(node)
        } else {
          spaces[spaceIndex(tab["zenWorkspace"] as? String)].pinned.append(node)
        }
      }
    }

    var placed = Set<String>()
    func build(_ id: String, depth: Int) -> BookmarkNode {
      placed.insert(id)
      let title = folders.first { $0.id == id }?.title ?? "Folder"
      let children = depth < 16 ? folders.filter { $0.parent == id && !placed.contains($0.id) } : []
      let subfolders = children.map { build($0.id, depth: depth + 1) }
      return .folder(title, subfolders.filter { $0.linkCount > 0 } + (folderLinks[id] ?? []))
    }
    let roots = folders.filter { f in f.parent.map { p in !folders.contains { $0.id == p } } ?? true }
    for folder in roots + folders where !placed.contains(folder.id) {
      let node = build(folder.id, depth: 0)
      if node.linkCount > 0 { spaces[spaceIndex(folder.space)].pinned.append(node) }
    }
    out.spaces = spaces
    return out
  }

  static func imageData(_ value: Any?) -> Data? {
    guard var text = value as? String else { return nil }
    if text.hasPrefix("moz-remote-image:"), let inner = URLComponents(string: text)?.queryItems?.first(where: { $0.name == "url" })?.value {
      text = inner
    }
    guard text.utf8.count <= (FaviconReader.maxBytes / 3 + 1) * 4 + 64,
          text.hasPrefix("data:image/"), !text.hasPrefix("data:image/svg"), let comma = text.firstIndex(of: ","),
          text[..<comma].hasSuffix(";base64") else { return nil }
    return Data(base64Encoded: String(text[text.index(after: comma)...]))
  }

  static func gradient(_ theme: Any?) -> [String] {
    let stops = (theme as? [String: Any])?["gradientColors"] as? [[String: Any]] ?? []
    return stops.sorted { ($0["isPrimary"] as? Bool == true ? 0 : 1) < ($1["isPrimary"] as? Bool == true ? 0 : 1) }
      .compactMap { stop in
        guard let c = stop["c"] as? [NSNumber], c.count >= 3 else { return nil }
        return Hex.color(red: c[0].doubleValue / 255, green: c[1].doubleValue / 255, blue: c[2].doubleValue / 255)
      }
  }
}
