import Foundation
import XCTest
@testable import ArdiaSyncCore

private final class StuckPresenter: NSObject, NSFilePresenter {
  let presentedItemURL: URL?
  let presentedItemOperationQueue = OperationQueue()
  private(set) var asked = 0

  init(_ url: URL) {
    presentedItemURL = url
  }

  func relinquishPresentedItem(toWriter writer: @escaping ((() -> Void)?) -> Void) {
    asked += 1
  }

  func relinquishPresentedItem(toReader reader: @escaping ((() -> Void)?) -> Void) {
    asked += 1
  }
}

final class SyncCoordinationTests: XCTestCase {
  private var scratch: URL!
  private let fm = FileManager.default

  override func setUpWithError() throws {
    scratch = fm.temporaryDirectory.appendingPathComponent("sync-coordination-tests-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? fm.removeItem(at: scratch)
  }

  func testWorkThatHadStartedWhenTheTimeoutCameIsNotReportedAsTimedOut() throws {
    let file = scratch.appendingPathComponent("slow.nns")
    try Data("whole".utf8).write(to: file)
    let coordination = SyncCoordination(timeout: 0.05)
    let read = try coordination.read(file) { url -> Data in
      Thread.sleep(forTimeInterval: 0.4)
      return try Data(contentsOf: url)
    }
    XCTAssertEqual(read, Data("whole".utf8))
  }

  private func webloc(_ url: String) -> String {
    "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>URL</key><string>\(url)</string></dict></plist>"
  }

  func testASharedFolderThatNeverAnswersTimesOutAndTheNextChangeStillGoesThrough() throws {
    let root = scratch.appendingPathComponent("Shared", isDirectory: true)
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    let stuck = root.appendingPathComponent("Stuck.webloc")
    try webloc("https://stuck.example/").write(to: stuck, atomically: true, encoding: .utf8)
    let presenter = StuckPresenter(stuck)
    NSFileCoordinator.addFilePresenter(presenter)
    defer { NSFileCoordinator.removeFilePresenter(presenter) }
    let directory = SharedFolderDirectory(root: root, coordination: SyncCoordination(timeout: 0.5))
    let change = { (path: String, url: String) in
      String(data: try JSONSerialization.data(withJSONObject: [["op": "write", "path": path, "text": self.webloc(url), "create": false, "expect": NSNull()]]), encoding: .utf8)!
    }

    let started = Date()
    XCTAssertThrowsError(try directory.apply(json: try change("Stuck.webloc", "https://changed.example/"))) { error in
      XCTAssertTrue((error as NSError).localizedDescription.contains("didn’t answer in time"), "\(error)")
    }
    XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    XCTAssertGreaterThan(presenter.asked, 0)

    let free = root.appendingPathComponent("Free.webloc")
    try webloc("https://free.example/").write(to: free, atomically: true, encoding: .utf8)
    let next = Date()
    XCTAssertEqual(try directory.apply(json: try change("Free.webloc", "https://next.example/"))["conflicts"] as? [String], [])
    XCTAssertLessThan(Date().timeIntervalSince(next), 2)
    XCTAssertTrue(try String(contentsOf: free, encoding: .utf8).contains("next.example"))
    XCTAssertTrue(try String(contentsOf: stuck, encoding: .utf8).contains("stuck.example"))
  }
}
