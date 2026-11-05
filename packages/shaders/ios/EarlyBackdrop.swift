import AppKit
import ArdiaCore

@objc(ArdiaEarlyBackdrop)
public final class EarlyBackdrop: NSObject {
  @objc public static func make(_ props: NSDictionary) -> NSView? {
    var tint = WindowTreatmentView.Tint()
    if let hex = props["tintColor"] as? String, let c = RGBA(hex: hex)?.simd {
      tint.color = NSColor(displayP3Red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: 1)
    }
    if let alpha = (props["tintAlpha"] as? NSNumber)?.doubleValue { tint.alpha = alpha }
    if let lightness = (props["tintLightness"] as? NSNumber)?.doubleValue { tint.lightness = lightness }
    if (props["vibrancy"] as? NSNumber)?.boolValue ?? true {
      let view = WindowTreatmentView(frame: .zero)
      view.tint = tint
      view.custom = theme(props)
      return view
    }
    let view = WindowBackdropView(appContext: nil)
    if let colors = props["colors"] as? [String], !colors.isEmpty { view.setColors(colors) }
    view.setTint { $0 = tint }
    if let angle = (props["angle"] as? NSNumber)?.doubleValue { view.setAngle(angle) }
    if let grain = (props["grainOpacity"] as? NSNumber)?.floatValue { view.set(\.grainOpacity, grain) }
    if let scale = (props["grainScale"] as? NSNumber)?.floatValue { view.set(\.grainScale, scale) }
    return view
  }

  static func theme(_ props: NSDictionary) -> ThemeGradient? {
    guard let flat = (props["themeColors"] as? [NSNumber])?.map(\.doubleValue), !flat.isEmpty else { return nil }
    var theme = ThemeGradient()
    theme.colors = ThemeGradient.parse(flat)
    if let v = (props["themeOpacity"] as? NSNumber)?.doubleValue { theme.opacity = v }
    if let v = (props["themeBaseAlpha"] as? NSNumber)?.doubleValue { theme.baseAlpha = v }
    if let v = (props["themeGrain"] as? NSNumber)?.doubleValue { theme.grain = v }
    if let v = props["themeAppearance"] as? String { theme.appearance = v }
    if let v = props["themeTexture"] as? String { theme.texture = v }
    if let v = (props["themeAngle"] as? NSNumber)?.doubleValue { theme.angle = v }
    return theme.isEmpty ? nil : theme
  }
}
