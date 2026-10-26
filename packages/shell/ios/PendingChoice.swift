import AppKit
import Sparkle

final class PendingChoice {
  private var reply: ((SPUUserUpdateChoice) -> Void)?

  init(_ reply: @escaping (SPUUserUpdateChoice) -> Void) {
    self.reply = reply
  }

  func answer(_ choice: SPUUserUpdateChoice) {
    guard let reply else { return }
    self.reply = nil
    reply(choice)
  }
}
