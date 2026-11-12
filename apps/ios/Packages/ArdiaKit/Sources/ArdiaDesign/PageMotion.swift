import CoreGraphics
import Foundation

public struct LoadProgress: Equatable, Sendable {
  public enum Phase: Equatable, Sendable {
    case idle
    case waiting
    case showing
    case finishing
    case fading
  }

  public static let floor = 0.1
  public static let ceiling = 0.94

  public private(set) var phase: Phase = .idle
  public private(set) var fraction = 0.0
  public private(set) var restartsAfterFade = false

  public init() {}

  public var isVisible: Bool { phase == .showing || phase == .finishing }

  public mutating func start() {
    switch phase {
    case .idle:
      phase = .waiting
      fraction = 0
    case .finishing, .fading:
      restartsAfterFade = true
    case .waiting, .showing:
      break
    }
  }

  @discardableResult
  public mutating func reveal() -> Bool {
    guard phase == .waiting else { return false }
    phase = .showing
    fraction = max(fraction, Self.floor)
    return true
  }

  public mutating func advance(to raw: Double) {
    guard phase == .waiting || phase == .showing, raw.isFinite, raw > 0 else { return }
    let capped = min(raw, Self.ceiling)
    fraction = max(fraction, phase == .showing ? max(capped, Self.floor) : capped)
  }

  public mutating func finish() {
    switch phase {
    case .waiting:
      phase = .idle
      fraction = 0
    case .showing:
      phase = .finishing
      fraction = 1
    case .finishing, .fading:
      restartsAfterFade = false
    case .idle:
      break
    }
  }

  public mutating func fade() {
    guard phase == .finishing else { return }
    phase = .fading
  }

  public mutating func settle() {
    guard phase == .fading else { return }
    fraction = 0
    phase = restartsAfterFade ? .waiting : .idle
    restartsAfterFade = false
  }
}

public struct PagerCardPose: Equatable, Sendable {
  public var x: CGFloat
  public var scale: CGFloat
  public var dim: Double
  public var opacity: Double
  public var shadow: Double

  public init(x: CGFloat = 0, scale: CGFloat = 1, dim: Double = 0, opacity: Double = 1, shadow: Double = 0) {
    self.x = x
    self.scale = scale
    self.dim = dim
    self.opacity = opacity
    self.shadow = shadow
  }
}

public struct PagerDepthLayout: Equatable, Sendable {
  public var outgoing: PagerCardPose
  public var incoming: PagerCardPose?
  public var incomingSide: Int
}

public enum PagerPhysics {
  public static let rubberLimit: CGFloat = 60
  public static let parallax: CGFloat = 0.3
  public static let recededScale: CGFloat = 0.92
  public static let recededDim = 0.32
  public static let edgeScale: CGFloat = 0.03
  public static let projectionTime: CGFloat = 0.12
  public static let commitFraction: CGFloat = 0.5
  public static let opposingVelocity: CGFloat = 240

  public static func rubberBand(_ distance: CGFloat, limit: CGFloat = rubberLimit) -> CGFloat {
    let magnitude = abs(distance)
    let banded = limit * (1 - 1 / (magnitude / limit + 1))
    return distance < 0 ? -banded : banded
  }

  public static func resolvedOffset(_ raw: CGFloat, hasLeft: Bool, hasRight: Bool, width: CGFloat) -> CGFloat {
    if raw > 0 {
      return hasLeft ? min(raw, width) : rubberBand(raw)
    }
    if raw < 0 {
      return hasRight ? max(raw, -width) : rubberBand(raw)
    }
    return 0
  }

  public static func snapTarget(offset: CGFloat, velocity: CGFloat, width: CGFloat, hasLeft: Bool, hasRight: Bool) -> Int {
    guard width > 0 else { return 0 }
    let projected = offset + velocity * projectionTime
    if hasLeft, projected > width * commitFraction, velocity > -opposingVelocity { return 1 }
    if hasRight, projected < -width * commitFraction, velocity < opposingVelocity { return -1 }
    return 0
  }

  public static func layout(offset: CGFloat, width: CGFloat, hasLeft: Bool, hasRight: Bool, reduceMotion: Bool) -> PagerDepthLayout {
    let side = offset > 0 && hasLeft ? -1 : offset < 0 && hasRight ? 1 : 0
    guard width > 0 else { return PagerDepthLayout(outgoing: PagerCardPose(), incoming: nil, incomingSide: 0) }
    guard side != 0 else {
      let pull = min(abs(offset) / rubberLimit, 1)
      let x: CGFloat = reduceMotion ? 0 : offset
      return PagerDepthLayout(outgoing: PagerCardPose(x: x, scale: reduceMotion ? 1 : 1 - edgeScale * pull), incoming: nil, incomingSide: 0)
    }
    let progress = min(abs(offset) / width, 1)
    if reduceMotion {
      return PagerDepthLayout(
        outgoing: PagerCardPose(),
        incoming: PagerCardPose(opacity: Double(progress)),
        incomingSide: side
      )
    }
    let outgoing = PagerCardPose(
      x: offset * parallax,
      scale: 1 - (1 - recededScale) * progress,
      dim: recededDim * Double(progress)
    )
    let incoming = PagerCardPose(
      x: CGFloat(side) * width + offset,
      shadow: Double(1 - progress)
    )
    return PagerDepthLayout(outgoing: outgoing, incoming: incoming, incomingSide: side)
  }
}

public enum DeckHeaderMetrics {
  public static let titleHidden: CGFloat = 52
  public static let titleShown: CGFloat = 84
  public static let iconFade: CGFloat = 12
  public static let trailingFade: CGFloat = 14

  public static func titleReveal(width: CGFloat) -> CGFloat {
    min(max((width - titleHidden) / (titleShown - titleHidden), 0), 1)
  }

  public static func iconReveal(width: CGFloat, icon: CGFloat) -> CGFloat {
    min(max((width - icon) / iconFade, 0), 1)
  }

  public static func contentLeading(available: CGFloat, icon: CGFloat, spacing: CGFloat, title: CGFloat, reveal: CGFloat) -> CGFloat {
    let content = icon + (spacing + title) * reveal
    return max(0, (available - content) / 2)
  }
}
