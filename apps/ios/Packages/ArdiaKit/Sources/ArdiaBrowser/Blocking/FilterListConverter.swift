import Foundation

public struct FilterConversion: Sendable, Equatable {
  public var json: String
  public var ruleCount: Int
  public var blockedDomains: [String]
  public var skippedLines: Int
}

public enum FilterListConverter {
  public static let webKitRuleLimit = 150_000
  static let selectorsPerRule = 250

  static let classicTypes = ["image", "style-sheet", "script", "font", "raw", "svg-document", "media", "popup", "ping"]

  struct Trigger: Encodable, Equatable {
    var urlFilter: String
    var resourceType: [String]?
    var loadType: [String]?
    var loadContext: [String]?
    var ifDomain: [String]?
    var unlessDomain: [String]?

    enum CodingKeys: String, CodingKey {
      case urlFilter = "url-filter"
      case resourceType = "resource-type"
      case loadType = "load-type"
      case loadContext = "load-context"
      case ifDomain = "if-domain"
      case unlessDomain = "unless-domain"
    }
  }

  struct Action: Encodable, Equatable {
    var type: String
    var selector: String?
  }

  struct Rule: Encodable, Equatable {
    var trigger: Trigger
    var action: Action
  }

  struct NetworkRule {
    var domain: String
    var trigger: Trigger
    var isGeneric: Bool
  }

  enum Line {
    case block(NetworkRule)
    case allow(NetworkRule)
    case allowDocument([String])
    case hide(selector: String, domains: [String], excluded: [String])
    case hideException(String)
    case skip
    case ignore
  }

  public static func convert(_ text: String, limit: Int = webKitRuleLimit) -> FilterConversion {
    var blocks: [Rule] = []
    var allows: [Rule] = []
    var documentAllows: [Rule] = []
    var genericSelectors: [String] = []
    var seenGeneric: Set<String> = []
    var scopedSelectors: [String: [String]] = [:]
    var scopedOrder: [String] = []
    var scopedRules: [(selector: String, domains: [String], excluded: [String])] = []
    var exceptions: Set<String> = []
    var blockedDomains: [String] = []
    var seenBlocks: Set<String> = []
    var skipped = 0

    text.enumerateLines { raw, _ in
      switch parse(raw) {
      case .ignore:
        break
      case .skip:
        skipped += 1
      case .block(let rule):
        let key = "\(rule.trigger)"
        guard seenBlocks.insert(key).inserted else { return }
        blocks.append(Rule(trigger: rule.trigger, action: Action(type: "block")))
        if rule.isGeneric { blockedDomains.append(rule.domain) }
      case .allow(let rule):
        allows.append(Rule(trigger: rule.trigger, action: Action(type: "ignore-previous-rules")))
      case .allowDocument(let domains):
        documentAllows.append(Rule(trigger: Trigger(urlFilter: ".*", ifDomain: domains.map { "*" + $0 }), action: Action(type: "ignore-previous-rules")))
      case .hide(let selector, let domains, let excluded):
        if domains.isEmpty && excluded.isEmpty {
          if seenGeneric.insert(selector).inserted { genericSelectors.append(selector) }
        } else if excluded.isEmpty {
          let key = domains.sorted().joined(separator: ",")
          if scopedSelectors[key] == nil { scopedOrder.append(key) }
          scopedSelectors[key, default: []].append(selector)
        } else {
          scopedRules.append((selector, domains, excluded))
        }
      case .hideException(let selector):
        exceptions.insert(selector)
      }
    }

    var rules: [Rule] = []
    let room = { limit - rules.count }
    rules += blocks.prefix(max(0, room()))
    rules += allows.prefix(max(0, room()))
    let generic = genericSelectors.filter { !exceptions.contains($0) }
    for start in stride(from: 0, to: generic.count, by: selectorsPerRule) where room() > 0 {
      let batch = generic[start..<min(start + selectorsPerRule, generic.count)]
      rules.append(Rule(trigger: Trigger(urlFilter: ".*"), action: Action(type: "css-display-none", selector: batch.joined(separator: ", "))))
    }
    for key in scopedOrder where room() > 0 {
      let selectors = (scopedSelectors[key] ?? []).filter { !exceptions.contains($0) }
      guard !selectors.isEmpty else { continue }
      let domains = key.split(separator: ",").map { "*" + $0 }
      for start in stride(from: 0, to: selectors.count, by: selectorsPerRule) where room() > 0 {
        let batch = selectors[start..<min(start + selectorsPerRule, selectors.count)]
        rules.append(Rule(trigger: Trigger(urlFilter: ".*", ifDomain: domains), action: Action(type: "css-display-none", selector: batch.joined(separator: ", "))))
      }
    }
    for scoped in scopedRules where room() > 0 && !exceptions.contains(scoped.selector) {
      rules.append(Rule(trigger: Trigger(urlFilter: ".*", unlessDomain: scoped.excluded.map { "*" + $0 }), action: Action(type: "css-display-none", selector: scoped.selector)))
    }
    rules += documentAllows.prefix(max(0, room()))

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let data = (try? encoder.encode(rules)) ?? Data("[]".utf8)
    return FilterConversion(json: String(decoding: data, as: UTF8.self), ruleCount: rules.count, blockedDomains: blockedDomains, skippedLines: skipped)
  }

  static func parse(_ raw: String) -> Line {
    let line = raw.trimmingCharacters(in: .whitespaces)
    if line.isEmpty || line.hasPrefix("!") || line.hasPrefix("[") { return .ignore }
    if let cosmetic = parseCosmetic(line) { return cosmetic }
    return parseNetwork(line)
  }

  static func parseCosmetic(_ line: String) -> Line? {
    let unsupported = ["#?#", "#$#", "#%#", "#@?#", "#@$#", "#@%#", "##+js(", "##^", "#$?#", "#@$?#"]
    if unsupported.contains(where: line.contains) { return .skip }
    let isException: Bool
    let range: Range<String.Index>
    if let found = line.range(of: "#@#") {
      isException = true
      range = found
    } else if let found = line.range(of: "##") {
      isException = false
      range = found
    } else {
      return nil
    }
    let selector = String(line[range.upperBound...]).trimmingCharacters(in: .whitespaces)
    guard isValidSelector(selector) else { return .skip }
    if isException { return .hideException(selector) }
    var domains: [String] = []
    var excluded: [String] = []
    for part in line[..<range.lowerBound].split(separator: ",") {
      let entry = part.trimmingCharacters(in: .whitespaces)
      let negative = entry.hasPrefix("~")
      guard let domain = normalizeDomain(negative ? String(entry.dropFirst()) : entry) else { return .skip }
      if negative { excluded.append(domain) } else { domains.append(domain) }
    }
    if !domains.isEmpty && !excluded.isEmpty { return .skip }
    return .hide(selector: selector, domains: domains, excluded: excluded)
  }

  static func parseNetwork(_ line: String) -> Line {
    var body = Substring(line)
    let isException = body.hasPrefix("@@")
    if isException { body = body.dropFirst(2) }
    guard body.hasPrefix("||") else { return .skip }
    body = body.dropFirst(2)
    var options: [String] = []
    if let dollar = body.lastIndex(of: "$") {
      options = body[body.index(after: dollar)...].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
      body = body[..<dollar]
    }
    let end = body.firstIndex { "^/*|:?".contains($0) } ?? body.endIndex
    let rest = body[end...]
    guard rest.isEmpty || rest == "^" || rest == "^|" || rest == "|" else { return .skip }
    guard let domain = normalizeDomain(String(body[..<end])) else { return .skip }

    var trigger = Trigger(urlFilter: "^[^:]+://+([^:/]+\\.)?" + domain.replacingOccurrences(of: ".", with: "\\.") + "[:/]")
    var included: [String] = []
    var negated: Set<String> = []
    var isDocument = false
    var isGeneric = true
    for option in options {
      let negative = option.hasPrefix("~")
      let name = negative ? String(option.dropFirst()) : option
      switch name {
      case "third-party", "3p":
        trigger.loadType = [negative ? "first-party" : "third-party"]
      case "first-party", "1p":
        trigger.loadType = [negative ? "third-party" : "first-party"]
      case "match-case", "important", "all":
        break
      case "document", "doc", "elemhide", "ehide":
        guard !negative else { return .skip }
        isDocument = true
      case "subdocument", "frame":
        if negative { negated.insert("document") } else {
          included.append("document")
          trigger.loadContext = ["child-frame"]
        }
      default:
        if name.hasPrefix("domain=") || name.hasPrefix("from=") {
          guard !negative else { return .skip }
          var ifDomain: [String] = []
          var unlessDomain: [String] = []
          for entry in name.drop(while: { $0 != "=" }).dropFirst().split(separator: "|") {
            let off = entry.hasPrefix("~")
            guard let value = normalizeDomain(String(off ? entry.dropFirst() : entry)) else { return .skip }
            if off { unlessDomain.append("*" + value) } else { ifDomain.append("*" + value) }
          }
          if !ifDomain.isEmpty && !unlessDomain.isEmpty { return .skip }
          trigger.ifDomain = ifDomain.isEmpty ? nil : ifDomain
          trigger.unlessDomain = unlessDomain.isEmpty ? nil : unlessDomain
          isGeneric = false
        } else if let type = resourceType(name) {
          if negative { negated.insert(type) } else { included.append(type) }
        } else {
          return .skip
        }
      }
    }
    if isDocument {
      guard isException, included.isEmpty, trigger.ifDomain == nil, trigger.unlessDomain == nil else { return .skip }
      return .allowDocument([domain])
    }
    if !negated.isEmpty {
      guard included.isEmpty else { return .skip }
      included = classicTypes.filter { !negated.contains($0) }
      if !negated.contains("document") {
        included.append("document")
        trigger.loadContext = ["child-frame"]
      }
    }
    if !included.isEmpty {
      var unique: [String] = []
      for type in included where !unique.contains(type) { unique.append(type) }
      if trigger.loadContext != nil, unique != ["document"] { trigger.loadContext = nil; unique.removeAll { $0 == "document" } }
      guard !unique.isEmpty else { return .skip }
      trigger.resourceType = unique
    }
    let rule = NetworkRule(domain: domain, trigger: trigger, isGeneric: isGeneric)
    return isException ? .allow(rule) : .block(rule)
  }

  static func resourceType(_ option: String) -> String? {
    switch option {
    case "script": "script"
    case "image": "image"
    case "stylesheet", "css": "style-sheet"
    case "font": "font"
    case "media": "media"
    case "popup": "popup"
    case "ping", "beacon": "ping"
    case "xmlhttprequest", "xhr", "websocket", "other", "object": "raw"
    default: nil
    }
  }

  static func normalizeDomain(_ raw: String) -> String? {
    var value = raw.lowercased()
    if value.hasSuffix(".") { value.removeLast() }
    guard !value.isEmpty, value.count <= 253, !value.hasPrefix("."), !value.contains("..") else { return nil }
    guard value.contains("."), value.allSatisfy({ ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "." || $0 == "-" }) else { return nil }
    return value
  }

  static let allowedPseudoClasses: Set<String> = [
    "not", "nth-child", "nth-of-type", "nth-last-child", "nth-last-of-type", "first-child", "last-child", "only-child",
    "first-of-type", "last-of-type", "only-of-type", "empty", "root", "is", "where", "link", "visited", "checked",
  ]

  static func isValidSelector(_ selector: String) -> Bool {
    guard !selector.isEmpty, selector.count <= 2000 else { return false }
    if selector.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) { return false }
    if selector.contains("{") || selector.contains("}") || selector.contains("\\") || selector.hasPrefix(",") || selector.hasSuffix(",") { return false }
    var depth = 0
    var bracket = 0
    var quote: Character?
    let characters = Array(selector)
    var index = 0
    while index < characters.count {
      let character = characters[index]
      if let open = quote {
        if character == open { quote = nil }
        index += 1
        continue
      }
      switch character {
      case "\"", "'":
        guard bracket > 0 else { return false }
        quote = character
      case "[": bracket += 1
      case "]":
        bracket -= 1
        if bracket < 0 { return false }
      case "(": depth += 1
      case ")":
        depth -= 1
        if depth < 0 { return false }
      case ":" where bracket == 0:
        var end = index + 1
        if end < characters.count, characters[end] == ":" { return false }
        while end < characters.count, characters[end].isLetter || characters[end] == "-" { end += 1 }
        let name = String(characters[(index + 1)..<end]).lowercased()
        guard allowedPseudoClasses.contains(name) else { return false }
        index = end
        continue
      default:
        break
      }
      index += 1
    }
    return depth == 0 && bracket == 0 && quote == nil
  }
}
