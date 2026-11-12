import SwiftUI

struct KeyboardCurve: CustomAnimation {
  static let rateTimesDuration = 4.5
  static let settledRemainder = 0.002

  let rate: Double

  func animate<V: VectorArithmetic>(value: V, time: TimeInterval, context: inout AnimationContext<V>) -> V? {
    let remainder = exp(-rate * time)
    guard remainder > Self.settledRemainder else { return nil }
    return value.scaled(by: 1 - remainder)
  }

  func velocity<V: VectorArithmetic>(value: V, time: TimeInterval, context: AnimationContext<V>) -> V? {
    value.scaled(by: rate * exp(-rate * time))
  }
}
