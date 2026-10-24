import Foundation

public enum ChromiumFavicons {
  static let maximumPages = 500
  static let preferredWidth = 32
  static let maximumPNGBytes = 64 * 1024
  static let pngSignature = Data([137, 80, 78, 71, 13, 10, 26, 10])

  public static func read(profile: URL, pages: [String]) -> [ImportedFavicon] {
    var seen = Set<String>()
    var selectedPages: [(page: String, key: String)] = []
    for page in pages where URL.isWebURL(page) {
      let key = String(page.prefix { $0 != "#" })
      guard seen.insert(key).inserted else { continue }
      selectedPages.append((page, key))
      if selectedPages.count == maximumPages { break }
    }
    guard !selectedPages.isEmpty else { return [] }
    do {
      let snapshot = try SQLiteSnapshot(copying: profile.appendingPathComponent("Favicons"))
      var icons: [ImportedFavicon] = []
      for (page, key) in selectedPages {
        try snapshot.query("""
          SELECT favicons.url, favicon_bitmaps.image_data
          FROM icon_mapping
          JOIN favicons ON favicons.id = icon_mapping.icon_id
          JOIN favicon_bitmaps ON favicon_bitmaps.icon_id = favicons.id
          WHERE icon_mapping.page_url = ? AND favicons.icon_type = 1
            AND length(favicon_bitmaps.image_data) <= ?
          ORDER BY CASE WHEN width >= ? THEN 0 ELSE 1 END,
            CASE WHEN width >= ? THEN width ELSE -width END
          """, [.text(key), .int(Int64(maximumPNGBytes)), .int(Int64(preferredWidth)), .int(Int64(preferredWidth))]) { row in
          guard let icon = row.text(0), let png = row.blob(1), png.count <= maximumPNGBytes, png.starts(with: pngSignature) else { return true }
          icons.append(ImportedFavicon(page: page, icon: icon, png: png.base64EncodedString()))
          return false
        }
      }
      return icons
    } catch {
      return []
    }
  }
}
