import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

final class FileDragView: ExpoView, NSDraggingSource {
  var path: String?
  let onMiddleClick = EventDispatcher()
  private var downAt: NSPoint?

  override func otherMouseUp(with event: NSEvent) {
    guard event.buttonNumber == 2 else { return super.otherMouseUp(with: event) }
    let flags = event.modifierFlags
    onMiddleClick(["shiftKey": flags.contains(.shift), "altKey": flags.contains(.option), "metaKey": flags.contains(.command)])
  }

  override func mouseDown(with event: NSEvent) {
    downAt = event.locationInWindow
    super.mouseDown(with: event)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let start = downAt, let path, FileManager.default.fileExists(atPath: path) else {
      return super.mouseDragged(with: event)
    }
    let p = event.locationInWindow
    guard hypot(p.x - start.x, p.y - start.y) > 4 else { return }
    downAt = nil
    let url = URL(fileURLWithPath: path)
    if FileDropView.background {
      FileDropView.lastFileDrag = [url]
      return
    }
    let item = NSDraggingItem(pasteboardWriter: url as NSURL)
    let icon = NSWorkspace.shared.icon(forFile: path)
    let local = convert(event.locationInWindow, from: nil)
    item.setDraggingFrame(NSRect(x: local.x - 16, y: local.y - 16, width: 32, height: 32), contents: icon)
    beginDraggingSession(with: [item], event: event, source: self)
  }

  override func mouseUp(with event: NSEvent) {
    downAt = nil
    super.mouseUp(with: event)
  }

  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
    [.copy, .generic]
  }
}
