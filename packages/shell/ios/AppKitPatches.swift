import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

let installTextFieldSelectAll: Void = {
  let block: @convention(block) (NSTextField, Any?) -> Void = { field, sender in
    if let editor = field.currentEditor() { editor.selectAll(sender) } else { field.selectText(sender) }
  }
  class_addMethod(NSTextField.self, #selector(NSText.selectAll(_:)), imp_implementationWithBlock(block), "v@:@")
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
