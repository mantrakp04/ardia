import Foundation
import SwiftUI

enum BarDemo {
  static let arguments = ProcessInfo.processInfo.arguments

  static var isDemo: Bool { arguments.contains("-ArdiaDemo") }

  static let startsCompact = isDemo && arguments.contains("-BrowseCollapsed")

  static let verticalEdge: HorizontalEdge? = {
    guard isDemo, let index = arguments.firstIndex(of: "-BrowseVerticalBar"), index + 1 < arguments.count else { return nil }
    switch arguments[index + 1] {
    case "leading": return .leading
    case "trailing": return .trailing
    default: return nil
    }
  }()

  static let showsFind = isDemo && arguments.contains("-BrowseFind")
}
