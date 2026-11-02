import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

public class FileDragModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFileDrag")

    View(FileDragView.self) {
      Events("onMiddleClick")
      Prop("path") { (view: FileDragView, path: String?) in view.path = path }
    }
  }
}
