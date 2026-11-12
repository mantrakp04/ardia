import CoreGraphics

enum ReportOverlayKind: String {
  case pictureInPicture
  case documentPictureInPicture
  case chrome
  case app

  var drawnByChrome: Bool { self != .app }
  var followsTheUser: Bool { self == .pictureInPicture || self == .documentPictureInPicture }
}

struct ReportOverlayCandidate: Equatable {
  let number: Int
  let frame: CGRect
  let kind: ReportOverlayKind
  let visible: Bool
  let alpha: CGFloat
}

struct ReportOverlayPlacement: Equatable {
  let candidate: ReportOverlayCandidate
  let rect: CGRect
  let pinned: Bool
}

enum ReportOverlayLayout {
  static let pinMargin: CGFloat = 12
  static let minimumShownShare: CGFloat = 0.5
  static let minimumAlpha: CGFloat = 0.01

  static func select(
    frontToBack: [Int], main: Int, mainFrame: CGRect, candidates: [ReportOverlayCandidate], excluded: Set<Int>
  ) -> [ReportOverlayPlacement] {
    let above = Set(frontToBack.prefix { $0 != main })
    let order = Dictionary(frontToBack.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    let kept = candidates.filter { c in
      c.number != main && !excluded.contains(c.number) && c.visible && c.alpha > minimumAlpha && !c.frame.isEmpty
        && (c.kind.followsTheUser || above.contains(c.number))
    }
    let backToFront = kept.sorted { a, b in
      if a.kind.followsTheUser != b.kind.followsTheUser { return !a.kind.followsTheUser }
      return (order[a.number] ?? Int.max) > (order[b.number] ?? Int.max)
    }
    return backToFront.compactMap { c in
      place(c.frame, in: mainFrame, pinIfOutside: c.kind.followsTheUser).map { ReportOverlayPlacement(candidate: c, rect: $0.rect, pinned: $0.pinned) }
    }
  }

  static func place(_ frame: CGRect, in mainFrame: CGRect, pinIfOutside: Bool) -> (rect: CGRect, pinned: Bool)? {
    let rect = frame.offsetBy(dx: -mainFrame.minX, dy: -mainFrame.minY)
    let canvas = CGRect(origin: .zero, size: mainFrame.size)
    let shown = rect.intersection(canvas)
    let share = shown.isNull ? 0 : (shown.width * shown.height) / max(rect.width * rect.height, 1)
    if !pinIfOutside { return share > 0 ? (rect, false) : nil }
    if share >= minimumShownShare { return (rect, false) }
    let room = canvas.insetBy(dx: pinMargin, dy: pinMargin)
    guard room.width > 0, room.height > 0 else { return nil }
    let scale = min(1, room.width / rect.width, room.height / rect.height)
    let size = CGSize(width: rect.width * scale, height: rect.height * scale)
    let x = min(max(rect.midX - size.width / 2, room.minX), room.maxX - size.width)
    let y = min(max(rect.midY - size.height / 2, room.minY), room.maxY - size.height)
    return (CGRect(origin: CGPoint(x: x, y: y), size: size), true)
  }
}
