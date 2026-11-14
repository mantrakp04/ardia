import AppKit
import Sparkle

final class PendingChoice {
  private var reply: ((SPUUserUpdateChoice) -> Void)?
  private var afterAnswer: [() -> Void] = []

  init(_ reply: @escaping (SPUUserUpdateChoice) -> Void) {
    self.reply = reply
  }

  func answer(_ choice: SPUUserUpdateChoice) {
    guard let reply else { return }
    self.reply = nil
    reply(choice)
    let waiting = afterAnswer
    afterAnswer = []
    waiting.forEach { $0() }
  }

  func whenAnswered(_ run: @escaping () -> Void) {
    guard reply != nil else { return run() }
    afterAnswer.append(run)
  }
}
