import Foundation

enum ToastDemo {
  static let holdsOnScreen = ProcessInfo.processInfo.arguments.contains("-ArdiaDemo")
    && ProcessInfo.processInfo.arguments.contains("-ArdiaToastHold")
}
