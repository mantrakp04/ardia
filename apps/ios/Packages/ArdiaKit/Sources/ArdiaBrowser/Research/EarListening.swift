import Foundation

public enum ListeningOutput: Equatable, Sendable {
  case earpiece
  case speaker
}

public struct EarListening: Equatable, Sendable {
  public enum State: Equatable, Sendable {
    case waiting
    case playing(ListeningOutput)
    case paused(ListeningOutput)
    case finished
  }

  public enum Command: Equatable, Sendable {
    case start(ListeningOutput)
    case resume(ListeningOutput)
    case reroute(ListeningOutput)
    case pause
    case none
  }

  public private(set) var state: State = .waiting
  public private(set) var isReady = false
  public private(set) var isNear = false

  public init() {}

  public var isPlaying: Bool {
    if case .playing = state { return true }
    return false
  }

  public var output: ListeningOutput? {
    switch state {
    case .playing(let output), .paused(let output): output
    case .waiting, .finished: nil
    }
  }

  public mutating func answerReady() -> Command {
    guard !isReady else { return .none }
    isReady = true
    guard isNear else { return .none }
    state = .playing(.earpiece)
    return .start(.earpiece)
  }

  public mutating func proximity(isNear near: Bool) -> Command {
    guard near != isNear else { return .none }
    isNear = near
    guard isReady else { return .none }
    if near {
      switch state {
      case .waiting, .finished:
        state = .playing(.earpiece)
        return .start(.earpiece)
      case .paused:
        state = .playing(.earpiece)
        return .resume(.earpiece)
      case .playing(.speaker):
        state = .playing(.earpiece)
        return .reroute(.earpiece)
      case .playing(.earpiece):
        return .none
      }
    }
    guard state == .playing(.earpiece) else { return .none }
    state = .paused(.earpiece)
    return .pause
  }

  public mutating func toggleSpeaker() -> Command {
    guard isReady else { return .none }
    switch state {
    case .waiting, .finished:
      state = .playing(.speaker)
      return .start(.speaker)
    case .paused:
      state = .playing(.speaker)
      return .resume(.speaker)
    case .playing(.earpiece):
      state = .playing(.speaker)
      return .reroute(.speaker)
    case .playing(.speaker):
      state = .paused(.speaker)
      return .pause
    }
  }

  public mutating func finished() {
    state = .finished
  }

  public mutating func reset() {
    state = .waiting
    isReady = false
  }
}

public struct ProximityScript: Equatable, Sendable {
  public struct Step: Equatable, Sendable {
    public var after: Double
    public var isNear: Bool

    public init(after: Double, isNear: Bool) {
      self.after = after
      self.isNear = isNear
    }
  }

  public var steps: [Step]

  public init?(_ text: String) {
    let steps = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.compactMap(Self.step)
    guard !steps.isEmpty else { return nil }
    self.steps = steps.sorted { $0.after < $1.after }
  }

  static func step(_ text: String) -> Step? {
    let parts = text.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
    guard parts.count == 2, let after = Double(parts[0]), after >= 0 else { return nil }
    switch parts[1] {
    case "near", "ear", "1", "true", "yes": return Step(after: after, isNear: true)
    case "far", "away", "0", "false", "no": return Step(after: after, isNear: false)
    default: return nil
    }
  }
}
