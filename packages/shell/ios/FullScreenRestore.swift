import AppKit
import ArdiaCore

final class FullScreenRestore {
  private unowned let windows: WindowManager
  private var queue: [String] = []
  private var entering: String?
  private var focus: String?
  private var toggled = false
  private var turn = 0
  private static let openWait = 5.0
  private static let enterWait = 3.0

  init(windows: WindowManager) {
    self.windows = windows
  }

  func restore(ids: [String], focus: String?) {
    queue = ids.filter { !windows.isFullScreen($0) }
    entering = nil
    self.focus = focus
    toggled = false
    next()
  }

  func windowShown(_ id: String) {
    if entering == nil, queue.first == id { next() }
  }

  func entered(_ id: String) {
    guard entering == id, queue.first == id else { return }
    queue.removeFirst()
    DispatchQueue.main.async { [weak self] in self?.next() }
  }

  private func next() {
    turn += 1
    let turn = self.turn
    entering = nil
    guard let id = queue.first else { return end() }
    guard windows.window(id) != nil else {
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.openWait) { [weak self] in
        guard let self, self.turn == turn else { return }
        self.giveUp(id)
      }
      return
    }
    entering = id
    windows.whenRevealed(id) { [weak self] in
      guard let self, self.turn == turn else { return }
      guard let window = self.windows.window(id), window.isVisible, !window.isMiniaturized else { return self.giveUp(id) }
      if self.windows.isFullScreen(id) { return self.entered(id) }
      self.toggled = true
      window.toggleFullScreen(nil)
      guard self.turn == turn else { return }
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.enterWait) { [weak self] in
        guard let self, self.turn == turn else { return }
        self.giveUp(id)
      }
    }
  }

  private func giveUp(_ id: String) {
    if !windows.isFullScreen(id) { ShellEvents.send(.window, ["type": "fullScreen", "id": id, "on": false]) }
    queue.removeAll { $0 == id }
    next()
  }

  private func end() {
    let focus = self.focus.flatMap { windows.window($0) }
    self.focus = nil
    guard toggled, let focus, !LaunchConfig.shared.background, NSApp.isActive else { return }
    toggled = false
    focus.makeKeyAndOrderFront(nil)
  }
}
