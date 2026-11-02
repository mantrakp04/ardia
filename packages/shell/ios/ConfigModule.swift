import ExpoModulesCore
import Foundation

public class ConfigModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaConfig")

    Events("onChange")

    Function("readFile") { (name: String) -> [String: Any] in ConfigFolder.read(name) }

    AsyncFunction("watch") { [weak self] (names: [String], promise: Promise) in
      ConfigWatcher.shared.watch(names, armed: { promise.resolve(nil) }) { self?.sendEvent("onChange", [:]) }
    }

    AsyncFunction("writeSchemas") { (files: [String: String]) throws -> [String] in try ConfigFolder.writeSchemas(files) }
      .runOnQueue(DispatchQueue.global(qos: .utility))

    OnDestroy { ConfigWatcher.shared.stop() }
  }
}
