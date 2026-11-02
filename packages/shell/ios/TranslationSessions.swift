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
    var pending: [(key: PassageKey, pieces: [String])] = []
    var asked = Set<PassageKey>()
    for (key, pieces) in zip(keys, blocks) where asked.insert(key).inserted {
      if let known = memo[key] { found[key] = known } else { pending.append((key, pieces)) }
    }
    await translatePassages(source: source, target: target, standard: false, pending, into: &found)
    let unchanged = pending.filter { passage in
      guard let parts = found[passage.key] else { return true }
      return TranslateModule.isUnchanged(parts, from: passage.pieces)
    }
    if !unchanged.isEmpty, lowLatencyPairs.contains(pairKey(source, target)),
      await LanguageAvailability().status(from: Locale.Language(identifier: source), to: Locale.Language(identifier: target)) == .installed
    {
      await translatePassages(source: source, target: target, standard: true, unchanged, into: &found)
    }
    for (key, pieces) in pending {
      if let parts = found[key], !TranslateModule.isUnchanged(parts, from: pieces) { remember(key, parts) }
    }
    return keys.map { found[$0] }
  }

  @available(macOS 26.4, *)
  private static func translatePassages(source: String, target: String, standard: Bool, _ passages: [(key: PassageKey, pieces: [String])], into found: inout [PassageKey: [String]]) async {
    var answered = Set<PassageKey>()
    let single = passages.filter { $0.pieces.count == 1 }
    if !single.isEmpty {
      let requests = single.enumerated().map { TranslationSession.Request(sourceText: $0.element.pieces[0], clientIdentifier: String($0.offset)) }
      for response in (try? await translations(source: source, target: target, standard: standard, requests)) ?? [] {
        guard let i = response.clientIdentifier.flatMap(Int.init), single.indices.contains(i) else { continue }
        let parts = [response.targetText]
        if found[single[i].key] == nil || !TranslateModule.isUnchanged(parts, from: single[i].pieces) { found[single[i].key] = parts }
        answered.insert(single[i].key)
      }
    }
    for (key, pieces) in passages where !answered.contains(key) {
      let text = TranslateModule.linkedPieces(pieces)
      guard let translated = try? await run(source: source, target: target, standard: standard, { try await $0.translate(text).attributedTargetText }),
        let parts = TranslateModule.parts(of: translated, over: pieces)
      else { continue }
      if found[key] == nil || !TranslateModule.isUnchanged(parts, from: pieces) { found[key] = parts }
    }
  }

  private static func pairKey(_ source: String, _ target: String) -> String { "\(source)>\(target)" }

  private static func remember(_ key: PassageKey, _ parts: [String]) {
    if memo.count >= memoLimit { memo.removeAll() }
    memo[key] = parts
  }

  private static func run<T: Sendable>(source: String, target: String, standard: Bool = false, _ work: @escaping @MainActor (TranslationSession) async throws -> T) async throws -> T {
    let previous = tail
    let task = Task { @MainActor () async throws -> T in
      await previous?.value
      let key = standard ? "\(pairKey(source, target))>standard" : pairKey(source, target)
      let session: TranslationSession
      if let cached = sessions[key] {
        session = cached
      } else {
        session = await make(source: source, target: target, standard: standard)
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
