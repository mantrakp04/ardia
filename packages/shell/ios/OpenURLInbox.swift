import AppKit
import ArdiaCore

public enum OpenURLInbox {
  private struct Batch {
    var urls: [String]
    var pointer: NSPoint
    let source: NSDictionary?
  }

  private static var pending: [Batch] = []
  private(set) static var testDeliveries: [[String: Any]] = []

  public static func receive(_ urls: [URL]) {
    let pointer = NSEvent.mouseLocation
    for batch in batches(urls.map(\.absoluteString), pointer) {
      if deliver(batch) { continue }
      if let last = pending.last, sameSource(last.source, batch.source) {
        pending[pending.count - 1].urls += batch.urls
        pending[pending.count - 1].pointer = pointer
      } else {
        pending.append(batch)
      }
    }
  }

  static func flush() {
    while let first = pending.first, deliver(first) { pending.removeFirst() }
  }

  private static func batches(_ urls: [String], _ pointer: NSPoint) -> [Batch] {
    var result: [Batch] = []
    for url in urls {
      let source = ArdiaHost.senderOfOpenedURL(url).map { $0 as NSDictionary }
      if let last = result.last, sameSource(last.source, source) {
        result[result.count - 1].urls.append(url)
      } else {
        result.append(Batch(urls: [url], pointer: pointer, source: source))
      }
    }
    return result
  }

  private static func sameSource(_ a: NSDictionary?, _ b: NSDictionary?) -> Bool {
    a == nil ? b == nil : b != nil && a!.isEqual(b!)
  }

  private static func deliver(_ batch: Batch) -> Bool {
    var body: [String: Any] = ["urls": batch.urls, "pointer": [batch.pointer.x, batch.pointer.y]]
    if let source = batch.source { body["source"] = source }
    guard ShellEvents.send(.openURLs, body) else { return false }
    if LaunchConfig.shared.isolated { testDeliveries = Array((testDeliveries + [body]).suffix(20)) }
    return true
  }
}
