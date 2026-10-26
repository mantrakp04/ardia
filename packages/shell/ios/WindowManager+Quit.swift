import AppKit

extension WindowManager {
  func runtimeGone(_ gone: ObjectIdentifier) {
    guard runtime == gone else { return }
    runtime = nil
    pendingOpens = [:]
    pendingOrder = []
    emit = nil
    appEventsObserved = false
    replyToTerminate(false)
  }

  func confirmQuit() {
    if MenuState.current.warnBeforeQuitting {
      let alert = NSAlert()
      alert.messageText = "Are you sure you want to quit \(ProcessInfo.processInfo.processName)?"
      alert.informativeText = "Your windows and tabs will be restored the next time you open it."
      alert.addButton(withTitle: "Quit")
      alert.addButton(withTitle: "Cancel")
      alert.showsSuppressionButton = true
      alert.suppressionButton?.title = "Don't ask again"
      let response = alert.runModal()
      if alert.suppressionButton?.state == .on { emit?("onAppEvent", ["type": "quitWarningSuppressed"]) }
      guard response == .alertFirstButtonReturn else { return }
    }
    NSApp.terminate(nil)
  }

  func shouldTerminate() -> NSApplication.TerminateReply {
    guard appEventsObserved, let emit else {
      guard AppUpdater.shared.holdsQuitForStagedUpdate else { return .terminateNow }
      quitAfterUpdaterSettles()
      return .terminateLater
    }
    guard confirmActiveDownloads() else { return .terminateCancel }
    quitAttempt += 1
    quitStep = .saving
    emit("onAppEvent", ["type": "willQuit"])
    waitForSave()
    return .terminateLater
  }

  private func waitForSave() {
    let timer = Timer(timeInterval: 5, repeats: false) { [weak self] _ in self?.saveIsLate() }
    RunLoop.main.add(timer, forMode: .common)
    saveWait = timer
  }

  private func saveIsLate() {
    saveWait = nil
    let message = "\(ProcessInfo.processInfo.processName) can't save your session right now."
    if background {
      NSLog("[shell] quit alert: \(message) (Wait / Quit Without Saving): Wait")
      return waitForSave()
    }
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = "If you quit now, your windows and tabs open as they were when it last saved."
    alert.addButton(withTitle: "Wait")
    alert.addButton(withTitle: "Quit Without Saving")
    lateSaveAlert = alert
    let response = alert.runModal()
    lateSaveAlert = nil
    switch response {
    case .alertFirstButtonReturn: waitForSave()
    case .alertSecondButtonReturn:
      guard quitStep == .saving else { return }
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
    guard quitStep != .waitingForUpdater else { return }
    saveWait?.invalidate()
    saveWait = nil
    if lateSaveAlert != nil { NSApp.stopModal(withCode: .abort) }
    guard ok else {
      quitStep = .none
      quitAttempt += 1
      return NSApp.reply(toApplicationShouldTerminate: false)
    }
    guard quitStep == .saving else { return }
    if DocumentStore.flush() { ChromeWindows.recordLaunchLayout() } else { ChromeWindows.forgetLaunchPictures() }
    quitAfterUpdaterSettles()
  }

  private func quitAfterUpdaterSettles() {
    if quitStep == .none { quitAttempt += 1 }
    quitStep = .waitingForUpdater
    let attempt = quitAttempt
    AppUpdater.shared.dropOffChannelStagedUpdateBeforeQuit { [weak self] in
      guard let self, self.quitAttempt == attempt, self.quitStep == .waitingForUpdater else { return }
      self.quitStep = .none
      NSApp.reply(toApplicationShouldTerminate: true)
    }
  }

  func reopen() {
    emit?("onAppEvent", ["type": "reopen"])
  }
}
