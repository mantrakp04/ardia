import ArdiaDesign
import SwiftUI
import Testing

struct TokenTypesTests {
  @Test func `a token colour keeps its channels from hex`() {
    let colour = TokenColor(hex: 0xB25B6B, opacity: 0.5)
    #expect(colour.red == 178.0 / 255)
    #expect(colour.green == 91.0 / 255)
    #expect(colour.blue == 107.0 / 255)
    #expect(colour.opacity == 0.5)
  }

  @Test func `mixing moves the channels and keeps the opacity`() {
    let white = TokenColor(hex: 0xFFFFFF, opacity: 0.2)
    let mixed = white.mixed(toward: TokenColor(hex: 0x000000), by: 0.25)
    #expect(mixed.red == 0.75 && mixed.green == 0.75 && mixed.blue == 0.75)
    #expect(mixed.opacity == 0.2)
    #expect(white.withOpacity(0.9).opacity == 0.9)
    #expect(white.withOpacity(0.9).red == 1)
  }

  @Test func `a scheme colour resolves per appearance`() {
    #expect(Tokens.Role.textTab.resolved(dark: true).opacity > 0.78)
    #expect(Tokens.Role.textTab.resolved(dark: false).opacity < 0.68)
    #expect(Tokens.Role.destructive.resolved(dark: true) == TokenColor(hex: 0xFF453A))
  }

  @Test func `the Mac's springs keep response and damping`() {
    #expect(Tokens.Spring.snappy == SpringToken(response: 0.2, dampingFraction: 0.9))
    #expect(Tokens.Spring.sidebarDock.response == 0.215)
  }

  @Test func `shadows resolve their opacity per appearance`() {
    #expect(Tokens.Shadow.popover.opacity.resolved(dark: true) == 0.45)
    #expect(Tokens.Shadow.popover.opacity.resolved(dark: false) == 0.16)
  }

  @Test func `concentric corners shrink by the inset and stop at zero`() {
    let window = RectangleCornerRadii(topLeading: 8, bottomLeading: 8, bottomTrailing: 59, topTrailing: 59)
    let card = window.concentric(inset: 10)
    #expect(card.topLeading == 0)
    #expect(card.topTrailing == 49)
    #expect(window.largest == 59)
    #expect(RectangleCornerRadii(uniform: 55).concentric(inset: 10) == RectangleCornerRadii(uniform: 45))
  }
}
