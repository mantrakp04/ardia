import AppKit

enum WindowMotion {
  struct Style {
    let entranceDuration: CFTimeInterval
    let exitDuration: CFTimeInterval
    let entranceScale: CGFloat
    let exitScale: CGFloat
    static let little = Style(entranceDuration: 0.2, exitDuration: 0.15, entranceScale: 0.97, exitScale: 0.985)
    static let main = Style(entranceDuration: 0.25, exitDuration: 0.18, entranceScale: 0.98, exitScale: 0.99)
  }
  private static let settleAfter: TimeInterval = 0.5
  private static let entranceKey = "ardia.window.entrance"
  private static let exitKey = "ardia.window.exit"
  private static let curve = CAMediaTimingFunction(controlPoints: 0.23, 1, 0.32, 1)

  private final class Look {
    let opaque: Bool
    let shadow: Bool
    init(_ window: NSWindow) {
      opaque = window.isOpaque
      shadow = window.hasShadow
    }
  }
  private static let looks = NSMapTable<NSWindow, Look>.weakToStrongObjects()

  private static var scales: Bool { !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  private static func frameView(of window: NSWindow) -> NSView? {
    guard let view = window.contentView?.superview ?? window.contentView else { return nil }
    view.wantsLayer = true
    return view.layer == nil ? nil : view
  }

  private static func scaled(_ layer: CALayer, by factor: CGFloat) -> CATransform3D {
    let bounds = layer.bounds
    var scale = CATransform3DMakeScale(factor, factor, 1)
    scale.m41 = (bounds.midX - (bounds.minX + layer.anchorPoint.x * bounds.width)) * (1 - factor)
    scale.m42 = (bounds.midY - (bounds.minY + layer.anchorPoint.y * bounds.height)) * (1 - factor)
    return CATransform3DConcat(scale, layer.transform)
  }

  private static func dropShadow(_ window: NSWindow) {
    if looks.object(forKey: window) == nil { looks.setObject(Look(window), forKey: window) }
    window.isOpaque = false
    window.hasShadow = false
  }

  private static func restoreShadow(_ window: NSWindow) {
    guard let look = looks.object(forKey: window) else { return }
    looks.removeObject(forKey: window)
    window.isOpaque = look.opaque
    window.hasShadow = look.shadow
    if look.shadow { window.invalidateShadow() }
  }

  private static func group(_ parts: [CAAnimation], duration: CFTimeInterval) -> CAAnimationGroup {
    let group = CAAnimationGroup()
    group.animations = parts
    group.duration = duration
    group.timingFunction = curve
    group.fillMode = .backwards
    return group
  }

  static func enter(_ window: NSWindow, style: Style, scales scaling: Bool) {
    guard window.isVisible, let view = frameView(of: window), let layer = view.layer else {
      window.alphaValue = 1
      return
    }
    dropShadow(window)
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0
    fade.toValue = 1
    var parts: [CAAnimation] = [fade]
    if scaling, scales {
      let grow = CABasicAnimation(keyPath: "transform")
      grow.fromValue = NSValue(caTransform3D: scaled(layer, by: style.entranceScale))
      grow.toValue = NSValue(caTransform3D: layer.transform)
      parts.append(grow)
    }
    let settle: () -> Void = { [weak window, weak layer] in
      guard let window, let layer, layer.animation(forKey: exitKey) == nil else { return }
      layer.removeAnimation(forKey: entranceKey)
      restoreShadow(window)
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    CATransaction.setCompletionBlock(settle)
    view.alphaValue = 1
    layer.add(group(parts, duration: style.entranceDuration), forKey: entranceKey)
    CATransaction.commit()
    CATransaction.flush()
    window.alphaValue = 1
    DispatchQueue.main.asyncAfter(deadline: .now() + settleAfter, execute: settle)
  }

  static func exit(_ window: NSWindow, style: Style, then done: @escaping () -> Void) {
    guard window.isVisible, window.alphaValue > 0, let view = frameView(of: window), let layer = view.layer else { return done() }
    let shown = layer.presentation() ?? layer
    let fromTransform = shown.transform
    let fromOpacity = shown.opacity
    layer.removeAnimation(forKey: entranceKey)
    dropShadow(window)
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = fromOpacity
    fade.toValue = 0
    var parts: [CAAnimation] = [fade]
    if scales {
      let shrink = CABasicAnimation(keyPath: "transform")
      shrink.fromValue = NSValue(caTransform3D: fromTransform)
      shrink.toValue = NSValue(caTransform3D: scaled(layer, by: style.exitScale))
      parts.append(shrink)
    }
    var finished = false
    let finish: () -> Void = { [weak window, weak view, weak layer] in
      guard !finished else { return }
      finished = true
      window?.orderOut(nil)
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      layer?.removeAnimation(forKey: exitKey)
      view?.alphaValue = 1
      CATransaction.commit()
      if let window { restoreShadow(window) }
      done()
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    CATransaction.setCompletionBlock(finish)
    view.alphaValue = 0
    layer.add(group(parts, duration: style.exitDuration), forKey: exitKey)
    CATransaction.commit()
    DispatchQueue.main.asyncAfter(deadline: .now() + settleAfter, execute: finish)
  }
}
