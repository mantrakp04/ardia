import AppKit
import ArdiaCore
import Sparkle

enum UpdatePrewarm {
  static let timeout: TimeInterval = 90
  private static var started = Set<String>()
  private static var running: pid_t = 0

  static func start(version: String) {
    guard !started.contains(version), let executable = stagedApp(version: version)?.executableURL else { return }
    started.insert(version)
    NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in stop() }
    DispatchQueue.global(qos: .utility).async {
      let task = Process()
      task.executableURL = executable
      var env = LaunchConfig.shared.environmentForChildProcesses.filter { !$0.key.hasPrefix("DYLD_") }
      env["ARDIA_PREWARM"] = "1"
      task.environment = env
      task.standardInput = FileHandle.nullDevice
      task.standardOutput = FileHandle.nullDevice
      task.standardError = FileHandle.nullDevice
      let began = Date()
      task.terminationHandler = { ended in
        DispatchQueue.main.async {
          if running == ended.processIdentifier { running = 0 }
          NSLog("Ardia: prewarmed update \(version) in \(Int(Date().timeIntervalSince(began) * 1000)) ms (status \(ended.terminationStatus))")
        }
      }
      do {
        try task.run()
      } catch {
        return NSLog("Ardia: couldn't prewarm update \(version): \(error.localizedDescription)")
      }
      let pid = task.processIdentifier
      DispatchQueue.main.async {
        if task.isRunning { running = pid }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
          guard running == pid, task.isRunning else { return }
          NSLog("Ardia: update prewarm still running after \(Int(timeout)) s; stopping it")
          stop()
        }
      }
    }
  }

  static func stop() {
    guard running != 0 else { return }
    kill(running, SIGKILL)
    running = 0
  }

  static func stagedApp(version: String, bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> Bundle? {
    stagedApps(bundleId: bundleId, root: root)
      .filter { $0.bundle.infoDictionary?["CFBundleVersion"] as? String == version }
      .max { $0.modified < $1.modified }?.bundle
  }

  static func stagedApps(bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> [(bundle: Bundle, modified: Date)] {
    guard let bundleId,
      let root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent(bundleId).appendingPathComponent("org.sparkle-project.Sparkle/Installation")
    else { return [] }
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey],
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
    var found: [(bundle: Bundle, modified: Date)] = []
    for case let url as URL in walk {
      if walk.level > 4 { walk.skipDescendants(); continue }
      guard url.pathExtension == "app", let bundle = Bundle(url: url), let info = bundle.infoDictionary,
        info["CFBundleIdentifier"] as? String == bundleId,
        let executable = bundle.executableURL, FileManager.default.isExecutableFile(atPath: executable.path)
      else { continue }
      let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      found.append((bundle, date))
    }
    return found
  }
}
