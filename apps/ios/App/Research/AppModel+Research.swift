import ArdiaBrowser
import Foundation

extension AppModel {
  static let researchWriterKey = "ArdiaResearchWriter"

  func startResearch(_ query: String) {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    browse.dismissSearch()
    research?.cancel()
    let forcesExcerpts = UserDefaults.standard.string(forKey: Self.researchWriterKey) == "excerpts"
    let session = ResearchSession(query: trimmed, forcesExcerpts: forcesExcerpts)
    research = session
    session.start()
  }

  func openResearchSource(_ url: URL) {
    research?.cancel()
    research = nil
    openPage(url, origin: .search)
  }

  func searchInsteadOfResearch(_ query: String) {
    research?.cancel()
    research = nil
    openSearch(query)
  }

  func researchClosed() {
    research?.cancel()
    research = nil
  }
}
