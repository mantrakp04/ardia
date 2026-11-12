import XCTest
@testable import ArdiaUpdaterCore

final class SwitchCheckTests: XCTestCase {
  func run(_ events: [SwitchCheck.Event]) -> SwitchCheck {
    var check = SwitchCheck()
    for event in events { check.handle(event) }
    return check
  }

  func testASwitchWaitsThenChecksThenOffersTheUpdate() {
    var check = SwitchCheck()
    check.handle(.switched(channel: "nightly"))
    XCTAssertEqual(check.report, ["phase": "waiting", "channel": "nightly"])
    check.handle(.started)
    XCTAssertEqual(check.phase, .checking)
    XCTAssertFalse(check.settled)
    check.handle(.found(version: "0.2.47 Nightly 1"))
    check.handle(.finished(failed: false))
    XCTAssertEqual(check.report, ["phase": "found", "channel": "nightly", "version": "0.2.47 Nightly 1"])
    XCTAssertTrue(check.settled)
  }

  func testANightlyNewerThanTheLatestStableSaysSoInsteadOfDowngrading() {
    let check = run([.switched(channel: "stable"), .started, .notFound(newerThanLatest: true), .finished(failed: false)])
    XCTAssertEqual(check.phase, .newerThanLatest)
  }

  func testNothingNewerIsUpToDate() {
    XCTAssertEqual(run([.switched(channel: "stable"), .started, .notFound(newerThanLatest: false), .finished(failed: false)]).phase, .upToDate)
  }

  func testAFeedErrorFails() {
    XCTAssertEqual(run([.switched(channel: "nightly"), .started, .finished(failed: true)]).phase, .failed)
  }

  func testResultsBeforeTheSwitchCheckStartsAreIgnored() {
    let check = run([.switched(channel: "stable"), .found(version: "0.2.47 Nightly 1"), .notFound(newerThanLatest: false), .finished(failed: true)])
    XCTAssertEqual(check.phase, .waiting)
  }

  func testAStartWithoutASwitchIsIgnored() {
    XCTAssertNil(run([.started, .found(version: "1")]).report)
  }

  func testAManualCheckClearsTheSwitchResult() {
    XCTAssertNil(run([.switched(channel: "nightly"), .started, .notFound(newerThanLatest: false), .manualCheck]).report)
  }

  func testACheckNowWhileTheSwitchCheckIsPendingKeepsItAndMakesItShow() {
    var check = run([.switched(channel: "nightly")])
    XCTAssertFalse(check.userAsked)
    check.handle(.manualCheck)
    XCTAssertEqual(check.phase, .waiting)
    XCTAssertTrue(check.userAsked)
    check.handle(.started)
    check.handle(.notFound(newerThanLatest: false))
    XCTAssertEqual(check.phase, .upToDate)
    check.handle(.manualCheck)
    XCTAssertNil(check.report)
    XCTAssertFalse(check.userAsked)
  }

  func testSwitchingAgainStartsOver() {
    let check = run([.switched(channel: "nightly"), .started, .found(version: "2"), .switched(channel: "stable")])
    XCTAssertEqual(check.report, ["phase": "waiting", "channel": "stable"])
  }
}
