import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class OutsidePressAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaOutsidePressArea")

    View(OutsidePressArea.self) {
      Events("onOutsidePress")
    }
  }
}
