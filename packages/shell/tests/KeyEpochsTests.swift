import XCTest
@testable import ArdiaUpdaterCore

final class KeyEpochsTests: XCTestCase {
  func testAWindowThatBecomesKeyAgainAfterTheAppWasReactivatedKeepsItsEpoch() {
    var epochs = KeyEpochs()
    epochs.becameKey(7)
    let tagged = epochs.epoch(of: 7)
    epochs.becameKey(7)
    epochs.becameKey(7)
    XCTAssertEqual(epochs.epoch(of: 7), tagged)
  }

  func testAnotherWindowTakingKeyAndGivingItBackMovesTheEpoch() {
    var epochs = KeyEpochs()
    epochs.becameKey(7)
    let tagged = epochs.epoch(of: 7)
    epochs.becameKey(9)
    epochs.becameKey(7)
    XCTAssertNotEqual(epochs.epoch(of: 7), tagged)
  }

  func testEachWindowKeepsItsOwnEpoch() {
    var epochs = KeyEpochs()
    epochs.becameKey(7)
    let seven = epochs.epoch(of: 7)
    epochs.becameKey(9)
    XCTAssertEqual(epochs.epoch(of: 7), seven)
    XCTAssertEqual(epochs.epoch(of: 9), 1)
    XCTAssertEqual(epochs.epoch(of: 4), 0)
  }

  func testEveryHandoverBetweenWindowsMovesTheEpochAgain() {
    var epochs = KeyEpochs()
    epochs.becameKey(7)
    var seen = [epochs.epoch(of: 7)]
    for _ in 0..<3 {
      epochs.becameKey(9)
      epochs.becameKey(7)
      seen.append(epochs.epoch(of: 7))
    }
    XCTAssertEqual(Set(seen).count, seen.count)
  }
}
