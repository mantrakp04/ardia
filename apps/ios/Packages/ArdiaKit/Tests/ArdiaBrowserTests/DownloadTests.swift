import Foundation
import SwiftData
import Testing
@testable import ArdiaBrowser

@Suite struct DownloadItemTests {
  static let start = Date(timeIntervalSinceReferenceDate: 800_000_000)
  static let source = URL(string: "https://files.example/report.pdf")!

  static func started(isPrivate: Bool = false) -> DownloadItem {
    DownloadItem.started(id: UUID(), source: source, isPrivate: isPrivate, at: start)
  }

  @Test func aDownloadStartsNamedFromItsAddress() {
    let item = Self.started()
    #expect(item.state == .downloading)
    #expect(item.fileName == "report.pdf")
    #expect(item.sourceHost == "files.example")
    #expect(item.fraction == nil)
  }

  @Test func progressFillsAndFinishingRecordsSizeAndTime() {
    let item = Self.started().named("Report 2.pdf").receiving(25, of: 100)
    #expect(item.fileName == "Report 2.pdf")
    #expect(item.fraction == 0.25)
    let done = item.finishing(at: Self.start.addingTimeInterval(9), size: 104)
    #expect(done.state == .finished)
    #expect(done.receivedBytes == 104)
    #expect(done.expectedBytes == 104)
    #expect(done.finishedAt == Self.start.addingTimeInterval(9))
    #expect(done.fraction == 1)
  }

  @Test func unknownLengthHasNoFraction() {
    #expect(Self.started().receiving(500, of: nil).fraction == nil)
    #expect(Self.started().receiving(500, of: -1).fraction == nil)
  }

  @Test func onlyARunningDownloadCanFailOrBeCancelled() {
    let finished = Self.started().finishing(at: Self.start, size: 10)
    #expect(finished.failing(.connection, at: Self.start) == finished)
    #expect(finished.cancelling(at: Self.start) == finished)
    #expect(finished.receiving(1, of: 2) == finished)
    let failed = Self.started().failing(.connection, at: Self.start)
    #expect(failed.state == .failed(.connection))
    #expect(failed.cancelling(at: Self.start) == failed)
    #expect(failed.finishing(at: Self.start, size: 1) == failed)
    #expect(Self.started().cancelling(at: Self.start).state == .cancelled)
  }

  @Test func onlyAPlacedDownloadOwnsAFile() {
    let started = Self.started()
    #expect(!started.ownsFile)
    let placed = started.placed(as: "report 2.pdf")
    #expect(placed.ownsFile)
    #expect(placed.fileName == "report 2.pdf")
    #expect(!started.named("x.pdf").ownsFile)
  }

  @Test func aRelaunchTurnsARunningDownloadIntoAnInterruptedOne() {
    let running = Self.started().receiving(10, of: 100)
    let after = running.relaunched()
    #expect(after.state == .failed(.interrupted))
    #expect(after.receivedBytes == 10)
    let finished = Self.started().finishing(at: Self.start, size: 1)
    #expect(finished.relaunched() == finished)
  }

  @Test func onlyStoppedPublicDownloadsWithAnAddressCanBeTriedAgain() {
    #expect(Self.started().failing(.connection, at: Self.start).canRetry)
    #expect(Self.started().cancelling(at: Self.start).canRetry)
    #expect(!Self.started().canRetry)
    #expect(!Self.started().finishing(at: Self.start, size: 1).canRetry)
    #expect(!Self.started(isPrivate: true).cancelling(at: Self.start).canRetry)
    let unknown = DownloadItem.started(id: UUID(), source: nil, isPrivate: false, at: Self.start)
    #expect(!unknown.cancelling(at: Self.start).canRetry)
  }

  @Test(arguments: [
    (NSURLErrorDomain, NSURLErrorNetworkConnectionLost, DownloadFailure.connection),
    (NSURLErrorDomain, NSURLErrorNotConnectedToInternet, DownloadFailure.connection),
    (NSURLErrorDomain, NSURLErrorTimedOut, DownloadFailure.connection),
    (NSCocoaErrorDomain, NSFileWriteOutOfSpaceError, DownloadFailure.storage),
    (NSPOSIXErrorDomain, Int(ENOSPC), DownloadFailure.storage),
    (NSURLErrorDomain, NSURLErrorBadServerResponse, DownloadFailure.unknown),
  ])
  func failuresReadInPlainWords(domain: String, code: Int, expected: DownloadFailure) {
    #expect(DownloadFailure(NSError(domain: domain, code: code)) == expected)
    #expect(!expected.message.isEmpty)
  }
}

@MainActor
@Suite struct DownloadManagerTests {
  let container: ModelContainer
  let directory: URL
  let source = URL(string: "https://files.example/report.pdf")!

  init() throws {
    container = try BrowserStore.makeContainer(.inMemory)
    directory = URL.temporaryDirectory.appending(path: "ardia-downloads-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  func cleanUp() {
    try? FileManager.default.removeItem(at: directory)
  }

  var privateDirectory: URL { directory.appending(path: "Private", directoryHint: .isDirectory) }

  func manager() -> DownloadManager {
    DownloadManager(directory: directory, privateDirectory: privateDirectory, store: SwiftDataDownloadStore(context: ModelContext(container)), now: { DownloadItemTests.start })
  }

  func writeFile(_ name: String, bytes: Int, in folder: URL? = nil) throws -> URL {
    let folder = folder ?? directory
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: name)
    try Data(repeating: 7, count: bytes).write(to: url)
    return url
  }

  func exists(_ url: URL) -> Bool {
    FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
  }

  @Test func aFinishedDownloadIsListedAndSurvivesARelaunch() throws {
    defer { cleanUp() }
    let downloads = manager()
    var outcomes: [DownloadOutcome] = []
    downloads.onOutcome = { outcomes.append($0) }
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.place(id, as: "report.pdf")
    downloads.progress(id, received: 3, expected: 12)
    #expect(downloads.items.first?.fraction == 0.25)
    let file = try writeFile("report.pdf", bytes: 12)
    downloads.finish(id, file: file)
    #expect(outcomes == [.finished(file)])
    let relaunched = manager()
    let item = try #require(relaunched.items.first)
    #expect(item.state == .finished)
    #expect(item.receivedBytes == 12)
    #expect(relaunched.fileURL(for: item) == file)
  }

  @Test func aDownloadRunningAtQuitReadsAsInterruptedAfterRelaunch() throws {
    defer { cleanUp() }
    let downloads = manager()
    downloads.begin(id: UUID(), source: source, isPrivate: false)
    let relaunched = manager()
    #expect(relaunched.items.map(\.state) == [.failed(.interrupted)])
    #expect(manager().items.map(\.state) == [.failed(.interrupted)])
  }

  @Test func newestDownloadsComeFirst() {
    defer { cleanUp() }
    var clock = DownloadItemTests.start
    let downloads = DownloadManager(directory: directory, privateDirectory: privateDirectory, store: nil, now: { clock })
    let first = UUID()
    let second = UUID()
    downloads.begin(id: first, source: source, isPrivate: false)
    clock = clock.addingTimeInterval(5)
    downloads.begin(id: second, source: source, isPrivate: false)
    #expect(downloads.items.map(\.id) == [second, first])
  }

  @Test func cancellingStopsTheDownloadWithoutAFailureToast() throws {
    defer { cleanUp() }
    let downloads = manager()
    var outcomes: [DownloadOutcome] = []
    downloads.onOutcome = { outcomes.append($0) }
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.cancel(id)
    downloads.fail(id, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled))
    #expect(downloads.items.map(\.state) == [.cancelled])
    #expect(outcomes.isEmpty)
    #expect(manager().items.map(\.state) == [.cancelled])
  }

  @Test func aFailureIsSavedAndAnnounced() {
    defer { cleanUp() }
    let downloads = manager()
    var outcomes: [DownloadOutcome] = []
    downloads.onOutcome = { outcomes.append($0) }
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.fail(id, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost))
    #expect(outcomes == [.failed(fileName: "report.pdf")])
    #expect(manager().items.map(\.state) == [.failed(.connection)])
  }

  @Test func privateDownloadsKeepTheirFilesApartAndLoseThemWhenTheSessionEnds() throws {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: true)
    downloads.place(id, as: "report.pdf")
    let file = try writeFile("report.pdf", bytes: 4, in: privateDirectory)
    downloads.finish(id, file: file)
    let item = try #require(downloads.items.first)
    #expect(downloads.fileURL(for: item) == file)
    #expect(downloads.fileExists(item))
    #expect(manager().items.isEmpty)
    downloads.endPrivateBrowsing()
    #expect(downloads.items.isEmpty)
    #expect(!exists(file))
    #expect(!exists(directory.appending(path: "report.pdf")))
  }

  @Test func aRunningPrivateDownloadStopsWhenTheSessionEnds() throws {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: true)
    downloads.place(id, as: "report.pdf")
    let partial = try writeFile("report.pdf", bytes: 2, in: privateDirectory)
    downloads.endPrivateBrowsing()
    #expect(downloads.items.isEmpty)
    #expect(!exists(partial))
  }

  @Test func privateFilesLeftByACrashAreRemovedAtLaunch() throws {
    defer { cleanUp() }
    let leftover = try writeFile("left.zip", bytes: 2, in: privateDirectory)
    let kept = try writeFile("kept.zip", bytes: 2)
    _ = manager()
    #expect(!exists(leftover))
    #expect(exists(kept))
  }

  @Test func aDownloadStoppedByQuittingLosesItsPartialFileOnRelaunch() throws {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.place(id, as: "report 2.pdf")
    let partial = try writeFile("report 2.pdf", bytes: 3)
    let relaunched = manager()
    #expect(relaunched.items.map(\.state) == [.failed(.interrupted)])
    #expect(!exists(partial))
  }

  @Test func aStoppedDownloadThatNeverGotAFileLeavesALikeNamedFileAlone() throws {
    defer { cleanUp() }
    let mine = try writeFile("report.pdf", bytes: 3)
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    #expect(downloads.items.first?.fileName == "report.pdf")
    _ = manager()
    downloads.fail(id, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut))
    try downloads.delete(id)
    #expect(exists(mine))
  }

  @Test func failingOrCancellingRemovesThePartialFile() throws {
    defer { cleanUp() }
    let downloads = manager()
    let failing = UUID()
    let cancelling = UUID()
    downloads.begin(id: failing, source: source, isPrivate: false)
    downloads.place(failing, as: "a.pdf")
    let first = try writeFile("a.pdf", bytes: 3)
    downloads.begin(id: cancelling, source: source, isPrivate: false)
    downloads.place(cancelling, as: "b.pdf")
    let second = try writeFile("b.pdf", bytes: 3)
    downloads.fail(failing, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut))
    downloads.cancel(cancelling)
    #expect(!exists(first))
    #expect(!exists(second))
  }

  @Test func deletingAStoppedRowAlsoRemovesAPartialFileItOwns() throws {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.place(id, as: "a.pdf")
    downloads.fail(id, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut))
    let reappeared = try writeFile("a.pdf", bytes: 3)
    try downloads.delete(id)
    #expect(downloads.items.isEmpty)
    #expect(!exists(reappeared))
  }

  @Test func deletingAFinishedDownloadRemovesTheFileAndTheRow() throws {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    let file = try writeFile("report.pdf", bytes: 4)
    downloads.finish(id, file: file)
    try downloads.delete(id)
    #expect(downloads.items.isEmpty)
    #expect(!FileManager.default.fileExists(atPath: file.path(percentEncoded: false)))
    #expect(manager().items.isEmpty)
  }

  @Test func deletingARowWhoseFileIsAlreadyGoneStillRemovesTheRow() throws {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    let file = try writeFile("report.pdf", bytes: 4)
    downloads.finish(id, file: file)
    try FileManager.default.removeItem(at: file)
    #expect(downloads.items.first.map(downloads.fileExists) == false)
    try downloads.delete(id)
    #expect(downloads.items.isEmpty)
  }

  @Test func clearingTheListKeepsRunningDownloadsAndTheFiles() throws {
    defer { cleanUp() }
    let downloads = manager()
    let done = UUID()
    let running = UUID()
    downloads.begin(id: done, source: source, isPrivate: false)
    let file = try writeFile("report.pdf", bytes: 4)
    downloads.finish(done, file: file)
    downloads.begin(id: running, source: source, isPrivate: false)
    downloads.clearInactive()
    #expect(downloads.items.map(\.id) == [running])
    #expect(FileManager.default.fileExists(atPath: file.path(percentEncoded: false)))
    #expect(manager().items.map(\.state) == [.failed(.interrupted)])
  }

  @Test func tryingAgainStartsFromTheSameAddressAndDropsTheOldRow() throws {
    defer { cleanUp() }
    let downloads = manager()
    var started: [URL] = []
    downloads.startDownload = { started.append($0) }
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.fail(id, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut))
    try downloads.retry(id)
    #expect(started == [source])
    #expect(downloads.items.isEmpty)
    #expect(manager().items.isEmpty)
  }

  @Test func tryingAgainWithoutAWayToDownloadKeepsTheRow() {
    defer { cleanUp() }
    let downloads = manager()
    let id = UUID()
    downloads.begin(id: id, source: source, isPrivate: false)
    downloads.cancel(id)
    #expect(throws: DownloadError.cannotRetry) { try downloads.retry(id) }
    #expect(downloads.items.count == 1)
  }

  @Test func namesNeverCollideWithFilesOrOtherRunningDownloads() throws {
    defer { cleanUp() }
    _ = try writeFile("report.pdf", bytes: 1)
    let next = DownloadManager.uniqueURL(in: directory, for: "report.pdf")
    #expect(next.lastPathComponent == "report 2.pdf")
    let reserved = DownloadManager.uniqueURL(in: directory, for: "report.pdf", excluding: ["report 2.pdf"])
    #expect(reserved.lastPathComponent == "report 3.pdf")
    #expect(DownloadManager.uniqueURL(in: directory, for: "../a/b:c.txt").lastPathComponent == "a-b-c.txt")
  }
}
