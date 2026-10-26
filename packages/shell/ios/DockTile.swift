import AppKit
import ArdiaCore
import CoreImage

enum DockTile {
  private static let domain = "com.apple.dock" as CFString
  private static let key = "persistent-apps" as CFString
  private static let background = LaunchConfig.shared.background

  private static var tiles: [[String: Any]] {
    CFPreferencesCopyAppValue(key, domain) as? [[String: Any]] ?? []
  }

  static var isInDock: Bool {
    let bundleId = Bundle.main.bundleIdentifier
    let path = Bundle.main.bundleURL.standardizedFileURL.path
    return tiles.contains { tile in
      let data = tile["tile-data"] as? [String: Any]
      if let id = data?["bundle-identifier"] as? String, id == bundleId { return true }
      let file = (data?["file-data"] as? [String: Any])?["_CFURLString"] as? String
      return file.flatMap(URL.init(string:))?.standardizedFileURL.path == path
    }
  }

  @discardableResult
  static func add() -> Bool {
    guard !isInDock else { return true }
    if background {
      NSLog("ArdiaSystem: background instance, not adding to the Dock")
      return false
    }
    let tile: [String: Any] = [
      "tile-type": "file-tile",
      "tile-data": [
        "bundle-identifier": Bundle.main.bundleIdentifier ?? "",
        "file-label": ProcessInfo.processInfo.processName,
        "file-type": 41,
        "file-data": ["_CFURLString": Bundle.main.bundleURL.absoluteString, "_CFURLStringType": 15],
      ] as [String: Any],
    ]
    CFPreferencesSetAppValue(key, (tiles + [tile]) as CFArray, domain)
    guard CFPreferencesAppSynchronize(domain) else { return false }
    let restart = Process()
    restart.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
    restart.arguments = ["Dock"]
    try? restart.run()
    return true
  }
}
