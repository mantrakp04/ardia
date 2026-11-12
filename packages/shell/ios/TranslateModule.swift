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
      Locale(identifier: "en").localizedString(forIdentifier: identifier) ?? identifier
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

    AsyncFunction("translateBlocks") { (source: String, target: String, blocks: [[String]], owner: String) async -> [[String]?] in
      guard #available(macOS 26.0, *) else { return blocks.map { _ in nil } }
      return await TranslationSessions.translateBlocks(source: source, target: target, owner: owner, blocks)
    }

    AsyncFunction("open") { (owner: String) async in
      guard #available(macOS 26.0, *) else { return }
      await TranslationSessions.open(owner: owner)
    }

    AsyncFunction("cancel") { (owner: String) async in
      guard #available(macOS 26.0, *) else { return }
      await TranslationSessions.cancel(owner: owner)
    }

    AsyncFunction("translate") { (source: String, target: String, texts: [String]) async throws -> [String?] in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      return try await TranslationSessions.translate(source: source, target: target, texts)
    }
  }
}

extension TranslateModule {
  static func isUnchanged(_ parts: [String], from pieces: [String]) -> Bool {
    parts.joined().filter { !$0.isWhitespace } == pieces.joined().filter { !$0.isWhitespace }
  }
}
