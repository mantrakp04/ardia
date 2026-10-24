import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct ImportedFavicon: Codable, Equatable, Sendable {
  public var icon: String
  public var png: String
}

public enum FaviconReader {
  public enum Flavor { case chromium, firefox }

  struct Candidate {
    var id: Int64
    var url: String
    var width: Int64
  }

  static let maxPages = 2_000
  static let maxBytes = 1 << 20
  static let wantedWidth: Int64 = 32

  public static func load(_ flavor: Flavor, profile: URL, pages: [String]) throws -> [String: ImportedFavicon] {
    let wanted = Array(Set(pages.filter { host($0) != nil })).sorted().prefix(maxPages)
    guard !wanted.isEmpty else { return [:] }
    let file = profile.appendingPathComponent(flavor == .chromium ? "Favicons" : "favicons.sqlite")
    guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
    let db = try SQLiteSnapshot(copying: file)

    let hosts = Set(wanted.compactMap(host))
    var byPage: [String: [Candidate]] = [:]
    var byHost: [String: [Candidate]] = [:]
    func add(page: String, _ c: Candidate) {
      guard let h = host(page), hosts.contains(h) else { return }
      byPage[page, default: []].append(c)
      byHost[h, default: []].append(c)
    }
    switch flavor {
    case .chromium:
      guard db.tableExists("icon_mapping"), db.tableExists("favicon_bitmaps") else { return [:] }
      try db.query("""
        SELECT m.page_url, b.id, f.url, b.width FROM icon_mapping m
        JOIN favicons f ON f.id = m.icon_id JOIN favicon_bitmaps b ON b.icon_id = f.id
        WHERE f.icon_type = 1 AND length(b.image_data) BETWEEN 1 AND \(maxBytes)
        """) { row in
        if let page = row.text(0) { add(page: page, Candidate(id: row.int(1), url: row.text(2) ?? page, width: row.int(3))) }
        return true
      }
    case .firefox:
      guard db.tableExists("moz_icons"), db.tableExists("moz_pages_w_icons") else { return [:] }
      try db.query("""
        SELECT p.page_url, i.id, i.icon_url, i.width FROM moz_pages_w_icons p
        JOIN moz_icons_to_pages ip ON ip.page_id = p.id JOIN moz_icons i ON i.id = ip.icon_id WHERE length(i.data) BETWEEN 1 AND \(maxBytes)
        """) { row in
        if let page = row.text(0) { add(page: page, Candidate(id: row.int(1), url: row.text(2) ?? page, width: row.int(3))) }
        return true
      }
      try db.query("SELECT id, icon_url, width FROM moz_icons WHERE root = 1 AND length(data) BETWEEN 1 AND \(maxBytes)") { row in
        if let url = row.text(1), let h = host(url), hosts.contains(h) {
          byHost[h, default: []].append(Candidate(id: row.int(0), url: url, width: row.int(2)))
        }
        return true
      }
    }

    var pngs: [Int64: String] = [:]
    let sql = flavor == .chromium ? "SELECT image_data FROM favicon_bitmaps WHERE id = ?" : "SELECT data FROM moz_icons WHERE id = ?"
    func encoded(_ c: Candidate) throws -> String {
      if let known = pngs[c.id] { return known }
      var data: Data?
      try db.query(sql, [.int(c.id)]) { row in
        data = row.blob(0)
        return false
      }
      let png = data.flatMap(png)?.base64EncodedString() ?? ""
      pngs[c.id] = png
      return png
    }
    var out: [String: ImportedFavicon] = [:]
    for page in wanted {
      let exact = byPage[page] ?? byPage[page.replacingOccurrences(of: #"#.*$"#, with: "", options: .regularExpression)]
      for c in ranked(exact ?? []) + ranked(host(page).flatMap { byHost[$0] } ?? []) {
        let png = try encoded(c)
        if !png.isEmpty {
          out[page] = ImportedFavicon(icon: c.url, png: png)
          break
        }
      }
    }
    return out
  }

  static func ranked(_ candidates: [Candidate]) -> [Candidate] {
    func rank(_ c: Candidate) -> (Int, Int64) {
      guard c.width > 0, c.width < 1024 else { return (2, 0) }
      return c.width >= wantedWidth ? (0, c.width) : (1, -c.width)
    }
    return candidates.sorted { rank($0) < rank($1) }
  }

  static func host(_ url: String) -> String? {
    guard let c = URLComponents(string: url), let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
          let h = c.host, !h.isEmpty else { return nil }
    return "\(scheme)://\(h.lowercased())"
  }

  static let maxPixels = 64

  static func png(_ data: Data) -> Data? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else { return nil }
    func side(_ i: Int) -> Int {
      let props = CGImageSourceCopyPropertiesAtIndex(source, i, nil) as? [CFString: Any]
      return max(props?[kCGImagePropertyPixelWidth] as? Int ?? 0, props?[kCGImagePropertyPixelHeight] as? Int ?? 0)
    }
    let index = (0..<CGImageSourceGetCount(source)).min { abs(side($0) - Int(wantedWidth)) < abs(side($1) - Int(wantedWidth)) } ?? 0
    let isPNG = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
    if isPNG, (1...maxPixels).contains(side(index)) { return data }
    let options = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: maxPixels] as CFDictionary
    guard let image = side(index) > maxPixels
      ? CGImageSourceCreateThumbnailAtIndex(source, index, options)
      : CGImageSourceCreateImageAtIndex(source, index, nil) else { return nil }
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest) ? out as Data : nil
  }
}
