import Foundation

struct VaultCLI: Sendable {
  static let defaultTimeout: TimeInterval = 30
  static let systemPath = "/usr/bin:/bin:/usr/sbin:/sbin"
  static let toolDirectories = ["/opt/homebrew/bin", "/usr/local/bin"]

  private static let passedVariables = [
    "HOME", "USER", "LOGNAME", "TMPDIR", "http_proxy", "https_proxy", "no_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY",
    "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE",
  ]

  let provider: String
  let path: String
  let environment: [String: String]
  let sessions: VaultSessionStore

  static func make(for provider: any VaultProvider, sessions: VaultSessionStore) -> VaultCLI? {
    guard let path = VaultBinaryLocator.locate(provider.binaryName) else { return nil }
    return VaultCLI(provider: provider.id, path: path, environment: environment(for: provider, path: path), sessions: sessions)
  }

  private static func environment(for provider: any VaultProvider, path: String) -> [String: String] {
    let inherited = LaunchConfig.shared.environmentForChildProcesses
    var environment: [String: String] = [:]
    for name in passedVariables {
      if let value = inherited[name], !value.isEmpty { environment[name] = value }
    }
    if environment["HOME"] == nil { environment["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path }
    if environment["TMPDIR"] == nil { environment["TMPDIR"] = NSTemporaryDirectory() }
    environment["LANG"] = "en_US.UTF-8"
    environment["PATH"] = searchPath(binaryDirectory: (path as NSString).deletingLastPathComponent)
    environment.merge(provider.environment) { _, chosen in chosen }
    if let directory = isolatedDirectory(for: provider) {
      environment.merge(provider.isolatedEnvironment(directory)) { _, chosen in chosen }
    }
    return environment
  }

  private static func searchPath(binaryDirectory: String) -> String {
    var directories = systemPath.split(separator: ":").map(String.init)
    for directory in toolDirectories + [binaryDirectory] where !directories.contains(directory) {
      if directory == binaryDirectory || VaultBinaryLocator.isTrustedDirectory(directory) { directories.append(directory) }
    }
    return directories.joined(separator: ":")
  }

  private static func isolatedDirectory(for provider: any VaultProvider) -> String? {
    guard let data = VaultSandbox.directory else { return nil }
    let url = URL(fileURLWithPath: data, isDirectory: true)
      .appendingPathComponent("Password Managers", isDirectory: true)
      .appendingPathComponent(provider.id, isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return url.path
  }

  func run(_ arguments: [String], input: Data? = nil, environment extra: [String: String] = [:],
           timeout: TimeInterval = VaultCLI.defaultTimeout) async -> VaultCommandResult {
    await makeCommand(arguments, input: input, environment: extra, timeout: timeout, onOutput: nil).run()
  }

  func start(_ arguments: [String], environment extra: [String: String] = [:], timeout: TimeInterval,
             onOutput: @escaping @Sendable (String) -> Void, completion: @escaping @Sendable (VaultCommandResult) -> Void) {
    let command = makeCommand(arguments, input: nil, environment: extra, timeout: timeout, onOutput: onOutput)
    let sessions = self.sessions
    let provider = self.provider
    sessions.setRunning(provider, command)?.cancel()
    command.start { result in
      sessions.finishedRunning(provider, command)
      completion(result)
    }
  }

  private func makeCommand(_ arguments: [String], input: Data?, environment extra: [String: String], timeout: TimeInterval,
                           onOutput: (@Sendable (String) -> Void)?) -> VaultCommand {
    VaultCommand(executable: path, arguments: arguments, environment: environment.merging(extra) { _, chosen in chosen },
                 input: input, timeout: timeout, onOutput: onOutput)
  }

  func version() async -> String? {
    let result = await run(["--version"], timeout: 10)
    guard result.succeeded, let line = result.trimmedOutput.split(whereSeparator: \.isNewline).first else { return nil }
    return line.split(separator: " ").last.map { String($0) }
  }

  var session: String? { sessions.session(provider) }
  var touchID: Bool { sessions.touchID }
  var isSigningIn: Bool { sessions.isRunning(provider) }
  var hasStoredSession: Bool { sessions.hasStoredSession(provider) }

  func remember(session: String, persistent: Bool = false) { sessions.remember(provider, session: session, persistent: persistent) }
  func storedSession(_ reason: String) async -> String? { await sessions.storedSession(provider, reason: reason) }
  func dropStoredSession() { sessions.dropStored(provider) }
  func cancelSigningIn() { sessions.cancelRunning(provider) }
  func value(_ key: String) -> String? { sessions.value(provider, key) }
  func setValue(_ key: String, _ value: String?) { sessions.setValue(provider, key, value) }
  func preference(_ key: String) -> String? { sessions.preference(provider, key) }
  func setPreference(_ key: String, _ value: String?) { sessions.setPreference(provider, key, value) }
  func confirmOwner(_ reason: String) async -> Bool { await VaultOwnerCheck.confirm(reason) }

  func announceChange() {
    let provider = self.provider
    Task { _ = await VaultBroker.shared.refresh(provider) }
  }
}
