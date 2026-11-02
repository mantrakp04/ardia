import ExpoModulesCore
import Foundation

public class CliModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaCli")

    Events("onInstallLine")

    Function("installedVersion") { () -> String? in CliInstaller.installedVersion() }

    AsyncFunction("install") { (promise: Promise) in
      CliInstaller.shared.install(
        onLine: { [weak self] line in self?.sendEvent("onInstallLine", ["line": line]) },
        done: { promise.resolve($0) })
    }
  }
}
