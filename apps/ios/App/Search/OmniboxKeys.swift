import UIKit

enum OmniboxKey: Sendable, Equatable {
  case up
  case down
  case escape

  static let all: [OmniboxKey] = [.up, .down, .escape]

  var input: String {
    switch self {
    case .up: UIKeyCommand.inputUpArrow
    case .down: UIKeyCommand.inputDownArrow
    case .escape: UIKeyCommand.inputEscape
    }
  }

  init?(input: String?) {
    guard let key = Self.all.first(where: { $0.input == input }) else { return nil }
    self = key
  }
}
