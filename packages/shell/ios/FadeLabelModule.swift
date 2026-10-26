import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class FadeLabelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFadeLabel")

    View(FadeLabel.self) {
      Prop("text") { (view: FadeLabel, v: String) in view.text = v }
      Prop("fontSize") { (view: FadeLabel, v: Double) in view.fontSize = v }
      Prop("weight") { (view: FadeLabel, v: String) in view.weight = v }
      Prop("color") { (view: FadeLabel, hex: String) in view.color = NSColor(hex: hex) ?? .labelColor }
      Prop("fadeWidth") { (view: FadeLabel, v: Double) in view.fadeWidth = v }
    }
  }
}
