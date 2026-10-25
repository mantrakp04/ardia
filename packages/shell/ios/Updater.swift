import AppKit
import Security
#if canImport(Sparkle)
import Sparkle
#endif

public final class AppUpdater: NSObject {
  public static let shared = AppUpdater()

  static var feedOverride: String? {
    let env = ProcessInfo.processInfo.environment
    if let feed = env["ARDIA_UPDATE_FEED_URL"] ?? UserDefaults.standard.string(forKey: "ACUpdateFeedURL") { return feed }
    return env["ARDIA_BACKGROUND"] == "1" ? "https://github.com/mantrakp04/ardia/releases/latest/download/appcast.xml" : nil
  }

  public static let channels = ["stable", "nightly"]
  static let channelDefaultsKey = "ACUpdateChannel"

  static var buildChannel: String {
    Bundle.main.object(forInfoDictionaryKey: "ACUpdateChannel") as? String == "nightly" ? "nightly" : "stable"
  }

  public var channel: String {
    let chosen = UserDefaults.standard.string(forKey: Self.channelDefaultsKey) ?? ""
    return Self.channels.contains(chosen) ? chosen : Self.buildChannel
  }

  public func setChannel(_ channel: String) {
    guard Self.channels.contains(channel) else { return }
    UserDefaults.standard.set(channel, forKey: Self.channelDefaultsKey)
    #if canImport(Sparkle)
    guard started else { return }
    channelChangePending = true
    userDriver.leaveOffChannelUpdate()
    applyChannelChangeWhenIdle()
    #endif
  }

  #if canImport(Sparkle)
  private func applyChannelChangeWhenIdle() {
    guard channelChangePending, !updater.sessionInProgress else { return }
    channelChangePending = false
    if hasOffChannelStagedUpdate {
      updater.checkForUpdatesInBackground()
    } else if updater.automaticallyChecksForUpdates {
      updater.resetUpdateCycle()
    }
  }

  private var hasOffChannelStagedUpdate: Bool {
    UpdatePrewarm.stagedApps().contains { staged in
      let built = staged.bundle.object(forInfoDictionaryKey: "ACUpdateChannel") as? String
      return built == "nightly" && !allowedChannels.contains("nightly")
    }
  }
  #endif

  static let quitWaitLimit: TimeInterval = 8
  static let quitWaitAfterIdle: TimeInterval = 1

  public var holdsQuitForStagedUpdate: Bool {
    #if canImport(Sparkle)
    started && hasOffChannelStagedUpdate
    #else
    false
    #endif
  }

  public func dropOffChannelStagedUpdateBeforeQuit(then quit: @escaping () -> Void) {
    #if canImport(Sparkle)
    guard holdsQuitForStagedUpdate else { return quit() }
    applyChannelChangeWhenIdle()
    let deadline = Date().addingTimeInterval(Self.quitWaitLimit)
    var idleSince: Date?
    func settle() {
      guard hasOffChannelStagedUpdate else { return quit() }
      let busy = channelChangePending || updater.sessionInProgress
      idleSince = busy ? nil : idleSince ?? Date()
      if let idleSince, Date().timeIntervalSince(idleSince) >= Self.quitWaitAfterIdle {
        NSLog("Ardia: a staged nightly is still in Sparkle's cache with nothing left to drop it; quitting")
        return quit()
      }
      if Date() >= deadline {
        NSLog("Ardia: Sparkle didn't drop the staged nightly within \(Int(Self.quitWaitLimit)) s; quitting, and it may install")
        return quit()
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { settle() }
    }
    settle()
    #else
    quit()
    #endif
  }

  var allowedChannels: Set<String> {
    channel == "nightly" ? ["nightly"] : []
  }

  private func rememberChannel() {
    guard !Self.channels.contains(UserDefaults.standard.string(forKey: Self.channelDefaultsKey) ?? "") else { return }
    UserDefaults.standard.set(Self.buildChannel, forKey: Self.channelDefaultsKey)
  }

  public static var displayVersion: String {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    guard let range = version.range(of: #"-nightly\.(\d+)$"#, options: .regularExpression) else { return version }
    let number = version[range].split(separator: ".").last.map(String.init) ?? ""
    return "\(version[..<range.lowerBound]) Nightly \(number)"
  }

  static let aboutNotice = "© 2026 Mantra Patel. Ardia is free software under the GNU General Public License v3, with ABSOLUTELY NO WARRANTY. Its source is at the link below. It's built on Chromium and uBlock Origin, each under its own license."

  @objc public func showAbout(_ sender: Any?) {
    NSApp.orderFrontStandardAboutPanel(options: [.applicationVersion: Self.displayVersion, .credits: Self.aboutCredits])
  }

  private static var aboutCredits: NSAttributedString {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let repository = "https://github.com/mantrakp04/ardia"
    let centered = NSMutableParagraphStyle()
    centered.alignment = .center
    let plain: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize),
      .foregroundColor: NSColor.secondaryLabelColor,
      .paragraphStyle: centered,
    ]
    let links = [
      ("Source code", "\(repository)/tree/v\(version)"),
      ("License", "\(repository)/blob/v\(version)/LICENSE"),
      ("Credits", "\(repository)/blob/v\(version)/NOTICE"),
    ]
    let credits = NSMutableAttributedString(string: "\(aboutNotice)\n\n", attributes: plain)
    for (index, (title, url)) in links.enumerated() {
      if index > 0 { credits.append(NSAttributedString(string: "  ·  ", attributes: plain)) }
      var linked = plain
      linked[.link] = URL(string: url)
      credits.append(NSAttributedString(string: title, attributes: linked))
    }
    return credits
  }

  private static var isOff: Bool {
    ACIsolatedDataDirectory() != nil && ProcessInfo.processInfo.environment["ARDIA_UPDATE_FEED_URL"] == nil
  }

  #if canImport(Sparkle)
  private lazy var userDriver = ChannelUserDriver(standard: SPUStandardUserDriver(hostBundle: .main, delegate: self)) { [unowned self] item in
    item.channel.map { self.allowedChannels.contains($0) } ?? true
  }
  private lazy var updater = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: userDriver, delegate: self)
  private var deferredUpdate = false
  private var channelChangePending = false
  private var sessionObservation: NSKeyValueObservation?
  private var firstCheckPending = false
  #endif
  private var started = false

  public var isAvailable: Bool {
    #if canImport(Sparkle)
    true
    #else
    false
    #endif
  }

  public var isConfigured: Bool {
    guard isAvailable, !Self.isOff else { return false }
    let info = Bundle.main.infoDictionary ?? [:]
    let feed = (Self.feedOverride ?? info["SUFeedURL"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    let key = (info["SUPublicEDKey"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    guard let scheme = URL(string: feed)?.scheme?.lowercased() else { return false }
    return (scheme == "https" || scheme == "http") && !key.isEmpty
  }

  public func start() {
    #if canImport(Sparkle)
    rememberChannel()
    guard !started, isConfigured else { return }
    started = true
    firstCheckPending = updater.lastUpdateCheckDate == nil
    do {
      try updater.start()
    } catch {
      NSLog("Ardia: couldn't start the updater: \(error.localizedDescription)")
    }
    sessionObservation = updater.observe(\.sessionInProgress, options: [.new]) { [weak self] _, change in
      guard change.newValue == false else { return }
      DispatchQueue.main.async { self?.applyChannelChangeWhenIdle() }
    }
    NotificationCenter.default.addObserver(self, selector: #selector(fullScreenChanged), name: NSWindow.didExitFullScreenNotification, object: nil)
    #endif
  }

  @objc public func checkForUpdates(_ sender: Any?) {
    #if canImport(Sparkle)
    guard isConfigured else {
      if ProcessInfo.processInfo.environment["ARDIA_BACKGROUND"] == "1" {
        return NSLog("Ardia: update checks are off in this instance")
      }
      return showNotSetUp()
    }
    start()
    updater.checkForUpdates()
    #endif
  }

  public var state: [String: Any] {
    #if canImport(Sparkle)
    return [
      "available": true,
      "configured": isConfigured,
      "automaticChecks": updater.automaticallyChecksForUpdates,
      "automaticDownloads": updater.automaticallyDownloadsUpdates,
      "canCheck": updater.canCheckForUpdates,
      "sessionInProgress": updater.sessionInProgress,
      "feedURL": updater.feedURL?.absoluteString as Any,
      "lastCheck": updater.lastUpdateCheckDate.map { $0.timeIntervalSince1970 * 1000 } as Any,
      "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as Any,
      "displayVersion": Self.displayVersion,
      "channel": channel,
      "buildChannel": Self.buildChannel,
    ]
    #else
    return ["available": false]
    #endif
  }

  public func setAutomaticChecks(_ on: Bool) {
    #if canImport(Sparkle)
    updater.automaticallyChecksForUpdates = on
    #endif
  }

  public func setAutomaticDownloads(_ on: Bool) {
    #if canImport(Sparkle)
    updater.automaticallyDownloadsUpdates = on
    #endif
  }

  private func showNotSetUp() {
    let alert = NSAlert()
    let name = ProcessInfo.processInfo.processName
    alert.messageText = "Updates aren't set up for this build"
    alert.informativeText = "This copy of \(name) doesn't have an update feed, so it can't check for new versions. Get newer versions from wherever you got this one."
    alert.addButton(withTitle: "OK")
    if let window = NSApp.keyWindow, window.attachedSheet == nil {
      alert.beginSheetModal(for: window)
    } else {
      alert.runModal()
    }
  }

  static var isPresentingFullScreen: Bool {
    NSApp.windows.contains { $0.isVisible && $0.styleMask.contains(.fullScreen) }
  }

  #if canImport(Sparkle)
  @objc private func fullScreenChanged() {
    DispatchQueue.main.async { [self] in
      guard !Self.isPresentingFullScreen, deferredUpdate else { return }
      deferredUpdate = false
      updater.checkForUpdates()
    }
  }
  #endif
}

#if canImport(Sparkle)
extension AppUpdater: SPUUpdaterDelegate {
  public func feedURLString(for updater: SPUUpdater) -> String? { Self.feedOverride }

  public func allowedChannels(for updater: SPUUpdater) -> Set<String> {
    allowedChannels
  }

  public func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
    NSLog("Ardia: update found: \(item.displayVersionString) (build \(item.versionString)\(item.channel.map { ", \($0)" } ?? "")) on the \(channel) channel")
  }

  public func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
    NSLog("Ardia: no update on the \(channel) channel")
  }

  public func feedParameters(for updater: SPUUpdater, sendingSystemProfile sendingProfile: Bool) -> [[String: String]] {
    guard firstCheckPending else { return [] }
    firstCheckPending = false
    return [["key": "first", "value": "1"]]
  }

  public func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
    if KillSwitch.isOn("updatePrewarm") { UpdatePrewarm.start(version: item.versionString) }
    return false
  }
}

enum KillSwitch {
  static let cacheDocument = "switches-cache.json"

  static func isOn(
    _ name: String,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    cache: () -> String? = { DocumentStore.read(cacheDocument) }
  ) -> Bool {
    for part in (environment["ARDIA_SWITCHES"] ?? "").split(separator: ",") {
      let pair = part.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      guard pair.count == 2, pair[0] == name else { continue }
      if ["off", "0", "false"].contains(pair[1]) { return false }
      if ["on", "1", "true"].contains(pair[1]) { return true }
    }
    guard let data = cache()?.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let switches = json["switches"] as? [String: Any],
      let value = switches[name] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID()
    else { return true }
    return value.boolValue
  }
}

enum UpdatePrewarm {
  static let timeout: TimeInterval = 90
  private static var started = Set<String>()
  private static var running: pid_t = 0
  private static var spawned: pid_t = 0
  private static var stopCount = 0

  static func start(version: String) {
    let candidates = stagedCandidates(version: version)
    guard !started.contains(version), !candidates.isEmpty else { return }
    started.insert(version)
    NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in stop() }
    DispatchQueue.global(qos: .utility).async {
      let seenStops = stopCount
      guard let executable = candidates.first(where: { satisfiesDesignatedRequirement($0.bundleURL) })?.executableURL else {
        return NSLog("Ardia: not prewarming update \(version): no staged copy satisfies this app's designated requirement")
      }
      var env = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("ARDIA_") && !$0.key.hasPrefix("DYLD_") }
      env["ARDIA_PREWARM"] = "1"
      let began = Date()
      guard let pid = spawnSuspendedDisclaimingResponsibility(executable, environment: env) else {
        return NSLog("Ardia: couldn't prewarm update \(version)")
      }
      spawned = pid
      defer { if spawned == pid { spawned = 0 } }
      guard launchedCopySatisfiesDesignatedRequirement(pid) else {
        kill(pid, SIGKILL)
        while waitpid(pid, nil, 0) == -1, errno == EINTR {}
        return NSLog("Ardia: not prewarming update \(version): the launched copy doesn't satisfy this app's designated requirement")
      }
      guard seenStops == stopCount else {
        kill(pid, SIGKILL)
        while waitpid(pid, nil, 0) == -1, errno == EINTR {}
        return NSLog("Ardia: not prewarming update \(version): it was stopped before it could run")
      }
      kill(pid, SIGCONT)
      DispatchQueue.main.async {
        running = pid
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
          guard running == pid else { return }
          NSLog("Ardia: update prewarm still running after \(Int(timeout)) s; stopping it")
          stop()
        }
      }
      var exited = siginfo_t()
      while waitid(P_PID, id_t(pid), &exited, WEXITED | WNOWAIT) == -1, errno == EINTR {}
      DispatchQueue.main.async {
        if running == pid { running = 0 }
        waitpid(pid, nil, 0)
        NSLog("Ardia: prewarmed update \(version) in \(Int(Date().timeIntervalSince(began) * 1000)) ms (status \(exited.si_status))")
      }
    }
  }

  static func stop() {
    stopCount += 1
    for pid in Set([running, spawned].filter { $0 != 0 }) {
      kill(pid, SIGKILL)
      while waitpid(pid, nil, 0) == -1, errno == EINTR {}
    }
    running = 0
    spawned = 0
  }

  static func stagedCandidates(version: String, bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> [Bundle] {
    stagedApps(bundleId: bundleId, root: root)
      .filter { $0.bundle.infoDictionary?["CFBundleVersion"] as? String == version }
      .sorted { $0.modified > $1.modified }
      .map(\.bundle)
  }

  static let designatedRequirement: SecRequirement? = {
    var own: SecCode?
    var code: SecStaticCode?
    var requirement: SecRequirement?
    guard SecCodeCopySelf([], &own) == errSecSuccess, let own,
      SecCodeCopyStaticCode(own, [], &code) == errSecSuccess, let code,
      SecCodeCopyDesignatedRequirement(code, [], &requirement) == errSecSuccess
    else { return nil }
    return requirement
  }()

  static func satisfiesDesignatedRequirement(_ app: URL, requirement: SecRequirement? = designatedRequirement) -> Bool {
    var code: SecStaticCode?
    guard let requirement, SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let code else { return false }
    let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode)
    return SecStaticCodeCheckValidity(code, flags, requirement) == errSecSuccess
  }

  static func launchedCopySatisfiesDesignatedRequirement(_ pid: pid_t, requirement: SecRequirement? = designatedRequirement) -> Bool {
    var code: SecCode?
    guard let requirement,
      SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: pid] as CFDictionary, [], &code) == errSecSuccess, let code
    else { return false }
    return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
  }

  private typealias DisclaimResponsibility = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

  private static let disclaimResponsibility: DisclaimResponsibility? = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim")
    .map { unsafeBitCast($0, to: DisclaimResponsibility.self) }

  static func spawnSuspendedDisclaimingResponsibility(_ executable: URL, environment: [String: String]) -> pid_t? {
    var attributes: posix_spawnattr_t?
    var actions: posix_spawn_file_actions_t?
    posix_spawnattr_init(&attributes)
    posix_spawn_file_actions_init(&actions)
    defer {
      posix_spawnattr_destroy(&attributes)
      posix_spawn_file_actions_destroy(&actions)
    }
    var noSignals = sigset_t()
    var allSignals = sigset_t()
    sigemptyset(&noSignals)
    sigfillset(&allSignals)
    posix_spawnattr_setsigmask(&attributes, &noSignals)
    posix_spawnattr_setsigdefault(&attributes, &allSignals)
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_START_SUSPENDED))
    guard let disclaimResponsibility, disclaimResponsibility(&attributes, 1) == 0 else { return nil }
    posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0)
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0)
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup(executable.path), nil]
    let envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer { (argv + envp).forEach { free($0) } }
    var pid: pid_t = 0
    return posix_spawn(&pid, executable.path, &actions, &attributes, argv, envp) == 0 ? pid : nil
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

enum SkippedUpdateDefaults {
  static let keys = ["SUSkippedVersion", "SUSkippedMajorVersion", "SUSkippedMajorSubreleaseVersion"]

  static func unchanged(by answer: () -> Void) {
    let saved = keys.map { UserDefaults.standard.object(forKey: $0) }
    answer()
    DispatchQueue.main.async {
      for (key, value) in zip(keys, saved) { UserDefaults.standard.set(value, forKey: key) }
    }
  }
}

final class PendingChoice {
  private var reply: ((SPUUserUpdateChoice) -> Void)?

  init(_ reply: @escaping (SPUUserUpdateChoice) -> Void) {
    self.reply = reply
  }

  func answer(_ choice: SPUUserUpdateChoice) {
    guard let reply else { return }
    self.reply = nil
    reply(choice)
  }
}

final class ChannelUserDriver: NSObject, SPUUserDriver {
  private let standard: SPUStandardUserDriver
  private let isOnChannel: (SUAppcastItem) -> Bool
  private var shownItem: SUAppcastItem?
  private var pendingChoice: PendingChoice?
  private var pendingCancellation: (() -> Void)?

  init(standard: SPUStandardUserDriver, isOnChannel: @escaping (SUAppcastItem) -> Bool) {
    self.standard = standard
    self.isOnChannel = isOnChannel
  }

  override func responds(to aSelector: Selector!) -> Bool {
    super.responds(to: aSelector) || standard.responds(to: aSelector)
  }

  override func forwardingTarget(for aSelector: Selector!) -> Any? {
    standard.responds(to: aSelector) ? standard : nil
  }

  func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
    guard isOnChannel(appcastItem) else { return drop(appcastItem, answering: reply) }
    shownItem = appcastItem
    standard.showUpdateFound(with: appcastItem, state: state, reply: awaiting(reply))
  }

  func leaveOffChannelUpdate() {
    guard let item = shownItem, !isOnChannel(item) else { return }
    if let choice = pendingChoice {
      pendingChoice = nil
      drop(item, answering: choice.answer)
    } else if let cancel = pendingCancellation {
      pendingCancellation = nil
      drop(item) { _ in cancel() }
    }
  }

  private func drop(_ item: SUAppcastItem, answering reply: (SPUUserUpdateChoice) -> Void) {
    NSLog("Ardia: dropping update \(item.displayVersionString) (build \(item.versionString)): its channel isn't this copy's any more")
    UpdatePrewarm.stop()
    SkippedUpdateDefaults.unchanged { reply(.skip) }
  }

  private func awaiting(_ reply: @escaping (SPUUserUpdateChoice) -> Void) -> (SPUUserUpdateChoice) -> Void {
    let choice = PendingChoice(reply)
    pendingChoice = choice
    return { [weak self] picked in
      if self?.pendingChoice === choice { self?.pendingChoice = nil }
      if picked == .install, let self, let item = self.shownItem, !self.isOnChannel(item) {
        return self.drop(item, answering: choice.answer)
      }
      choice.answer(picked)
    }
  }

  func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
    standard.show(request, reply: reply)
  }

  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    standard.showUserInitiatedUpdateCheck(cancellation: cancellation)
  }

  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {
    standard.showUpdateReleaseNotes(with: downloadData)
  }

  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {
    standard.showUpdateReleaseNotesFailedToDownloadWithError(error)
  }

  func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
    standard.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement)
  }

  func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
    standard.showUpdaterError(error, acknowledgement: acknowledgement)
  }

  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    pendingCancellation = cancellation
    standard.showDownloadInitiated(cancellation: cancellation)
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    standard.showDownloadDidReceiveExpectedContentLength(expectedContentLength)
  }

  func showDownloadDidReceiveData(ofLength length: UInt64) {
    standard.showDownloadDidReceiveData(ofLength: length)
  }

  func showDownloadDidStartExtractingUpdate() {
    pendingCancellation = nil
    standard.showDownloadDidStartExtractingUpdate()
  }

  func showExtractionReceivedProgress(_ progress: Double) {
    standard.showExtractionReceivedProgress(progress)
  }

  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
    standard.showReady(toInstallAndRelaunch: awaiting(reply))
    leaveOffChannelUpdate()
  }

  func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {
    standard.showInstallingUpdate(withApplicationTerminated: applicationTerminated, retryTerminatingApplication: retryTerminatingApplication)
  }

  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    standard.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: acknowledgement)
  }

  func showUpdateInFocus() {
    standard.showUpdateInFocus()
  }

  func dismissUpdateInstallation() {
    shownItem = nil
    pendingChoice = nil
    pendingCancellation = nil
    standard.dismissUpdateInstallation()
  }
}

extension AppUpdater: SPUStandardUserDriverDelegate {
  public var supportsGentleScheduledUpdateReminders: Bool { true }

  public func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
    !Self.isPresentingFullScreen
  }

  public func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
    if !handleShowingUpdate { deferredUpdate = true }
  }

  public func standardUserDriverWillFinishUpdateSession() {
    deferredUpdate = false
  }

  @objc(standardUserDriverShowVersionHistoryForAppcastItem:)
  public func standardUserDriverShowVersionHistory(for item: SUAppcastItem) {
    guard let page = item.fullReleaseNotesURL else { return }
    var components = URLComponents(url: page, resolvingAgainstBaseURL: false)
    components?.fragment = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    OpenURLInbox.receive([components?.url ?? page])
  }
}
#endif
