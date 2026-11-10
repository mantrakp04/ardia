import AppKit

enum VaultCopyResult: Sendable, Equatable {
  case copied
  case declined
  case refused(VaultFillError)
  case clipboardFailed

  func jsonObject() -> [String: Any] {
    switch self {
    case .copied: return ["copied": true, "clearsAfter": VaultClipboard.clearDelay]
    case .declined: return ["copied": false, "declined": true, "clearsAfter": 0]
    case .refused(let error): return ["copied": false, "error": error.rawValue, "clearsAfter": 0]
    case .clipboardFailed: return ["copied": false, "error": "clipboard", "clearsAfter": 0]
    }
  }
}

enum VaultClipboard {
  static let clearDelay = 90

  private static let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
  private static let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
  private static let testBoard = NSPasteboard.Name("dev.ardia.vaults.test-clipboard")

  static func copy(_ text: String) async -> Bool {
    await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
      DispatchQueue.main.async { done.resume(returning: Self.place(text)) }
    }
  }

  private static func board() -> NSPasteboard {
    LaunchConfig.shared.background ? NSPasteboard(name: testBoard) : NSPasteboard.general
  }

  private static func place(_ text: String) -> Bool {
    guard !text.isEmpty else { return false }
    let item = NSPasteboardItem()
    guard item.setString(text, forType: .string) else { return false }
    item.setData(Data(), forType: concealed)
    item.setData(Data(), forType: transient)
    let pasteboard = board()
    pasteboard.clearContents()
    guard pasteboard.writeObjects([item]), pasteboard.string(forType: .string) == text else {
      NSLog("[vaults] the clipboard didn't keep the copy (%@)", pasteboard.name.rawValue)
      return false
    }
    let placed = pasteboard.changeCount
    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(clearDelay)) {
      let current = Self.board()
      if current.changeCount == placed { current.clearContents() }
    }
    return true
  }
}
