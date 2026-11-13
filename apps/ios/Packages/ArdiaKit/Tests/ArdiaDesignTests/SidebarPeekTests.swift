import ArdiaDesign
import Foundation
import SwiftUI
import Testing

struct SidebarPeekVisibilityTests {
  private let hiddenDocked = SidebarVisibility(hidesDocked: true)

  @Test func `a pointer peek floats the sidebar over a hidden docked sidebar without a scrim`() {
    let peeking = hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: nil)
    #expect(peeking.placement(layout: .sidebarDocked, hinge: nil) == .peek)
    #expect(!SidebarPlacement.peek.dimsPage)
    #expect(peeking.hidesDocked)
  }

  @Test func `a touch peek opens the overlay with its scrim, in either sidebar layout`() {
    #expect(hiddenDocked.peeking(.touch, layout: .sidebarDocked, hinge: nil).placement(layout: .sidebarDocked, hinge: nil) == .overlay)
    #expect(SidebarVisibility().peeking(.touch, layout: .sidebarOverlay, hinge: nil).placement(layout: .sidebarOverlay, hinge: nil) == .overlay)
    #expect(SidebarPlacement.overlay.dimsPage)
  }

  @Test func `a peek only starts while the sidebar is hidden`() {
    let docked = SidebarVisibility()
    #expect(docked.peeking(.pointer, layout: .sidebarDocked, hinge: nil) == docked)
    let open = SidebarVisibility(isOverlayOpen: true)
    #expect(open.peeking(.pointer, layout: .sidebarOverlay, hinge: nil) == open)
    #expect(hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: .partial) == hiddenDocked)
    #expect(hiddenDocked.peeking(.pointer, layout: .bar, hinge: nil) == hiddenDocked)
  }

  @Test func `ending a peek goes back to hidden and never touches the saved choice`() {
    let ended = hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: nil).endingPeek()
    #expect(ended == hiddenDocked)
    #expect(ended.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
  }

  @Test func `the toggle pins a pointer peek and closes a touch peek, which looks like the overlay`() {
    let pointer = hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: nil).toggled(in: .sidebarDocked)
    #expect(pointer.placement(layout: .sidebarDocked, hinge: nil) == .docked)
    #expect(pointer.peek == nil)
    let touch = hiddenDocked.peeking(.touch, layout: .sidebarDocked, hinge: nil).toggled(in: .sidebarDocked)
    #expect(touch.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    #expect(touch.hidesDocked)
    let touchNarrow = SidebarVisibility().peeking(.touch, layout: .sidebarOverlay, hinge: nil).toggled(in: .sidebarOverlay)
    #expect(touchNarrow.placement(layout: .sidebarOverlay, hinge: nil) == .hidden)
    #expect(hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: nil).toggleAction(layout: .sidebarDocked, hinge: nil) == .pin)
    #expect(hiddenDocked.peeking(.touch, layout: .sidebarDocked, hinge: nil).toggleAction(layout: .sidebarDocked, hinge: nil) == .hide)
    let overlayLayout = SidebarVisibility().peeking(.pointer, layout: .sidebarOverlay, hinge: nil).toggled(in: .sidebarOverlay)
    #expect(overlayLayout.placement(layout: .sidebarOverlay, hinge: nil) == .overlay)
    #expect(overlayLayout.peek == nil)
  }

  @Test func `dismissing the overlay closes a touch peek and leaves a pointer peek to the pointer`() {
    let touch = hiddenDocked.peeking(.touch, layout: .sidebarDocked, hinge: nil).dismissingOverlay()
    #expect(touch.placement(layout: .sidebarDocked, hinge: nil) == .hidden)
    let pointer = hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: nil).dismissingOverlay()
    #expect(pointer.placement(layout: .sidebarDocked, hinge: nil) == .peek)
  }

  @Test func `a layout change ends any peek`() {
    let peeking = hiddenDocked.peeking(.pointer, layout: .sidebarDocked, hinge: nil)
    #expect(peeking.adapting(to: .sidebarOverlay).peek == nil)
    #expect(peeking.adapting(to: .sidebarDocked).peek == nil)
  }

  @Test func `the card keeps its hidden look under a pointer peek`() {
    #expect(SidebarPlacement.peek.showsHostCapsule)
    #expect(SidebarPlacement.peek.cardShowsSidebarToggle)
    #expect(SidebarPlacement.hidden.cardShowsSidebarToggle)
    #expect(!SidebarPlacement.docked.cardShowsSidebarToggle)
    #expect(!SidebarPlacement.peek.sidebarBesidePage)
  }
}

struct SidebarPeekDecisionTests {
  @Test func `the pointer reveals the sidebar from the window's edge gutter only`() {
    #expect(SidebarPeek.pointerZone(x: 0, windowWidth: 1_000, edge: .leading, sidebarWidth: 260, isPeeking: false) == .reveal)
    #expect(SidebarPeek.pointerZone(x: SidebarPeek.pointerStrip - 1, windowWidth: 1_000, edge: .leading, sidebarWidth: 260, isPeeking: false) == .reveal)
    #expect(SidebarPeek.pointerZone(x: SidebarPeek.pointerStrip, windowWidth: 1_000, edge: .leading, sidebarWidth: 260, isPeeking: false) == .outside)
    #expect(SidebarPeek.pointerZone(x: 999, windowWidth: 1_000, edge: .trailing, sidebarWidth: 260, isPeeking: false) == .reveal)
    #expect(SidebarPeek.pointerZone(x: 2, windowWidth: 1_000, edge: .trailing, sidebarWidth: 260, isPeeking: false) == .outside)
  }

  @Test func `a peek holds over the sidebar and the Mac's slack beyond it`() {
    let reach = SidebarMetrics.cardInset + 260 + SidebarPeek.holdSlack
    #expect(SidebarPeek.pointerZone(x: reach - 1, windowWidth: 1_000, edge: .leading, sidebarWidth: 260, isPeeking: true) == .hold)
    #expect(SidebarPeek.pointerZone(x: reach, windowWidth: 1_000, edge: .leading, sidebarWidth: 260, isPeeking: true) == .outside)
    #expect(SidebarPeek.pointerZone(x: 1_000 - reach + 1, windowWidth: 1_000, edge: .trailing, sidebarWidth: 260, isPeeking: true) == .hold)
    #expect(SidebarPeek.pointerZone(x: 1_000 - reach, windowWidth: 1_000, edge: .trailing, sidebarWidth: 260, isPeeking: true) == .outside)
  }

  @Test func `the pointer strip is the gutter between the window edge and the page card`() {
    #expect(SidebarPeek.pointerStrip == SidebarMetrics.touch(8))
    #expect(SidebarPeek.pointerStrip <= SidebarMetrics.cardInset)
    #expect(SidebarPeek.holdSlack == SidebarMetrics.touch(24))
  }

  @Test func `a touch swipe starts only in the outermost edge zone, outside the page`() {
    #expect(SidebarPeek.startsEdgeSwipe(x: 0, windowWidth: 1_000, edge: .leading))
    #expect(SidebarPeek.startsEdgeSwipe(x: SidebarPeek.touchZone - 1, windowWidth: 1_000, edge: .leading))
    #expect(!SidebarPeek.startsEdgeSwipe(x: SidebarPeek.touchZone, windowWidth: 1_000, edge: .leading))
    #expect(SidebarPeek.startsEdgeSwipe(x: 999, windowWidth: 1_000, edge: .trailing))
    #expect(!SidebarPeek.startsEdgeSwipe(x: 1, windowWidth: 1_000, edge: .trailing))
    #expect(SidebarPeek.touchZone <= SidebarMetrics.cardInset)
  }

  @Test func `the pull follows the finger toward the page and stops at fully open`() {
    #expect(SidebarPeek.openProgress(from: 0, translation: 130, width: 260, edge: .leading) == 0.5)
    #expect(SidebarPeek.openProgress(from: 0, translation: -130, width: 260, edge: .trailing) == 0.5)
    #expect(SidebarPeek.openProgress(from: 0, translation: 900, width: 260, edge: .leading) == 1)
    #expect(SidebarPeek.openProgress(from: 0, translation: -40, width: 260, edge: .leading) == 0)
    #expect(SidebarPeek.openProgress(from: 1, translation: -130, width: 260, edge: .leading) == 0.5)
    #expect(SidebarPeek.openProgress(from: 1, translation: 130, width: 260, edge: .trailing) == 0.5)
  }

  @Test func `release settles open by distance or a flick, and closed by a flick back`() {
    #expect(SidebarPeek.settlesOpen(progress: 0.6, velocity: 0, width: 260, edge: .leading))
    #expect(!SidebarPeek.settlesOpen(progress: 0.3, velocity: 0, width: 260, edge: .leading))
    #expect(SidebarPeek.settlesOpen(progress: 0.2, velocity: 1_200, width: 260, edge: .leading))
    #expect(!SidebarPeek.settlesOpen(progress: 0.8, velocity: -1_200, width: 260, edge: .leading))
    #expect(SidebarPeek.settlesOpen(progress: 0.2, velocity: -1_200, width: 260, edge: .trailing))
    #expect(!SidebarPeek.settlesOpen(progress: 0.9, velocity: 1_200, width: 260, edge: .trailing))
  }

  @Test func `a swipe back is a mostly sideways drag toward the edge`() {
    #expect(SidebarPeek.isSwipeBack(translation: CGSize(width: -40, height: 10), edge: .leading))
    #expect(!SidebarPeek.isSwipeBack(translation: CGSize(width: 40, height: 10), edge: .leading))
    #expect(!SidebarPeek.isSwipeBack(translation: CGSize(width: -20, height: 60), edge: .leading))
    #expect(SidebarPeek.isSwipeBack(translation: CGSize(width: 40, height: 5), edge: .trailing))
  }

  @Test func `the peek panel takes the Mac's panel radius, never rounder than the card`() {
    #expect(SidebarPeek.panelRadius(cardRadius: 20) == SidebarMetrics.touch(Tokens.Radius.panel))
    #expect(SidebarPeek.panelRadius(cardRadius: 12) == 12)
  }
}

struct SidebarPeekMacValueTests {
  private func macSource(_ path: String) throws -> String {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { root.deleteLastPathComponent() }
    return try String(contentsOf: root.appending(path: path), encoding: .utf8)
  }

  private func number(named name: String, in source: String) -> Double? {
    let pattern = try! Regex("const \(name) = ([0-9.]+);", as: (Substring, Substring).self)
    return source.firstMatch(of: pattern).flatMap { Double($0.1) }
  }

  @Test func `the strip, the slack and the leave delay are the Mac's own numbers`() throws {
    let dock = try macSource("apps/browser/src/components/window/dockMotion.ts")
    let peek = try macSource("apps/browser/src/components/window/usePeek.ts")
    #expect(number(named: "PEEK_EDGE_STRIP", in: dock).map { SidebarMetrics.touch(CGFloat($0)) } == SidebarPeek.pointerStrip)
    #expect(number(named: "PEEK_HOLD_SLACK", in: dock).map { SidebarMetrics.touch(CGFloat($0)) } == SidebarPeek.holdSlack)
    #expect(number(named: "HIDE_DELAY_MS", in: peek).map { Duration.milliseconds($0) } == SidebarPeek.leaveDelay)
    #expect(!peek.contains("setTimeout(show"))
    #expect(SidebarPeek.dwell == .zero)
  }

  @Test func `the slide in and out come from the Mac's window tokens`() {
    #expect(Tokens.Spring.sidebarPeek == SpringToken(response: 0.18, dampingFraction: 0.8))
    #expect(Tokens.Duration.sidebarPeekOut == 0.15)
  }
}

struct SidebarEdgeSettingTests {
  @Test func `with the setting on, the pointer in the gutter and a swipe from the edge start a peek`() {
    #expect(SidebarPeek.startsPeek(.pointer, at: 2, windowWidth: 1_000, edge: .leading, placement: .hidden, isEnabled: true))
    #expect(SidebarPeek.startsPeek(.touch, at: 2, windowWidth: 1_000, edge: .leading, placement: .hidden, isEnabled: true))
    #expect(SidebarPeek.startsPeek(.touch, at: 998, windowWidth: 1_000, edge: .trailing, placement: .hidden, isEnabled: true))
  }

  @Test func `with the setting off, nothing at the edge starts a peek`() {
    #expect(!SidebarPeek.startsPeek(.pointer, at: 2, windowWidth: 1_000, edge: .leading, placement: .hidden, isEnabled: false))
    #expect(!SidebarPeek.startsPeek(.touch, at: 2, windowWidth: 1_000, edge: .leading, placement: .hidden, isEnabled: false))
    #expect(!SidebarPeek.allowsPeek(placement: .hidden, isEnabled: false))
  }

  @Test func `inputs away from the edge, or with the sidebar not hidden, never start a peek`() {
    #expect(!SidebarPeek.startsPeek(.pointer, at: 300, windowWidth: 1_000, edge: .leading, placement: .hidden, isEnabled: true))
    #expect(!SidebarPeek.startsPeek(.touch, at: 300, windowWidth: 1_000, edge: .leading, placement: .hidden, isEnabled: true))
    for placement: SidebarPlacement in [.docked, .peek, .overlay, .foldSplit, .none] {
      #expect(!SidebarPeek.startsPeek(.pointer, at: 2, windowWidth: 1_000, edge: .leading, placement: placement, isEnabled: true))
      #expect(!SidebarPeek.startsPeek(.touch, at: 2, windowWidth: 1_000, edge: .leading, placement: placement, isEnabled: true))
    }
  }

  @Test func `the setting is offered only where a sidebar can exist`() {
    #expect(SidebarPeek.offersEdgeSetting(layout: .bar, hinge: nil, isTablet: true))
    #expect(SidebarPeek.offersEdgeSetting(layout: .bar, hinge: .closed, isTablet: false))
    #expect(SidebarPeek.offersEdgeSetting(layout: .sidebarOverlay, hinge: nil, isTablet: false))
    #expect(!SidebarPeek.offersEdgeSetting(layout: .bar, hinge: nil, isTablet: false))
  }
}
