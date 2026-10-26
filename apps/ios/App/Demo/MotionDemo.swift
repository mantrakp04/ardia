import Foundation

enum MotionDemo {
  static let arguments = ProcessInfo.processInfo.arguments

  static var isDemo: Bool { arguments.contains("-ArdiaDemo") }

  static let pagerFreeze: CGFloat? = isDemo ? value("-BrowsePagerFreeze").flatMap(Double.init).map { CGFloat($0) } : nil

  static let pagerScript = isDemo && arguments.contains("-BrowsePagerScript")

  static let loadFreeze: Double? = isDemo ? value("-BrowseLoadFreeze").flatMap(Double.init) : nil

  static let delay: Double = value("-BrowseDelay").flatMap(Double.init) ?? 6

  private static func value(_ key: String) -> String? {
    guard let index = arguments.firstIndex(of: key), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
  }
}
