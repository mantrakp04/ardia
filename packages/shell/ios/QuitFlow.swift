import AppKit
import ArdiaCore

final class QuitFlow {
  static let shared = QuitFlow()

  private enum Phase {
    case idle
    case saving(wait: Timer?, lateAlert: NSAlert?)
    case waitingForUpdater
  }

  private var phase = Phase.idle
  private var attempt = 0
  private static let saveWait: TimeInterval = 5

  private var isSaving: Bool {
    if case .saving = phase { return true }
    return false
  }

  func confirm() {
    if MenuState.current.warnBeforeQuitting {
      let alert = NSAlert()
      alert.messageText = "Are you sure you want to quit \(ProcessInfo.processInfo.processName)?"
      alert.informativeText = "Your windows and tabs will be restored the next time you open it."
      alert.addButton(withTitle: "Quit")
      alert.addButton(withTitle: "Cancel")
      alert.showsSuppressionButton = true
      alert.suppressionButton?.title = "Don't ask again"
      let response = alert.runModal()
      if alert.suppressionButton?.state == .on { ShellEvents.send(.app, ["type": "quitWarningSuppressed"]) }
      guard response == .alertFirstButtonReturn else { return }
    }
    NSApp.terminate(nil)
  }

  func shouldTerminate() -> NSApplication.TerminateReply {
    guard ShellEvents.isAttached(.app), ShellEvents.isAttached(.window) else {
      guard AppUpdater.shared.holdsQuitForStagedUpdate else { return .terminateNow }
      quitAfterUpdaterSettles()
      return .terminateLater
    }
    guard confirmActiveDownloads() else { return .terminateCancel }
    attempt += 1
    phase = .saving(wait: nil, lateAlert: nil)
    ShellEvents.send(.app, ["type": "willQuit"])
    waitForSave()
    return .terminateLater
  }

  private func waitForSave() {
    let timer = Timer(timeInterval: Self.saveWait, repeats: false) { [weak self] _ in self?.saveIsLate() }
    RunLoop.main.add(timer, forMode: .common)
    if isSaving { phase = .saving(wait: timer, lateAlert: nil) }
  }

  private func saveIsLate() {
    if isSaving { phase = .saving(wait: nil, lateAlert: nil) }
    let message = "\(ProcessInfo.processInfo.processName) can't save your session right now."
    if LaunchConfig.shared.background {
      NSLog("[shell] quit alert: \(message) (Wait / Quit Without Saving): Wait")
      return waitForSave()
    }
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = "If you quit now, your windows and tabs open as they were when it last saved."
    alert.addButton(withTitle: "Wait")
    alert.addButton(withTitle: "Quit Without Saving")
    if isSaving { phase = .saving(wait: nil, lateAlert: alert) }
    let response = alert.runModal()
    if case .saving(let wait, let shown) = phase, shown === alert { phase = .saving(wait: wait, lateAlert: nil) }
    switch response {
    case .alertFirstButtonReturn: waitForSave()
    case .alertSecondButtonReturn:
      guard isSaving else { return }
      DocumentStore.close()
      quitAfterUpdaterSettles()
    default: break
    }
  }

  private func confirmActiveDownloads() -> Bool {
    let count = MenuState.current.downloadsInProgress
    guard count > 0 else { return true }
    let alert = NSAlert()
    alert.messageText = "Are you sure you want to quit \(ProcessInfo.processInfo.processName)?"
    alert.informativeText = count == 1
      ? "You have 1 download in progress. If you quit now, this download will be cancelled."
      : "You have \(count) downloads in progress. If you quit now, these downloads will be cancelled."
    alert.addButton(withTitle: "Quit")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
  }

  func replyToTerminate(_ ok: Bool) {
    if case .idle = phase { return }
    if case .waitingForUpdater = phase, ok { return }
    if case .saving(let wait, let lateAlert) = phase {
      wait?.invalidate()
      phase = .saving(wait: nil, lateAlert: nil)
      if lateAlert != nil { NSApp.stopModal(withCode: .abort) }
    }
    guard ok else {
      phase = .idle
      attempt += 1
      return NSApp.reply(toApplicationShouldTerminate: false)
    }
    guard isSaving else { return }
    if DocumentStore.flush() { ArdiaChromeWindowHost.recordLaunchLayout() } else { ArdiaChromeWindowHost.forgetLaunchPictures() }
    quitAfterUpdaterSettles()
  }

  private func quitAfterUpdaterSettles() {
    if case .idle = phase { attempt += 1 }
    phase = .waitingForUpdater
    let attempt = self.attempt
    AppUpdater.shared.dropOffChannelStagedUpdateBeforeQuit { [weak self] in
      guard let self, self.attempt == attempt, case .waitingForUpdater = self.phase else { return }
      self.phase = .idle
      NSApp.reply(toApplicationShouldTerminate: true)
    }
  }
}
