import ExpoModulesCore

public class AreaLightModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaAreaLight")

    AsyncFunction("debugSnapshot") { (dir: String) -> [[String: Any]] in
      try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
      return MetalSurface.instances.enumerated().compactMap { index, view in
        guard let window = view.window, let content = window.contentView else { return nil }
        let name = String(describing: type(of: view))
        let path = (dir as NSString).appendingPathComponent("\(index)-\(name).png")
        let r = view.convert(view.bounds, to: nil)
        let top = content.bounds.height - r.maxY
        return [
          "file": path, "class": name, "ok": view.writeSnapshot(to: path), "window": window.windowNumber,
          "frame": [r.minX, top, r.width, r.height], "key": window.isKeyWindow, "main": window.isMainWindow,
          "hidden": view.isHiddenOrHasHiddenAncestor, "alpha": view.alphaValue,
        ]
      }
    }.runOnQueue(.main)
  }
}

public class WindowBackdropModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWindowBackdrop")

    AsyncFunction("holdKeyLook") { (on: Bool) in WindowTreatmentView.holdsKeyLook = on }.runOnQueue(.main)

    View(WindowBackdropView.self) {
      Prop("colors") { (view: WindowBackdropView, colors: [String]) in view.setColors(colors) }
      Prop("vibrancy") { (view: WindowBackdropView, on: Bool) in view.setVibrancy(on) }
      Prop("tintColor") { (view: WindowBackdropView, hex: String) in
        if let c = SIMD4<Float>(hex: hex) {
          view.setTint { $0.color = NSColor(displayP3Red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: 1) }
        }
      }
      Prop("tintAlpha") { (view: WindowBackdropView, v: Double) in view.setTint { $0.alpha = v } }
      Prop("tintLightness") { (view: WindowBackdropView, v: Double) in view.setTint { $0.lightness = v } }
      Prop("angle") { (view: WindowBackdropView, deg: Double) in view.setAngle(deg) }
      Prop("grainOpacity") { (view: WindowBackdropView, v: Double) in view.set(\.grainOpacity, Float(v)) }
      Prop("grainScale") { (view: WindowBackdropView, v: Double) in view.set(\.grainScale, Float(v)) }
      Prop("themeColors") { (view: WindowBackdropView, flat: [Double]) in view.setCustom { $0.colors = ThemeGradient.parse(flat) } }
      Prop("themeOpacity") { (view: WindowBackdropView, v: Double) in view.setCustom { $0.opacity = v } }
      Prop("themeBaseAlpha") { (view: WindowBackdropView, v: Double) in view.setCustom { $0.baseAlpha = v } }
      Prop("themeGrain") { (view: WindowBackdropView, v: Double) in view.setCustom { $0.grain = v } }
      Prop("themeTexture") { (view: WindowBackdropView, v: String) in view.setCustom { $0.texture = v } }
      Prop("themeAppearance") { (view: WindowBackdropView, v: String) in view.setCustom { $0.appearance = v } }
    }
  }
}

public class ThemeSwatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaThemeSwatch")

    View(ThemeSwatchView.self) {
      Prop("colors") { (view: ThemeSwatchView, flat: [Double]) in view.setColors(flat) }
      Prop("grain") { (view: ThemeSwatchView, v: Double) in view.setGrain(v) }
      Prop("texture") { (view: ThemeSwatchView, v: String) in view.setTexture(v) }
      Prop("padLightness") { (view: ThemeSwatchView, v: Double) in view.setPadLightness(v) }
    }
  }
}

public class PowerUpModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPowerUp")

    View(PowerUpView.self) {
      Prop("palette") { (view: PowerUpView, v: [String]) in view.setPalette(v) }
      Prop("speed") { (view: PowerUpView, v: Double) in view.speed = Float(v) }
      Prop("origin") { (view: PowerUpView, v: Double) in view.origin = Float(v) }
      Prop("cornerRadius") { (view: PowerUpView, v: Double) in view.cornerRadius = Float(v) }
      Prop("haloFrame") { (view: PowerUpView, v: [Double]) in
        view.setHaloFrame(v.count == 4 && v[2] > 0 && v[3] > 0 ? CGRect(x: v[0], y: v[1], width: v[2], height: v[3]) : nil)
      }
    }
  }
}
