import CoreGraphics
import Foundation

struct CaptureSpring {
  private static let settledDistance = 0.05
  private static let settledSpeed = 0.5

  let response: Double
  let dampingRatio: Double
  private(set) var value: CGRect
  private var velocity = [0.0, 0.0, 0.0, 0.0]
  var target: CGRect

  init(response: Double, dampingRatio: Double, value: CGRect) {
    self.response = response
    self.dampingRatio = dampingRatio
    self.value = value
    target = value
  }

  var settled: Bool {
    let from = Self.components(value), to = Self.components(target)
    return zip(from, to).allSatisfy { abs($0 - $1) < Self.settledDistance } && velocity.allSatisfy { abs($0) < Self.settledSpeed }
  }

  mutating func jump(to rect: CGRect) {
    value = rect
    target = rect
    velocity = [0, 0, 0, 0]
  }

  mutating func advance(by seconds: Double) {
    let omega = 2 * Double.pi / response
    let zeta = dampingRatio
    let from = Self.components(value), to = Self.components(target)
    var next = from
    for index in 0..<4 {
      let offset = from[index] - to[index], speed = velocity[index]
      let moved: (offset: Double, speed: Double)
      if zeta < 1 {
        let damped = omega * (1 - zeta * zeta).squareRoot()
        let decay = exp(-zeta * omega * seconds)
        let sine = (speed + zeta * omega * offset) / damped
        let c = cos(damped * seconds), s = sin(damped * seconds)
        moved = (
          decay * (offset * c + sine * s),
          decay * ((sine * damped - zeta * omega * offset) * c - (offset * damped + zeta * omega * sine) * s)
        )
      } else {
        let decay = exp(-omega * seconds)
        let slope = speed + omega * offset
        moved = (decay * (offset + slope * seconds), decay * (speed - omega * slope * seconds))
      }
      next[index] = to[index] + moved.offset
      velocity[index] = moved.speed
    }
    value = CGRect(x: next[0], y: next[1], width: next[2], height: next[3])
    if settled { jump(to: target) }
  }

  private static func components(_ rect: CGRect) -> [Double] {
    [Double(rect.origin.x), Double(rect.origin.y), Double(rect.size.width), Double(rect.size.height)]
  }
}
