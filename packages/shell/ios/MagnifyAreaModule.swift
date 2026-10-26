import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class MagnifyAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaMagnifyArea")

    AsyncFunction("devMagnify") { (windowId: String, x: Double, y: Double, steps: [[String: Any]]) -> [String: Any] in
      #if DEBUG
      return MagnifyArea.devMagnify(windowId: windowId, x: x, y: y, steps: steps)
      #else
      return ["error": "DEV builds only"]
      #endif
    }.runOnQueue(.main)

    View(MagnifyArea.self) {
      Prop("enabled") { (view: MagnifyArea, on: Bool) in view.enabled = on }
      Events("onMagnify")
    }
  }
}
