import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
public final class SidebarState {
  public private(set) var visibility: SidebarVisibility
  public private(set) var width: CGFloat
  public var dragWidth: CGFloat?
  public var peekDrag: CGFloat?
  public var demoHoveredTab: UUID?
  @ObservationIgnored public private(set) var shouldAutoOpenSearch = true
  @ObservationIgnored private let preferences: SidebarPreferences
  @ObservationIgnored private var peekLeave: Task<Void, Never>?
  @ObservationIgnored private var peekReveal: Task<Void, Never>?

  public init(defaults: UserDefaults) {
    let preferences = SidebarPreferences(defaults: defaults)
    self.preferences = preferences
    visibility = SidebarVisibility(hidesDocked: preferences.hidesDocked)
    width = preferences.width
  }

  public static func launch(isDemo: Bool) -> SidebarState {
    let defaults = isDemo ? (UserDefaults(suiteName: "ardia.demo") ?? .standard) : .standard
    return SidebarState(defaults: defaults)
  }

  public var shownWidth: CGFloat { dragWidth ?? width }

  public func placement(layout: ChromeLayout, hinge: HingeState?) -> SidebarPlacement {
    visibility.placement(layout: layout, hinge: hinge)
  }

  public func toggleAction(layout: ChromeLayout, hinge: HingeState?) -> SidebarToggleAction? {
    visibility.toggleAction(layout: layout, hinge: hinge)
  }

  public func adapt(to layout: ChromeLayout) {
    cancelGestures()
    holdPeek()
    cancelPointerReveal()
    update(visibility.adapting(to: layout))
  }

  public func cancelGestures() {
    if peekDrag != nil { peekDrag = nil }
    if dragWidth != nil { dragWidth = nil }
  }

  public func toggle(layout: ChromeLayout, hinge: HingeState?) {
    guard SidebarVisibility.canToggle(layout: layout, hinge: hinge) else { return }
    holdPeek()
    update(visibility.toggled(in: layout))
    preferences.storeHidesDocked(visibility.hidesDocked)
  }

  public func dismissOverlay() {
    update(visibility.dismissingOverlay())
  }

  public func peek(_ kind: SidebarPeekKind, layout: ChromeLayout, hinge: HingeState?) {
    holdPeek()
    update(visibility.peeking(kind, layout: layout, hinge: hinge))
  }

  public func endPeek() {
    holdPeek()
    cancelPointerReveal()
    update(visibility.endingPeek())
  }

  public func revealPointerPeek(layout: ChromeLayout, hinge: HingeState?) {
    guard SidebarPeek.dwell > .zero else { return peek(.pointer, layout: layout, hinge: hinge) }
    guard peekReveal == nil else { return }
    peekReveal = Task { [weak self] in
      try? await Task.sleep(for: SidebarPeek.dwell)
      guard !Task.isCancelled, let self else { return }
      self.peekReveal = nil
      self.peek(.pointer, layout: layout, hinge: hinge)
    }
  }

  public func cancelPointerReveal() {
    peekReveal?.cancel()
    peekReveal = nil
  }

  public func holdPeek() {
    peekLeave?.cancel()
    peekLeave = nil
  }

  public func releasePointerPeek() {
    guard visibility.peek == .pointer, peekLeave == nil else { return }
    peekLeave = Task { [weak self] in
      try? await Task.sleep(for: SidebarPeek.leaveDelay)
      guard !Task.isCancelled, let self, self.visibility.peek == .pointer else { return }
      self.peekLeave = nil
      self.update(self.visibility.endingPeek())
    }
  }

  public func showEverywhere(_ shown: Bool) {
    update(SidebarVisibility(shownEverywhere: shown))
    preferences.storeHidesDocked(visibility.hidesDocked)
  }

  public func noteAutoOpenedSearch() {
    shouldAutoOpenSearch = false
  }

  public func notePageShown() {
    shouldAutoOpenSearch = true
  }

  public func commitWidth(_ proposed: CGFloat) {
    preferences.storeWidth(proposed)
    width = preferences.width
    dragWidth = nil
  }

  public func resetWidth() {
    preferences.resetWidth()
    width = preferences.width
    dragWidth = nil
  }

  private func update(_ next: SidebarVisibility) {
    if next != visibility { visibility = next }
  }
}
