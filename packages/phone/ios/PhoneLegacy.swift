import ArdiaBrowser
import ExpoModulesCore
import Foundation
import SwiftData

@MainActor
enum PhoneLegacy {
  static let defaultsPrefixes = ["blocking.", "browsing.", "defaultBrowser.", "filters.", "reader.", "settings.", "tabs."]

  static var storeFolders: [URL] {
    var folders: [URL] = []
    if let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: BrowserStore.appGroupIdentifier) {
      folders.append(group.appending(path: "Library/Application Support", directoryHint: .isDirectory))
    }
    folders.append(URL.applicationSupportDirectory.appending(path: "Ardia", directoryHint: .isDirectory))
    return folders
  }

  static var storeFolder: URL? {
    storeFolders.first { FileManager.default.fileExists(atPath: $0.appending(path: "Browser.store").path(percentEncoded: false)) }
  }

  static var isAvailable: Bool { storeFolder != nil || !preferences().isEmpty }

  static func read() throws -> [String: Any]? {
    guard isAvailable else { return nil }
    var result: [String: Any] = ["version": 1, "preferences": preferences()]
    result["store"] = storeFolder.map { $0.appending(path: "Browser.store").path(percentEncoded: false) }
    guard let source = storeFolder else {
      result["tabs"] = [Any]()
      result["archive"] = [Any]()
      result["visits"] = [Any]()
      return result
    }
    let copy = URL.temporaryDirectory.appending(path: "LegacyBrowserStore-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: copy) }
    try FileManager.default.createDirectory(at: copy, withIntermediateDirectories: true)
    let entries = try FileManager.default.contentsOfDirectory(atPath: source.path(percentEncoded: false))
    for name in entries where name.hasPrefix("Browser.store") || name == ".Browser_SUPPORT" {
      try FileManager.default.copyItem(at: source.appending(path: name), to: copy.appending(path: name))
    }
    let container = try BrowserStore.makeContainer(.directory(copy))
    let context = container.mainContext
    let tabs = try context.fetch(FetchDescriptor<BrowserTab>())
    let open = tabs.filter { !$0.isArchived }.sorted { $0.position < $1.position }
    let archived = tabs.filter(\.isArchived).sorted { ($0.archivedAt ?? .distantPast) > ($1.archivedAt ?? .distantPast) }
    let visits = try context.fetch(FetchDescriptor<Visit>(sortBy: [SortDescriptor(\.visitedAt, order: .reverse)]))
    result["tabs"] = open.map(tab)
    result["selectedTabId"] = open.max { $0.lastActive < $1.lastActive }?.id.uuidString
    result["archive"] = archived.map(tab)
    result["visits"] = visits.map(visit)
    return result
  }

  static func preferences() -> [String: Any] {
    var values: [String: Any] = [:]
    for (key, value) in UserDefaults.standard.dictionaryRepresentation() where defaultsPrefixes.contains(where: key.hasPrefix) {
      if let json = jsonValue(value) { values[key] = json }
    }
    return values
  }

  private static func tab(_ tab: BrowserTab) -> [String: Any] {
    var fields: [String: Any] = [
      "id": tab.id.uuidString,
      "url": tab.url,
      "title": tab.title,
      "created": milliseconds(tab.created),
      "lastActive": milliseconds(tab.lastActive),
      "position": tab.position,
      "origin": tab.originRawValue,
    ]
    if let archivedAt = tab.archivedAt { fields["archivedAt"] = milliseconds(archivedAt) }
    if let profile = tab.profileSyncId { fields["profileSyncId"] = profile }
    if let state = tab.interactionState { fields["savedState"] = state.base64EncodedString() }
    if let favicon = tab.faviconURL { fields["faviconUrl"] = favicon }
    if let theme = tab.themeColorHex { fields["themeColor"] = theme }
    if let name = tab.snapshotFileName {
      let path = URL.cachesDirectory.appending(path: "TabSnapshots").appending(path: name)
      if FileManager.default.fileExists(atPath: path.path(percentEncoded: false)) { fields["snapshotPath"] = path.path(percentEncoded: false) }
    }
    if let key = tab.receivedKey { fields["receivedKey"] = key }
    if let device = tab.receivedFromDevice { fields["receivedFromDevice"] = device }
    return fields
  }

  private static func visit(_ visit: Visit) -> [String: Any] {
    var fields: [String: Any] = [
      "url": visit.url,
      "title": visit.title,
      "visitedAt": milliseconds(visit.visitedAt),
      "transition": visit.transitionRawValue,
    ]
    if let profile = visit.profileSyncId { fields["profileSyncId"] = profile }
    return fields
  }

  private static func milliseconds(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

  private static func jsonValue(_ value: Any) -> Any? {
    switch value {
    case let date as Date: return milliseconds(date)
    case let data as Data:
      if let decoded = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) { return decoded }
      return data.base64EncodedString()
    case let array as [Any]: return array.compactMap(jsonValue)
    case let dictionary as [String: Any]: return dictionary.compactMapValues(jsonValue)
    case is String, is NSNumber: return value
    default: return nil
    }
  }

  static func dumpIfAsked() {
    guard UserDefaults.standard.bool(forKey: "ArdiaLegacyDump") else { return }
    do {
      guard let value = try read() else {
        NSLog("ARDIA_LEGACY none")
        return
      }
      let tabs = value["tabs"] as? [[String: Any]] ?? []
      let archive = value["archive"] as? [[String: Any]] ?? []
      let visits = value["visits"] as? [[String: Any]] ?? []
      NSLog("ARDIA_LEGACY keys=%@ tabs=%d archive=%d visits=%d selected=%@", value.keys.sorted().joined(separator: ","), tabs.count, archive.count, visits.count, value["selectedTabId"] as? String ?? "none")
      for (index, tab) in tabs.enumerated() { log("tab[\(index)]", tab) }
      for (index, tab) in archive.enumerated() { log("archive[\(index)]", tab) }
      for (index, visit) in visits.prefix(12).enumerated() { log("visit[\(index)]", visit) }
      log("preferences", value["preferences"] as? [String: Any] ?? [:])
      if UserDefaults.standard.bool(forKey: "ArdiaLegacyRestore"), let first = tabs.first(where: { $0["savedState"] != nil }) {
        restore(first)
      }
    } catch {
      NSLog("ARDIA_LEGACY failed: %@", String(describing: error))
    }
  }

  private static func log(_ label: String, _ fields: [String: Any]) {
    var shown = fields
    if let state = shown["savedState"] as? String { shown["savedState"] = "<\(state.count) base64 chars>" }
    guard let data = try? JSONSerialization.data(withJSONObject: shown, options: [.sortedKeys]) else { return }
    let text = String(decoding: data, as: UTF8.self)
    var offset = text.startIndex
    var part = 0
    while offset < text.endIndex {
      let end = text.index(offset, offsetBy: 700, limitedBy: text.endIndex) ?? text.endIndex
      NSLog("ARDIA_LEGACY %@#%d %@", label, part, String(text[offset..<end]))
      offset = end
      part += 1
    }
  }

  private static func restore(_ tab: [String: Any]) {
    let pageID = "legacy-restore"
    do {
      let page = try PhonePages.shared.open(pageID, url: tab["url"] as? String, title: tab["title"] as? String, isPrivate: false, savedState: tab["savedState"] as? String)
      Task { @MainActor in
        for _ in 0..<40 {
          try? await Task.sleep(for: .milliseconds(500))
          if !page.isLoading, page.url != nil, page.canGoBack || page.title.count > 0 { break }
        }
        NSLog("ARDIA_LEGACY restore tab=%@ savedUrl=%@ url=%@ title=%@ canGoBack=%d live=%d", tab["id"] as? String ?? "", tab["url"] as? String ?? "", page.url?.absoluteString ?? "nil", page.title, page.canGoBack ? 1 : 0, page.isLive ? 1 : 0)
        PhonePages.shared.close(pageID)
      }
    } catch {
      NSLog("ARDIA_LEGACY restore failed: %@", String(describing: error))
    }
  }
}

public final class LegacyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaLegacy")

    OnCreate {
      MainActor.assumeIsolated { PhoneLegacy.dumpIfAsked() }
    }

    AsyncFunction("available") { () -> Bool in
      MainActor.assumeIsolated { PhoneLegacy.isAvailable }
    }.runOnQueue(.main)

    AsyncFunction("read") { () -> [String: Any]? in
      try MainActor.assumeIsolated { try PhoneLegacy.read() }
    }.runOnQueue(.main)
  }
}
