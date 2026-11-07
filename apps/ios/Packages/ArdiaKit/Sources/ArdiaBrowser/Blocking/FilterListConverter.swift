import Foundation

public struct FilterConversion: Sendable, Equatable {
  public var json: String
  public var ruleCount: Int
  public var blockedDomains: [String]
  public var skippedLines: Int
}

public struct ParsedFilterList: Sendable {
  public var id: String
  public var convertedLines: Int
  public var skippedLines: Int
  var blocks: [FilterListConverter.KeyedRule] = []
  var important: [FilterListConverter.KeyedRule] = []
  var allows: [FilterListConverter.AllowRule] = []
  var documentAllows: [FilterListConverter.Rule] = []
  var genericSelectors: [String] = []
  var scopedSelectors: [String: [String]] = [:]
  var scopedOrder: [String] = []
  var excludedSelectors: [(selector: String, excluded: [String])] = []
  var selectorExceptions: Set<String> = []
  var badfilters: Set<String> = []
  var blockedDomains: [String] = []
}

public struct FilterChunk: Sendable, Equatable {
  public var listID: String
  public var index: Int
  public var json: String
  public var ruleCount: Int
}

public enum FilterListConverter {
  public static let webKitRuleLimit = 150_000
  static let selectorsPerRule = 250
  static let classicTypes = ["image", "style-sheet", "script", "font", "raw", "svg-document", "media", "popup", "ping"]
  static let separatorClass = "[^a-zA-Z0-9_.%-]"

  struct Trigger: Encodable, Equatable, Sendable {
    var urlFilter: String
    var caseSensitive: Bool?
    var resourceType: [String]?
    var loadType: [String]?
    var loadContext: [String]?
    var ifDomain: [String]?
    var unlessDomain: [String]?

    enum CodingKeys: String, CodingKey {
      case urlFilter = "url-filter"
      case caseSensitive = "url-filter-is-case-sensitive"
      case resourceType = "resource-type"
      case loadType = "load-type"
      case loadContext = "load-context"
      case ifDomain = "if-domain"
      case unlessDomain = "unless-domain"
    }
  }

  struct Action: Encodable, Equatable, Sendable {
    var type: String
    var selector: String?
  }

  struct Rule: Encodable, Equatable, Sendable {
    var trigger: Trigger
    var action: Action
  }

  struct KeyedRule: Sendable {
    var key: String
    var rule: Rule
    var host: String?
  }

  struct AllowRule: Sendable {
    var rule: Rule
    var host: String?
  }

  static func anchorHost(_ pattern: Substring) -> String? {
    guard pattern.hasPrefix("||") else { return nil }
    let rest = pattern.dropFirst(2)
    let end = rest.utf8.firstIndex { hostStops.contains($0) } ?? rest.endIndex
    return normalizeDomain(String(rest[..<end]))
  }

  static func suffixes(of host: String) -> [Substring] {
    var result: [Substring] = [Substring(host)]
    var rest = Substring(host)
    while let dot = rest.firstIndex(of: ".") {
      rest = rest[rest.index(after: dot)...]
      if rest.contains(".") { result.append(rest) }
    }
    return result
  }

  static func relevantAllows(_ allows: [AllowRule], for blocks: [KeyedRule]) -> [Rule] {
    guard !allows.isEmpty, !blocks.isEmpty else { return [] }
    if blocks.contains(where: { $0.host == nil }) { return allows.map(\.rule) }
    var blockHosts: Set<Substring> = []
    var blockSuffixes: Set<Substring> = []
    for block in blocks {
      guard let host = block.host else { continue }
      blockHosts.insert(Substring(host))
      for suffix in suffixes(of: host) { blockSuffixes.insert(suffix) }
    }
    return allows.compactMap { allow in
      guard let host = allow.host else { return nil }
      if blockSuffixes.contains(Substring(host)) { return allow.rule }
      return suffixes(of: host).contains(where: blockHosts.contains) ? allow.rule : nil
    }
  }

  public static func convert(_ text: String, limit: Int = webKitRuleLimit) -> FilterConversion {
    let parsed = parse(text, id: "list")
    let chunks = build([parsed], limit: limit, maxChunksPerList: 1)
    let chunk = chunks.first ?? FilterChunk(listID: "list", index: 0, json: "[]", ruleCount: 0)
    return FilterConversion(json: chunk.json, ruleCount: chunk.ruleCount, blockedDomains: parsed.blockedDomains, skippedLines: parsed.skippedLines)
  }

  public static func parse(_ text: String, id: String) -> ParsedFilterList {
    var list = ParsedFilterList(id: id, convertedLines: 0, skippedLines: 0)
    var seenBlocks: Set<String> = []
    var seenGeneric: Set<String> = []
    text.enumerateLines { raw, _ in
      let bytes = raw.utf8
      let line = bytes.first == 0x20 || bytes.first == 0x09 || bytes.last == 0x20 || bytes.last == 0x09 || bytes.last == 0x0D
        ? raw.trimmingCharacters(in: .whitespacesAndNewlines) : raw
      if line.isEmpty || line.hasPrefix("!") || line.hasPrefix("[") { return }
      if line.hasPrefix("#"), !line.hasPrefix("##"), !line.hasPrefix("#@#"), !line.hasPrefix("#?#"), !line.hasPrefix("#$#") { return }
      if let host = hostsFileDomain(line) {
        list.convertedLines += 1
        let filter = "||\(host)^"
        if seenBlocks.insert(filter).inserted {
          list.blocks.append(KeyedRule(key: filter, rule: Rule(trigger: Trigger(urlFilter: hostPrefix(host) + "[:/]"), action: Action(type: "block")), host: host))
          list.blockedDomains.append(host)
        }
        return
      }
      if line.utf8.contains(0x23), let cosmetic = parseCosmetic(line) {
        switch cosmetic {
        case .skip:
          list.skippedLines += 1
        case .exception(let selector):
          list.convertedLines += 1
          list.selectorExceptions.insert(selector)
        case .hide(let selector, let domains, let excluded):
          list.convertedLines += 1
          if domains.isEmpty && excluded.isEmpty {
            if seenGeneric.insert(selector).inserted { list.genericSelectors.append(selector) }
          } else if !domains.isEmpty {
            let key = domains.sorted().joined(separator: ",")
            if list.scopedSelectors[key] == nil { list.scopedOrder.append(key) }
            list.scopedSelectors[key, default: []].append(selector)
          } else {
            list.excludedSelectors.append((selector, excluded))
          }
        }
        return
      }
      switch parseNetwork(line) {
      case .skip:
        list.skippedLines += 1
      case .badfilter(let key):
        list.convertedLines += 1
        list.badfilters.insert(key)
      case .block(let key, let trigger, let domain, let important, let host):
        list.convertedLines += 1
        guard seenBlocks.insert(key).inserted else { return }
        let rule = KeyedRule(key: key, rule: Rule(trigger: trigger, action: Action(type: "block")), host: host)
        if important { list.important.append(rule) } else { list.blocks.append(rule) }
        if let domain { list.blockedDomains.append(domain) }
      case .allow(let trigger, let host):
        list.convertedLines += 1
        list.allows.append(AllowRule(rule: Rule(trigger: trigger, action: Action(type: "ignore-previous-rules")), host: host))
      case .allowDocument(let domain):
        list.convertedLines += 1
        list.documentAllows.append(Rule(trigger: Trigger(urlFilter: ".*", ifDomain: ["*" + domain]), action: Action(type: "ignore-previous-rules")))
      }
    }
    return list
  }

  public static func build(_ lists: [ParsedFilterList], limit: Int = webKitRuleLimit, maxChunksPerList: Int = 8, ownerID: String? = nil) -> [FilterChunk] {
    let badfilters = lists.reduce(into: Set<String>()) { $0.formUnion($1.badfilters) }
    let ownerExceptions = lists.first { $0.id == ownerID }?.selectorExceptions ?? []
    let sharedExceptions = lists.filter { $0.id != ownerID }.reduce(into: Set<String>()) { $0.formUnion($1.selectorExceptions) }
    let allows = lists.filter { $0.id != ownerID }.flatMap(\.allows)
    let ownerAllows = lists.first { $0.id == ownerID }?.allows ?? []
    let ownerAllowRules = ownerAllows.map(\.rule)
    let documentAllows = lists.flatMap(\.documentAllows)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]

    var chunks: [FilterChunk] = []
    for list in lists {
      let isOwner = list.id == ownerID
      let keyedBlocks = list.blocks.filter { !badfilters.contains($0.key) }
      let blocks = keyedBlocks.map(\.rule)
      let important = list.important.filter { !badfilters.contains($0.key) }.map(\.rule)
      let exceptions = isOwner ? ownerExceptions : sharedExceptions.union(ownerExceptions)
      var hides: [Rule] = []
      let generic = list.genericSelectors.filter { !exceptions.contains($0) }
      for start in stride(from: 0, to: generic.count, by: selectorsPerRule) {
        let batch = generic[start..<min(start + selectorsPerRule, generic.count)]
        hides.append(Rule(trigger: Trigger(urlFilter: ".*"), action: Action(type: "css-display-none", selector: batch.joined(separator: ", "))))
      }
      for key in list.scopedOrder {
        let selectors = (list.scopedSelectors[key] ?? []).filter { !exceptions.contains($0) }
        let domains = key.split(separator: ",").map { "*" + $0 }
        for start in stride(from: 0, to: selectors.count, by: selectorsPerRule) {
          let batch = selectors[start..<min(start + selectorsPerRule, selectors.count)]
          hides.append(Rule(trigger: Trigger(urlFilter: ".*", ifDomain: domains), action: Action(type: "css-display-none", selector: batch.joined(separator: ", "))))
        }
      }
      for scoped in list.excludedSelectors where !exceptions.contains(scoped.selector) {
        hides.append(Rule(trigger: Trigger(urlFilter: ".*", unlessDomain: scoped.excluded.map { "*" + $0 }), action: Action(type: "css-display-none", selector: scoped.selector)))
      }

      let body = blocks + hides
      guard !body.isEmpty || !important.isEmpty || (isOwner && !(ownerAllows.isEmpty && documentAllows.isEmpty)) else { continue }
      let reserve = min(limit / 2, (isOwner ? allows.count : allows.count + ownerAllows.count) + important.count + documentAllows.count)
      let room = max(1, limit - reserve)
      let pieces = body.isEmpty ? 1 : min(maxChunksPerList, (body.count + room - 1) / room)
      for index in 0..<pieces {
        let range = body.isEmpty ? 0..<0 : (index * room)..<min((index + 1) * room, body.count)
        let slice = Array(body[range])
        let sliceBlocks = Array(keyedBlocks[min(range.lowerBound, keyedBlocks.count)..<min(range.upperBound, keyedBlocks.count)]) + list.important
        let head = isOwner ? relevantAllows(allows, for: sliceBlocks) : []
        let tail = (isOwner ? ownerAllowRules : relevantAllows(allows + ownerAllows, for: sliceBlocks)) + important + documentAllows
        let rules = Array((head + slice + tail).prefix(limit))
        guard let data = try? encoder.encode(rules) else { continue }
        chunks.append(FilterChunk(listID: list.id, index: index, json: String(decoding: data, as: UTF8.self), ruleCount: rules.count))
      }
    }
    return chunks
  }

  enum Cosmetic {
    case hide(selector: String, domains: [String], excluded: [String])
    case exception(String)
    case skip
  }

  enum Network {
    case block(key: String, trigger: Trigger, domain: String?, important: Bool, host: String?)
    case allow(Trigger, host: String?)
    case allowDocument(String)
    case badfilter(String)
    case skip
  }

  static func hostsFileDomain(_ line: String) -> String? {
    guard let first = line.first, first.isNumber || first == ":" else { return nil }
    let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
    guard parts.count >= 2, ["0.0.0.0", "127.0.0.1", "::", "::1", "0"].contains(String(parts[0])) else { return nil }
    let host = String(parts[1]).lowercased()
    guard !["localhost", "localhost.localdomain", "local", "broadcasthost", "0.0.0.0", "ip6-localhost"].contains(host) else { return nil }
    return normalizeDomain(host)
  }

  static func parseCosmetic(_ line: String) -> Cosmetic? {
    let unsupported = ["#?#", "#$#", "#%#", "#@?#", "#@$#", "#@%#", "##+js(", "#@#+js(", "##^", "#@#^", "#$?#", "#@$?#"]
    let isException: Bool
    let range: Range<String.Index>
    if let found = line.range(of: "#@#") {
      isException = true
      range = found
    } else if let found = line.range(of: "##") {
      isException = false
      range = found
    } else {
      return unsupported.contains(where: line.contains) ? .skip : nil
    }
    if unsupported.contains(where: line.contains) { return .skip }
    let selector = String(line[range.upperBound...]).trimmingCharacters(in: .whitespaces)
    guard isValidSelector(selector) else { return .skip }
    var domains: [String] = []
    var excluded: [String] = []
    for part in line[..<range.lowerBound].split(separator: ",") {
      let entry = part.trimmingCharacters(in: .whitespaces)
      let negative = entry.hasPrefix("~")
      guard let domain = normalizeDomain(negative ? String(entry.dropFirst()) : entry) else { return .skip }
      if negative { excluded.append(domain) } else { domains.append(domain) }
    }
    if isException { return .exception(selector) }
    if !domains.isEmpty { excluded = [] }
    return .hide(selector: selector, domains: domains, excluded: excluded)
  }

  static let skippedOptions: Set<String> = [
    "csp", "removeparam", "queryprune", "redirect-rule", "rewrite", "replace", "header", "permissions", "urltransform", "uritransform",
    "method", "to", "denyallow", "sitekey", "genericblock", "generichide", "ghide", "specifichide", "shide", "cookie", "hls", "jsonprune",
    "network", "app", "stealth", "urlskip", "inline-script", "inline-font", "strict1p", "strict3p", "strict-first-party", "strict-third-party",
    "cname", "ipaddress", "popunder", "webrtc", "object-subrequest", "doc-elemhide", "content", "extension", "jsinject", "xmlprune",
  ]

  static func parseNetwork(_ line: String) -> Network {
    var body = Substring(line)
    let isException = body.hasPrefix("@@")
    if isException { body = body.dropFirst(2) }
    var options: [String] = []
    if let dollar = body.lastIndex(of: "$") {
      let tail = body[body.index(after: dollar)...]
      if !tail.isEmpty, tail.utf8.allSatisfy(Self.isOptionByte) {
        options = tail.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        body = body[..<dollar]
      }
    }
    if body.utf8.contains(where: { $0 == 0x20 || $0 == 0x09 }) { return .skip }
    if options.contains("badfilter") {
      let rest = options.filter { $0 != "badfilter" }
      return .badfilter(filterKey(isException: isException, pattern: body, options: rest))
    }

    let key = filterKey(isException: isException, pattern: body, options: options)
    guard var (trigger, domain) = urlFilter(for: body) else { return .skip }
    var included: [String] = []
    var negated: Set<String> = []
    var isDocument = false
    var important = false
    for option in options {
      let negative = option.hasPrefix("~")
      let name = negative ? String(option.dropFirst()) : option
      let base = name.split(separator: "=", maxSplits: 1).first.map(String.init) ?? name
      switch base {
      case "third-party", "3p":
        trigger.loadType = [negative ? "first-party" : "third-party"]
      case "first-party", "1p":
        trigger.loadType = [negative ? "third-party" : "first-party"]
      case "match-case":
        trigger.caseSensitive = true
      case "important":
        important = true
      case "all", "redirect", "empty", "mp4":
        if negative { return .skip }
      case "document", "doc":
        if negative { negated.insert("document") } else { isDocument = true }
      case "elemhide", "ehide":
        return .skip
      case "subdocument", "frame":
        if negative { negated.insert("document") } else {
          included.append("document")
          trigger.loadContext = ["child-frame"]
        }
      case "domain", "from":
        guard !negative, let value = name.split(separator: "=", maxSplits: 1).last, name.contains("=") else { return .skip }
        var ifDomain: [String] = []
        var unlessDomain: [String] = []
        for entry in value.split(separator: "|") {
          let off = entry.hasPrefix("~")
          guard let normalized = normalizeDomain(String(off ? entry.dropFirst() : entry)) else { return .skip }
          if off { unlessDomain.append("*" + normalized) } else { ifDomain.append("*" + normalized) }
        }
        if !ifDomain.isEmpty { unlessDomain = [] }
        trigger.ifDomain = ifDomain.isEmpty ? nil : ifDomain
        trigger.unlessDomain = unlessDomain.isEmpty ? nil : unlessDomain
      default:
        if skippedOptions.contains(base) { return .skip }
        guard let type = resourceType(base) else { return .skip }
        if negative { negated.insert(type) } else { included.append(type) }
      }
    }
    if isDocument && isException {
      guard included.isEmpty, trigger.ifDomain == nil, trigger.unlessDomain == nil, let domain else { return .skip }
      return .allowDocument(domain)
    }
    if isDocument {
      included.append("document")
      trigger.loadContext = nil
    }
    if !negated.isEmpty {
      guard included.isEmpty else { return .skip }
      included = classicTypes.filter { !negated.contains($0) }
    }
    if !included.isEmpty {
      var unique: [String] = []
      for type in included where !unique.contains(type) { unique.append(type) }
      if trigger.loadContext != nil, unique != ["document"] {
        trigger.loadContext = nil
        unique.removeAll { $0 == "document" }
      }
      guard !unique.isEmpty else { return .skip }
      trigger.resourceType = unique
    }
    let unrestricted = trigger.urlFilter == ".*" && trigger.ifDomain == nil && trigger.resourceType == nil
    if unrestricted && !isException { return .skip }
    let generic = trigger.ifDomain == nil && trigger.unlessDomain == nil && trigger.resourceType == nil
    let host = anchorHost(body)
    if isException { return .allow(trigger, host: host) }
    return .block(key: key, trigger: trigger, domain: generic ? domain : nil, important: important, host: host)
  }

  static func filterKey(isException: Bool, pattern: Substring, options: [String]) -> String {
    (isException ? "@@" : "") + pattern + (options.isEmpty ? "" : "$" + options.joined(separator: ","))
  }

  static func hostPrefix(_ host: String) -> String {
    "^[^:]+://+([^:/]+\\.)?" + escapeLiteral(host)
  }

  static let regexSpecials: Set<UInt8> = Set(".?+(){}[]\\$|^*".utf8)
  static let optionPunctuation: Set<UInt8> = Set(",=|~._-*".utf8)
  static let hostStops: Set<UInt8> = Set("^/*|?:$".utf8)

  static func isOptionByte(_ byte: UInt8) -> Bool {
    (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x30 && byte <= 0x39) || optionPunctuation.contains(byte)
  }

  static func escapeLiteral(_ text: some StringProtocol) -> String {
    var out: [UInt8] = []
    out.reserveCapacity(text.utf8.count + 8)
    for byte in text.utf8 {
      if regexSpecials.contains(byte) { out.append(0x5C) }
      out.append(byte)
    }
    return String(decoding: out, as: UTF8.self)
  }

  static func urlFilter(for pattern: Substring) -> (Trigger, String?)? {
    guard pattern.utf8.allSatisfy({ $0 < 0x80 }) else { return nil }
    if pattern.hasPrefix("/"), pattern.count > 2, pattern.hasSuffix("/") {
      guard let regex = webKitRegex(String(pattern.dropFirst().dropLast())) else { return nil }
      return (Trigger(urlFilter: regex), nil)
    }
    var rest = pattern
    var prefix = ""
    var domain: String?
    if rest.hasPrefix("||") {
      rest = rest.dropFirst(2)
      let end = rest.utf8.firstIndex { hostStops.contains($0) } ?? rest.endIndex
      guard let host = normalizeDomain(String(rest[..<end])) else { return nil }
      prefix = hostPrefix(host)
      rest = rest[end...]
      if rest.isEmpty || rest == "^" || rest == "^|" {
        domain = host
        return (Trigger(urlFilter: prefix + "[:/]"), domain)
      }
    } else if rest.hasPrefix("|") {
      rest = rest.dropFirst()
      prefix = "^"
    } else if rest.count < 4, !rest.contains("*") {
      return nil
    }
    var anchoredEnd = false
    if rest.hasSuffix("|") {
      rest = rest.dropLast()
      anchoredEnd = true
    }
    var body = ""
    let bytes = Array(rest.utf8)
    for (index, byte) in bytes.enumerated() {
      switch byte {
      case 0x2A:
        body += ".*"
      case 0x5E:
        if index < bytes.count - 1 || anchoredEnd { body += separatorClass }
      case 0x7C:
        return nil
      default:
        if regexSpecials.contains(byte) { body.append("\\") }
        body.unicodeScalars.append(Unicode.Scalar(byte))
      }
    }
    if anchoredEnd { body += "$" }
    var filter = prefix + body
    while filter.hasPrefix(".*") { filter.removeFirst(2) }
    while filter.hasSuffix(".*") && !filter.hasSuffix("\\.*") { filter.removeLast(2) }
    if filter.isEmpty { filter = ".*" }
    return (Trigger(urlFilter: filter), domain)
  }

  static func webKitRegex(_ source: String) -> String? {
    guard source.allSatisfy(\.isASCII), !source.isEmpty else { return nil }
    var out = ""
    var inClass = false
    let characters = Array(source)
    var index = 0
    while index < characters.count {
      let character = characters[index]
      if character == "\\" {
        guard index + 1 < characters.count else { return nil }
        let next = characters[index + 1]
        switch next {
        case "d":
          out += inClass ? "0-9" : "[0-9]"
        case "w":
          out += inClass ? "A-Za-z0-9_" : "[A-Za-z0-9_]"
        case "/", ".", "?", "+", "*", "(", ")", "[", "]", "^", "$", "|", "{", "}", "\\", "-", "=", "&", ":", "%", "_", "#", "!", ",", ";", "@", "~", "'", "\"":
          out += "\\" + String(next)
        default:
          return nil
        }
        index += 2
        continue
      }
      if inClass {
        if character == "]" { inClass = false }
        if character == "[" { return nil }
        out.append(character)
        index += 1
        continue
      }
      switch character {
      case "[":
        inClass = true
        out.append(character)
      case "|", "{", "}":
        return nil
      case "(":
        if index + 1 < characters.count, characters[index + 1] == "?" {
          guard index + 2 < characters.count, characters[index + 2] == ":" else { return nil }
          out.append("(")
          index += 3
          continue
        }
        out.append(character)
      case "*", "+", "?":
        if index + 1 < characters.count, characters[index + 1] == "?" { return nil }
        out.append(character)
      case "^":
        guard index == 0 else { return nil }
        out.append(character)
      case "$":
        guard index == characters.count - 1 else { return nil }
        out.append(character)
      default:
        out.append(character)
      }
      index += 1
    }
    return inClass ? nil : out
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
    var bytes = Array(raw.utf8)
    if bytes.last == 0x2E { bytes.removeLast() }
    guard !bytes.isEmpty, bytes.count <= 253, bytes.first != 0x2E else { return nil }
    var hasDot = false
    var previous: UInt8 = 0
    for index in bytes.indices {
      var byte = bytes[index]
      if byte >= 0x41 && byte <= 0x5A {
        byte += 0x20
        bytes[index] = byte
      }
      let valid = (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x30 && byte <= 0x39) || byte == 0x2D || byte == 0x2E
      guard valid, !(byte == 0x2E && previous == 0x2E) else { return nil }
      if byte == 0x2E { hasDot = true }
      previous = byte
    }
    return hasDot ? String(decoding: bytes, as: UTF8.self) : nil
  }

  static let allowedPseudoClasses: Set<String> = [
    "not", "nth-child", "nth-of-type", "nth-last-child", "nth-last-of-type", "first-child", "last-child", "only-child",
    "first-of-type", "last-of-type", "only-of-type", "empty", "root", "is", "where", "has", "link", "visited", "checked",
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
