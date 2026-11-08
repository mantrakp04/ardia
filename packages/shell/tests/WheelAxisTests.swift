import XCTest
@testable import ArdiaUpdaterCore

final class WheelAxisTests: XCTestCase {
  private let strip = ScrollRange(lowest: 0, highest: 600)
  private let flat = ScrollRange(lowest: 0, highest: 0)
  private let list = ScrollRange(lowest: 0, highest: 900)

  private func notch(_ deltaY: Double, deltaX: Double = 0) -> WheelTick {
    WheelTick(deltaX: deltaX, deltaY: deltaY, precise: false, phased: false)
  }

  private func sideways(_ tick: WheelTick, at offset: Double = 200, horizontal: ScrollRange? = nil, vertical: ScrollRange? = nil) -> Double? {
    WheelAxis.sidewaysOffset(for: tick, at: offset, horizontal: horizontal ?? strip, vertical: vertical ?? flat)
  }

  func testAWheelNotchOverTheStripMovesItSidewaysTowardTheEndAndTheStart() {
    XCTAssertEqual(sideways(notch(-1)), 200 + WheelAxis.pointsPerLine)
    XCTAssertEqual(sideways(notch(1)), 200 - WheelAxis.pointsPerLine)
    XCTAssertEqual(sideways(notch(-3)), 200 + 3 * WheelAxis.pointsPerLine)
  }

  func testAPhaselessSmoothWheelMovesByItsOwnPoints() {
    let smooth = WheelTick(deltaX: 0, deltaY: -12.5, precise: true, phased: false)
    XCTAssertEqual(sideways(smooth), 212.5)
  }

  func testTheFirstAndLastTabsCanBeReachedWheelingAlone() {
    var offset = 0.0
    for _ in 0..<100 { offset = sideways(notch(-1), at: offset) ?? offset }
    XCTAssertEqual(offset, strip.highest)
    for _ in 0..<100 { offset = sideways(notch(1), at: offset) ?? offset }
    XCTAssertEqual(offset, strip.lowest)
  }

  func testTheOffsetStopsAtBothEnds() {
    XCTAssertEqual(sideways(notch(1), at: 0), 0)
    XCTAssertEqual(sideways(notch(-1), at: 600), 600)
    XCTAssertEqual(sideways(notch(-1), at: 590), 600)
    XCTAssertEqual(sideways(notch(1), at: 10), 0)
  }

  func testInsetsWidenTheRange() {
    let inset = ScrollRange(lowest: -20, highest: 640)
    XCTAssertEqual(sideways(notch(1), at: 0, horizontal: inset), -20)
    XCTAssertEqual(sideways(notch(-100), at: 0, horizontal: inset), 640)
  }

  func testTrackpadAndMagicMouseGesturesAreLeftToAppKit() {
    XCTAssertNil(sideways(WheelTick(deltaX: 0, deltaY: -8, precise: true, phased: true)))
    XCTAssertNil(sideways(WheelTick(deltaX: 0, deltaY: -1, precise: false, phased: true)))
  }

  func testAnEventThatAlreadyMovesSidewaysIsLeftToAppKit() {
    XCTAssertNil(sideways(notch(-1, deltaX: 2)))
    XCTAssertNil(sideways(notch(0, deltaX: 2)))
    XCTAssertNil(sideways(notch(0)))
  }

  func testAScrollViewThatScrollsUpAndDownIsLeftToAppKit() {
    XCTAssertNil(sideways(notch(-1), horizontal: flat, vertical: list))
    XCTAssertNil(sideways(notch(-1), horizontal: strip, vertical: list))
  }

  func testAStripThatFitsItsViewIsLeftToAppKit() {
    XCTAssertNil(sideways(notch(-1), horizontal: flat))
    XCTAssertNil(sideways(notch(-1), horizontal: ScrollRange(lowest: 0, highest: 0.4)))
  }
}
