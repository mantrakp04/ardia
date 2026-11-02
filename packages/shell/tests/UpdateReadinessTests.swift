import XCTest
@testable import ArdiaUpdaterCore

final class UpdateReadinessTests: XCTestCase {
  typealias Update = UpdateReadiness.Update
  let stable = Update(build: "245", version: "0.2.45", channel: nil)
  let nightly = Update(build: "246", version: "0.2.46-nightly.1", channel: "nightly")
  let start = Date(timeIntervalSince1970: 1_000)
  let onNightly: Set<String> = ["nightly"]

  func testNothingIsReadyUntilAnUpdateIsStaged() {
    var readiness = UpdateReadiness()
    XCTAssertNil(readiness.ready(allowed: []))
    XCTAssertFalse(readiness.requestInstall(allowed: [], at: start))
    readiness.stage(stable)
    XCTAssertEqual(readiness.ready(allowed: []), stable)
  }

  func testAStagedNightlyIsReadyOnlyOnTheNightlyChannel() {
    var readiness = UpdateReadiness()
    readiness.stage(nightly)
    XCTAssertEqual(readiness.ready(allowed: onNightly), nightly)
    XCTAssertNil(readiness.ready(allowed: []))
    XCTAssertFalse(readiness.requestInstall(allowed: [], at: start))
  }

  func testARequestedInstallGoesAheadForTheStagedBuild() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    XCTAssertTrue(readiness.installRequested(at: start.addingTimeInterval(1)))
    XCTAssertTrue(readiness.installsAtOnce(build: "245", staged: true, at: start.addingTimeInterval(1)))
    XCTAssertFalse(readiness.installRequested(at: start.addingTimeInterval(1)))
  }

  func testARequestIsAnsweredOnce() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    XCTAssertTrue(readiness.installsAtOnce(build: "245", staged: true, at: start))
    XCTAssertFalse(readiness.installsAtOnce(build: "245", staged: true, at: start))
  }

  func testWithoutARequestTheUpdateIsShownAsUsual() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertFalse(readiness.installRequested(at: start))
    XCTAssertFalse(readiness.installsAtOnce(build: "245", staged: true, at: start))
  }

  func testAnUpdateThatIsNotDownloadedYetIsNeverInstalledWithoutAsking() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    XCTAssertFalse(readiness.installsAtOnce(build: "245", staged: false, at: start))
    XCTAssertFalse(readiness.installRequested(at: start))
  }

  func testAnotherBuildFoundInsteadIsShownAndEndsTheRequest() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    XCTAssertFalse(readiness.installsAtOnce(build: "250", staged: true, at: start))
    XCTAssertFalse(readiness.installsAtOnce(build: "245", staged: true, at: start))
  }

  func testAStaleRequestNeverInstallsLater() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    let late = start.addingTimeInterval(UpdateReadiness.installRequestLife)
    XCTAssertFalse(readiness.installRequested(at: late))
    XCTAssertFalse(readiness.installsAtOnce(build: "245", staged: true, at: late))
  }

  func testAnEndedCheckDropsTheRequestButKeepsTheStagedUpdate() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    readiness.checkEnded()
    XCTAssertFalse(readiness.installsAtOnce(build: "245", staged: true, at: start))
    XCTAssertEqual(readiness.ready(allowed: []), stable)
  }

  func testDroppingTheStagedBuildClearsItAndItsRequest() {
    var readiness = UpdateReadiness()
    readiness.stage(nightly)
    XCTAssertTrue(readiness.requestInstall(allowed: onNightly, at: start))
    readiness.drop(build: "246")
    XCTAssertNil(readiness.ready(allowed: onNightly))
    XCTAssertFalse(readiness.installsAtOnce(build: "246", staged: true, at: start))
  }

  func testDroppingAnotherBuildKeepsTheStagedOne() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    readiness.drop(build: "999")
    XCTAssertEqual(readiness.ready(allowed: []), stable)
  }

  func testAFailedRestartDropsTheStagedUpdate() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    readiness.checkFailed(at: start.addingTimeInterval(1))
    XCTAssertNil(readiness.ready(allowed: []))
  }

  func testAFailedCheckNobodyAskedForKeepsTheStagedUpdate() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    readiness.checkFailed(at: start)
    XCTAssertEqual(readiness.ready(allowed: []), stable)
  }

  func testNothingToInstallClearsEverything() {
    var readiness = UpdateReadiness()
    readiness.stage(stable)
    XCTAssertTrue(readiness.requestInstall(allowed: [], at: start))
    readiness.nothingToInstall()
    XCTAssertNil(readiness.ready(allowed: []))
    XCTAssertFalse(readiness.installRequested(at: start))
  }
}
