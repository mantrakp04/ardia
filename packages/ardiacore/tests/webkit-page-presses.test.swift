import AppKit

final class FlippedView: NSView {
  override var isFlipped: Bool { true }
}

final class PageView: NSView {
  var gated = true
  var presses = WebKitPagePresses()
  var received: [String] = []
  var refused = 0

  private func take(_ name: String, _ event: NSEvent) {
    if gated {
      switch presses.verdict(for: event, on: self) {
      case .pass: break
      case .drop: return
      case .refuse:
        refused += 1
        return
      }
    }
    received.append(name)
  }

  override func mouseDown(with event: NSEvent) { take("down", event) }
  override func mouseDragged(with event: NSEvent) { take("dragged", event) }
  override func mouseUp(with event: NSEvent) { take("up", event) }
  override func rightMouseDown(with event: NSEvent) { take("rightDown", event) }
  override func rightMouseUp(with event: NSEvent) { take("rightUp", event) }
}

struct Scene {
  let window: NSWindow
  let page: PageView
  let overlay: NSView
  let pageChild: NSView

  init() {
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
    let root = FlippedView(frame: NSRect(x: 0, y: 0, width: 400, height: 300))
    window.contentView = root
    page = PageView(frame: root.bounds)
    root.addSubview(page)
    pageChild = NSView(frame: NSRect(x: 300, y: 200, width: 80, height: 80))
    page.addSubview(pageChild)
    overlay = FlippedView(frame: NSRect(x: 0, y: 0, width: 100, height: 300))
    root.addSubview(overlay)
  }

  func event(_ type: NSEvent.EventType, _ at: NSPoint) -> NSEvent {
    NSEvent.mouseEvent(
      with: type, location: at, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
      pressure: [.leftMouseUp, .rightMouseUp].contains(type) ? 0 : 1)!
  }

  func hit(_ at: NSPoint) -> NSView? { window.contentView?.superview?.hitTest(at) }
}

@main
struct WebKitPagePressesTests {
  static var failures = 0

  static func check(_ ok: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
    if ok { return }
    failures += 1
    print("FAIL \(name) \(detail())")
  }

  static func expect(_ actual: [String], _ wanted: [String], _ name: String) {
    check(actual == wanted, name, "got \(actual), wanted \(wanted)")
  }

  static let underOverlay = NSPoint(x: 37, y: 251)
  static let underOverlayHigh = NSPoint(x: 88, y: 12)
  static let onPage = NSPoint(x: 173, y: 64)
  static let onPageChild = NSPoint(x: 342, y: 241)

  static func main() {
    NSApplication.shared.setActivationPolicy(.prohibited)

    var s = Scene()
    check(s.hit(underOverlay) === s.overlay, "the overlay point hits the overlay", "\(String(describing: s.hit(underOverlay)))")
    check(s.hit(onPageChild) === s.pageChild, "the child point hits the page's child view", "\(String(describing: s.hit(onPageChild)))")

    s = Scene()
    s.page.gated = false
    s.overlay.mouseDown(with: s.event(.leftMouseDown, underOverlay))
    s.overlay.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    s.overlay.rightMouseDown(with: s.event(.rightMouseDown, underOverlayHigh))
    s.overlay.rightMouseUp(with: s.event(.rightMouseUp, underOverlayHigh))
    expect(s.page.received, ["down", "up", "rightDown", "rightUp"], "AppKit forwards a click the overlay doesn't take to the page beneath (the old WebKit page took it)")

    s = Scene()
    s.overlay.mouseDown(with: s.event(.leftMouseDown, underOverlay))
    s.overlay.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    expect(s.page.received, [], "a click on the sidebar drawn over the page never reaches the page")
    check(s.page.refused == 1, "the overlay press counts once as refused", "\(s.page.refused)")

    s = Scene()
    s.overlay.mouseDown(with: s.event(.leftMouseDown, underOverlayHigh))
    s.overlay.mouseUp(with: s.event(.leftMouseUp, underOverlayHigh))
    expect(s.page.received, [], "an off-centre click near the overlay's top edge stays off the page")

    s = Scene()
    s.overlay.mouseDown(with: s.event(.leftMouseDown, underOverlay))
    s.page.isHidden = true
    s.overlay.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    s.page.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    s.page.isHidden = false
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    s.page.mouseUp(with: s.event(.leftMouseUp, onPage))
    expect(s.page.received, ["down", "up"], "a sidebar press that hides the page on mouse down: its release is dropped, and the next click on the page goes through")
    check(s.page.refused == 1, "the press that switched tabs counts once as refused", "\(s.page.refused)")

    s = Scene()
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    let root = s.page.superview!
    s.page.removeFromSuperview()
    root.addSubview(s.page, positioned: .below, relativeTo: s.overlay)
    s.overlay.mouseDown(with: s.event(.leftMouseDown, underOverlay))
    s.overlay.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    expect(s.page.received, ["down"], "a page that lost the release of its press while out of the window still refuses the next sidebar click")

    s = Scene()
    s.page.rightMouseDown(with: s.event(.rightMouseDown, onPage))
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    s.page.mouseUp(with: s.event(.leftMouseUp, onPage))
    s.page.rightMouseDown(with: s.event(.rightMouseDown, onPage))
    s.page.rightMouseUp(with: s.event(.rightMouseUp, onPage))
    expect(s.page.received, ["rightDown", "down", "up", "rightDown", "rightUp"], "a page press whose release a menu took doesn't eat the next click on the page")

    s = Scene()
    s.overlay.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    expect(s.page.received, [], "a release from a press that began on an overlay is dropped")

    s = Scene()
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    s.page.mouseUp(with: s.event(.leftMouseUp, onPage))
    expect(s.page.received, ["down", "up"], "a click on the page itself goes through")

    s = Scene()
    s.pageChild.mouseDown(with: s.event(.leftMouseDown, onPageChild))
    s.pageChild.mouseUp(with: s.event(.leftMouseUp, onPageChild))
    expect(s.page.received, ["down", "up"], "a click that hits a view inside the page goes through")

    s = Scene()
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    s.page.mouseDragged(with: s.event(.leftMouseDragged, underOverlay))
    s.page.mouseUp(with: s.event(.leftMouseUp, underOverlay))
    expect(s.page.received, ["down", "dragged", "up"], "a press that began on the page keeps its drag and release over the overlay")

    s = Scene()
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    s.page.isHidden = true
    s.page.mouseUp(with: s.event(.leftMouseUp, onPage))
    s.page.mouseDown(with: s.event(.leftMouseDown, onPage))
    expect(s.page.received, ["down", "up"], "a page hidden mid-press still gets that release, and no new press while hidden")

    s = Scene()
    s.overlay.rightMouseDown(with: s.event(.rightMouseDown, underOverlay))
    s.overlay.rightMouseUp(with: s.event(.rightMouseUp, underOverlay))
    s.page.rightMouseDown(with: s.event(.rightMouseDown, onPage))
    s.page.rightMouseUp(with: s.event(.rightMouseUp, onPage))
    expect(s.page.received, ["rightDown", "rightUp"], "a right click over the overlay is refused, one on the page goes through")

    if failures > 0 { exit(1) }
    print("ok")
  }
}
