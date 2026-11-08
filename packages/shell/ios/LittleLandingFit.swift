import AppKit
import ArdiaCore

final class LittleLandingFit {
  private let currentWindow: () -> NSWindow?
  private let apply: (NSWindow, NSRect) -> Void
  private var observers: [(center: NotificationCenter, token: NSObjectProtocol)] = []
  private var stopped = false

  init(window: @escaping () -> NSWindow?, apply: @escaping (NSWindow, NSRect) -> Void) {
    currentWindow = window
    self.apply = apply
  }

  deinit { stop() }

  func start() {
    listen(NSWorkspace.shared.notificationCenter, NSWorkspace.activeSpaceDidChangeNotification) { [weak self] _ in self?.fit() }
    for name in [NSWindow.willMoveNotification, NSWindow.willStartLiveResizeNotification] {
      listen(NotificationCenter.default, name) { [weak self] note in
        guard let self, let window = note.object as? NSWindow, window === self.currentWindow() else { return }
        self.stop()
      }
    }
    DispatchQueue.main.async { [weak self] in self?.fit() }
  }

  func fit() {
    guard !stopped, let window = currentWindow(), window.isVisible, !window.styleMask.contains(.fullScreen),
      let frame = ArdiaChromeWindowHost.littleFrameFittingLanding(of: window, minimumSize: window.minSize)?.rectValue
    else { return }
    apply(window, frame)
  }

  func stop() {
    stopped = true
    for observer in observers { observer.center.removeObserver(observer.token) }
    observers = []
  }

  private func listen(_ center: NotificationCenter, _ name: Notification.Name, _ handler: @escaping (Notification) -> Void) {
    observers.append((center, center.addObserver(forName: name, object: nil, queue: .main, using: handler)))
  }
}
