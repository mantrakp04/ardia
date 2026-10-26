import AppKit
import MachO
import ExpoModulesCore

enum CrashReports {
  static func since(_ since: Double) -> [[String: Any]] {
    guard let executable = Bundle.main.executableURL else { return [] }
    let exe = executable.resolvingSymlinksInPath().path
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    var reports: [[String: Any]] = []
    for url in files where url.pathExtension == "ips" && url.lastPathComponent.hasPrefix("\(executable.lastPathComponent)-") {
      guard let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
        modified.timeIntervalSince1970 * 1000 > since,
        let report = parse(url, executable: exe, time: modified) else { continue }
      reports.append(report)
    }
    return Array(reports.sorted { ($0["time"] as? Double ?? 0) < ($1["time"] as? Double ?? 0) }.suffix(5))
  }

  private static func isThisExecutable(procPath: String, sliceUUID: String?, executable: String) -> Bool {
    if let sliceUUID, let ours = executableUUID, sliceUUID.lowercased() != ours { return false }
    if procPath == executable { return true }
    let pattern = procPath.replacingOccurrences(of: "?", with: "\\?").replacingOccurrences(of: "/Users/USER/", with: "/Users/*/")
    return NSPredicate(format: "SELF LIKE %@", pattern).evaluate(with: executable)
  }

  private static let executableUUID: String? = {
    guard let header = _dyld_get_image_header(0) else { return nil }
    var command = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
    for _ in 0..<header.pointee.ncmds {
      let load = command.assumingMemoryBound(to: load_command.self).pointee
      if load.cmd == UInt32(LC_UUID) {
        return UUID(uuid: command.assumingMemoryBound(to: uuid_command.self).pointee.uuid).uuidString.lowercased()
      }
      command = command.advanced(by: Int(load.cmdsize))
    }
    return nil
  }()

  private static func parse(_ url: URL, executable: String, time: Date) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url), let newline = data.firstIndex(of: 0x0A),
      let header = (try? JSONSerialization.jsonObject(with: data[..<newline])) as? [String: Any],
      let body = (try? JSONSerialization.jsonObject(with: data[data.index(after: newline)...])) as? [String: Any],
      let procPath = body["procPath"] as? String,
      isThisExecutable(procPath: procPath, sliceUUID: header["slice_uuid"] as? String, executable: executable)
    else { return nil }
    let exception = body["exception"] as? [String: Any] ?? [:]
    let images = (body["usedImages"] as? [[String: Any]] ?? []).map { image -> String in
      if let name = image["name"] as? String, !name.isEmpty { return name }
      return (image["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? "???"
    }
    let threads = body["threads"] as? [[String: Any]] ?? []
    let faulting = body["faultingThread"] as? Int ?? threads.firstIndex { $0["triggered"] as? Bool == true } ?? 0
    let frames = threads.indices.contains(faulting) ? threads[faulting]["frames"] as? [[String: Any]] ?? [] : []
    func simplified(_ frames: [[String: Any]]) -> [[String: Any]] {
      frames.prefix(64).map { frame -> [String: Any] in
        let index = frame["imageIndex"] as? Int ?? -1
        var out: [String: Any] = ["image": images.indices.contains(index) ? images[index] : "???"]
        if let symbol = frame["symbol"] as? String { out["symbol"] = symbol }
        if let offset = frame["imageOffset"] as? Int { out["offset"] = offset }
        return out
      }
    }
    var report: [String: Any] = ["time": time.timeIntervalSince1970 * 1000, "frames": simplified(frames)]
    if let thrown = body["lastExceptionBacktrace"] as? [[String: Any]], !thrown.isEmpty {
      report["exceptionFrames"] = simplified(thrown)
    }
    if let name = exceptionName(body) { report["exceptionName"] = name }
    for (key, value) in [
      ("incidentId", header["incident_id"]), ("appVersion", header["app_version"]), ("build", header["build_version"]),
      ("exceptionType", exception["type"]), ("signal", exception["signal"]),
    ] {
      if let value = value as? String { report[key] = value }
    }
    return report
  }

  private static func exceptionName(_ body: [String: Any]) -> String? {
    let valid = try! NSRegularExpression(pattern: "^[A-Z][A-Za-z0-9_]{2,63}$")
    func checked(_ full: String) -> String? {
      let name = String(full.prefix { $0 != ":" })
      return valid.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) == nil ? nil : name
    }
    if let reason = body["exceptionReason"] as? [String: Any], let name = reason["name"] as? String {
      return checked(name)
    }
    let uncaught = try! NSRegularExpression(pattern: "uncaught exception '([^']{1,64})'")
    for case let lines as [String] in (body["asi"] as? [String: Any] ?? [:]).values {
      for line in lines {
        guard let match = uncaught.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
          let range = Range(match.range(at: 1), in: line) else { continue }
        return checked(String(line[range]))
      }
    }
    return nil
  }

  #if DEBUG
  @inline(never) static func crashForTesting(_ kind: String?) {
    if kind == "exception" {
      _ = NSArray().object(at: 3)
    }
    let pointer = UnsafeMutablePointer<Int>(bitPattern: 0x10)!
    pointer.pointee = 1
  }
  #endif
}
