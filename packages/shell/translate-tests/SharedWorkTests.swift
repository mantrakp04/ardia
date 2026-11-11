import XCTest
@testable import ArdiaTranslateCore

@MainActor
final class SharedWorkTests: XCTestCase {
  private final class Gate {
    var continuations: [CheckedContinuation<Void, Never>] = []
    var starts = 0
    func wait() async {
      starts += 1
      await withCheckedContinuation { continuations.append($0) }
    }
    func open() {
      continuations.forEach { $0.resume() }
      continuations = []
    }
  }

  private func settle() async {
    for _ in 0..<5 { await Task.yield() }
  }

  func testWorkSharedWithALiveOwnerKeepsRunningWhenTheOtherCancels() async {
    let work = SharedWork<String, String>()
    let gate = Gate()
    let start: @MainActor () async -> String? = {
      await gate.wait()
      return Task.isCancelled ? nil : "done"
    }
    async let old = work.value(for: "p", owner: "old", start: start)
    async let live = work.value(for: "p", owner: "live", start: start)
    await settle()
    work.cancel(owner: "old")
    gate.open()
    let (a, b) = await (old, live)
    XCTAssertEqual(a, "done")
    XCTAssertEqual(b, "done")
    XCTAssertEqual(gate.starts, 1)
  }

  func testWorkNoOneWantsIsCancelledAndTheNextCallerStartsAfresh() async {
    let work = SharedWork<String, String>()
    let gate = Gate()
    let start: @MainActor () async -> String? = {
      await gate.wait()
      return Task.isCancelled ? nil : "done"
    }
    async let old = work.value(for: "p", owner: "old", start: start)
    await settle()
    work.cancel(owner: "old")
    XCTAssertEqual(work.count, 0)
    async let fresh = work.value(for: "p", owner: "new", start: start)
    await settle()
    gate.open()
    let (a, b) = await (old, fresh)
    XCTAssertNil(a)
    XCTAssertEqual(b, "done")
    XCTAssertEqual(gate.starts, 2)
    XCTAssertEqual(work.count, 0)
  }

  func testAPassageThatRegistersAfterItsOwnerWasCancelledNeverStartsOrJoinsOtherWork() async {
    let work = SharedWork<String, String>()
    let gate = Gate()
    let start: @MainActor () async -> String? = {
      await gate.wait()
      return Task.isCancelled ? nil : "done"
    }
    async let live = work.value(for: "shared", owner: "live", start: start)
    await settle()
    work.cancel(owner: "dead")
    let late = await work.value(for: "own", owner: "dead", start: start)
    let joined = await work.value(for: "shared", owner: "dead", start: start)
    XCTAssertNil(late)
    XCTAssertNil(joined)
    XCTAssertEqual(gate.starts, 1)
    work.cancel(owner: "dead")
    gate.open()
    let kept = await live
    XCTAssertEqual(kept, "done")
  }

  func testACancelledDispatchStopsSendingRuns() async {
    var sent = 0
    let long = String(repeating: "A full sentence sits here. ", count: 200)
    let task = Task { @MainActor () -> [String]? in
      await PassageDispatch.translate([long], plain: { text in
        sent += 1
        if sent == 2 { withUnsafeCurrentTask { $0?.cancel() } }
        return text
      }, linked: { $0 })
    }
    let parts = await task.value
    XCTAssertNil(parts)
    XCTAssertEqual(sent, 2)
  }
}
