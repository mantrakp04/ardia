import ArdiaDesign
import SwiftUI

nonisolated enum DeckRole: Equatable {
  case stay
  case expanded
  case launcher
  case slideLeft
  case slideRight
}

nonisolated struct DeckMotion: VectorArithmetic {
  var relative: Double
  var scaleProgress: Double
  var positionProgress: Double
  var lift: Double
  var vanish: Double

  static var zero: DeckMotion { DeckMotion(relative: 0, scaleProgress: 0, positionProgress: 0, lift: 0, vanish: 0) }

  static func + (lhs: DeckMotion, rhs: DeckMotion) -> DeckMotion {
    DeckMotion(
      relative: lhs.relative + rhs.relative,
      scaleProgress: lhs.scaleProgress + rhs.scaleProgress,
      positionProgress: lhs.positionProgress + rhs.positionProgress,
      lift: lhs.lift + rhs.lift,
      vanish: lhs.vanish + rhs.vanish
    )
  }

  static func - (lhs: DeckMotion, rhs: DeckMotion) -> DeckMotion {
    DeckMotion(
      relative: lhs.relative - rhs.relative,
      scaleProgress: lhs.scaleProgress - rhs.scaleProgress,
      positionProgress: lhs.positionProgress - rhs.positionProgress,
      lift: lhs.lift - rhs.lift,
      vanish: lhs.vanish - rhs.vanish
    )
  }

  mutating func scale(by rhs: Double) {
    relative *= rhs
    scaleProgress *= rhs
    positionProgress *= rhs
    lift *= rhs
    vanish *= rhs
  }

  var magnitudeSquared: Double {
    relative * relative + scaleProgress * scaleProgress + positionProgress * positionProgress + lift * lift / 10_000 + vanish * vanish
  }
}

nonisolated struct DeckPose {
  var center: CGPoint
  var scale: CGFloat
  var corner: CGFloat
  var opacity: Double
  var headerOpacity: Double
  var visibleWidth: CGFloat

  static func resolve(_ motion: DeckMotion, role: DeckRole, geometry: TabsDeckGeometry, isLast: Bool) -> DeckPose {
    let deckCenter = geometry.center(at: motion.relative)
    let deckScale = geometry.scale(at: motion.relative)
    let scaleT = CGFloat(motion.scaleProgress)
    let positionT = CGFloat(motion.positionProgress)
    var center = deckCenter
    var scale = deckScale
    var corner = TabsLayout.cardRadius
    var opacity = 1.0
    switch role {
    case .stay:
      break
    case .expanded:
      scale = lerp(geometry.expandedScale, deckScale, scaleT)
      center = lerp(geometry.expandedCenter, deckCenter, positionT)
      corner = lerp(TabsLayout.displayCornerRadius, TabsLayout.cardRadius, scaleT)
    case .launcher:
      let start = 22 / max(geometry.cardSize.width, 1)
      scale = lerp(start, deckScale, scaleT)
      center = lerp(geometry.tabButtonCenter, deckCenter, positionT)
      corner = lerp(4, TabsLayout.cardRadius, scaleT)
      opacity = min(1, motion.scaleProgress * 2.5)
    case .slideLeft:
      center.x -= (1 - positionT) * geometry.container.width * 0.7
    case .slideRight:
      center.x += (1 - positionT) * geometry.container.width
    }
    let vanish = CGFloat(min(max(motion.vanish, 0), 1))
    center.y += CGFloat(motion.lift)
    scale *= 1 - 0.28 * vanish
    opacity *= Double(1 - vanish)
    let settle = role == .stay ? 1 : max(0, (motion.positionProgress - 0.7) / 0.3)
    let liftFade = max(0, 1 + motion.lift / 120)
    return DeckPose(
      center: center,
      scale: scale,
      corner: corner,
      opacity: opacity,
      headerOpacity: min(1, settle) * min(1, liftFade) * Double(1 - vanish),
      visibleWidth: geometry.visibleWidth(at: motion.relative, isLast: isLast)
    )
  }

  static func lerp(_ from: CGFloat, _ to: CGFloat, _ t: CGFloat) -> CGFloat {
    from + (to - from) * t
  }

  static func lerp(_ from: CGPoint, _ to: CGPoint, _ t: CGFloat) -> CGPoint {
    CGPoint(x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t))
  }
}

struct DeckCardPlacement: ViewModifier, Animatable {
  var motion: DeckMotion
  let role: DeckRole
  let geometry: TabsDeckGeometry
  let isLast: Bool

  var animatableData: DeckMotion {
    get { motion }
    set { motion = newValue }
  }

  func body(content: Content) -> some View {
    let pose = DeckPose.resolve(motion, role: role, geometry: geometry, isLast: isLast)
    let radius = pose.corner / max(pose.scale, 0.01)
    content
      .frame(width: geometry.cardSize.width, height: geometry.cardSize.height)
      .clipShape(.rect(cornerRadius: radius, style: .continuous))
      .contentShape(.rect(cornerRadius: radius, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .strokeBorder(TabsPalette.cardEdge, lineWidth: 0.5 / max(pose.scale, 0.01))
      }
      .background {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(TabsPalette.cardShadowBase)
          .shadow(color: TabsPalette.cardShadow, radius: 18 / max(pose.scale, 0.01), x: -2 / max(pose.scale, 0.01), y: 4 / max(pose.scale, 0.01))
      }
      .scaleEffect(pose.scale)
      .opacity(pose.opacity)
      .position(pose.center)
  }
}

struct DeckHeaderPlacement: ViewModifier, Animatable {
  var motion: DeckMotion
  let role: DeckRole
  let geometry: TabsDeckGeometry
  let isLast: Bool

  var animatableData: DeckMotion {
    get { motion }
    set { motion = newValue }
  }

  func body(content: Content) -> some View {
    let pose = DeckPose.resolve(motion, role: role, geometry: geometry, isLast: isLast)
    let cardHeight = geometry.cardSize.height * pose.scale
    let cardWidth = geometry.cardSize.width * pose.scale
    let leading = pose.center.x - cardWidth / 2
    let width = max(pose.visibleWidth, 0)
    let y = pose.center.y - cardHeight / 2 - TabsLayout.headerGap - TabsDeckGeometry.headerHeight / 2
    let available = max(width - 8, 0)
    let centerX = max(leading + width / 2, TabsLayout.faviconSize / 2 + 8)
    content
      .environment(\.deckHeaderWidth, available)
      .frame(width: available, height: TabsDeckGeometry.headerHeight)
      .opacity(pose.headerOpacity * DeckHeaderMetrics.iconReveal(width: available, icon: TabsLayout.faviconSize))
      .position(x: centerX, y: y)
  }
}
