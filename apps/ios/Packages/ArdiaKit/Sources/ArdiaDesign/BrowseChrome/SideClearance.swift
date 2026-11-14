import SwiftUI

public struct SideInsets: Sendable, Equatable {
  public let leading: CGFloat
  public let trailing: CGFloat

  public init(leading: CGFloat, trailing: CGFloat) {
    self.leading = leading
    self.trailing = trailing
  }
}

public enum SideClearance {
  public static func insets(containerWidth: CGFloat, safeArea: EdgeInsets, occlusions: [CGRect], band: ClosedRange<CGFloat>, base: CGFloat) -> SideInsets {
    guard !occlusions.isEmpty else {
      return SideInsets(leading: max(base, safeArea.leading), trailing: max(base, safeArea.trailing))
    }
    var leading = base
    var trailing = base
    for area in occlusions where area.minY < band.upperBound && area.maxY > band.lowerBound {
      if area.midX < containerWidth / 2 {
        leading = max(leading, area.maxX + BarMetrics.sideInset)
      } else {
        trailing = max(trailing, containerWidth - area.minX + BarMetrics.sideInset)
      }
    }
    return SideInsets(leading: leading, trailing: trailing)
  }
}
