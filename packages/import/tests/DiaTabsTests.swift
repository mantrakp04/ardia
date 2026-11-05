import Foundation
import XCTest
@testable import ArdiaImportCore

final class FakeDiaApp: DiaApp {
  var isRunning: Bool
  var status: DiaAutomation.Status = .granted
  var launchError: ImportError?
  var launches = 0
  var quits = 0

  init(running: Bool) { isRunning = running }

  func launchHidden() throws {
    launches += 1
    if let launchError { throw launchError }
    isRunning = true
  }

  func consent() -> DiaAutomation.Status { isRunning ? status : .notRunning }

  func quitIfInBackground() {
    quits += 1
    isRunning = false
  }
}

struct FailingWindows: DiaScriptingSource {
  func windows() throws -> [DiaScript.Window] { throw ImportError.unreadable("Dia didn't answer within 10 seconds") }
}

final class DiaTabsTests: XCTestCase {
  let fixture = DiaFixtureWindows(url: Fixtures.url("dia/applescript-windows.json"))

  func testClosedDiaIsOpenedInTheBackgroundReadAndQuit() throws {
    let app = FakeDiaApp(running: false)
    let result = try DiaTabsFetch.read(app: app, source: fixture, launchGrace: 1, poll: 0.01)
    XCTAssertEqual(result.profiles.map(\.name), ["Personal", "Work"])
    XCTAssertEqual(result.profiles[0].pinned.map(\.url).first, "https://mail.example.com/")
    XCTAssertEqual([app.launches, app.quits], [1, 1])
  }

  func testRunningDiaIsLeftRunning() throws {
    let app = FakeDiaApp(running: true)
    _ = try DiaTabsFetch.read(app: app, source: fixture, launchGrace: 1, poll: 0.01)
    XCTAssertEqual([app.launches, app.quits], [0, 0])
    XCTAssertTrue(app.isRunning)
  }

  func testDiaWeOpenedIsQuitEvenWhenItsTabsCantBeRead() {
    let app = FakeDiaApp(running: false)
    XCTAssertThrowsError(try DiaTabsFetch.read(app: app, source: FailingWindows(), launchGrace: 0.05, poll: 0.01)) {
      XCTAssertEqual(($0 as? ImportError)?.code, "unreadable")
    }
    XCTAssertEqual([app.launches, app.quits], [1, 1])
  }

  func testRefusedAutomationFailsAtOnceAndQuitsDia() {
    let app = FakeDiaApp(running: false)
    app.status = .denied
    let started = Date()
    XCTAssertThrowsError(try DiaTabsFetch.read(app: app, source: fixture, launchGrace: 5, poll: 0.01)) {
      XCTAssertEqual(($0 as? ImportError)?.code, "locked")
    }
    XCTAssertLessThan(Date().timeIntervalSince(started), 1)
    XCTAssertEqual(app.quits, 1)
  }

  func testDiaThatWontOpenIsNeverQuit() {
    let app = FakeDiaApp(running: false)
    app.launchError = .notFound("Dia isn't installed")
    XCTAssertThrowsError(try DiaTabsFetch.read(app: app, source: fixture, launchGrace: 1, poll: 0.01))
    XCTAssertEqual(app.quits, 0)
  }

  func testDiaIsOneSourceThatAsksDiaForItsTabs() throws {
    let list = Fixtures.discovery().list()
    let dia = list.filter { $0.name.hasPrefix("Dia") }
    XCTAssertEqual(dia.map(\.id), ["dia"])
    XCTAssertTrue(dia[0].asksAppForTabs)
    for profile in dia[0].profiles {
      XCTAssertTrue(profile.available.contains(.tabs) && profile.available.contains(.pinnedTabs))
      XCTAssertFalse(profile.tabsNeedKey)
    }
    XCTAssertFalse(try XCTUnwrap(list.first { $0.id == "chrome" }).asksAppForTabs)
  }
}
