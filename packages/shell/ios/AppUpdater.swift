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

  static let channelDefaultsKey = "ACUpdateChannel"

  static var buildChannel: UpdateChannel {
    Bundle.main.object(forInfoDictionaryKey: "ACUpdateChannel") as? String == "nightly" ? .nightly : .stable
  }

  private static var savedChannel: UpdateChannel? {
    UserDefaults.standard.string(forKey: channelDefaultsKey).flatMap(UpdateChannel.init(rawValue:))
  }

  public var channel: UpdateChannel { Self.savedChannel ?? Self.buildChannel }

  public func setChannel(_ channel: UpdateChannel) {
    UserDefaults.standard.set(channel.rawValue, forKey: Self.channelDefaultsKey)
    guard started else { return }
    apply(channelSwitch.switched())
    userDriver.leaveOffChannelUpdate()
    refreshChannelSwitch()
  }

  private var offChannelNightly: Bool { !allowedChannels.contains(UpdateChannel.nightly.rawValue) }

  private func refreshChannelSwitch() {
    guard channelSwitch.wantsFacts else { return }
    guard !surveying else { return surveyAgain = true }
    guard let caches = StagedUpdateCopies.userCaches, let bundleId = Bundle.main.bundleIdentifier else { return }
    surveying = true
    let offChannel = offChannelNightly
    Self.files.async { [weak self] in
      let survey = offChannel ? StagedSurvey.survey(caches: caches, bundleId: bundleId) : StagedSurvey.Survey()
      DispatchQueue.main.async { self?.surveyed(survey, offChannel: offChannel) }
    }
  }

  private func surveyed(_ survey: StagedSurvey.Survey, offChannel: Bool) {
    surveying = false
    guard offChannel == offChannelNightly else {
      surveyAgain = false
      return refreshChannelSwitch()
    }
    let nightly = survey.found.filter { $0.channel == UpdateChannel.nightly.rawValue }.map(\.copy)
    let sighting = ChannelSwitch.Sighting(copies: Set(nightly), residue: survey.residue, blind: survey.blind)
    let busy = updater.sessionInProgress
    let facts = channelSwitch.observe(sighting, busy: busy, automaticChecks: updater.automaticallyChecksForUpdates)
    apply(channelSwitch.changed(facts))
    if surveyAgain {
      surveyAgain = false
      refreshChannelSwitch()
    }
  }

  private func apply(_ effects: [ChannelSwitch.Effect]) {
    for effect in effects {
      switch effect {
      case .resume:
        updater.checkForUpdatesInBackground()
      case .resetCycle:
        updater.resetUpdateCycle()
      case .watch:
        guard installationWatch == nil, let caches = StagedUpdateCopies.userCaches, let bundleId = Bundle.main.bundleIdentifier else { continue }
        let folder = StagedSurvey.root(caches: caches, bundleId: bundleId)
        let watch = FolderWatch(path: folder.path, queue: Self.files) {
          DispatchQueue.main.async { [weak self] in self?.refreshChannelSwitch() }
        }
        installationWatch = watch
        Self.files.async { watch.start() }
      case .unwatch:
        let watch = installationWatch
        installationWatch = nil
        Self.files.async { watch?.stop() }
      case .release(let waits):
        for wait in waits { quitWaits.removeValue(forKey: wait)?() }
      case .log(let line):
        NSLog("Ardia: \(line)")
      }
    }
  }

  private static let files = DispatchQueue(label: "com.ardia.updater.staged-copies", qos: .userInitiated)

  static let quitWaitLimit: TimeInterval = 8

  public var holdsQuitForStagedUpdate: Bool { started }

  public func dropOffChannelStagedUpdateBeforeQuit(then quit: @escaping () -> Void) {
    guard started else { return quit() }
    lastQuitWait += 1
    let wait = lastQuitWait
    quitWaits[wait] = quit
    channelSwitch.quit(wait)
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.quitWaitLimit) { [weak self] in
      guard let self else { return }
      self.apply(self.channelSwitch.deadline(wait))
    }
    refreshChannelSwitch()
  }

  var allowedChannels: Set<String> {
    channel == .nightly ? [UpdateChannel.nightly.rawValue] : []
  }

  private func rememberChannel() {
    guard Self.savedChannel == nil else { return }
    UserDefaults.standard.set(Self.buildChannel.rawValue, forKey: Self.channelDefaultsKey)
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
    LaunchConfig.shared.isolated && LaunchConfig.shared.instance("updateFeed") == nil
  }

  private lazy var userDriver = ChannelUserDriver(
    standard: SPUStandardUserDriver(hostBundle: .main, delegate: self),
    isOnChannel: { [unowned self] item in item.channel.map { self.allowedChannels.contains($0) } ?? true },
    cancelledInstaller: { [unowned self] item in
      self.apply(self.channelSwitch.installerCancelled(build: item.versionString))
      self.refreshChannelSwitch()
    })
  private lazy var updater = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: userDriver, delegate: self)
  private var deferredUpdate = false
  private var channelSwitch = ChannelSwitch()
  private var installationWatch: FolderWatch?
  private var quitWaits: [Int: () -> Void] = [:]
  private var lastQuitWait = 0
  private var surveying = false
  private var surveyAgain = false
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
      DispatchQueue.main.async { self?.refreshChannelSwitch() }
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
      "channel": channel.rawValue,
      "buildChannel": Self.buildChannel.rawValue,
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
