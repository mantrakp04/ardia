import Foundation

public enum BrowseCopy {
  public static let searching = String(localized: "Searching\u{2026}")
  public static let andMore = String(localized: "\u{2026} and more")
  public static let writing = String(localized: "Making a website for you")
  public static let overview = String(localized: "Overview")
  public static let sources = String(localized: "Sources")
  public static let diveDeeper = String(localized: "Dive Deeper")
  public static let topResults = String(localized: "Top Search Results")
  public static let readThesePages = String(localized: "We read these pages:")

  public static func reading(_ count: Int) -> String {
    String(AttributedString(localized: "Reading ^[\(count) web page](inflect: true)").characters)
  }

  public static func read(_ count: Int) -> String {
    String(AttributedString(localized: "Read ^[\(count) page](inflect: true)").characters)
  }
}

public enum SummaryCopy {
  public static let summarizing = String(localized: "Summarizing for you\u{2026}")
  public static let attribution = String(localized: "Summarized by Apple Intelligence")
  public static let summarize = String(localized: "Summarize")
  public static let unableToSummarize = String(localized: "Unable to Summarize Page")
}
