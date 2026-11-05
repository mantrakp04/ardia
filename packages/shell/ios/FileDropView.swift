import AppKit
import ArdiaCore
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

final class FileDropView: ExpoView {
  static var lastFileDrag: [URL] = []

  let onDropUpdate = EventDispatcher()
  private var count = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    registerForDraggedTypes([.fileURL, .URL, .string])
  }

  private func emit(_ phase: String, _ info: NSDraggingInfo, items: [[String: String]] = []) {
    let p = convert(info.draggingLocation, from: nil)
    onDropUpdate(["phase": phase, "x": p.x, "y": isFlipped ? p.y : bounds.height - p.y, "count": count, "items": items])
  }

  private func operation(_ info: NSDraggingInfo) -> NSDragOperation {
    guard count > 0 else { return [] }
    let mask = info.draggingSourceOperationMask
    if mask.contains(.copy) { return .copy }
    if mask.contains(.generic) { return .generic }
    return mask.contains(.link) ? .link : []
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    count = DroppedLinks.count(sender.draggingPasteboard)
    guard count > 0 else { return [] }
    emit("enter", sender)
    return operation(sender)
  }

  override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
    guard count > 0 else { return [] }
    emit("move", sender)
    return operation(sender)
  }

  override func draggingExited(_ sender: NSDraggingInfo?) {
    guard count > 0 else { return }
    if let sender { emit("exit", sender) } else { onDropUpdate(["phase": "exit", "x": 0, "y": 0, "count": count, "items": []]) }
    count = 0
  }

  override func draggingEnded(_ sender: NSDraggingInfo) {
    guard count > 0 else { return }
    emit("exit", sender)
    count = 0
  }

  override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
    count > 0
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    guard count > 0 else { return false }
    let items = DroppedLinks.items(sender.draggingPasteboard)
    emit("drop", sender, items: items)
    count = 0
    return !items.isEmpty
  }

}
