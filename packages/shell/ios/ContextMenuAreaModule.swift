import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class ContextMenuAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaContextMenuArea")

    View(ContextMenuArea.self) {
      Events("onContextMenu")
      Prop("captureDescendants") { (view: ContextMenuArea, on: Bool) in view.captureDescendants = on }
    }
  }
}
