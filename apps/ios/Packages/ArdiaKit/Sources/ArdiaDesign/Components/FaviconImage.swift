import ArdiaBrowser
import SwiftUI

#if canImport(UIKit)
  import UIKit

  public struct FaviconImage: View {
    public var iconURL: String?
    public var pageURL: String?
    public var size: CGFloat

    @Environment(\.colorScheme) private var colorScheme
    @State private var loaded: FaviconCache.Entry?

    public init(iconURL: String?, pageURL: String?, size: CGFloat = 16) {
      self.iconURL = iconURL
      self.pageURL = pageURL
      self.size = size
    }

    public var body: some View {
      ZStack {
        if let loaded {
          if let plate = plate(for: loaded.tone) {
            RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
              .fill(plate)
            icon(loaded.image)
              .padding(size * 0.14)
          } else {
            icon(loaded.image)
          }
        } else {
          MonogramTile(pageURL: pageURL)
        }
      }
      .frame(width: size, height: size)
      .clipShape(.rect(cornerRadius: size * 0.26, style: .continuous))
      .task(id: candidates) {
        if let current = loaded, candidates.contains(current.source) { return }
        loaded = nil
        for candidate in candidates {
          if let entry = await FaviconCache.shared.entry(for: candidate) {
            loaded = entry
            return
          }
        }
      }
      .accessibilityHidden(true)
    }

    private func icon(_ image: UIImage) -> some View {
      Image(uiImage: image)
        .resizable()
        .interpolation(.high)
        .scaledToFit()
    }

    private func plate(for tone: FaviconTone) -> Color? {
      switch (tone, colorScheme) {
      case (.darkOnClear, .dark): Color.white.opacity(0.92)
      case (.lightOnClear, .light): Color.black.opacity(0.78)
      default: nil
      }
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

  public enum FaviconTone: Sendable, Equatable {
    case opaque
    case darkOnClear
    case lightOnClear
    case mixed
    case blank

    static func measure(_ image: CGImage) -> FaviconTone {
      let side = 16
      var pixels = [UInt8](repeating: 0, count: side * side * 4)
      let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
        guard let context = CGContext(
          data: buffer.baseAddress,
          width: side,
          height: side,
          bitsPerComponent: 8,
          bytesPerRow: side * 4,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        context.interpolationQuality = .medium
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        return true
      }
      guard drawn else { return .mixed }
      var covered = 0
      var luminance = 0.0
      for index in stride(from: 0, to: pixels.count, by: 4) {
        let alpha = Double(pixels[index + 3]) / 255
        guard alpha > 0.5 else { continue }
        covered += 1
        let red = Double(pixels[index]) / 255 / alpha
        let green = Double(pixels[index + 1]) / 255 / alpha
        let blue = Double(pixels[index + 2]) / 255 / alpha
        luminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
      let coverage = Double(covered) / Double(side * side)
      guard coverage > 0.04 else { return .blank }
      if coverage > 0.9 { return .opaque }
      let mean = luminance / Double(covered)
      if mean < 0.28 { return .darkOnClear }
      if mean > 0.86 { return .lightOnClear }
      return .mixed
    }
  }

  struct MonogramTile: View {
    var pageURL: String?

    var body: some View {
      GeometryReader { proxy in
        ZStack {
          Rectangle().fill(tint.gradient)
          if let letter {
            Text(letter)
              .font(.system(size: proxy.size.width * 0.56, weight: .semibold, design: .rounded))
              .foregroundStyle(.white)
          } else {
            Image(systemName: "globe")
              .font(.system(size: proxy.size.width * 0.6, weight: .medium))
              .foregroundStyle(.white)
          }
        }
      }
    }

    private var host: String? {
      guard let pageURL, let host = BrowserURL.host(of: pageURL) else { return nil }
      return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private var letter: String? {
      guard let first = host?.first(where: { $0.isLetter || $0.isNumber }) else { return nil }
      return String(first).uppercased()
    }

    private var tint: Color {
      guard let host else { return Color(hex: 0x8E8E93) }
      let palette: [UInt32] = [0x5E6AD2, 0x2F9E8F, 0xD9663F, 0x8A5CC7, 0x3A8DDE, 0xC2477A, 0x5F9E3A, 0xB8862B]
      let hash = host.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
      return Color(hex: palette[Int(hash % UInt32(palette.count))])
    }
  }

  actor FaviconCache {
    static let shared = FaviconCache()

    final class Entry: Sendable {
      let image: UIImage
      let tone: FaviconTone
      let source: URL

      init(image: UIImage, tone: FaviconTone, source: URL) {
        self.image = image
        self.tone = tone
        self.source = source
      }
    }

    private let cache = NSCache<NSURL, Entry>()
    private var failures: Set<URL> = []
    private var inFlight: [URL: Task<Entry?, Never>] = [:]
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

    func entry(for url: URL) async -> Entry? {
      if let cached = cache.object(forKey: url as NSURL) { return cached }
      if failures.contains(url) { return nil }
      if let running = inFlight[url] { return await running.value }
      let session = session
      let task = Task<Entry?, Never> {
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              let image = UIImage(data: data), image.size.width >= 8 else { return nil }
        let prepared = await image.byPreparingThumbnail(ofSize: CGSize(width: 96, height: 96)) ?? image
        let tone = prepared.cgImage.map(FaviconTone.measure) ?? .mixed
        guard tone != .blank else { return nil }
        return Entry(image: prepared, tone: tone, source: url)
      }
      inFlight[url] = task
      let entry = await task.value
      inFlight[url] = nil
      if let entry {
        cache.setObject(entry, forKey: url as NSURL)
      } else {
        failures.insert(url)
      }
      return entry
    }
  }

  #Preview("Favicons") {
    HStack(spacing: 12) {
      FaviconImage(iconURL: nil, pageURL: "https://www.apple.com/", size: 28)
      FaviconImage(iconURL: nil, pageURL: "https://en.wikipedia.org/wiki/Lisbon", size: 28)
      FaviconImage(iconURL: nil, pageURL: "https://github.com/", size: 28)
      FaviconImage(iconURL: nil, pageURL: "https://www.dpreview.com/", size: 28)
      FaviconImage(iconURL: nil, pageURL: nil, size: 28)
    }
    .padding()
  }
#endif
