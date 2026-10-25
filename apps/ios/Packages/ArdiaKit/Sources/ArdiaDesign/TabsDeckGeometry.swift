import CoreGraphics
import Foundation

public struct TabsDeckGeometry: Equatable, Sendable {
  public static let cardWidthRatio: CGFloat = 0.552
  public static let focusLeadingRatio: CGFloat = 80.0 / 393.0
  public static let leftPeek: CGFloat = 70
  public static let rightGap: CGFloat = 1
  public static let headerHeight: CGFloat = 28
  public static let barReserve: CGFloat = 92
  public static let topReserve: CGFloat = 12
  public static let headerFaviconOnlyWidth: CGFloat = 72

  public let container: CGSize
  public let safeTop: CGFloat
  public let safeBottom: CGFloat
  public let safeSide: CGFloat
  public let cardSize: CGSize
  public let focusLeading: CGFloat
  public let spacing: CGFloat
  public let leftReach: CGFloat
  public let cardCenterY: CGFloat

  public init(container: CGSize, safeTop: CGFloat, safeBottom: CGFloat, safeSide: CGFloat = 0) {
    self.container = container
    self.safeTop = safeTop
    self.safeBottom = safeBottom
    self.safeSide = safeSide
    let width = max(container.width, 1)
    let height = max(container.height, 1)
    let bandTop = safeTop + Self.topReserve + Self.headerHeight
    let bandBottom = height - max(safeBottom, 20) - Self.barReserve + 24
    let band = max(bandBottom - bandTop, 120)
    let aspect = height / width
    let cardWidth = min(width * Self.cardWidthRatio, band / aspect)
    let cardHeight = cardWidth * aspect
    cardSize = CGSize(width: cardWidth, height: cardHeight)
    focusLeading = width * Self.focusLeadingRatio
    spacing = cardWidth + Self.rightGap
    leftReach = Self.reach(peek: min(Self.leftPeek, focusLeading - 6), spacing: cardWidth + Self.rightGap)
    cardCenterY = bandTop + band / 2
  }

  static func reach(peek: CGFloat, spacing: CGFloat) -> CGFloat {
    let peek = max(peek, 8)
    var reach = peek
    for _ in 0..<6 { reach = peek / (1 - exp(-spacing / reach)) }
    return reach
  }

  public func leading(at relative: Double) -> CGFloat {
    let p = CGFloat(relative)
    if p >= 0 { return focusLeading + spacing * p }
    return focusLeading - leftReach * (1 - exp(p * spacing / leftReach))
  }

  public func center(at relative: Double) -> CGPoint {
    CGPoint(x: leading(at: relative) + cardSize.width / 2, y: cardCenterY)
  }

  public func scale(at relative: Double) -> CGFloat {
    1
  }

  public func visibleWidth(at relative: Double, isLast: Bool) -> CGFloat {
    guard !isLast else { return cardSize.width }
    return min(cardSize.width, max(0, leading(at: relative + 1) - leading(at: relative)))
  }

  public var expandedScale: CGFloat { container.width / max(cardSize.width, 1) }

  public var expandedCenter: CGPoint { CGPoint(x: container.width / 2, y: container.height / 2) }

  public var tabButtonCenter: CGPoint {
    CGPoint(x: safeSide + 16 + 17.5, y: barCenterY)
  }

  public var barCenterY: CGFloat { container.height - max(safeBottom, 20) - 6 }

  public func scrollDelta(forDrag translation: CGFloat) -> Double {
    Double(-translation / spacing)
  }

  public static func rubberBand(_ scroll: Double, count: Int) -> Double {
    let upper = Double(max(count - 1, 0))
    if scroll < 0 { return -pow(-scroll, 0.7) * 0.35 }
    if scroll > upper { return upper + pow(scroll - upper, 0.7) * 0.35 }
    return scroll
  }

  public func settleTarget(from scroll: Double, velocity: CGFloat, count: Int) -> Int {
    guard count > 0 else { return 0 }
    let projected = scroll - Double(velocity / spacing) * 0.22
    return min(max(Int(projected.rounded()), 0), count - 1)
  }

  public static func renderedRange(around scroll: Double, count: Int) -> Range<Int> {
    guard count > 0 else { return 0..<0 }
    let anchor = Int(scroll.rounded())
    let lower = max(0, anchor - 6)
    let upper = min(count, anchor + 6)
    return lower < upper ? lower..<upper : 0..<0
  }

  public static func scrollAfterRemoving(index removed: Int, scroll: Int, remaining: Int) -> Int {
    guard remaining > 0 else { return 0 }
    let shifted = removed < scroll ? scroll - 1 : scroll
    return min(max(shifted, 0), remaining - 1)
  }

  public static func shouldClose(translation: CGFloat, velocity: CGFloat, cardHeight: CGFloat) -> Bool {
    guard translation < 0 else { return false }
    if velocity < -500 { return true }
    return -translation > cardHeight / 3 && velocity < 250
  }
}
