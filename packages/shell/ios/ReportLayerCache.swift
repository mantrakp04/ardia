import AppKit
import QuartzCore

final class ReportLayerCache {
  static let stillViewClasses: Set<String> = ["WindowBackdropView"]
  private static let refreshInterval: CFTimeInterval = 2

  private struct Still {
    weak var layer: CALayer?
    let image: CGImage
    let size: CGSize
    let madeAt: CFTimeInterval
  }

  private var stills: [ObjectIdentifier: Still] = [:]
  private(set) var refreshes = 0

  static func isStill(_ view: NSView) -> Bool {
    stillViewClasses.contains(String(NSStringFromClass(type(of: view)).split(separator: ".").last ?? ""))
  }

  func update(_ views: [NSView], scale: CGFloat, now: CFTimeInterval) {
    var kept: [ObjectIdentifier: Still] = [:]
    for view in views {
      guard let layer = view.layer, !layer.bounds.isEmpty else { continue }
      let key = ObjectIdentifier(layer)
      if let still = stills[key], still.size == layer.bounds.size, now - still.madeAt < Self.refreshInterval {
        kept[key] = still
      } else if let image = Self.picture(of: layer, scale: scale) {
        kept[key] = Still(layer: layer, image: image, size: layer.bounds.size, madeAt: now)
        refreshes += 1
      }
    }
    stills = kept
  }

  func render(_ root: CALayer, in ctx: CGContext) {
    let swapped = stills.values.compactMap { still -> (CALayer, Any?, CALayerContentsGravity, [Bool])? in
      guard let layer = still.layer else { return nil }
      return (layer, layer.contents, layer.contentsGravity, (layer.sublayers ?? []).map(\.isHidden))
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (layer, _, _, _) in swapped {
      guard let still = stills[ObjectIdentifier(layer)] else { continue }
      layer.sublayers?.forEach { $0.isHidden = true }
      layer.contents = still.image
      layer.contentsGravity = .resize
    }
    root.render(in: ctx)
    for (layer, contents, gravity, hidden) in swapped {
      layer.contents = contents
      layer.contentsGravity = gravity
      for (sublayer, was) in zip(layer.sublayers ?? [], hidden) { sublayer.isHidden = was }
    }
    CATransaction.commit()
  }

  private static func picture(of layer: CALayer, scale: CGFloat) -> CGImage? {
    let size = layer.bounds.size
    let width = Int((size.width * scale).rounded(.up)), height = Int((size.height * scale).rounded(.up))
    guard width > 0, height > 0,
      let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return nil }
    ctx.scaleBy(x: scale, y: scale)
    if layer.isGeometryFlipped || layer.contentsAreFlipped() {
      ctx.translateBy(x: 0, y: size.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    layer.render(in: ctx)
    return ctx.makeImage()
  }
}
