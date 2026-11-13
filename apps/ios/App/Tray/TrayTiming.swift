import SwiftUI
import UIKit

struct TrayTiming {
  enum Curve {
    case system(UIView.AnimationOptions)
    case spring(bounce: CGFloat)
  }

  let duration: TimeInterval
  let curve: Curve

  static let keyboardSpring: TimeInterval = 0.2667
  static let open = TrayTiming(duration: keyboardSpring, curve: .spring(bounce: 0))
  static let close = TrayTiming(duration: keyboardSpring, curve: .spring(bounce: 0))
  static let grow = TrayTiming(duration: 0.4, curve: .spring(bounce: 0.12))
  static let shrink = TrayTiming(duration: 0.3, curve: .spring(bounce: 0))
  static let fade = TrayTiming(duration: 0.2, curve: .system(.curveEaseOut))
  static let contentSwap = TrayTiming(duration: 0.15, curve: .system(.curveEaseOut))

  init(duration: TimeInterval, curve: Curve) {
    self.duration = duration
    self.curve = curve
  }

  init?(keyboard notification: Notification) {
    let info = notification.userInfo ?? [:]
    guard let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double, duration > 0 else { return nil }
    let curve = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int) ?? UIView.AnimationCurve.easeInOut.rawValue
    self.init(duration: duration, curve: .system(UIView.AnimationOptions(rawValue: UInt(curve) << 16)))
  }

  var swiftUI: Animation {
    switch curve {
    case .system: .easeOut(duration: duration)
    case .spring(let bounce): .spring(duration: duration, bounce: bounce)
    }
  }

  func animate(_ changes: @escaping () -> Void, completion: ((Bool) -> Void)? = nil) {
    let shared: UIView.AnimationOptions = [.beginFromCurrentState, .allowUserInteraction]
    switch curve {
    case .system(let options):
      UIView.animate(withDuration: duration, delay: 0, options: options.union(shared), animations: changes, completion: completion)
    case .spring(let bounce):
      UIView.animate(springDuration: duration, bounce: bounce, initialSpringVelocity: 0, delay: 0, options: shared, animations: changes, completion: completion)
    }
  }
}

struct TrayCurve {
  let samples: [CGFloat]

  static let sampleCount = 64

  init(matching animation: CABasicAnimation) {
    let duration = max(animation.duration, 0.001)
    let times = (0..<Self.sampleCount).map { duration * Double($0) / Double(Self.sampleCount - 1) }
    if let spring = animation as? CASpringAnimation {
      samples = times.map { CGFloat(Self.springProgress(spring, at: $0)) }
    } else if let timing = animation.timingFunction {
      samples = times.map { CGFloat(Self.bezierProgress(timing, at: $0 / duration)) }
    } else {
      samples = times.map { CGFloat($0 / duration) }
    }
  }

  static func springProgress(_ spring: CASpringAnimation, at time: Double) -> Double {
    let mass = max(Double(spring.mass), 0.0001)
    let stiffness = Double(spring.stiffness)
    let damping = Double(spring.damping)
    let velocity = Double(spring.initialVelocity)
    let natural = (stiffness / mass).squareRoot()
    let ratio = damping / (2 * (stiffness * mass).squareRoot())
    let remaining: Double
    if abs(ratio - 1) < 0.0001 {
      remaining = (1 + (natural - velocity) * time) * exp(-natural * time)
    } else if ratio < 1 {
      let damped = natural * (1 - ratio * ratio).squareRoot()
      remaining = exp(-ratio * natural * time) * (cos(damped * time) + (ratio * natural - velocity) / damped * sin(damped * time))
    } else {
      let root = (ratio * ratio - 1).squareRoot()
      let fast = -natural * (ratio + root)
      let slow = -natural * (ratio - root)
      let slowShare = (-velocity - fast) / (slow - fast)
      remaining = slowShare * exp(slow * time) + (1 - slowShare) * exp(fast * time)
    }
    return 1 - remaining
  }

  static func bezierProgress(_ timing: CAMediaTimingFunction, at share: Double) -> Double {
    var first: [Float] = [0, 0]
    var second: [Float] = [0, 0]
    timing.getControlPoint(at: 1, values: &first)
    timing.getControlPoint(at: 2, values: &second)
    let x1 = Double(first[0]), y1 = Double(first[1]), x2 = Double(second[0]), y2 = Double(second[1])
    func bezier(_ t: Double, _ a: Double, _ b: Double) -> Double {
      3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
    }
    var low = 0.0
    var high = 1.0
    for _ in 0..<32 {
      let mid = (low + high) / 2
      if bezier(mid, x1, x2) < share { low = mid } else { high = mid }
    }
    return bezier((low + high) / 2, y1, y2)
  }
}
