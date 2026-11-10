import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
final class KeyboardTracker {
  private(set) var animation: Animation? = KeyboardTracker.animation(duration: 0.25, curve: KeyboardTracker.systemCurve)
  @ObservationIgnored private var observers: [NSObjectProtocol] = []

  static let systemCurve = 7

  func start() {
    guard observers.isEmpty else { return }
    for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
      let observer = NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
        let info = notification.userInfo ?? [:]
        let duration = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curve = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int) ?? Self.systemCurve
        MainActor.assumeIsolated {
          self?.animation = Self.animation(duration: duration, curve: curve)
        }
      }
      observers.append(observer)
    }
  }

  static func animation(duration: Double, curve: Int) -> Animation? {
    guard duration > 0 else { return nil }
    if curve == systemCurve {
      return Animation(KeyboardCurve(rate: KeyboardCurve.rateTimesDuration / duration))
    }
    return .easeInOut(duration: duration)
  }
}
