import Foundation

public enum BrowseFailure: Sendable, Hashable {
  case offline
  case noResults
  case searchUnavailable
  case sourcesUnreachable
  case modelUnavailable(IntelligenceStatus)
  case guardrail
  case unsupportedLanguage
  case tooMuchToRead
  case generationFailed

  public var title: String {
    switch self {
    case .offline: String(localized: "You\u{2019}re Offline")
    case .noResults: String(localized: "No Results")
    case .searchUnavailable: String(localized: "Search Isn\u{2019}t Responding")
    case .sourcesUnreachable: String(localized: "Couldn\u{2019}t Open These Pages")
    case .modelUnavailable(let status): status.title
    case .guardrail: String(localized: "Can\u{2019}t Write This Page")
    case .unsupportedLanguage: String(localized: "Language Not Supported")
    case .tooMuchToRead: String(localized: "Too Much to Read")
    case .generationFailed: String(localized: "Couldn\u{2019}t Finish the Page")
    }
  }

  public var message: String {
    switch self {
    case .offline:
      String(localized: "Looks like you\u{2019}re offline. Check your internet connection and try again.")
    case .noResults:
      String(localized: "DuckDuckGo didn\u{2019}t find any pages for this search. Try different words.")
    case .searchUnavailable:
      String(localized: "DuckDuckGo didn\u{2019}t send back results. Try again in a moment.")
    case .sourcesUnreachable:
      String(localized: "None of the top results would open. Here they are, so you can look yourself.")
    case .modelUnavailable(let status): status.message
    case .guardrail:
      String(localized: "Apple Intelligence can\u{2019}t write a page about this. Here are the pages it found.")
    case .unsupportedLanguage:
      String(localized: "Apple Intelligence can\u{2019}t write in this language yet. Here are the pages it found.")
    case .tooMuchToRead:
      String(localized: "These pages were too long to read together. Here are the pages it found.")
    case .generationFailed:
      String(localized: "There was an error generating your page. Please try again.")
    }
  }

  public var showsSources: Bool {
    switch self {
    case .offline, .noResults, .searchUnavailable: false
    case .sourcesUnreachable, .modelUnavailable, .guardrail, .unsupportedLanguage, .tooMuchToRead, .generationFailed: true
    }
  }

  public var canRetry: Bool {
    switch self {
    case .offline, .searchUnavailable, .sourcesUnreachable, .generationFailed: true
    case .modelUnavailable(let status): status == .modelDownloading
    case .noResults, .guardrail, .unsupportedLanguage, .tooMuchToRead: false
    }
  }

  public var offersSettingsLink: Bool {
    if case .modelUnavailable(let status) = self { return status.offersSettingsLink }
    return false
  }

  init(_ error: IntelligenceError) {
    switch error {
    case .contextExceeded: self = .tooMuchToRead
    case .guardrail, .refusal: self = .guardrail
    case .unsupportedLanguage: self = .unsupportedLanguage
    case .unavailable(let status): self = .modelUnavailable(status)
    case .rateLimited, .timedOut, .failed: self = .generationFailed
    }
  }
}
