import Testing
@testable import ArdiaBrowser

@MainActor
final class PermissionGate {
  private var waiting: CheckedContinuation<DictationAccess, Never>?
  private(set) var asked = 0

  func request() async -> DictationAccess {
    asked += 1
    return await withCheckedContinuation { waiting = $0 }
  }

  func answer(_ access: DictationAccess) {
    waiting?.resume(returning: access)
    waiting = nil
  }

  func waitUntilAsked(_ count: Int = 1) async {
    while asked < count || waiting == nil { await Task.yield() }
  }
}

final class FakeRecorder: DictationRecorder {
  var stopped = false
  func stop() { stopped = true }
}

@MainActor
final class RecorderLog {
  var started: [FakeRecorder] = []
}

@MainActor
@Suite struct DictationSessionTests {
  private func session(gate: PermissionGate, log: RecorderLog) -> DictationSession {
    DictationSession(
      requestAccess: { await gate.request() },
      startRecorder: { _ in
        let recorder = FakeRecorder()
        log.started.append(recorder)
        return recorder
      }
    )
  }

  @Test func dismissedWhileAskingForPermissionNeverStartsTheMicrophone() async {
    let gate = PermissionGate()
    let log = RecorderLog()
    let dictation = session(gate: gate, log: log)
    let starting = Task { await dictation.start() }
    await gate.waitUntilAsked()
    #expect(dictation.state == .requesting)
    dictation.stop()
    gate.answer(.granted)
    await starting.value
    #expect(log.started.isEmpty)
    #expect(dictation.state == .idle)
  }

  @Test func aCancelledStartNeverStartsTheMicrophone() async {
    let gate = PermissionGate()
    let log = RecorderLog()
    let dictation = session(gate: gate, log: log)
    let starting = Task { await dictation.start() }
    await gate.waitUntilAsked()
    starting.cancel()
    gate.answer(.granted)
    await starting.value
    #expect(log.started.isEmpty)
    #expect(dictation.state == .idle)
  }

  @Test func aStaleStartCannotHijackANewerOne() async {
    let gate = PermissionGate()
    let log = RecorderLog()
    let dictation = session(gate: gate, log: log)
    let first = Task { await dictation.start() }
    await gate.waitUntilAsked()
    dictation.stop()
    gate.answer(.granted)
    await first.value
    let second = Task { await dictation.start() }
    await gate.waitUntilAsked(2)
    gate.answer(.granted)
    await second.value
    #expect(log.started.count == 1)
    #expect(dictation.state == .listening)
    dictation.stop()
    #expect(log.started.first?.stopped == true)
  }

  @Test func grantedStartsListeningAndStopReleasesTheRecorder() async {
    let gate = PermissionGate()
    let log = RecorderLog()
    let dictation = session(gate: gate, log: log)
    let starting = Task { await dictation.start() }
    await gate.waitUntilAsked()
    gate.answer(.granted)
    await starting.value
    #expect(dictation.state == .listening)
    #expect(log.started.count == 1)
    dictation.stop()
    #expect(log.started.first?.stopped == true)
    #expect(dictation.state == .unavailable("Ardia couldn’t hear anything. Try again."))
  }

  @Test func deniedNeverStartsTheMicrophone() async {
    let gate = PermissionGate()
    let log = RecorderLog()
    let dictation = session(gate: gate, log: log)
    let starting = Task { await dictation.start() }
    await gate.waitUntilAsked()
    gate.answer(.denied)
    await starting.value
    #expect(dictation.state == .denied)
    #expect(log.started.isEmpty)
  }
}
