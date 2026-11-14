import CoreGraphics

public enum PageComposition: String, CaseIterable, Sendable {
  case stacked
  case column
  case sideBySide

  public static let wideMinWidth: CGFloat = 600
  public static let columnWidth: CGFloat = 520
  public static let sideBySideCopyWidth: CGFloat = 440

  public init(size: CGSize) {
    if size.width < Self.wideMinWidth {
      self = .stacked
    } else if size.width > size.height {
      self = .sideBySide
    } else {
      self = .column
    }
  }
}
