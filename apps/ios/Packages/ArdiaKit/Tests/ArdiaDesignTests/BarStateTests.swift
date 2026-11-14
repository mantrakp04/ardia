import ArdiaDesign
import CoreGraphics
import SwiftUI
import Testing

struct BarStateTests {
  @Test func `scrolling down shrinks the bar and anything else brings it back`() {
    let full = BarCollapse()
    let compact = full.applying(.scrolledDown, allowsCompact: true)
    #expect(compact.isCompact)
    for event in [BarCollapse.Event.scrolledUp, .reachedTop, .tapped, .pageChanged] {
      #expect(!compact.applying(event, allowsCompact: true).isCompact)
    }
  }

  @Test func `a bar that may not shrink never does`() {
    #expect(!BarCollapse().applying(.scrolledDown, allowsCompact: false).isCompact)
    #expect(!BarCollapse(isCompact: true).applying(.scrolledDown, allowsCompact: false).isCompact)
  }

  @Test func `the bar shrinks when the setting is on or the phone is on its side, never as a rail`() {
    #expect(BarCollapse.allowsCompact(settingIsOn: true, isLandscape: false, axis: .horizontal))
    #expect(BarCollapse.allowsCompact(settingIsOn: false, isLandscape: true, axis: .horizontal))
    #expect(!BarCollapse.allowsCompact(settingIsOn: false, isLandscape: false, axis: .horizontal))
    #expect(!BarCollapse.allowsCompact(settingIsOn: true, isLandscape: true, axis: .vertical(.trailing)))
  }

  @Test func `whatever hides the bar hides it whatever its size`() {
    #expect(BarPresence.resolve(collapse: BarCollapse(), isShown: false) == .hidden)
    #expect(BarPresence.resolve(collapse: BarCollapse(isCompact: true), isShown: false) == .hidden)
    #expect(BarPresence.resolve(collapse: BarCollapse(isCompact: true), isShown: true) == .compact)
    #expect(BarPresence.resolve(collapse: BarCollapse(), isShown: true) == .full)
    #expect(!BarPresence.hidden.isInteractive)
  }

  @Test func `find and the search tray hide the bar through BottomBarVisibility`() {
    var visibility = BottomBarVisibility()
    visibility.findSessionChanged(isActive: true)
    #expect(BarPresence.resolve(collapse: BarCollapse(), isShown: visibility.isShown(searchTrayPresented: false)) == .hidden)
    visibility.keyboardWillShow()
    visibility.findSessionChanged(isActive: false)
    #expect(BarPresence.resolve(collapse: BarCollapse(), isShown: visibility.isShown(searchTrayPresented: false)) == .hidden)
    visibility.keyboardDidHide()
    #expect(BarPresence.resolve(collapse: BarCollapse(), isShown: visibility.isShown(searchTrayPresented: false)) == .full)
    #expect(BarPresence.resolve(collapse: BarCollapse(isCompact: true), isShown: visibility.isShown(searchTrayPresented: true)) == .hidden)
  }

  @Test func `the keyboard lift comes from the guide's overlap`() {
    #expect(KeyboardLift.overlap(guideFrame: CGRect(x: 0, y: 500, width: 402, height: 374), containerHeight: 874) == 374)
    #expect(KeyboardLift.overlap(guideFrame: CGRect(x: 0, y: 874, width: 402, height: 0), containerHeight: 874) == 0)
    #expect(KeyboardLift.overlap(guideFrame: .null, containerHeight: 874) == 0)
    #expect(KeyboardLift.isSoftwareKeyboardUp(336))
    #expect(!KeyboardLift.isSoftwareKeyboardUp(55))
    #expect(KeyboardLift.lift(overlap: 55, safeBottom: 34, restsWithoutKeyboard: true) == 55)
    #expect(KeyboardLift.lift(overlap: 0, safeBottom: 34, restsWithoutKeyboard: true) == 34)
    #expect(KeyboardLift.lift(overlap: 0, safeBottom: 34, restsWithoutKeyboard: false) == 0)
  }

  @Test func `the start screen stacks on a phone and sits side by side when short and wide`() {
    let portrait = StartLayout(container: CGSize(width: 402, height: 874), safeArea: EdgeInsets(top: 62, leading: 0, bottom: 34, trailing: 0))
    #expect(!portrait.isSideBySide)
    #expect(portrait.gridWidth == 402 - StartLayout.margin * 2)
    let landscape = StartLayout(container: CGSize(width: 874, height: 402), safeArea: EdgeInsets(top: 0, leading: 62, bottom: 21, trailing: 62))
    #expect(landscape.isSideBySide)
    #expect(landscape.headerWidth + landscape.gridWidth + StartLayout.sectionGap == landscape.contentWidth)
    let wide = StartLayout(container: CGSize(width: 639, height: 900), safeArea: EdgeInsets())
    #expect(wide.gridWidth == StartLayout.maxContentWidth)
  }

  @Test func `the bar's ink follows the page under it, private or not`() {
    #expect(BarInk.scheme(pageIsDark: false, systemIsDark: true) == .light)
    #expect(BarInk.scheme(pageIsDark: true, systemIsDark: false) == .dark)
    #expect(BarInk.scheme(pageIsDark: nil, systemIsDark: true) == .dark)
    #expect(BarInk.scheme(pageIsDark: nil, systemIsDark: false) == .light)
  }

  @Test func `a page at its top moves below a new top inset and a scrolled page stays put`() {
    #expect(PageInsets.restingOffset(offsetY: 0, oldAdjustedTop: 0, newAdjustedTop: 64) == -64)
    #expect(PageInsets.restingOffset(offsetY: -64, oldAdjustedTop: 64, newAdjustedTop: 0) == 0)
    #expect(PageInsets.restingOffset(offsetY: 0.5, oldAdjustedTop: 0, newAdjustedTop: 64) == -64)
    #expect(PageInsets.restingOffset(offsetY: 300, oldAdjustedTop: 0, newAdjustedTop: 64) == nil)
    #expect(PageInsets.restingOffset(offsetY: -64, oldAdjustedTop: 64, newAdjustedTop: 64) == nil)
  }
}
