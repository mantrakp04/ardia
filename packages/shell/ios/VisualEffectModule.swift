import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class VisualEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaVisualEffect")

    View(VisualEffect.self) {
      Prop("material") { (view: VisualEffect, name: String) in view.setMaterial(name) }
      Prop("blendingMode") { (view: VisualEffect, name: String) in
        view.effect.blendingMode = name == "behindWindow" ? .behindWindow : .withinWindow
      }
      Prop("cornerRadius") { (view: VisualEffect, v: Double) in view.cornerRadius = v }
    }
  }
}
