#if canImport(UIKit)
  import ObjectiveC
  import UIKit
  import UniformTypeIdentifiers

  @MainActor
  public enum ContainingApp {
    public static func open(_ url: URL, from responder: UIResponder) -> Bool {
      let selector = NSSelectorFromString("openURL:options:completionHandler:")
      var current: UIResponder? = responder
      while let candidate = current {
        if let application = candidate as? UIApplication,
          let method = class_getInstanceMethod(type(of: application), selector)
        {
          typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
          let open = unsafeBitCast(method_getImplementation(method), to: OpenURL.self)
          open(application, selector, url as NSURL, NSDictionary(), nil)
          return true
        }
        current = candidate.next
      }
      return false
    }
  }

  public struct SharedPage: Equatable, Sendable {
    public var url: URL?
    public var title: String
    public var text: String?

    public init(url: URL?, title: String, text: String?) {
      self.url = url
      self.title = title
      self.text = text
    }

    public var displayTitle: String {
      let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { return trimmed }
      if let host = url.flatMap({ SystemTab(title: "", url: $0.absoluteString).host }) { return host }
      return text ?? ""
    }

    public var browseQuery: String {
      if let text, !text.isEmpty, url == nil { return text }
      let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { return trimmed }
      return url?.absoluteString ?? text ?? ""
    }

    @MainActor
    public static func read(from context: NSExtensionContext?) async -> SharedPage {
      let items = context?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
      var url: URL?
      var text: String?
      var title = items.lazy.compactMap { $0.attributedContentText?.string }.first ?? ""
      for provider in items.flatMap({ $0.attachments ?? [] }) {
        if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
          let loaded = await loadURL(from: provider), let scheme = loaded.scheme?.lowercased(),
          scheme == "http" || scheme == "https"
        {
          url = loaded
        } else if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          text = await loadText(from: provider)
        }
      }
      if url == nil, let text, let detected = firstLink(in: text) {
        url = detected
        if title.isEmpty, text.trimmingCharacters(in: .whitespacesAndNewlines) != detected.absoluteString { title = text }
      }
      if title == url?.absoluteString { title = "" }
      let cleanText = text?.trimmingCharacters(in: .whitespacesAndNewlines)
      return SharedPage(url: url, title: title, text: cleanText?.isEmpty == false ? cleanText : nil)
    }

    @MainActor
    private static func loadURL(from provider: NSItemProvider) async -> URL? {
      await withCheckedContinuation { continuation in
        _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
      }
    }

    @MainActor
    private static func loadText(from provider: NSItemProvider) async -> String? {
      await withCheckedContinuation { continuation in
        _ = provider.loadObject(ofClass: String.self) { text, _ in continuation.resume(returning: text) }
      }
    }

    static func firstLink(in text: String) -> URL? {
      guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
      let range = NSRange(text.startIndex..., in: text)
      return detector.matches(in: text, range: range).lazy.compactMap(\.url).first {
        let scheme = $0.scheme?.lowercased()
        return scheme == "http" || scheme == "https"
      }
    }
  }
#endif
