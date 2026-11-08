import XCTest
@testable import ArdiaUpdaterCore

final class WindowDragPacingTests: XCTestCase {
  let frame = 1.0 / 60

  func testAnEventBetweenFramesWaitsForTheNextFrame() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertNil(pacing.frame(now: frame))
    XCTAssertNil(pacing.moved(to: CGPoint(x: 10, y: 0), now: frame * 1.3))
    XCTAssertEqual(pacing.frame(now: frame * 2), CGPoint(x: 10, y: 0))
  }

  func testSeveralEventsInAFramePlaceOnlyTheNewest() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertNil(pacing.moved(to: CGPoint(x: 4, y: 1), now: 0.002))
    XCTAssertNil(pacing.moved(to: CGPoint(x: 8, y: 2), now: 0.005))
    XCTAssertNil(pacing.moved(to: CGPoint(x: 12, y: 3), now: 0.009))
    XCTAssertEqual(pacing.frame(now: frame), CGPoint(x: 12, y: 3))
    XCTAssertNil(pacing.frame(now: frame * 2))
  }

  func testAFrameWithNoNewPointerPlacesNothing() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertNil(pacing.frame(now: frame))
    XCTAssertNil(pacing.moved(to: CGPoint(x: 3, y: 0), now: frame + 0.004))
    XCTAssertEqual(pacing.frame(now: frame * 2), CGPoint(x: 3, y: 0))
    XCTAssertNil(pacing.frame(now: frame * 3))
  }

  func testAnEventPlacesAtOnceWhenNoFrameHasComeForTooLong() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertNil(pacing.moved(to: CGPoint(x: 1, y: 0), now: WindowDragPacing.linkStall - 0.001))
    XCTAssertEqual(pacing.moved(to: CGPoint(x: 2, y: 0), now: WindowDragPacing.linkStall + 0.001), CGPoint(x: 2, y: 0))
    XCTAssertEqual(pacing.moved(to: CGPoint(x: 3, y: 0), now: WindowDragPacing.linkStall + 0.009), CGPoint(x: 3, y: 0))
    XCTAssertNil(pacing.frame(now: WindowDragPacing.linkStall + 0.01))
  }

  func testAFrameEndsAStall() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertEqual(pacing.moved(to: CGPoint(x: 5, y: 0), now: 0.2), CGPoint(x: 5, y: 0))
    XCTAssertNil(pacing.frame(now: 0.21))
    XCTAssertNil(pacing.moved(to: CGPoint(x: 6, y: 0), now: 0.22))
    XCTAssertEqual(pacing.frame(now: 0.2267), CGPoint(x: 6, y: 0))
  }

  func testFinishingPlacesTheReleasePointerAndClearsWhatWasWaiting() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertNil(pacing.moved(to: CGPoint(x: 7, y: 0), now: 0.004))
    XCTAssertEqual(pacing.finish(at: CGPoint(x: 9, y: 1)), CGPoint(x: 9, y: 1))
    XCTAssertNil(pacing.finish(at: nil))
    XCTAssertNil(pacing.frame(now: frame))
  }

  func testFinishingWithoutAPointerPlacesTheWaitingOne() {
    var pacing = WindowDragPacing(now: 0)
    XCTAssertNil(pacing.moved(to: CGPoint(x: 7, y: 2), now: 0.004))
    XCTAssertEqual(pacing.finish(at: nil), CGPoint(x: 7, y: 2))
    XCTAssertNil(pacing.finish(at: nil))
  }
}
