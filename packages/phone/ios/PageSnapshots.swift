import ArdiaBrowser
import CryptoKit
import ExpoModulesCore
import Foundation
import Observation
import SwiftData
import UIKit
import WebKit

enum PageSnapshots {
  static var saved: URL { URL.applicationSupportDirectory.appending(path: "PageSnapshots", directoryHint: .isDirectory) }
  static var privateFolder: URL { URL.cachesDirectory.appending(path: "PrivatePageSnapshots", directoryHint: .isDirectory) }

  static func write(_ pageID: String, image: UIImage, isPrivate: Bool, quality: Int) async -> [String: Any]? {
    let folder = isPrivate ? privateFolder : saved
    let stem = fileStem(pageID)
    let width = Int((image.size.width * image.scale).rounded())
    let height = Int((image.size.height * image.scale).rounded())
    guard let data = image.jpegData(compressionQuality: CGFloat(min(max(quality, 1), 100)) / 100) else { return nil }
    let stamp = Int(Date.now.timeIntervalSince1970 * 1000)
    return await Task.detached(priority: .utility) { () -> [String: Any]? in
      let manager = FileManager.default
      guard (try? manager.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else { return nil }
      let target = folder.appending(path: "\(stem)-\(stamp).jpg")
      guard (try? data.write(to: target, options: .atomic)) != nil else { return nil }
      for old in older(in: folder, stem: stem) where old != target { try? manager.removeItem(at: old) }
      return ["path": target.path(percentEncoded: false), "uri": target.absoluteString, "width": width, "height": height, "route": "draw", "bytes": data.count]
    }.value
  }

  static func delete(_ pageID: String) {
    let stem = fileStem(pageID)
    for folder in [saved, privateFolder] {
      for file in older(in: folder, stem: stem) { try? FileManager.default.removeItem(at: file) }
    }
  }

  static func endPrivateBrowsing() {
    try? FileManager.default.removeItem(at: privateFolder)
  }

  private static func older(in folder: URL, stem: String) -> [URL] {
    let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.lastPathComponent.hasPrefix("\(stem)-") && $0.pathExtension == "jpg" }
  }

  static func fileStem(_ pageID: String) -> String {
    if pageID.count <= 64, pageID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }) { return pageID }
    return SHA256.hash(data: Data(pageID.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
  }
}
