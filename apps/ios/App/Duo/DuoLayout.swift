import SwiftUI

nonisolated enum DuoLayout {
  static let cardInset: CGFloat = 11
  static let cardTop: CGFloat = 33
  static let cardBottom: CGFloat = 9
  static let cardBelowStatus: CGFloat = 4
  static let cardIntoHomeIndicator: CGFloat = 20
  static let cardRadius: CGFloat = 16
  static let toolbarInset: CGFloat = 8
  static let toolbarTop: CGFloat = 9
  static let toolbarButton: CGFloat = 45
  static let toolbarGap: CGFloat = 7
  static let toolbarGlyph: CGFloat = 18
  static let toolbarClearance: CGFloat = toolbarTop * 2 + toolbarButton
  static let addressHeight: CGFloat = 44
  static let addressLead: CGFloat = 16
  static let addressTrail: CGFloat = 20

  static let sidebarWidth: CGFloat = 260
  static let sidebarRadius: CGFloat = 16
  static let sidebarPadding: CGFloat = 10
  static let sidebarHeaderHeight: CGFloat = 50
  static let sidebarHeaderTop: CGFloat = 25
  static let sidebarFieldHeight: CGFloat = 43
  static let sidebarRowHeight: CGFloat = 41
  static let sidebarRowPitch: CGFloat = 46
  static let sidebarRowRadius: CGFloat = 11
  static let sidebarRowLead: CGFloat = 13
  static let sidebarRowIcon: CGFloat = 18
  static let sidebarSectionTop: CGFloat = 10
  static let sidebarDotsBottom: CGFloat = 26
  static let pageDim: Double = 0.12

  static func cardTop(safeTop: CGFloat) -> CGFloat {
    max(cardTop, safeTop + cardBelowStatus)
  }

  static let commandTop: CGFloat = 127
  static let commandSide: CGFloat = 27
  static let commandMaxHeight: CGFloat = 484
  static let commandAboveKeyboard: CGFloat = 24

  static let panelTop: CGFloat = 16

  static let columnSpacing: CGFloat = 7
  static let columnAxis: CGFloat = 48
  static let columnTop: CGFloat = 166
  static let columnButton: CGFloat = 48
  static let columnFieldSide: CGFloat = 12

  static let slide = Animation.spring(response: 0.32, dampingFraction: 0.9)
}
