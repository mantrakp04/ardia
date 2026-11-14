import ArdiaDesign
import SwiftUI
import UIKit

final class TrayChevron: UIControl {
  private let glass: UIVisualEffectView = {
    let effect = UIGlassEffect(style: .regular)
    effect.isInteractive = true
    return UIVisualEffectView(effect: effect)
  }()
  private let glyph = UIImageView(image: UIImage(systemName: "chevron.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)))

  override init(frame: CGRect) {
    super.init(frame: frame)
    glass.cornerConfiguration = .capsule()
    glass.clipsToBounds = true
    glass.isUserInteractionEnabled = false
    glyph.tintColor = UIColor(BrowsePalette.foregroundPrimary)
    glyph.contentMode = .center
    addSubview(glass)
    addSubview(glyph)
    isAccessibilityElement = true
    accessibilityTraits = .button
    accessibilityLabel = String(localized: "Close Menu")
  }

  required init?(coder: NSCoder) { nil }

  override func layoutSubviews() {
    super.layoutSubviews()
    let circle = CGRect(x: bounds.midX - BrowseLayout.chevronCircle / 2, y: bounds.midY - BrowseLayout.chevronCircle / 2, width: BrowseLayout.chevronCircle, height: BrowseLayout.chevronCircle)
    glass.frame = circle
    glyph.bounds = CGRect(origin: .zero, size: circle.size)
    glyph.center = CGPoint(x: circle.midX, y: circle.midY)
  }

  override func accessibilityActivate() -> Bool {
    sendActions(for: .touchUpInside)
    return true
  }

  func showsGlass(_ shows: Bool) {
    let effect = UIGlassEffect(style: .regular)
    effect.isInteractive = true
    glass.effect = shows ? effect : nil
  }

  func place(at center: CGPoint, pointsDown: Bool) {
    bounds = CGRect(x: 0, y: 0, width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
    self.center = center
    glyph.transform = pointsDown ? CGAffineTransform(rotationAngle: .pi) : .identity
  }
}
