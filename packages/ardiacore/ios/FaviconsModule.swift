import ExpoModulesCore

public class FaviconsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function
  }

  static let calls = CallTable(domain: "favicons", handlers: [
    "get": EngineCall.passing("ac_favicons_get"),
    "set": EngineCall.passing("ac_favicons_set"),
    "fetch": { args, reply in ArdiaFavicons.fetch(try args.text("url"), profile: args.profile, name: nil) { reply.ok($0) } },
  ])
}
