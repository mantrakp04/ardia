import AppKit

final class ManagedWindow {
  enum Reveal {
    case shown
    case waiting(then: [() -> Void], entrance: Bool?)
  }

  let id: String
  let kind: WindowKind
  var window: NSWindow
  var isFullScreen = false
  var reveal = Reveal.shown
  var exit: [() -> Void]?
  var contentShown = false
  var closingFromJS = false
  private var contentObserver: NSObjectProtocol?
  private var contentSizer: NSObjectProtocol?

  init(id: String, kind: WindowKind, window: NSWindow) {
    self.id = id
    self.kind = kind
    self.window = window
  }

  deinit {
    stopWatchingContent()
  }

  var isWaitingToReveal: Bool {
    if case .waiting = reveal { return true }
    return false
  }

  func whenRevealed(_ then: @escaping () -> Void) {
    guard case .waiting(var waiting, let entrance) = reveal else { return then() }
    waiting.append(then)
    reveal = .waiting(then: waiting, entrance: entrance)
  }

  func takeReveal() -> (then: [() -> Void], entrance: Bool?)? {
    guard case .waiting(let then, let entrance) = reveal else { return nil }
    reveal = .shown
    return (then, entrance)
  }

  func takeExit() -> [() -> Void]? {
    defer { exit = nil }
    return exit
  }

  func watchContent(of root: NSView, appeared: @escaping (ManagedWindow, NSView) -> Void) {
    if let old = contentObserver { NotificationCenter.default.removeObserver(old) }
    contentObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("RCTContentDidAppearNotification"), object: root, queue: .main
    ) { [weak self, weak root] _ in
      guard let self, let root else { return }
      appeared(self, root)
    }
  }

  func keepContentSized(in root: NSView) {
    if let old = contentSizer { NotificationCenter.default.removeObserver(old) }
    contentSizer = nil
    guard let content = root.subviews.first(where: { NSStringFromClass(type(of: $0)).hasSuffix("RootContentView") }) else { return }
    content.postsFrameChangedNotifications = true
    contentSizer = NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: content, queue: .main) {
      [weak root, weak content] _ in
      guard let root, let content, content.superview === root, root.window != nil, !root.bounds.isEmpty,
        content.frame.size != root.bounds.size
      else { return }
      root.needsLayout = true
      content.needsLayout = true
    }
  }

  func stopWatchingContent() {
    for token in [contentObserver, contentSizer] {
      if let token { NotificationCenter.default.removeObserver(token) }
    }
    contentObserver = nil
    contentSizer = nil
  }
}
