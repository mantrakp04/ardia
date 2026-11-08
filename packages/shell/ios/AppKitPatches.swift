import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

let installTextFieldSelectAll: Void = {
  let block: @convention(block) (NSTextField, Any?) -> Void = { field, sender in
    if let editor = field.currentEditor() { editor.selectAll(sender) } else { field.selectText(sender) }
  }
  class_addMethod(NSTextField.self, #selector(NSText.selectAll(_:)), imp_implementationWithBlock(block), "v@:@")
}()

let installViewSelectAll: Void = {
  guard let viewClass = NSClassFromString("RCTView"), let handledKey = NSClassFromString("RCTHandledKey"),
        let matchesMethod = class_getClassMethod(handledKey, NSSelectorFromString("event:matchesFilter:")) else { return }
  typealias Matches = @convention(c) (AnyClass, Selector, NSEvent, NSArray?) -> ObjCBool
  let matches = unsafeBitCast(method_getImplementation(matchesMethod), to: Matches.self)
  let selectAll = #selector(NSText.selectAll(_:))
  let block: @convention(block) (NSView, Any?) -> Void = { view, sender in
    let key = view.window.flatMap { window in
      NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: .command, timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, characters: "a", charactersIgnoringModifiers: "a",
        isARepeat: false, keyCode: UInt16(kVK_ANSI_A))
    }
    if let key, matches(handledKey, NSSelectorFromString("event:matchesFilter:"), key, view.value(forKey: "keyDownEvents") as? NSArray).boolValue {
      view.keyDown(with: key)
    } else {
      view.nextResponder?.tryToPerform(selectAll, with: sender)
    }
  }
  class_addMethod(viewClass, selectAll, imp_implementationWithBlock(block), "v@:@")
}()

let installSubmenuAction: Void = {
  let submenuAction = NSSelectorFromString("submenuAction:")
  guard !NSMenu.instancesRespond(to: submenuAction) else { return }
  let block: @convention(block) (NSMenu, Any?) -> Void = { _, _ in }
  class_addMethod(NSMenu.self, submenuAction, imp_implementationWithBlock(block), "v@:@")
}()

let installInputSourceKeys: Void = {
  let processKeyBindings = NSSelectorFromString("processInputKeyBindings:")
  let keyDown = #selector(NSResponder.keyDown(with:))
  guard NSTextInputContext.responds(to: processKeyBindings), let method = class_getInstanceMethod(NSTextView.self, keyDown) else { return }
  typealias KeyDown = @convention(c) (NSTextView, Selector, NSEvent) -> Void
  typealias ProcessKeyBindings = @convention(c) (AnyClass, Selector, NSEvent) -> ObjCBool
  let original = unsafeBitCast(method_getImplementation(method), to: KeyDown.self)
  let process = unsafeBitCast(NSTextInputContext.method(for: processKeyBindings), to: ProcessKeyBindings.self)
  let inputSourceKeys: Set<UInt16> = [UInt16(kVK_JIS_Eisu), UInt16(kVK_JIS_Kana)]
  let block: @convention(block) (NSTextView, NSEvent) -> Void = { view, event in
    if inputSourceKeys.contains(event.keyCode) {
      _ = process(NSTextInputContext.self, processKeyBindings, event)
    } else {
      original(view, keyDown, event)
    }
  }
  let imp = imp_implementationWithBlock(block)
  if !class_addMethod(NSTextView.self, keyDown, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
}()

private func sidewaysWheelOffset(of view: NSScrollView, for event: NSEvent) -> Double? {
  guard view.responds(to: NSSelectorFromString("isScrollEnabled")),
        (view.value(forKey: "scrollEnabled") as? Bool) == true,
        let document = view.documentView else { return nil }
  let insets = view.contentInsets
  let visible = view.contentView.bounds.size
  let content = document.frame.size
  let left = Double(-insets.left)
  let top = Double(-insets.top)
  let horizontal = ScrollRange(lowest: left, highest: max(left, Double(content.width - visible.width + insets.right)))
  let vertical = ScrollRange(lowest: top, highest: max(top, Double(content.height - visible.height + insets.bottom)))
  let tick = WheelTick(
    deltaX: Double(event.scrollingDeltaX),
    deltaY: Double(event.scrollingDeltaY),
    precise: event.hasPreciseScrollingDeltas,
    phased: !event.phase.isEmpty || !event.momentumPhase.isEmpty
  )
  return WheelAxis.sidewaysOffset(for: tick, at: Double(view.documentVisibleRect.origin.x), horizontal: horizontal, vertical: vertical)
}

let installHorizontalWheelScroll: Void = {
  let scrollWheel = #selector(NSResponder.scrollWheel(with:))
  guard let cls = NSClassFromString("RCTCustomScrollView"),
        let method = class_getInstanceMethod(cls, scrollWheel) else { return }
  typealias ScrollWheel = @convention(c) (AnyObject, Selector, NSEvent) -> Void
  let original = unsafeBitCast(method_getImplementation(method), to: ScrollWheel.self)
  let block: @convention(block) (NSScrollView, NSEvent) -> Void = { view, event in
    guard let x = sidewaysWheelOffset(of: view, for: event), let document = view.documentView else {
      original(view, scrollWheel, event)
      return
    }
    document.scroll(NSPoint(x: x, y: view.documentVisibleRect.origin.y))
  }
  let imp = imp_implementationWithBlock(block)
  if !class_addMethod(cls, scrollWheel, imp, method_getTypeEncoding(method)) {
    method_setImplementation(method, imp)
  }
}()

let installScrollViewInsetFix: Void = {
  guard let cls = NSClassFromString("RCTCustomScrollView"),
        let method = class_getInstanceMethod(cls, #selector(NSView.init(frame:))) else { return }
  typealias Init = @convention(c) (AnyObject, Selector, NSRect) -> AnyObject
  let original = unsafeBitCast(method_getImplementation(method), to: Init.self)
  let block: @convention(block) (AnyObject, NSRect) -> AnyObject = { receiver, frame in
    let view = original(receiver, #selector(NSView.init(frame:)), frame)
    (view as? NSScrollView)?.automaticallyAdjustsContentInsets = false
    return view
  }
  let imp = imp_implementationWithBlock(block)
  if !class_addMethod(cls, #selector(NSView.init(frame:)), imp, method_getTypeEncoding(method)) {
    method_setImplementation(method, imp)
  }
}()
