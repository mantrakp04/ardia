import SwiftUI

public enum Typography {
  public enum Role: String, CaseIterable, Sendable {
    case badge
    case caption
    case section
    case row
    case field
    case body
    case title
    case largeTitle
    case display
  }

  public static let badge = Role.badge.font
  public static let caption = Role.caption.font
  public static let section = Role.section.font
  public static let row = Role.row.font
  public static let field = Role.field.font
  public static let body = Role.body.font
  public static let title = Role.title.font
  public static let largeTitle = Role.largeTitle.font
  public static let display = Role.display.font
}

public extension Typography.Role {
  var macSize: CGFloat {
    switch self {
    case .badge: Tokens.FontSize.badge
    case .caption, .section: Tokens.FontSize.caption
    case .row, .field, .body: Tokens.FontSize.body
    case .title: Tokens.FontSize.title
    case .largeTitle: Tokens.Display.title.size
    case .display: Tokens.Display.large.size
    }
  }

  var textStyle: Font.TextStyle {
    switch self {
    case .badge: .caption2
    case .caption, .section: .footnote
    case .row: .subheadline
    case .field, .body: .callout
    case .title: .headline
    case .largeTitle: .title2
    case .display: .title
    }
  }

  var baseSize: CGFloat {
    switch self {
    case .badge: 11
    case .caption, .section: 13
    case .row: 15
    case .field, .body: 16
    case .title: 17
    case .largeTitle: 22
    case .display: 28
    }
  }

  var weight: Font.Weight {
    switch self {
    case .badge, .caption, .row, .field, .body: Tokens.Weight.regular
    case .section, .title: Tokens.Weight.semibold
    case .largeTitle, .display: Tokens.Weight.bold
    }
  }

  var tracking: CGFloat {
    switch self {
    case .largeTitle: Tokens.Display.title.tracking
    case .display: Tokens.Display.large.tracking
    default: 0
    }
  }

  var font: Font { .system(textStyle, weight: weight) }
}

public extension View {
  func typography(_ role: Typography.Role) -> some View {
    font(role.font).tracking(role.tracking)
  }
}
