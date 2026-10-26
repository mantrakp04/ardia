import Foundation

public struct ArcSidebar: Equatable {
  public var spaces: [SpaceSuggestion] = []
  public var favorites: [String: [ImportedTab]] = [:]

  public static func parse(_ data: Data) throws -> ArcSidebar {
    guard let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let sidebar = top["sidebar"] as? [String: Any],
          let containers = sidebar["containers"] as? [Any] else {
      throw ImportError.unreadable("StorableSidebar.json is not an Arc sidebar")
    }
    guard let box = mainContainer(containers) else { return ArcSidebar() }

    var items: [String: [String: Any]] = [:]
    for item in objects(box["items"]) {
      if let id = item["id"] as? String { items[id] = item }
    }

    var out = ArcSidebar()
    var untitled = 0
    for space in objects(box["spaces"]) {
      guard let id = space["id"] as? String else { continue }
      let profile = profileDirectory(space["profile"]) ?? "Default"
      let roots = containerIDs(space)
      var seen = Set<String>()
      let pinned = roots["pinned"].map { tree(of: $0, items: items, seen: &seen) } ?? []
      let today = roots["unpinned"].map { flatTabs(of: $0, items: items, seen: &seen, pinned: false) } ?? []
      let info = space["customInfo"] as? [String: Any]
      let icon = info?["iconType"] as? [String: Any]
      let name: String
      if let title = space["title"] as? String, !title.isEmpty {
        name = title
      } else {
        untitled += 1
        name = "Space \(untitled)"
      }
      let theme = bounded(info?["windowTheme"])
      out.spaces.append(SpaceSuggestion(
        id: id,
        name: name,
        color: midTone(theme),
        colors: gradient(theme),
        emoji: emoji(icon),
        icon: icon?["icon"] as? String,
        profileId: profile,
        pinned: pinned,
        tabs: today,
        theme: json(theme)
      ))
    }

    for (descriptor, container) in pairs(box["topAppsContainerIDs"]) {
      guard let profile = profileDirectory(descriptor), let container = container as? String else { continue }
      var seen = Set<String>()
      let tabs = flatTabs(of: container, items: items, seen: &seen, pinned: true)
      if !tabs.isEmpty { out.favorites[profile, default: []] += tabs }
    }
    return out
  }

  static let maxThemeBytes = 64 * 1024
  static let maxThemeDepth = 12
  static let maxThemeArray = 4
  static let maxThemeKeys = 32
  static let maxThemeString = 256
  static let maxThemeNodes = 2_048

  final class ThemeBudget {
    var nodes = ArcSidebar.maxThemeNodes
    var bytes = ArcSidebar.maxThemeBytes

    func spend(nodes: Int = 1, bytes: Int = 0) -> Bool {
      self.nodes -= nodes
      self.bytes -= bytes
      return self.nodes >= 0 && self.bytes >= 0
    }
  }

  static func bounded(_ any: Any?) -> Any? {
    let budget = ThemeBudget()
    guard let out = bounded(any, depth: 0, budget: budget), budget.nodes >= 0, budget.bytes >= 0 else { return nil }
    return out
  }

  private static func bounded(_ any: Any?, depth: Int, budget: ThemeBudget) -> Any? {
    guard let any, depth < maxThemeDepth, budget.spend(bytes: 8) else { return nil }
    switch any {
    case let d as [String: Any]:
      guard d.count <= maxThemeKeys else { return nil }
      var out: [String: Any] = [:]
      for key in d.keys.sorted() {
        guard key.utf8.count <= maxThemeString, budget.spend(nodes: 0, bytes: key.utf8.count) else { return nil }
        if let v = bounded(d[key], depth: depth + 1, budget: budget) { out[key] = v }
        if budget.nodes < 0 || budget.bytes < 0 { return nil }
      }
      return out
    case let a as [Any]:
      var out: [Any] = []
      for item in a.prefix(maxThemeArray) {
        if let v = bounded(item, depth: depth + 1, budget: budget) { out.append(v) }
        if budget.nodes < 0 || budget.bytes < 0 { return nil }
      }
      return out
    case let s as String:
      let cut = String(s.utf8.prefix(maxThemeString)) ?? ""
      return budget.spend(nodes: 0, bytes: cut.utf8.count) ? cut : nil
    case let n as NSNumber:
      return n
    default:
      return nil
    }
  }

  static func json(_ any: Any?) -> String? {
    guard let any, JSONSerialization.isValidJSONObject(any),
          let data = try? JSONSerialization.data(withJSONObject: any, options: [.sortedKeys]),
          data.count <= maxThemeBytes else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func mainContainer(_ containers: [Any]) -> [String: Any]? {
    let boxes = containers.map { $0 as? [String: Any] ?? [:] }
    let holdsSidebar = { (i: Int) in boxes[i]["spaces"] != nil || boxes[i]["items"] != nil }
    let after = { (i: Int, marker: String) in i > 0 && boxes[i - 1][marker] != nil }
    let index = boxes.indices.first { holdsSidebar($0) && after($0, "global") }
      ?? boxes.indices.first { holdsSidebar($0) && !after($0, "littleBrowser") }
    return index.map { boxes[$0] }
  }

  static func liveFolderRole(_ list: Any?) -> String? {
    guard let live = (list as? [String: Any])?["automaticLiveFolderData"],
          JSONSerialization.isValidJSONObject([live]),
          let data = try? JSONSerialization.data(withJSONObject: [live]),
          let text = String(data: data, encoding: .utf8)?.lowercased() else { return nil }
    if text.contains("bitbucket") { return "liveBitbucketPullRequests" }
    return text.contains("github") ? "liveGitHubPullRequests" : nil
  }

  static func objects(_ any: Any?) -> [[String: Any]] {
    (any as? [Any] ?? []).compactMap { $0 as? [String: Any] }
  }

  static func pairs(_ any: Any?) -> [(Any, Any)] {
    let list = any as? [Any] ?? []
    return stride(from: 0, to: list.count - 1, by: 2).map { (list[$0], list[$0 + 1]) }
  }

  static func profileDirectory(_ any: Any?) -> String? {
    guard let d = any as? [String: Any] else { return nil }
    if d["default"] != nil { return "Default" }
    guard let custom = (d["custom"] as? [String: Any])?["_0"] as? [String: Any],
          let dir = custom["directoryBasename"] as? String, !dir.isEmpty else { return nil }
    return dir
  }

  static func containerIDs(_ space: [String: Any]) -> [String: String] {
    var out: [String: String] = [:]
    for (label, value) in pairs(space["newContainerIDs"]) {
      guard let id = value as? String else { continue }
      if let d = label as? [String: Any], let key = d.keys.first { out[key] = out[key] ?? id }
    }
    for (label, value) in pairs(space["containerIDs"]) {
      if let key = label as? String, let id = value as? String { out[key] = out[key] ?? id }
    }
    return out
  }

  static func customTitle(_ item: [String: Any]) -> String? {
    (item["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
  }

  static func tab(_ item: [String: Any], pinned: Bool) -> ImportedTab? {
    guard let tab = (item["data"] as? [String: Any])?["tab"] as? [String: Any],
          let url = tab["savedURL"] as? String, !url.isEmpty else { return nil }
    let last = (tab["timeLastActiveAt"] as? NSNumber).map { ($0.doubleValue + 978_307_200) * 1000 }
    return ImportedTab(url: url, title: tab["savedTitle"] as? String ?? "", pinned: pinned,
                       customTitle: customTitle(item), lastActive: last)
  }

  static func tree(of containerID: String, items: [String: [String: Any]], seen: inout Set<String>, depth: Int = 0) -> [BookmarkNode] {
    guard depth < 64, let container = items[containerID], seen.insert(containerID).inserted else { return [] }
    var out: [BookmarkNode] = []
    for id in container["childrenIds"] as? [String] ?? [] {
      guard let item = items[id] else { continue }
      let data = item["data"] as? [String: Any] ?? [:]
      if let t = tab(item, pinned: true) {
        guard seen.insert(id).inserted else { continue }
        var link = BookmarkNode.link(t.customTitle ?? t.title, t.url)
        if t.customTitle != nil { link.pageTitle = t.title }
        out.append(link)
      } else if let role = liveFolderRole(data["list"]) {
        guard seen.insert(id).inserted else { continue }
        out.append(.folder(customTitle(item) ?? "Pull Requests", [], role: role))
      } else if data["list"] != nil {
        let kids = tree(of: id, items: items, seen: &seen, depth: depth + 1)
        out.append(.folder(customTitle(item) ?? "Folder", kids))
      } else if data["splitView"] != nil {
        out += tree(of: id, items: items, seen: &seen, depth: depth + 1)
      }
    }
    return out
  }

  static func flatTabs(of containerID: String, items: [String: [String: Any]], seen: inout Set<String>, pinned: Bool, depth: Int = 0) -> [ImportedTab] {
    guard depth < 64, let container = items[containerID], seen.insert(containerID).inserted else { return [] }
    var out: [ImportedTab] = []
    for id in container["childrenIds"] as? [String] ?? [] {
      guard let item = items[id] else { continue }
      if let t = tab(item, pinned: pinned) {
        if seen.insert(id).inserted { out.append(t) }
      } else {
        out += flatTabs(of: id, items: items, seen: &seen, pinned: pinned, depth: depth + 1)
      }
    }
    return out
  }

  static func emoji(_ icon: [String: Any]?) -> String? {
    if let e = icon?["emoji_v2"] as? String, !e.isEmpty { return e }
    if let e = icon?["emoji"] as? String, !e.isEmpty { return e }
    if let n = icon?["emoji"] as? Int, let scalar = Unicode.Scalar(n) { return String(Character(scalar)) }
    return nil
  }

  static func color(_ any: Any?) -> String? {
    guard let c = any as? [String: Any], let r = c["red"] as? Double, let g = c["green"] as? Double,
          let b = c["blue"] as? Double else { return nil }
    return Hex.color(red: r, green: g, blue: b)
  }

  static func midTone(_ theme: Any?) -> String? {
    if let palette = (theme as? [String: Any])?["primaryColorPalette"] as? [String: Any], let c = color(palette["midTone"]) {
      return c
    }
    return firstColor(theme, depth: 0)
  }

  private static func firstColor(_ any: Any?, depth: Int) -> String? {
    guard depth < 12 else { return nil }
    if let c = color(any) { return c }
    if let d = any as? [String: Any] {
      for key in d.keys.sorted() { if let c = firstColor(d[key], depth: depth + 1) { return c } }
    } else if let a = any as? [Any] {
      for v in a { if let c = firstColor(v, depth: depth + 1) { return c } }
    }
    return nil
  }

  static func gradient(_ theme: Any?) -> [String]? {
    func find(_ any: Any?, _ depth: Int) -> [Any]? {
      guard depth < 12 else { return nil }
      if let d = any as? [String: Any] {
        if let base = d["baseColors"] as? [Any] { return base }
        for key in d.keys.sorted() { if let r = find(d[key], depth + 1) { return r } }
      } else if let a = any as? [Any] {
        for v in a { if let r = find(v, depth + 1) { return r } }
      }
      return nil
    }
    let colors = (find(theme, 0) ?? []).compactMap { entry -> String? in
      color(entry) ?? firstColor(entry, depth: 0)
    }
    return colors.isEmpty ? nil : colors
  }
}
