import AppKit
import UniformTypeIdentifiers

struct VaultExportResult: Sendable {
  var saved = false
  var count = 0
  var declined = false

  func jsonObject() -> [String: Any] { ["saved": saved, "count": count, "declined": declined] }
}

extension VaultBroker {
  static let exportColumns = ["name", "url", "username", "password", "otp"]

  func export(_ id: String) async -> VaultExportResult {
    guard let provider = VaultRegistry.provider(id), isReady(id) else { return VaultExportResult() }
    let allowed = await VaultOwnerCheck.confirm("export your passwords")
    guard allowed else { return VaultExportResult(declined: true) }
    let listed = await items(of: provider)
    var rows = [Self.exportColumns]
    for item in listed {
      let outcome = await secret(provider, item: item.id, field: .password)
      var password = ""
      if case .success(let value) = outcome { password = value }
      let otp = cachedTotps[id]?[item.id].flatMap { $0.itemUpdatedAt == item.updatedAt ? $0.value : nil } ?? ""
      rows.append([item.title, item.urls.first ?? "", item.username, password, otp])
    }
    guard isReady(id) else { return VaultExportResult() }
    let text = VaultExportFile.csv(rows)
    let destination = await VaultExportFile.destination("\(provider.name) Passwords.csv")
    guard let destination else { return VaultExportResult(declined: true) }
    guard VaultExportFile.write(text, to: destination) else { return VaultExportResult() }
    return VaultExportResult(saved: true, count: listed.count)
  }
}

enum VaultExportFile {
  static func field(_ value: String) -> String {
    let needsQuotes = value.unicodeScalars.contains { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }
    guard needsQuotes else { return value }
    return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
  }

  static func csv(_ rows: [[String]]) -> String {
    rows.map { $0.map(field).joined(separator: ",") }.joined(separator: "\r\n") + "\r\n"
  }

  static func destination(_ filename: String) async -> URL? {
    if LaunchConfig.shared.background {
      guard let folder = LaunchConfig.shared.dataDirectory else { return nil }
      let url = URL(fileURLWithPath: folder, isDirectory: true).appendingPathComponent(filename)
      NSLog("[vaults] export save panel (background mode, not shown), writing %@", url.path)
      return url
    }
    return await withCheckedContinuation { (done: CheckedContinuation<URL?, Never>) in
      Task { @MainActor in
        ask(filename) { done.resume(returning: $0) }
      }
    }
  }

  @MainActor
  static func ask(_ filename: String, _ chosen: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = filename
    panel.allowedContentTypes = [.commaSeparatedText]
    panel.canCreateDirectories = true
    panel.message = "Anyone who can open this file can read your passwords."
    panel.begin { response in chosen(response == .OK ? panel.url : nil) }
  }

  static func write(_ text: String, to url: URL) -> Bool {
    let manager = FileManager.default
    if manager.fileExists(atPath: url.path) {
      guard (try? manager.removeItem(at: url)) != nil else { return false }
    }
    let descriptor = Darwin.open(url.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    guard descriptor >= 0 else { return false }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    do {
      try handle.write(contentsOf: Data(text.utf8))
      try handle.close()
      return true
    } catch {
      return false
    }
  }
}
