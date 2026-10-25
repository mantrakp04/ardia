import Foundation

public enum ChromiumFavicons {
  static let maximumPages = 1000
  static let maximumPNGBytes = 16 * 1024
  static let maximumTotalBytes = 6 * 1024 * 1024
  static let preferredWidth = 32
  static let pngSignature = Data([137, 80, 78, 71, 13, 10, 26, 10])

  public static func pages(of result: ImportResult) -> [String] {
    func links(_ node: BookmarkNode) -> [String] {
      node.type == .url ? node.url.map { [$0] } ?? [] : (node.children ?? []).flatMap(links)
    }
    let toolbar = (result.bookmarks?.children ?? []).filter { $0.role == "toolbar" }.flatMap(links)
    return result.favorites.map(\.url)
      + result.spaces.flatMap { $0.pinned.flatMap(links) + $0.tabs.map(\.url) }
      + result.tabs.map(\.url)
      + toolbar
  }

  public static func read(profiles: [URL], pages: [String]) -> [ImportedFavicon] {
    var wanted: [String] = []
    var seen = Set<String>()
    for page in pages where URL.isWebURL(page) && seen.insert(page).inserted {
      wanted.append(page)
      if wanted.count == maximumPages { break }
    }
    guard !wanted.isEmpty else { return [] }
    var found: [String: ImportedFavicon] = [:]
    var total = 0
    for profile in profiles {
      let missing = wanted.filter { found[$0] == nil }
      if missing.isEmpty || total >= maximumTotalBytes { break }
      guard let snapshot = try? SQLiteSnapshot(copying: profile.appendingPathComponent("Favicons")),
            snapshot.tableExists("icon_mapping") else { continue }
      for page in missing {
        guard let icon = lookUp(page, in: snapshot) else { continue }
        total += icon.png.count
        if total > maximumTotalBytes { break }
        found[page] = icon
      }
    }
    return wanted.compactMap { found[$0] }
  }

  static func lookUp(_ page: String, in snapshot: SQLiteSnapshot) -> ImportedFavicon? {
    let withoutFragment = String(page.prefix { $0 != "#" })
    for exact in withoutFragment == page ? [page] : [page, withoutFragment] {
      if let icon = first(page, in: snapshot, where: "icon_mapping.page_url = ?", [.text(exact)], order: "") { return icon }
    }
    guard let origin = origin(of: page) else { return nil }
    return first(page, in: snapshot, where: "icon_mapping.page_url >= ? AND icon_mapping.page_url < ?",
                 [.text(origin + "/"), .text(origin + "0"), .text(origin + "/")],
                 order: "icon_mapping.page_url = ? DESC, icon_mapping.id DESC,")
  }

  static func first(_ page: String, in snapshot: SQLiteSnapshot, where condition: String,
                    _ bindings: [SQLiteSnapshot.Value], order: String) -> ImportedFavicon? {
    var result: ImportedFavicon?
    try? snapshot.query("""
      SELECT favicons.url, favicon_bitmaps.image_data
      FROM icon_mapping
      JOIN favicons ON favicons.id = icon_mapping.icon_id
      JOIN favicon_bitmaps ON favicon_bitmaps.icon_id = favicons.id
      WHERE \(condition) AND favicons.icon_type = 1
        AND length(favicon_bitmaps.image_data) BETWEEN 1 AND \(maximumPNGBytes)
      ORDER BY \(order) CASE WHEN favicon_bitmaps.width >= \(preferredWidth) THEN favicon_bitmaps.width
        ELSE 1000000 - favicon_bitmaps.width END
      """, bindings) { row in
      guard let icon = row.text(0), let png = row.blob(1), png.starts(with: pngSignature) else { return true }
      result = ImportedFavicon(page: page, icon: icon, png: png.base64EncodedString())
      return false
    }
    return result
  }

  static func origin(of page: String) -> String? {
    guard let parts = URLComponents(string: page), let scheme = parts.scheme?.lowercased(),
          let host = parts.host?.lowercased(), !host.isEmpty else { return nil }
    return "\(scheme)://\(host)\(parts.port.map { ":\($0)" } ?? "")"
  }
}
