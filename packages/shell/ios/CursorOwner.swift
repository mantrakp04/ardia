import AppKit
import ExpoModulesCore

public class CursorOwnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaCursorOwner")

    View(CursorOwner.self) {}
  }
}

final class CursorOwner: ExpoView {
  private weak var previousResponder: NSResponder?
  private var keyObserver: NSObjectProtocol?

  override var acceptsFirstResponder: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    return hit === self ? nil : hit
  }

  override func mouseMoved(with event: NSEvent) {}

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
    keyObserver = nil
    guard let window else { return }
    keyObserver = NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main) {
      [weak self] _ in self?.claimFirstResponder()
    }
    DispatchQueue.main.async { [weak self] in self?.claimFirstResponder() }
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil, let window, window.firstResponder === self {
      window.makeFirstResponder(previousResponder.flatMap { $0 as? NSView }.flatMap { $0.window === window ? $0 : nil })
    }
    super.viewWillMove(toWindow: newWindow)
  }

  private func claimFirstResponder() {
    guard let window, holdsDefaultFocus(window) else { return }
    previousResponder = window.firstResponder
    window.makeFirstResponder(self)
  }

  private func holdsDefaultFocus(_ window: NSWindow) -> Bool {
    guard let responder = window.firstResponder else { return true }
    if responder === window { return true }
    guard let view = responder as? NSView, view !== self else { return false }
    return isDescendant(of: view)
  }

  deinit {
    if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
  }
}
