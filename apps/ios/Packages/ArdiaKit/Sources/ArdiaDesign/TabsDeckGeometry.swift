import CoreGraphics
import Foundation

public struct TabsDeckGeometry: Equatable, Sendable {
  public static let cardWidthRatio: CGFloat = 306.0 / 440.0
  public static let focusLeadingRatio: CGFloat = 66.0 / 440.0
  public static let leftPeek: CGFloat = 70
  public static let stepRatio: CGFloat = 218.0 / 440.0
  public static let headerHeight: CGFloat = 20
  public static let barReserve: CGFloat = 58
  public static let barClearance = Tokens.Space.m
  public static let topReserve: CGFloat = 12
  public static let headerFaviconOnlyWidth: CGFloat = 72

  public let container: CGSize
  public let safeTop: CGFloat
  public let safeBottom: CGFloat
  public let safeSide: CGFloat
  public let topInset: CGFloat
  public let windowCorner: CGFloat
  public let barFrame: CGRect
  public let tabButtonCenter: CGPoint
  public let cardSize: CGSize
  public let focusLeading: CGFloat
  public let spacing: CGFloat
  public let leftReach: CGFloat
  public let cardCenterY: CGFloat

  public init(container: CGSize, safeTop: CGFloat, safeBottom: CGFloat, safeSide: CGFloat = 0, topInset: CGFloat = 0, windowCorner: CGFloat = 0, barFrame: CGRect? = nil, tabButton: CGPoint? = nil) {
    self.container = container
    self.safeTop = safeTop
    self.safeBottom = safeBottom
    self.safeSide = safeSide
    self.topInset = topInset
    self.windowCorner = windowCorner
    let width = max(container.width, 1)
    let height = max(container.height, 1)
    let bandTop = safeTop + max(topInset, Self.topReserve - TabsLayout.headerGap) + TabsLayout.headerGap + Self.headerHeight
    let barWidth = Self.barWidth(container: container, safeSide: safeSide)
    let bar = barFrame ?? CGRect(
      x: (width - barWidth) / 2,
      y: height - Self.barBottomGap(safeBottom: safeBottom) - BarMetrics.pieceHeight,
      width: barWidth,
      height: BarMetrics.pieceHeight
    )
    self.barFrame = bar
    tabButtonCenter = tabButton ?? CGPoint(x: bar.minX + BarMetrics.pieceHeight / 2, y: bar.midY)
    let bandBottom = bar.minY - Self.barClearance
    let band = max(bandBottom - bandTop, 120)
    let aspect = height / width
    let cardWidth = min(width * Self.cardWidthRatio, band / aspect)
    let cardHeight = cardWidth * aspect
    cardSize = CGSize(width: cardWidth, height: cardHeight)
    focusLeading = width * Self.focusLeadingRatio
    spacing = min(cardWidth, width * Self.stepRatio)
    leftReach = Self.reach(peek: min(Self.leftPeek, focusLeading - 6), spacing: spacing)
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

  public var cardTitleTop: CGFloat {
    cardCenterY - cardSize.height / 2 - TabsLayout.headerGap - Self.headerHeight
  }

  public var expandedScale: CGFloat { container.width / max(cardSize.width, 1) }

  public var expandedCenter: CGPoint { CGPoint(x: container.width / 2, y: container.height / 2) }

  public var barCenterY: CGFloat { barFrame.midY }

  public static func barBottomGap(safeBottom: CGFloat) -> CGFloat {
    max(safeBottom - BarMetrics.homeIndicatorShare, BarMetrics.sideInset)
  }

  public static func barWidth(container: CGSize, safeSide: CGFloat) -> CGFloat {
    min(container.width - (safeSide + BarMetrics.sideInset) * 2, BarMetrics.maxWidth)
  }

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

public enum DeckStyle: Equatable, Sendable {
  case strip
  case grid

  public static let gridMinWidth: CGFloat = 600

  public static func style(for size: CGSize) -> DeckStyle {
    size.width > size.height || size.width >= gridMinWidth ? .grid : .strip
  }
}

public struct DeckGridMetrics: Equatable, Sendable {
  public static let minCardWidth: CGFloat = 150
  public static let maxCardWidth: CGFloat = 240
  public static let gap = Tokens.Space.xl
  public static let rowGap = Tokens.Space.xxl
  public static let portraitAspect: CGFloat = 4.0 / 3.0
  public static let squatAspect: CGFloat = 3.0 / 4.0
  public static let headerHeight = TabsDeckGeometry.headerHeight

  public let columns: Int
  public let cardSize: CGSize
  public let sideInset: CGFloat

  public init(width: CGFloat, height: CGFloat, safeSide: CGFloat = 0) {
    let inset = safeSide + BarMetrics.sideInset
    let inner = max(width - inset * 2, Self.minCardWidth * 2 + Self.gap)
    let byMax = Int(((inner + Self.gap) / (Self.maxCardWidth + Self.gap)).rounded(.up))
    let byMin = Int(((inner + Self.gap) / (Self.minCardWidth + Self.gap)).rounded(.down))
    let columns = max(2, min(byMax, max(byMin, 2)))
    let cardWidth = ((inner - Self.gap * CGFloat(columns - 1)) / CGFloat(columns) * 2).rounded(.down) / 2
    let tallest = cardWidth * Self.portraitAspect
    let roomy = max(height - Self.headerHeight - Self.rowGap, cardWidth * Self.squatAspect)
    self.columns = columns
    cardSize = CGSize(width: cardWidth, height: min(tallest, roomy * 0.86).rounded(.down))
    sideInset = inset + (inner - (cardWidth * CGFloat(columns) + Self.gap * CGFloat(columns - 1))) / 2
  }
}
