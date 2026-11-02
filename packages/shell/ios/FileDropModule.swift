import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

public class FileDropModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFileDrop")

    View(FileDropView.self) {
      Events("onDropUpdate")
    }

    AsyncFunction("devDrag") { (windowId: String, action: String, x: Double, y: Double, payload: [String: Any]?) -> String in
      #if DEBUG
      return DevDragSession.act(windowId: windowId, action: action, x: x, y: y, payload: payload ?? [:])
      #else
      return "debug builds only"
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devLastFileDrag") { () -> [String] in
      #if DEBUG
      return FileDropView.lastFileDrag.map(\.path)
      #else
      return []
      #endif
    }.runOnQueue(.main)
  }
}
