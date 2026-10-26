import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class SurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSurface")

    View(Surface.self) {
      Prop("fill") { (view: Surface, hex: String?) in view.surfaceFill = hex.flatMap(NSColor.init(hex:)) }
      Prop("cornerRadius") { (view: Surface, v: Double) in view.surfaceRadius = v }
      Prop("borderColor") { (view: Surface, hex: String?) in view.surfaceBorderColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("borderWidth") { (view: Surface, v: Double) in view.surfaceBorderWidth = v }
      Prop("borderColors") { (view: Surface, hexes: [String]?) in view.surfaceBorderColors = (hexes ?? []).compactMap(NSColor.init(hex:)) }
      Prop("surfaceShadowColor") { (view: Surface, hex: String?) in view.surfaceShadowColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("surfaceShadowOpacity") { (view: Surface, v: Double) in view.surfaceShadowOpacity = v }
      Prop("surfaceShadowRadius") { (view: Surface, v: Double) in view.surfaceShadowRadius = v }
      Prop("surfaceShadowOffset") { (view: Surface, v: [Double]) in view.surfaceShadowOffset = v.count == 2 ? CGSize(width: v[0], height: v[1]) : .zero }
    }
  }
}
