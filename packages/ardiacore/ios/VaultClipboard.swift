import AppKit

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
    let pasteboard = board()
    pasteboard.clearContents()
    pasteboard.declareTypes([.string, concealed, transient], owner: nil)
    guard pasteboard.setString(text, forType: .string) else { return false }
    pasteboard.setString("", forType: concealed)
    pasteboard.setString("", forType: transient)
    let placed = pasteboard.changeCount
    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(clearDelay)) {
      let current = Self.board()
      if current.changeCount == placed { current.clearContents() }
    }
    return true
  }
}
