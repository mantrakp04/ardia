import CoreGraphics

enum ReportOverlayKind: String {
  case pictureInPicture
  case chrome
  case app
}

enum ReportOverlayFill: Equatable {
  case black
  case picture
  case layers
}

struct ReportOverlayCandidate: Equatable {
  let number: Int
  let frame: CGRect
  let kind: ReportOverlayKind
  let owned: Bool
  let alpha: CGFloat
}

struct ReportOverlayPlacement: Equatable {
  let candidate: ReportOverlayCandidate
  let rect: CGRect
  let clip: [CGRect]
}

enum ReportOverlayLayout {
  static let minimumAlpha: CGFloat = 0.01

  static func select(
    frontToBack: [Int], main: Int, mainFrame: CGRect, screens: [CGRect], candidates: [ReportOverlayCandidate], excluded: Set<Int>
  ) -> [ReportOverlayPlacement] {
    guard let mainDepth = frontToBack.firstIndex(of: main) else { return [] }
    let depth = Dictionary(frontToBack.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    let kept = candidates.filter { c in
      guard c.owned, c.number != main, !excluded.contains(c.number), c.alpha > minimumAlpha, !c.frame.isEmpty, let d = depth[c.number] else { return false }
      return d < mainDepth
    }
    let backToFront = kept.sorted { (depth[$0.number] ?? 0) > (depth[$1.number] ?? 0) }
    return backToFront.compactMap { c in
      place(c.frame, in: mainFrame, screens: screens).map { ReportOverlayPlacement(candidate: c, rect: $0.rect, clip: $0.clip) }
    }
  }

  static func place(_ frame: CGRect, in mainFrame: CGRect, screens: [CGRect]) -> (rect: CGRect, clip: [CGRect])? {
    let canvas = CGRect(origin: .zero, size: mainFrame.size)
    let rect = frame.offsetBy(dx: -mainFrame.minX, dy: -mainFrame.minY)
    let clip = screens
      .map { $0.offsetBy(dx: -mainFrame.minX, dy: -mainFrame.minY).intersection(rect).intersection(canvas) }
      .filter { !$0.isNull && $0.width > 0 && $0.height > 0 }
    return clip.isEmpty ? nil : (rect, clip)
  }

  static func fill(for kind: ReportOverlayKind, includePages: Bool, pictureFresh: Bool) -> ReportOverlayFill {
    guard includePages else { return .black }
    switch kind {
    case .pictureInPicture, .chrome: return pictureFresh ? .picture : .black
    case .app: return .layers
    }
  }

  static func drawsControls(_ kind: ReportOverlayKind) -> Bool { kind == .pictureInPicture }
}

enum ReportViewOrigin: Equatable {
  case app
  case system
  case chromium
  case other
}

enum ReportViewVerdict: Equatable {
  case page
  case chrome
}

struct ReportViewTraits: Equatable {
  let pageEngine: Bool
  let pagePicture: Bool
  let origin: ReportViewOrigin
  let chromiumContainer: Bool
}

enum ReportPageMask {
  static let pagePictureIdentifier = "ardia.pagePicture"
  static let chromiumContainers: Set<String> = ["BridgedContentView", "ViewsCompositorSuperview", "NativeWidgetMacNSWindowTitledFrame"]

  static func verdict(_ traits: ReportViewTraits) -> ReportViewVerdict {
    if traits.pageEngine || traits.pagePicture { return .page }
    switch traits.origin {
    case .app, .system: return .chrome
    case .chromium: return traits.chromiumContainer ? .chrome : .page
    case .other: return .page
    }
  }
}

struct ReportPictureClock: Equatable {
  let deadline: Double
  let expiry: Double
  private(set) var generation = 0
  private(set) var requestedAt: Double?
  private(set) var capturedAt: Double?
  private(set) var misses = 0

  init(deadline: Double, expiry: Double) {
    self.deadline = deadline
    self.expiry = expiry
  }

  mutating func request(now: Double) -> Int? {
    if let requestedAt, now - requestedAt < deadline { return nil }
    if requestedAt != nil { misses += 1 }
    generation += 1
    requestedAt = now
    return generation
  }

  mutating func receive(_ answered: Int, ok: Bool, now: Double) -> Bool {
    guard answered == generation, let asked = requestedAt else { return false }
    requestedAt = nil
    let inTime = ok && now - asked < deadline
    capturedAt = inTime ? asked : nil
    if !inTime { misses += 1 }
    return inTime
  }

  func fresh(now: Double) -> Bool { capturedAt.map { now - $0 <= expiry } ?? false }
}
