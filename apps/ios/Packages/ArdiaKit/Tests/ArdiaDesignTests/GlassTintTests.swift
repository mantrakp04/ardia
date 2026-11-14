@testable import ArdiaDesign
import SwiftUI
import Testing

struct GlassTintTests {
  private func close(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.0005 }

  @Test func `the tint amount is held to the Mac's 0 to 1 range`() {
    #expect(GlassTint.control(.active, dark: true, amount: 3) == GlassTint.control(.active, dark: true, amount: 1))
    #expect(GlassTint.control(.rest, dark: true, amount: -1) == GlassTint.control(.rest, dark: true, amount: 0))
  }

  @Test func `control glass leans toward the palette accent, not the space`() {
    for dark in [true, false] {
      let tinted = GlassTint.control(.rest, dark: dark, amount: 1)
      let accent = Tokens.Role.accent.resolved(dark: dark)
      #expect(close(tinted.red, accent.red) && close(tinted.green, accent.green) && close(tinted.blue, accent.blue))
    }
  }

  @Test func `a tinted panel takes a fixed share of the space's colour whatever the amount`() {
    #expect(GlassTint.panel(dark: false, look: .plum, amount: 0.8) == GlassTint.panel(dark: false, look: .plum, amount: 0.2))
    #expect(GlassTint.panel(dark: false, look: .plum, amount: 0.8) != GlassTint.panel(dark: false, look: .plum, amount: 0))
  }

  @Test func `Reduce Transparency forces the classic style`() {
    #expect(InterfaceStyle.glass.resolved(reduceTransparency: true) == .classic)
    #expect(InterfaceStyle.glass.resolved(reduceTransparency: false) == .glass)
    #expect(InterfaceStyle.classic.resolved(reduceTransparency: false) == .classic)
  }

  @Test func `classic controls use the Mac's flat tile fills`() {
    #expect(GlassState.rest.classicFill == Tokens.Role.pinnedResting)
    #expect(GlassState.lit.classicFill == Tokens.Role.tabHover)
    #expect(GlassState.pressed.classicFill == Tokens.Role.tabPressed)
    #expect(GlassState.active.classicFill == Tokens.Role.pinnedSelectedFill)
  }
}

struct GlassShapeTests {
  @Test func `a pill draws 32 points tall but stays a 44 point target`() {
    #expect(GlassControlShape.pill.minimumSize == CGSize(width: GlassMetrics.hitTarget, height: Tokens.Space.huge))
    let hit = GlassHitArea(minimum: GlassMetrics.hitTarget).path(in: CGRect(x: 0, y: 0, width: 120, height: 32)).boundingRect
    #expect(hit == CGRect(x: 0, y: -6, width: 120, height: 44))
  }

  @Test func `a control already at the target size keeps its own hit area`() {
    let frame = CGRect(x: 0, y: 0, width: 62, height: 52)
    #expect(GlassHitArea(minimum: GlassMetrics.hitTarget).path(in: frame).boundingRect == frame)
    #expect(GlassControlShape.circle.minimumSize == CGSize(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget))
  }
}

struct GlassPlacementTests {
  private func close(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.0005 }

  @Test func `a token colour composites over an opaque base into an opaque colour`() {
    let mixed = TokenColor(hex: 0xFFFFFF, opacity: 0.1).composited(over: TokenColor(hex: 0x2A2A2A))
    #expect(mixed.opacity == 1)
    #expect(close(mixed.red, (42 + 213 * 0.1) / 255))
  }

  @Test func `classic controls over content are opaque in every state and scheme`() {
    for state in GlassState.allCases {
      #expect(state.classicFill(.overContent).dark.opacity == 1)
      #expect(state.classicFill(.overContent).light.opacity == 1)
    }
  }

  @Test func `classic controls over content still show their state`() {
    let rest = GlassState.rest.classicFill(.overContent)
    let lit = GlassState.lit.classicFill(.overContent)
    let pressed = GlassState.pressed.classicFill(.overContent)
    #expect(close(rest.dark.red, (42 + 213 * 0.1) / 255))
    #expect(close(lit.dark.red, (42 + 213 * 0.14) / 255))
    #expect(close(pressed.dark.red, (42 + 213 * 0.2) / 255))
    #expect(rest.light.red == 1)
    #expect(close(lit.light.red, 247.0 / 255))
    #expect(close(pressed.light.red, 235.0 / 255))
    #expect(GlassState.active.classicFill(.overContent) == pressed)
  }

  @Test func `on a backdrop the classic fills stay the Mac's tile fills`() {
    for state in GlassState.allCases {
      #expect(state.classicFill(.backdrop) == state.classicFill)
    }
  }
}
