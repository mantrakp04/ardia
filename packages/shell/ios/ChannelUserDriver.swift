import AppKit
import Sparkle

final class ChannelUserDriver: NSObject, SPUUserDriver {
  private enum Showing {
    case nothing
    case asking(SUAppcastItem, PendingChoice, staged: Bool)
    case downloading(SUAppcastItem, cancel: () -> Void)
    case shown(SUAppcastItem)

    var item: SUAppcastItem? {
      switch self {
      case .nothing: return nil
      case .asking(let item, _, _), .downloading(let item, _), .shown(let item): return item
      }
    }
  }

  private let standard: SPUStandardUserDriver
  private let isOnChannel: (SUAppcastItem) -> Bool
  private let cancelledInstaller: (SUAppcastItem) -> Void
  private var showing = Showing.nothing

  init(standard: SPUStandardUserDriver, isOnChannel: @escaping (SUAppcastItem) -> Bool,
       cancelledInstaller: @escaping (SUAppcastItem) -> Void) {
    self.standard = standard
    self.isOnChannel = isOnChannel
    self.cancelledInstaller = cancelledInstaller
  }

  override func responds(to aSelector: Selector!) -> Bool {
    super.responds(to: aSelector) || standard.responds(to: aSelector)
  }

  override func forwardingTarget(for aSelector: Selector!) -> Any? {
    standard.responds(to: aSelector) ? standard : nil
  }

  func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
    guard isOnChannel(appcastItem) else { return drop(appcastItem, staged: state.stage == .installing, answering: reply) }
    showing = .shown(appcastItem)
    let staged = state.stage == .installing
    if staged { UpdatePrewarm.warm(version: appcastItem.versionString) }
    standard.showUpdateFound(with: appcastItem, state: state, reply: awaiting(reply, staged: staged))
  }

  func leaveOffChannelUpdate() {
    guard let item = showing.item, !isOnChannel(item) else { return }
    switch showing {
    case .asking(_, let choice, let staged):
      showing = .shown(item)
      drop(item, staged: staged, answering: choice.answer)
    case .downloading(_, let cancel):
      showing = .shown(item)
      drop(item, staged: false) { _ in cancel() }
    case .nothing, .shown:
      break
    }
  }

  private func drop(_ item: SUAppcastItem, staged: Bool, answering reply: (SPUUserUpdateChoice) -> Void) {
    NSLog("Ardia: dropping update \(item.displayVersionString) (build \(item.versionString)): its channel isn't this copy's any more")
    UpdatePrewarm.stop()
    if staged { cancelledInstaller(item) }
    SkippedUpdateDefaults.unchanged { reply(.skip) }
  }

  private func awaiting(_ reply: @escaping (SPUUserUpdateChoice) -> Void, staged: Bool = false) -> (SPUUserUpdateChoice) -> Void {
    let choice = PendingChoice(reply)
    if let item = showing.item { showing = .asking(item, choice, staged: staged) }
    return { [weak self] picked in
      if let self, case .asking(let item, let asked, _) = self.showing, asked === choice { self.showing = .shown(item) }
      guard picked == .install, let self, let item = self.showing.item else { return choice.answer(picked) }
      guard self.isOnChannel(item) else { return self.drop(item, staged: staged, answering: choice.answer) }
      guard staged else { return choice.answer(.install) }
      UpdatePrewarm.beforeInstall(version: item.versionString) { [weak self] in
        if let self, !self.isOnChannel(item) { return self.drop(item, staged: true, answering: choice.answer) }
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
    if let item = showing.item { showing = .downloading(item, cancel: cancellation) }
    standard.showDownloadInitiated(cancellation: cancellation)
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    standard.showDownloadDidReceiveExpectedContentLength(expectedContentLength)
  }

  func showDownloadDidReceiveData(ofLength length: UInt64) {
    standard.showDownloadDidReceiveData(ofLength: length)
  }

  func showDownloadDidStartExtractingUpdate() {
    if case .downloading(let item, _) = showing { showing = .shown(item) }
    standard.showDownloadDidStartExtractingUpdate()
  }

  func showExtractionReceivedProgress(_ progress: Double) {
    standard.showExtractionReceivedProgress(progress)
  }

  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
    if let item = showing.item, isOnChannel(item) { UpdatePrewarm.warm(version: item.versionString) }
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
    showing = .nothing
    standard.dismissUpdateInstallation()
  }
}
