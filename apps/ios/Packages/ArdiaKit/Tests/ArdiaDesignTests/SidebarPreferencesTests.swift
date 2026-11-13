import ArdiaDesign
import Foundation
import SwiftUI
import Testing

struct SidebarPreferencesTests {
  private func freshDefaults() -> UserDefaults {
    let name = "sidebar-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test func `a new install uses the default width and shows the docked sidebar`() {
    let preferences = SidebarPreferences(defaults: freshDefaults())
    #expect(preferences.width == SidebarMetrics.defaultWidth)
    #expect(preferences.hidesDocked == false)
  }

  @Test func `a stored width survives a relaunch`() {
    let defaults = freshDefaults()
    SidebarPreferences(defaults: defaults).storeWidth(312)
    #expect(SidebarPreferences(defaults: defaults).width == 312)
  }

  @Test func `stored widths are clamped to the range, on the way in and on the way out`() {
    let defaults = freshDefaults()
    let preferences = SidebarPreferences(defaults: defaults)
    preferences.storeWidth(9_000)
    #expect(preferences.width == SidebarMetrics.widthRange.upperBound)
    preferences.storeWidth(12)
    #expect(preferences.width == SidebarMetrics.widthRange.lowerBound)
    defaults.set(1_000.0, forKey: SidebarPreferences.widthKey)
    #expect(preferences.width == SidebarMetrics.widthRange.upperBound)
    defaults.set(Double.nan, forKey: SidebarPreferences.widthKey)
    #expect(preferences.width == SidebarMetrics.defaultWidth)
  }

  @Test func `resetting forgets the width and goes back to the default`() {
    let defaults = freshDefaults()
    let preferences = SidebarPreferences(defaults: defaults)
    preferences.storeWidth(350)
    preferences.resetWidth()
    #expect(preferences.width == SidebarMetrics.defaultWidth)
    #expect(defaults.object(forKey: SidebarPreferences.widthKey) == nil)
  }

  @Test func `the docked sidebar's hidden state is remembered`() {
    let defaults = freshDefaults()
    SidebarPreferences(defaults: defaults).storeHidesDocked(true)
    #expect(SidebarPreferences(defaults: defaults).hidesDocked == true)
    SidebarPreferences(defaults: defaults).storeHidesDocked(false)
    #expect(SidebarPreferences(defaults: defaults).hidesDocked == false)
  }

  @Test func `dragging the edge grows the sidebar toward the page on either side`() {
    #expect(SidebarWidth.dragged(from: 260, by: 40, sidebarOn: .leading) == 300)
    #expect(SidebarWidth.dragged(from: 260, by: -40, sidebarOn: .leading) == 220)
    #expect(SidebarWidth.dragged(from: 260, by: -40, sidebarOn: .trailing) == 300)
    #expect(SidebarWidth.dragged(from: 260, by: 40, sidebarOn: .trailing) == 220)
  }

  @Test func `a drag stops at the ends of the range`() {
    #expect(SidebarWidth.dragged(from: 260, by: 500, sidebarOn: .leading) == SidebarMetrics.widthRange.upperBound)
    #expect(SidebarWidth.dragged(from: 260, by: -500, sidebarOn: .leading) == SidebarMetrics.widthRange.lowerBound)
  }

  @Test func `the sidebar never takes more than the window can spare for the page`() {
    #expect(SidebarWidth.fitted(400, windowWidth: 700) == 280)
    #expect(SidebarWidth.fitted(260, windowWidth: 1_366) == 260)
    #expect(SidebarWidth.fitted(260, windowWidth: 400) == SidebarMetrics.widthRange.lowerBound)
  }

  @Test func `the Mac's sidebar side picks the edge, and the leading edge is the default`() {
    #expect(SidebarWidth.edge(macSide: nil) == .leading)
    #expect(SidebarWidth.edge(macSide: "left") == .leading)
    #expect(SidebarWidth.edge(macSide: "right") == .trailing)
    #expect(SidebarWidth.edge(macSide: "middle") == .leading)
  }
}
