import Foundation
import SwiftData
import Testing
@testable import ArdiaBrowser

enum VersionOneOnlyPlan: SchemaMigrationPlan {
  static var schemas: [any VersionedSchema.Type] { [BrowserSchemaV1.self] }
  static var stages: [MigrationStage] { [] }
}

@Suite(.serialized) struct BrowserStoreMigrationTests {
  static func scratch() throws -> URL {
    let directory = URL.temporaryDirectory.appending(path: "ardia-store-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  @MainActor
  static func writeVersionOneStore(in directory: URL, tabID: UUID, visitedAt: Date) throws {
    let schema = Schema(versionedSchema: BrowserSchemaV1.self)
    let configuration = ModelConfiguration("Browser", schema: schema, url: directory.appending(path: "Browser.store"))
    let container = try ModelContainer(for: schema, migrationPlan: VersionOneOnlyPlan.self, configurations: [configuration])
    let context = ModelContext(container)
    let tab = BrowserTab(id: tabID, url: "https://example.com/", title: "Example", created: visitedAt, position: 0, origin: .typed, profileSyncId: "work")
    tab.archivedAt = visitedAt
    context.insert(tab)
    context.insert(Visit(url: "https://example.com/", title: "Example", visitedAt: visitedAt, profileSyncId: "work", transition: .link))
    try context.save()
  }

  @MainActor
  @Test func aStoreWrittenByTheFirstVersionOpensWithEverythingInIt() throws {
    let directory = try Self.scratch()
    defer { try? FileManager.default.removeItem(at: directory) }
    let tabID = UUID()
    let visitedAt = Date(timeIntervalSinceReferenceDate: 800_000_000)
    try Self.writeVersionOneStore(in: directory, tabID: tabID, visitedAt: visitedAt)

    let container = try BrowserStore.makeContainer(.directory(directory))
    let context = ModelContext(container)
    let tabs = try context.fetch(FetchDescriptor<BrowserTab>())
    #expect(tabs.map(\.id) == [tabID])
    #expect(tabs.first?.archivedAt == visitedAt)
    #expect(tabs.first?.profileSyncId == "work")
    let visits = try context.fetch(FetchDescriptor<Visit>())
    #expect(visits.map(\.visitedAt) == [visitedAt])
    #expect(visits.first?.transition == .link)
    #expect(try context.fetchCount(FetchDescriptor<DownloadRecord>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<HiddenSyncedVisit>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<HistoryClearing>()) == 0)
  }

  @MainActor
  @Test func theNewKindsOfRecordsAreSavedAndReadBack() throws {
    let directory = try Self.scratch()
    defer { try? FileManager.default.removeItem(at: directory) }
    try Self.writeVersionOneStore(in: directory, tabID: UUID(), visitedAt: .now)
    let item = DownloadItem.started(id: UUID(), source: URL(string: "https://files.example/a.zip"), isPrivate: false, at: .now)
      .placed(as: "a 2.zip")
      .finishing(at: .now, size: 2048)
    do {
      let container = try BrowserStore.makeContainer(.directory(directory))
      let context = ModelContext(container)
      try SwiftDataDownloadStore(context: context).saveDownload(item)
      context.insert(HiddenSyncedVisit(fingerprint: "f00d", lastVisit: .now))
      context.insert(HistoryClearing(start: nil, end: .now))
      try context.save()
    }
    let reopened = try BrowserStore.makeContainer(.directory(directory))
    let context = ModelContext(reopened)
    #expect(try SwiftDataDownloadStore(context: context).loadDownloads() == [item])
    #expect(try context.fetchCount(FetchDescriptor<HiddenSyncedVisit>()) == 1)
    #expect(try context.fetchCount(FetchDescriptor<BrowserTab>()) == 1)
  }

  @MainActor
  @Test func aFreshStoreStartsEmpty() throws {
    let directory = try Self.scratch()
    defer { try? FileManager.default.removeItem(at: directory) }
    let context = ModelContext(try BrowserStore.makeContainer(.directory(directory)))
    #expect(try context.fetchCount(FetchDescriptor<BrowserTab>()) == 0)
    #expect(try context.fetchCount(FetchDescriptor<DownloadRecord>()) == 0)
  }
}

@Suite struct ReaderPrintMarkupTests {
  @Test func readerTextIsEscapedAndTheArticleKeepsItsMarkup() {
    let content = ReadableContent(
      url: "https://example.com/a",
      title: "Fish & <Chips>",
      siteName: "Example",
      byline: "Ana \"Ink\" Silva",
      excerpt: nil,
      leadImage: nil,
      language: "pt",
      paragraphs: ["One"],
      html: "<p>One</p><h2>Two</h2>",
      wordCount: 2,
      isArticle: true
    )
    let html = ReaderPrintMarkup.html(for: content)
    #expect(html.contains("<h1>Fish &amp; &lt;Chips&gt;</h1>"))
    #expect(html.contains("Example · Ana &quot;Ink&quot; Silva"))
    #expect(html.contains("<p>One</p><h2>Two</h2>"))
    #expect(html.contains("lang=\"pt\""))
    #expect(!html.contains("<script"))
  }

  @Test func paragraphsStandInWhenThereIsNoMarkup() {
    let content = ReadableContent(
      url: "https://example.com/a", title: "T", siteName: "", byline: nil, excerpt: nil, leadImage: nil, language: nil,
      paragraphs: ["a < b", "c"], html: "", wordCount: 2, isArticle: false
    )
    let html = ReaderPrintMarkup.html(for: content)
    #expect(html.contains("<p>a &lt; b</p><p>c</p>"))
  }
}
