import AppKit

extension WindowManager {
  func restoreFullScreen(ids: [String], focus: String?) {
    fullScreenQueue = ids.filter { !fullScreenIds.contains($0) }
    fullScreenEntering = nil
    fullScreenFocus = focus
    fullScreenToggled = false
    nextFullScreen()
  }

  func nextFullScreen() {
    fullScreenTurn += 1
    let turn = fullScreenTurn
    fullScreenEntering = nil
    guard let id = fullScreenQueue.first else { return endFullScreenRestore() }
    guard windows[id] != nil else {
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.fullScreenOpenWait) { [weak self] in
        guard let self, self.fullScreenTurn == turn else { return }
        self.giveUpFullScreen(id)
      }
      return
    }
    fullScreenEntering = id
    whenRevealed(id) { [weak self] in
      guard let self, self.fullScreenTurn == turn else { return }
      guard let window = self.windows[id], window.isVisible, !window.isMiniaturized else { return self.giveUpFullScreen(id) }
      if self.fullScreenIds.contains(id) { return self.enteredFullScreen(id) }
      self.fullScreenToggled = true
      window.toggleFullScreen(nil)
      guard self.fullScreenTurn == turn else { return }
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.fullScreenEnterWait) { [weak self] in
        guard let self, self.fullScreenTurn == turn else { return }
        self.giveUpFullScreen(id)
      }
    }
  }

  private func enteredFullScreen(_ id: String) {
    guard fullScreenQueue.first == id else { return }
    fullScreenQueue.removeFirst()
    DispatchQueue.main.async { [weak self] in self?.nextFullScreen() }
  }

  private func giveUpFullScreen(_ id: String) {
    if !fullScreenIds.contains(id) { emit?("onWindowEvent", ["type": "fullScreen", "id": id, "on": false]) }
    fullScreenQueue.removeAll { $0 == id }
    nextFullScreen()
  }

  private func endFullScreenRestore() {
    let focus = fullScreenFocus.flatMap { windows[$0] }
    fullScreenFocus = nil
    guard fullScreenToggled, let focus, !background, NSApp.isActive else { return }
    fullScreenToggled = false
    focus.makeKeyAndOrderFront(nil)
  }

  @objc func fullScreenChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    let entered = notification.name == NSWindow.didEnterFullScreenNotification
    if entered { fullScreenIds.insert(id) } else { fullScreenIds.remove(id) }
    if isMainWindow(window) {
      emit?("onWindowEvent", ["type": "fullScreen", "id": id, "on": entered && !ChromeWindows.fullScreenIsForPage(window)])
    }
    if entered, fullScreenEntering == id { enteredFullScreen(id) }
  }
}
