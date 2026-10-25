import Foundation

public struct TextBlock: Sendable, Codable, Hashable {
  public enum Kind: String, Sendable, Codable, Hashable {
    case heading
    case paragraph
    case listItem
    case quote
  }

  public var kind: Kind
  public var text: String
  public var group: Int

  public init(kind: Kind, text: String, group: Int = 0) {
    self.kind = kind
    self.text = text
    self.group = group
  }
}

public struct ReadablePage: Sendable, Codable, Hashable {
  public var url: URL
  public var title: String
  public var siteName: String
  public var summary: String?
  public var imageURL: URL?
  public var iconURL: URL?
  public var language: String?
  public var blocks: [TextBlock]

  public init(
    url: URL, title: String, siteName: String, summary: String? = nil, imageURL: URL? = nil, iconURL: URL? = nil,
    language: String? = nil, blocks: [TextBlock]
  ) {
    self.url = url
    self.title = title
    self.siteName = siteName
    self.summary = summary
    self.imageURL = imageURL
    self.iconURL = iconURL
    self.language = language
    self.blocks = blocks
  }

  public var text: String {
    blocks.map(\.text).joined(separator: "\n")
  }

  public var wordCount: Int {
    blocks.reduce(0) { $0 + $1.text.split(whereSeparator: \.isWhitespace).count }
  }

  public var hasReadableText: Bool {
    wordCount >= 60 || blocks.reduce(0) { $0 + $1.text.count } >= 280
  }
}

enum ReadableExtractor {
  static let characterCap = 40_000

  private static let skippedElements: Set<String> = [
    "script", "style", "noscript", "template", "svg", "nav", "footer", "aside", "form", "button", "iframe",
    "select", "option", "dialog", "menu", "canvas", "video", "audio", "picture", "object", "embed", "label",
  ]
  private static let neverSkippedByClass: Set<String> = ["html", "body", "main", "article"]
  private static let boilerplateTokens: Set<String> = [
    "cookie", "cookies", "consent", "gdpr", "ccpa", "newsletter", "subscribe", "subscription", "signup", "share",
    "sharing", "social", "related", "recommended", "recommendations", "comment", "comments", "breadcrumb",
    "breadcrumbs", "promo", "advert", "advertisement", "ad", "ads", "adslot", "sponsored", "sponsor", "popup", "modal",
    "outbrain", "taboola", "paywall", "byline",
  ]
  private static let layoutTokens: Set<String> = [
    "sidebar", "overlay", "nav", "navbar", "navigation", "footer", "masthead", "skip", "toolbar", "tags", "banner",
    "jump", "menu",
  ]
  private static let hiddenRoles: Set<String> = [
    "navigation", "banner", "contentinfo", "complementary", "dialog", "alertdialog", "menu", "menubar", "search",
  ]
  private static let blockElements: Set<String> = [
    "p", "div", "section", "article", "main", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "dl", "dt", "dd",
    "blockquote", "pre", "table", "tr", "td", "th", "figure", "figcaption", "header", "footer", "aside", "nav", "form",
    "hr", "address", "details", "summary", "caption", "body", "html",
  ]
  private static let voidElements: Set<String> = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
  ]
  private static let boilerplatePhrases = [
    "we use cookies", "accept all", "cookie policy", "privacy policy", "all rights reserved", "sign up for",
    "subscribe to", "advertisement", "skip to content", "skip to main", "terms of use", "follow us",
    "share this", "this site uses cookies", "manage preferences", "enable javascript",
  ]

  private struct OpenElement {
    var name: String
    var skips: Bool
    var isContentRoot: Bool
    var isLink: Bool
  }

  private struct RawBlock {
    var kind: TextBlock.Kind
    var text: String
    var linkCharacters: Int
    var inContentRoot: Bool
    var group: Int
  }

  static func extract(html: String, url: URL) -> ReadablePage {
    extract(bytes: Array(html.utf8), url: url)
  }

  static func extract(bytes: [UInt8], url: URL) -> ReadablePage {
    let page = extract(bytes: bytes, url: url, skipsLayoutClasses: true)
    guard !page.hasReadableText else { return page }
    let lenient = extract(bytes: bytes, url: url, skipsLayoutClasses: false)
    return lenient.wordCount > page.wordCount * 2 ? lenient : page
  }

  private static func extract(bytes: [UInt8], url: URL, skipsLayoutClasses: Bool) -> ReadablePage {
    var metadata = Metadata()
    var stack: [OpenElement] = []
    var skipDepth = 0
    var contentRootDepth = 0
    var linkDepth = 0
    var buffer = ""
    var bufferLinkCharacters = 0
    var blocks: [RawBlock] = []
    var totalCharacters = 0
    var inTitle = false
    var documentTitle = ""
    var firstHeading: String?
    var firstContentImage: String?
    var listGroup = 0
    var listDepth = 0

    func blockKind() -> TextBlock.Kind {
      for element in stack.reversed() {
        switch element.name {
        case "h1", "h2", "h3", "h4", "h5", "h6": return .heading
        case "li", "dt", "dd": return .listItem
        case "blockquote": return .quote
        case let name where blockElements.contains(name): return .paragraph
        default: continue
        }
      }
      return .paragraph
    }

    func flush() {
      let text = collapseWhitespace(buffer)
      let links = bufferLinkCharacters
      buffer = ""
      bufferLinkCharacters = 0
      guard !text.isEmpty, totalCharacters < characterCap else { return }
      let kind = blockKind()
      if kind == .heading, firstHeading == nil { firstHeading = text }
      blocks.append(
        RawBlock(
          kind: kind, text: text, linkCharacters: links, inContentRoot: contentRootDepth > 0,
          group: kind == .listItem ? listGroup : 0))
      totalCharacters += text.count
    }

    for token in HTMLTokenizer(bytes) {
      switch token {
      case .start(let name, let attributes, let selfClosing):
        metadata.read(name: name, attributes: attributes)
        if name == "title" {
          inTitle = !selfClosing
          continue
        }
        if name == "img", skipDepth == 0, contentRootDepth > 0, firstContentImage == nil {
          firstContentImage = attributes["src"] ?? attributes["data-src"]
        }
        if name == "br" {
          buffer += " "
          continue
        }
        if voidElements.contains(name) || selfClosing { continue }
        if blockElements.contains(name), skipDepth == 0 { flush() }
        if name == "ul" || name == "ol" || name == "dl" {
          if listDepth == 0 { listGroup += 1 }
          listDepth += 1
        }
        let skips = shouldSkip(
          name: name, attributes: attributes, insideContentRoot: contentRootDepth > 0,
          skipsLayoutClasses: skipsLayoutClasses)
        let isContentRoot = isContentRoot(name: name, attributes: attributes)
        let isLink = name == "a"
        stack.append(OpenElement(name: name, skips: skips, isContentRoot: isContentRoot, isLink: isLink))
        if skips { skipDepth += 1 }
        if isContentRoot { contentRootDepth += 1 }
        if isLink { linkDepth += 1 }
      case .end(let name):
        if name == "title" {
          inTitle = false
          continue
        }
        guard let position = stack.lastIndex(where: { $0.name == name }) else { continue }
        while stack.count > position {
          if let innermost = stack.last, blockElements.contains(innermost.name), skipDepth == 0 { flush() }
          let element = stack.removeLast()
          if element.skips { skipDepth -= 1 }
          if element.isContentRoot { contentRootDepth -= 1 }
          if element.isLink { linkDepth -= 1 }
          if element.name == "ul" || element.name == "ol" || element.name == "dl" { listDepth = max(0, listDepth - 1) }
        }
      case .text(let text):
        if inTitle {
          documentTitle += text
          continue
        }
        guard skipDepth == 0 else { continue }
        buffer += text
        if linkDepth > 0 { bufferLinkCharacters += collapseWhitespace(text).count }
      }
    }
    flush()

    let baseURL = metadata.baseHref.flatMap { URL(string: $0, relativeTo: url)?.absoluteURL } ?? url
    let rootBlocks = blocks.filter(\.inContentRoot)
    let rootCharacters = rootBlocks.reduce(0) { $0 + $1.text.count }
    let chosen = rootCharacters >= 500 ? rootBlocks : blocks
    let siteName = metadata.siteName.map(shortSiteName).flatMap { $0.isEmpty ? nil : $0 } ?? SiteKey.displayHost(of: url)
    let title = cleanTitle(
      metadata.title.map(collapseWhitespace) ?? collapseWhitespace(documentTitle), siteName: siteName,
      fallback: firstHeading)
    let image = (metadata.image ?? firstContentImage).flatMap { resolveImage($0, base: baseURL) }
    let icon = metadata.icon.flatMap { URL(string: $0, relativeTo: baseURL)?.absoluteURL }
    return ReadablePage(
      url: url, title: title, siteName: siteName, summary: metadata.description.map(collapseWhitespace),
      imageURL: image, iconURL: icon, language: metadata.language, blocks: filter(chosen))
  }

  private static func filter(_ blocks: [RawBlock]) -> [TextBlock] {
    var seen: Set<String> = []
    var result: [TextBlock] = []
    for block in blocks {
      let length = block.text.count
      guard length > 0 else { continue }
      if Double(block.linkCharacters) / Double(length) > 0.5 { continue }
      switch block.kind {
      case .heading where length < 2 || length > 200: continue
      case .listItem where length < 3: continue
      case .paragraph, .quote:
        if length < 30 { continue }
      default: break
      }
      if length < 250 {
        let lowered = block.text.lowercased()
        if boilerplatePhrases.contains(where: lowered.contains) { continue }
      }
      guard seen.insert(block.text).inserted else { continue }
      result.append(TextBlock(kind: block.kind, text: block.text, group: block.group))
    }
    while let last = result.last, last.kind == .heading { result.removeLast() }
    return result
  }

  private static func shouldSkip(
    name: String, attributes: HTMLAttributes, insideContentRoot: Bool, skipsLayoutClasses: Bool
  ) -> Bool {
    if skippedElements.contains(name) { return true }
    if name == "header", !insideContentRoot { return true }
    if attributes["hidden"] != nil || attributes["aria-hidden"] == "true" { return true }
    if let role = attributes["role"]?.lowercased(), hiddenRoles.contains(role) { return true }
    if let style = attributes["style"]?.lowercased().replacingOccurrences(of: " ", with: ""),
      style.contains("display:none") || style.contains("visibility:hidden")
    {
      return true
    }
    guard !neverSkippedByClass.contains(name) else { return false }
    let tokens = attributes.classTokens
    if tokens.contains(where: boilerplateTokens.contains) { return true }
    return skipsLayoutClasses && tokens.contains(where: layoutTokens.contains)
  }

  private static func isContentRoot(name: String, attributes: HTMLAttributes) -> Bool {
    if name == "article" || name == "main" { return true }
    if attributes["role"]?.lowercased() == "main" { return true }
    return attributes["itemprop"]?.lowercased() == "articlebody"
  }

  private static func resolveImage(_ string: String, base: URL) -> URL? {
    guard let url = URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines), relativeTo: base)?.absoluteURL,
      let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http"
    else { return nil }
    let path = url.path.lowercased()
    if path.hasSuffix(".svg") || path.hasSuffix(".gif") || path.contains("logo") || path.contains("favicon") {
      return nil
    }
    return url
  }

  private static func cleanTitle(_ title: String, siteName: String, fallback: String?) -> String {
    let separators = [" | ", " - ", " \u{2013} ", " \u{2014} ", " :: ", " \u{00B7} "]
    var cleaned = title
    for separator in separators {
      guard let range = cleaned.range(of: separator, options: .backwards) else { continue }
      let suffix = cleaned[range.upperBound...].lowercased()
      let site = siteName.lowercased()
      if suffix == site || site.contains(suffix) || suffix.contains(site) {
        cleaned = String(cleaned[..<range.lowerBound])
        break
      }
    }
    cleaned = collapseWhitespace(cleaned)
    if cleaned.isEmpty { return fallback ?? siteName }
    return cleaned
  }

  static func shortSiteName(_ name: String) -> String {
    let collapsed = collapseWhitespace(name)
    guard collapsed.count > 24 else { return collapsed }
    for separator in [": ", " | ", " - ", " \u{2013} ", " \u{2014} "] {
      if let range = collapsed.range(of: separator), collapsed.distance(from: collapsed.startIndex, to: range.lowerBound) >= 2 {
        return String(collapsed[..<range.lowerBound])
      }
    }
    return collapsed
  }

  static func collapseWhitespace(_ text: String) -> String {
    var result = ""
    result.reserveCapacity(text.utf8.count)
    var pendingSpace = false
    for character in text {
      if character.isWhitespace {
        pendingSpace = !result.isEmpty
      } else {
        if pendingSpace { result.append(" ") }
        pendingSpace = false
        result.append(character)
      }
    }
    return result
  }

  private struct Metadata {
    var title: String?
    var siteName: String?
    var description: String?
    var image: String?
    var icon: String?
    var iconIsTouch = false
    var language: String?
    var baseHref: String?

    mutating func read(name: String, attributes: HTMLAttributes) {
      switch name {
      case "html":
        if let lang = attributes["lang"], !lang.isEmpty { language = lang }
      case "base":
        if baseHref == nil { baseHref = attributes["href"] }
      case "meta":
        let key = (attributes["property"] ?? attributes["name"] ?? attributes["itemprop"] ?? "").lowercased()
        guard let content = attributes["content"], !content.isEmpty else { return }
        switch key {
        case "og:title", "twitter:title": if title == nil { title = content }
        case "og:site_name", "application-name": if siteName == nil { siteName = content }
        case "og:description", "description", "twitter:description": if description == nil { description = content }
        case "og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image":
          if image == nil { image = content }
        default: break
        }
      case "link":
        let rel = (attributes["rel"] ?? "").lowercased()
        guard let href = attributes["href"], !href.isEmpty, rel.contains("icon") else { return }
        let isTouch = rel.contains("apple-touch-icon")
        if icon == nil || (isTouch && !iconIsTouch) {
          icon = href
          iconIsTouch = isTouch
        }
      default: break
      }
    }
  }
}
