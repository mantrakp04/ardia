import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

enum DroppedLinks {
  static let maxItems = 50
  static let linkFileExtensions: Set<String> = ["webloc", "inetloc", "url"]
  private static let maxLinkFileSize = 64 * 1024

  static func webURL(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count < 8192, let url = URL(string: text), let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https", url.host?.isEmpty == false else { return nil }
    return url.absoluteString
  }

  static func hostLike(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.count < 2048, text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
    if let colon = text.firstIndex(of: ":") {
      let scheme = text[..<colon]
      if !scheme.isEmpty, scheme.allSatisfy({ $0.isLetter || $0.isNumber || "+.-".contains($0) }), !scheme.contains(".") {
        return webURL(text)
      }
    }
    return text.contains(".") ? text : nil
  }

  static func linkTarget(_ file: URL) -> String? {
    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? Int.max
    guard size <= maxLinkFileSize, let data = try? Data(contentsOf: file) else { return nil }
    if file.pathExtension.lowercased() == "url" {
      let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
      for line in text.components(separatedBy: .newlines) where line.lowercased().hasPrefix("url=") {
        return webURL(String(line.dropFirst(4)))
      }
      return nil
    }
    let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    return (plist?["URL"] as? String).flatMap(webURL)
  }

  static func fileURLs(_ pasteboard: NSPasteboard) -> [URL] {
    (pasteboard.pasteboardItems ?? []).compactMap { item -> URL? in
      guard let raw = item.string(forType: .fileURL), let url = URL(string: raw), url.isFileURL else { return nil }
      let path = ((url as NSURL).filePathURL ?? url).standardizedFileURL
      return path.isFileURL && path.path.hasPrefix("/") ? path : nil
    }
  }

  static func webURLs(_ pasteboard: NSPasteboard) -> [String] {
    (pasteboard.pasteboardItems ?? []).compactMap { $0.string(forType: .URL).flatMap(webURL) }
  }

  static func items(_ pasteboard: NSPasteboard) -> [[String: String]] {
    let files = fileURLs(pasteboard)
    if !files.isEmpty {
      return Array(files.prefix(maxItems).compactMap { file -> [String: String]? in
        if linkFileExtensions.contains(file.pathExtension.lowercased()) { return linkTarget(file).map { ["kind": "url", "url": $0] } }
        return FileManager.default.fileExists(atPath: file.path) ? ["kind": "file", "url": file.absoluteString] : nil
      })
    }
    let links = webURLs(pasteboard)
    if !links.isEmpty { return links.prefix(maxItems).map { ["kind": "url", "url": $0] } }
    if let text = pasteboard.string(forType: .string), let candidate = hostLike(text) {
      return [webURL(candidate).map { ["kind": "url", "url": $0] } ?? ["kind": "text", "text": candidate]]
    }
    return []
  }

  static func count(_ pasteboard: NSPasteboard) -> Int {
    items(pasteboard).count
  }
}
