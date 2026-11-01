import XCTest
@testable import ArdiaUpdaterCore

final class FolderWatchTests: XCTestCase {
  var scratch: URL!
  let queue = DispatchQueue(label: "folder-watch-tests")

  override func setUpWithError() throws {
    scratch = FileManager.default.temporaryDirectory.appendingPathComponent("folder-watch-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    chmod(scratch.path, 0o755)
    try? FileManager.default.removeItem(at: scratch)
  }

  func folder(_ name: String = "Installation") throws -> URL {
    let url = scratch.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  final class Counter {
    private let lock = NSLock()
    private var count = 0
    private var waiters: [(Int, XCTestExpectation)] = []
    func bump() {
      lock.lock()
      count += 1
      let ready = waiters.filter { $0.0 <= count }
      waiters.removeAll { $0.0 <= count }
      lock.unlock()
      ready.forEach { $0.1.fulfill() }
    }
    func expect(_ test: XCTestCase, atLeast target: Int) -> XCTestExpectation {
      let expectation = test.expectation(description: "\(target) changes")
      lock.lock()
      if count >= target { lock.unlock(); expectation.fulfill(); return expectation }
      waiters.append((target, expectation))
      lock.unlock()
      return expectation
    }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
  }

  func watch(_ url: URL, _ counter: Counter) -> FolderWatch {
    let watch = FolderWatch(path: url.path, queue: queue) { counter.bump() }
    queue.sync { watch.start() }
    return watch
  }

  func binding(_ watch: FolderWatch) -> FolderWatch.Binding { queue.sync { watch.binding } }

  func testRegistrationReportsSoAChangeBeforeItIsntMissed() throws {
    let counter = Counter()
    let watch = watch(try folder(), counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    XCTAssertEqual(binding(watch), .watching)
  }

  func testRemovingAnEntryReports() throws {
    let installation = try folder()
    let copy = installation.appendingPathComponent("copy", isDirectory: true)
    try FileManager.default.createDirectory(at: copy, withIntermediateDirectories: true)
    let counter = Counter()
    let watch = watch(installation, counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    try FileManager.default.removeItem(at: copy)
    wait(for: [counter.expect(self, atLeast: 2)], timeout: 5)
    withExtendedLifetime(watch) {}
  }

  func testADeletedFolderReportsAbsence() throws {
    let installation = try folder()
    let counter = Counter()
    let watch = watch(installation, counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    try FileManager.default.removeItem(at: installation)
    wait(for: [counter.expect(self, atLeast: 2)], timeout: 5)
    queue.sync {}
    XCTAssertEqual(binding(watch), .absent)
  }

  func testAFolderSwappedUnderTheWatchIsRebound() throws {
    let installation = try folder()
    let counter = Counter()
    let watch = watch(installation, counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    let replacement = try folder("Replacement")
    queue.suspend()
    try FileManager.default.removeItem(at: installation)
    try FileManager.default.moveItem(at: replacement, to: installation)
    queue.resume()
    wait(for: [counter.expect(self, atLeast: 2)], timeout: 5)
    XCTAssertEqual(binding(watch), .watching)
    let seen = counter.value
    try FileManager.default.createDirectory(at: installation.appendingPathComponent("next"), withIntermediateDirectories: true)
    wait(for: [counter.expect(self, atLeast: seen + 1)], timeout: 5)
  }

  func swapOnFirstOpen(_ installation: URL, keepingOld: Bool) throws -> (opener: (String) -> Int32, swapped: () -> Bool) {
    let child = installation.appendingPathComponent("copy", isDirectory: true)
    try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
    let replacement = try folder("Replacement")
    let old = scratch.appendingPathComponent("Old")
    var swapped = false
    let opener: (String) -> Int32 = { path in
      let descriptor = open(path, O_EVTONLY)
      guard !swapped else { return descriptor }
      swapped = true
      try? FileManager.default.moveItem(at: child, to: replacement.appendingPathComponent("copy"))
      if keepingOld {
        try? FileManager.default.moveItem(at: installation, to: old)
      } else {
        try? FileManager.default.removeItem(at: installation)
      }
      try? FileManager.default.moveItem(at: replacement, to: installation)
      return descriptor
    }
    return (opener, { swapped })
  }

  func assertWatchesTheNewFolder(_ installation: URL, keepingOld: Bool) throws {
    let swap = try swapOnFirstOpen(installation, keepingOld: keepingOld)
    let counter = Counter()
    let watch = FolderWatch(path: installation.path, queue: queue, open: swap.opener) { counter.bump() }
    queue.sync { watch.start() }
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    queue.sync {}
    XCTAssertTrue(swap.swapped())
    XCTAssertEqual(binding(watch), .watching)
    let seen = counter.value
    try FileManager.default.removeItem(at: installation.appendingPathComponent("copy"))
    wait(for: [counter.expect(self, atLeast: seen + 1)], timeout: 5)
  }

  func testAFolderMovedAwayBetweenOpeningAndRegistrationIsRebound() throws {
    try assertWatchesTheNewFolder(try folder(), keepingOld: true)
  }

  func testAFolderDeletedRightAfterItIsOpenedIsReopened() throws {
    try assertWatchesTheNewFolder(try folder(), keepingOld: false)
  }

  func testAFolderSwappedBeforeItsRegistrationIsWatchedAfterIt() throws {
    let installation = try folder()
    let child = installation.appendingPathComponent("copy", isDirectory: true)
    try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
    let replacement = try folder("Replacement")
    let counter = Counter()
    let watch = FolderWatch(path: installation.path, queue: queue) { counter.bump() }
    try queue.sync {
      watch.start()
      try FileManager.default.moveItem(at: child, to: replacement.appendingPathComponent("copy"))
      try FileManager.default.removeItem(at: installation)
      try FileManager.default.moveItem(at: replacement, to: installation)
    }
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    queue.sync {}
    XCTAssertEqual(binding(watch), .watching)
    let seen = counter.value
    try FileManager.default.removeItem(at: installation.appendingPathComponent("copy"))
    wait(for: [counter.expect(self, atLeast: seen + 1)], timeout: 5)
  }

  func testAFIFOWhereTheFolderShouldBeDoesntBlockTheWatch() throws {
    let installation = scratch.appendingPathComponent("Installation")
    XCTAssertEqual(mkfifo(installation.path, 0o644), 0)
    let counter = Counter()
    let watch = FolderWatch(path: installation.path, queue: queue) { counter.bump() }
    let started = expectation(description: "start returned")
    DispatchQueue.global().async {
      self.queue.sync { watch.start() }
      started.fulfill()
    }
    wait(for: [started, counter.expect(self, atLeast: 1)], timeout: 3)
    XCTAssertNotEqual(binding(watch), .watching)
  }

  func testAMissingFolderReportsAbsent() throws {
    let counter = Counter()
    let watch = watch(scratch.appendingPathComponent("Installation"), counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    XCTAssertEqual(binding(watch), .absent)
  }

  func testAnUnreadableFolderIsAFailureNotAbsence() throws {
    let installation = try folder()
    chmod(scratch.path, 0o000)
    let counter = Counter()
    let watch = watch(installation, counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    XCTAssertEqual(binding(watch), .failed(EACCES))
  }

  func testStoppingClosesTheDescriptor() throws {
    let installation = try folder()
    let before = try openDescriptors()
    let counter = Counter()
    let watch = watch(installation, counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    XCTAssertEqual(try openDescriptors(), before + 1)
    queue.sync { watch.stop() }
    queue.sync {}
    XCTAssertEqual(try openDescriptors(), before)
  }

  func testAnUnmountedVolumeRevokesTheWatch() throws {
    let image = scratch.appendingPathComponent("volume.dmg")
    let mount = try folder("mount")
    guard run("/usr/bin/hdiutil", "create", "-size", "4m", "-fs", "HFS+", "-volname", "FolderWatchTest", image.path),
      run("/usr/bin/hdiutil", "attach", "-nobrowse", "-noautoopen", "-mountpoint", mount.path, image.path)
    else { throw XCTSkip("hdiutil can't make a test volume here") }
    defer { _ = run("/usr/bin/hdiutil", "detach", "-force", mount.path) }
    let installation = mount.appendingPathComponent("Installation", isDirectory: true)
    try FileManager.default.createDirectory(at: installation, withIntermediateDirectories: true)
    let counter = Counter()
    let watch = watch(installation, counter)
    wait(for: [counter.expect(self, atLeast: 1)], timeout: 5)
    guard run("/usr/bin/hdiutil", "detach", "-force", mount.path) else { throw XCTSkip("hdiutil can't detach the test volume here") }
    wait(for: [counter.expect(self, atLeast: 2)], timeout: 10)
    XCTAssertNotEqual(binding(watch), .watching)
  }

  func openDescriptors() throws -> Int {
    try FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count
  }

  func run(_ tool: String, _ arguments: String...) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return false }
    process.waitUntilExit()
    return process.terminationStatus == 0
  }
}
