import AppKit
import MachO
import Metal
import VideoToolbox
import ExpoModulesCore

enum CrashReports {
  private static let perProcessKind = 5

  static func since(_ since: Double) -> [[String: Any]] {
    guard let executable = Bundle.main.executableURL else { return [] }
    let ours = Owner(
      executable: executable.resolvingSymlinksInPath().path,
      bundle: Bundle.main.bundleURL.resolvingSymlinksInPath().path,
      bundleId: Bundle.main.bundleIdentifier ?? "",
      version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String)
    let prefixes = [executable.lastPathComponent] + helpers.map(\.name)
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    var reports: [[String: Any]] = []
    for url in files where url.pathExtension == "ips" && prefixes.contains(where: { url.lastPathComponent.hasPrefix("\($0)-") }) {
      guard let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
        modified.timeIntervalSince1970 * 1000 > since,
        let report = parse(url, owner: ours, time: modified) else { continue }
      reports.append(report)
    }
    let sorted = reports.sorted { ($0["fileTime"] as? Double ?? 0) < ($1["fileTime"] as? Double ?? 0) }
    let browser = sorted.filter { $0["process"] as? String == "browser" }.suffix(perProcessKind)
    let helperReports = sorted.filter { $0["process"] as? String != "browser" }.suffix(perProcessKind)
    return (browser + helperReports).sorted { ($0["fileTime"] as? Double ?? 0) < ($1["fileTime"] as? Double ?? 0) }
  }

  private struct Owner {
    let executable: String
    let bundle: String
    let bundleId: String
    let version: String?
  }

  private static let helpers: [(name: String, bundleId: String?)] = {
    guard let frameworks = Bundle.main.privateFrameworksURL else { return [] }
    let folder = frameworks.appendingPathComponent("Chromium Framework.framework/Versions/Current/Helpers")
    let entries = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    return entries.filter { $0.hasSuffix(".app") }.map { entry in
      (String(entry.dropLast(4)), Bundle(url: folder.appendingPathComponent(entry))?.bundleIdentifier)
    }
  }()

  private static func isOurs(bundleId: String?, owner: Owner) -> Bool {
    guard let bundleId else { return true }
    return bundleId == owner.bundleId || helpers.contains { $0.bundleId == bundleId }
  }

  private static func process(procPath: String, header: [String: Any], mainThread: String?, owner: Owner) -> String? {
    guard isOurs(bundleId: header["bundleID"] as? String, owner: owner),
      let contents = procPath.range(of: ".app/Contents/") else { return nil }
    let inside = String(procPath[contents.upperBound...])
    let candidate = "\(owner.bundle)/Contents/\(inside)"
    let pattern = procPath.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "?", with: "\\?")
      .replacingOccurrences(of: "/Users/USER/", with: "/Users/*/")
    guard procPath == candidate || NSPredicate(format: "SELF LIKE %@", pattern).evaluate(with: candidate) else { return nil }
    if candidate == owner.executable {
      if let sliceUUID = header["slice_uuid"] as? String, let running = executableUUID, sliceUUID.lowercased() != running,
        header["app_version"] as? String == owner.version {
        return nil
      }
      return "browser"
    }
    guard inside.contains("/Helpers/") else { return nil }
    switch mainThread {
    case "CrRendererMain": return "renderer"
    case "CrGpuMain": return "gpu"
    case "CrUtilityMain": return "utility"
    default: break
    }
    let name = URL(fileURLWithPath: procPath).lastPathComponent
    if name.contains("(Renderer)") || name.contains(" Renderer)") { return "renderer" }
    if name.contains("GPU)") { return "gpu" }
    if name.contains("Alerts)") { return "alerts" }
    if name.contains("Plugin)") { return "plugin" }
    return "utility"
  }

  private static func mainThreadName(_ body: [String: Any]) -> String? {
    let threads = body["threads"] as? [[String: Any]] ?? []
    return threads.first { $0["queue"] as? String == "com.apple.main-thread" }?["name"] as? String
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

  private static let reportDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
    return formatter
  }()

  private static func reportTime(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    return reportDate.date(from: text.replacingOccurrences(of: "\\.\\d+", with: "", options: .regularExpression))
  }

  private static func megabytes(_ text: String) -> Int? {
    guard let unit = text.last, let number = Double(text.dropLast()) else { return nil }
    switch unit {
    case "K": return Int((number / 1024).rounded())
    case "M": return Int(number.rounded())
    case "G": return Int((number * 1024).rounded())
    case "T": return Int((number * 1024 * 1024).rounded())
    default: return nil
    }
  }

  private static func writableMegabytes(_ summary: String?) -> Int? {
    guard let line = summary?.split(separator: "\n").first(where: { $0.hasPrefix("Writable regions:") }),
      let total = line.split(separator: " ").first(where: { $0.hasPrefix("Total=") }) else { return nil }
    return megabytes(String(total.dropFirst("Total=".count)))
  }

  private static func parse(_ url: URL, owner: Owner, time: Date) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url), let newline = data.firstIndex(of: 0x0A),
      let header = (try? JSONSerialization.jsonObject(with: data[..<newline])) as? [String: Any],
      let body = (try? JSONSerialization.jsonObject(with: data[data.index(after: newline)...])) as? [String: Any],
      let procPath = body["procPath"] as? String,
      let process = process(procPath: procPath, header: header, mainThread: mainThreadName(body), owner: owner)
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
    let crashed = reportTime(body["captureTime"]) ?? time
    var report: [String: Any] = [
      "time": crashed.timeIntervalSince1970 * 1000, "fileTime": time.timeIntervalSince1970 * 1000, "frames": simplified(frames), "process": process,
    ]
    if let thrown = body["lastExceptionBacktrace"] as? [[String: Any]], !thrown.isEmpty {
      report["exceptionFrames"] = simplified(thrown)
    }
    let appImages = bundledImages(usedImages, procPath: procPath)
    if !appImages.isEmpty { report["images"] = appImages }
    if let name = thrownExceptionName(body) { report["exceptionName"] = name }
    if let subtype = exception["subtype"] as? String, let kind = subtype.split(separator: " ").first {
      report["exceptionSubtype"] = String(kind)
    }
    let versions: [(String, Any?)] = process == "browser"
      ? [("appVersion", header["app_version"]), ("build", header["build_version"])]
      : [("engineVersion", header["app_version"])]
    let termination = body["termination"] as? [String: Any] ?? [:]
    for (key, value) in versions + [
      ("incidentId", header["incident_id"]), ("exceptionType", exception["type"]), ("signal", exception["signal"]),
      ("terminationNamespace", termination["namespace"]),
    ] {
      if let value = value as? String { report[key] = value }
    }
    if let launched = reportTime(body["procLaunch"]), let captured = reportTime(body["captureTime"]), captured >= launched {
      report["uptimeSeconds"] = Int(captured.timeIntervalSince(launched).rounded())
    }
    if let writable = writableMegabytes(body["vmSummary"] as? String) { report["vmWritableMB"] = writable }
    return report
  }

  private static func imageName(_ image: [String: Any]) -> String {
    if let name = image["name"] as? String, !name.isEmpty { return name }
    return (image["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? "???"
  }

  private static func bundledImages(_ images: [[String: Any]], procPath: String) -> [[String: String]] {
    guard let contents = procPath.range(of: ".app/Contents/") else { return [] }
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

  private static func thrownExceptionName(_ body: [String: Any]) -> String? {
    let valid = try! NSRegularExpression(pattern: "^[A-Z][A-Za-z0-9_]{2,63}$")
    func checked(_ full: String) -> String? {
      let name = String(full.prefix { $0 != ":" })
      return valid.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) == nil ? nil : name
    }
    if let details = body["exceptionReason"] as? [String: Any], let name = details["name"] as? String { return checked(name) }
    let named = try! NSRegularExpression(pattern: "uncaught exception '([^']{1,64})'")
    for case let lines as [String] in (body["asi"] as? [String: Any] ?? [:]).values {
      for line in lines {
        if let match = named.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
          let name = Range(match.range(at: 1), in: line) {
          return checked(String(line[name]))
        }
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

enum DiagnosticsInfo {
  static func hardware() -> [String: Any] {
    var info: [String: Any] = [
      "chip": sysctlString("machdep.cpu.brand_string") ?? "",
      "memoryGB": Int((Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824).rounded()),
      "hardwareDecode": hardwareDecode,
    ]
    if let gpu = MTLCreateSystemDefaultDevice()?.name { info["gpu"] = gpu }
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &displays, &count)
    info["displays"] = Int(count)
    info["maxScale"] = displays.prefix(Int(count)).compactMap { display -> Double? in
      guard let mode = CGDisplayCopyDisplayMode(display), mode.width > 0 else { return nil }
      return Double(mode.pixelWidth) / Double(mode.width)
    }.max() ?? 0
    return info
  }

  static func sample() -> [String: Any] {
    var sample: [String: Any] = [:]
    if let footprint = physicalFootprint { sample["footprintMB"] = Int(footprint / 1_048_576) }
    let home = FileManager.default.homeDirectoryForCurrentUser
    if let free = (try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage {
      sample["freeDiskGB"] = Double(free / 104_857_600) / 10
    }
    return sample
  }

  private static let hardwareDecode: [String: Bool] = {
    VTRegisterSupplementalVideoDecoderIfAvailable(kCMVideoCodecType_VP9)
    return [
      "av1": VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1),
      "vp9": VTIsHardwareDecodeSupported(kCMVideoCodecType_VP9),
      "hevc": VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC),
      "h264": VTIsHardwareDecodeSupported(kCMVideoCodecType_H264),
    ]
  }()

  private static var physicalFootprint: UInt64? {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? info.phys_footprint : nil
  }

  private static func sysctlString(_ name: String) -> String? {
    var size = 0
    guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
    var value = [CChar](repeating: 0, count: size)
    guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
    return String(cString: value)
  }
}
