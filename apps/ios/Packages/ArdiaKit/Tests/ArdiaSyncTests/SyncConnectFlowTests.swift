import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@Suite struct SyncConnectFlowTests {
  let folder = URL(fileURLWithPath: "/tmp/Ardia Sync")
  let right = RecoveryPhrase.words(for: RecoveryPhrase.generateEntropy()).joined(separator: " ")
  let wrong = RecoveryPhrase.words(for: RecoveryPhrase.generateEntropy()).joined(separator: " ")

  @Test func aCorrectedPhraseClearsTheErrorAndJoinsWithTheFolderAlreadyChosen() {
    var flow = SyncConnectFlow()
    #expect(flow.enterPhrase(wrong) == nil)
    let first = flow.chooseFolder(folder)
    #expect(first == .init(phrase: wrong, folder: folder))
    #expect(flow.finish(.mismatch) == nil)
    #expect(flow.failure == ConnectResult.mismatch.message)

    let retry = flow.enterPhrase(right)
    #expect(retry == .init(phrase: right, folder: folder))
    #expect(flow.failure == nil)
    #expect(flow.isConnecting)
    #expect(flow.finish(.connected) == nil)
    #expect(flow.phrase.isEmpty)
  }

  @Test func theSamePhraseRetypedDoesNotRetryOrHideItsError() {
    var flow = SyncConnectFlow()
    _ = flow.enterPhrase(wrong)
    _ = flow.chooseFolder(folder)
    _ = flow.finish(.mismatch)
    #expect(flow.enterPhrase("  " + wrong.uppercased() + "\n") == nil)
    #expect(flow.failure == ConnectResult.mismatch.message)
  }

  @Test func anUnfinishedPhraseClearsTheStaleErrorWithoutJoining() {
    var flow = SyncConnectFlow()
    _ = flow.enterPhrase(wrong)
    _ = flow.chooseFolder(folder)
    _ = flow.finish(.mismatch)
    #expect(flow.enterPhrase("abandon abandon") == nil)
    #expect(flow.failure == nil)
    #expect(!flow.isConnecting)
  }

  @Test func aPhraseChangedWhileJoiningRetriesWithTheNewOneInsteadOfShowingTheOldError() {
    var flow = SyncConnectFlow()
    _ = flow.enterPhrase(wrong)
    _ = flow.chooseFolder(folder)
    #expect(flow.enterPhrase(right) == nil)
    let retry = flow.finish(.mismatch)
    #expect(retry == .init(phrase: right, folder: folder))
    #expect(flow.failure == nil)
    #expect(flow.isConnecting)
  }

  @Test func aPhraseWithoutAFolderWaitsForTheFolder() {
    var flow = SyncConnectFlow()
    #expect(flow.enterPhrase(right) == nil)
    #expect(flow.hasPhrase)
    #expect(flow.chooseFolder(folder) == .init(phrase: right, folder: folder))
  }
}
