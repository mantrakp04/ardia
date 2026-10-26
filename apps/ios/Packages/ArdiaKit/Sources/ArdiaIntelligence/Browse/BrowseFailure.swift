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
  case featureOff

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
    case .featureOff: String(localized: "AI Features Are Off")
    }
  }

  public var message: String {
    switch self {
    case .offline: String(localized: "Check your connection and try again.")
    case .noResults: String(localized: "Try different words.")
    case .searchUnavailable: String(localized: "Try again in a moment.")
    case .sourcesUnreachable: String(localized: "Here are the top results instead.")
    case .modelUnavailable(let status): status.message
    case .guardrail, .unsupportedLanguage, .tooMuchToRead: String(localized: "Here are the pages it found.")
    case .generationFailed: String(localized: "Something went wrong while writing it.")
    case .featureOff: String(localized: "Turn on AI Features in Settings to use Browse for Me.")
    }
  }

  public var showsSources: Bool {
    switch self {
    case .offline, .noResults, .searchUnavailable, .featureOff: false
    case .sourcesUnreachable, .modelUnavailable, .guardrail, .unsupportedLanguage, .tooMuchToRead, .generationFailed: true
    }
  }

  public var canRetry: Bool {
    switch self {
    case .offline, .searchUnavailable, .sourcesUnreachable, .generationFailed: true
    case .modelUnavailable(let status): status == .modelDownloading
    case .noResults, .guardrail, .unsupportedLanguage, .tooMuchToRead, .featureOff: false
    }
  }

  public var opensExperiments: Bool { self == .featureOff }

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
