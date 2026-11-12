import ExpoModulesCore

public class LocationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaLocation")

    AsyncFunction("locationPermission") { () -> String in
      LocationAccess.shared.status()
    }.runOnQueue(.main)
    AsyncFunction("requestLocationPermission") { (promise: Promise) in
      LocationAccess.shared.request { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("openLocationSettings") {
      LocationAccess.shared.openSettings()
    }.runOnQueue(.main)
    AsyncFunction("devLocationRequests") { () -> Int in
      LocationAccess.shared.fakeRequests
    }.runOnQueue(.main)
  }
}
