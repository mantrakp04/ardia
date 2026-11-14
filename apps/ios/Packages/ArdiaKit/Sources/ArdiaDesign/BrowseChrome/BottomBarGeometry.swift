import SwiftUI

public struct BottomBarGeometry: Sendable, Equatable {
  public enum Axis: Sendable, Equatable {
    case horizontal
    case vertical(HorizontalEdge)
  }

  public let container: CGSize
  public let axis: Axis
  public let barFrame: CGRect
  public let compactFrame: CGRect
  public let pageBottomInset: CGFloat
  public let pageLeadingInset: CGFloat
  public let pageTrailingInset: CGFloat

  public var isLandscape: Bool { container.width > container.height }

  public var clearanceAboveBottom: CGFloat { container.height - barFrame.minY }

  public var pagerWidth: CGFloat { max(0, container.width - pageLeadingInset - pageTrailingInset) }

  public init(container: CGSize, safeArea: EdgeInsets, corners: RectangleCornerRadii, occlusions: [CGRect], verticalEdge: HorizontalEdge?) {
    self.container = container
    if let verticalEdge {
      let rail = Self.rail(container: container, safeArea: safeArea, edge: verticalEdge)
      axis = .vertical(verticalEdge)
      barFrame = rail
      compactFrame = rail
      pageBottomInset = 0
      let railReach = verticalEdge == .leading ? rail.maxX : container.width - rail.minX
      pageLeadingInset = verticalEdge == .leading ? railReach + BarMetrics.pageGap : 0
      pageTrailingInset = verticalEdge == .trailing ? railReach + BarMetrics.pageGap : 0
      return
    }
    axis = .horizontal
    let height = BarMetrics.pieceHeight
    let provisional = Self.sideInsets(container: container, safeArea: safeArea, occlusions: occlusions, band: Self.band(container: container, bottomGap: max(safeArea.bottom, BarMetrics.sideInset), height: height))
    let row = Self.row(container: container, leading: provisional.leading, trailing: provisional.trailing)
    let bottomGap = Self.bottomGap(container: container, safeArea: safeArea, corners: corners, row: row, height: height)
    let band = Self.band(container: container, bottomGap: bottomGap, height: height)
    let sides = Self.sideInsets(container: container, safeArea: safeArea, occlusions: occlusions, band: band)
    let finalRow = Self.row(container: container, leading: sides.leading, trailing: sides.trailing)
    barFrame = CGRect(x: finalRow.minX, y: band.lowerBound, width: finalRow.width, height: height)
    let compactWidth = min(BarMetrics.compactMaxWidth, finalRow.width)
    compactFrame = CGRect(
      x: finalRow.midX - compactWidth / 2,
      y: band.upperBound - BarMetrics.compactHeight,
      width: compactWidth,
      height: BarMetrics.compactHeight
    )
    pageBottomInset = bottomGap + height + BarMetrics.pageGap
    pageLeadingInset = 0
    pageTrailingInset = 0
  }

  static func band(container: CGSize, bottomGap: CGFloat, height: CGFloat) -> ClosedRange<CGFloat> {
    let maxY = container.height - bottomGap
    return (maxY - height)...maxY
  }

  static func row(container: CGSize, leading: CGFloat, trailing: CGFloat) -> CGRect {
    let available = max(0, container.width - leading - trailing)
    let width = min(available, BarMetrics.maxWidth)
    return CGRect(x: leading + (available - width) / 2, y: 0, width: width, height: 0)
  }

  static func sideInsets(container: CGSize, safeArea: EdgeInsets, occlusions: [CGRect], band: ClosedRange<CGFloat>) -> SideInsets {
    let clearance = SideClearance.insets(containerWidth: container.width, safeArea: safeArea, occlusions: occlusions, band: band, base: BarMetrics.sideInset)
    let side = max(clearance.leading, clearance.trailing)
    return SideInsets(leading: side, trailing: side)
  }

  static func bottomGap(container: CGSize, safeArea: EdgeInsets, corners: RectangleCornerRadii, row: CGRect, height: CGFloat) -> CGFloat {
    let fromSafeArea = safeArea.bottom > 0 ? safeArea.bottom - BarMetrics.homeIndicatorShare : BarMetrics.sideInset
    let leadingCorner = cornerClearance(radius: corners.bottomLeading, sideGap: row.minX, pieceRadius: height / 2)
    let trailingCorner = cornerClearance(radius: corners.bottomTrailing, sideGap: container.width - row.maxX, pieceRadius: height / 2)
    return max(fromSafeArea, leadingCorner, trailingCorner, BarMetrics.cornerMargin)
  }

  public static func cornerClearance(radius: CGFloat, sideGap: CGFloat, pieceRadius: CGFloat) -> CGFloat {
    let dx = radius - sideGap - pieceRadius
    guard dx > 0 else { return 0 }
    let reach = radius - pieceRadius - BarMetrics.cornerMargin
    guard reach > dx else { return radius }
    let dy = (reach * reach - dx * dx).squareRoot()
    return max(0, radius - pieceRadius - dy)
  }

  static func rail(container: CGSize, safeArea: EdgeInsets, edge: HorizontalEdge) -> CGRect {
    let width = BarMetrics.pieceHeight
    let height = BarMetrics.pieceHeight * BarMetrics.railPieces + BarMetrics.pieceGap * (BarMetrics.railPieces - 1)
    let x = edge == .leading
      ? max(BarMetrics.sideInset, safeArea.leading)
      : container.width - max(BarMetrics.sideInset, safeArea.trailing) - width
    let top = safeArea.top
    let usable = max(0, container.height - safeArea.top - safeArea.bottom)
    return CGRect(x: x, y: top + max(0, (usable - height) / 2), width: width, height: min(height, usable))
  }
}
