import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

@available(macOS 26.0, *)
@MainActor
enum TranslationSessions {
  private static var sessions: [String: TranslationSession] = [:]
  private static var lowLatencyPairs: Set<String> = []
  private static var making: [String: Task<TranslationSession, Never>] = [:]
  private static var standardInstalledPairs: [String: Bool] = [:]
  private static var uses = 0
  private static let idleSeconds = 60.0

  private struct PassageKey: Hashable {
    let source: String
    let target: String
    let pieces: [String]
  }

  private static var memo: [PassageKey: [String]] = [:]
  private static var inFlight: [PassageKey: Task<[String]?, Never>] = [:]
  private static let memoLimit = 5000

  static func translations(source: String, target: String, standard: Bool = false, _ requests: [TranslationSession.Request]) async throws -> [TranslationSession.Response] {
    try await run(source: source, target: target, standard: standard) { try await $0.translations(from: requests) }
  }

  static func translate(source: String, target: String, _ texts: [String]) async throws -> [String?] {
    let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
    var out: [String?] = texts.map { _ in nil }
    for response in try await translations(source: source, target: target, requests) {
      if let i = response.clientIdentifier.flatMap(Int.init), out.indices.contains(i) { out[i] = response.targetText }
    }
    return out
  }

  @available(macOS 26.4, *)
  static func translateBlocks(source: String, target: String, _ blocks: [[String]]) async -> [[String]?] {
    let keys = blocks.map { PassageKey(source: source, target: target, pieces: $0) }
    var found: [PassageKey: [String]] = [:]
    await withTaskGroup(of: (PassageKey, [String]?).self) { group in
      for key in Set(keys) { group.addTask { @MainActor in (key, await passage(key)) } }
      for await (key, parts) in group { if let parts { found[key] = parts } }
    }
    return keys.map { found[$0] }
  }

  @available(macOS 26.4, *)
  private static func passage(_ key: PassageKey) async -> [String]? {
    if let known = memo[key] { return known }
    if let running = inFlight[key] { return await running.value }
    let task = Task { @MainActor in await translateFresh(key) }
    inFlight[key] = task
    let parts = await task.value
    inFlight[key] = nil
    if let parts, !TranslateModule.isUnchanged(parts, from: key.pieces) { remember(key, parts) }
    return parts
  }

  @available(macOS 26.4, *)
  private static func translateFresh(_ key: PassageKey) async -> [String]? {
    let first = await translateOnce(key, standard: false)
    if let first, !TranslateModule.isUnchanged(first, from: key.pieces) { return first }
    guard lowLatencyPairs.contains(pairKey(key.source, key.target)), worthAskingAgain(key.pieces),
      await standardInstalled(source: key.source, target: key.target),
      let again = await translateOnce(key, standard: true)
    else { return first }
    return first == nil || !TranslateModule.isUnchanged(again, from: key.pieces) ? again : first
  }

  @available(macOS 26.4, *)
  private static func translateOnce(_ key: PassageKey, standard: Bool) async -> [String]? {
    if key.pieces.count == 1 {
      var out = ""
      for piece in SentenceRuns.split(key.pieces[0]) {
        guard !piece.text.isEmpty else {
          out += piece.gap
          continue
        }
        let text = piece.text
        guard let translated = try? await run(source: key.source, target: key.target, standard: standard, { try await $0.translate(text).targetText })
        else { return nil }
        out += translated + piece.gap
      }
      return [out]
    }
    let text = TranslateModule.linkedPieces(key.pieces)
    guard let translated = try? await run(source: key.source, target: key.target, standard: standard, { try await $0.translate(text).attributedTargetText })
    else { return nil }
    return TranslateModule.parts(of: translated, over: key.pieces)
  }

  private static func worthAskingAgain(_ pieces: [String]) -> Bool {
    let text = pieces.joined()
    let tokenizer = NLTokenizer(unit: .word)
    tokenizer.string = text
    var words = 0
    tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { _, _ in
      words += 1
      return words < 2
    }
    return words >= 2
  }

  private static func standardInstalled(source: String, target: String) async -> Bool {
    let pair = pairKey(source, target)
    if let known = standardInstalledPairs[pair] { return known }
    let installed = await LanguageAvailability().status(from: Locale.Language(identifier: source), to: Locale.Language(identifier: target)) == .installed
    standardInstalledPairs[pair] = installed
    return installed
  }

  private static func pairKey(_ source: String, _ target: String) -> String { "\(source)>\(target)" }

  private static func remember(_ key: PassageKey, _ parts: [String]) {
    if memo.count >= memoLimit { memo.removeAll() }
    memo[key] = parts
  }

  private static func run<T: Sendable>(source: String, target: String, standard: Bool = false, _ work: @escaping @MainActor (TranslationSession) async throws -> T) async throws -> T {
    defer { forgetWhenIdle() }
    let key = standard ? "\(pairKey(source, target))>standard" : pairKey(source, target)
    let session = await session(for: key, source: source, target: target, standard: standard)
    do {
      return try await work(session)
    } catch {
      if sessions[key] === session { sessions[key] = nil }
      throw error
    }
  }

  private static func session(for key: String, source: String, target: String, standard: Bool) async -> TranslationSession {
    if let cached = sessions[key] { return cached }
    if let pending = making[key] { return await pending.value }
    let task = Task { @MainActor in await make(source: source, target: target, standard: standard) }
    making[key] = task
    let made = await task.value
    if making[key] == task { making[key] = nil }
    sessions[key] = made
    return made
  }

  private static func forgetWhenIdle() {
    uses += 1
    let use = uses
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(idleSeconds))
      if uses == use {
        sessions.removeAll()
        standardInstalledPairs.removeAll()
      }
    }
  }

  private static func make(source: String, target: String, standard: Bool) async -> TranslationSession {
    let from = Locale.Language(identifier: source), to = Locale.Language(identifier: target)
    if standard { return TranslationSession(installedSource: from, target: to) }
    if #available(macOS 26.4, *), await LanguageAvailability(preferredStrategy: .lowLatency).status(from: from, to: to) == .installed {
      lowLatencyPairs.insert(pairKey(source, target))
      return TranslationSession(installedSource: from, target: to, preferredStrategy: .lowLatency)
    }
    lowLatencyPairs.remove(pairKey(source, target))
    return TranslationSession(installedSource: from, target: to)
  }
}
