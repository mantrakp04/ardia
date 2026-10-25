import Foundation

public struct PageText: Sendable, Codable, Hashable {
  public var url: URL?
  public var title: String
  public var siteName: String
  public var paragraphs: [String]
  public var language: String?

  public init(url: URL?, title: String, siteName: String, paragraphs: [String], language: String? = nil) {
    self.url = url
    self.title = title
    self.siteName = siteName
    self.paragraphs = paragraphs
    self.language = language
  }

  public init(_ page: ReadablePage) {
    self.init(
      url: page.url, title: page.title, siteName: page.siteName, paragraphs: page.blocks.map(\.text),
      language: page.language)
  }

  var blocks: [TextBlock] {
    paragraphs.lazy.map { ReadableExtractor.collapseWhitespace($0) }.filter { !$0.isEmpty }.map {
      TextBlock(kind: .paragraph, text: $0)
    }
  }

  var wordCount: Int {
    paragraphs.reduce(0) { $0 + $1.split(whereSeparator: \.isWhitespace).count }
  }
}

public enum SummaryFailure: Sendable, Hashable {
  case modelUnavailable(IntelligenceStatus)
  case nothingToSummarize
  case guardrail
  case unsupportedLanguage
  case failed
  case featureOff

  public var opensExperiments: Bool { self == .featureOff }

  public var title: String {
    switch self {
    case .modelUnavailable(let status): status.title
    case .featureOff: String(localized: "AI Features Are Off")
    case .nothingToSummarize, .guardrail, .unsupportedLanguage, .failed: SummaryCopy.unableToSummarize
    }
  }

  public var message: String {
    switch self {
    case .modelUnavailable(let status): status.message
    case .nothingToSummarize: String(localized: "This page doesn\u{2019}t have enough text to summarize.")
    case .guardrail: String(localized: "Apple Intelligence can\u{2019}t summarize this page.")
    case .unsupportedLanguage: String(localized: "Apple Intelligence can\u{2019}t read this page\u{2019}s language yet.")
    case .failed: String(localized: "Something went wrong. Try again.")
    case .featureOff: String(localized: "Turn on AI Features in Settings \u{203A} Experiments to summarize pages and ask about them.")
    }
  }

  public var offersSettingsLink: Bool {
    if case .modelUnavailable(let status) = self { return status.offersSettingsLink }
    return false
  }

  init(_ error: IntelligenceError) {
    switch error {
    case .guardrail, .refusal: self = .guardrail
    case .unsupportedLanguage: self = .unsupportedLanguage
    case .unavailable(let status): self = .modelUnavailable(status)
    case .contextExceeded, .rateLimited, .timedOut, .failed: self = .failed
    }
  }
}
