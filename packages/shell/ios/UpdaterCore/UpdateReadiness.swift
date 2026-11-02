import Foundation

public struct UpdateReadiness {
  public struct Update: Equatable {
    public let build: String
    public let version: String
    public let channel: String?

    public init(build: String, version: String, channel: String?) {
      self.build = build
      self.version = version
      self.channel = channel
    }
  }

  private struct InstallRequest {
    let build: String
    let until: Date
  }

  public static let installRequestLife: TimeInterval = 20

  public private(set) var staged: Update?
  private var request: InstallRequest?
  private var restarting: String?

  public init() {}

  public func ready(allowed channels: Set<String>) -> Update? {
    guard let staged, staged.channel.map(channels.contains) ?? true else { return nil }
    return staged
  }

  public mutating func stage(_ update: Update) {
    staged = update
  }

  public mutating func drop(build: String) {
    if staged?.build == build { staged = nil }
    if request?.build == build { request = nil }
    if restarting == build { restarting = nil }
  }

  public mutating func nothingToInstall() {
    staged = nil
    request = nil
    restarting = nil
  }

  public mutating func requestInstall(allowed channels: Set<String>, at now: Date) -> Bool {
    guard let ready = ready(allowed: channels) else { return false }
    request = InstallRequest(build: ready.build, until: now.addingTimeInterval(Self.installRequestLife))
    restarting = ready.build
    return true
  }

  public func installRequested(at now: Date) -> Bool {
    guard let request else { return false }
    return now < request.until
  }

  public mutating func installsAtOnce(build: String, staged isStaged: Bool, at now: Date) -> Bool {
    guard let asked = request else { return false }
    request = nil
    let goesAhead = isStaged && asked.build == build && now < asked.until
    if !goesAhead { restarting = nil }
    return goesAhead
  }

  public mutating func cancelRequest() {
    guard request != nil else { return }
    request = nil
    restarting = nil
  }

  public mutating func checkEnded() {
    request = nil
    restarting = nil
  }

  public mutating func checkFailed() {
    if let restarting, staged?.build == restarting { staged = nil }
    request = nil
    restarting = nil
  }
}
