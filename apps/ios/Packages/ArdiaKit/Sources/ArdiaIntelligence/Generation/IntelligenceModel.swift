import Foundation

public enum IntelligenceStatus: Sendable, Hashable {
  case available
  case deviceNotEligible
  case appleIntelligenceOff
  case modelDownloading
  case languageUnsupported

  public var isAvailable: Bool { self == .available }

  public var title: String {
    switch self {
    case .available: String(localized: "Apple Intelligence Is On")
    case .deviceNotEligible: String(localized: "Apple Intelligence Isn\u{2019}t Available")
    case .appleIntelligenceOff: String(localized: "Turn On Apple Intelligence")
    case .modelDownloading: String(localized: "Apple Intelligence Is Getting Ready")
    case .languageUnsupported: String(localized: "Language Not Supported")
    }
  }

  public var message: String {
    switch self {
    case .available:
      String(localized: "Browse for Me and summaries run on this iPhone. Only the searches leave it.")
    case .deviceNotEligible:
      String(localized: "This iPhone can\u{2019}t run Apple Intelligence. Here are the top results.")
    case .appleIntelligenceOff:
      String(localized: "Browse for Me and summaries need it. Turn it on in Settings.")
    case .modelDownloading:
      String(localized: "Apple Intelligence is still downloading. Try again in a few minutes.")
    case .languageUnsupported:
      String(localized: "Apple Intelligence doesn\u{2019}t support your iPhone\u{2019}s language yet.")
    }
  }

  public var offersSettingsLink: Bool {
    switch self {
    case .appleIntelligenceOff, .languageUnsupported: true
    case .available, .deviceNotEligible, .modelDownloading: false
    }
  }
}

public enum IntelligenceError: Error, Sendable, Hashable {
  case contextExceeded
  case guardrail
  case refusal
  case unsupportedLanguage
  case unavailable(IntelligenceStatus)
  case rateLimited
  case timedOut
  case failed
}

public struct BrowsePageDraft: Sendable, Hashable {
  public struct Bullet: Sendable, Hashable {
    public var emoji: String?
    public var lead: String?
    public var text: String?
    public var sources: [Int]

    public init(emoji: String? = nil, lead: String? = nil, text: String?, sources: [Int] = []) {
      self.emoji = emoji
      self.lead = lead
      self.text = text
      self.sources = sources
    }
  }

  public struct Section: Sendable, Hashable {
    public var heading: String?
    public var bullets: [Bullet]

    public init(heading: String?, bullets: [Bullet] = []) {
      self.heading = heading
      self.bullets = bullets
    }
  }

  public var title: String?
  public var answer: String?
  public var sections: [Section]
  public var followUps: [String]

  public init(title: String? = nil, answer: String? = nil, sections: [Section] = [], followUps: [String] = []) {
    self.title = title
    self.answer = answer
    self.sections = sections
    self.followUps = followUps
  }
}

public struct PageSummary: Sendable, Codable, Hashable {
  public var headline: String
  public var points: [SummaryPoint]

  public init(headline: String = "", points: [SummaryPoint] = []) {
    self.headline = headline
    self.points = points
  }

  public var isEmpty: Bool { headline.isEmpty && points.isEmpty }
}

public struct SummaryPoint: Sendable, Codable, Hashable {
  public static let fallbackSymbol = "info.circle"
  public static let symbols = [
    "lightbulb", "star", "clock", "figure.hiking", "calendar", "mappin.and.ellipse", "person.2", "dollarsign.circle",
    "chart.line.uptrend.xyaxis", "heart", "leaf", "bolt", "exclamationmark.triangle", "checkmark.seal",
    "list.bullet", "book", "quote.bubble", "globe", "hammer", "flask", "graduationcap", "cart", "house", "car",
    "airplane", "fork.knife", "figure.run", "brain.head.profile", "shield", "gearshape", "music.note", "film",
    "sportscourt", "cross.case", "building.2", "newspaper", "questionmark.circle", "info.circle", "sparkles",
    "flag", "trophy", "chart.bar", "doc.text", "person", "map", "sun.max", "cloud.rain", "drop", "pawprint",
    "camera", "paintbrush", "desktopcomputer", "iphone", "lock", "scalemass", "ruler", "thermometer.medium",
  ]

  public var symbol: String
  public var label: String
  public var text: String

  public init(symbol: String, label: String, text: String) {
    self.symbol = Self.validated(symbol)
    self.label = label
    self.text = text
  }

  static func validated(_ symbol: String) -> String {
    guard !symbol.isEmpty else { return "" }
    guard symbols.contains(symbol), SymbolCatalog.exists(symbol) else { return fallbackSymbol }
    return symbol
  }

  var finished: SummaryPoint {
    SummaryPoint(symbol: symbol.isEmpty ? Self.fallbackSymbol : symbol, label: label, text: text)
  }
}

public enum GenerationKind: Sendable, Hashable {
  case overview
  case sections
  case summary
  case notes
  case answer
}

public protocol IntelligenceModel: AnyObject, Sendable {
  var status: IntelligenceStatus { get }
  var contextSize: Int { get }
  func supportsLanguage(_ code: String) -> Bool
  func tokenCount(of text: String) async -> Int?
  func schemaTokens(for kind: GenerationKind) async -> Int?
  func prewarm(instructions: String, promptPrefix: String?)
  func condense(instructions: String, prompt: String) async throws -> String
  func streamOverview(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error>
  func streamSections(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error>
  func streamSummary(instructions: String, prompt: String) -> AsyncThrowingStream<PageSummary, any Error>
  func makeConversation(instructions: String) -> any IntelligenceConversation
  func statusChanges() -> AsyncStream<IntelligenceStatus>
}

extension IntelligenceModel {
  public func prewarm(instructions: String) {
    prewarm(instructions: instructions, promptPrefix: nil)
  }
}

public protocol IntelligenceConversation: AnyObject, Sendable {
  func streamAnswer(to prompt: String) -> AsyncThrowingStream<String, any Error>
}
