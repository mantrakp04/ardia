import AppKit
import ArdiaCore
import Sparkle

enum UpdatePrewarm {
  static let timeout: TimeInterval = 90
  static let installHold: TimeInterval = 15
  static let lastRunKey = "ACUpdatePrewarm"
  static let statusStarted = -1
  static let statusSpawnFailed = -2
  static let statusRejected = -3
  static let statusStopped = Int(SIGKILL)
  private static var started = Set<String>()
  private static var runningVersion: String?
  private static var attempt: Attempt?
  private static var generation = 0
  private static var afterRun: [() -> Void] = []
  private static var watchingQuit = false

  static func start(version: String) {
    guard !started.contains(version) else { return }
    started.insert(version)
    warm(version: version)
  }

  static func warm(version: String) {
    guard runningVersion != version, LaunchConfig.shared.switchOn("updatePrewarm"),
      let staged = stagedApp(version: version), let executable = staged.executableURL
    else { return }
    stop()
    launch(staged.bundleURL, executable: executable, version: version)
  }

  static func beforeInstall(version: String, install: @escaping () -> Void) {
    warm(version: version)
    guard runningVersion == version else { return install() }
    var waiting = true
    let proceed = {
      guard waiting else { return }
      waiting = false
      install()
    }
    afterRun.append(proceed)
    DispatchQueue.main.asyncAfter(deadline: .now() + installHold, execute: proceed)
  }

  static func stop() {
    attempt?.stop()
    attempt = nil
    runningVersion = nil
    generation += 1
  }

  static func signedLikeThisApp(_ bundle: URL) -> Bool {
    guard let requirement = ownRequirement else { return false }
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &code) == errSecSuccess, let code else { return false }
    return SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckNestedCode | kSecCSCheckAllArchitectures), requirement) == errSecSuccess
  }

  private static let ownRequirement: SecRequirement? = {
    var running: SecCode?
    var code: SecStaticCode?
    var requirement: SecRequirement?
    guard SecCodeCopySelf([], &running) == errSecSuccess, let running,
      SecCodeCopyStaticCode(running, [], &code) == errSecSuccess, let code,
      SecCodeCopyDesignatedRequirement(code, [], &requirement) == errSecSuccess
    else { return nil }
    return requirement
  }()

  private final class Attempt {
    let version: String
    private let began = Date()
    private let lock = NSLock()
    private var settled = false
    private var pid: pid_t = 0

    init(version: String) {
      self.version = version
      UpdatePrewarm.save(version: version, status: UpdatePrewarm.statusStarted, ms: 0)
    }

    func spawn(_ task: Process) throws -> Bool {
      lock.lock()
      defer { lock.unlock() }
      guard !settled else { return false }
      try task.run()
      pid = task.processIdentifier
      return true
    }

    func stop() {
      lock.lock()
      defer { lock.unlock() }
      if !settled, pid != 0 { kill(pid, SIGKILL) }
      settle(status: UpdatePrewarm.statusStopped)
    }

    func record(status: Int) {
      lock.lock()
      defer { lock.unlock() }
      settle(status: status)
    }

    private func settle(status: Int) {
      guard !settled else { return }
      settled = true
      pid = 0
      let ms = Int(Date().timeIntervalSince(began) * 1000)
      UpdatePrewarm.save(version: version, status: status, ms: ms)
      NSLog("Ardia: prewarmed update \(version) in \(ms) ms (status \(status))")
    }
  }

  private static func save(version: String, status: Int, ms: Int) {
    UserDefaults.standard.set(["build": version, "at": Date().timeIntervalSince1970 * 1000, "ms": ms, "status": status], forKey: lastRunKey)
  }

  private static func launch(_ bundle: URL, executable: URL, version: String) {
    if !watchingQuit {
      watchingQuit = true
      NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in stop() }
    }
    generation += 1
    let current = generation
    let tried = Attempt(version: version)
    attempt = tried
    runningVersion = version
    var env = LaunchConfig.shared.environmentForChildProcesses.filter { !$0.key.hasPrefix("DYLD_") }
    env["ARDIA_PREWARM"] = "1"
    DispatchQueue.global(qos: .utility).async {
      guard signedLikeThisApp(bundle) else {
        tried.record(status: statusRejected)
        NSLog("Ardia: not prewarming \(bundle.path): its signature isn't this app's")
        return DispatchQueue.main.async { finish(current) }
      }
      let task = Process()
      task.executableURL = executable
      task.environment = env
      task.standardInput = FileHandle.nullDevice
      task.standardOutput = FileHandle.nullDevice
      task.standardError = FileHandle.nullDevice
      task.terminationHandler = { ended in
        tried.record(status: Int(ended.terminationStatus))
        DispatchQueue.main.async { finish(current) }
      }
      do {
        guard try tried.spawn(task) else { return }
      } catch {
        tried.record(status: statusSpawnFailed)
        NSLog("Ardia: couldn't prewarm update \(version): \(error.localizedDescription)")
        return DispatchQueue.main.async { finish(current) }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
        guard attempt === tried, task.isRunning else { return }
        NSLog("Ardia: update prewarm still running after \(Int(timeout)) s; stopping it")
        stop()
      }
    }
  }

  private static func finish(_ which: Int) {
    guard which == generation else { return }
    runningVersion = nil
    attempt = nil
    let waiting = afterRun
    afterRun = []
    waiting.forEach { $0() }
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
