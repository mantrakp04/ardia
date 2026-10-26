import ExpoModulesCore
import Foundation

public class UserScriptsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaUserScripts")
    Events("onChange")

    OnCreate {
      UserScripts.shared.emit = { [weak self] in self?.sendEvent("onChange", [:]) }
    }

    Function("watch") { (on: Bool) in
      if on { UserScripts.shared.start() } else { UserScripts.shared.stop() }
    }

    AsyncFunction("read") { () -> [String: Any] in UserScripts.shared.read() }.runOnQueue(UserScripts.work)

    AsyncFunction("readStatus") { () -> String? in UserScripts.shared.readStatus() }.runOnQueue(UserScripts.work)

    AsyncFunction("writeStatus") { (json: String) in try UserScripts.shared.writeStatus(json) }.runOnQueue(UserScripts.work)
  }
}
