import AppKit

final class MenuTarget: NSObject, NSMenuItemValidation {
  static let shared = MenuTarget()
  var handler: ((String, String?, String?) -> Void)?

  private static let focusMovingCommands: Set<String> = ["newTab", "focusCommandBar", "findInPage"]

  @objc(commandDispatch:) func performCommand(_ sender: NSMenuItem) {
    guard let item = sender as? CommandItem else { return }
    _ = FocusHandoff.shared.takeBegun()
    if Self.focusMovingCommands.contains(item.command) || FocusHandoff.shared.gatesKeyWindow, let window = NSApp.keyWindow {
      FocusHandoff.shared.begin(in: window)
    }
    handler?(item.command, item.arg, item.windowless ? nil : WindowManager.shared.keyWindowId)
    if item.command == "tabSwitcher" { SwitcherHold.opened(by: item) }
  }

  @objc(cut:) func cutEdit(_ sender: Any?) { forwardEdit(#selector(NSText.cut(_:)), from: sender) }
  @objc(copy:) func copyEdit(_ sender: Any?) { forwardEdit(#selector(NSText.copy(_:)), from: sender) }
  @objc(paste:) func pasteEdit(_ sender: Any?) { forwardEdit(#selector(NSText.paste(_:)), from: sender) }
  @objc(selectAll:) func selectAllEdit(_ sender: Any?) { forwardEdit(#selector(NSText.selectAll(_:)), from: sender) }

  static let undoAction = Selector(("undo:"))

  @objc(undo:) func undoOrReopenClosedTab(_ sender: Any?) {
    if Self.undoReopensClosedTab {
      handler?("reopenClosedTab", nil, WindowManager.shared.keyWindowId)
    } else {
      NSApp.sendAction(Self.undoAction, to: nil, from: sender)
    }
  }

  private static var undoReopensClosedTab: Bool {
    let state = MenuState.current
    guard state.undoReopensClosedTab, !state.disabled.contains("reopenClosedTab"),
      WindowManager.shared.keyWindowId != "settings", let window = WindowManager.shared.keyBrowserWindow
    else { return false }
    return !MainMenu.editsText(window.firstResponder)
  }

  private func forwardEdit(_ action: Selector, from sender: Any?) {
    if FocusHandoff.shared.defers(action) { return }
    FocusHandoff.shared.noteForwarded(action)
    NSApp.sendAction(action, to: nil, from: sender)
  }

  private static func validateForwarded(_ menuItem: NSMenuItem, _ action: Selector) -> Bool {
    guard let target = NSApp.target(forAction: action) as? NSObject else { return false }
    typealias Validate = @convention(c) (AnyObject, Selector, NSMenuItem) -> ObjCBool
    for name in ["validateMenuItem:", "validateUserInterfaceItem:"] {
      let validate = NSSelectorFromString(name)
      if target.responds(to: validate) {
        return unsafeBitCast(target.method(for: validate), to: Validate.self)(target, validate, menuItem).boolValue
      }
    }
    return true
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    if let action = menuItem.action, FocusHandoff.editActions.contains(action), FocusHandoff.shared.gatesKeyWindow { return true }
    if let action = menuItem.action, FocusHandoff.editActions.contains(action), !(menuItem is CommandItem),
      action != #selector(pasteAndMatchStyle(_:)) {
      return Self.validateForwarded(menuItem, action)
    }
    if menuItem.action == #selector(closeWindow(_:)) { return WindowManager.shared.closableWindow != nil }
    if menuItem.action == #selector(toggleKeepOnTop(_:)) {
      guard let window = WindowManager.shared.keyBrowserWindow else { return false }
      menuItem.state = window.level == .floating ? .on : .off
      return true
    }
    if menuItem.action == Self.undoAction {
      let reopens = Self.undoReopensClosedTab
      let title = reopens ? "Undo Close Tab" : (menuItem as? StandardItem)?.defaultTitle ?? menuItem.title
      if menuItem.title != title { menuItem.title = title }
      return reopens || Self.validateForwarded(menuItem, Self.undoAction)
    }
    guard let item = menuItem as? CommandItem else { return true }
    let state = MenuState.current
    if item.tracksChecked { item.state = state.checked.contains(item.stateKey) ? .on : .off }
    let title = state.titles[item.stateKey] ?? item.defaultTitle
    if item.title != title { item.title = title }
    if item.keyEquivalent == "\r", NSApp.keyWindow?.firstResponder is NSText { return false }
    if MainMenu.movesCaret(item), NSApp.currentEvent?.type == .keyDown, MainMenu.editsText(NSApp.keyWindow?.firstResponder) { return false }
    if item.command == "findInPage", WindowManager.shared.keyWindowId == "settings" { return true }
    let enabled = !state.disabled.contains(item.stateKey) && !state.disabled.contains(item.command)
    if item.hidesWhenDisabled, item.isHidden == enabled { item.isHidden = !enabled }
    return enabled
  }

  @objc func quit(_ sender: Any?) { WindowManager.shared.confirmQuit() }
  @objc func arrangeWindowsInFront(_ sender: Any?) { NSApp.arrangeInFront(sender) }
  @objc func toggleKeepOnTop(_ sender: Any?) { WindowManager.shared.toggleKeepOnTop() }
  @objc func closeWindow(_ sender: Any?) { WindowManager.shared.closableWindow?.performClose(sender) }

  @objc func pasteAndMatchStyle(_ sender: Any?) {
    let web = Selector(("pasteAndMatchStyle:"))
    if FocusHandoff.shared.defers(web) { return }
    if NSApp.target(forAction: web) != nil {
      NSApp.sendAction(web, to: nil, from: sender)
    } else {
      NSApp.sendAction(#selector(NSTextView.pasteAsPlainText(_:)), to: nil, from: sender)
    }
  }
}
