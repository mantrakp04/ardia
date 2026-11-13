import ArdiaDesign
import SwiftUI
import UIKit

final class DockedPill: UIView {
  let plusGlyph = UIImageView()
  let barFill = UIView()
  private let glass = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
  private var glyphWidth = BrowseLayout.plusCapsule.width

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    glass.cornerConfiguration = .capsule()
    glass.clipsToBounds = true
    barFill.backgroundColor = UIColor(BrowsePalette.fieldFill)
    barFill.layer.cornerCurve = .continuous
    barFill.alpha = 0
    plusGlyph.contentMode = .center
    addSubview(glass)
    addSubview(barFill)
    addSubview(plusGlyph)
  }

  required init?(coder: NSCoder) { nil }

  var morphWidth: CGFloat {
    layer.presentation()?.bounds.width ?? bounds.width
  }

  var widthAnimation: CABasicAnimation? {
    (layer.animation(forKey: "bounds.size") ?? layer.animation(forKey: "position")) as? CABasicAnimation
  }

  func style(for rest: TrayRest) {
    let weight: UIImage.SymbolWeight = rest == .pageBar ? .semibold : .medium
    plusGlyph.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: weight))
    plusGlyph.tintColor = rest == .pageBar ? UIColor(BrowsePalette.foregroundPrimary) : .label
  }

  func showsGlass(_ shows: Bool) {
    glass.effect = shows ? UIGlassEffect(style: .regular) : nil
  }

  func rest(at pill: CGRect) {
    glyphWidth = pill.width > 0 ? pill.width : BrowseLayout.plusCapsule.width
    frame = pill
    layoutMaterial()
    plusGlyph.frame = bounds
  }

  func dock(in field: CGRect) {
    frame = field
    layoutMaterial()
    plusGlyph.frame = CGRect(x: BrowseLayout.plusGlyphInsetInField - glyphWidth / 2, y: 0, width: glyphWidth, height: field.height)
  }

  private func layoutMaterial() {
    glass.frame = bounds
    barFill.frame = bounds
    barFill.layer.cornerRadius = bounds.height / 2
  }
}
