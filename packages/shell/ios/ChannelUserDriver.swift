import AppKit
import Sparkle

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
    let staged = state.stage == .installing
    if staged { UpdatePrewarm.warm(version: appcastItem.versionString) }
    standard.showUpdateFound(with: appcastItem, state: state, reply: awaiting(reply, staged: staged))
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

  private func awaiting(_ reply: @escaping (SPUUserUpdateChoice) -> Void, staged: Bool = false) -> (SPUUserUpdateChoice) -> Void {
    let choice = PendingChoice(reply)
    pendingChoice = choice
    return { [weak self] picked in
      if self?.pendingChoice === choice { self?.pendingChoice = nil }
      guard picked == .install, let self, let item = self.shownItem else { return choice.answer(picked) }
      guard self.isOnChannel(item) else { return self.drop(item, answering: choice.answer) }
      guard staged else { return choice.answer(.install) }
      UpdatePrewarm.beforeInstall(version: item.versionString) { [weak self] in
        if let self, !self.isOnChannel(item) { return self.drop(item, answering: choice.answer) }
        choice.answer(.install)
      }
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
    if let item = shownItem, isOnChannel(item) { UpdatePrewarm.warm(version: item.versionString) }
    standard.showReady(toInstallAndRelaunch: awaiting(reply, staged: true))
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
