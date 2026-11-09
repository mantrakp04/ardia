import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

#if DEBUG
final class DevDraggingInfo: NSObject, NSDraggingInfo {
  let draggingDestinationWindow: NSWindow?
  let draggingLocation: NSPoint
  let draggingPasteboard: NSPasteboard
  let draggingSequenceNumber: Int
  let draggingSourceOperationMask: NSDragOperation = [.copy, .link, .generic, .move]
  var draggedImageLocation: NSPoint { draggingLocation }
  var draggedImage: NSImage? { nil }
  var draggingSource: Any? { nil }
  var draggingFormation: NSDraggingFormation = .default
  var animatesToDestination = false
  var numberOfValidItemsForDrop = 0
  var springLoadingHighlight: NSSpringLoadingHighlight { .none }

  init(window: NSWindow, location: NSPoint, pasteboard: NSPasteboard, sequence: Int) {
    draggingDestinationWindow = window
    draggingLocation = location
    draggingPasteboard = pasteboard
    draggingSequenceNumber = sequence
  }

  func slideDraggedImage(to screenPoint: NSPoint) {}
  func enumerateDraggingItems(options enumOpts: NSDraggingItemEnumerationOptions = [], for view: NSView?, classes classArray: [AnyClass],
                              searchOptions: [NSPasteboard.ReadingOptionKey: Any] = [:],
                              using block: (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void) {}
  func resetSpringLoading() {}
}

enum DevDragSession {
  private static var pasteboard: NSPasteboard?
  private static weak var target: NSView?
  private static var sequence = 0
  private static let appKitDragHitTest = NSSelectorFromString("_hitTest:dragTypes:")

  private static func dragDestination(in frameView: NSView, at location: NSPoint, types: Set<NSPasteboard.PasteboardType>) -> NSView? {
    if frameView.responds(to: appKitDragHitTest), let method = class_getMethodImplementation(type(of: frameView), appKitDragHitTest) {
      typealias DragHitTest = @convention(c) (NSView, Selector, UnsafePointer<NSPoint>, NSSet) -> Unmanaged<NSView>?
      let hit = unsafeBitCast(method, to: DragHitTest.self)
      var point = location
      return hit(frameView, appKitDragHitTest, &point, NSSet(array: types.map(\.rawValue)))?.takeUnretainedValue()
    }
    var under = frameView.hitTest(location)
    while let view = under, Set(view.registeredDraggedTypes).isDisjoint(with: types) { under = view.superview }
    return under
  }

  static func act(windowId: String, action: String, x: Double, y: Double, payload: [String: Any]) -> String {
    guard let window = WindowManager.shared.window(windowId), let content = window.contentView, let frameView = content.superview else { return "no window" }
    if pasteboard == nil || !payload.isEmpty {
      let board = NSPasteboard.withUniqueName()
      board.clearContents()
      var writers: [NSPasteboardWriting] = []
      if payload["fileDrag"] as? Bool == true { writers += FileDropView.lastFileDrag.map { $0 as NSURL } }
      writers += (payload["files"] as? [String] ?? []).map { URL(fileURLWithPath: $0) as NSURL }
      writers += (payload["urls"] as? [String] ?? []).compactMap { NSURL(string: $0) }
      if let text = payload["text"] as? String { writers.append(text as NSString) }
      for raw in payload["publicURLs"] as? [String] ?? [] {
        let item = NSPasteboardItem()
        item.setString(raw, forType: .URL)
        writers.append(item)
      }
      guard !writers.isEmpty else { return "nothing to drag" }
      board.writeObjects(writers)
      pasteboard = board
      sequence += 1
    }
    guard let board = pasteboard else { return "no drag" }
    let local = SyntheticInput.contentPoint(x: x, top: y, in: content)
    let location = content.convert(local, to: nil)
    let info = DevDraggingInfo(window: window, location: location, pasteboard: board, sequence: sequence)
    let types = Set(board.types ?? [])
    let under = dragDestination(in: frameView, at: location, types: types)
    let name = { (view: NSView?) in view.map { NSStringFromClass(type(of: $0)) } ?? "none" }
    func finish() {
      pasteboard = nil
      target = nil
    }
    let current = target as NSDraggingDestination?
    if action == "cancel" || action == "end" {
      if action == "cancel" { current?.draggingExited?(info) }
      current?.draggingEnded?(info)
      finish()
      return action == "cancel" ? "cancelled" : "ended"
    }
    var operation: NSDragOperation = []
    let destination = under as NSDraggingDestination?
    if under !== target {
      current?.draggingExited?(info)
      target = under
      operation = destination?.draggingEntered?(info) ?? []
    } else {
      operation = destination?.draggingUpdated?(info) ?? []
    }
    guard action == "drop" else { return "\(name(under)) \(operation.rawValue)" }
    defer { finish() }
    guard let view = under, let destination, !operation.isEmpty else {
      destination?.draggingExited?(info)
      destination?.draggingEnded?(info)
      return "\(name(under)) refused"
    }
    guard destination.prepareForDragOperation?(info) ?? true else { return "\(name(view)) refused prepare" }
    let performed = destination.performDragOperation?(info) ?? false
    destination.concludeDragOperation?(info)
    destination.draggingEnded?(info)
    return "\(name(view)) \(performed ? "performed" : "declined")"
  }
}
#endif
