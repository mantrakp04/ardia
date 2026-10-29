import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class PopoverBubbleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPopoverBubble")

    View(PopoverBubble.self) {
      Prop("material") { (view: PopoverBubble, name: String?) in view.setMaterial(name) }
      Prop("dark") { (view: PopoverBubble, dark: Bool?) in view.appearance = dark.map { NSAppearance(named: $0 ? .darkAqua : .aqua) } ?? nil }
      Prop("cornerRadius") { (view: PopoverBubble, v: Double) in view.cornerRadius = v }
      Prop("arrowEdge") { (view: PopoverBubble, edge: String?) in view.arrowEdge = PopoverBubble.Edge(rawValue: edge ?? "") ?? .none }
      Prop("arrowX") { (view: PopoverBubble, v: Double) in view.arrowX = v }
      Prop("arrowWidth") { (view: PopoverBubble, v: Double) in view.arrowWidth = v }
      Prop("arrowHeight") { (view: PopoverBubble, v: Double) in view.arrowHeight = v }
      Prop("tint") { (view: PopoverBubble, hex: String?) in view.tint = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("edgeColor") { (view: PopoverBubble, hex: String?) in view.edgeColor = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("edgeWidth") { (view: PopoverBubble, v: Double) in view.edgeWidth = v }
      Prop("bubbleShadowOpacity") { (view: PopoverBubble, v: Double) in view.bubbleShadowOpacity = v }
      Prop("bubbleShadowRadius") { (view: PopoverBubble, v: Double) in view.bubbleShadowRadius = v }
      Prop("bubbleShadowOffsetY") { (view: PopoverBubble, v: Double) in view.bubbleShadowOffsetY = v }
      Prop("glass") { (view: PopoverBubble, glass: Bool?) in view.glass = glass ?? false }
    }
  }
}
