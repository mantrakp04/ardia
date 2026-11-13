import SwiftUI

public enum ChromeLayout: String, CaseIterable, Sendable {
  case bar
  case sidebarOverlay
  case sidebarDocked

  public static let overlayMinWidth: CGFloat = 640
  public static let dockedMinWidth: CGFloat = 820
  public static let sidebarMinHeight: CGFloat = 500

  public init(windowSize: CGSize) {
    if windowSize.width < Self.overlayMinWidth || windowSize.height < Self.sidebarMinHeight {
      self = .bar
    } else if windowSize.width < Self.dockedMinWidth {
      self = .sidebarOverlay
    } else {
      self = .sidebarDocked
    }
  }

  public var hasSidebar: Bool { self != .bar }

  public var hasBottomBar: Bool { self == .bar }
}

public enum HingeState: String, CaseIterable, Sendable {
  case closed
  case partial
  case open
}

public enum CanvasArgument {
  public static func size(_ text: String) -> CGSize? {
    let parts = text.lowercased().split(separator: "x", omittingEmptySubsequences: false)
    guard parts.count == 2, let width = Double(parts[0]), let height = Double(parts[1]), width > 0, height > 0 else { return nil }
    return CGSize(width: width, height: height)
  }
}

public extension EnvironmentValues {
  @Entry var chromeLayout: ChromeLayout = .bar
  @Entry var hingeState: HingeState? = nil
  @Entry var windowCornerRadii = RectangleCornerRadii(uniform: 0)
}
