import AppKit
import ExpoModulesCore

public class FocusModule: Module {
  private static var pendingUIOwner: ObjectIdentifier?

  private let lifetime = ModuleLifetime()
  private var switcherMonitor: Any?
  private var dragEscapeMonitor: Any?
  private let switcherPointer = SwitcherPointer()

  public func definition() -> ModuleDefinition {
    Name("ArdiaFocus")

    OnCreate {
      self.lifetime.begin(self) {
        if let monitor = self.switcherMonitor { NSEvent.removeMonitor(monitor) }
        self.switcherMonitor = nil
        if let monitor = self.dragEscapeMonitor { NSEvent.removeMonitor(monitor) }
        self.dragEscapeMonitor = nil
        if Self.pendingUIOwner == ObjectIdentifier(self) {
          Self.pendingUIOwner = nil
          FocusHandoff.shared.afterPendingUI = { DispatchQueue.main.async(execute: $0) }
        }
      }
      self.lifetime.onMain { [weak self] in
        guard let self else { return }
        FocusHandoff.shared.install()
        if let queue = self.appContext?.reactBridge?.uiManager.methodQueue {
          FocusHandoff.shared.afterPendingUI = { block in queue.async { DispatchQueue.main.async(execute: block) } }
          Self.pendingUIOwner = ObjectIdentifier(self)
        }
      }
    }

    OnDestroy { self.lifetime.end() }

    AsyncFunction("cancelFocusMove") { (generation: Int, restoringSource: Bool) in
      FocusHandoff.shared.cancel(generation, restoringSource: restoringSource)
    }.runOnQueue(.main)
    AsyncFunction("claimFocus") { [weak self] (generation: Int, tag: Int) in
      guard let view = self?.appContext?.findView(withTag: tag, ofType: NSView.self) else { return }
      FocusHandoff.shared.claim(generation, destination: view)
    }.runOnQueue(.main)
    AsyncFunction("saveKeyResponder") { (windowId: String) -> Int in
      SavedKeyResponders.shared.save(WindowManager.shared.window(windowId))
    }.runOnQueue(.main)
    AsyncFunction("restoreKeyResponder") { (token: Int) -> Bool in
      SavedKeyResponders.shared.restore(token)
    }.runOnQueue(.main)
    AsyncFunction("discardKeyResponder") { (token: Int) in
      SavedKeyResponders.shared.discard(token)
    }.runOnQueue(.main)

    AsyncFunction("setSwitcherCapture") { [weak self] (active: Bool) in
      guard let self else { return }
      self.lifetime.run { self.setSwitcherCapture(active) }
    }.runOnQueue(.main)

    AsyncFunction("setDragEscapeCapture") { [weak self] (active: Bool) in
      guard let self else { return }
      self.lifetime.run { self.setDragEscapeCapture(active) }
    }.runOnQueue(.main)

    Function("switcherPointerMoved") { [weak self] () -> Bool in self?.switcherPointer.moved(to: NSEvent.mouseLocation) ?? true }
  }

  private func setSwitcherCapture(_ active: Bool) {
    if let monitor = switcherMonitor { NSEvent.removeMonitor(monitor) }
    switcherMonitor = nil
    switcherPointer.start(active ? NSEvent.mouseLocation : nil)
    guard active else { return }
    let emit: ([String: Any]) -> Void = { ShellEvents.send(.app, $0) }
    switcherMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseUp, .rightMouseUp, .otherMouseUp]) { event in
      guard event.type == .keyDown else {
        emit(["type": "switcherMouseUp"])
        return event
      }
      if MainMenu.isSwitcherKey(event) { return event }
      switch event.keyCode {
      case 53: emit(["type": "switcherKey", "key": "escape"])
      case 124: emit(["type": "switcherKey", "key": "next"])
      case 123: emit(["type": "switcherKey", "key": "previous"])
      default: break
      }
      return nil
    }
  }

  private func setDragEscapeCapture(_ active: Bool) {
    if let monitor = dragEscapeMonitor { NSEvent.removeMonitor(monitor) }
    dragEscapeMonitor = nil
    guard active else { return }
    let emit: ([String: Any]) -> Void = { ShellEvents.send(.app, $0) }
    dragEscapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
      guard event.keyCode == 53 || event.charactersIgnoringModifiers == "\u{1b}", modifiers.isEmpty else { return event }
      emit(["type": "dragEscape"])
      return nil
    }
  }
}
