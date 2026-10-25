import ArdiaBrowser
import SwiftUI

#if canImport(UIKit)
  import UIKit

  public struct FaviconImage: View {
    public var iconURL: String?
    public var pageURL: String?
    public var size: CGFloat

    @State private var image: UIImage?

    public init(iconURL: String?, pageURL: String?, size: CGFloat = 16) {
      self.iconURL = iconURL
      self.pageURL = pageURL
      self.size = size
    }

    public var body: some View {
      ZStack {
        if let image {
          Image(uiImage: image)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
        } else {
          MonogramTile(pageURL: pageURL)
        }
      }
      .frame(width: size, height: size)
      .clipShape(.rect(cornerRadius: size * 0.22, style: .continuous))
      .task(id: candidates) {
        image = nil
        for candidate in candidates {
          if let loaded = await FaviconCache.shared.image(for: candidate) {
            image = loaded
            return
          }
        }
      }
      .accessibilityHidden(true)
    }

    private var candidates: [URL] {
      var list: [URL] = []
      if let iconURL, let url = URL(string: iconURL), url.scheme?.hasPrefix("http") == true { list.append(url) }
      if let pageURL, let page = URL(string: pageURL), page.scheme?.hasPrefix("http") == true,
         let fallback = URL(string: "/favicon.ico", relativeTo: page)?.absoluteURL, !list.contains(fallback) {
        list.append(fallback)
      }
      return list
    }
  }

  struct MonogramTile: View {
    var pageURL: String?

    var body: some View {
      GeometryReader { proxy in
        ZStack {
          Rectangle().fill(.fill.secondary)
          Text(letter)
            .font(.system(size: proxy.size.width * 0.58, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
        }
      }
    }

    private var letter: String {
      guard let pageURL, let host = BrowserURL.host(of: pageURL), let first = host.first else { return "" }
      return String(first).uppercased()
    }
  }

  actor FaviconCache {
    static let shared = FaviconCache()

    private let cache = NSCache<NSURL, UIImage>()
    private var failures: Set<URL> = []
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession = {
      let configuration = URLSessionConfiguration.default
      configuration.timeoutIntervalForRequest = 8
      configuration.requestCachePolicy = .returnCacheDataElseLoad
      configuration.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) \(BrowserUserAgent.applicationName)"]
      return URLSession(configuration: configuration)
    }()

    init() {
      cache.countLimit = 300
    }

    func image(for url: URL) async -> UIImage? {
      if let cached = cache.object(forKey: url as NSURL) { return cached }
      if failures.contains(url) { return nil }
      if let running = inFlight[url] { return await running.value }
      let session = session
      let task = Task<UIImage?, Never> {
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              let image = UIImage(data: data), image.size.width >= 8 else { return nil }
        return await image.byPreparingThumbnail(ofSize: CGSize(width: 96, height: 96)) ?? image
      }
      inFlight[url] = task
      let image = await task.value
      inFlight[url] = nil
      if let image {
        cache.setObject(image, forKey: url as NSURL)
      } else {
        failures.insert(url)
      }
      return image
    }
  }

  #Preview("Favicons") {
    HStack(spacing: 12) {
      FaviconImage(iconURL: nil, pageURL: "https://www.apple.com/", size: 28)
      FaviconImage(iconURL: nil, pageURL: "https://en.wikipedia.org/wiki/Lisbon", size: 28)
      FaviconImage(iconURL: nil, pageURL: nil, size: 28)
    }
    .padding()
  }
#endif
