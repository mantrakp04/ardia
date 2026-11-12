import CoreGraphics
import XCTest
@testable import ArdiaReportCore

final class ReportOverlayLayoutTests: XCTestCase {
  private let main = CGRect(x: 100, y: 100, width: 1000, height: 700)
  private let screen = CGRect(x: 0, y: 0, width: 1600, height: 1000)

  private func window(_ number: Int, _ frame: CGRect, _ kind: ReportOverlayKind = .pictureInPicture, owned: Bool = true, alpha: CGFloat = 1) -> ReportOverlayCandidate {
    ReportOverlayCandidate(number: number, frame: frame, kind: kind, owned: owned, alpha: alpha)
  }

  private func select(_ candidates: [ReportOverlayCandidate], order: [Int], screens: [CGRect]? = nil, excluded: Set<Int> = []) -> [ReportOverlayPlacement] {
    ReportOverlayLayout.select(frontToBack: order, main: 1, mainFrame: main, screens: screens ?? [screen], candidates: candidates, excluded: excluded)
  }

  func testItsOwnPictureInPictureOverTheWindowKeepsItsPlace() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180))
    XCTAssertEqual(select([pip], order: [7, 1]), [
      ReportOverlayPlacement(candidate: pip, rect: CGRect(x: 600, y: 50, width: 320, height: 180), clip: [CGRect(x: 600, y: 50, width: 320, height: 180)]),
    ])
  }

  func testAWindowItDoesNotOwnIsNeverDrawn() {
    let otherWindowsPiP = window(7, CGRect(x: 700, y: 150, width: 320, height: 180), owned: false)
    let otherBrowserWindow = window(8, CGRect(x: 200, y: 200, width: 800, height: 500), .app, owned: false)
    let otherProfileBubble = window(9, CGRect(x: 300, y: 300, width: 200, height: 100), .chrome, owned: false)
    XCTAssertEqual(select([otherWindowsPiP, otherBrowserWindow, otherProfileBubble], order: [7, 8, 9, 1]), [])
  }

  func testAPictureInPictureOffTheWindowIsNotPinnedIn() {
    let beside = window(7, CGRect(x: 1200, y: 150, width: 320, height: 180))
    XCTAssertEqual(select([beside], order: [7, 1]), [])
  }

  func testAPictureInPictureHalfOverTheEdgeIsClippedWhereItIs() {
    let pip = window(7, CGRect(x: 1000, y: 150, width: 320, height: 180))
    let placed = select([pip], order: [7, 1])
    XCTAssertEqual(placed.first?.rect, CGRect(x: 900, y: 50, width: 320, height: 180))
    XCTAssertEqual(placed.first?.clip, [CGRect(x: 900, y: 50, width: 100, height: 180)])
  }

  func testAStashedPictureInPictureShowsOnlyItsHandleOnScreen() {
    let edgeWindow = CGRect(x: 600, y: 100, width: 1000, height: 700)
    let stashed = window(7, CGRect(x: 1600 - 28, y: 300, width: 320, height: 180))
    let placed = ReportOverlayLayout.select(frontToBack: [7, 1], main: 1, mainFrame: edgeWindow, screens: [screen], candidates: [stashed], excluded: [])
    XCTAssertEqual(placed.first?.clip, [CGRect(x: 1000 - 28, y: 200, width: 28, height: 180)])
  }

  func testAPictureInPictureOnAnotherDisplayOutsideTheWindowIsNotDrawn() {
    let second = CGRect(x: 1600, y: 0, width: 1200, height: 800)
    let there = window(7, CGRect(x: 2000, y: 200, width: 320, height: 180))
    XCTAssertEqual(select([there], order: [7, 1], screens: [screen, second]), [])
  }

  func testNothingIsDrawnWhereNoDisplayShowsIt() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180))
    XCTAssertEqual(select([pip], order: [7, 1], screens: []), [])
  }

  func testAWindowBelowTheRecordedWindowIsNotDrawn() {
    let child = window(7, CGRect(x: 700, y: 150, width: 320, height: 180), .chrome)
    XCTAssertEqual(select([child], order: [1, 7]), [])
  }

  func testAWindowMissingFromTheWindowServersListIsNotDrawn() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180))
    XCTAssertEqual(select([pip], order: [1]), [])
  }

  func testTheRecordedWindowMissingFromTheListDrawsNothing() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180))
    XCTAssertEqual(select([pip], order: [7]), [])
  }

  func testTransparentAndExcludedWindowsAreNotDrawn() {
    let faded = window(7, CGRect(x: 700, y: 150, width: 320, height: 180), alpha: 0)
    let pill = window(8, CGRect(x: 500, y: 700, width: 120, height: 32), .app)
    XCTAssertEqual(select([faded, pill], order: [8, 7, 1], excluded: [8]), [])
  }

  func testOverlaysDrawBackToFrontInTheWindowServersOrder() {
    let bubble = window(8, CGRect(x: 300, y: 300, width: 200, height: 100), .chrome)
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180))
    XCTAssertEqual(select([pip, bubble], order: [8, 7, 1]).map(\.candidate.number), [7, 8])
  }

  func testPagesHiddenDrawsEveryOverlayAsABlackShape() {
    for kind in [ReportOverlayKind.pictureInPicture, .chrome, .app] {
      XCTAssertEqual(ReportOverlayLayout.fill(for: kind, includePages: false, pictureFresh: true), .black)
    }
  }

  func testPagesIncludedDrawsChromePicturesOnlyWhileFresh() {
    XCTAssertEqual(ReportOverlayLayout.fill(for: .pictureInPicture, includePages: true, pictureFresh: true), .picture)
    XCTAssertEqual(ReportOverlayLayout.fill(for: .pictureInPicture, includePages: true, pictureFresh: false), .black)
    XCTAssertEqual(ReportOverlayLayout.fill(for: .chrome, includePages: true, pictureFresh: false), .black)
    XCTAssertEqual(ReportOverlayLayout.fill(for: .app, includePages: true, pictureFresh: false), .layers)
  }

  func testOnlyPictureInPictureDrawsArdiasControls() {
    XCTAssertTrue(ReportOverlayLayout.drawsControls(.pictureInPicture))
    XCTAssertFalse(ReportOverlayLayout.drawsControls(.chrome))
    XCTAssertFalse(ReportOverlayLayout.drawsControls(.app))
  }
}

final class ReportPageMaskTests: XCTestCase {
  private func traits(engine: Bool = false, picture: Bool = false, _ origin: ReportViewOrigin, container: Bool = false) -> ReportViewTraits {
    ReportViewTraits(pageEngine: engine, pagePicture: picture, origin: origin, chromiumContainer: container)
  }

  func testPageEnginesAndPagePicturesAreMasked() {
    XCTAssertEqual(ReportPageMask.verdict(traits(engine: true, .app)), .page)
    XCTAssertEqual(ReportPageMask.verdict(traits(engine: true, .chromium, container: true)), .page)
    XCTAssertEqual(ReportPageMask.verdict(traits(picture: true, .app)), .page)
  }

  func testUnknownChromiumViewsAreMaskedAndItsContainersAreNot() {
    XCTAssertEqual(ReportPageMask.verdict(traits(.chromium)), .page)
    XCTAssertEqual(ReportPageMask.verdict(traits(.chromium, container: true)), .chrome)
  }

  func testViewsFromAnUnknownBundleAreMasked() {
    XCTAssertEqual(ReportPageMask.verdict(traits(.other)), .page)
  }

  func testArdiasAndTheSystemsViewsAreChrome() {
    XCTAssertEqual(ReportPageMask.verdict(traits(.app)), .chrome)
    XCTAssertEqual(ReportPageMask.verdict(traits(.system)), .chrome)
  }
}

final class ReportPictureClockTests: XCTestCase {
  func testAPictureIsFreshOnlyUntilItExpires() {
    var clock = ReportPictureClock(deadline: 1, expiry: 0.5)
    XCTAssertFalse(clock.fresh(now: 0))
    let asked = clock.request(now: 0)!
    XCTAssertTrue(clock.receive(asked, ok: true, now: 0.1))
    XCTAssertTrue(clock.fresh(now: 0.5))
    XCTAssertFalse(clock.fresh(now: 0.7))
  }

  func testAPictureAgesFromWhenItWasAskedFor() {
    var clock = ReportPictureClock(deadline: 1, expiry: 0.5)
    let asked = clock.request(now: 0)!
    XCTAssertTrue(clock.receive(asked, ok: true, now: 0.4))
    XCTAssertTrue(clock.fresh(now: 0.45))
    XCTAssertFalse(clock.fresh(now: 0.6))
  }

  func testAnAnswerPastItsDeadlineIsRefusedEvenWithNoRequestSince() {
    var clock = ReportPictureClock(deadline: 1, expiry: 0.5)
    let asked = clock.request(now: 0)!
    XCTAssertFalse(clock.receive(asked, ok: true, now: 2))
    XCTAssertFalse(clock.fresh(now: 2))
    XCTAssertEqual(clock.misses, 1)
  }

  func testAFailedCopyDropsThePictureBeforeIt() {
    var clock = ReportPictureClock(deadline: 1, expiry: 0.5)
    let first = clock.request(now: 0)!
    XCTAssertTrue(clock.receive(first, ok: true, now: 0.05))
    XCTAssertTrue(clock.fresh(now: 0.1))
    let second = clock.request(now: 0.1)!
    XCTAssertFalse(clock.receive(second, ok: false, now: 0.2))
    XCTAssertFalse(clock.fresh(now: 0.2))
  }

  func testAnUnansweredRequestIsAbandonedAtItsDeadline() {
    var clock = ReportPictureClock(deadline: 1, expiry: 0.5)
    let first = clock.request(now: 0)!
    XCTAssertNil(clock.request(now: 0.5))
    let second = clock.request(now: 1.2)!
    XCTAssertNotEqual(first, second)
    XCTAssertEqual(clock.misses, 1)
    XCTAssertFalse(clock.receive(first, ok: true, now: 1.3))
    XCTAssertFalse(clock.fresh(now: 1.3))
    XCTAssertTrue(clock.receive(second, ok: true, now: 1.4))
    XCTAssertTrue(clock.fresh(now: 1.4))
  }

  func testAFailedCopyLeavesNothingFresh() {
    var clock = ReportPictureClock(deadline: 1, expiry: 0.5)
    let asked = clock.request(now: 0)!
    XCTAssertFalse(clock.receive(asked, ok: false, now: 0.1))
    XCTAssertFalse(clock.fresh(now: 0.1))
    XCTAssertEqual(clock.misses, 1)
    XCTAssertNotNil(clock.request(now: 0.2))
  }
}
