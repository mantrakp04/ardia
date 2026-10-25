import SwiftUI

public struct TabsBackdrop: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  private let tint: [Color]?

  public init(tint: [Color]? = nil) {
    self.tint = tint
  }

  public var body: some View {
    ZStack {
      MeshGradient(width: 3, height: 2, points: [
        [0, 0], [0.5, 0], [1, 0],
        [0, 1], [0.5, 1], [1, 1],
      ], colors: baseColors)
      if !reduceTransparency {
        #if canImport(UIKit)
        DriftingBlobs(colors: blobColors, isAnimated: !reduceMotion)
          .opacity(colorScheme == .dark ? 0.7 : 0.85)
        #endif
        FilmGrain(opacity: colorScheme == .dark ? 0.06 : 0.08)
      }
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }

  private var baseColors: [Color] {
    let hexes = colorScheme == .dark ? TabsPalette.backdropDark : TabsPalette.backdropLight
    let base = hexes.map { Color(hex: $0) }
    guard let tint, tint.count >= 2 else { return base }
    let mix = colorScheme == .dark ? 0.18 : 0.1
    return base.enumerated().map { index, color in
      color.mix(with: tint[index % tint.count], by: mix)
    }
  }

  private var blobColors: [Color] {
    let blobs = colorScheme == .dark
      ? [TabsPalette.blobLavenderDark, TabsPalette.blobBlushDark, TabsPalette.blobPeriwinkleDark]
      : [TabsPalette.blobLavender, TabsPalette.blobBlush, TabsPalette.blobPeriwinkle]
    guard let tint, !tint.isEmpty else { return blobs }
    return blobs.enumerated().map { index, color in color.mix(with: tint[index % tint.count], by: 0.2) }
  }
}

#if canImport(UIKit)
import UIKit

struct DriftingBlobs: UIViewRepresentable {
  var colors: [Color]
  var isAnimated: Bool

  func makeUIView(context: Context) -> BlobsView {
    BlobsView()
  }

  func updateUIView(_ view: BlobsView, context: Context) {
    view.apply(colors: colors.map { UIColor($0) }, animated: isAnimated)
  }
}

final class BlobsView: UIView {
  private var blobs: [CAGradientLayer] = []
  private var isAnimated = false
  private let loops: [Double] = [TabsMotion.backdropSlowLoop, TabsMotion.backdropFastLoop, TabsMotion.backdropSlowLoop * 1.3]
  private let anchors: [CGPoint] = [CGPoint(x: 0.42, y: 0.38), CGPoint(x: 0.6, y: 0.58), CGPoint(x: 0.5, y: 0.45)]
  private let placements: [CGPoint] = [CGPoint(x: 0.18, y: 0.22), CGPoint(x: 0.86, y: 0.5), CGPoint(x: 0.3, y: 0.86)]

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    for index in 0..<3 {
      let blob = CAGradientLayer()
      blob.type = .radial
      blob.startPoint = CGPoint(x: 0.5, y: 0.5)
      blob.endPoint = CGPoint(x: 1, y: 1)
      blob.anchorPoint = anchors[index]
      layer.addSublayer(blob)
      blobs.append(blob)
    }
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func apply(colors: [UIColor], animated: Bool) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (index, blob) in blobs.enumerated() {
      let color = colors[index % max(colors.count, 1)]
      blob.colors = [color.cgColor, color.withAlphaComponent(0).cgColor]
    }
    CATransaction.commit()
    guard animated != isAnimated else { return }
    isAnimated = animated
    updateAnimations()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let side = max(bounds.width, bounds.height) * 0.95
    for (index, blob) in blobs.enumerated() {
      blob.bounds = CGRect(x: 0, y: 0, width: side, height: side)
      blob.position = CGPoint(x: bounds.width * placements[index].x, y: bounds.height * placements[index].y)
    }
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateAnimations()
  }

  private func updateAnimations() {
    for (index, blob) in blobs.enumerated() {
      blob.removeAnimation(forKey: "drift")
      guard isAnimated, window != nil else { continue }
      let spin = CABasicAnimation(keyPath: "transform.rotation.z")
      spin.fromValue = index.isMultiple(of: 2) ? 0 : 2 * Double.pi
      spin.toValue = index.isMultiple(of: 2) ? 2 * Double.pi : 0
      spin.duration = loops[index]
      spin.repeatCount = .infinity
      spin.timingFunction = CAMediaTimingFunction(name: .linear)
      spin.isRemovedOnCompletion = false
      blob.add(spin, forKey: "drift")
    }
  }
}
#endif
