import ArdiaDesign
import UIKit

final class DockedPill: UIView {
  let plusGlyph = UIImageView(image: UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)))
  private let glass = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
  private var glyphWidth = BrowseLayout.plusCapsule.width

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    glass.cornerConfiguration = .capsule()
    glass.clipsToBounds = true
    plusGlyph.tintColor = .label
    plusGlyph.contentMode = .center
    addSubview(glass)
    addSubview(plusGlyph)
  }

  required init?(coder: NSCoder) { nil }

  var morphWidth: CGFloat {
    layer.presentation()?.bounds.width ?? bounds.width
  }

  var widthAnimation: CABasicAnimation? {
    (layer.animation(forKey: "bounds.size") ?? layer.animation(forKey: "position")) as? CABasicAnimation
  }

  func rest(at pill: CGRect) {
    glyphWidth = pill.width > 0 ? pill.width : BrowseLayout.plusCapsule.width
    frame = pill
    glass.frame = bounds
    plusGlyph.frame = bounds
  }

  func dock(in field: CGRect) {
    frame = field
    glass.frame = bounds
    plusGlyph.frame = CGRect(x: BrowseLayout.plusGlyphInsetInField - glyphWidth / 2, y: 0, width: glyphWidth, height: field.height)
  }
}
