import AppKit
import ExpoModulesCore

public class EdgeFadeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaEdgeFade")

    View(EdgeFade.self) {
      Prop("trailing") { (view: EdgeFade, v: Double) in view.trailing = v }
    }
  }
}
