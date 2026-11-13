import CoreGraphics

public enum SpaceSwitcherMetrics {
  public static let bandHeight = SidebarMetrics.touch(28)
  public static let dotCell = SidebarMetrics.touch(12)
  public static let iconCell = SidebarMetrics.touch(26)

  public static func cell(showsIcon: Bool) -> CGFloat {
    showsIcon ? iconCell : dotCell
  }

  public static func endPadding(beside cell: CGFloat) -> CGFloat {
    max(0, (bandHeight - cell) / 2)
  }
}
