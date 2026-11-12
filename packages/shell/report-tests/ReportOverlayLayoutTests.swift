import CoreGraphics
import XCTest
@testable import ArdiaReportCore

final class ReportOverlayLayoutTests: XCTestCase {
  private let main = CGRect(x: 100, y: 100, width: 1000, height: 700)

  private func window(_ number: Int, _ frame: CGRect, _ kind: ReportOverlayKind, visible: Bool = true, alpha: CGFloat = 1) -> ReportOverlayCandidate {
    ReportOverlayCandidate(number: number, frame: frame, kind: kind, visible: visible, alpha: alpha)
  }

  func testAPictureInPictureOverTheWindowKeepsItsPlace() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180), .pictureInPicture)
    let placed = ReportOverlayLayout.select(frontToBack: [7, 1], main: 1, mainFrame: main, candidates: [pip], excluded: [])
    XCTAssertEqual(placed, [ReportOverlayPlacement(candidate: pip, rect: CGRect(x: 600, y: 50, width: 320, height: 180), pinned: false)])
  }

  func testAPictureInPictureOffTheWindowIsPinnedInsideTheNearestCorner() {
    let pip = window(7, CGRect(x: 1500, y: 20, width: 320, height: 180), .pictureInPicture)
    let placed = ReportOverlayLayout.select(frontToBack: [7, 1], main: 1, mainFrame: main, candidates: [pip], excluded: [])
    XCTAssertEqual(placed.first?.rect, CGRect(x: 1000 - 12 - 320, y: 12, width: 320, height: 180))
    XCTAssertEqual(placed.first?.pinned, true)
  }

  func testAPictureInPictureMostlyOffTheWindowIsPulledIn() {
    let pip = window(7, CGRect(x: 1000, y: 150, width: 320, height: 180), .pictureInPicture)
    let placed = ReportOverlayLayout.select(frontToBack: [7, 1], main: 1, mainFrame: main, candidates: [pip], excluded: [])
    XCTAssertEqual(placed.first?.rect, CGRect(x: 1000 - 12 - 320, y: 50, width: 320, height: 180))
  }

  func testAPictureInPictureLargerThanTheWindowShrinksToFit() {
    let pip = window(7, CGRect(x: 3000, y: 100, width: 2000, height: 1000), .pictureInPicture)
    let rect = ReportOverlayLayout.select(frontToBack: [7, 1], main: 1, mainFrame: main, candidates: [pip], excluded: [])[0].rect
    XCTAssertEqual(rect.width / rect.height, 2, accuracy: 0.001)
    XCTAssertLessThanOrEqual(rect.width, 1000 - 24)
    XCTAssertTrue(CGRect(origin: .zero, size: main.size).contains(rect))
  }

  func testAPictureInPictureBehindTheWindowInTheListStillShows() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180), .pictureInPicture)
    XCTAssertEqual(ReportOverlayLayout.select(frontToBack: [1, 7], main: 1, mainFrame: main, candidates: [pip], excluded: []).count, 1)
  }

  func testOtherWindowsShowOnlyAboveTheWindowAndOverIt() {
    let popover = window(3, CGRect(x: 200, y: 600, width: 300, height: 200), .app)
    let behind = window(4, CGRect(x: 200, y: 200, width: 300, height: 200), .app)
    let elsewhere = window(5, CGRect(x: 2000, y: 200, width: 300, height: 200), .app)
    let bubble = window(6, CGRect(x: 500, y: 500, width: 200, height: 100), .chrome)
    let placed = ReportOverlayLayout.select(frontToBack: [6, 3, 5, 1, 4], main: 1, mainFrame: main, candidates: [popover, behind, elsewhere, bubble], excluded: [])
    XCTAssertEqual(placed.map(\.candidate.number), [3, 6])
    XCTAssertEqual(placed[0].rect, CGRect(x: 100, y: 500, width: 300, height: 200))
    XCTAssertFalse(placed.contains { $0.pinned })
  }

  func testPictureInPictureDrawsOverEverythingElse() {
    let pip = window(7, CGRect(x: 700, y: 150, width: 320, height: 180), .pictureInPicture)
    let peek = window(3, CGRect(x: 300, y: 200, width: 600, height: 400), .app)
    let placed = ReportOverlayLayout.select(frontToBack: [3, 7, 1], main: 1, mainFrame: main, candidates: [pip, peek], excluded: [])
    XCTAssertEqual(placed.map(\.candidate.number), [3, 7])
  }

  func testTheRecordingPillHiddenAndInvisibleWindowsAreLeftOut() {
    let pill = window(2, CGRect(x: 500, y: 700, width: 200, height: 40), .app)
    let hidden = window(3, CGRect(x: 500, y: 500, width: 200, height: 40), .app, visible: false)
    let clear = window(4, CGRect(x: 500, y: 400, width: 200, height: 40), .pictureInPicture, alpha: 0)
    let placed = ReportOverlayLayout.select(frontToBack: [2, 3, 4, 1], main: 1, mainFrame: main, candidates: [pill, hidden, clear], excluded: [2])
    XCTAssertTrue(placed.isEmpty)
  }

  func testOnlyWhatChromeDrawsCountsAsPageContent() {
    XCTAssertTrue(ReportOverlayKind.pictureInPicture.drawnByChrome)
    XCTAssertTrue(ReportOverlayKind.documentPictureInPicture.drawnByChrome)
    XCTAssertTrue(ReportOverlayKind.chrome.drawnByChrome)
    XCTAssertFalse(ReportOverlayKind.app.drawnByChrome)
  }
}
