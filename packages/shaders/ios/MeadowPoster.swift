import AppKit
import ImageIO

struct MeadowPoster: Decodable {
  let state: String
  let file: String
  let aspect: Double
  let horizon: Double

  static let bundle: Bundle? = Bundle(for: MeadowView.self).url(forResource: "ArdiaMeadow", withExtension: "bundle").flatMap(Bundle.init(url:))

  static let all: [MeadowPoster] = {
    guard let url = bundle?.url(forResource: "posters", withExtension: "json"), let data = try? Data(contentsOf: url) else { return [] }
    return (try? JSONDecoder().decode([MeadowPoster].self, from: data)) ?? []
  }()

  static func nearest(aspect: Double, reduceMotion: Bool) -> MeadowPoster? {
    let state = reduceMotion ? "morning" : "dawn"
    return all.filter { $0.state == state }.min { abs(log($0.aspect / aspect)) < abs(log($1.aspect / aspect)) }
  }

  var url: URL? { Self.bundle?.resourceURL?.appendingPathComponent(file) }

  func decode(_ done: @escaping (CGImage?) -> Void) {
    guard let url else { return done(nil) }
    DispatchQueue.global(qos: .userInteractive).async {
      let options = [kCGImageSourceShouldCacheImmediately: true] as CFDictionary
      let image = CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, options) }
      DispatchQueue.main.async { done(image) }
    }
  }

  func frame(for image: CGImage, in size: CGSize, flipped: Bool) -> CGRect {
    let width = CGFloat(image.width), height = CGFloat(image.height)
    let scale = max(size.width / width, size.height / height)
    let drawn = CGSize(width: width * scale, height: height * scale)
    let x = (size.width - drawn.width) / 2
    let top = (size.height - drawn.height) * CGFloat(horizon)
    return CGRect(x: x, y: flipped ? top : size.height - top - drawn.height, width: drawn.width, height: drawn.height)
  }
}
