import AppKit
import ArdiaCore
import ExpoModulesCore

public class BadgeGlyphModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaBadgeGlyph")

    View(BadgeGlyphView.self) {
      Prop("text") { (view: BadgeGlyphView, text: String) in view.text = text }
      Prop("initial") { (view: BadgeGlyphView, initial: Bool) in view.initial = initial }
      Prop("fontSize") { (view: BadgeGlyphView, size: Double) in view.fontSize = size }
      Prop("color") { (view: BadgeGlyphView, hex: String) in view.color = RGBA(hex: hex)?.srgb ?? .white }
    }
  }
}
