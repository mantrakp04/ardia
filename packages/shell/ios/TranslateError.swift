import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

enum TranslateError: LocalizedError {
  case unavailable, noWindow
  var errorDescription: String? {
    switch self {
    case .unavailable: return "needs macOS 26"
    case .noWindow: return "no window to ask in"
    }
  }
}
