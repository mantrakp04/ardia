import SwiftUI
import UIKit

struct TrayStageShare {
  let start: Double
  let end: Double

  static let sides = TrayStageShare(start: 0, end: 0.25)
  static let plusGlyph = TrayStageShare(start: 0.2, end: 0.6)
  static let field = TrayStageShare(start: 0.35, end: 0.85)
  static let titleField = TrayStageShare(start: 0.7, end: 1)
  static let results = TrayStageShare(start: 0.3, end: 0.8)
  static let surface = TrayStageShare(start: 0, end: 0.35)
  static let material = TrayStageShare(start: 0.1, end: 0.3)
  static let pillMaterial = TrayStageShare(start: 0.2, end: 0.8)
}

struct StagedFade {
  let view: UIView
  let share: TrayStageShare
  let rises: Bool

  static let animationKey = "trayStage"

  func opacity(at morph: CGFloat) -> CGFloat {
    let progress = (morph - share.start) / (share.end - share.start)
    return min(max(rises ? progress : 1 - progress, 0), 1)
  }

  func show(at morph: CGFloat) {
    view.layer.removeAnimation(forKey: Self.animationKey)
    UIView.performWithoutAnimation { view.alpha = opacity(at: morph) }
  }

  func stage(from start: CGFloat, to end: CGFloat, following template: CABasicAnimation?) {
    show(at: end)
    guard let template else { return }
    let samples = TrayCurve(matching: template).samples
    let staged = CAKeyframeAnimation(keyPath: "opacity")
    staged.values = samples.map { opacity(at: start + (end - start) * $0) }
    staged.keyTimes = samples.indices.map { NSNumber(value: Double($0) / Double(samples.count - 1)) }
    staged.calculationMode = .linear
    staged.duration = template.duration
    staged.beginTime = template.beginTime
    staged.speed = template.speed
    staged.fillMode = template.fillMode
    view.layer.add(staged, forKey: Self.animationKey)
  }
}

@Observable
final class TrayProgress {
  var value: CGFloat = 0
}

struct StagedArrival: ViewModifier, Animatable {
  var progress: CGFloat
  let order: Int

  static let firstStart: CGFloat = 0.28
  static let step: CGFloat = 0.07
  static let span: CGFloat = 0.42
  static let rise: CGFloat = 18
  static let restScale: CGFloat = 0.96

  var animatableData: CGFloat {
    get { progress }
    set { progress = newValue }
  }

  func body(content: Content) -> some View {
    let start = Self.firstStart + Self.step * CGFloat(order)
    let share = min(max((progress - start) / Self.span, 0), 1)
    let eased = 1 - (1 - share) * (1 - share)
    content
      .opacity(share)
      .scaleEffect(Self.restScale + (1 - Self.restScale) * eased, anchor: .top)
      .offset(y: Self.rise * (1 - eased))
  }
}
