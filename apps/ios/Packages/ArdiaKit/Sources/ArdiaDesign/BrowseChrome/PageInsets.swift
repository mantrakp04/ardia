import SwiftUI

public enum PageInsets {
  public static let topTolerance: CGFloat = 1

  public static func restingOffset(offsetY: CGFloat, oldAdjustedTop: CGFloat, newAdjustedTop: CGFloat) -> CGFloat? {
    guard oldAdjustedTop != newAdjustedTop, offsetY <= -oldAdjustedTop + topTolerance else { return nil }
    return -newAdjustedTop
  }

  public static func isAtTop(offsetY: CGFloat, adjustedTop: CGFloat) -> Bool {
    offsetY <= -adjustedTop + topTolerance
  }

  public static func obscured(safeTop: CGFloat, topInset: CGFloat, bottomInset: CGFloat) -> EdgeInsets {
    EdgeInsets(top: max(safeTop, 0) + max(topInset, 0), leading: 0, bottom: max(bottomInset, 0), trailing: 0)
  }
}
