import ArdiaBrowser
import ArdiaDesign
import QuartzCore
import SwiftUI
import UIKit

@Observable
final class PagerModel {
  struct Settle {
    var from: CGFloat
    var to: CGFloat
    var velocity: CGFloat
    var start: CFTimeInterval
  }

  var isActive = false
  var offset: CGFloat = 0
  var current: BrowserTab?
  var left: BrowserTab?
  var right: BrowserTab?
  var images: [UUID: UIImage] = [:]

  @ObservationIgnored var order: [BrowserTab] = []
  @ObservationIgnored var isTracking = false
  @ObservationIgnored var trackingBase: CGFloat = 0
  @ObservationIgnored var activationTranslation: CGFloat = 0
  @ObservationIgnored var settle: Settle?
  @ObservationIgnored var generation = 0

  var hasLeft: Bool { left != nil }
  var hasRight: Bool { right != nil }

  func begin(order: [BrowserTab], currentID: UUID?) -> Bool {
    guard let index = order.firstIndex(where: { $0.id == currentID }) else { return false }
    self.order = order
    current = order[index]
    left = index > 0 ? order[index - 1] : nil
    right = index + 1 < order.count ? order[index + 1] : nil
    isActive = true
    return true
  }

  func presentedOffset(at time: CFTimeInterval = CACurrentMediaTime()) -> CGFloat {
    guard let settle else { return offset }
    let delta = settle.to - settle.from
    guard abs(delta) > 0.5 else { return settle.to }
    let elapsed = max(0, time - settle.start)
    let moved = Motion.pagerSettle.value(target: delta, initialVelocity: settle.velocity, time: elapsed)
    return settle.from + moved
  }

  func catchSettle() {
    guard settle != nil else { return }
    let caught = presentedOffset()
    settle = nil
    generation += 1
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) { offset = caught }
  }

  func reset() {
    generation += 1
    settle = nil
    isTracking = false
    order = []
    current = nil
    left = nil
    right = nil
    offset = 0
    isActive = false
  }
}
