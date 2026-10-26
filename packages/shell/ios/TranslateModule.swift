import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

public class TranslateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaTranslate")

    Constant("available") { () -> Bool in
      if #available(macOS 26.0, *) { return true }
      return false
    }

    Function("userLanguages") { () -> [String] in Locale.preferredLanguages }

    Function("languageName") { (identifier: String) -> String in
      Locale.current.localizedString(forIdentifier: identifier) ?? identifier
    }

    AsyncFunction("detect") { (text: String) -> String? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      guard let (language, confidence) = recognizer.languageHypotheses(withMaximum: 1).first, confidence >= 0.5 else { return nil }
      return language.rawValue
    }

    AsyncFunction("status") { (source: String, target: String) async -> String in
      guard #available(macOS 26.0, *) else { return "unsupported" }
      switch await LanguageAvailability().status(from: Locale.Language(identifier: source), to: Locale.Language(identifier: target)) {
      case .installed: return "installed"
      case .supported: return "supported"
      default: return "unsupported"
      }
    }

    AsyncFunction("supportedLanguages") { () async -> [String] in
      guard #available(macOS 26.0, *) else { return [] }
      return await LanguageAvailability().supportedLanguages.map { $0.minimalIdentifier }
    }

    AsyncFunction("prepare") { (source: String, target: String) async throws in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      try await DownloadPrompt.run(source: Locale.Language(identifier: source), target: Locale.Language(identifier: target))
    }

    AsyncFunction("translateBlocks") { (source: String, target: String, blocks: [[String]]) async -> [[String]?] in
      guard #available(macOS 26.4, *) else { return blocks.map { _ in nil } }
      return await TranslationSessions.translateBlocks(source: source, target: target, blocks)
    }

    AsyncFunction("translate") { (source: String, target: String, texts: [String]) async throws -> [String?] in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      return try await TranslationSessions.translate(source: source, target: target, texts)
    }
  }
}

extension TranslateModule {
  static func linkedPieces(_ pieces: [String]) -> AttributedString {
    var text = AttributedString()
    for (i, piece) in pieces.enumerated() {
      var run = AttributedString(piece)
      run.link = URL(string: "ac-piece:\(i)")
      text += run
    }
    return text
  }

  static func isUnchanged(_ parts: [String], from pieces: [String]) -> Bool {
    parts.joined().filter { !$0.isWhitespace } == pieces.joined().filter { !$0.isWhitespace }
  }

  static func parts(of translated: AttributedString, over pieces: [String]) -> [String]? {
    var parts = Array(repeating: "", count: pieces.count)
    var order: [Int] = []
    var last = 0
    for run in translated.runs {
      let words = String(translated[run.range].characters)
      if let link = run.link, link.scheme == "ac-piece", let i = Int(link.absoluteString.dropFirst("ac-piece:".count)), parts.indices.contains(i) {
        order.append(i)
        last = i
        parts[i] += words
      } else {
        parts[last] += words
      }
    }
    guard !order.isEmpty else { return nil }
    if zip(order, order.dropFirst()).contains(where: { $0 > $1 }) {
      return distribute(String(translated.characters), over: pieces)
    }
    return parts
  }
}

extension TranslateModule {
  static func distribute(_ text: String, over pieces: [String]) -> [String] {
    let chars = Array(text)
    let total = max(1, pieces.reduce(0) { $0 + $1.count })
    var out: [String] = []
    var start = 0
    var seen = 0
    for (i, piece) in pieces.enumerated() {
      seen += piece.count
      var end = i == pieces.count - 1 ? chars.count : min(chars.count, Int((Double(seen) / Double(total) * Double(chars.count)).rounded()))
      if end < chars.count, end > start {
        let window = 12
        if let space = (0...window).lazy.flatMap({ [end + $0, end - $0] }).first(where: { $0 > start && $0 < chars.count && chars[$0] == " " }) {
          end = space + 1
        }
      }
      end = max(start, end)
      out.append(String(chars[start..<end]))
      start = end
    }
    return out
  }
}
