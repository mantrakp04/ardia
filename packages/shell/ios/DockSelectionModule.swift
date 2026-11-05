import AppKit
import ArdiaCore
import CoreImage
import ExpoModulesCore

public class DockSelectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaDockSelection")

    AsyncFunction("iconTheme") { (uri: String?, emoji: String?) -> [String: Any]? in
      guard let source = IconSource(uri: uri, emoji: emoji), let image = source.load() else { return nil }
      let theme = IconTheme.generate(image)
      if case .blur? = theme, let blurred = BlurredIcon.of(source) { _ = GlassGlow.of(source, blurred: blurred.plain) }
      return theme?.json
    }

    View(DockSelection.self) {
      Prop("image") { (view: DockSelection, v: String?) in view.source = IconSource(uri: v, emoji: view.source?.emoji) }
      Prop("emoji") { (view: DockSelection, v: String?) in view.source = IconSource(uri: view.source?.uri, emoji: v) }
      Prop("theme") { (view: DockSelection, v: String?) in view.kind = v ?? "" }
      Prop("fill") { (view: DockSelection, hex: String?) in view.fill = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("stroke") { (view: DockSelection, hex: String?) in view.stroke = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("cornerRadius") { (view: DockSelection, v: Double) in view.cornerRadius = v }
      Prop("strokeWidth") { (view: DockSelection, v: Double) in view.strokeWidth = v }
      Prop("dark") { (view: DockSelection, v: Bool) in view.dark = v }
      Prop("iconSize") { (view: DockSelection, v: Double) in view.iconSize = v }
      Prop("glass") { (view: DockSelection, v: Bool?) in view.glass = v ?? false }
      Prop("colorRing") { (view: DockSelection, v: Bool?) in view.colorRing = v ?? false }
    }
  }
}
