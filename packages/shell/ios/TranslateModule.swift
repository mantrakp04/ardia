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

    AsyncFunction("translate") { (source: String, target: String, texts: [String]) async throws -> [String] in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
      var out = texts
      for response in try await TranslationSessions.translations(source: source, target: target, requests) {
        if let i = response.clientIdentifier.flatMap(Int.init), out.indices.contains(i) { out[i] = response.targetText }
      }
      return out
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

@available(macOS 26.0, *)
@MainActor
enum TranslationSessions {
  private static var sessions: [String: TranslationSession] = [:]
  private static var tail: Task<Void, Never>?
  private static var uses = 0
  private static let idleSeconds = 60.0

  private struct PassageKey: Hashable {
    let source: String
    let target: String
    let pieces: [String]
  }

  private static var memo: [PassageKey: [String]] = [:]
  private static let memoLimit = 5000

  static func translations(source: String, target: String, _ requests: [TranslationSession.Request]) async throws -> [TranslationSession.Response] {
    try await run(source: source, target: target) { try await $0.translations(from: requests) }
  }

  @available(macOS 26.4, *)
  static func translateBlocks(source: String, target: String, _ blocks: [[String]]) async -> [[String]?] {
    let keys = blocks.map { PassageKey(source: source, target: target, pieces: $0) }
    var found: [PassageKey: [String]] = [:]
    var pending: [(key: PassageKey, pieces: [String])] = []
    var asked = Set<PassageKey>()
    for (key, pieces) in zip(keys, blocks) where asked.insert(key).inserted {
      if let known = memo[key] { found[key] = known } else { pending.append((key, pieces)) }
    }
    let single = pending.filter { $0.pieces.count == 1 }
    if !single.isEmpty {
      let requests = single.enumerated().map { TranslationSession.Request(sourceText: $0.element.pieces[0], clientIdentifier: String($0.offset)) }
      for response in (try? await translations(source: source, target: target, requests)) ?? [] {
        guard let i = response.clientIdentifier.flatMap(Int.init), single.indices.contains(i) else { continue }
        found[single[i].key] = [response.targetText]
      }
    }
    for (key, pieces) in pending where found[key] == nil {
      let text = TranslateModule.linkedPieces(pieces)
      guard let translated = try? await run(source: source, target: target, { try await $0.translate(text).attributedTargetText }),
        let parts = TranslateModule.parts(of: translated, over: pieces)
      else { continue }
      found[key] = parts
    }
    for (key, _) in pending { if let parts = found[key] { remember(key, parts) } }
    return keys.map { found[$0] }
  }

  private static func remember(_ key: PassageKey, _ parts: [String]) {
    if memo.count >= memoLimit { memo.removeAll() }
    memo[key] = parts
  }

  private static func run<T: Sendable>(source: String, target: String, _ work: @escaping @MainActor (TranslationSession) async throws -> T) async throws -> T {
    let previous = tail
    let task = Task { @MainActor () async throws -> T in
      await previous?.value
      let key = "\(source)>\(target)"
      let session: TranslationSession
      if let cached = sessions[key] {
        session = cached
      } else {
        session = await make(source: source, target: target)
        sessions[key] = session
      }
      do {
        return try await work(session)
      } catch {
        sessions[key] = nil
        throw error
      }
    }
    tail = Task { _ = try? await task.value }
    defer { forgetWhenIdle() }
    return try await task.value
  }

  private static func forgetWhenIdle() {
    uses += 1
    let use = uses
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(idleSeconds))
      if uses == use { sessions.removeAll() }
    }
  }

  private static func make(source: String, target: String) async -> TranslationSession {
    let from = Locale.Language(identifier: source), to = Locale.Language(identifier: target)
    if #available(macOS 26.4, *), await LanguageAvailability(preferredStrategy: .lowLatency).status(from: from, to: to) == .installed {
      return TranslationSession(installedSource: from, target: to, preferredStrategy: .lowLatency)
    }
    return TranslationSession(installedSource: from, target: to)
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

enum TranslateError: LocalizedError {
  case unavailable, noWindow
  var errorDescription: String? {
    switch self {
    case .unavailable: return "needs macOS 26"
    case .noWindow: return "no window to ask in"
    }
  }
}

@available(macOS 26.0, *)
@MainActor
enum DownloadPrompt {
  static func run(source: Locale.Language, target: Locale.Language) async throws {
    guard let content = (NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first { $0.isVisible })?.contentView else {
      throw TranslateError.noWindow
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      var host: NSView?
      var finished = false
      let view = DownloadPromptView(configuration: .init(source: source, target: target)) { result in
        guard !finished else { return }
        finished = true
        host?.removeFromSuperview()
        continuation.resume(with: result)
      }
      let hosting = NSHostingView(rootView: view)
      hosting.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
      host = hosting
      content.addSubview(hosting)
    }
  }
}

@available(macOS 26.0, *)
private struct DownloadPromptView: View {
  let configuration: TranslationSession.Configuration
  let done: (Result<Void, Error>) -> Void
  var body: some View {
    Color.clear.translationTask(configuration) { session in
      do {
        try await session.prepareTranslation()
        done(.success(()))
      } catch {
        done(.failure(error))
      }
    }
  }
}
