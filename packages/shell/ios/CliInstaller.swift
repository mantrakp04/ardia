import ArdiaCore
import ExpoModulesCore
import Foundation

final class CliInstaller {
  static let shared = CliInstaller()

  private static let versionPattern = #"^[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$"#
  private static let digestPattern = #"^[0-9a-f]{64}$"#
  private static let deadline: TimeInterval = 300

  static var appVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }

  private static var installerEnvironment: [String: String] {
    var environment = LaunchConfig.shared.environmentForChildProcesses
    for (key, name) in [("cliHome", "ARDIA_CLI_HOME"), ("cliBinDir", "ARDIA_CLI_BIN_DIR"), ("cliUrl", "ARDIA_CLI_URL")] {
      if let value = LaunchConfig.shared.instance(key) { environment[name] = value }
    }
    return environment
  }



  static var home: URL? {
    if let path = LaunchConfig.shared.instance("cliHome") { return URL(fileURLWithPath: path, isDirectory: true) }
    if LaunchConfig.shared.isolated { return nil }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/Ardia/CLI", isDirectory: true)
  }

  static func installedVersion() -> String? {
    guard let current = home?.appendingPathComponent("current"),
      let target = try? FileManager.default.destinationOfSymbolicLink(atPath: current.path)
    else { return nil }
    let version = (target as NSString).lastPathComponent
    return version.isEmpty ? nil : version
  }

  private static func script() -> URL? {
    if LaunchConfig.shared.isolated, let path = LaunchConfig.shared.testValue("cliInstallScript") {
      return URL(fileURLWithPath: path).resolvingSymlinksInPath()
    }
    return Bundle.main.url(forResource: "ardia-cli-install", withExtension: "sh")?.resolvingSymlinksInPath()
  }

  private static func pinnedDigest() -> String? {
    guard let url = Bundle.main.url(forResource: "ardia-cli", withExtension: "sha256"),
      let text = try? String(contentsOf: url, encoding: .utf8)
    else { return nil }
    let digest = text.split(whereSeparator: { $0.isWhitespace }).first.map(String.init)?.lowercased() ?? ""
    return digest.range(of: digestPattern, options: .regularExpression) != nil ? digest : nil
  }

  private let queue = DispatchQueue(label: "dev.ardia.cli-installer")
  private var waiting: [([String: Any]) -> Void] = []
  private var lineListeners: [(String) -> Void] = []

  func install(onLine: @escaping (String) -> Void, done: @escaping ([String: Any]) -> Void) {
    queue.async {
      self.waiting.append(done)
      self.lineListeners.append(onLine)
      if self.waiting.count == 1 { self.run() }
    }
  }

  private func finish(_ result: [String: Any]) {
    queue.async {
      let waiting = self.waiting
      self.waiting = []
      self.lineListeners = []
      for done in waiting { done(result) }
    }
  }

  private func failure(_ message: String, lines: [String] = []) -> [String: Any] {
    ["ok": false, "error": message, "lines": lines, "appVersion": Self.appVersion]
  }

  private func run() {
    if LaunchConfig.shared.isolated && (LaunchConfig.shared.instance("cliHome") == nil || LaunchConfig.shared.instance("cliBinDir") == nil) {
      return finish(failure("A test instance installs only with ARDIA_INSTANCE cliHome and cliBinDir set."))
    }
    let version = Self.appVersion
    guard version.range(of: Self.versionPattern, options: .regularExpression) != nil else {
      return finish(failure("This build's version (\(version)) has no ardia command release."))
    }
    guard let script = Self.script(), FileManager.default.isReadableFile(atPath: script.path) else {
      return finish(failure("The installer isn't in this build of Ardia."))
    }
    var arguments = [script.path, "--version", version]
    if let digest = Self.pinnedDigest() { arguments += ["--sha256", digest] }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sh")
    process.arguments = arguments
    process.environment = Self.installerEnvironment
    process.currentDirectoryURL = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    process.standardInput = FileHandle.nullDevice
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors

    let collector = LineCollector()
    let errorText = LineCollector()
    errors.fileHandleForReading.readabilityHandler = { handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        return
      }
      _ = errorText.append(data)
    }
    output.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        return
      }
      for line in collector.append(data) {
        self?.queue.async { for listener in self?.lineListeners ?? [] { listener(line) } }
      }
    }

    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + Self.deadline)
    timer.setEventHandler { if process.isRunning { process.terminate() } }

    process.terminationHandler = { [weak self] process in
      timer.cancel()
      output.fileHandleForReading.readabilityHandler = nil
      errors.fileHandleForReading.readabilityHandler = nil
      _ = collector.append(output.fileHandleForReading.readDataToEndOfFile())
      _ = collector.flush()
      _ = errorText.append(errors.fileHandleForReading.readDataToEndOfFile())
      _ = errorText.flush()
      self?.finish(Self.result(lines: collector.all, status: process.terminationStatus, stderr: errorText.all))
    }

    do {
      try process.run()
      timer.resume()
    } catch {
      timer.cancel()
      finish(failure("Couldn't run the installer: \(error.localizedDescription)"))
    }
  }

  private static func result(lines: [String], status: Int32, stderr: [String]) -> [String: Any] {
    var result: [String: Any] = ["lines": lines, "appVersion": appVersion, "status": Int(status)]
    for line in lines {
      if line.hasPrefix("installed ") { result["binPath"] = String(line.dropFirst("installed ".count)) }
      if line.hasPrefix("version ") { result["version"] = String(line.dropFirst("version ".count)) }
      if line.hasPrefix("path ") { result["rcFile"] = String(line.dropFirst("path ".count)) }
      if line.hasPrefix("error ") { result["error"] = String(line.dropFirst("error ".count)) }
    }
    if status != 0 && result["error"] == nil {
      result["error"] = stderr.last(where: { !$0.isEmpty }) ?? "The installer stopped (exit \(status))."
    }
    result["ok"] = status == 0 && result["binPath"] != nil && result["error"] == nil
    result["installedVersion"] = installedVersion() ?? NSNull()
    return result
  }
}

private final class LineCollector {
  private let lock = NSLock()
  private var pending = Data()
  private var collected: [String] = []

  var all: [String] {
    lock.lock()
    defer { lock.unlock() }
    return collected
  }

  func append(_ data: Data) -> [String] {
    lock.lock()
    defer { lock.unlock() }
    pending.append(data)
    var lines: [String] = []
    while let newline = pending.firstIndex(of: 0x0A) {
      let line = String(decoding: pending[pending.startIndex..<newline], as: UTF8.self)
      pending.removeSubrange(pending.startIndex...newline)
      lines.append(line)
    }
    collected += lines
    return lines
  }

  func flush() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    guard !pending.isEmpty else { return [] }
    let line = String(decoding: pending, as: UTF8.self)
    pending = Data()
    collected.append(line)
    return [line]
  }
}
