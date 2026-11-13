import ArdiaDesign
import SwiftUI
import Testing

struct TypographyTests {
  @Test func `rows and section labels match the spec's touch table`() {
    #expect(Typography.Role.row.baseSize == 15)
    #expect(Typography.Role.row.textStyle == .subheadline)
    #expect(Typography.Role.row.macSize == Tokens.FontSize.body)
    #expect(Typography.Role.section.baseSize == 13)
    #expect(Typography.Role.section.textStyle == .footnote)
    #expect(Typography.Role.section.weight == .semibold)
    #expect(Typography.Role.section.macSize == Tokens.FontSize.caption)
  }

  @Test(arguments: Typography.Role.allCases)
  func `every role is at least the Mac size and at most the touch scale above it`(role: Typography.Role) {
    #expect(role.baseSize >= role.macSize)
    #expect(role.baseSize <= role.macSize * SidebarMetrics.touchScale)
  }

  @Test func `display roles carry the Mac's tracking`() {
    #expect(Typography.Role.display.tracking == Tokens.Display.large.tracking)
    #expect(Typography.Role.row.tracking == 0)
  }
}
