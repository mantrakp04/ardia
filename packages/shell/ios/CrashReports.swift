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
    let usedImages = body["usedImages"] as? [[String: Any]] ?? []
    let images = usedImages.map(imageName)
    let threads = body["threads"] as? [[String: Any]] ?? []
    let faulting = body["faultingThread"] as? Int ?? threads.firstIndex { $0["triggered"] as? Bool == true } ?? 0
    let frames = threads.indices.contains(faulting) ? threads[faulting]["frames"] as? [[String: Any]] ?? [] : []
    func simplified(_ frames: [[String: Any]]) -> [[String: Any]] {
      frames.prefix(64).map { frame -> [String: Any] in
        let index = frame["imageIndex"] as? Int ?? -1
        var out: [String: Any] = ["image": images.indices.contains(index) ? images[index] : "???"]
        if let symbol = frame["symbol"] as? String { out["symbol"] = symbol }
        if let distance = frame["symbolLocation"] as? Int { out["symbolOffset"] = distance }
        if let offset = frame["imageOffset"] as? Int { out["offset"] = offset }
        return out
      }
    }
    var report: [String: Any] = ["time": time.timeIntervalSince1970 * 1000, "frames": simplified(frames)]
    if let thrown = body["lastExceptionBacktrace"] as? [[String: Any]], !thrown.isEmpty {
      report["exceptionFrames"] = simplified(thrown)
    }
    let appImages = bundledImages(usedImages, procPath: procPath)
    if !appImages.isEmpty { report["images"] = appImages }
    let thrown = thrownException(body)
    if let name = thrown.name { report["exceptionName"] = name }
    if let reason = thrown.reason { report["exceptionReason"] = reason }
    if let subtype = exception["subtype"] as? String, let kind = subtype.split(separator: " ").first {
      report["exceptionSubtype"] = String(kind)
    }
    for (key, value) in [
      ("incidentId", header["incident_id"]), ("appVersion", header["app_version"]), ("build", header["build_version"]),
      ("exceptionType", exception["type"]), ("signal", exception["signal"]),
    ] {
      if let value = value as? String { report[key] = value }
    }
    return report
  }

  private static func imageName(_ image: [String: Any]) -> String {
    if let name = image["name"] as? String, !name.isEmpty { return name }
    return (image["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? "???"
  }

  private static func bundledImages(_ images: [[String: Any]], procPath: String) -> [[String: String]] {
    guard let contents = procPath.range(of: ".app/Contents/", options: .backwards) else { return [] }
    let app = procPath[..<contents.lowerBound].split(separator: "/").last.map(String.init) ?? ""
    guard !app.isEmpty else { return [] }
    let bundle = "/\(app).app/Contents/"
    var seen = Set<String>()
    return images.compactMap { image -> [String: String]? in
      guard let path = image["path"] as? String, path.contains(bundle),
        let uuid = image["uuid"] as? String, seen.insert(uuid.lowercased()).inserted else { return nil }
      return ["name": imageName(image), "uuid": uuid.lowercased()]
    }.prefix(24).map { $0 }
  }

  private static func thrownException(_ body: [String: Any]) -> (name: String?, reason: String?) {
    let valid = try! NSRegularExpression(pattern: "^[A-Z][A-Za-z0-9_]{2,63}$")
    func checked(_ full: String) -> String? {
      let name = String(full.prefix { $0 != ":" })
      return valid.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) == nil ? nil : name
    }
    func firstLine(_ reason: String?) -> String? {
      guard let line = reason?.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first, !line.isEmpty else {
        return nil
      }
      return String(line)
    }
    if let details = body["exceptionReason"] as? [String: Any], let name = details["name"] as? String {
      return (checked(name), firstLine(details["composed_message"] as? String ?? details["format_string"] as? String))
    }
    let uncaught = try! NSRegularExpression(
      pattern: "uncaught exception '(.{1,2000}?)', reason: '(.*)'\\s*$", options: [.dotMatchesLineSeparators])
    let named = try! NSRegularExpression(pattern: "uncaught exception '([^']{1,64})'")
    for case let lines as [String] in (body["asi"] as? [String: Any] ?? [:]).values {
      for line in lines {
        let whole = NSRange(line.startIndex..., in: line)
        if let match = uncaught.firstMatch(in: line, range: whole),
          let name = Range(match.range(at: 1), in: line), let reason = Range(match.range(at: 2), in: line) {
          return (checked(String(line[name])), firstLine(String(line[reason])))
        }
        if let match = named.firstMatch(in: line, range: whole), let name = Range(match.range(at: 1), in: line) {
          return (checked(String(line[name])), nil)
        }
      }
    }
    return (nil, nil)
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
