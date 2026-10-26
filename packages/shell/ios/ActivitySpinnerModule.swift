import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class ActivitySpinnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaActivitySpinner")

    View(ActivitySpinner.self) {}
  }
}
