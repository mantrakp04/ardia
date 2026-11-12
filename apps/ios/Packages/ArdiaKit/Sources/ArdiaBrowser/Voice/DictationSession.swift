import Foundation
import Observation

public protocol DictationRecorder: AnyObject {
  func stop()
}

public enum DictationAccess: Sendable, Equatable {
  case granted
  case denied
  case unavailable(String)
}

public struct DictationEvents: Sendable {
  public let text: @Sendable (String, Bool) -> Void
  public let level: @Sendable (Double) -> Void
  public let failure: @Sendable () -> Void
}

@MainActor
@Observable
public final class DictationSession {
  public enum State: Equatable {
    case idle
    case requesting
    case listening
    case finished
    case denied
    case unavailable(String)
  }

  public static let silenceTimeout: Duration = .seconds(1.6)
  public static let firstWordsGrace: Duration = .seconds(4)

  public private(set) var state: State = .idle
  public private(set) var transcript = ""
  public private(set) var level: Double = 0

  @ObservationIgnored private let requestAccess: @MainActor () async -> DictationAccess
  @ObservationIgnored private let startRecorder: @MainActor (DictationEvents) throws -> any DictationRecorder
  @ObservationIgnored private var recorder: (any DictationRecorder)?
  @ObservationIgnored private var silenceTask: Task<Void, Never>?
  @ObservationIgnored private var attempt = 0

  public init(
    requestAccess: @escaping @MainActor () async -> DictationAccess,
    startRecorder: @escaping @MainActor (DictationEvents) throws -> any DictationRecorder
  ) {
    self.requestAccess = requestAccess
    self.startRecorder = startRecorder
  }

  public func start() async {
    guard state != .listening, state != .requesting else { return }
    attempt += 1
    let current = attempt
    state = .requesting
    let access = await requestAccess()
    guard current == attempt, state == .requesting else { return }
    guard !Task.isCancelled else {
      state = .idle
      return
    }
    switch access {
    case .denied:
      state = .denied
      return
    case .unavailable(let message):
      state = .unavailable(message)
      return
    case .granted:
      break
    }
    transcript = ""
    let events = DictationEvents(
      text: { [weak self] text, isFinal in Task { @MainActor in self?.received(text, isFinal: isFinal) } },
      level: { [weak self] level in Task { @MainActor in self?.level = level } },
      failure: { [weak self] in Task { @MainActor in self?.failed() } }
    )
    do {
      recorder = try startRecorder(events)
      state = .listening
      scheduleSilence()
    } catch {
      recorder = nil
      state = .unavailable(String(localized: "Speech dictation is unavailable."))
    }
  }

  public func stop() {
    attempt += 1
    silenceTask?.cancel()
    silenceTask = nil
    recorder?.stop()
    recorder = nil
    level = 0
    if state == .listening {
      state = transcript.isEmpty ? .unavailable(String(localized: "Ardia couldn’t hear anything. Try again.")) : .finished
    } else if state == .requesting {
      state = .idle
    }
  }

  private func received(_ text: String, isFinal: Bool) {
    guard state == .listening else { return }
    transcript = text
    if isFinal {
      stop()
    } else {
      scheduleSilence()
    }
  }

  private func failed() {
    guard state == .listening else { return }
    stop()
  }

  private func scheduleSilence() {
    silenceTask?.cancel()
    let wait = Self.silenceTimeout + (transcript.isEmpty ? Self.firstWordsGrace : .zero)
    silenceTask = Task { [weak self] in
      try? await Task.sleep(for: wait)
      guard !Task.isCancelled else { return }
      self?.stop()
    }
  }
}
