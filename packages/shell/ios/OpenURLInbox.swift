import AppKit

public enum OpenURLInbox {
  private static var pending: [String] = []
  private static var pendingPointer = NSPoint.zero

  public static func receive(_ urls: [URL]) {
    let pointer = NSEvent.mouseLocation
    let strings = urls.map(\.absoluteString)
    if deliver(strings, pointer) { return }
    pending += strings
    pendingPointer = pointer
  }

  static func flush() {
    guard !pending.isEmpty, deliver(pending, pendingPointer) else { return }
    pending = []
  }

  static func open(_ url: URL, profileId: String?, littleArdia: Bool?) {
    var body: [String: Any] = ["urls": [url.absoluteString], "pointer": [NSEvent.mouseLocation.x, NSEvent.mouseLocation.y]]
    body["profileId"] = profileId
    body["littleArdia"] = littleArdia
    ShellEvents.send(.openURLs, body)
  }

  private static func deliver(_ urls: [String], _ pointer: NSPoint) -> Bool {
    ShellEvents.send(.openURLs, ["urls": urls, "pointer": [pointer.x, pointer.y]])
  }
}
