import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class SavedKeyResponders {
  static let shared = SavedKeyResponders()

  private final class Saved {
    weak var window: NSWindow?
    weak var responder: NSView?
    let selection: NSRange?
    init(window: NSWindow, responder: NSView, selection: NSRange?) {
      self.window = window
      self.responder = responder
      self.selection = selection
    }
  }

  private var saved: [Int: Saved] = [:]
  private var next = 0

  func save(_ window: NSWindow?) -> Int {
    saved = saved.filter { $0.value.window != nil && $0.value.responder != nil }
    guard let window, let responder = Self.owner(of: window.firstResponder) else { return 0 }
    let editor = window.firstResponder as? NSTextView
    next += 1
    saved[next] = Saved(window: window, responder: responder, selection: editor?.isFieldEditor == true ? editor?.selectedRange() : nil)
    return next
  }

  func restore(_ token: Int) -> Bool {
    guard let entry = saved.removeValue(forKey: token), let window = entry.window, let view = entry.responder,
      view.window === window, !view.isHiddenOrHasHiddenAncestor, view.acceptsFirstResponder
    else { return false }
    guard window.makeFirstResponder(view) else { return false }
    if let selection = entry.selection, let editor = (view as? NSTextField)?.currentEditor() as? NSTextView,
      NSMaxRange(selection) <= (editor.string as NSString).length
    {
      editor.setSelectedRange(selection)
    }
    return true
  }

  func discard(_ token: Int) {
    saved.removeValue(forKey: token)
  }

  private static func owner(of responder: NSResponder?) -> NSView? {
    if let editor = responder as? NSTextView, editor.isFieldEditor, let field = editor.delegate as? NSView { return field }
    return responder as? NSView
  }
}
