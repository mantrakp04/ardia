@preconcurrency import ArdiaSyncCore
import Foundation

public struct SyncConnectFlow: Equatable, Sendable {
  public struct Attempt: Equatable, Sendable {
    public let phrase: String
    public let folder: URL
  }

  public private(set) var phrase = ""
  public private(set) var folder: URL?
  public private(set) var failure: String?
  public private(set) var isConnecting = false
  private var attempting: Data?

  public init() {}

  public var hasPhrase: Bool { Self.entropy(of: phrase) != nil }

  public mutating func enterPhrase(_ text: String) -> Attempt? {
    let before = Self.entropy(of: phrase)
    phrase = text
    guard Self.entropy(of: text) != before else { return nil }
    failure = nil
    return startIfReady()
  }

  public mutating func chooseFolder(_ url: URL) -> Attempt? {
    folder = url
    failure = nil
    return startIfReady()
  }

  public mutating func finish(_ result: ConnectResult) -> Attempt? {
    let tried = attempting
    isConnecting = false
    attempting = nil
    if result == .connected {
      phrase = ""
      failure = nil
      return nil
    }
    guard tried == Self.entropy(of: phrase) else { return startIfReady() }
    failure = result.message
    return nil
  }

  private mutating func startIfReady() -> Attempt? {
    guard !isConnecting, let folder, let entropy = Self.entropy(of: phrase) else { return nil }
    isConnecting = true
    attempting = entropy
    failure = nil
    return Attempt(phrase: phrase, folder: folder)
  }

  private static func entropy(of phrase: String) -> Data? {
    try? RecoveryPhrase.entropy(from: phrase)
  }
}
