import ArdiaDesign
import SwiftUI
import UIKit

struct KeyboardGuideReader: UIViewRepresentable {
  let onChange: (CGFloat) -> Void

  func makeUIView(context: Context) -> KeyboardGuideView {
    let view = KeyboardGuideView()
    view.onChange = onChange
    return view
  }

  func updateUIView(_ view: KeyboardGuideView, context: Context) {
    view.onChange = onChange
  }
}

final class KeyboardGuideView: UIView {
  var onChange: ((CGFloat) -> Void)?
  private let marker = UIView()
  private var reported: CGFloat?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    marker.isUserInteractionEnabled = false
    marker.translatesAutoresizingMaskIntoConstraints = false
    addSubview(marker)
    keyboardLayoutGuide.usesBottomSafeArea = false
    keyboardLayoutGuide.followsUndockedKeyboard = false
    NSLayoutConstraint.activate([
      marker.leadingAnchor.constraint(equalTo: leadingAnchor),
      marker.widthAnchor.constraint(equalToConstant: 0),
      marker.topAnchor.constraint(equalTo: keyboardLayoutGuide.topAnchor),
      marker.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  required init?(coder: NSCoder) { nil }

  override func layoutSubviews() {
    super.layoutSubviews()
    report()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reported = nil
    setNeedsLayout()
  }

  private func report() {
    guard window != nil else { return }
    let overlap = KeyboardLift.overlap(guideFrame: keyboardLayoutGuide.layoutFrame, containerHeight: bounds.height)
    guard overlap != reported else { return }
    reported = overlap
    let onChange = onChange
    Task { @MainActor in onChange?(overlap) }
  }
}
