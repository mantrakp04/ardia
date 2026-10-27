import AppKit
import ArdiaCore
import Sparkle

public final class AppUpdater: NSObject {
  public static let shared = AppUpdater()

  static var feedOverride: String? {
    let config = LaunchConfig.shared
    if let feed = config.instance("updateFeed") ?? UserDefaults.standard.string(forKey: "ACUpdateFeedURL") { return feed }
    return config.background ? "https://github.com/mantrakp04/ardia/releases/latest/download/appcast.xml" : nil
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
    guard started else { return }
    channelChangePending = true
    userDriver.leaveOffChannelUpdate()
    applyChannelChangeWhenIdle()
  }

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

  static let quitWaitLimit: TimeInterval = 8
  static let quitWaitAfterIdle: TimeInterval = 1

  public var holdsQuitForStagedUpdate: Bool {
    started && hasOffChannelStagedUpdate
  }

  public func dropOffChannelStagedUpdateBeforeQuit(then quit: @escaping () -> Void) {
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
    ArdiaIsolatedDataDirectory() != nil && LaunchConfig.shared.instance("updateFeed") == nil
  }

  private lazy var userDriver = ChannelUserDriver(standard: SPUStandardUserDriver(hostBundle: .main, delegate: self)) { [unowned self] item in
    item.channel.map { self.allowedChannels.contains($0) } ?? true
  }
  private lazy var updater = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: userDriver, delegate: self)
  private var deferredUpdate = false
  private var channelChangePending = false
  private var sessionObservation: NSKeyValueObservation?
  private var firstCheckPending = false
  private var started = false

  public var isConfigured: Bool {
    guard !Self.isOff else { return false }
    let info = Bundle.main.infoDictionary ?? [:]
    let feed = (Self.feedOverride ?? info["SUFeedURL"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    let key = (info["SUPublicEDKey"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    guard let scheme = URL(string: feed)?.scheme?.lowercased() else { return false }
    return (scheme == "https" || scheme == "http") && !key.isEmpty
  }

  public func start() {
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
  }

  @objc public func checkForUpdates(_ sender: Any?) {
    guard isConfigured else {
      if LaunchConfig.shared.background {
        return NSLog("Ardia: update checks are off in this instance")
      }
      return showNotSetUp()
    }
    start()
    updater.checkForUpdates()
  }

  public var state: [String: Any] {
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
  }

  public func setAutomaticChecks(_ on: Bool) {
    updater.automaticallyChecksForUpdates = on
  }

  public func setAutomaticDownloads(_ on: Bool) {
    updater.automaticallyDownloadsUpdates = on
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

  @objc private func fullScreenChanged() {
    DispatchQueue.main.async { [self] in
      guard !Self.isPresentingFullScreen, deferredUpdate else { return }
      deferredUpdate = false
      updater.checkForUpdates()
    }
  }
}

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
    UpdatePrewarm.start(version: item.versionString)
    return false
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
