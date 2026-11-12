import AppKit
import ArdiaCore
import Foundation

enum TelemetryLocalStore {
  struct Stats {
    var bytes = 0
    var lines = 0
    var files = 0
    var droppedLines = 0
    var pruneMs = 0.0
  }

  struct Exported {
    let path: String
    let bytes: Int
    let lines: Int
  }

  private static let queue = DispatchQueue(label: "ardia.telemetry-local", qos: .utility)
  private static let dayPattern = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}$")
  private static let appFilePattern = try! NSRegularExpression(pattern: "^(\\d{4}-\\d{2}-\\d{2})\\.jsonl$")
  private static let cliFilePattern = try! NSRegularExpression(pattern: "^cli-\\d{4}-\\d{2}-\\d{2}\\.jsonl$")
  private static let maxWriteSamples = 4096
  private static var maxBytes = 8 * 1_048_576
  private static var keepMs = 7.0 * 86_400_000
  private static var totalBytes: Int?
  private static var writeMs: [Double] = []
  private static var droppedSincePrune = 0
  private static let drainOnQuit = NotificationCenter.default.addObserver(
    forName: NSApplication.willTerminateNotification, object: nil, queue: nil
  ) { _ in queue.sync {} }

  static func directory() throws -> URL {
    let dir = try DocumentStore.url("telemetry.json").deletingLastPathComponent()
      .appendingPathComponent("Telemetry", isDirectory: true)
      .appendingPathComponent("local", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  static func validDay(_ day: String) -> Bool {
    dayPattern.firstMatch(in: day, range: NSRange(day.startIndex..., in: day)) != nil
  }

  static func append(day: String, text: String) {
    _ = drainOnQuit
    guard validDay(day), !text.isEmpty else { return }
    queue.async { write(day: day, text: text) }
  }

  static func appendNow(day: String, text: String) {
    guard validDay(day), !text.isEmpty else { return }
    queue.sync { write(day: day, text: text) }
  }

  private static func write(day: String, text: String) {
    guard let url = try? directory().appendingPathComponent("\(day).jsonl") else { return }
    let start = DispatchTime.now().uptimeNanoseconds
    let data = Data(text.utf8)
    let fd = open(url.path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0o600)
    guard fd >= 0 else { return }
    let written = data.withUnsafeBytes { raw -> Int in
      var offset = 0
      while offset < raw.count {
        let n = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
        if n <= 0 { break }
        offset += n
      }
      return offset
    }
    close(fd)
    if writeMs.count >= maxWriteSamples { writeMs.removeFirst(writeMs.count - maxWriteSamples + 1) }
    writeMs.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
    if let total = totalBytes {
      totalBytes = total + written
      if total + written > maxBytes { _ = prune(now: Date().timeIntervalSince1970 * 1000) }
    }
  }

  static func configure(maxBytes: Int, keepDays: Int) {
    queue.async {
      self.maxBytes = max(1, maxBytes)
      self.keepMs = Double(max(1, keepDays)) * 86_400_000
    }
  }

  static func pruneAndMeasure(now: Double, done: @escaping (Stats, [Double]) -> Void) {
    queue.async {
      var stats = prune(now: now)
      stats.droppedLines = droppedSincePrune
      droppedSincePrune = 0
      let samples = writeMs
      writeMs.removeAll(keepingCapacity: true)
      done(stats, samples)
    }
  }

  private static func appFiles(in dir: URL) -> [(day: String, url: URL, size: Int)] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
    var files: [(String, URL, Int)] = []
    for name in names {
      guard let match = appFilePattern.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)),
        let range = Range(match.range(at: 1), in: name)
      else { continue }
      let url = dir.appendingPathComponent(name)
      let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? 0
      files.append((String(name[range]), url, size))
    }
    return files.sorted { $0.0 < $1.0 }
  }

  static func utcDay(_ ms: Double) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
  }

  private static func newlines(_ data: Data) -> Int {
    data.withUnsafeBytes { raw -> Int in
      var count = 0
      for byte in raw.bindMemory(to: UInt8.self) where byte == 0x0A { count += 1 }
      return count
    }
  }

  static func lineTime(_ line: Data.SubSequence) -> Double? {
    let prefix = Array("{\"at\":".utf8)
    guard line.count > prefix.count, line.starts(with: prefix) else { return nil }
    var value = 0.0
    var digits = 0
    for byte in line.dropFirst(prefix.count) {
      guard byte >= 0x30 && byte <= 0x39 else { break }
      value = value * 10 + Double(byte - 0x30)
      digits += 1
    }
    return digits > 0 ? value : nil
  }

  private static func keepTail(_ url: URL, from offset: Int, of data: Data) -> Int {
    let dropped = newlines(data.prefix(offset))
    if offset >= data.count {
      try? FileManager.default.removeItem(at: url)
    } else {
      try? data.suffix(from: data.startIndex + offset).write(to: url, options: .atomic)
    }
    return dropped
  }

  private static func offsetOfFirstLine(in data: Data, where keep: (Data.SubSequence) -> Bool) -> Int {
    var start = data.startIndex
    while start < data.endIndex {
      let end = data[start...].firstIndex(of: 0x0A).map { $0 + 1 } ?? data.endIndex
      if keep(data[start..<end]) { return start - data.startIndex }
      start = end
    }
    return data.count
  }

  @discardableResult
  private static func prune(now: Double) -> Stats {
    let started = DispatchTime.now().uptimeNanoseconds
    guard let dir = try? directory() else { return Stats() }
    let cutoff = now - keepMs
    let oldestDay = utcDay(cutoff)
    let newestDay = utcDay(now + 86_400_000)
    var files = appFiles(in: dir)
    files.removeAll { file in
      guard file.day < oldestDay || file.day > newestDay else { return false }
      droppedSincePrune += (try? Data(contentsOf: file.url)).map(newlines) ?? 0
      try? FileManager.default.removeItem(at: file.url)
      return true
    }
    if let first = files.first, first.day == oldestDay, let data = try? Data(contentsOf: first.url) {
      let offset = offsetOfFirstLine(in: data) { (lineTime($0) ?? now) >= cutoff }
      if offset > 0 {
        droppedSincePrune += keepTail(first.url, from: offset, of: data)
        files[0].size = data.count - offset
        if offset >= data.count { files.removeFirst() }
      }
    }
    var total = files.reduce(0) { $0 + $1.size }
    let target = maxBytes - maxBytes / 10
    while total > maxBytes, let oldest = files.first {
      let excess = total - target
      if oldest.size <= excess {
        droppedSincePrune += (try? Data(contentsOf: oldest.url)).map(newlines) ?? 0
        try? FileManager.default.removeItem(at: oldest.url)
        total -= oldest.size
        files.removeFirst()
        continue
      }
      guard let data = try? Data(contentsOf: oldest.url) else { break }
      var offset = min(excess, data.count)
      if offset > 0, data[data.startIndex + offset - 1] != 0x0A {
        offset = data[(data.startIndex + offset)...].firstIndex(of: 0x0A).map { $0 + 1 - data.startIndex } ?? data.count
      }
      droppedSincePrune += keepTail(oldest.url, from: offset, of: data)
      total -= offset
      files[0].size = data.count - offset
      if offset >= data.count { files.removeFirst() }
      break
    }
    var stats = Stats()
    for file in files {
      guard let data = try? Data(contentsOf: file.url) else { continue }
      stats.bytes += data.count
      stats.lines += newlines(data)
      stats.files += 1
    }
    totalBytes = stats.bytes
    stats.pruneMs = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
    return stats
  }

  static func clear(done: @escaping () -> Void) {
    queue.async {
      if let dir = try? directory() {
        for file in appFiles(in: dir) { try? FileManager.default.removeItem(at: file.url) }
      }
      totalBytes = 0
      done()
    }
  }

  private static func collect(since: Double, includeCli: Bool) -> (Data, Int) {
    guard let dir = try? directory() else { return (Data(), 0) }
    let fromDay = utcDay(since)
    var out = Data()
    var lines = 0
    for file in appFiles(in: dir) where file.day >= fromDay {
      guard let data = try? Data(contentsOf: file.url) else { continue }
      let offset = file.day == fromDay ? offsetOfFirstLine(in: data) { (lineTime($0) ?? since) >= since } : 0
      let kept = data.suffix(from: data.startIndex + offset)
      out.append(kept)
      if let last = kept.last, last != 0x0A { out.append(0x0A) }
      lines += newlines(Data(kept)) + (kept.last.map { $0 == 0x0A ? 0 : 1 } ?? 0)
    }
    if includeCli {
      let names = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).sorted()
      for name in names where cliFilePattern.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)), !data.isEmpty else { continue }
        out.append(data)
        if data.last != 0x0A { out.append(0x0A) }
        lines += newlines(data) + (data.last == 0x0A ? 0 : 1)
      }
    }
    return (out, lines)
  }

  static func exportForReport(since: Double, done: @escaping (Exported?) -> Void) {
    queue.async {
      let (data, lines) = collect(since: since, includeCli: false)
      guard let dir = try? directory().deletingLastPathComponent().appendingPathComponent("export", isDirectory: true),
        (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil,
        let gz = GzipData.compress(data)
      else { return done(nil) }
      let url = dir.appendingPathComponent("local-events.jsonl.gz")
      guard (try? gz.write(to: url, options: .atomic)) != nil else { return done(nil) }
      done(Exported(path: url.path, bytes: gz.count, lines: lines))
    }
  }

  static func exportToDownloads(now: Double, done: @escaping (Exported?) -> Void) {
    queue.async {
      let (data, lines) = collect(since: now - keepMs, includeCli: true)
      let dir: URL
      if let custom = LaunchConfig.shared.instance("downloadsDir") {
        dir = URL(fileURLWithPath: custom, isDirectory: true)
      } else if LaunchConfig.shared.isolated, let data = try? directory().deletingLastPathComponent().deletingLastPathComponent() {
        dir = data.appendingPathComponent("Downloads", isDirectory: true)
      } else if let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first {
        dir = downloads
      } else {
        return done(nil)
      }
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let base = "Ardia data \(utcDay(now))"
      var url = dir.appendingPathComponent("\(base).jsonl")
      var n = 2
      while FileManager.default.fileExists(atPath: url.path) {
        url = dir.appendingPathComponent("\(base) \(n).jsonl")
        n += 1
      }
      guard (try? data.write(to: url, options: .atomic)) != nil else { return done(nil) }
      done(Exported(path: url.path, bytes: data.count, lines: lines))
    }
  }
}
