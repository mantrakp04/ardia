import AppKit
import ExpoModulesCore

public class WindowProfileModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWindowProfile")

    View(WindowProfileView.self) {
      Prop("profile") { (view: WindowProfileView, value: String?) in view.profile = value ?? "" }
      Prop("neighbours") { (view: WindowProfileView, value: [String]?) in view.neighbours = value ?? [] }
      Prop("selection") { (view: WindowProfileView, value: String?) in view.selection = value ?? "" }
      OnViewDidUpdateProps { view in view.scheduleSwap() }
    }
  }
}
