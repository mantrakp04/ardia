import Foundation

public struct CompletionOffer: Equatable, Sendable {
  public var query: String
  public var completion: String?

  public init(query: String, completion: String?) {
    self.query = query
    self.completion = completion
  }
}

public struct InlineCompletionEditor: Equatable, Sendable {
  public enum Edit: Equatable, Sendable {
    case consumed
    case insertTyped
  }

  public private(set) var typed: String
  public private(set) var suffix = ""
  public private(set) var isSuppressed = false

  public init(typed: String = "") {
    self.typed = typed
  }

  public var display: String { typed + suffix }
  public var hasSuffix: Bool { !suffix.isEmpty }

  @discardableResult
  public mutating func receive(_ offer: CompletionOffer?) -> Bool {
    guard let offer else { return false }
    let before = suffix
    if isSuppressed || typed.isEmpty {
      suffix = ""
    } else if let completion = offer.completion,
              typed.range(of: offer.query, options: [.caseInsensitive, .anchored]) != nil,
              let match = completion.range(of: typed, options: [.caseInsensitive, .anchored]) {
      suffix = String(completion[match.upperBound...])
    } else if offer.query == typed {
      suffix = ""
    }
    return before != suffix
  }

  public mutating func insert(_ string: String) -> Edit {
    isSuppressed = false
    guard hasSuffix, !string.isEmpty else { return .insertTyped }
    if let match = suffix.range(of: string, options: [.caseInsensitive, .anchored]) {
      typed += string
      suffix = String(suffix[match.upperBound...])
      return .consumed
    }
    suffix = ""
    return .insertTyped
  }

  public mutating func deleteBackward() -> Edit {
    isSuppressed = true
    guard hasSuffix else { return .insertTyped }
    suffix = ""
    return .consumed
  }

  public mutating func accept() {
    typed += suffix
    suffix = ""
  }

  public mutating func dropSuffix() {
    suffix = ""
  }

  public mutating func reset(to text: String) {
    typed = text
    suffix = ""
    isSuppressed = false
  }

  public mutating func syncTyped(_ text: String) {
    guard text != typed else { return }
    typed = text
    suffix = ""
  }
}

public struct BindingEchoFilter: Equatable, Sendable {
  private var pending: [String] = []
  private static let limit = 64

  public init() {}

  public mutating func pushed(_ value: String) {
    if pending.last != value { pending.append(value) }
    if pending.count > Self.limit { pending.removeFirst(pending.count - Self.limit) }
  }

  public mutating func isExternal(_ incoming: String, current: String) -> Bool {
    if incoming == current {
      pending.removeAll()
      return false
    }
    if pending.contains(incoming) { return false }
    pending.removeAll()
    return true
  }
}
