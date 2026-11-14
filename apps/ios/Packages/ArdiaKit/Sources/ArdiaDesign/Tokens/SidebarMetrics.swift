import CoreGraphics

public enum SidebarMetrics {
  public static let touchScale: CGFloat = 1.25

  public static func touch(_ macValue: CGFloat) -> CGFloat {
    (macValue * touchScale).rounded(.toNearestOrEven)
  }

  public static let defaultWidth: CGFloat = 260
  public static let widthRange: ClosedRange<CGFloat> = 220...400
  public static let sideInset: CGFloat = 10
  public static let cardInset: CGFloat = 10
  public static let headerHeight: CGFloat = 56
  public static let footerHeight: CGFloat = 52
  public static let sectionLabel = Typography.Role.section

  public enum Tile {
    public static let height: CGFloat = 52
    public static let gap: CGFloat = 8
    public static let radius: CGFloat = 12
    public static let minWidth: CGFloat = 62
    public static let maxColumns = 4
  }

  public enum Row {
    public static let height: CGFloat = 42
    public static let gap: CGFloat = 4
    public static let radius: CGFloat = 12
    public static let icon: CGFloat = 20
    public static let title = Typography.Role.row
  }

  public struct PinGrid: Equatable, Sendable {
    public let columns: Int
    public let tileWidth: CGFloat

    public init(columns: Int, tileWidth: CGFloat) {
      self.columns = columns
      self.tileWidth = tileWidth
    }
  }

  public static func clampedWidth(_ width: CGFloat) -> CGFloat {
    min(max(width, widthRange.lowerBound), widthRange.upperBound)
  }

  public static func pinGrid(count: Int, innerWidth: CGFloat, balanced: Bool) -> PinGrid {
    let tiles = max(count, 1)
    let fit = max(1, Int(((innerWidth + Tile.gap) / (Tile.minWidth + Tile.gap)).rounded(.down)))
    let columns: Int
    if balanced {
      let rows = (tiles + min(Tile.maxColumns, fit) - 1) / min(Tile.maxColumns, fit)
      columns = (tiles + rows - 1) / rows
    } else {
      columns = min(tiles, fit)
    }
    let width = (innerWidth - Tile.gap * CGFloat(columns - 1)) / CGFloat(columns)
    return PinGrid(columns: columns, tileWidth: (width * 2).rounded(.down) / 2)
  }
}
