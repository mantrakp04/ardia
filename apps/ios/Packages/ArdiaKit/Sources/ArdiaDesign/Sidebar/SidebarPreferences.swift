import Foundation
import SwiftUI

public struct SidebarPreferences {
  public static let widthKey = "sidebar.width"
  public static let hidesDockedKey = "sidebar.hidesDocked"

  private let defaults: UserDefaults

  public init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  public var width: CGFloat {
    let stored = defaults.double(forKey: Self.widthKey)
    guard defaults.object(forKey: Self.widthKey) != nil, stored.isFinite else { return SidebarMetrics.defaultWidth }
    return SidebarMetrics.clampedWidth(stored)
  }

  public func storeWidth(_ width: CGFloat) {
    guard width.isFinite else { return }
    defaults.set(Double(SidebarMetrics.clampedWidth(width)), forKey: Self.widthKey)
  }

  public func resetWidth() {
    defaults.removeObject(forKey: Self.widthKey)
  }

  public var hidesDocked: Bool {
    defaults.bool(forKey: Self.hidesDockedKey)
  }

  public func storeHidesDocked(_ hides: Bool) {
    defaults.set(hides, forKey: Self.hidesDockedKey)
  }
}

public enum SidebarWidth {
  public static let pageShareFloor: CGFloat = 0.6

  public static func dragged(from start: CGFloat, by translation: CGFloat, sidebarOn edge: HorizontalEdge) -> CGFloat {
    SidebarMetrics.clampedWidth(edge == .leading ? start + translation : start - translation)
  }

  public static func fitted(_ width: CGFloat, windowWidth: CGFloat) -> CGFloat {
    let spare = (windowWidth * (1 - pageShareFloor)).rounded(.down)
    return max(SidebarMetrics.widthRange.lowerBound, min(width, spare))
  }

  public static func adjusted(_ saved: CGFloat, by step: CGFloat, windowWidth: CGFloat) -> CGFloat {
    SidebarMetrics.clampedWidth(fitted(saved, windowWidth: windowWidth) + step)
  }

  public static func isResizeDrag(_ translation: CGSize) -> Bool {
    abs(translation.width) > abs(translation.height)
  }

  public static func edge(macSide: String?) -> HorizontalEdge {
    macSide == "right" ? .trailing : .leading
  }
}
