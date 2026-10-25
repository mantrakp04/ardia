import Foundation
import NaturalLanguage

enum Prompts {
  static func overviewInstructions(today: Date = .now) -> String {
    """
    You write the title and a direct answer for a web search, using only the numbered search results. Never invent \
    facts, names, numbers or prices. If the results don't answer the question, say so plainly. Today is \(dateLine(today)).
    """
  }

  static func overviewPrompt(question: String, language: String, results: [(number: Int, title: String, site: String, snippet: String)]) -> String {
    var prompt = questionPrefix(question) + "Write in \(language).\n\nSearch results:\n"
    for result in results {
      prompt += "[\(result.number)] \(result.title) (\(result.site)): \(result.snippet)\n"
    }
    return prompt
  }

  static func sectionsInstructions(today: Date = .now) -> String {
    """
    You write the body of an answer page for a web search, using only the numbered sources the user gives you. The \
    page already has a title and a short answer, so add detail instead of repeating it. Give each section 2 \
    short points. Every point cites the numbers of the sources it comes from. Never invent facts, names, numbers, prices or \
    links. If the sources don't cover something, leave it out. Today is \(dateLine(today)).
    """
  }

  static func sectionsPrompt(question: String, language: String, answer: String, sources: [(number: Int, title: String, site: String, text: String)]) -> String {
    var prompt = questionPrefix(question) + "Write in \(language).\n"
    if !answer.isEmpty { prompt += "The page's answer: \(answer)\n" }
    prompt += "\nSources:\n"
    for source in sources {
      prompt += "\n[\(source.number)] \(source.title) (\(source.site))\n\(source.text)\n"
    }
    return prompt
  }

  static func questionPrefix(_ question: String) -> String {
    "Question: \(question)\n"
  }

  private static func dateLine(_ date: Date) -> String {
    date.formatted(.dateTime.year().month(.wide).day().locale(Locale(identifier: "en_US")))
  }

  static let notesInstructions = """
    You take short notes from one web page for someone answering a question. Keep only facts from the page that help \
    answer it: names, numbers, steps, comparisons and conclusions. Write plain sentences, one per line, without \
    commentary. If the page says nothing useful, write: Nothing relevant.
    """

  static func notesPrompt(question: String, title: String, text: String) -> String {
    "Question: \(question)\n\nPage: \(title)\n\(text)"
  }

  static let summaryInstructions = """
    You summarize one web page for a reader on their phone, using only the page's text. Lead with the main point, \
    then the details that matter most. Never add facts that aren't on the page.
    """

  static func summaryPrompt(title: String, site: String, text: String, language: String) -> String {
    "Summarize this page in \(language).\n\nTitle: \(title)\nSite: \(site)\n\n\(text)"
  }

  static let chunkNotesInstructions = """
    You take compact notes on one part of a web page so it can be summarized later. Keep its key facts, names, \
    numbers and conclusions as plain sentences, one per line.
    """

  static func conversationInstructions(title: String, site: String, context: String, language: String) -> String {
    """
    You answer questions about one web page, using only the page text below. Answer in 1 to 4 sentences, in \(language). \
    If the page doesn't say, reply that the page doesn't cover it. Never invent details.

    Title: \(title)
    Site: \(site)

    \(context)
    """
  }

  static func questionPrompt(_ question: String, passages: String) -> String {
    passages.isEmpty ? question : "\(question)\n\nMore from the page:\n\(passages)"
  }

  static func languageName(for text: String, fallback: Locale = .current) -> (code: String, name: String) {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    let fallbackCode = fallback.language.languageCode?.identifier ?? "en"
    var code = fallbackCode
    if let (language, probability) = recognizer.languageHypotheses(withMaximum: 1).first,
      probability >= 0.75 || (probability >= 0.5 && text.split(whereSeparator: \.isWhitespace).count >= 4)
    {
      code = language.rawValue
    }
    let name = Locale(identifier: "en").localizedString(forIdentifier: code) ?? "English"
    return (code, name)
  }
}
