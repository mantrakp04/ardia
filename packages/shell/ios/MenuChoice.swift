import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

final class MenuChoice: NSObject {
  var chosen: String?
  @objc func choose(_ sender: NSMenuItem) { chosen = sender.representedObject as? String }

  static func testFile(flag: String, name: String) -> URL? {
    let config = LaunchConfig.shared
    guard config.testFlag(flag), let dir = config.dataDirectory else { return nil }
    return URL(fileURLWithPath: dir, isDirectory: true).appendingPathComponent(name)
  }

  static func testAnswer(dumping object: Any, to file: URL) -> String? {
    if JSONSerialization.isValidJSONObject(object),
       let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) {
      try? data.write(to: file, options: .atomic)
    }
    let pickFile = file.appendingPathExtension("pick")
    let pick = try? String(contentsOf: pickFile, encoding: .utf8)
    try? FileManager.default.removeItem(at: pickFile)
    return pick?.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func testPick(_ items: [MenuItem], dumpingTo file: URL, appContext: AppContext?) -> String? {
    guard let pick = testAnswer(dumping: items.map { $0.toDictionary(appContext: appContext) }, to: file), enabledIds(items).contains(pick) else { return nil }
    return pick
  }

  private static func enabledIds(_ items: [MenuItem]) -> Set<String> {
    var ids = Set<String>()
    for item in items where item.enabled && !item.separator {
      if let children = item.children {
        ids.formUnion(enabledIds(children))
      } else {
        ids.insert(item.id)
      }
    }
    return ids
  }
}
